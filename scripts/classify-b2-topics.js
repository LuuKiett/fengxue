// Classifies existing B2 dictionary_words into the same topic taxonomy scraped from
// monchinese.me (see scrape-monchinese-words.js), since monchinese has no B2-labeled
// vocabulary collections to source from directly (user's explicit choice: auto-classify
// our own B2 words by keyword instead of leaving B2 empty or borrowing their N1 tier).
// Best-effort, not perfectly accurate — priority-ordered keyword matching on the
// Vietnamese gloss, with POS used first to catch grammatical/function words.
//
// Usage: node scripts/classify-b2-topics.js
require('dotenv/config')
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

// Function-word POS tags (matches monchinese's "Từ chức năng & Hư từ" bucket, which is a
// grammatical category, not a content topic — checked before any keyword matching).
const FUNCTION_WORD_POS = new Set(['Conj', 'Prep', 'Det', 'Ptc', 'Vaux'])

// Ordered narrow-to-broad: first matching topic wins, so more specific domains
// (health, law, personality, food) are checked before broader catch-alls
// (work-finance, home-living, communication) that would otherwise over-match.
const TOPIC_KEYWORDS = [
  ['health', ['bệnh', 'ốm', 'đau', 'thuốc', 'bác sĩ', 'bệnh viện', 'khám', 'sức khỏe', 'chữa', 'điều trị', 'triệu chứng', 'phẫu thuật', 'tiêm', 'y tế', 'dược', 'nha khoa', 'cấp cứu', 'virus', 'vi khuẩn', 'dị ứng']],
  ['law', ['pháp luật', 'luật', 'quy định', 'chính phủ', 'hành chính', 'giấy tờ', 'thủ tục', 'cảnh sát', 'tòa án', 'quyền lợi', 'nghĩa vụ', 'vi phạm', 'phạt', 'chứng minh thư', 'hộ khẩu', 'đăng ký', 'pháp lý', 'luật sư', 'kiện', 'án']],
  ['personality', ['tính cách', 'tính khí', 'tư duy', 'thông minh', 'chăm chỉ', 'lười biếng', 'tốt bụng', 'ích kỷ', 'tự tin', 'khiêm tốn', 'cẩn thận', 'cẩu thả', 'kiên nhẫn', 'nóng tính', 'hiền lành', 'thật thà', 'trung thực', 'quan điểm', 'tính tình', 'cá tính', 'nhân cách']],
  ['food', ['rau', 'củ', 'trái cây', 'hoa quả', 'thịt', 'cá', 'trứng', 'gạo', 'gia vị', 'nguyên liệu', 'thực phẩm', 'đồ ăn sống', 'ngũ cốc', 'sữa', 'bột']],
  ['restaurant', ['ăn', 'uống', 'nhà hàng', 'quán ăn', 'món ăn', 'thực đơn', 'gọi món', 'phục vụ bàn', 'đói', 'no bụng', 'ngon', 'nấu ăn', 'chế biến', 'đầu bếp', 'nhà bếp', 'bữa ăn', 'khẩu vị', 'nêm']],
  ['shopping', ['mua', 'bán', 'cửa hàng', 'siêu thị', 'giá cả', 'quần áo', 'giày dép', 'trang phục', 'mặc đồ', 'giảm giá', 'hóa đơn', 'thanh toán', 'kích cỡ', 'chợ', 'khuyến mãi', 'thương hiệu']],
  ['travel', ['du lịch', 'chuyến đi', 'máy bay', 'sân bay', 'nhà ga', 'vé xe', 'giao thông', 'taxi', 'xe buýt', 'xe máy', 'ô tô', 'bản đồ', 'khách sạn', 'hộ chiếu', 'hành lý', 'lái xe', 'tàu hỏa', 'visa', 'hướng dẫn viên', 'hành trình']],
  ['entertainment', ['phim', 'âm nhạc', 'ca hát', 'trò chơi', 'giải trí', 'nghệ thuật', 'văn hóa', 'lễ hội', 'thể thao', 'bóng đá', 'ca sĩ', 'diễn viên', 'sân khấu', 'biểu diễn', 'tiểu thuyết', 'truyện tranh', 'âm nhạc', 'triển lãm', 'bảo tàng']],
  ['relationships', ['yêu', 'bạn bè', 'gia đình', 'bố mẹ', 'con cái', 'vợ chồng', 'họ hàng', 'kết hôn', 'ly hôn', 'tình yêu', 'tình bạn', 'quan hệ', 'cảm xúc', 'nhớ nhung', 'giận dỗi', 'hạnh phúc', 'người yêu', 'gia đình']],
  ['school', ['học', 'trường', 'lớp học', 'giáo viên', 'học sinh', 'sinh viên', 'bài tập', 'kỳ thi', 'kiểm tra', 'sách vở', 'giáo dục', 'đại học', 'tốt nghiệp', 'môn học', 'giáo trình', 'bài giảng', 'điểm số', 'học kỳ', 'nghiên cứu', 'luận văn']],
  ['work-finance', ['công việc', 'làm việc', 'công ty', 'lương', 'ngân hàng', 'tài chính', 'kinh doanh', 'đầu tư', 'thuế', 'hợp đồng', 'nhân viên', 'sếp', 'chức vụ', 'nghề nghiệp', 'kiếm tiền', 'chi tiêu', 'tiết kiệm', 'nợ', 'vay', 'cổ phiếu', 'doanh nghiệp', 'tuyển dụng']],
  ['home-living', ['nhà cửa', 'phòng', 'cửa', 'giường', 'bàn ghế', 'tủ', 'bếp', 'sân vườn', 'dọn dẹp', 'sạch sẽ', 'rác', 'điện nước', 'thuê nhà', 'chung cư', 'căn hộ', 'hàng xóm', 'sửa chữa', 'đồ nội thất', 'chăn gối', 'giặt giũ', 'nội thất']],
  ['communication', ['nói', 'gọi điện', 'điện thoại', 'tin nhắn', 'giao tiếp', 'trò chuyện', 'thông báo', 'thông tin', 'ngôn ngữ', 'diễn đạt', 'phát biểu', 'thảo luận', 'tranh luận', 'giải thích', 'truyền thông', 'mạng xã hội', 'liên lạc']],
]

