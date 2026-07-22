// One-off backfill: fills in example_hanzi/example_pinyin/example_vietnamese for
// dictionary_words rows at level='B2' that are still missing an example (~1972 rows as
// of this session — Band B import (migration 0011) deliberately left example_* NULL).
// Source is monchinese.me's per-word dictionary page (/dictionary/<hanzi>), the same
// technique scripts/scrape-monchinese-words.js already uses for topic_vocabulary — a
// single-word lookup is NOT subject to the 120-result cap that /dictionary?level=X
// listing pages have (confirmed by testing: that listing endpoint always returns
// exactly 120 results regardless of level/query params, so it can't serve as a word
// list source — but a direct per-word page is an exact lookup, not a capped listing).
//
// Usage:
//   node scripts/backfill-b2-examples.js fetch   - queries DB for missing rows, scrapes
//                                                   monchinese, writes scripts/output/
//                                                   b2-examples-found.json (+ ...-missing.json
//                                                   for words with no page there)
//   node scripts/backfill-b2-examples.js sql      - turns b2-examples-found.json into
//                                                   scripts/output/b2-examples-backfill.sql
//   (no arg)                                       - runs both steps
//
// Apply the result with:
//   npx prisma db execute --file scripts/output/b2-examples-backfill.sql
require('dotenv/config')
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
const { pinyin } = require('pinyin-pro')

const OUT_DIR = path.join(__dirname, 'output')
const FOUND_FILE = path.join(OUT_DIR, 'b2-examples-found.json')
const MISSING_FILE = path.join(OUT_DIR, 'b2-examples-missing.json')
const SQL_FILE = path.join(OUT_DIR, 'b2-examples-backfill.sql')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Same polyphone workaround as build-topic-vocab-seed.js (kept as a second copy per
// KNOWLEDGE.md's established pattern for this one-off-script technique).
const POLYPHONE_FIXES = { '們': 'men', '麼': 'me', '車': 'chē', '還': 'hái', '乾': 'gān' }

function generatePinyin(hanzi) {
  if (!hanzi) return null
  const chars = [...hanzi]
  const syllables = pinyin(hanzi, { type: 'array' })
  if (syllables.length !== chars.length) return pinyin(hanzi)
  const fixed = chars.map((ch, i) => POLYPHONE_FIXES[ch] || syllables[i])
  return fixed.join(' ')
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

async function fetchMissingRows() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query(
      `SELECT id, hanzi FROM public.dictionary_words WHERE level = 'B2' AND example_hanzi IS NULL ORDER BY order_index`
    )
    return res.rows
  } finally {
    await client.end()
  }
}

async function runFetch() {
  const rows = await fetchMissingRows()
  console.log(`${rows.length} B2 words missing an example`)

  const found = []
  const missing = []
  let done = 0
  for (const row of rows) {
    done++
    if (done % 50 === 0 || done === rows.length) console.log(`[${done}/${rows.length}]`)
    try {
      const html = await fetchHtml(`https://monchinese.me/dictionary/${encodeURIComponent(row.hanzi)}`)
      const ex = html ? parseExamplePage(html) : null
      if (ex) {
        found.push({ id: row.id, hanzi: row.hanzi, ...ex })
      } else {
        missing.push({ id: row.id, hanzi: row.hanzi })
      }
    } catch (err) {
      console.log(`FAILED ${row.hanzi}: ${err.message}`)
      missing.push({ id: row.id, hanzi: row.hanzi })
    }
    await sleep(200)
  }

  fs.writeFileSync(FOUND_FILE, JSON.stringify(found, null, 2), 'utf-8')
  fs.writeFileSync(MISSING_FILE, JSON.stringify(missing, null, 2), 'utf-8')
  console.log(`\nFound examples for ${found.length}/${rows.length}. Wrote ${FOUND_FILE} and ${MISSING_FILE}`)
}

function escapeSql(s) {
  return String(s).replace(/'/g, "''")
}

function runSql() {
  const found = JSON.parse(fs.readFileSync(FOUND_FILE, 'utf-8'))
  const lines = found.map((w) => {
    const examplePinyin = generatePinyin(w.exampleHanzi)
    return `UPDATE public.dictionary_words SET example_hanzi = '${escapeSql(w.exampleHanzi)}', example_pinyin = '${escapeSql(examplePinyin)}', example_vietnamese = '${escapeSql(w.exampleVietnamese)}' WHERE id = '${w.id}';`
  })
  fs.writeFileSync(SQL_FILE, lines.join('\n') + '\n', 'utf-8')
  console.log(`Wrote ${SQL_FILE} (${lines.length} updates)`)
}

async function main() {
  const mode = process.argv[2]
  if (!mode || mode === 'fetch') await runFetch()
  if (!mode || mode === 'sql') runSql()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
