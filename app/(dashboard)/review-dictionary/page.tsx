'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { shuffleArray } from '@/lib/utils/shuffle'
import { sortLevels, LEVEL_ORDER } from '@/lib/utils/dictionaryLevels'
import { fetchAllRows } from '@/lib/utils/supabasePagination'
import { ensureProfile } from '@/lib/utils/ensureProfile'
import Flashcard from '@/components/learn/Flashcard'
import MatchingExercise from '@/components/exercises/MatchingExercise'
import FillInExercise from '@/components/exercises/FillInExercise'
import {
  ArrowRight,
  ArrowLeft,
  Sparkles,
  CheckCircle,
  XCircle,
  Trophy,
  RotateCcw,
  BookOpen,
  Puzzle,
  GraduationCap,
  Layers,
  Keyboard,
  AlertTriangle,
} from 'lucide-react'
import confetti from 'canvas-confetti'

interface DictWord {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
  example_hanzi: string | null
  example_pinyin: string | null
  example_vietnamese: string | null
}

interface LevelInfo {
  level: string
  total: number
  learnedFlashcard: number
  // learnedFlashcard minus words currently flagged "không biết" — the actual pool
  // Điền Từ is allowed to draw from, and what "Đã biết" means on the level card.
  knownFlashcard: number
  unknownCount: number
  unknownResolvedCount: number
  learnedFillIn: number
}

type StudyMode = 'flashcard' | 'fill_in'

interface FlashcardProgressRow {
  word_order: string[]
  current_index: number
  unknown_word_ids?: string[] | null
}

// Words reviewed via Flashcard, minus whatever's currently flagged "không biết" —
// the pool Điền Từ is actually allowed to draw from (see KNOWLEDGE.md).
function getKnownIds(progress: FlashcardProgressRow | null | undefined): string[] {
  if (!progress) return []
  const unknownSet = new Set(progress.unknown_word_ids || [])
  return progress.word_order.slice(0, progress.current_index).filter((id) => !unknownSet.has(id))
}

const STAGE_SIZE_PRESETS = [10, 20, 30, 50]
const DEFAULT_STAGE_SIZE = 50
const ITEMS_PER_ROUND = 6

// Small circular progress indicator used on each level card — a quick "at a glance"
// read on how far along a level is, complementing the linear bar underneath it.
function ProgressRing({ percent, size = 52, stroke = 5 }: { percent: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#eef0f3" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#34d399"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-black text-slate-600">{Math.round(percent)}%</span>
      </div>
    </div>
  )
}

