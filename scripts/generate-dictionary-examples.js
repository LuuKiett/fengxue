// Generates a simple, correct A1/A2-level example sentence for every word already
// parsed by scripts/import-dictionary-pdf.js (reads scripts/output/<name>.sql back in,
// rather than needing a live DB connection). Self-authored templates, not scraped —
// see the plan notes for why. Outputs UPDATE statements to set example_hanzi/
// example_pinyin/example_vietnamese on the matching dictionary_words row.
//
// Usage: node scripts/generate-dictionary-examples.js scripts/output/band-a.sql
const fs = require('fs')
const path = require('path')
const { pinyin } = require('pinyin-pro')

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Usage: node scripts/generate-dictionary-examples.js <path-to-seed.sql>')
  process.exit(1)
}

const OUTPUT_DIR = path.join(__dirname, 'output')
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

// Hand-curated natural sentences for common words — used verbatim when available,
// falling back to templates below for everything else. Mirrors app/api/examples/route.ts.
const CURATED = {
  '你好': { h: '你好！很高興認識你。', v: 'Xin chào! Rất vui được gặp bạn.' },
  '謝謝': { h: '謝謝你的幫助！', v: 'Cảm ơn bạn đã giúp đỡ!' },
  '再見': { h: '再見！明天見！', v: 'Tạm biệt! Ngày mai gặp lại!' },
  '對不起': { h: '對不起，我來晚了。', v: 'Xin lỗi, tôi đến trễ.' },
  '我': { h: '我是越南人，我在學中文。', v: 'Tôi là người Việt Nam, tôi đang học tiếng Trung.' },
  '你': { h: '你今天去哪裡？', v: 'Hôm nay bạn đi đâu?' },
  '他': { h: '他是我的老師，他很厲害。', v: 'Anh ấy là thầy giáo của tôi, anh ấy rất giỏi.' },
  '她': { h: '她是我的好朋友。', v: 'Cô ấy là bạn tốt của tôi.' },
  '我們': { h: '我們一起去學校。', v: 'Chúng tôi cùng nhau đến trường.' },
  '吃': { h: '我每天早上吃麵包和喝牛奶。', v: 'Mỗi buổi sáng tôi ăn bánh mì và uống sữa.' },
  '喝': { h: '天氣很熱，我想喝水。', v: 'Thời tiết rất nóng, tôi muốn uống nước.' },
  '學習': { h: '我每天學習兩個小時的中文。', v: 'Tôi học tiếng Trung hai tiếng đồng hồ mỗi ngày.' },
  '工作': { h: '她在一家大公司工作。', v: 'Cô ấy làm việc ở một công ty lớn.' },
  '喜歡': { h: '我喜歡看電影和聽音樂。', v: 'Tôi thích xem phim và nghe nhạc.' },
  '學校': { h: '我的學校離家很近。', v: 'Trường học của tôi gần nhà lắm.' },
  '家': { h: '我的家在河內市中心。', v: 'Nhà tôi ở trung tâm thành phố Hà Nội.' },
  '書': { h: '這本書很有意思，我看了三遍。', v: 'Cuốn sách này rất thú vị, tôi đọc ba lần.' },
  '媽媽': { h: '我媽媽做的菜很好吃。', v: 'Món ăn mẹ tôi nấu rất ngon.' },
  '爸爸': { h: '我爸爸是一名醫生。', v: 'Bố tôi là một bác sĩ.' },
  '朋友': { h: '她是我最好的朋友，我們認識十年了。', v: 'Cô ấy là người bạn thân nhất của tôi, chúng tôi quen nhau mười năm rồi.' },
  '老師': { h: '我的中文老師是台灣人。', v: 'Thầy giáo tiếng Trung của tôi là người Đài Loan.' },
  '學生': { h: '他是一個非常用功的學生。', v: 'Anh ấy là một học sinh rất chăm chỉ.' },
  '天氣': { h: '今天的天氣真不錯，陽光明媚。', v: 'Thời tiết hôm nay thật tốt, nắng đẹp.' },
  '今天': { h: '今天天氣很好，我們去公園吧。', v: 'Hôm nay thời tiết rất đẹp, chúng ta đi công viên nhé.' },
  '明天': { h: '明天有考試，我要好好復習。', v: 'Ngày mai có thi, tôi phải ôn bài thật kỹ.' },
  '好': { h: '這個電影真的很好看。', v: 'Bộ phim này thực sự rất hay.' },
  '大': { h: '上海是中國最大的城市之一。', v: 'Thượng Hải là một trong những thành phố lớn nhất Trung Quốc.' },
}

