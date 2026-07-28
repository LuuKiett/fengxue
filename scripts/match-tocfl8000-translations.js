// Cross-matches scripts/output/tocfl8000-raw.json hanzi against this app's own
// dictionary_words + full_dictionary_words tables (both already carry vetted
// Vietnamese translations - dictionary_words from OTAB19.xlsx band imports,
// full_dictionary_words scraped from monchinese.me) to reuse existing translations
// instead of re-translating from scratch. Writes scripts/output/tocfl8000-matched.json
// with a `vietnamese`/`example_*`/`match_source` field added per word, and leaves
// unmatched words with vietnamese: null for a follow-up pass.
//
// Usage: node scripts/match-tocfl8000-translations.js
require('dotenv/config')
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

function splitVariants(hanzi) {
  // "你/妳" -> ["你","妳"]; "不見(了)" -> ["不見(了)","不見"];
  // "籃(子)" -> ["籃(子)","籃子"] (concatenated - paren here spells out an elided
  // syllable, not a zhuyin annotation); "部分(˙ㄈㄣ)" -> [...,"部分"] (stripped -
  // paren here is a bopomofo neutral-tone gloss, not part of the word).
  const variants = new Set()
  variants.add(hanzi)
  for (const rawPart of hanzi.split('/')) {
    const part = rawPart.trim()
    if (!part) continue
    variants.add(part)
    const stripped = part.replace(/[（(][^）)]*[）)]/g, '').trim()
    if (stripped) variants.add(stripped)
    const concatenated = part.replace(/[（(）)]/g, '').trim()
    if (concatenated) variants.add(concatenated)
  }
  return [...variants]
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'output', 'tocfl8000-raw.json'), 'utf-8'))

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const dictRes = await client.query('SELECT hanzi, vietnamese, example_hanzi, example_pinyin, example_vietnamese FROM public.dictionary_words')
  const fullRes = await client.query('SELECT hanzi, hanzi_variant, vietnamese, example_hanzi, example_pinyin, example_vietnamese FROM public.full_dictionary_words')
  await client.end()

  // Priority: dictionary_words first (this app's own curated band data), then full_dictionary_words.
  const byHanzi = new Map()
  for (const row of fullRes.rows) {
    if (!byHanzi.has(row.hanzi)) byHanzi.set(row.hanzi, row)
    if (row.hanzi_variant && !byHanzi.has(row.hanzi_variant)) byHanzi.set(row.hanzi_variant, row)
  }
  for (const row of dictRes.rows) {
    byHanzi.set(row.hanzi, row) // overwrite - higher priority
  }

  let matched = 0
  const out = raw.map((w) => {
    for (const variant of splitVariants(w.hanzi)) {
      const hit = byHanzi.get(variant)
      if (hit) {
        matched++
        return {
          ...w,
          vietnamese: hit.vietnamese,
          example_hanzi: hit.example_hanzi || null,
          example_pinyin: hit.example_pinyin || null,
          example_vietnamese: hit.example_vietnamese || null,
          match_source: 'local',
        }
      }
    }
    return { ...w, vietnamese: null, example_hanzi: null, example_pinyin: null, example_vietnamese: null, match_source: null }
  })

  const outPath = path.join(__dirname, 'output', 'tocfl8000-matched.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('Wrote', outPath)
  console.log('Matched', matched, '/', raw.length, '(' + ((matched / raw.length) * 100).toFixed(1) + '%)')
  const byLevel = {}
  for (const w of out) {
    byLevel[w.level] = byLevel[w.level] || { total: 0, matched: 0 }
    byLevel[w.level].total++
    if (w.vietnamese) byLevel[w.level].matched++
  }
  console.log(byLevel)
}

main().catch((e) => { console.error(e); process.exit(1) })
