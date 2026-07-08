// Hand-curated hanzi → emoji map for the practice-exam "看圖辨義" (picture-choice)
// listening question type, modeled on real TOCFL Band A Part 1 ("nhìn tranh nghe chữ"):
// you hear a word spoken and pick the matching picture from 3 options. There's no image
// generation or licensed photo library available here, so a large emoji stands in for
// the photograph — it preserves the actual interaction (see picture → hear word → pick
// A/B/C) even though the visual isn't a real photo. Only concrete, clearly-iconic nouns
// are included; anything abstract (verbs, adjectives, function words) is deliberately
// left out since no single emoji can represent them unambiguously.
export const EMOJI_VOCAB: Record<string, string> = {
  // Animals
  '狗': '🐶', '貓': '🐱', '魚': '🐟', '鳥': '🐦', '牛': '🐄', '豬': '🐷',
  '老虎': '🐯', '大象': '🐘', '兔子': '🐰', '熊': '🐻', '馬': '🐴', '羊': '🐑',
  '雞': '🐔', '猴子': '🐵',

  // Food & drink
  '蘋果': '🍎', '香蕉': '🍌', '西瓜': '🍉', '橘子': '🍊', '葡萄': '🍇', '草莓': '🍓',
  '麵包': '🍞', '米飯': '🍚', '牛奶': '🥛', '茶': '🍵', '咖啡': '☕', '蛋': '🥚',
  '蛋糕': '🎂', '餃子': '🥟', '麵': '🍜', '漢堡': '🍔', '披薩': '🍕', '冰淇淋': '🍦',
  '果汁': '🧃', '啤酒': '🍺', '水': '💧',

  // Family
  '爸爸': '👨', '媽媽': '👩', '哥哥': '👦', '姐姐': '👧', '弟弟': '🧒', '妹妹': '👧',

  // Places
  '家': '🏠', '學校': '🏫', '醫院': '🏥', '公司': '🏢', '餐廳': '🍽️', '公園': '🌳',

  // Transportation
  '車': '🚗', '汽車': '🚗', '公車': '🚌', '腳踏車': '🚲', '飛機': '✈️', '火車': '🚆',
  '船': '⛴️',

  // Everyday objects
  '書': '📖', '筆': '🖊️', '電腦': '💻', '手機': '📱', '電視': '📺', '電話': '☎️',
  '時鐘': '🕐', '傘': '☂️', '帽子': '🎩', '衣服': '👕', '褲子': '👖', '鞋子': '👟',
  '錢': '💰', '錢包': '👛', '禮物': '🎁', '球': '⚽', '鑰匙': '🔑', '眼鏡': '👓',

  // Nature / weather
  '花': '🌸', '樹': '🌳', '山': '⛰️', '海': '🌊', '太陽': '☀️', '月亮': '🌙',
  '星星': '⭐', '火': '🔥', '冰': '🧊', '雨': '🌧️', '雪': '❄️', '風': '🌬️',

  // Body
  '眼睛': '👁️', '手': '✋', '腳': '🦶', '心': '❤️',

  // Colors
  '紅色': '🔴', '藍色': '🔵', '綠色': '🟢', '黃色': '🟡', '白色': '⚪', '黑色': '⚫',
}
