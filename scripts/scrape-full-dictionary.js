// Scrapes the COMPLETE A1/A2/B1/B2 word lists (+ example sentences) directly from
// monchinese.me/dictionary?level=X for the "Tổng Hợp Từ Điển" page (/full-dictionary),
// per explicit user request that this page's content track that source 100%.
//
// The plain listing endpoint (`/dictionary?level=X`) hard-caps at exactly 120 results
// regardless of any pagination-shaped query param tried (page/limit/offset/size all
// silently ignored — confirmed by testing) — so it cannot serve as a full word-list
// source on its own. However `/dictionary?level=X&q=<term>` performs a REAL filtered
// search that returns genuine (uncapped-in-practice) result counts. Single-letter `q`
// values behave unpredictably (some return 0 even for real matches), but real 2+
// character pinyin syllables work reliably. Enumerating every standard toneless
// Mandarin syllable (~403 of them, derived from pinyin-pro over the CJK Unified
// Ideographs block) as a `q=` value and unioning the results per level is therefore a
// complete crawl: every word's pinyin necessarily contains at least one full syllable
// from that set, so every word matches at least one query in the enumeration.
//
// Usage:
//   node scripts/scrape-full-dictionary.js list      - crawl level+syllable listings,
//                                                       write scripts/output/full-dictionary-words.json
//   node scripts/scrape-full-dictionary.js examples  - fetch /dictionary/<hanzi> for
//                                                       every unique word, write
//                                                       scripts/output/full-dictionary-examples.json
//   node scripts/scrape-full-dictionary.js sql       - merge into
//                                                       scripts/output/full-dictionary-seed.sql
//   (no arg)                                          - runs all three in sequence
const fs = require('fs')
const path = require('path')
const { pinyin } = require('pinyin-pro')

const OUT_DIR = path.join(__dirname, 'output')
const WORDS_FILE = path.join(OUT_DIR, 'full-dictionary-words.json')
const EXAMPLES_FILE = path.join(OUT_DIR, 'full-dictionary-examples.json')
const SQL_FILE = path.join(OUT_DIR, 'full-dictionary-seed.sql')

const LEVELS = ['A1', 'A2', 'B1', 'B2']
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Same polyphone workaround documented in KNOWLEDGE.md (třetí independent copy — the
// established pattern for this one-off-script technique, see build-topic-vocab-seed.js
// and backfill-b2-examples.js).
const POLYPHONE_FIXES = { '們': 'men', '麼': 'me', '車': 'chē', '還': 'hái', '乾': 'gān' }

function generatePinyin(hanzi) {
  if (!hanzi) return null
  const chars = [...hanzi]
  const syllables = pinyin(hanzi, { type: 'array' })
  if (syllables.length !== chars.length) return pinyin(hanzi)
  const fixed = chars.map((ch, i) => POLYPHONE_FIXES[ch] || syllables[i])
  return fixed.join(' ')
}

function buildSyllableList() {
  const syllables = new Set()
  for (let cp = 0x4e00; cp <= 0x9fff; cp++) {
    const ch = String.fromCodePoint(cp)
    const py = pinyin(ch, { toneType: 'none', type: 'string' })
    if (py && /^[a-z]+$/.test(py)) syllables.add(py)
  }
  return [...syllables].sort()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

async function fetchHtml(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      if (i === retries - 1) throw err
      await sleep(1000 * (i + 1))
    }
  }
}

function parseListingPage(html, expectedLevel) {
  const liRegex = /<li><a class="group flex items-center gap-4[\s\S]*?<\/li>/g
  const blocks = html.match(liRegex) || []
  const words = []
  for (const li of blocks) {
    const hrefMatch = li.match(/href="(\/dictionary\/[^"]+)"/)
    const hanziMatch = li.match(/<span class="hanzi[^"]*">([^<]+)<\/span>/)
    const pinyinMatch = li.match(/<span class="pinyin[^"]*">([^<]+)<\/span>/)
    const posMatch = li.match(/<span class="rounded bg-muted px-1\.5 py-0\.5 font-medium text-muted-foreground">([^<]+)<\/span>/)
    const meaningMatch = li.match(/<div class="mt-0\.5 line-clamp-2 text-sm text-foreground\/90">([^<]*)<\/div>/)
    const levelBadgeMatch = li.match(/text-\[11px\] font-semibold[^"]*">([^<]+)<\/span>/)

    if (!hrefMatch || !hanziMatch || !pinyinMatch) continue
    const levelBadge = levelBadgeMatch ? decodeEntities(levelBadgeMatch[1]) : null
    if (levelBadge && levelBadge !== expectedLevel) continue

    words.push({
      dictHref: hrefMatch[1],
      hanzi: decodeEntities(hanziMatch[1]),
      pinyin: decodeEntities(pinyinMatch[1]),
      pos: posMatch ? decodeEntities(posMatch[1]) : null,
      vietnamese: meaningMatch ? decodeEntities(meaningMatch[1]) : '',
    })
  }
  return words
}