function classify(word) {
  if (FUNCTION_WORD_POS.has(word.pos)) return 'function-words'
  const meaning = (word.vietnamese || '').toLowerCase()
  for (const [topicKey, keywords] of TOPIC_KEYWORDS) {
    if (keywords.some((kw) => meaning.includes(kw))) return topicKey
  }
  return 'other'
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query(
      `SELECT id, hanzi, pinyin, vietnamese, pos, example_hanzi, example_pinyin, example_vietnamese
       FROM dictionary_words WHERE level = 'B2'`
    )

    const buckets = {}
    for (const row of res.rows) {
      const topicKey = classify(row)
      if (!buckets[topicKey]) buckets[topicKey] = []
      buckets[topicKey].push({
        hanzi: row.hanzi,
        hanziVariant: null,
        pinyin: row.pinyin,
        vietnamese: row.vietnamese,
        pos: row.pos,
        exampleHanzi: row.example_hanzi,
        examplePinyin: row.example_pinyin,
        exampleVietnamese: row.example_vietnamese,
        dictionaryWordId: row.id,
      })
    }

    const summary = Object.entries(buckets)
      .map(([k, v]) => `${k}: ${v.length}`)
      .join('\n')
    console.log(`Classified ${res.rows.length} B2 words:\n${summary}`)

    const outPath = path.join(__dirname, 'output/b2-topic-words.json')
    fs.writeFileSync(outPath, JSON.stringify(buckets, null, 2), 'utf-8')
    console.log(`\nWrote ${outPath}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
