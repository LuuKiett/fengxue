// Dumps { hanzi, pinyin } for every row in public.textbook_vocab_words to
// scripts/output/own-textbook-vocab-words.json, which build-dictionary-index.js merges
// into public/tocfl-index.json at top priority (same pattern as dump-own-dictionary.js
// for dictionary_words — see KNOWLEDGE.md). Re-run this (then build-dictionary-index.js)
// whenever textbook_vocab_words content changes (a new book/lesson scraped) so the
// /textbook "Điền Từ" pinyin composer keeps suggesting every word actually in the
// textbook, including multi-variant entries like "台灣/臺灣" or "這/這裡/這裏/這兒" whose
// literal slash-joined hanzi string is the exercise's actual grading target and can
// never be typed/composed character-by-character (the "/" isn't reachable via pinyin
// lookup or hanzi IME input) — only a dedicated index entry for the exact combined
// string, selectable as one suggestion, lets those rows ever grade correctly.
//
// Usage: node scripts/dump-textbook-vocab.js
require('dotenv/config')
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query('SELECT DISTINCT hanzi, pinyin FROM public.textbook_vocab_words')
    const outPath = path.join(__dirname, 'output/own-textbook-vocab-words.json')
    fs.writeFileSync(outPath, JSON.stringify(res.rows))
    console.log('Wrote', outPath, '-', res.rows.length, 'words')
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
