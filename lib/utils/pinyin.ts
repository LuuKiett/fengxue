// Strip tone diacritics/spaces from a pinyin string so it can be used as a
// lookup key into /tocfl-index.json (e.g. "nǐ hǎo" -> "nihao").
export function stripTones(py: string): string {
  return py
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/̈/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
}

// Numbered-tone pinyin input, phone-IME style: a single syllable followed by its
// tone digit (1-4 = tone marks, 5 = neutral), e.g. "ni3" -> { base: "ni", tone: 3 }.
// Returns null for anything else (no digit, multiple digits, multiple syllables) so
// callers can fall back to plain toneless lookup.
export function parseNumberedSyllable(query: string): { base: string; tone: number } | null {
  const m = query.trim().match(/^([a-zA-Z]+)([1-5])$/)
  if (!m) return null
  return { base: m[1].toLowerCase(), tone: parseInt(m[2], 10) }
}

// Reads a single pinyin syllable's tone (1-4) off its diacritic, or 5 (neutral) if
// it carries none — used to rank/filter suggestion candidates against a
// parseNumberedSyllable() request.
export function syllableTone(py: string): number {
  const normalized = py.normalize('NFD')
  if (normalized.includes('̄')) return 1 // macron:  ā ē ī ō ū
  if (normalized.includes('́')) return 2 // acute:   á é í ó ú
  if (normalized.includes('̌')) return 3 // caron:   ǎ ě ǐ ǒ ǔ
  if (normalized.includes('̀')) return 4 // grave:   à è ì ò ù
  return 5
}

// Reorders suggestion candidates so entries whose first syllable matches the
// requested tone come first, keeping the rest as a fallback (never hides results
// outright — a slightly-off tone guess should still surface something).
export function sortByRequestedTone<T extends { p: string }>(entries: T[], tone: number): T[] {
  const firstSyllableTone = (p: string) => syllableTone(p.split(/\s+/)[0] || p)
  const matching = entries.filter((e) => firstSyllableTone(e.p) === tone)
  const rest = entries.filter((e) => firstSyllableTone(e.p) !== tone)
  return [...matching, ...rest]
}
