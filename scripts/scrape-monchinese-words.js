// One-off scraper: pulls A1/A2/B1 vocabulary-by-topic word lists (+ best-effort example
// sentences) from monchinese.me, per explicit user request to source the new "Học từ vựng
// theo chủ đề" feature's A1/A2/B1 content from their site instead of our own dictionary_words.
// Output is JSON under scripts/output/ — never touches the live DB directly.
//
// Usage: node scripts/scrape-monchinese-words.js [words|examples]
//   words    - fetch the 60 /learn/<slug> collection pages, write monchinese-words.json
//   examples - fetch /dictionary/<hanzi> for every unique word from monchinese-words.json,
//              write monchinese-examples.json (hanzi -> {example_hanzi, example_vietnamese})
//   (no arg) - runs both steps in sequence

const fs = require('fs')
const path = require('path')

const OUT_DIR = path.join(__dirname, 'output')
const SLUGS_FILE = path.join(OUT_DIR, 'monchinese-slugs.json')
const WORDS_FILE = path.join(OUT_DIR, 'monchinese-words.json')
const EXAMPLES_FILE = path.join(OUT_DIR, 'monchinese-examples.json')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      if (i === retries - 1) throw err
      await sleep(1000 * (i + 1))
    }
  }
}

function parseWordListPage(html) {
  const words = []
  const liRegex = /<li><details[^>]*>[\s\S]*?<\/details><\/li>/g
  const liBlocks = html.match(liRegex) || []

  for (const li of liBlocks) {
    const hanziMatches = [...li.matchAll(/<div class="hanzi[^"]*">([^<]+)<\/div>/g)]
    if (hanziMatches.length === 0) continue
    const hanzi = decodeEntities(hanziMatches[0][1])
    const hanziVariant = hanziMatches.length > 1 ? decodeEntities(hanziMatches[1][1]) : null

    const pinyinMatch = li.match(/<div class="pinyin[^"]*">([^<]+)<\/div>/)
    const pinyin = pinyinMatch ? decodeEntities(pinyinMatch[1]) : ''

    const meaningMatch = li.match(/<div class="mt-4 border-t border-border pt-4"><div class="text-base text-foreground\/90 md:text-lg">([^<]+)<\/div>/)
    const vietnamese = meaningMatch ? decodeEntities(meaningMatch[1]) : ''

    const posMatch = li.match(/<span class="rounded bg-muted px-1\.5 py-0\.5 font-mono text-\[10px\] uppercase tracking-wide text-muted-foreground">([^<]+)<\/span>/)
    const pos = posMatch ? decodeEntities(posMatch[1]) : null

    const hrefMatch = li.match(/href="(\/dictionary\/[^"]+)"/)
    const dictHref = hrefMatch ? hrefMatch[1] : null

    if (!hanzi || !vietnamese) continue // skip anything we couldn't parse cleanly

    words.push({ hanzi, hanziVariant, pinyin, vietnamese, pos, dictHref })
  }
  return words
}

async function scrapeWords() {
  const { entries, topics } = JSON.parse(fs.readFileSync(SLUGS_FILE, 'utf-8'))

  // groupKey -> { level, topicKey, icon, label, words: [] }
  const groups = {}
  let done = 0

  for (const entry of entries) {
    const url = `https://monchinese.me/learn/${entry.slug}`
    process.stdout.write(`[${++done}/${entries.length}] ${entry.slug} ... `)
    try {
      const html = await fetchHtml(url)
      const words = parseWordListPage(html)
      const key = `${entry.level}|${entry.topic_key}`
      if (!groups[key]) {
        groups[key] = {
          level: entry.level,
          topicKey: entry.topic_key,
          icon: topics[entry.topic_key]?.icon || '📖',
          label: topics[entry.topic_key]?.label || entry.topic_key,
          words: [],
        }
      }
      groups[key].words.push(...words)
      console.log(`${words.length} words`)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
    }
    await sleep(250)
  }

  // Dedup words within each group by hanzi
  for (const key of Object.keys(groups)) {
    const seen = new Set()
    groups[key].words = groups[key].words.filter((w) => {
      if (seen.has(w.hanzi)) return false
      seen.add(w.hanzi)
      return true
    })
  }

  fs.writeFileSync(WORDS_FILE, JSON.stringify(Object.values(groups), null, 2), 'utf-8')
  console.log(`\nWrote ${WORDS_FILE}`)
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

async function scrapeExamples() {
  const groups = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf-8'))
  const uniqueByHref = new Map()
  for (const g of groups) {
    for (const w of g.words) {
      if (w.dictHref && !uniqueByHref.has(w.dictHref)) {
        uniqueByHref.set(w.dictHref, w.hanzi)
      }
    }
  }

  const examples = {}
  let done = 0
  const total = uniqueByHref.size
  for (const [href, hanzi] of uniqueByHref) {
    done++
    if (done % 25 === 0 || done === total) {
      console.log(`[${done}/${total}] examples...`)
    }
    try {
      const html = await fetchHtml(`https://monchinese.me${href}`)
      const ex = parseExamplePage(html)
      if (ex) examples[hanzi] = ex
    } catch (err) {
      console.log(`FAILED ${hanzi}: ${err.message}`)
    }
    await sleep(200)
  }

  fs.writeFileSync(EXAMPLES_FILE, JSON.stringify(examples, null, 2), 'utf-8')
  console.log(`\nWrote ${EXAMPLES_FILE} (${Object.keys(examples).length}/${total} words got an example)`)
}

async function main() {
  const mode = process.argv[2]
  if (!mode || mode === 'words') await scrapeWords()
  if (!mode || mode === 'examples') await scrapeExamples()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
