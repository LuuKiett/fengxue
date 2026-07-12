// Dumps { hanzi, pinyin } for every row in public.dictionary_words to
// scripts/output/own-dictionary-words.json, which build-dictionary-index.js merges
// into public/tocfl-index.json at top priority. Re-run this (then
// build-dictionary-index.js) whenever dictionary_words content changes materially
// (e.g. a new band is imported) so the /vocabulary and /review-dictionary "Điền Từ"
// pinyin composers keep suggesting every word actually in this app's own dictionary.
//
// Usage: node scripts/dump-own-dictionary.js
require('dotenv/config')
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query('SELECT hanzi, pinyin FROM public.dictionary_words')
    const outPath = path.join(__dirname, 'output/own-dictionary-words.json')
    fs.writeFileSync(outPath, JSON.stringify(res.rows))
    console.log('Wrote', outPath, '-', res.rows.length, 'words')
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
