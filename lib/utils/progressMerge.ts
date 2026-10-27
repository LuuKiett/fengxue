import { shuffleArray } from './shuffle'

type ProgressLike = { word_order: string[]; current_index: number } | null | undefined

/**
 * Rebuilds a Nối Từ / Điền Từ progress row's `word_order`/`current_index` so that
 * exactly the words actually completed are recorded as learned:
 *   [already-completed prefix (still in pool)] + [newly done ids] + shuffled rest.
 *
 * - `poolIds`: the mode's live draw pool (derived from the flashcard row, re-fetched
 *   fresh by the caller) — ids outside it are ignored.
 * - `doneIds`: words completed in this session (Matching: every stage word, since a
 *   round only finishes once all are matched; Điền Từ: only `correctIds`).
 *
 * Always reconciling against the live pool (instead of `current_index + count`) is
 * what keeps a 2nd/3rd chained Flashcard→Nối Từ→Điền Từ batch from being silently
 * discarded when an older, already-exhausted row exists, and it means wrong/unanswered
 * Điền Từ words stay in the not-yet-done remainder so they come back in later stages.
 */
export function mergeCompletedWordOrder(prev: ProgressLike, poolIds: string[], doneIds: string[]) {
  const pool = new Set(poolIds)
  const completed: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (pool.has(id) && !seen.has(id)) {
      seen.add(id)
      completed.push(id)
    }
  }
  if (prev) prev.word_order.slice(0, prev.current_index).forEach(push)
  doneIds.forEach(push)
  const remaining = poolIds.filter((id) => !seen.has(id))
  return { wordOrder: [...completed, ...shuffleArray(remaining)], currentIndex: completed.length }
}
