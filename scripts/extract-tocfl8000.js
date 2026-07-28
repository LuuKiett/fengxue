// Extracts A1/A2/B1 rows from 華語八千詞表20240923.xlsx (official TOCFL 8000-word list,
// new-format Novice/Level1-6 banding) into scripts/output/tocfl8000-raw.json.
//
// Sheet -> our level mapping (per explicit user request, only these 3 are imported):
//   入門級(Level 1)  -> A1
//   基礎級(Level 2)  -> A2
//   進階級(Level 3)  -> B1
// 準備級一級/二級 (Novice 1/2, pre-A1) and 高階級/流利級 (B2+) are intentionally skipped.
//
// The source pinyin column mixes breve tone-3 marks (ă/ĭ/ŏ/ŭ) with already-correct
// caron marks (ě/ǔ/ǚ) depending on vowel — normalized here to standard Hanyu Pinyin
// caron tone-3 marks throughout, since the per-word readings themselves are already
// TOCFL-correct (context-disambiguated, e.g. "還是"->háishì, "還"(alone)->huán) and
// shouldn't be regenerated from scratch via pinyin-pro.
//
// Usage: node scripts/extract-tocfl8000.js
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const SHEETS = {
  A1: '入門級(Level 1)',
  A2: '基礎級(Level 2)',
  B1: '進階級(Level 3)',
}

const TONE3_BREVE_TO_CARON = {
  ă: 'ǎ', Ă: 'Ǎ',
  ĭ: 'ǐ', Ĭ: 'Ǐ',
  ŏ: 'ǒ', Ŏ: 'Ǒ',
  ŭ: 'ǔ', Ŭ: 'Ǔ',
}

function normalizePinyin(raw) {
  let s = String(raw || '')
  s = s.replace(/​/g, '') // zero-width space garbage in source
  for (const [from, to] of Object.entries(TONE3_BREVE_TO_CARON)) {
    s = s.split(from).join(to)
  }
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function main() {
  const wb = XLSX.readFile(path.join(__dirname, '..', '華語八千詞表20240923.xlsx'))
  const out = []

  for (const [level, sheetName] of Object.entries(SHEETS)) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).slice(1)
    const hasContext = rows[0] && rows[0].length === 4

    rows.forEach((r, i) => {
      const context = hasContext ? String(r[0] || '').trim() : null
      const hanziIdx = hasContext ? 1 : 0
      const pinyinIdx = hasContext ? 2 : 1
      const posIdx = hasContext ? 3 : 2

      const hanzi = String(r[hanziIdx] || '').trim()
      const pinyin = normalizePinyin(r[pinyinIdx])
      const pos = String(r[posIdx] || '').trim() || null

      if (!hanzi || !pinyin) return

      out.push({ level, context, hanzi, pinyin, pos, order_index: i })
    })
  }

  const outPath = path.join(__dirname, 'output', 'tocfl8000-raw.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('Wrote', outPath, '-', out.length, 'words')
  const counts = {}
  for (const w of out) counts[w.level] = (counts[w.level] || 0) + 1
  console.log(counts)
}

main()
