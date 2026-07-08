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
