import { NextRequest, NextResponse } from 'next/server'
import { pinyin } from 'pinyin-pro'

// Offline fallback: curated Traditional Chinese example sentences (HSK 1-4)
// Format: { keyword (simplified/trad) -> [ { trad, pinyin, vietnamese } ] }
const OFFLINE_EXAMPLES: Record<string, { trad: string; py: string; viet: string }[]> = {
  // Greetings & Common
  '你好': [
    { trad: '你好！很高興認識你。', py: 'Nǐ hǎo! Hěn gāoxìng rènshi nǐ.', viet: 'Xin chào! Rất vui được gặp bạn.' },
    { trad: '每天早上我說「你好」給朋友。', py: 'Měitiān zǎoshang wǒ shuō "nǐ hǎo" gěi péngyǒu.', viet: 'Mỗi buổi sáng tôi nói "xin chào" với bạn bè.' },
  ],
  '謝謝': [
    { trad: '謝謝你的幫助！', py: 'Xièxie nǐ de bāngzhù!', viet: 'Cảm ơn bạn đã giúp đỡ!' },
    { trad: '他給我一本書，我說謝謝。', py: 'Tā gěi wǒ yī běn shū, wǒ shuō xièxie.', viet: 'Anh ấy tặng tôi một cuốn sách, tôi nói cảm ơn.' },
  ],
  '再見': [
    { trad: '上課結束了，大家說再見。', py: 'Shàngkè jiéshù le, dàjiā shuō zàijiàn.', viet: 'Tan học, mọi người nói tạm biệt.' },
    { trad: '再見！明天見！', py: 'Zàijiàn! Míngtiān jiàn!', viet: 'Tạm biệt! Ngày mai gặp lại!' },
  ],
  '對不起': [
    { trad: '對不起，我來晚了。', py: 'Duìbuqǐ, wǒ lái wǎn le.', viet: 'Xin lỗi, tôi đến trễ.' },
    { trad: '她說對不起，然後離開了。', py: 'Tā shuō duìbuqǐ, ránhòu líkāi le.', viet: 'Cô ấy nói xin lỗi, rồi rời đi.' },
  ],
  // People
  '我': [
    { trad: '我是越南人，我在學中文。', py: 'Wǒ shì Yuènánrén, wǒ zài xué Zhōngwén.', viet: 'Tôi là người Việt Nam, tôi đang học tiếng Trung.' },
    { trad: '我有一個妹妹和一個弟弟。', py: 'Wǒ yǒu yī gè mèimei hé yī gè dìdi.', viet: 'Tôi có một em gái và một em trai.' },
  ],
  '你': [
    { trad: '你今天去哪裡？', py: 'Nǐ jīntiān qù nǎlǐ?', viet: 'Hôm nay bạn đi đâu?' },
    { trad: '你吃飯了嗎？', py: 'Nǐ chīfàn le ma?', viet: 'Bạn ăn cơm chưa?' },
  ],
  '他': [
    { trad: '他是我的老師，他很厲害。', py: 'Tā shì wǒ de lǎoshī, tā hěn lìhài.', viet: 'Anh ấy là thầy giáo của tôi, anh ấy rất giỏi.' },
    { trad: '他每天去圖書館看書。', py: 'Tā měitiān qù túshūguǎn kàn shū.', viet: 'Anh ấy mỗi ngày đến thư viện đọc sách.' },
  ],
  '她': [
    { trad: '她是我的好朋友。', py: 'Tā shì wǒ de hǎo péngyǒu.', viet: 'Cô ấy là bạn tốt của tôi.' },
    { trad: '她喜歡吃水果，特別是蘋果。', py: 'Tā xǐhuān chī shuǐguǒ, tèbié shì píngguǒ.', viet: 'Cô ấy thích ăn trái cây, đặc biệt là táo.' },
  ],
  '我們': [
    { trad: '我們一起去學校。', py: 'Wǒmen yīqǐ qù xuéxiào.', viet: 'Chúng tôi cùng nhau đến trường.' },
    { trad: '我們班有三十個學生。', py: 'Wǒmen bān yǒu sānshí gè xuéshēng.', viet: 'Lớp chúng tôi có ba mươi học sinh.' },
  ],
  // Numbers
  '一': [
    { trad: '她有一隻貓和兩隻狗。', py: 'Tā yǒu yī zhī māo hé liǎng zhī gǒu.', viet: 'Cô ấy có một con mèo và hai con chó.' },
  ],
  // Actions
  '吃': [
    { trad: '我每天早上吃麵包和喝牛奶。', py: 'Wǒ měitiān zǎoshang chī miànbāo hé hē niúnǎi.', viet: 'Mỗi buổi sáng tôi ăn bánh mì và uống sữa.' },
    { trad: '你喜歡吃什麼？', py: 'Nǐ xǐhuān chī shénme?', viet: 'Bạn thích ăn gì?' },
  ],
  '喝': [
    { trad: '天氣很熱，我想喝水。', py: 'Tiānqì hěn rè, wǒ xiǎng hē shuǐ.', viet: 'Thời tiết rất nóng, tôi muốn uống nước.' },
    { trad: '他每天喝三杯茶。', py: 'Tā měitiān hē sān bēi chá.', viet: 'Anh ấy mỗi ngày uống ba tách trà.' },
  ],
  '學習': [
    { trad: '我每天學習兩個小時的中文。', py: 'Wǒ měitiān xuéxí liǎng gè xiǎoshí de Zhōngwén.', viet: 'Tôi học tiếng Trung hai tiếng đồng hồ mỗi ngày.' },
    { trad: '學習語言需要耐心和努力。', py: 'Xuéxí yǔyán xūyào nàixīn hé nǔlì.', viet: 'Học ngôn ngữ cần sự kiên nhẫn và nỗ lực.' },
  ],
  '工作': [
    { trad: '她在一家大公司工作。', py: 'Tā zài yī jiā dà gōngsī gōngzuò.', viet: 'Cô ấy làm việc ở một công ty lớn.' },
    { trad: '他的工作很忙，很少休息。', py: 'Tā de gōngzuò hěn máng, hěn shǎo xiūxi.', viet: 'Công việc của anh ấy rất bận, ít khi nghỉ ngơi.' },
  ],
  '喜歡': [
    { trad: '我喜歡看電影和聽音樂。', py: 'Wǒ xǐhuān kàn diànyǐng hé tīng yīnyuè.', viet: 'Tôi thích xem phim và nghe nhạc.' },
    { trad: '你喜歡什麼顏色？', py: 'Nǐ xǐhuān shénme yánsè?', viet: 'Bạn thích màu gì?' },
  ],
  // Places
  '學校': [
    { trad: '我的學校離家很近。', py: 'Wǒ de xuéxiào lí jiā hěn jìn.', viet: 'Trường học của tôi gần nhà lắm.' },
    { trad: '學校裡有一個很大的圖書館。', py: 'Xuéxiào lǐ yǒu yī gè hěn dà de túshūguǎn.', viet: 'Trong trường có một thư viện rất lớn.' },
  ],
  '家': [
    { trad: '我的家在河內市中心。', py: 'Wǒ de jiā zài Hénèi shì zhōngxīn.', viet: 'Nhà tôi ở trung tâm thành phố Hà Nội.' },
    { trad: '週末我喜歡待在家裡看書。', py: 'Zhōumò wǒ xǐhuān dāi zài jiā lǐ kàn shū.', viet: 'Cuối tuần tôi thích ở nhà đọc sách.' },
  ],
  // Things
  '書': [
    { trad: '這本書很有意思，我看了三遍。', py: 'Zhè běn shū hěn yǒu yìsi, wǒ kàn le sān biàn.', viet: 'Cuốn sách này rất thú vị, tôi đọc ba lần.' },
    { trad: '他每個月買很多書。', py: 'Tā měi gè yuè mǎi hěn duō shū.', viet: 'Anh ấy mỗi tháng mua rất nhiều sách.' },
  ],
  '電腦': [
    { trad: '我用電腦學習中文。', py: 'Wǒ yòng diànnǎo xuéxí Zhōngwén.', viet: 'Tôi dùng máy tính để học tiếng Trung.' },
    { trad: '這台電腦很新，速度很快。', py: 'Zhè tái diànnǎo hěn xīn, sùdù hěn kuài.', viet: 'Chiếc máy tính này rất mới, tốc độ rất nhanh.' },
  ],
  '手機': [
    { trad: '我的手機沒電了，可以借用你的充電器嗎？', py: 'Wǒ de shǒujī méi diàn le, kěyǐ jièyòng nǐ de chōngdiànqì ma?', viet: 'Điện thoại tôi hết pin, tôi có thể mượn sạc của bạn không?' },
    { trad: '現在很多人每天都看手機。', py: 'Xiànzài hěn duō rén měitiān dōu kàn shǒujī.', viet: 'Hiện nay nhiều người mỗi ngày đều nhìn điện thoại.' },
  ],
  // Food
  '米飯': [
    { trad: '中國人每天都吃米飯。', py: 'Zhōngguórén měitiān dōu chī mǐfàn.', viet: 'Người Trung Quốc mỗi ngày đều ăn cơm.' },
    { trad: '我最喜歡吃媽媽做的米飯。', py: 'Wǒ zuì xǐhuān chī māma zuò de mǐfàn.', viet: 'Tôi thích nhất là ăn cơm do mẹ nấu.' },
  ],
  '水': [
    { trad: '多喝水對身體很好。', py: 'Duō hē shuǐ duì shēntǐ hěn hǎo.', viet: 'Uống nhiều nước rất tốt cho sức khoẻ.' },
    { trad: '這裡的水很乾淨。', py: 'Zhèlǐ de shuǐ hěn gānjìng.', viet: 'Nước ở đây rất sạch.' },
  ],
  // Time
  '今天': [
    { trad: '今天天氣很好，我們去公園吧。', py: 'Jīntiān tiānqì hěn hǎo, wǒmen qù gōngyuán ba.', viet: 'Hôm nay thời tiết rất đẹp, chúng ta đi công viên nhé.' },
    { trad: '今天是星期一，我要上課。', py: 'Jīntiān shì xīngqīyī, wǒ yào shàngkè.', viet: 'Hôm nay là thứ Hai, tôi phải đi học.' },
  ],
  '明天': [
    { trad: '明天有考試，我要好好復習。', py: 'Míngtiān yǒu kǎoshì, wǒ yào hǎohǎo fùxí.', viet: 'Ngày mai có thi, tôi phải ôn bài thật kỹ.' },
    { trad: '明天見！', py: 'Míngtiān jiàn!', viet: 'Ngày mai gặp lại!' },
  ],
  // Adjectives
  '好': [
    { trad: '這個電影真的很好看。', py: 'Zhège diànyǐng zhēn de hěn hǎokàn.', viet: 'Bộ phim này thực sự rất hay.' },
    { trad: '你今天身體好嗎？', py: 'Nǐ jīntiān shēntǐ hǎo ma?', viet: 'Hôm nay bạn có khoẻ không?' },
  ],
  '大': [
    { trad: '上海是中國最大的城市之一。', py: 'Shànghǎi shì Zhōngguó zuìdà de chéngshì zhī yī.', viet: 'Thượng Hải là một trong những thành phố lớn nhất Trung Quốc.' },
    { trad: '這間教室很大，可以坐五十個人。', py: 'Zhè jiān jiàoshì hěn dà, kěyǐ zuò wǔshí gè rén.', viet: 'Phòng học này rất lớn, có thể ngồi được năm mươi người.' },
  ],
  '小': [
    { trad: '我的貓很小，剛出生一個月。', py: 'Wǒ de māo hěn xiǎo, gāng chūshēng yī gè yuè.', viet: 'Con mèo của tôi rất nhỏ, vừa mới sinh được một tháng.' },
  ],
  '多': [
    { trad: '今天來了很多人。', py: 'Jīntiān lái le hěn duō rén.', viet: 'Hôm nay có rất nhiều người đến.' },
  ],
  '少': [
    { trad: '今天商店裡的人很少。', py: 'Jīntiān shāngdiàn lǐ de rén hěn shǎo.', viet: 'Hôm nay trong cửa hàng có rất ít người.' },
  ],
  // Family
  '媽媽': [
    { trad: '我媽媽做的菜很好吃。', py: 'Wǒ māma zuò de cài hěn hǎochī.', viet: 'Món ăn mẹ tôi nấu rất ngon.' },
    { trad: '媽媽每天送我去學校。', py: 'Māma měitiān sòng wǒ qù xuéxiào.', viet: 'Mẹ mỗi ngày đưa tôi đến trường.' },
  ],
  '爸爸': [
    { trad: '我爸爸是一名醫生。', py: 'Wǒ bàba shì yī míng yīshēng.', viet: 'Bố tôi là một bác sĩ.' },
    { trad: '週末爸爸帶我去打籃球。', py: 'Zhōumò bàba dài wǒ qù dǎ lánqiú.', viet: 'Cuối tuần bố dẫn tôi đi chơi bóng rổ.' },
  ],
  // Common words
  '朋友': [
    { trad: '她是我最好的朋友，我們認識十年了。', py: 'Tā shì wǒ zuì hǎo de péngyǒu, wǒmen rènshi shí nián le.', viet: 'Cô ấy là người bạn thân nhất của tôi, chúng tôi quen nhau mười năm rồi.' },
    { trad: '我和朋友一起去旅行。', py: 'Wǒ hé péngyǒu yīqǐ qù lǚxíng.', viet: 'Tôi cùng bạn bè đi du lịch.' },
  ],
  '老師': [
    { trad: '我的中文老師是台灣人。', py: 'Wǒ de Zhōngwén lǎoshī shì Táiwānrén.', viet: 'Thầy giáo tiếng Trung của tôi là người Đài Loan.' },
    { trad: '老師對學生很耐心。', py: 'Lǎoshī duì xuéshēng hěn nàixīn.', viet: 'Thầy giáo rất kiên nhẫn với học sinh.' },
  ],
  '學生': [
    { trad: '他是一個非常用功的學生。', py: 'Tā shì yī gè fēicháng yòngōng de xuéshēng.', viet: 'Anh ấy là một học sinh rất chăm chỉ.' },
  ],
  // Weather
  '天氣': [
    { trad: '今天的天氣真不錯，陽光明媚。', py: 'Jīntiān de tiānqì zhēn búcuò, yángguāng míngmèi.', viet: 'Thời tiết hôm nay thật tốt, nắng đẹp.' },
    { trad: '越南的天氣很熱。', py: 'Yuènán de tiānqì hěn rè.', viet: 'Thời tiết Việt Nam rất nóng.' },
  ],
}