// Horizontal stepper shown at the top of the flashcard/matching/complete screens so
// it's always visually clear where you are in the "học thẻ → nối từ → hoàn thành"
// pipeline for the current stage, instead of just a bare "Đợt X/Y" label.
function StepTracker({ current, mode }: { current: number; mode: StudyMode }) {
  const steps: { n: number; label: string; icon: typeof BookOpen }[] =
    mode === 'fill_in'
      ? [
          { n: 1, label: 'Điền Từ', icon: Keyboard },
          { n: 2, label: 'Hoàn Thành', icon: Trophy },
        ]
      : [
          { n: 1, label: 'Flashcards', icon: BookOpen },
          { n: 2, label: 'Nối Từ', icon: Puzzle },
          { n: 3, label: 'Hoàn Thành', icon: Trophy },
        ]
  return (
    <div className="flex items-center justify-center gap-1.5 sm:gap-2 py-1">
      {steps.map((s, i) => {
        const Icon = s.icon
        const state = s.n < current ? 'done' : s.n === current ? 'active' : 'upcoming'
        return (
          <React.Fragment key={s.n}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                  state === 'done'
                    ? 'bg-emerald-400 border-emerald-500 text-white'
                    : state === 'active'
                    ? 'bg-[#1877f2] border-blue-600 text-white shadow-md scale-110'
                    : 'bg-white border-slate-200 text-slate-300'
                }`}
              >
                {state === 'done' ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={`text-[10px] font-black uppercase tracking-wide ${state === 'upcoming' ? 'text-slate-300' : 'text-slate-600'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-8 sm:w-16 rounded-full mb-4 transition-all ${s.n < current ? 'bg-emerald-400' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default function ReviewDictionaryPage() {
  const supabase = createClient()

  const [levelInfos, setLevelInfos] = useState<LevelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeLevel, setActiveLevel] = useState<string | null>(null)

  // Level clicked but mode (Flashcard vs Điền Từ) not yet chosen — shows the mode-select modal
  const [modeSelectLevel, setModeSelectLevel] = useState<string | null>(null)
  // Level waiting for reset confirmation
  const [resetConfirmLevel, setResetConfirmLevel] = useState<string | null>(null)
  // Mode chosen for the level currently being studied/set up
  const [activeMode, setActiveMode] = useState<StudyMode>('flashcard')
  // True when the current/pending Flashcard session is drilling the "không biết"
  // pool (via "Học Từ Không Biết") instead of new words — only meaningful when
  // activeMode === 'flashcard'.
  const [unknownReviewMode, setUnknownReviewMode] = useState(false)

  // Level+mode picked but not yet started — shows the "how many words per round?" chooser
  const [pendingLevel, setPendingLevel] = useState<string | null>(null)
  const [stageSizeChoice, setStageSizeChoice] = useState<number>(DEFAULT_STAGE_SIZE)
  const [customStageSize, setCustomStageSize] = useState('')
  // The size actually used for the level currently in progress (kept stable across its stages)
  const [stageSize, setStageSize] = useState(DEFAULT_STAGE_SIZE)

  const [step, setStep] = useState<'select' | 'flashcard' | 'fill_in' | 'matching' | 'complete'>('select')
  const [stageWords, setStageWords] = useState<DictWord[]>([])
  const [stageNumber, setStageNumber] = useState(1)
  const [totalStages, setTotalStages] = useState(1)
  const [levelFullyComplete, setLevelFullyComplete] = useState(false)

  const [flashIdx, setFlashIdx] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)

  const [matchingRound, setMatchingRound] = useState(0)
  const [matchingType, setMatchingType] = useState<'hanzi_pinyin' | 'hanzi_viet'>('hanzi_pinyin')
  const [roundVocabs, setRoundVocabs] = useState<DictWord[]>([])

  // Progress is persisted as soon as the flashcards for a stage are done (not only at
  // the very end of matching), so exiting partway through the matching rounds never
  // makes already-seen words reappear — this ref guards against double-advancing.
  const progressAdvancedRef = useRef(false)

  // Live copy of the active level's flashcard-mode unknown_word_ids/unknown_resolved_count
  // — populated whenever a flashcard session (normal or unknown-review) starts, mutated
  // and persisted immediately on every Biết/Không Biết tap (see persistUnknownState).
  const unknownIdsRef = useRef<string[]>([])
  const unknownResolvedRef = useRef<number>(0)
  // Mirrors unknownIdsRef.current.length for display purposes — refs can't be read
  // during render (React rules-of-hooks), so this is updated in lockstep everywhere
  // unknownIdsRef.current is reassigned.
  const [unknownRemaining, setUnknownRemaining] = useState(0)

  async function loadLevelInfos() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Safety net matching /vocabulary's loadVocab — dictionary_progress.user_id has
      // a FK to profiles, and this page can be a user's very first stop after signup
      // (no guarantee /vocabulary ran first to lazily create that row), which would
      // otherwise 409 the first startLevel()/upsert with a foreign-key violation.
      await ensureProfile(supabase)

      // Per-level exact counts via head:true requests (no rows fetched, no cap issue),
      // instead of pulling every dictionary_words row and counting client-side — the
      // latter silently truncated at PostgREST's default 1000-row cap once Band B
      // pushed the table past that (previously invisible at ~900 total rows).
      const counts: Record<string, number> = {}
      await Promise.all(
        LEVEL_ORDER.map(async (level) => {
          const { count } = await supabase
            .from('dictionary_words')
            .select('id', { count: 'exact', head: true })
            .eq('level', level)
          if (count) counts[level] = count
        })
      )

      const { data: progressRows } = await supabase
        .from('dictionary_progress')
        .select('level, mode, current_index, unknown_word_ids, unknown_resolved_count')
        .eq('user_id', user.id)

      const progressByLevelMode: Record<string, Record<string, number>> = {}
      const unknownByLevel: Record<string, { count: number; resolved: number }> = {}
      for (const p of progressRows || []) {
        if (!progressByLevelMode[p.level]) progressByLevelMode[p.level] = {}
        progressByLevelMode[p.level][p.mode] = p.current_index
        if (p.mode === 'flashcard') {
          unknownByLevel[p.level] = {
            count: (p.unknown_word_ids || []).length,
            resolved: p.unknown_resolved_count || 0,
          }
        }
      }

      const levels = sortLevels(Object.keys(counts))
      setLevelInfos(
        levels.map((level) => {
          const total = counts[level] || 0
          const learnedFlashcard = Math.min(progressByLevelMode[level]?.['flashcard'] || 0, total)
          const unknownCount = Math.min(unknownByLevel[level]?.count || 0, learnedFlashcard)
          const unknownResolvedCount = unknownByLevel[level]?.resolved || 0
          const knownFlashcard = learnedFlashcard - unknownCount
          const learnedFillIn = Math.min(progressByLevelMode[level]?.['fill_in'] || 0, knownFlashcard)
          return {
            level,
            total,
            learnedFlashcard,
            knownFlashcard,
            unknownCount,
            unknownResolvedCount,
            learnedFillIn,
          }
        })
      )
    } catch (err) {
      console.error('Lỗi khi tải danh sách cấp độ:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLevelInfos()
  }, [])

  async function startLevel(level: string, size: number) {
    setLoading(true)
    setStageSize(size)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const allWords = await fetchAllRows<{ id: string }>((from, to) =>
        supabase
          .from('dictionary_words')
          .select('id')
          .eq('level', level)
          .order('order_index', { ascending: true })
          .range(from, to)
      )

      const allIds = allWords.map((w) => w.id)
      if (allIds.length === 0) { setLoading(false); return }

      if (activeMode === 'fill_in') {
        let { data: flashcardProgress } = await supabase
          .from('dictionary_progress')
          .select('*')
          .eq('user_id', user.id)
          .eq('level', level)
          .eq('mode', 'flashcard')
          .maybeSingle()

        const learnedIds = getKnownIds(flashcardProgress)

        if (learnedIds.length === 0) {
          setLoading(false)
          return
        }

        let { data: fillInProgress } = await supabase
          .from('dictionary_progress')
          .select('*')
          .eq('user_id', user.id)
          .eq('level', level)
          .eq('mode', 'fill_in')
          .maybeSingle()

        let newWordOrder: string[] = []
        let newCurrentIndex = 0

        if (fillInProgress) {
          const completedFillInIds = fillInProgress.word_order
            .slice(0, fillInProgress.current_index)
            .filter((id: string) => learnedIds.includes(id))

          const remainingLearnedIds = learnedIds.filter((id: string) => !completedFillInIds.includes(id))
          newWordOrder = [...completedFillInIds, ...shuffleArray(remainingLearnedIds)]
          newCurrentIndex = completedFillInIds.length
        } else {
          newWordOrder = shuffleArray(learnedIds)
          newCurrentIndex = 0
        }

        const { data: upserted } = await supabase
          .from('dictionary_progress')
          .upsert(
            {
              user_id: user.id,
              level,
              mode: 'fill_in',
              word_order: newWordOrder,
              current_index: newCurrentIndex,
              updated_at: new Date().toISOString()
            },
            { onConflict: 'user_id,level,mode' }
          )
          .select('*')
          .single()

        if (!upserted) { setLoading(false); return }
        await loadStage(level, upserted.word_order, upserted.current_index, learnedIds.length, size)
      } else {
        let { data: progress } = await supabase
          .from('dictionary_progress')
          .select('*')
          .eq('user_id', user.id)
          .eq('level', level)
          .eq('mode', activeMode)
          .maybeSingle()

        const storedIds: string[] = progress ? progress.word_order : []
        const idsMatch =
          progress && storedIds.length === allIds.length &&
          new Set(storedIds).size === new Set(allIds).size &&
          [...new Set(storedIds)].every((id) => allIds.includes(id))

        if (!progress || !idsMatch) {
          const wordOrder = shuffleArray(allIds)
          const { data: upserted } = await supabase
            .from('dictionary_progress')
            .upsert(
              { user_id: user.id, level, mode: activeMode, word_order: wordOrder, current_index: 0 },
              { onConflict: 'user_id,level,mode' }
            )
            .select('*')
            .single()
          progress = upserted
        }

        if (!progress) { setLoading(false); return }
        if (activeMode === 'flashcard') {
          unknownIdsRef.current = progress.unknown_word_ids || []
          unknownResolvedRef.current = progress.unknown_resolved_count || 0
          setUnknownRemaining(unknownIdsRef.current.length)
        }
        await loadStage(level, progress.word_order, progress.current_index, allIds.length, size)
      }
    } catch (err) {
      console.error('Lỗi khi bắt đầu ôn tập:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadStage(level: string, wordOrder: string[], currentIndex: number, total: number, size: number) {
    setActiveLevel(level)
    const stageIds = wordOrder.slice(currentIndex, currentIndex + size)

    if (stageIds.length === 0) {
      setLevelFullyComplete(true)
      setStep('complete')
      return
    }

    const { data: wordsData } = await supabase
      .from('dictionary_words')
      .select('id, hanzi, pinyin, vietnamese, example_hanzi, example_pinyin, example_vietnamese')
      .in('id', stageIds)

    const byId: Record<string, DictWord> = {}
    for (const w of wordsData || []) byId[w.id] = w
    // Shuffle the presentation order each time a stage is (re-)entered, so flashcards
    // and matching rounds never play out in the same fixed sequence twice — this is
    // purely a display-order shuffle and doesn't affect which words belong to the stage.
    const ordered = shuffleArray(stageIds.map((id) => byId[id]).filter(Boolean))

    setStageWords(ordered)
    setStageNumber(Math.floor(currentIndex / size) + 1)
    setTotalStages(Math.ceil(total / size))
    setLevelFullyComplete(false)
    setFlashIdx(0)
    setIsFlipped(false)
    progressAdvancedRef.current = false
    setStep(activeMode === 'fill_in' ? 'fill_in' : 'flashcard')
  }

  // Draws a shuffled batch straight from the level's current unknown_word_ids pool —
  // a dead-end reshuffle draw (no word_order/current_index pagination), same shape as
  // the "review already learned" flows elsewhere in this codebase (see KNOWLEDGE.md).
  async function startUnknownReview(level: string, size: number) {
    setLoading(true)
    setStageSize(size)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: progress } = await supabase
        .from('dictionary_progress')
        .select('unknown_word_ids, unknown_resolved_count')
        .eq('user_id', user.id)
        .eq('level', level)
        .eq('mode', 'flashcard')
        .maybeSingle()

      const unknownIds: string[] = progress?.unknown_word_ids || []
      unknownIdsRef.current = unknownIds
      unknownResolvedRef.current = progress?.unknown_resolved_count || 0
      setUnknownRemaining(unknownIds.length)

      if (unknownIds.length === 0) { setLoading(false); return }

      const batch = shuffleArray(unknownIds).slice(0, size)
      await loadUnknownStage(level, batch)
    } catch (err) {
      console.error('Lỗi khi bắt đầu ôn tập từ chưa biết:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadUnknownStage(level: string, ids: string[]) {
    setActiveLevel(level)
    const { data: wordsData } = await supabase
      .from('dictionary_words')
      .select('id, hanzi, pinyin, vietnamese, example_hanzi, example_pinyin, example_vietnamese')
      .in('id', ids)

    const byId: Record<string, DictWord> = {}
    for (const w of wordsData || []) byId[w.id] = w
    const ordered = shuffleArray(ids.map((id) => byId[id]).filter(Boolean))

    setStageWords(ordered)
    setStageNumber(1)
    setTotalStages(1)
    setLevelFullyComplete(false)
    setFlashIdx(0)
    setIsFlipped(false)
    progressAdvancedRef.current = false
    setStep('flashcard')
  }

  // Persists progress as soon as the flashcards for this stage are finished, so the
  // words are marked "done" and won't repeat even if the user exits during matching.
  const persistProgressAdvance = async () => {
    if (!activeLevel || progressAdvancedRef.current) return
    progressAdvancedRef.current = true
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: progress } = await supabase
        .from('dictionary_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('level', activeLevel)
        .eq('mode', activeMode)
        .single()

      if (!progress) return

      const newIndex = Math.min(progress.current_index + stageWords.length, progress.word_order.length)
      await supabase
        .from('dictionary_progress')
        .update({ current_index: newIndex, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('level', activeLevel)
        .eq('mode', activeMode)

      const fullyComplete = newIndex >= progress.word_order.length
      setLevelFullyComplete(fullyComplete)

      setLevelInfos((prev) =>
        prev.map((l) =>
          l.level === activeLevel
            ? activeMode === 'fill_in'
              ? { ...l, learnedFillIn: newIndex }
              : { ...l, learnedFlashcard: newIndex }
            : l
        )
      )
    } catch (err) {
      console.error('Lỗi khi lưu tiến độ:', err)
    }
  }

  // Persists the live unknownIdsRef/unknownResolvedRef to the level's flashcard
  // progress row immediately (not batched with persistProgressAdvance) — each
  // Biết/Không Biết tap is a discrete, user-visible "save" action.
  const persistUnknownState = async (newIds: string[], newResolved: number) => {
    if (!activeLevel) return
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('dictionary_progress')
        .update({ unknown_word_ids: newIds, unknown_resolved_count: newResolved, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('level', activeLevel)
        .eq('mode', 'flashcard')

      setLevelInfos((prev) =>
        prev.map((l) =>
          l.level === activeLevel
            ? { ...l, unknownCount: newIds.length, unknownResolvedCount: newResolved, knownFlashcard: l.learnedFlashcard - newIds.length }
            : l
        )
      )
    } catch (err) {
      console.error('Lỗi khi lưu trạng thái từ chưa biết:', err)
    }
  }

  const advanceFlash = () => {
    setIsFlipped(false)
    if (flashIdx < stageWords.length - 1) {
      setFlashIdx(flashIdx + 1)
    } else if (unknownReviewMode) {
      setStep('complete')
    } else {
      persistProgressAdvance()
      setMatchingRound(0)
      setMatchingType('hanzi_pinyin')
      prepareMatchingRound(0)
      setStep('matching')
    }
  }

  const handleMarkKnown = () => {
    const word = stageWords[flashIdx]
    if (word && unknownIdsRef.current.includes(word.id)) {
      unknownIdsRef.current = unknownIdsRef.current.filter((id) => id !== word.id)
      unknownResolvedRef.current += 1
      setUnknownRemaining(unknownIdsRef.current.length)
      persistUnknownState(unknownIdsRef.current, unknownResolvedRef.current)
    }
    advanceFlash()
  }

  const handleMarkUnknown = () => {
    const word = stageWords[flashIdx]
    if (word && !unknownReviewMode && !unknownIdsRef.current.includes(word.id)) {
      unknownIdsRef.current = [...unknownIdsRef.current, word.id]
      setUnknownRemaining(unknownIdsRef.current.length)
      persistUnknownState(unknownIdsRef.current, unknownResolvedRef.current)
    }
    advanceFlash()
  }

  const handleFlashPrev = () => {
    setIsFlipped(false)
    if (flashIdx > 0) setFlashIdx(flashIdx - 1)
  }

  const prepareMatchingRound = (roundIndex: number) => {
    const start = roundIndex * ITEMS_PER_ROUND
    const end = Math.min(start + ITEMS_PER_ROUND, stageWords.length)
    setRoundVocabs(stageWords.slice(start, end))
  }

  const handleRoundComplete = async () => {
    const totalRounds = Math.ceil(stageWords.length / ITEMS_PER_ROUND)

    confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } })

    if (matchingRound < totalRounds - 1) {
      const nextRound = matchingRound + 1
      setMatchingRound(nextRound)
      prepareMatchingRound(nextRound)
      return
    }

    if (matchingType === 'hanzi_pinyin') {
      setMatchingType('hanzi_viet')
      setMatchingRound(0)
      prepareMatchingRound(0)
    } else {
      await finishStage()
    }
  }

  const finishStage = async () => {
    // Progress was already persisted right after the flashcards finished (see
    // persistProgressAdvance) — this just shows the results screen. Call it again
    // defensively in case flashcards were somehow skipped (it's a no-op if already done).
    await persistProgressAdvance()
    setStep('complete')
    if (levelFullyComplete) triggerGrandConfetti()
  }

  const continueNextStage = async () => {
    if (!activeLevel) return
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      if (activeMode === 'fill_in') {
        let { data: flashcardProgress } = await supabase
          .from('dictionary_progress')
          .select('*')
          .eq('user_id', user.id)
          .eq('level', activeLevel)
          .eq('mode', 'flashcard')
          .maybeSingle()

        const learnedIds = getKnownIds(flashcardProgress)

        let { data: fillInProgress } = await supabase
          .from('dictionary_progress')
          .select('*')
          .eq('user_id', user.id)
          .eq('level', activeLevel)
          .eq('mode', 'fill_in')
          .maybeSingle()

        if (fillInProgress) {
          const completedFillInIds = fillInProgress.word_order
            .slice(0, fillInProgress.current_index)
            .filter((id: string) => learnedIds.includes(id))

          const remainingLearnedIds = learnedIds.filter((id: string) => !completedFillInIds.includes(id))
          const newWordOrder = [...completedFillInIds, ...shuffleArray(remainingLearnedIds)]
          const newCurrentIndex = completedFillInIds.length

          const { data: upserted } = await supabase
            .from('dictionary_progress')
            .update({
              word_order: newWordOrder,
              current_index: newCurrentIndex,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', user.id)
            .eq('level', activeLevel)
            .eq('mode', 'fill_in')
            .select('*')
            .single()

          if (upserted) {
            await loadStage(activeLevel, upserted.word_order, upserted.current_index, learnedIds.length, stageSize)
            return
          }
        }
      }

      const { data: progress } = await supabase
        .from('dictionary_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('level', activeLevel)
        .eq('mode', activeMode)
        .single()
      if (!progress) return
      if (activeMode === 'flashcard') {
        unknownIdsRef.current = progress.unknown_word_ids || []
        unknownResolvedRef.current = progress.unknown_resolved_count || 0
        setUnknownRemaining(unknownIdsRef.current.length)
      }
      await loadStage(activeLevel, progress.word_order, progress.current_index, progress.word_order.length, stageSize)
    } finally {
      setLoading(false)
    }
  }

  const restartLevel = async () => {
    if (!activeLevel) return
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      let wordOrder: string[] = []

      if (activeMode === 'fill_in') {
        let { data: flashcardProgress } = await supabase
          .from('dictionary_progress')
          .select('*')
          .eq('user_id', user.id)
          .eq('level', activeLevel)
          .eq('mode', 'flashcard')
          .maybeSingle()
        const learnedIds = getKnownIds(flashcardProgress)
        wordOrder = shuffleArray(learnedIds)
      } else {
        const allWords = await fetchAllRows<{ id: string }>((from, to) =>
          supabase
            .from('dictionary_words')
            .select('id')
            .eq('level', activeLevel)
            .range(from, to)
        )
        const allIds = allWords.map((w) => w.id)
        wordOrder = shuffleArray(allIds)
      }

      await supabase
        .from('dictionary_progress')
        .update({
          word_order: wordOrder,
          current_index: 0,
          ...(activeMode === 'flashcard' ? { unknown_word_ids: [], unknown_resolved_count: 0 } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('level', activeLevel)
        .eq('mode', activeMode)

      if (activeMode === 'flashcard') {
        unknownIdsRef.current = []
        unknownResolvedRef.current = 0
        setUnknownRemaining(0)
      }

      setLevelInfos((prev) =>
        prev.map((l) =>
          l.level === activeLevel
            ? activeMode === 'fill_in'
              ? { ...l, learnedFillIn: 0 }
              : { ...l, learnedFlashcard: 0, knownFlashcard: 0, unknownCount: 0, unknownResolvedCount: 0 }
            : l
        )
      )
      setStep('select')
      setActiveLevel(null)
      setUnknownReviewMode(false)
    } finally {
      setLoading(false)
    }
  }

  const resetFlashcardAndStart = async (level: string) => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const allWords = await fetchAllRows<{ id: string }>((from, to) =>
        supabase
          .from('dictionary_words')
          .select('id')
          .eq('level', level)
          .range(from, to)
      )
      const allIds = allWords.map((w) => w.id)
      const wordOrder = shuffleArray(allIds)

      await supabase
        .from('dictionary_progress')
        .upsert(
          {
            user_id: user.id,
            level,
            mode: 'flashcard',
            word_order: wordOrder,
            current_index: 0,
            unknown_word_ids: [],
            unknown_resolved_count: 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,level,mode' }
        )

      unknownIdsRef.current = []
      unknownResolvedRef.current = 0
      setUnknownRemaining(0)

      setLevelInfos((prev) =>
        prev.map((l) =>
          l.level === level
            ? { ...l, learnedFlashcard: 0, knownFlashcard: 0, unknownCount: 0, unknownResolvedCount: 0 }
            : l
        )
      )

      setActiveMode('flashcard')
      setUnknownReviewMode(false)
      setPendingLevel(level)
      setStageSizeChoice(Math.min(allIds.length, DEFAULT_STAGE_SIZE))
      setCustomStageSize('')
    } catch (err) {
      console.error('Lỗi khi học lại từ đầu:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleRestartFillInDirectly = async (level: string) => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      let { data: flashcardProgress } = await supabase
        .from('dictionary_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('level', level)
        .eq('mode', 'flashcard')
        .maybeSingle()
      const learnedIds = getKnownIds(flashcardProgress)

      const wordOrder = shuffleArray(learnedIds)

      await supabase
        .from('dictionary_progress')
        .upsert(
          {
            user_id: user.id,
            level,
            mode: 'fill_in',
            word_order: wordOrder,
            current_index: 0,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id,level,mode' }
        )

      setLevelInfos((prev) =>
        prev.map((l) =>
          l.level === level
            ? { ...l, learnedFillIn: 0 }
            : l
        )
      )
      setPendingLevel(null)
    } finally {
      setLoading(false)
    }
  }

  const triggerGrandConfetti = () => {
    const duration = 3 * 1000
    const end = Date.now() + duration
    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 } })
      confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 } })
      if (Date.now() < end) requestAnimationFrame(frame)
    }
    frame()
  }

  const getMatchingTitle = () => {
    if (matchingType === 'hanzi_pinyin') return 'Vòng 1: Chữ Hán ↔ Phiên âm'
    return 'Vòng 2: Chữ Hán ↔ Nghĩa Việt'
  }

  const info = levelInfos.find((l) => l.level === pendingLevel)
  const learnedFlashcard = info?.learnedFlashcard ?? 0
  const knownFlashcard = info?.knownFlashcard ?? 0
  const unknownCount = info?.unknownCount ?? 0
  const unknownResolvedCount = info?.unknownResolvedCount ?? 0
  const learnedFillIn = info?.learnedFillIn ?? 0
  const remaining = unknownReviewMode
    ? unknownCount
    : activeMode === 'fill_in'
    ? (knownFlashcard - learnedFillIn)
    : (info ? (info.total - info.learnedFlashcard) : 0)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
        <span>📔</span> Ôn Tập Theo Từ Điển
        <span className="text-[#1877f2] animate-sparkle">✦</span>
      </h2>

      {step === 'select' ? (
        <div className="space-y-6">
          {!pendingLevel ? (
            <>
              <div className="relative overflow-hidden bg-gradient-to-r from-blue-400 to-sky-500 text-white p-6 rounded-[24px] shadow-sm space-y-2">
                <GraduationCap className="w-28 h-28 absolute -right-4 -bottom-6 text-white/15 rotate-[-12deg] pointer-events-none" />
                <h3 className="text-xl font-extrabold flex items-center gap-2 relative">
                  <Sparkles className="w-6 h-6 animate-pulse" /> Chọn Cấp Độ Để Ôn Tập
                </h3>
                <p className="font-semibold text-sm text-white/90 relative max-w-lg">
                  Mỗi cấp độ được chia thành nhiều đợt (bạn chọn số từ mỗi đợt). Học hết đợt này sẽ chuyển sang
                  đợt tiếp theo, không lặp lại từ đã học cho đến khi hoàn thành toàn bộ cấp độ.
                </p>
              </div>

              {loading ? (
                <div className="cartoon-card p-8 bg-white text-center">
                  <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <p className="text-xs text-slate-400 font-bold">Đang tải dữ liệu từ điển...</p>
                </div>
              ) : levelInfos.length === 0 ? (
                <div className="cartoon-card p-8 bg-white text-center space-y-2">
                  <span className="text-5xl inline-block">📭</span>
                  <p className="text-slate-400 font-semibold">Chưa có dữ liệu từ điển. Vui lòng import từ điển trước.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {levelInfos.map((info) => {
                    const bothDone = info.learnedFlashcard >= info.total && info.learnedFillIn >= info.total
                    const pctFlash = info.total ? (info.learnedFlashcard / info.total) * 100 : 0
                    const pctFillIn = info.total ? (info.learnedFillIn / info.total) * 100 : 0
                    return (
                      <button
                        key={info.level}
                        onClick={() => setModeSelectLevel(info.level)}
                        className="cartoon-card cursor-pointer p-5 bg-white text-left space-y-3"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-800 text-xl">{info.level}</span>
                          {bothDone && (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 whitespace-nowrap">
                              🎉 Hoàn thành
                            </span>
                          )}
                          <ArrowRight className="w-4 h-4 text-slate-300 shrink-0 ml-auto" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <ProgressRing percent={pctFlash} size={40} stroke={4} />
                            <div className="min-w-0">
                              <p className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
                                <BookOpen className="w-3 h-3 shrink-0" /> Flashcard
                              </p>
                              <p className="text-[11px] font-bold text-slate-500 truncate">{info.learnedFlashcard}/{info.total}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            <ProgressRing percent={pctFillIn} size={40} stroke={4} />
                            <div className="min-w-0">
                              <p className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
                                <Keyboard className="w-3 h-3 shrink-0" /> Điền Từ
                              </p>
                              <p className="text-[11px] font-bold text-slate-500 truncate">{info.learnedFillIn}/{info.total}</p>
                            </div>
                          </div>
                        </div>
                        {(info.unknownCount > 0 || info.unknownResolvedCount > 0) && (
                          <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <p className="text-[11px] font-bold text-amber-600">
                              {info.unknownCount} từ chưa biết
                              <span className="text-slate-400 font-semibold">
                                {' '}· đã ôn lại {info.unknownResolvedCount}/{info.unknownResolvedCount + info.unknownCount}
                              </span>
                            </p>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          ) : remaining === 0 ? (
            <div className="cartoon-card p-6 bg-white space-y-4 text-center">
              <button
                onClick={() => setPendingLevel(null)}
                className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 mx-auto"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Quay lại chọn cấp độ
              </button>
              <div className="py-6 space-y-3">
                <span className="text-4xl block">⚠️</span>
                <h4 className="font-black text-slate-800 text-base">Không có từ nào để ôn tập</h4>
                <p className="text-slate-500 text-xs font-semibold max-w-sm mx-auto">
                  {unknownReviewMode
                    ? 'Bạn không còn từ nào ở nhóm "chưa biết" trong cấp độ này.'
                    : activeMode === 'fill_in'
                    ? knownFlashcard === 0
                      ? 'Bạn chưa học từ nào ở chế độ Flashcard. Vui lòng học Flashcard trước khi làm bài tập Điền Từ.'
                      : 'Bạn đã hoàn thành bài tập Điền Từ cho tất cả các từ đã biết ở Flashcard. Hãy tiếp tục học thêm từ mới ở Flashcard!'
                    : 'Bạn đã học hết tất cả các từ trong cấp độ này bằng Flashcard!'}
                </p>
                {!unknownReviewMode && activeMode === 'fill_in' && learnedFlashcard > 0 && (
                  <button
                    onClick={async () => {
                      if (window.confirm('Bạn có muốn ôn lại từ đầu chế độ Điền Từ cho cấp độ này không?')) {
                        await handleRestartFillInDirectly(pendingLevel)
                      }
                    }}
                    className="cartoon-btn py-2.5 px-5 text-xs inline-flex items-center gap-1 mx-auto"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Học lại từ đầu Điền Từ
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="cartoon-card p-6 bg-white space-y-4">
              <button
                onClick={() => setPendingLevel(null)}
                className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Quay lại chọn cấp độ
              </button>

              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 shrink-0">
                  {unknownReviewMode ? <AlertTriangle className="w-5 h-5" /> : activeMode === 'fill_in' ? <Keyboard className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
                </div>
                <div>
                  <h4 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    {pendingLevel} — Số từ mỗi đợt ôn
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">
                      {unknownReviewMode ? 'Từ Không Biết' : activeMode === 'fill_in' ? 'Điền Từ' : 'Flashcard'}
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500 font-semibold">
                    {unknownReviewMode
                      ? 'Ôn lại các từ bạn đã đánh dấu "Không Biết" — chọn Biết để từ đó không hiện lại nữa.'
                      : activeMode === 'fill_in'
                      ? 'Học xong đợt điền từ này sẽ chuyển sang đợt tiếp theo.'
                      : 'Học xong flashcard của một đợt sẽ chuyển sang bài tập nối từ, rồi mới đến đợt tiếp theo.'}
                  </p>
                </div>
              </div>

              {/* Display limit stats block */}
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                {unknownReviewMode ? (
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div>
                      <span className="block text-[10px] font-bold text-slate-400 uppercase leading-normal">Đã ôn lại xong</span>
                      <span className="text-sm font-black text-slate-700">{unknownResolvedCount} từ</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold text-amber-500 uppercase leading-normal">Còn chưa biết</span>
                      <span className="text-sm font-black text-amber-600">{remaining} từ</span>
                    </div>
                  </div>
                ) : activeMode === 'fill_in' ? (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <span className="block text-[10px] font-bold text-slate-400 uppercase leading-normal">Đã biết (Flashcard)</span>
                      <span className="text-sm font-black text-slate-700">{knownFlashcard} từ</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold text-slate-400 uppercase leading-normal">Đã điền từ</span>
                      <span className="text-sm font-black text-slate-700">{learnedFillIn} từ</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold text-emerald-500 uppercase leading-normal">Có thể ôn</span>
                      <span className="text-sm font-black text-emerald-600">{remaining} từ</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <span className="block text-[10px] font-bold text-slate-400 uppercase leading-normal">Tổng số từ</span>
                      <span className="text-sm font-black text-slate-700">{info?.total ?? 0} từ</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold text-slate-400 uppercase leading-normal">Đã học</span>
                      <span className="text-sm font-black text-slate-700">{learnedFlashcard} từ</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold text-emerald-500 uppercase leading-normal">Chưa học</span>
                      <span className="text-sm font-black text-emerald-600">{remaining} từ</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <span className="text-xs font-bold text-slate-500 block">Chọn số từ đợt này:</span>
                <div className="flex flex-wrap gap-2">
                  {STAGE_SIZE_PRESETS.filter(n => n <= remaining).map((n) => {
                    const stages = Math.ceil(remaining / n)
                    const active = !customStageSize && stageSizeChoice === n
                    return (
                      <button
                        key={n}
                        onClick={() => { setStageSizeChoice(n); setCustomStageSize('') }}
                        className={`cursor-pointer px-4 py-2.5 rounded-2xl font-black text-sm transition-all border-2 ${
                          active
                            ? 'bg-[#1877f2] border-blue-600 text-white shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-blue-200'
                        }`}
                      >
                        <span className="block">{n} từ</span>
                        <span className={`block text-[10px] font-bold normal-case ${active ? 'text-white/80' : 'text-slate-400'}`}>
                          ≈ {stages} đợt
                        </span>
                      </button>
                    )
                  })}
                  {!STAGE_SIZE_PRESETS.includes(remaining) && (
                    <button
                      onClick={() => { setStageSizeChoice(remaining); setCustomStageSize('') }}
                      className={`cursor-pointer px-4 py-2.5 rounded-2xl font-black text-sm transition-all border-2 ${
                        !customStageSize && stageSizeChoice === remaining
                          ? 'bg-[#1877f2] border-blue-600 text-white shadow-sm'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-blue-200'
                      }`}
                    >
                      <span className="block">{remaining} từ</span>
                      <span className="block text-[10px] font-bold normal-case opacity-80">
                        Tất cả còn lại
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 block">
                  Hoặc nhập số tùy chỉnh (Tối đa {remaining} từ):
                </label>
                <input
                  type="number"
                  min={1}
                  max={remaining}
                  value={customStageSize}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '') {
                      setCustomStageSize('')
                      return
                    }
                    const num = parseInt(val, 10)
                    if (!isNaN(num)) {
                      setCustomStageSize(Math.min(remaining, Math.max(1, num)).toString())
                    }
                  }}
                  placeholder={`VD: ${Math.min(25, remaining)}`}
                  className="w-36 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold text-sm"
                />
              </div>

              <button
                onClick={() => {
                  const size = customStageSize
                    ? Math.max(1, Math.min(remaining, parseInt(customStageSize, 10) || DEFAULT_STAGE_SIZE))
                    : Math.min(remaining, stageSizeChoice)
                  const level = pendingLevel
                  setPendingLevel(null)
                  if (unknownReviewMode) {
                    startUnknownReview(level, size)
                  } else {
                    startLevel(level, size)
                  }
                }}
                className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
              >
                Bắt Đầu Ôn Tập <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {modeSelectLevel && (
            <div
              className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4"
              onClick={() => setModeSelectLevel(null)}
            >
              <div
                className="cartoon-panel bg-white p-6 max-w-md w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h4 className="font-black text-slate-800 text-lg text-center">
                  {modeSelectLevel} — Chọn Chế Độ Ôn Tập
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      const targetInfo = levelInfos.find((l) => l.level === modeSelectLevel)
                      if (targetInfo && targetInfo.learnedFlashcard === targetInfo.total && targetInfo.total > 0) {
                        setResetConfirmLevel(modeSelectLevel)
                        setModeSelectLevel(null)
                      } else {
                        setActiveMode('flashcard')
                        setUnknownReviewMode(false)
                        setPendingLevel(modeSelectLevel)
                        setModeSelectLevel(null)
                        const rem = targetInfo ? (targetInfo.total - targetInfo.learnedFlashcard) : DEFAULT_STAGE_SIZE
                        setStageSizeChoice(Math.min(rem, DEFAULT_STAGE_SIZE))
                        setCustomStageSize('')
                      }
                    }}
                    className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5"
                  >
                    <BookOpen className="w-8 h-8 mx-auto text-blue-500" />
                    <p className="font-black text-slate-700 text-sm">Flashcard</p>
                    <p className="text-[11px] text-slate-400 font-semibold leading-snug">
                      Lật thẻ học nghĩa, sau đó nối từ
                    </p>
                  </button>
                  <button
                    onClick={() => {
                      setActiveMode('fill_in')
                      setUnknownReviewMode(false)
                      setPendingLevel(modeSelectLevel)
                      setModeSelectLevel(null)
                      const targetInfo = levelInfos.find((l) => l.level === modeSelectLevel)
                      const rem = targetInfo ? (targetInfo.knownFlashcard - targetInfo.learnedFillIn) : DEFAULT_STAGE_SIZE
                      setStageSizeChoice(Math.min(rem, DEFAULT_STAGE_SIZE))
                      setCustomStageSize('')
                    }}
                    className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5"
                  >
                    <Keyboard className="w-8 h-8 mx-auto text-purple-500" />
                    <p className="font-black text-slate-700 text-sm">Điền Từ</p>
                    <p className="text-[11px] text-slate-400 font-semibold leading-snug">
                      Gõ pinyin để ghép đúng chữ Hán
                    </p>
                  </button>
                  {(() => {
                    const targetInfo = levelInfos.find((l) => l.level === modeSelectLevel)
                    const unknownN = targetInfo?.unknownCount ?? 0
                    return (
                      <button
                        disabled={unknownN === 0}
                        onClick={() => {
                          if (!targetInfo) return
                          setActiveMode('flashcard')
                          setUnknownReviewMode(true)
                          setPendingLevel(modeSelectLevel)
                          setModeSelectLevel(null)
                          setStageSizeChoice(Math.min(Math.max(unknownN, 1), DEFAULT_STAGE_SIZE))
                          setCustomStageSize('')
                        }}
                        className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5 sm:col-span-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" />
                        <p className="font-black text-slate-700 text-sm">Học Từ Không Biết</p>
                        <p className="text-[11px] text-slate-400 font-semibold leading-snug">
                          {unknownN > 0 ? `Ôn lại ${unknownN} từ đã đánh dấu "không biết"` : 'Chưa có từ nào bị đánh dấu "không biết"'}
                        </p>
                      </button>
                    )
                  })()}
                </div>
                <button
                  onClick={() => setModeSelectLevel(null)}
                  className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 block mx-auto"
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          {resetConfirmLevel && (
            <div
              className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4"
              onClick={() => {
                setModeSelectLevel(resetConfirmLevel)
                setResetConfirmLevel(null)
              }}
            >
              <div
                className="cartoon-panel bg-white p-6 max-w-md w-full space-y-4 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-[#1877f2] mx-auto shadow-sm">
                  <RotateCcw className="w-8 h-8" />
                </div>
                <h4 className="font-black text-slate-800 text-lg">
                  Học Lại Cấp Độ {resetConfirmLevel}?
                </h4>
                <p className="text-xs text-slate-500 font-semibold leading-normal">
                  Bạn đã hoàn thành tất cả từ vựng của cấp độ này bằng Flashcard. Bạn có muốn reset toàn bộ tiến trình để học lại từ đầu không?
                </p>
                <div className="flex flex-col gap-2 pt-2">
                  <button
                    onClick={async () => {
                      const lvl = resetConfirmLevel
                      setResetConfirmLevel(null)
                      await resetFlashcardAndStart(lvl)
                    }}
                    className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                  >
                    Đồng ý học lại từ đầu
                  </button>
                  <button
                    onClick={() => {
                      setModeSelectLevel(resetConfirmLevel)
                      setResetConfirmLevel(null)
                    }}
                    className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : step === 'flashcard' ? (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 shrink-0">
                {unknownReviewMode ? <AlertTriangle className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
              </div>
              <span className="font-extrabold text-sm text-slate-500 uppercase">
                {unknownReviewMode ? `${activeLevel} · Ôn Tập Từ Không Biết` : `${activeLevel} · Đợt ${stageNumber}/${totalStages} · Học Flashcards`}
              </span>
            </div>
            <button onClick={() => { setStep('select'); setUnknownReviewMode(false) }} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          {!unknownReviewMode && <StepTracker current={1} mode={activeMode} />}

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-black text-slate-500">
              <span>TIẾN ĐỘ: {flashIdx} / {stageWords.length} TỪ</span>
              <span>{Math.round((flashIdx / stageWords.length) * 100)}%</span>
            </div>
            <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full transition-all duration-300"
                style={{ width: `${(flashIdx / stageWords.length) * 100}%` }}
              />
            </div>
          </div>

          <Flashcard
            hanzi={stageWords[flashIdx].hanzi}
            pinyin={stageWords[flashIdx].pinyin}
            vietnamese={stageWords[flashIdx].vietnamese}
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped(!isFlipped)}
            example={
              stageWords[flashIdx].example_hanzi
                ? {
                    sentence: stageWords[flashIdx].example_hanzi!,
                    pinyin: stageWords[flashIdx].example_pinyin || '',
                    translation: stageWords[flashIdx].example_vietnamese || '',
                  }
                : null
            }
          />

          <div className="flex justify-between items-center gap-4 max-w-lg mx-auto">
            <button
              onClick={handleFlashPrev}
              disabled={flashIdx === 0}
              className="cartoon-btn cartoon-btn-secondary px-4 py-3 text-sm flex items-center gap-2 disabled:opacity-30 disabled:pointer-events-none"
            >
              <ArrowLeft className="w-4 h-4" /> Trước đó
            </button>
            <button onClick={() => setIsFlipped(!isFlipped)} className="cartoon-btn cartoon-btn-secondary px-5 py-3 text-sm">
              Lật Thẻ
            </button>
          </div>
          <div className="flex justify-center items-center gap-3 max-w-lg mx-auto">
            <button
              onClick={handleMarkUnknown}
              className="cartoon-btn cartoon-btn-danger px-5 py-3 text-sm flex items-center gap-2 flex-1 justify-center"
            >
              <XCircle className="w-4 h-4" /> Không Biết
            </button>
            <button
              onClick={handleMarkKnown}
              className="cartoon-btn cartoon-btn-success px-5 py-3 text-sm flex items-center gap-2 flex-1 justify-center"
            >
              <CheckCircle className="w-4 h-4" /> Biết
            </button>
          </div>
        </div>
      ) : step === 'matching' ? (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500 shrink-0">
                <Puzzle className="w-4 h-4" />
              </div>
              <div>
                <span className="font-black text-slate-800 block text-sm">{getMatchingTitle()}</span>
                <span className="text-[10px] text-slate-500 font-bold uppercase">
                  {activeLevel} · Đợt {stageNumber}/{totalStages} · Vòng {matchingRound + 1}/{Math.ceil(stageWords.length / ITEMS_PER_ROUND)}
                </span>
              </div>
            </div>
            <button onClick={() => setStep('select')} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          <StepTracker current={2} mode={activeMode} />

          <MatchingExercise vocabs={roundVocabs} matchType={matchingType} onComplete={handleRoundComplete} />
        </div>
      ) : step === 'fill_in' ? (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center text-purple-500 shrink-0">
                <Keyboard className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-sm text-slate-500 uppercase">
                {activeLevel} · Đợt {stageNumber}/{totalStages} · Điền Từ
              </span>
            </div>
            <button onClick={() => setStep('select')} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          <StepTracker current={1} mode={activeMode} />

          <FillInExercise words={stageWords} onComplete={finishStage} />
        </div>
      ) : (
        <div className="space-y-6">
          {!unknownReviewMode && <StepTracker current={activeMode === 'fill_in' ? 2 : 3} mode={activeMode} />}

          <div className="cartoon-card bg-white p-8 text-center space-y-6 animate-float max-w-md mx-auto">
          <div className="w-20 h-20 bg-emerald-100 rounded-full shadow-md flex items-center justify-center text-emerald-500 mx-auto">
            {unknownReviewMode ? <RotateCcw className="w-12 h-12" /> : levelFullyComplete ? <Trophy className="w-12 h-12" /> : <CheckCircle className="w-12 h-12" />}
          </div>

          <div className="space-y-2">
            <h3 className="text-3xl font-black text-slate-800">
              {unknownReviewMode ? 'Ôn Tập Xong! 🎉' : levelFullyComplete ? 'Hoàn Thành Toàn Bộ Cấp Độ! 🎉' : `Xong Đợt ${stageNumber}! 🎉`}
            </h3>
            <p className="text-slate-500 font-bold">
              {unknownReviewMode
                ? unknownRemaining > 0
                  ? `Còn ${unknownRemaining} từ vẫn chưa biết trong cấp độ ${activeLevel}.`
                  : `Bạn đã học hết các từ "chưa biết" trong cấp độ ${activeLevel}! 🎉`
                : levelFullyComplete
                ? `Chúc mừng! Bạn đã học hết toàn bộ từ vựng cấp độ ${activeLevel}.`
                : `Còn ${totalStages - stageNumber} đợt nữa để hoàn thành cấp độ ${activeLevel}.`}
            </p>
            <span className="inline-block text-xs font-black px-3 py-1 rounded-full bg-blue-50 text-blue-600">
              {unknownReviewMode ? `Đã ôn tập ${stageWords.length} từ` : `+${stageWords.length} từ đã ôn trong đợt này`}
            </span>
          </div>

          {unknownReviewMode ? (
            <div className="flex flex-col gap-2">
              {unknownRemaining > 0 && (
                <button
                  onClick={() => activeLevel && startUnknownReview(activeLevel, stageSize)}
                  className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Ôn Tập Lại
                </button>
              )}
              <button
                onClick={() => { setStep('select'); setUnknownReviewMode(false); loadLevelInfos() }}
                className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
              >
                Quay Lại Chọn Cấp Độ
              </button>
            </div>
          ) : levelFullyComplete ? (
            <div className="flex flex-col gap-2">
              <button onClick={restartLevel} className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2">
                <RotateCcw className="w-4 h-4" /> Học Lại Từ Đầu
              </button>
              <button
                onClick={() => { setStep('select'); loadLevelInfos() }}
                className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
              >
                Quay Lại Chọn Cấp Độ
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button onClick={continueNextStage} className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2">
                Học Đợt Tiếp Theo <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setStep('select'); loadLevelInfos() }}
                className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
              >
                Quay Lại Chọn Cấp Độ
              </button>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  )
}
