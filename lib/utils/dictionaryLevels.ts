// Canonical TOCFL-style level ordering, so Dictionary/review tabs stay sensible as
// new bands (e.g. Band B: B1/B2) are imported later without any code changes.
export const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

export function sortLevels(levels: string[]): string[] {
  const known = LEVEL_ORDER.filter((l) => levels.includes(l))
  const unknown = levels.filter((l) => !LEVEL_ORDER.includes(l)).sort()
  return [...known, ...unknown]
}
