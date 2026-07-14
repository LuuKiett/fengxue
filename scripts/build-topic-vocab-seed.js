// Merges monchinese-words.json + monchinese-examples.json (A1/A2/B1) and
// b2-topic-words.json (B2) into scripts/output/topic-vocab-seed.sql, ready for
// `npx prisma db execute --file scripts/output/topic-vocab-seed.sql`.
//
// Usage: node scripts/build-topic-vocab-seed.js
const fs = require('fs')
const path = require('path')
const { pinyin } = require('pinyin-pro')

const OUT_DIR = path.join(__dirname, 'output')

const escapeSql = (s) => String(s).replace(/'/g, "''")
const sqlStr = (s) => (s === null || s === undefined || s === '' ? 'NULL' : `'${escapeSql(s)}'`)

// pinyin-pro mis-reads these polyphones regardless of context (們/麼/車/還 documented in
// KNOWLEDGE.md from Band A example generation; 乾 newly confirmed this session — it
// defaults to the rare "qián" trigram/surname reading instead of "gān" (dry), which is
// virtually always the intended reading in everyday TOCFL vocabulary like 乾淨/餅乾).
const POLYPHONE_FIXES = { '們': 'men', '麼': 'me', '車': 'chē', '還': 'hái', '乾': 'gān' }

function generatePinyin(hanzi) {
  if (!hanzi) return null
  const chars = [...hanzi]
  const syllables = pinyin(hanzi, { type: 'array' })
  // pinyin-pro's array mode returns one entry per "word" it segments, which isn't always
  // one entry per character for punctuation-free text — but for our short example
  // sentences (which do include punctuation) it lines up 1:1 in practice. Fall back to
  // the raw joined string if lengths ever mismatch, rather than mis-aligning fixes.
  if (syllables.length !== chars.length) return pinyin(hanzi)
  const fixed = chars.map((ch, i) => POLYPHONE_FIXES[ch] || syllables[i])
  return fixed.join(' ')
}

const TOPIC_META_OTHER = { icon: '✨', label: 'Khác' }

function main() {
  const monchineseGroups = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'monchinese-words.json'), 'utf-8'))
  const examples = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'monchinese-examples.json'), 'utf-8'))
  const b2Buckets = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'b2-topic-words.json'), 'utf-8'))
  const { topics: topicMeta } = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'monchinese-slugs.json'), 'utf-8'))

  const rows = []

  // A1/A2/B1 from monchinese
  for (const group of monchineseGroups) {
    group.words.forEach((w, idx) => {
      const ex = examples[w.hanzi]
      rows.push({
        level: group.level,
        topicKey: group.topicKey,
        topicLabel: group.label,
        topicIcon: group.icon,
        hanzi: w.hanzi,
        hanziVariant: w.hanziVariant,
        pinyin: w.pinyin,
        vietnamese: w.vietnamese,
        pos: w.pos,
        exampleHanzi: ex ? ex.exampleHanzi : null,
        examplePinyin: ex ? generatePinyin(ex.exampleHanzi) : null,
        exampleVietnamese: ex ? ex.exampleVietnamese : null,
        source: 'monchinese',
        orderIndex: idx,
      })
    })
  }

  // B2 from our own dictionary_words, auto-classified
  for (const [topicKey, words] of Object.entries(b2Buckets)) {
    const meta = topicMeta[topicKey] || TOPIC_META_OTHER
    words.forEach((w, idx) => {
      rows.push({
        level: 'B2',
        topicKey,
        topicLabel: meta.label,
        topicIcon: meta.icon,
        hanzi: w.hanzi,
        hanziVariant: w.hanziVariant,
        pinyin: w.pinyin,
        vietnamese: w.vietnamese,
        pos: w.pos,
        exampleHanzi: w.exampleHanzi,
        examplePinyin: w.examplePinyin,
        exampleVietnamese: w.exampleVietnamese,
        source: 'dictionary_words',
        orderIndex: idx,
      })
    })
  }

  const lines = rows.map((r) => (
    `INSERT INTO public.topic_vocabulary ` +
    `(level, topic_key, topic_label, topic_icon, hanzi, hanzi_variant, pinyin, vietnamese, pos, example_hanzi, example_pinyin, example_vietnamese, source, order_index) VALUES (` +
    `${sqlStr(r.level)}, ${sqlStr(r.topicKey)}, ${sqlStr(r.topicLabel)}, ${sqlStr(r.topicIcon)}, ${sqlStr(r.hanzi)}, ${sqlStr(r.hanziVariant)}, ${sqlStr(r.pinyin)}, ${sqlStr(r.vietnamese)}, ${sqlStr(r.pos)}, ${sqlStr(r.exampleHanzi)}, ${sqlStr(r.examplePinyin)}, ${sqlStr(r.exampleVietnamese)}, ${sqlStr(r.source)}, ${r.orderIndex}` +
    `) ON CONFLICT (level, topic_key, hanzi, pinyin) DO UPDATE SET ` +
    `topic_label = EXCLUDED.topic_label, topic_icon = EXCLUDED.topic_icon, vietnamese = EXCLUDED.vietnamese, pos = EXCLUDED.pos, ` +
    `example_hanzi = EXCLUDED.example_hanzi, example_pinyin = EXCLUDED.example_pinyin, example_vietnamese = EXCLUDED.example_vietnamese, order_index = EXCLUDED.order_index;`
  ))

  const outPath = path.join(OUT_DIR, 'topic-vocab-seed.sql')
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8')
  console.log(`Wrote ${outPath} — ${rows.length} rows`)
}

main()