// Templates by POS tag. {w} = the word itself, {m} = its Vietnamese meaning.
// Multiple variants per POS keep things from feeling identical word-to-word.
const TEMPLATES = {
  N: [
    { h: '這是{w}。', v: 'Đây là {m}.' },
    { h: '我有一個{w}。', v: 'Tôi có một {m}.' },
    { h: '你喜歡{w}嗎？', v: 'Bạn có thích {m} không?' },
  ],
  VA: [
    { h: '我每天{w}。', v: 'Tôi {m} mỗi ngày.' },
    { h: '你想{w}嗎？', v: 'Bạn có muốn {m} không?' },
    { h: '他現在要{w}。', v: 'Anh ấy bây giờ muốn {m}.' },
  ],
  VS: [
    { h: '今天很{w}。', v: 'Hôm nay rất {m}.' },
    { h: '這個很{w}。', v: 'Cái này rất {m}.' },
    { h: '我覺得很{w}。', v: 'Tôi thấy rất {m}.' },
  ],
  Adv: [
    { h: '他{w}來學校。', v: 'Anh ấy {m} đến trường.' },
    { h: '我{w}都很忙。', v: 'Tôi {m} đều rất bận.' },
  ],
  DEFAULT: [
    { h: '我在學習「{w}」這個詞。', v: 'Tôi đang học từ "{m}".' },
    { h: '請用「{w}」造句。', v: 'Hãy đặt câu với "{m}".' },
    { h: '「{w}」是很常用的詞。', v: '"{m}" là từ rất thường dùng.' },
  ],
}

function cleanPinyin(sentence) {
  return pinyin(sentence, { toneType: 'symbol', type: 'string', separator: ' ' })
    .replace(/\s+([。？！，」])/g, '$1')
    .replace(/([「])\s+/g, '$1')
}

function buildExample(word, index) {
  const curated = CURATED[word.hanzi]
  if (curated) {
    return { hanzi: curated.h, pinyin: cleanPinyin(curated.h), vietnamese: curated.v }
  }

  const pos = (word.pos || '').replace(/[^A-Za-z]/g, '')
  const variants = TEMPLATES[pos] || TEMPLATES.DEFAULT
  const template = variants[index % variants.length]

  const hanzi = template.h.replace('{w}', word.hanzi)
  const vietnamese = template.v.replace('{m}', word.vietnamese || word.hanzi)

  return { hanzi, pinyin: cleanPinyin(hanzi), vietnamese }
}

function parseSeedSql(sql) {
  // Matches each ('band', 'level', 'hanzi', 'pinyin', 'vietnamese', pos-or-NULL, order) tuple
  const rowRe = /\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*(NULL|'((?:[^'\\]|\\.)*)')\s*,\s*(\d+)\s*\)/g
  const unescape = (s) => s.replace(/''/g, "'")
  const words = []
  let m
  while ((m = rowRe.exec(sql))) {
    words.push({
      band: unescape(m[1]),
      level: unescape(m[2]),
      hanzi: unescape(m[3]),
      pinyin: unescape(m[4]),
      vietnamese: unescape(m[5]),
      pos: m[6] === 'NULL' ? null : unescape(m[7]),
      orderIndex: parseInt(m[8], 10),
    })
  }
  return words
}

function main() {
  const sql = fs.readFileSync(inputPath, 'utf-8')
  const words = parseSeedSql(sql)
  console.log(`Parsed ${words.length} words from ${inputPath}`)

  const escapeSql = (s) => s.replace(/'/g, "''")
  const statements = words.map((word, i) => {
    const example = buildExample(word, i)
    return `UPDATE public.dictionary_words SET example_hanzi = '${escapeSql(example.hanzi)}', example_pinyin = '${escapeSql(example.pinyin)}', example_vietnamese = '${escapeSql(example.vietnamese)}' WHERE level = '${escapeSql(word.level)}' AND hanzi = '${escapeSql(word.hanzi)}' AND pinyin = '${escapeSql(word.pinyin)}' AND vietnamese = '${escapeSql(word.vietnamese)}';`
  })

  const outName = path.basename(inputPath, '.sql') + '-examples.sql'
  const outPath = path.join(OUTPUT_DIR, outName)
  fs.writeFileSync(outPath, statements.join('\n'))
  console.log('Wrote', outPath)

  // Print a few samples for a quick sanity check
  console.log('\nSample generated examples:')
  for (const i of [0, 10, 100, 300, 600]) {
    if (!words[i]) continue
    const ex = buildExample(words[i], i)
    console.log(`  ${words[i].hanzi} (${words[i].pos || '?'}) -> ${ex.hanzi} | ${ex.pinyin} | ${ex.vietnamese}`)
  }
}

main()