// Normalize hanzi for lookup (remove spaces, punctuation)
function normalizeKey(hanzi: string): string {
  return hanzi.trim().replace(/[，。！？、\s]/g, '')
}

// Get Pinyin for a Chinese string using pinyin-pro
function getPinyin(text: string): string {
  try {
    return pinyin(text, { toneType: 'symbol', type: 'string', separator: ' ' })
  } catch {
    return text
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const hanzi = searchParams.get('hanzi')
  
  if (!hanzi) {
    return NextResponse.json({ error: 'Missing hanzi param' }, { status: 400 })
  }

  const key = normalizeKey(hanzi)
  
  // 1. Check offline examples first (exact match or substring match)
  let found = OFFLINE_EXAMPLES[key]
  
  if (!found) {
    // Try to find any entry that contains the search word
    for (const [dictKey, examples] of Object.entries(OFFLINE_EXAMPLES)) {
      if (dictKey.includes(key) || key.includes(dictKey)) {
        found = examples
        break
      }
    }
  }

  if (!found) {
    // Try fuzzy: search all sentences that contain the hanzi
    const matched: { trad: string; py: string; viet: string }[] = []
    for (const examples of Object.values(OFFLINE_EXAMPLES)) {
      for (const ex of examples) {
        if (ex.trad.includes(key) && matched.length < 2) {
          matched.push(ex)
        }
      }
    }
    if (matched.length > 0) {
      found = matched
    }
  }

  if (found && found.length > 0) {
    return NextResponse.json({
      source: 'offline',
      examples: found.slice(0, 2).map(e => ({
        sentence: e.trad,
        pinyin: e.py,
        translation: e.viet,
      }))
    })
  }

  // 2. Fallback: generate a simple example using the word itself
  const pinyinStr = getPinyin(hanzi)
  return NextResponse.json({
    source: 'generated',
    examples: [
      {
        sentence: `我在學習「${hanzi}」這個詞。`,
        pinyin: `Wǒ zài xuéxí "  ${pinyinStr}" zhège cí.`,
        translation: `Tôi đang học từ "${hanzi}".`,
      }
    ]
  })
}
