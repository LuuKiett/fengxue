'use client'

// "Điền Từ" exercise for /review-dictionary: the target word's hanzi is shown up
// front (unlike Flashcard, which hides meaning until flipped) and the student must
// reproduce it by typing its pinyin (toneless, e.g. "ai") into a composer identical
// to the one on /vocabulary's "Thêm Từ" form — pick the matching hanzi candidate from
// the TOCFL/CC-CEDICT suggestion dropdown to build up the answer. Grading is automatic
// the moment the composed answer reaches the target's character length. Kept as a
// self-contained copy of the composer logic (tocflIndexRef/lookupSuggestions/
// selectSuggestion) rather than a shared hook, matching how /vocabulary's own edit-modal
// composer is already a separate copy of its add-form composer — see KNOWLEDGE.md.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { stripTones, parseNumberedSyllable, sortByRequestedTone } from '@/lib/utils/pinyin'
import { segmentPinyin, type ComposedCandidate } from '@/lib/utils/pinyinSegment'
import { speak } from '@/lib/utils/speak'
import { CheckCircle2, XCircle, RotateCcw, PartyPopper, Volume2, X } from 'lucide-react'

interface FillInWord {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
}

export interface FillInResult {
  correctIds: string[]
  incorrectIds: string[]
}

interface FillInExerciseProps {
  words: FillInWord[]
  onComplete: (result: FillInResult) => void
}

type TocflEntry = { t: string; p: string; l: number | null }
type SuggestionEntry = TocflEntry | ComposedCandidate
type DictIndex = Record<string, TocflEntry[]>

