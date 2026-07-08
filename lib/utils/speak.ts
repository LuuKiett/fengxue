// Centralized Chinese TTS so every page sounds the same instead of each screen
// picking its own SpeechSynthesisUtterance defaults (which left pronunciation at the
// mercy of whatever voice the browser happened to default to for `lang=zh-TW`).
// We explicitly pin ONE female Traditional-Chinese voice by scanning the browser's own
// voice list for known female voice names — no navigator/OS/device sniffing, since the
// available voices already tell us everything we need.

// Common female Mandarin voice names across engines/platforms (Chrome, Edge/Windows,
// macOS/iOS Safari). Checked in order — first match found in the browser's actual
// voice list wins. Falls back to the first available zh-TW/zh voice if none of these
// are present, and finally to the browser's own default for `lang` if there are no
// Chinese voices at all.
const PREFERRED_FEMALE_VOICE_NAMES = [
  'Mei-Jia',       // macOS / iOS, zh-TW female
  'Hanhan',        // Windows, zh-TW female
  'Zhiwei',
  'Yating',        // Chrome/Google zh-TW female
  '國語（臺灣）',    // Chrome/Google zh-TW female (Traditional label)
  'Tingting',      // macOS zh-CN female
  'Ting-Ting',
  'Huihui',        // Windows zh-CN female
  'Yaoyao',        // Windows zh-CN female
  'Xiaoxiao',      // Windows zh-CN female
  '普通话（中国大陆）', // Chrome/Google zh-CN female
]

let cachedVoice: SpeechSynthesisVoice | null | undefined // undefined = not resolved yet

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice

  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) {
    // Voice list hasn't loaded yet in this browser — don't cache a "no voice" result,
    // so the next speak() call retries once voices are available.
    return null
  }

  const zhVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'))

  for (const name of PREFERRED_FEMALE_VOICE_NAMES) {
    const match = zhVoices.find((v) => v.name.includes(name))
    if (match) {
      cachedVoice = match
      return cachedVoice
    }
  }

  // No known female voice found by name — fall back to any Traditional Chinese voice,
  // then any Chinese voice at all, so pronunciation is still Chinese rather than
  // whatever the browser's global default happens to be.
  cachedVoice = zhVoices.find((v) => v.lang.toLowerCase() === 'zh-tw') || zhVoices[0] || null
  return cachedVoice
}

export interface SpeakOptions {
  rate?: number
  pitch?: number
}

/** Speaks Chinese text using one consistent female voice across the whole app. */
export function speak(text: string, options: SpeakOptions = {}) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-TW'
  utterance.rate = options.rate ?? 0.85
  if (options.pitch !== undefined) utterance.pitch = options.pitch

  const voice = pickVoice()
  if (voice) utterance.voice = voice

  window.speechSynthesis.speak(utterance)
}
