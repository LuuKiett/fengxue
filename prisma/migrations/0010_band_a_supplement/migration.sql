-- Migration: 0010_band_a_supplement
-- Adds words present in OTAB19.xlsx ('BAN A' sheet) that were missing from the
-- originally-imported A1/A2 dictionary set, each with a hand-authored, level-
-- appropriate example sentence. Slash/variant-notation entries already covered by
-- an existing word under one half of the slash (e.g. 他/她, 午餐/午飯, 這裡/兒), and
-- 車（子） which already exists in the DB under a half-width-paren spelling 車(子),
-- were intentionally skipped as duplicates rather than inserted separately.

INSERT INTO public.dictionary_words (band, level, hanzi, pinyin, vietnamese, pos, order_index, example_hanzi, example_pinyin, example_vietnamese) VALUES
  ('A', 'A2', '飯館', 'fànguǎn', 'nhà hàng', 'N', 876, '我們去附近的飯館吃晚餐。', 'wǒ men qù fù jìn de fàn guǎn chī wǎn cān。', 'Chúng ta đi ăn tối ở nhà hàng gần đây.'),
  ('A', 'A2', '出國', 'chūguó', 'đi nước ngoài', 'VA', 877, '我明年想出國留學。', 'wǒ míng nián xiǎng chū guó liú xué。', 'Năm sau tôi muốn ra nước ngoài du học.'),
  ('A', 'A1', '出來', 'chūlái', 'ra', 'VA', 878, '請你出來一下，我有事找你。', 'qǐng nǐ chū lái yí xià， wǒ yǒu shì zhǎo nǐ。', 'Bạn ra ngoài một chút, tôi có việc muốn tìm bạn.'),
  ('A', 'A1', '出去', 'chūqù', 'đi ra', 'VA', 879, '外面下雨了，我們別出去了。', 'wài miàn xià yǔ le， wǒ men bié chū qù le。', 'Bên ngoài trời mưa rồi, chúng ta đừng đi ra ngoài nữa.'),
  ('A', 'A1', '蛋糕', 'dàngāo', 'bánh kem', 'N', 880, '今天是我的生日，媽媽買了一個蛋糕。', 'jīn tiān shì wǒ de shēng rì， mā mā mǎi le yí gè dàn gāo。', 'Hôm nay là sinh nhật của tôi, mẹ đã mua một cái bánh kem.'),
  ('A', 'A1', '公車', 'gōngchē', 'xe buýt', 'N', 881, '我每天坐公車上班。', 'wǒ měi tiān zuò gōng chē shàng bān。', 'Mỗi ngày tôi đi xe buýt đi làm.'),
  ('A', 'A2', '自行車', 'zìxíngchē', 'xe đạp', 'N', 882, '他喜歡騎自行車去學校。', 'tā xǐ huān qí zì xíng chē qù xué xiào。', 'Anh ấy thích đi xe đạp đến trường.'),
  ('A', 'A1', '洗手間', 'xǐshǒujiān', 'nhà vệ sinh', 'N', 883, '請問洗手間在哪裡？', 'qǐng wèn xǐ shǒu jiàn zài nǎ lǐ？', 'Xin hỏi nhà vệ sinh ở đâu?'),
  ('A', 'A1', '早餐', 'zǎocān', 'cơm sáng', 'N', 884, '我每天早上七點吃早餐。', 'wǒ měi tiān zǎo shàng qī diǎn chī zǎo cān。', 'Mỗi sáng lúc 7 giờ tôi ăn cơm sáng.'),
  ('A', 'A1', '一', 'yī', '1', 'Det', 885, '我家有一個弟弟。', 'wǒ jiā yǒu yí gè dì di。', 'Nhà tôi có một em trai.'),
  ('A', 'A1', '超市', 'chāoshì', 'siêu thị', 'N', 886, '媽媽去超市買水果。', 'mā mā qù chāo shì mǎi shuǐ guǒ。', 'Mẹ đi siêu thị mua trái cây.'),
  ('A', 'A2', '口', 'kǒu', 'miệng, ngụm', 'N', 887, '他喝了一口水。', 'tā hē le yì kǒu shuǐ。', 'Anh ấy uống một ngụm nước.'),
  ('A', 'A2', '摩托車', 'mótuōchē', 'xe máy', 'N', 888, '台灣很多人騎摩托車上班。', 'tái wān hěn duō rén qí mó tuō chē shàng bān。', 'Ở Đài Loan nhiều người đi xe máy đi làm.'),
  ('A', 'A2', '機車', 'jīchē', 'xe máy', 'N', 889, '我的機車壞了，要送去修理。', 'wǒ de jī chē huài le， yào sòng qù xiū lǐ。', 'Xe máy của tôi bị hỏng, phải đem đi sửa.'),
  ('A', 'A2', '木頭', 'mùtóu', 'gỗ', 'N', 890, '這張桌子是木頭做的。', 'zhè zhāng zhuō zi shì mù tóu zuò de。', 'Cái bàn này được làm bằng gỗ.'),
  ('A', 'A1', '哪', 'nǎ', 'nào', 'Det', 891, '你要買哪一件衣服？', 'nǐ yào mǎi nǎ yí jiàn yī fu？', 'Bạn muốn mua cái áo nào?'),
  ('A', 'A1', '那邊', 'nàbiān', 'bên đó', 'N', 892, '廁所在那邊。', 'cè suǒ zài nà biān。', 'Nhà vệ sinh ở bên đó.'),
  ('A', 'A2', '那麼', 'nàme', 'vậy, như vậy', 'Adv', 893, '你那麼忙，我們改天再約。', 'nǐ nà me máng， wǒ men gǎi tiān zài yuē。', 'Bạn bận như vậy, chúng ta hẹn hôm khác vậy.'),
  ('A', 'A2', '那樣', 'nàyàng', 'như vậy, như thế đó', 'Adv', 894, '別那樣說話，會傷到他的心。', 'bié nà yàng shuō huà， huì shāng dào tā de xīn。', 'Đừng nói như vậy, sẽ làm tổn thương anh ấy.'),
  ('A', 'A1', '奶奶', 'nǎinai', 'bà nội', 'N', 895, '我奶奶今年八十歲了。', 'wǒ nǎi nai jīn nián bā shí suì le。', 'Bà nội tôi năm nay tám mươi tuổi rồi.'),
  ('A', 'A2', '難過', 'nánguò', 'buồn', 'VS', 896, '聽到這個消息，我很難過。', 'tīng dào zhè gè xiāo xī， wǒ hěn nán guò。', 'Nghe tin này, tôi rất buồn.'),
  ('A', 'A2', '年紀', 'niánjì', 'tuổi tác', 'N', 897, '你今年多大年紀了？', 'nǐ jīn nián duō dà nián jì le？', 'Năm nay bạn bao nhiêu tuổi rồi?'),
  ('A', 'A2', '這麼', 'zhème', 'như vậy', 'Adv', 898, '這麼晚了，你怎麼還沒睡？', 'zhè me wǎn le， nǐ zěn me hái méi shuì？', 'Muộn như vậy rồi, sao bạn vẫn chưa ngủ?'),
  ('A', 'A2', '這樣', 'zhèyàng', 'như vậy', 'Adv', 899, '這樣做是對的。', 'zhè yàng zuò shì duì de。', 'Làm như vậy là đúng.'),
  ('A', 'A1', '隻', 'zhī', 'con ( chó, mèo )', 'M', 900, '我家養了一隻貓。', 'wǒ jiā yǎng le yì zhī māo。', 'Nhà tôi nuôi một con mèo.')
ON CONFLICT (level, hanzi, pinyin, vietnamese) DO NOTHING;