export default function FillInExercise({ words, onComplete }: FillInExerciseProps) {
  const [composing, setComposing] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [suggestions, setSuggestions] = useState<Record<string, SuggestionEntry[]>>({})
  const [graded, setGraded] = useState<Record<string, boolean>>({})
  const [correct, setCorrect] = useState<Record<string, boolean>>({})
  // True once "Nộp Bài" has been clicked — freezes every row (no more editing/reset)
  // and reveals pinyin/nghĩa even for rows the student never finished, so a partial
  // submission still shows what was missed instead of leaving them masked forever.
  const [submitted, setSubmitted] = useState(false)

  const tocflIndexRef = useRef<DictIndex | null>(null)
  // Holds the in-flight load's own promise (not just a boolean) so a lookup that
  // fires while the fetch is still in progress awaits the same promise instead of
  // seeing "already loading" and returning immediately with a null index — that
  // silently dropped every suggestion typed before the ~5.5MB index finished
  // downloading/parsing, which on a first-focus keystroke is very often the case.
  const tocflLoadPromiseRef = useRef<Promise<void> | null>(null)
  const sortedKeysRef = useRef<string[] | null>(null)
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const loadTocflIndex = useCallback(async () => {
    if (tocflIndexRef.current) return
    if (!tocflLoadPromiseRef.current) {
      tocflLoadPromiseRef.current = (async () => {
        try {
          const res = await fetch('/tocfl-index.json')
          const idx = await res.json()
          tocflIndexRef.current = idx
          sortedKeysRef.current = Object.keys(idx).sort()
        } catch (e) {
          console.error('Failed to load TOCFL index:', e)
        }
      })()
    }
    await tocflLoadPromiseRef.current
  }, [])

  const prefixSearchKeys = (keys: string[], prefix: string): string[] => {
    const lowerBound = (target: string) => {
      let lo = 0, hi = keys.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (keys[mid] < target) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    const start = lowerBound(prefix)
    const end = lowerBound(prefix + '￿')
    return keys.slice(start, end)
  }

  const lookupSuggestions = (wordId: string, query: string) => {
    if (debounceRefs.current[wordId]) clearTimeout(debounceRefs.current[wordId])

    // Numbered-tone input ("ni3") takes priority over plain toneless lookup — the
    // digit pins down which of several same-syllable candidates (e.g. "ma" -> 媽/麻/
    // 馬/罵/嗎) the student means, instead of showing all of them.
    const numbered = parseNumberedSyllable(query)
    const normalizedQuery = numbered ? numbered.base : stripTones(query)
    if (!normalizedQuery) {
      setSuggestions(prev => { const n = { ...prev }; delete n[wordId]; return n })
      return
    }

    debounceRefs.current[wordId] = setTimeout(async () => {
      if (!tocflIndexRef.current) await loadTocflIndex()
      const idx = tocflIndexRef.current
      if (!idx) return

      let results: TocflEntry[] = idx[normalizedQuery] || []
      if (results.length === 0) {
        const keys = sortedKeysRef.current ?? Object.keys(idx).sort()
        sortedKeysRef.current = keys
        const matchingKeys = prefixSearchKeys(keys, normalizedQuery).filter(k => k !== normalizedQuery)
        results = matchingKeys
          .sort((a, b) => (idx[a][0]?.l ?? 99) - (idx[b][0]?.l ?? 99))
          .flatMap(k => idx[k])
          .slice(0, 15)
      }
      if (numbered) results = sortByRequestedTone(results, numbered.tone)

      const composed = !numbered && normalizedQuery.length > 2 ? segmentPinyin(normalizedQuery, idx) : null
      const finalResults: SuggestionEntry[] = composed ? [composed, ...results] : results

      if (finalResults.length > 0) {
        setSuggestions(prev => ({ ...prev, [wordId]: finalResults }))
      } else {
        setSuggestions(prev => { const n = { ...prev }; delete n[wordId]; return n })
      }
    }, 150)
  }

  const gradeIfReady = (wordId: string, composedAnswer: string) => {
    const target = words.find(w => w.id === wordId)
    if (!target) return
    if (composedAnswer.length < target.hanzi.length) return
    setGraded(prev => ({ ...prev, [wordId]: true }))
    setCorrect(prev => ({ ...prev, [wordId]: composedAnswer === target.hanzi }))
  }

  const updateComposing = (wordId: string, value: string) => {
    // Some words aren't reachable through the pinyin-suggestion composer at all — e.g.
    // an entry whose hanzi is stored as "橘(子)" never indexes a pickable "子" candidate,
    // and plenty of words simply aren't in the TOCFL/CC-CEDICT merge index — so there's
    // no suggestion to click and the row can never grade. Typing (or IME-committing)
    // actual hanzi characters straight into the box is accepted as a direct answer:
    // any CJK character in the new value is appended straight to the answer (bypassing
    // the pinyin lookup for those characters) and graded exactly like a picked
    // suggestion — correct only if it matches the target hanzi.
    const hanziChars = [...value].filter(ch => /[㐀-鿿]/.test(ch))
    if (hanziChars.length > 0) {
      const nextAnswer = (answers[wordId] || '') + hanziChars.join('')
      setAnswers(prev => ({ ...prev, [wordId]: nextAnswer }))
      setComposing(prev => ({ ...prev, [wordId]: '' }))
      setSuggestions(prev => { const n = { ...prev }; delete n[wordId]; return n })
      gradeIfReady(wordId, nextAnswer)
      return
    }
    setComposing(prev => ({ ...prev, [wordId]: value }))
    lookupSuggestions(wordId, value)
  }

  const selectSuggestion = (wordId: string, item: SuggestionEntry) => {
    const nextAnswer = (answers[wordId] || '') + item.t
    setAnswers(prev => ({ ...prev, [wordId]: nextAnswer }))
    setComposing(prev => ({ ...prev, [wordId]: '' }))
    setSuggestions(prev => { const n = { ...prev }; delete n[wordId]; return n })
    gradeIfReady(wordId, nextAnswer)
  }

  const dismissSuggestions = (wordId: string) => {
    if (debounceRefs.current[wordId]) clearTimeout(debounceRefs.current[wordId])
    setSuggestions(prev => { const n = { ...prev }; delete n[wordId]; return n })
  }

  const resetRow = (wordId: string) => {
    setAnswers(prev => ({ ...prev, [wordId]: '' }))
    setComposing(prev => ({ ...prev, [wordId]: '' }))
    setGraded(prev => { const n = { ...prev }; delete n[wordId]; return n })
    setCorrect(prev => { const n = { ...prev }; delete n[wordId]; return n })
    setSuggestions(prev => { const n = { ...prev }; delete n[wordId]; return n })
  }

  useEffect(() => {
    // New batch of words: wipe all per-row state so a re-mounted round starts fresh.
    setComposing({})
    setAnswers({})
    setSuggestions({})
    setGraded({})
    setCorrect({})
    setSubmitted(false)
  }, [words])

  const gradedCount = words.filter(w => graded[w.id]).length
  const allGraded = words.length > 0 && gradedCount === words.length

  // Submitting no longer requires every row to be graded — whatever wasn't filled in
  // (or was filled in wrong) is reported back as "incorrect" so the caller can queue
  // those specific words for next time, instead of blocking the whole stage on them.
  const handleSubmit = () => {
    setSubmitted(true)
    const correctIds: string[] = []
    const incorrectIds: string[] = []
    for (const w of words) {
      if (graded[w.id] && correct[w.id]) correctIds.push(w.id)
      else incorrectIds.push(w.id)
    }
    onComplete({ correctIds, incorrectIds })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between text-xs font-black text-slate-500">
          <span>TIẾN ĐỘ: {gradedCount} / {words.length} TỪ</span>
          <span>{Math.round((gradedCount / words.length) * 100)}%</span>
        </div>
        <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full transition-all duration-300"
            style={{ width: `${(gradedCount / words.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="cartoon-panel bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[1fr_2fr_1fr_1fr_1.6fr] gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-400">
              <span>Chữ Hán</span>
              <span>Đáp Án</span>
              <span className="text-center">Kết Quả</span>
              <span>Pinyin</span>
              <span>Nghĩa</span>
            </div>

            {words.map((w) => {
              const isGraded = !!graded[w.id]
              const isCorrect = !!correct[w.id]
              const isSkipped = submitted && !isGraded
              const revealed = isGraded || submitted
              const answer = answers[w.id] || ''
              const rowSuggestions = suggestions[w.id] || []
              return (
                <div
                  key={w.id}
                  className={`grid grid-cols-[1fr_2fr_1fr_1fr_1.6fr] gap-2 px-4 py-3 border-b border-slate-100 last:border-b-0 items-center transition-colors ${
                    isGraded ? (isCorrect ? 'bg-emerald-50/50' : 'bg-red-50/40') : isSkipped ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-chinese text-2xl text-slate-800 select-none">{w.hanzi}</span>
                    <button
                      type="button"
                      onClick={() => speak(w.hanzi)}
                      className="cursor-pointer p-1 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors shrink-0"
                      title="Phát âm"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="relative">
                    {isGraded || isSkipped ? (
                      <div className="flex items-center gap-2">
                        <span className="font-chinese text-xl text-slate-700">{answer || '—'}</span>
                        {!submitted && (
                          <button
                            type="button"
                            onClick={() => resetRow(w.id)}
                            className="cursor-pointer p-1 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Làm lại từ này"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          {answer && (
                            <span className="font-chinese text-lg text-blue-600 shrink-0">{answer}</span>
                          )}
                          <input
                            type="text"
                            value={composing[w.id] || ''}
                            onFocus={() => loadTocflIndex()}
                            onChange={(e) => updateComposing(w.id, e.target.value)}
                            placeholder="Gõ pinyin hoặc gõ chữ Hán..."
                            className="w-full px-3 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold text-sm bg-white"
                          />
                          {answer && (
                            <button
                              type="button"
                              onClick={() => resetRow(w.id)}
                              className="cursor-pointer text-[10px] font-black text-red-400 hover:text-red-600 shrink-0"
                            >
                              Xóa
                            </button>
                          )}
                        </div>

                        {rowSuggestions.length > 0 && (
                          <div
                            className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-1.5 space-y-0.5 max-h-52 overflow-y-auto"
                            style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 200 }}
                          >
                            <div className="flex items-center justify-between gap-1.5 px-2 py-1">
                              <span className="text-[9px] font-black text-blue-500 uppercase tracking-wider">
                                ⌨️ TOCFL 繁體 — {rowSuggestions.length} gợi ý
                              </span>
                              <button
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); dismissSuggestions(w.id) }}
                                className="cursor-pointer p-0.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                                title="Tắt gợi ý"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {rowSuggestions.map((item, sugIdx) => (
                              <button
                                key={sugIdx}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); selectSuggestion(w.id, item) }}
                                className="cursor-pointer w-full text-left px-2.5 py-2 flex items-center gap-3 hover:bg-blue-50 rounded-xl transition-colors"
                              >
                                <span className="font-chinese text-lg text-blue-600 min-w-[2rem]">{item.t}</span>
                                <span className="text-slate-500 font-semibold text-xs flex-1">{item.p}</span>
                                {'composed' in item ? (
                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 bg-purple-100 text-purple-700">Ghép từ</span>
                                ) : item.l === null ? (
                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 bg-slate-100 text-slate-500">詞典</span>
                                ) : (
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${item.l <= 2 ? 'bg-green-100 text-green-700' : item.l <= 4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                    L{item.l}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex justify-center">
                    {isGraded ? (
                      isCorrect ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-600">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Đúng
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full bg-red-100 text-red-500">
                          <XCircle className="w-3.5 h-3.5" /> Sai
                        </span>
                      )
                    ) : isSkipped ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-600">
                        <XCircle className="w-3.5 h-3.5" /> Chưa điền
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs font-bold">—</span>
                    )}
                  </div>

                  <span className={`text-sm font-bold ${revealed ? 'text-slate-700' : 'text-slate-300 select-none'}`}>
                    {revealed ? w.pinyin : '•••••••'}
                  </span>

                  <span className={`text-sm font-bold ${revealed ? 'text-slate-700' : 'text-slate-300 select-none'}`}>
                    {revealed ? w.vietnamese : '•••••••'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitted}
        className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
      >
        <PartyPopper className="w-4 h-4" />{' '}
        {allGraded ? 'Hoàn Thành Đợt' : `Nộp Bài (còn ${words.length - gradedCount} từ chưa điền)`}
      </button>
    </div>
  )
}
