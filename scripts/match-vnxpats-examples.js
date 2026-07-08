// Matches our imported dictionary_words (from the traditional-character PDF) against
// example sentences scraped from vnxpats.com's "1000 từ vựng Band A TOCFL" page, then
// regenerates accurate pinyin for each matched example via pinyin-pro and writes the
// final UPDATE SQL. Falls back to the hand-authored batches (scripts/sentences-batch-*.json)
// for any of our 876 words that vnxpats doesn't have a match for.
const fs = require('fs')
const path = require('path')
const { pinyin } = require('pinyin-pro')

const words = JSON.parse(fs.readFileSync(path.join(__dirname, 'output/wordlist.json'), 'utf-8'))
const vnxpats = JSON.parse(fs.readFileSync(path.join(__dirname, 'output/vnxpats-parsed.json'), 'utf-8'))

function stripTones(py) {
  return py.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/̈/g, '').toLowerCase().replace(/[^a-z]/g, '')
}

// Index vnxpats entries by hanzi and by toneless pinyin, preserving duplicates.
const byHanzi = new Map()
const byPinyin = new Map()
for (const e of vnxpats) {
  if (!byHanzi.has(e.hanzi)) byHanzi.set(e.hanzi, [])
  byHanzi.get(e.hanzi).push(e)
  const key = stripTones(e.pinyin)
  if (!byPinyin.has(key)) byPinyin.set(key, [])
  byPinyin.get(key).push(e)
}

const used = new Set() // vnxpats entries already claimed, to avoid reusing the same example twice
function pickBest(candidates, word) {
  const unusedFirst = [...candidates].sort((a, b) => {
    const aUsed = used.has(a), bUsed = used.has(b)
    if (aUsed !== bUsed) return aUsed ? 1 : -1
    if (a.level === word.level && b.level !== word.level) return -1
    if (b.level === word.level && a.level !== word.level) return 1
    return 0
  })
  return unusedFirst[0]
}

function cleanPinyin(sentence) {
  return pinyin(sentence, { toneType: 'symbol', type: 'string', separator: ' ' })
    .replace(/\s+([。？！，」])/g, '$1')
    .replace(/([「])\s+/g, '$1')
}

// Hand-authored fallback for the handful of words vnxpats doesn't have a match for
// (mostly PDF parenthetical-variant entries like 電視(機)/花(兒)/點(兒)) — pulled from
// scripts/sentences-batch-*.json, authored earlier this session.
const fallbackBatches = {}
for (const f of ['sentences-batch-0.json', 'sentences-batch-1.json', 'sentences-batch-2.json', 'sentences-batch-3.json']) {
  const p = path.join(__dirname, f)
  if (fs.existsSync(p)) Object.assign(fallbackBatches, JSON.parse(fs.readFileSync(p, 'utf-8')))
}

const matched = []
const unmatched = []

for (const word of words) {
  let candidates = byHanzi.get(word.hanzi)
  if (!candidates || candidates.length === 0) {
    candidates = byPinyin.get(stripTones(word.pinyin))
  }
  if (candidates && candidates.length > 0) {
    const best = pickBest(candidates, word)
    used.add(best)
    matched.push({ word, source: best })
    continue
  }

  const fallback = fallbackBatches[String(word.idx)]
  if (fallback) {
    matched.push({ word, source: { exHanzi: fallback[0], exTrans: fallback[1] } })
  } else {
    unmatched.push(word)
  }
}

console.log(`Matched ${matched.length}/${words.length} words (vnxpats + hand-authored fallback). Unmatched: ${unmatched.length}`)
fs.writeFileSync(path.join(__dirname, 'output/unmatched.json'), JSON.stringify(unmatched.map((w) => ({ idx: w.idx, level: w.level, hanzi: w.hanzi, pinyin: w.pinyin, vietnamese: w.vietnamese })), null, 2))

const escapeSql = (s) => s.replace(/'/g, "''")
const statements = []
for (const { word, source } of matched) {
  const exampleHanzi = source.exHanzi
  const examplePinyin = cleanPinyin(exampleHanzi)
  const exampleVietnamese = source.exTrans || ''
  statements.push(
    `UPDATE public.dictionary_words SET example_hanzi = '${escapeSql(exampleHanzi)}', example_pinyin = '${escapeSql(examplePinyin)}', example_vietnamese = '${escapeSql(exampleVietnamese)}' WHERE level = '${escapeSql(word.level)}' AND hanzi = '${escapeSql(word.hanzi)}' AND pinyin = '${escapeSql(word.pinyin)}' AND vietnamese = '${escapeSql(word.vietnamese)}';`
  )
}

fs.writeFileSync(path.join(__dirname, 'output/band-a-examples-real.sql'), statements.join('\n'))
console.log('Wrote', path.join(__dirname, 'output/band-a-examples-real.sql'), '-', statements.length, 'statements')
