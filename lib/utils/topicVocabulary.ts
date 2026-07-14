// Canonical display order for topic_vocabulary's topic_key values, shared by the
// "Học Từ Vựng Theo Chủ Đề" page. Topics absent from a given level (e.g. A1 has no
// 'food' group) are simply skipped — this only controls ordering when present.
export const TOPIC_ORDER = [
  'home-living',
  'school',
  'communication',
  'shopping',
  'travel',
  'entertainment',
  'relationships',
  'restaurant',
  'work-finance',
  'health',
  'food',
  'function-words',
  'law',
  'personality',
  'other',
]

export function sortTopicKeys(keys: string[]): string[] {
  const known = TOPIC_ORDER.filter((k) => keys.includes(k))
  const unknown = keys.filter((k) => !TOPIC_ORDER.includes(k)).sort()
  return [...known, ...unknown]
}
