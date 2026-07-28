// Hand-translates the handful of words that had no match in either local dictionary
// table after scripts/match-tocfl8000-translations.js (checked: genuinely absent from
// both dictionary_words and full_dictionary_words, not a variant-matching gap).
// Also corrects two apparent tone typos in the source xlsx's pinyin column, confirmed
// against standard Hanyu Pinyin: 叔叔 is shu1shu (not shu2shu), 日期's 期 is qi1 (not qi2).
//
// Usage: node scripts/patch-tocfl8000-manual.js
const fs = require('fs')
const path = require('path')

const MANUAL = {
  '秘密/祕密': { vietnamese: 'bí mật' },
  '司機': { vietnamese: 'tài xế, người lái xe' },
  '家具': { vietnamese: 'đồ nội thất, đồ đạc trong nhà' },
  '馬路': { vietnamese: 'đường phố, đường lớn' },
  '脖(子)': { vietnamese: 'cổ' },
  '日期': { vietnamese: 'ngày tháng, thời hạn', pinyin: 'rìqī' },
  '叔叔(˙ㄕㄨ)/叔': { pinyin: 'shūshu/shū' },
}

function main() {
  const filePath = path.join(__dirname, 'output', 'tocfl8000-matched.json')
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))

  let patched = 0
  let stillMissing = []
  for (const w of data) {
    const fix = MANUAL[w.hanzi]
    if (fix) {
      Object.assign(w, fix)
      patched++
    }
    if (!w.vietnamese) stillMissing.push(w.hanzi)
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  console.log('Patched', patched, 'entries')
  console.log('Still missing vietnamese:', stillMissing)
}

main()