async function runList() {
  const syllables = buildSyllableList()
  console.log(`Enumerating with ${syllables.length} syllables across ${LEVELS.length} levels`)

  const result = {}
  const nearCapWarnings = []

  for (const level of LEVELS) {
    const byHref = new Map()
    let done = 0
    for (const syl of syllables) {
      done++
      if (done % 50 === 0) console.log(`[${level}] ${done}/${syllables.length} syllables, ${byHref.size} words so far`)
      try {
        const html = await fetchHtml(`https://monchinese.me/dictionary?level=${level}&q=${encodeURIComponent(syl)}`)
        if (!html) continue
        const countMatch = html.match(/(\d+) kết quả/)
        const count = countMatch ? parseInt(countMatch[1], 10) : 0
        if (count >= 115) nearCapWarnings.push(`${level} q=${syl} -> ${count} kết quả (near/at cap, may be truncated)`)
        const words = parseListingPage(html, level)
        for (const w of words) {
          if (!byHref.has(w.dictHref)) byHref.set(w.dictHref, w)
        }
      } catch (err) {
        console.log(`FAILED ${level} q=${syl}: ${err.message}`)
      }
      await sleep(150)
    }
    result[level] = [...byHref.values()]
    console.log(`[${level}] done: ${result[level].length} unique words`)
  }

  fs.writeFileSync(WORDS_FILE, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`\nWrote ${WORDS_FILE}`)
  for (const l of LEVELS) console.log(`  ${l}: ${result[l].length} words`)
  if (nearCapWarnings.length) {
    console.log(`\n${nearCapWarnings.length} queries returned >=115 results (possible truncation):`)
    nearCapWarnings.forEach((w) => console.log('  ' + w))
  }
}

function parseExamplePage(html) {
  const sectionMatch = html.match(/<h2 class="mb-4 text-xl font-semibold">Ví dụ<\/h2><ul class="space-y-3">([\s\S]*?)<\/ul>/)
  if (!sectionMatch) return null
  const firstLiMatch = sectionMatch[1].match(/<li[^>]*>[\s\S]*?<\/li>/)
  if (!firstLiMatch) return null
  const li = firstLiMatch[0]
  const hanziMatch = li.match(/<div class="hanzi[^"]*">([^<]+)<\/div>/)
  const vietMatch = li.match(/<div class="mt-1 text-sm text-muted-foreground">([^<]+)<\/div>/)
  if (!hanziMatch || !vietMatch) return null
  return {
    exampleHanzi: decodeEntities(hanziMatch[1]),
    exampleVietnamese: decodeEntities(vietMatch[1]),
  }
}

async function runExamples() {
  const byLevel = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf-8'))
  const uniqueByHref = new Map()
  for (const level of LEVELS) {
    for (const w of byLevel[level] || []) {
      if (!uniqueByHref.has(w.dictHref)) uniqueByHref.set(w.dictHref, w.hanzi)
    }
  }

  const examples = {}
  let done = 0
  const total = uniqueByHref.size
  for (const [href, hanzi] of uniqueByHref) {
    done++
    if (done % 100 === 0 || done === total) console.log(`[${done}/${total}] examples...`)
    try {
      const html = await fetchHtml(`https://monchinese.me${href}`)
      const ex = html ? parseExamplePage(html) : null
      if (ex) examples[href] = ex
    } catch (err) {
      console.log(`FAILED ${hanzi}: ${err.message}`)
    }
    await sleep(150)
  }

  fs.writeFileSync(EXAMPLES_FILE, JSON.stringify(examples, null, 2), 'utf-8')
  console.log(`\nWrote ${EXAMPLES_FILE} (${Object.keys(examples).length}/${total} words got an example)`)
}

const escapeSql = (s) => String(s).replace(/'/g, "''")
const sqlStr = (s) => (s === null || s === undefined || s === '' ? 'NULL' : `'${escapeSql(s)}'`)

function runSql() {
  const byLevel = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf-8'))
  const examples = JSON.parse(fs.readFileSync(EXAMPLES_FILE, 'utf-8'))

  const lines = []
  lines.push('-- Generated by scripts/scrape-full-dictionary.js — do not hand-edit.')
  lines.push('BEGIN;')

  for (const level of LEVELS) {
    const words = byLevel[level] || []
    words.forEach((w, idx) => {
      const ex = examples[w.dictHref]
      const examplePinyin = ex ? generatePinyin(ex.exampleHanzi) : null
      lines.push(
        `INSERT INTO public.full_dictionary_words (level, hanzi, pinyin, vietnamese, pos, example_hanzi, example_pinyin, example_vietnamese, source, order_index) VALUES (` +
          `${sqlStr(level)}, ${sqlStr(w.hanzi)}, ${sqlStr(w.pinyin)}, ${sqlStr(w.vietnamese)}, ${sqlStr(w.pos)}, ` +
          `${ex ? sqlStr(ex.exampleHanzi) : 'NULL'}, ${ex ? sqlStr(examplePinyin) : 'NULL'}, ${ex ? sqlStr(ex.exampleVietnamese) : 'NULL'}, ` +
          `'monchinese', ${idx}) ` +
          `ON CONFLICT (level, hanzi, pinyin) DO UPDATE SET ` +
          `vietnamese = EXCLUDED.vietnamese, pos = EXCLUDED.pos, example_hanzi = EXCLUDED.example_hanzi, ` +
          `example_pinyin = EXCLUDED.example_pinyin, example_vietnamese = EXCLUDED.example_vietnamese, order_index = EXCLUDED.order_index;`
      )
    })
  }

  lines.push('COMMIT;')
  fs.writeFileSync(SQL_FILE, lines.join('\n') + '\n', 'utf-8')
  console.log(`Wrote ${SQL_FILE} (${lines.length - 3} rows)`)
}

async function main() {
  const mode = process.argv[2]
  if (!mode || mode === 'list') await runList()
  if (!mode || mode === 'examples') await runExamples()
  if (!mode || mode === 'sql') runSql()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
