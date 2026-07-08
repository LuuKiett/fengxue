// Greedy longest-match segmentation for continuously-typed (no spaces) toneless pinyin,
// e.g. "nihaoma" -> 你 好 嗎 composed as one candidate — similar to how a real Traditional
// Chinese IME turns a stream of pinyin into hanzi. Falls back to single characters wherever
// no longer compound word is known, since CC-CEDICT's single-hanzi coverage already acts as
// the "valid syllable" dictionary — no separate syllable table is needed.

export interface TocflEntry {
  t: string
  p: string
  l: number | null
}

export type DictIndex = Record<string, TocflEntry[]>

export interface ComposedCandidate {
  t: string
  p: string
  l: number
  composed: true
}

const MAX_SEGMENT_LEN = 12

export function segmentPinyin(query: string, index: DictIndex): ComposedCandidate | null {
  const n = query.length
  if (n === 0) return null

  const dp: boolean[] = new Array(n + 1).fill(false)
  const prev: number[] = new Array(n + 1).fill(-1)
  dp[0] = true

  for (let i = 1; i <= n; i++) {
    for (let len = Math.min(MAX_SEGMENT_LEN, i); len >= 1; len--) {
      const j = i - len
      if (!dp[j]) continue
      const seg = query.slice(j, i)
      if (index[seg] && index[seg].length > 0) {
        dp[i] = true
        prev[i] = j
        break
      }
    }
  }

  if (!dp[n]) return null

  const segments: string[] = []
  let idx = n
  while (idx > 0) {
    const j = prev[idx]
    segments.unshift(query.slice(j, idx))
    idx = j
  }

  // A single segment means the whole string is already one dictionary key —
  // that's handled by plain exact-match, not worth surfacing as a "composed" result.
  if (segments.length <= 1) return null

  const hanziParts: string[] = []
  const pinyinParts: string[] = []
  let maxLevel: number | null = null

  for (const seg of segments) {
    const best = index[seg][0]
    hanziParts.push(best.t)
    pinyinParts.push(best.p)
    if (best.l !== null && best.l !== undefined) {
      maxLevel = maxLevel === null ? best.l : Math.max(maxLevel, best.l)
    }
  }

  return {
    t: hanziParts.join(''),
    p: pinyinParts.join(' '),
    l: maxLevel ?? 99,
    composed: true,
  }
}
