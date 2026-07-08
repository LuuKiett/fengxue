// Converts the hand-authored scripts/comprehension-content.json (short reading
// passages and two-speaker listening dialogues for the practice-exam feature) into
// INSERT SQL for comprehension_passages / comprehension_questions. Pinyin is
// auto-generated via pinyin-pro, same helper as scripts/generate-dictionary-examples.js.
// Output is a plain SQL file — run it manually in the Supabase SQL editor, this
// script never touches the DB directly.
//
// Usage: node scripts/build-comprehension-seed.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { pinyin } = require('pinyin-pro')

const inputPath = path.join(__dirname, 'comprehension-content.json')
const OUTPUT_DIR = path.join(__dirname, 'output')
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function cleanPinyin(sentence) {
  return pinyin(sentence, { toneType: 'symbol', type: 'string', separator: ' ' })
    .replace(/\s+([。？！，」])/g, '$1')
    .replace(/([「])\s+/g, '$1')
    .replace(/\n\s*/g, '\n')
}

const escapeSql = (s) => s.replace(/'/g, "''")
const sqlArray = (arr) => `ARRAY[${arr.map((s) => `'${escapeSql(s)}'`).join(', ')}]`

function main() {
  const passages = JSON.parse(fs.readFileSync(inputPath, 'utf-8'))
  const statements = []

  for (const p of passages) {
    const passageId = crypto.randomUUID()
    const passagePinyin = cleanPinyin(p.hanzi)

    statements.push(
      `INSERT INTO public.comprehension_passages (id, level, mode, passage_hanzi, passage_pinyin, passage_vietnamese) VALUES ` +
        `('${passageId}', '${escapeSql(p.level)}', '${escapeSql(p.mode)}', '${escapeSql(p.hanzi)}', '${escapeSql(passagePinyin)}', '${escapeSql(p.vietnamese)}');`
    )

    p.questions.forEach((q, i) => {
      statements.push(
        `INSERT INTO public.comprehension_questions (passage_id, order_index, question_hanzi, options, correct_index) VALUES ` +
          `('${passageId}', ${i}, '${escapeSql(q.hanzi)}', ${sqlArray(q.options)}, ${q.correctIndex});`
      )
    })
  }

  const outPath = path.join(OUTPUT_DIR, 'comprehension-seed.sql')
  fs.writeFileSync(outPath, statements.join('\n'))
  console.log(`Wrote ${outPath} — ${passages.length} passages, ${statements.length - passages.length} questions`)
}

main()
