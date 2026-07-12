// Builds public/tocfl-index.json — a toneless-pinyin → hanzi lookup index used by
// the "Thêm Từ Vựng" suggestion box AND its multi-character pinyin segmentation fallback.
// Merges two sources:
//   1. TOCFL word list (PSeitz/tocfl) — gives entries a TOCFL level (l: 1-7)
//   2. CC-CEDICT (mdbg.net)          — much larger coverage (incl. nearly all single hanzi,
//                                      which the segmentation algorithm relies on as its
//                                      "valid syllable" dictionary), entries get l: null
//
// Run: node scripts/build-dictionary-index.js
const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const OUTPUT_FILE = path.join(__dirname, "../public/tocfl-index.json");
const OWN_DICT_FILE = path.join(__dirname, "output/own-dictionary-words.json");
const MAX_PER_KEY = 24;

function stripTones(py) {
  return py.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/̈/g, "").toLowerCase().replace(/\s+/g, "");
}

// CC-CEDICT pinyin uses numbered tones ("ni3 hao3") and "u:" for ü ("lu:4").
// Convert to the same toneless-key shape as TOCFL entries (accented pinyin -> stripTones).
function numberedPinyinToKey(full) {
  return full
    .split(/\s+/)
    .map((syl) => syl.replace(/u:/gi, "u").replace(/[0-9]/g, ""))
    .join("")
    .toLowerCase();
}

const TONE_MARKS = {
  a: ["a", "ā", "á", "ǎ", "à"],
  e: ["e", "ē", "é", "ě", "è"],
  i: ["i", "ī", "í", "ǐ", "ì"],
  o: ["o", "ō", "ó", "ǒ", "ò"],
  u: ["u", "ū", "ú", "ǔ", "ù"],
  ü: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
};

// Convert one numbered syllable ("hao3", "lu:4", "de5") to accented display form.
function numberedSyllableToAccented(syl) {
  const m = syl.match(/^([a-zA-Z:]+)([0-5])?$/);
  if (!m) return syl;
  const letters = m[1].replace(/u:/gi, "ü");
  const tone = m[2] ? parseInt(m[2], 10) : 5;
  if (!letters || tone === 0 || tone === 5) return letters;

  let idx = -1;
  const lower = letters.toLowerCase();
  if (lower.includes("a")) idx = lower.indexOf("a");
  else if (lower.includes("e")) idx = lower.indexOf("e");
  else if (lower.includes("ou")) idx = lower.indexOf("o");
  else {
    for (let i = letters.length - 1; i >= 0; i--) {
      if ("aeiouü".includes(lower[i])) { idx = i; break; }
    }
  }
  if (idx === -1) return letters;

  const ch = letters[idx];
  const table = TONE_MARKS[ch.toLowerCase()];
  if (!table) return letters;
  let accented = table[tone];
  if (ch !== ch.toLowerCase()) accented = accented.toUpperCase();
  return letters.slice(0, idx) + accented + letters.slice(idx + 1);
}

function numberedPinyinToAccented(full) {
  return full.split(/\s+/).map(numberedSyllableToAccented).join(" ");
}

function httpsGetBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGetBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode + " for " + url)); return; }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

async function loadTocfl(index) {
  console.log("Downloading TOCFL word list...");
  const buf = await httpsGetBuffer("https://raw.githubusercontent.com/PSeitz/tocfl/master/tocfl_words.json");
  const lines = buf.toString("utf-8").trim().split("\n").filter((l) => l.trim());
  const entries = lines.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  console.log("TOCFL entries:", entries.length);

  for (const e of entries) {
    const trad = e.text;
    const py = e.pinyin;
    const level = e.tocfl_level;
    if (!trad || !py) continue;

    const key = stripTones(py);
    if (!index[key]) index[key] = [];
    if (!index[key].find((x) => x.t === trad)) {
      index[key].push({ t: trad, p: py, l: level });
    }

    if (e.pinyin_alt) {
      for (const altPy of e.pinyin_alt) {
        const altKey = stripTones(altPy);
        if (!index[altKey]) index[altKey] = [];
        if (!index[altKey].find((x) => x.t === trad)) {
          index[altKey].push({ t: trad, p: altPy, l: level });
        }
      }
    }
  }
}

async function loadCedict(index) {
  console.log("Downloading CC-CEDICT...");
  const gz = await httpsGetBuffer("https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz");
  const txt = zlib.gunzipSync(gz).toString("utf-8");
  const lines = txt.split("\n");
  let count = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("#") || !line.trim()) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
    if (!m) continue;
    const [, trad, , pinyinRaw] = m;
    if (/\d/.test(trad)) continue; // skip numeric placeholder entries

    const key = numberedPinyinToKey(pinyinRaw.trim());
    if (!key) continue;
    if (!index[key]) index[key] = [];
    if (!index[key].find((x) => x.t === trad)) {
      index[key].push({ t: trad, p: numberedPinyinToAccented(pinyinRaw.trim()), l: null });
      count++;
    }
  }
  console.log("CC-CEDICT new entries added:", count);
}

// Merges in our own dictionary_words content (dumped ahead of time to
// scripts/output/own-dictionary-words.json — see KNOWLEDGE.md on regenerating it) at
// top priority (l: 0, ranks before every real TOCFL level 1-7), so every word the
// user is actively trying to type in this app's own dictionary is guaranteed to
// suggest — CC-CEDICT/TOCFL alone were found to be missing/deprioritizing plenty of
// entries once Band B roughly quintupled our word count.
function loadOwnDictionary(index) {
  if (!fs.existsSync(OWN_DICT_FILE)) {
    console.log("No own-dictionary-words.json found — skipping own-dictionary merge.");
    return;
  }
  const words = JSON.parse(fs.readFileSync(OWN_DICT_FILE, "utf-8"));
  let count = 0;
  for (const w of words) {
    const trad = w.hanzi;
    const py = w.pinyin;
    if (!trad || !py) continue;
    const key = stripTones(py);
    if (!key) continue;
    if (!index[key]) index[key] = [];
    if (!index[key].find((x) => x.t === trad)) {
      index[key].push({ t: trad, p: py, l: 0 });
      count++;
    }
  }
  console.log("Own dictionary_words merged:", count, "of", words.length);
}

async function main() {
  const index = {};
  loadOwnDictionary(index);
  await loadTocfl(index);
  await loadCedict(index);

  for (const key of Object.keys(index)) {
    index[key].sort((a, b) => {
      const al = a.l ?? 99;
      const bl = b.l ?? 99;
      if (al !== bl) return al - bl;
      return a.t.length - b.t.length;
    });
    index[key] = index[key].slice(0, MAX_PER_KEY);
  }

  const output = JSON.stringify(index);
  fs.writeFileSync(OUTPUT_FILE, output);

  console.log("Done! Keys:", Object.keys(index).length, "| Size:", Math.round(output.length / 1024), "KB");
  console.log("ni ->", JSON.stringify(index["ni"] || []));
  console.log("nihao ->", JSON.stringify(index["nihao"] || []));
  console.log("xihuan ->", JSON.stringify(index["xihuan"] || []));
}

main().catch((e) => { console.error(e); process.exit(1); });
