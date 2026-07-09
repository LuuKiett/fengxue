// Converts the hand-authored scripts/tocfl-content/{reading,listening}-N.json files
// (real TOCFL Band A official mock-exam papers, transcribed from the past-paper
// PDFs/audio in "TOCFL PHỒN THỂ/") into INSERT SQL for tocfl_papers /
// tocfl_questions. Output is a plain SQL file — run it manually via
// `npx prisma db execute --file scripts/output/tocfl-seed.sql`, this script never
// touches the DB directly.
//
// Usage: node scripts/build-tocfl-seed.js [paperNumbers...]
//   node scripts/build-tocfl-seed.js          -> all papers found in tocfl-content/
//   node scripts/build-tocfl-seed.js 1 2       -> only papers 1 and 2
const fs = require('fs')
const path = require('path')

const CONTENT_DIR = path.join(__dirname, 'tocfl-content')
const OUTPUT_DIR = path.join(__dirname, 'output')
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const escapeSql = (s) => String(s).replace(/'/g, "''")
const sqlStr = (s) => (s === null || s === undefined ? 'NULL' : `'${escapeSql(s)}'`)
const sqlJson = (obj) => `'${escapeSql(JSON.stringify(obj))}'::jsonb`

function findPapers(explicit) {
  if (explicit.length) return explicit.map(Number)
  const nums = new Set()
  for (const f of fs.readdirSync(CONTENT_DIR)) {
    const m = f.match(/^reading-(\d+)\.json$/)
    if (m) nums.add(Number(m[1]))
  }
  return Array.from(nums).sort((a, b) => a - b)
}

function main() {
  const explicit = process.argv.slice(2)
  const paperNumbers = findPapers(explicit)
  const statements = []
  let totalQuestions = 0

  for (const n of paperNumbers) {
    const readingPath = path.join(CONTENT_DIR, `reading-${n}.json`)
    const listeningPath = path.join(CONTENT_DIR, `listening-${n}.json`)
    if (!fs.existsSync(readingPath) || !fs.existsSync(listeningPath)) {
      console.warn(`Skipping paper ${n}: missing reading-${n}.json or listening-${n}.json`)
      continue
    }
    const reading = JSON.parse(fs.readFileSync(readingPath, 'utf-8'))
    const listening = JSON.parse(fs.readFileSync(listeningPath, 'utf-8'))

    statements.push(
      `INSERT INTO public.tocfl_papers ` +
        `(band, paper_number, title, listening_time_minutes, reading_time_minutes, listening_intro_audio) VALUES (` +
        `${sqlStr(reading.band)}, ${reading.paperNumber}, ${sqlStr(reading.title)}, ` +
        `${reading.listeningTimeMinutes}, ${reading.readingTimeMinutes}, ${sqlJson(reading.listeningIntroAudio || {})}` +
        `) ON CONFLICT (band, paper_number) DO UPDATE SET title = EXCLUDED.title;`
    )

    const allQuestions = [...reading.questions, ...listening.questions]
    for (const q of allQuestions) {
      statements.push(
        `INSERT INTO public.tocfl_questions ` +
          `(paper_id, section, part_number, question_number, question_type, group_key, order_index, ` +
          `prompt_hanzi, prompt_image_path, passage_hanzi, audio_path, options, correct_index) VALUES (` +
          `(SELECT id FROM public.tocfl_papers WHERE band = ${sqlStr(reading.band)} AND paper_number = ${reading.paperNumber}), ` +
          `${sqlStr(q.section)}, ${q.partNumber}, ${q.questionNumber}, ${sqlStr(q.questionType)}, ${sqlStr(q.groupKey)}, ${q.orderIndex}, ` +
          `${sqlStr(q.promptHanzi)}, ${sqlStr(q.promptImagePath)}, ${sqlStr(q.passageHanzi)}, ${sqlStr(q.audioPath)}, ` +
          `${sqlJson(q.options)}, ${q.correctIndex}` +
          `) ON CONFLICT (paper_id, section, question_number) DO UPDATE SET ` +
          `question_type = EXCLUDED.question_type, group_key = EXCLUDED.group_key, order_index = EXCLUDED.order_index, ` +
          `prompt_hanzi = EXCLUDED.prompt_hanzi, prompt_image_path = EXCLUDED.prompt_image_path, ` +
          `passage_hanzi = EXCLUDED.passage_hanzi, audio_path = EXCLUDED.audio_path, ` +
          `options = EXCLUDED.options, correct_index = EXCLUDED.correct_index;`
      )
    }
    totalQuestions += allQuestions.length
    console.log(`Paper ${n}: ${allQuestions.length} questions`)
  }

  const outPath = path.join(OUTPUT_DIR, 'tocfl-seed.sql')
  fs.writeFileSync(outPath, statements.join('\n'))
  console.log(`Wrote ${outPath} — ${paperNumbers.length} papers, ${totalQuestions} questions total`)
}

main()
