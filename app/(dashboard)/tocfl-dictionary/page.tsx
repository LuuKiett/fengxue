'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/utils/supabasePagination'
import { shuffleArray } from '@/lib/utils/shuffle'
import { stripTones } from '@/lib/utils/pinyin'
import { sortLevels, LEVEL_ORDER } from '@/lib/utils/dictionaryLevels'
import { ensureProfile } from '@/lib/utils/ensureProfile'
import Flashcard from '@/components/learn/Flashcard'
import MatchingExercise from '@/components/exercises/MatchingExercise'
import FillInExercise, { type FillInResult } from '@/components/exercises/FillInExercise'
import Pagination from '@/components/ui/Pagination'
import WordCardList from '@/components/dictionary/WordCardList'
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  CheckCircle,
  XCircle,
  BookOpen,
  Puzzle,
  Keyboard,
  Trophy,
  Search,
  Library,
  AlertTriangle,
} from 'lucide-react'
import confetti from 'canvas-confetti'

const STAGE_SIZE_PRESETS = [10, 20, 30, 50]
const DEFAULT_STAGE_SIZE = 50
const ITEMS_PER_ROUND = 15
const TABLE_PAGE_SIZE = 24

type StudyMode = 'flashcard' | 'matching' | 'fill_in'

interface LevelInfo {
  level: string
  total: number
  learnedFlashcard: number
  // learnedFlashcard minus words currently flagged "không biết" — the actual pool
  // Matching/Fill-in are allowed to draw from.
  knownFlashcard: number
  unknownCount: number
  unknownResolvedCount: number
  learnedMatching: number
  learnedFillIn: number
  // Words answered incorrectly/left incomplete on a Điền Từ submit — the "Điền Từ
  // Chưa Xong" retry pool for this level, read off the mode='fill_in' progress row's
  // own unknown_word_ids/unknown_resolved_count (same columns as flashcard's Biết/
  // Không Biết tracking above, reused for a different mode's row).
  fillInUnknownCount: number
  fillInUnknownResolvedCount: number
}

interface DictWord {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
  pos: string | null
  example_hanzi: string | null
  example_pinyin: string | null
  example_vietnamese: string | null
}

interface ProgressRow {
  word_order: string[]
  current_index: number
  unknown_word_ids?: string[] | null
  unknown_resolved_count?: number | null
}

function getLearnedIds(progress: ProgressRow | null): string[] {
  return progress ? progress.word_order.slice(0, progress.current_index) : []
}

// Words reviewed via Flashcard, minus whatever's currently flagged "không biết" —
// the pool Matching/Fill-in are actually allowed to draw from (see KNOWLEDGE.md).
function getKnownIds(progress: ProgressRow | null): string[] {
  if (!progress) return []
  const unknownSet = new Set(progress.unknown_word_ids || [])
  return getLearnedIds(progress).filter((id) => !unknownSet.has(id))
}

// Matching and Fill-in both draw independently from words already learned in
// Flashcard — Fill-in does NOT require Matching first (per explicit user request:
// finishing Flashcard alone should unlock Fill-in).
function modeLearnedCount(info: LevelInfo, mode: StudyMode): number {
  return mode === 'flashcard' ? info.learnedFlashcard : mode === 'matching' ? info.learnedMatching : info.learnedFillIn
}
function modePoolTotal(info: LevelInfo, mode: StudyMode): number {
  return mode === 'flashcard' ? info.total : info.knownFlashcard
}
const MODE_VERB: Record<StudyMode, string> = { flashcard: 'học', matching: 'nối', fill_in: 'điền' }
const MODE_LEARNED_LABEL: Record<StudyMode, string> = { flashcard: 'Đã học', matching: 'Đã nối', fill_in: 'Đã điền' }
const MODE_NEW_LABEL: Record<StudyMode, string> = { flashcard: 'Học Từ Mới', matching: 'Nối Từ Mới', fill_in: 'Điền Từ Mới' }
const MODE_META: Record<StudyMode, { label: string; icon: typeof BookOpen; desc: string }> = {
  flashcard: { label: 'Flashcard', icon: BookOpen, desc: 'Học thẻ, sau đó nối từ và điền từ' },
  matching: { label: 'Nối Từ', icon: Puzzle, desc: 'Ôn lại các từ đã học bằng Flashcard' },
  fill_in: { label: 'Điền Từ', icon: Keyboard, desc: 'Ôn lại các từ đã học bằng Flashcard' },
}

function ProgressRing({ percent, size = 40, stroke = 4 }: { percent: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#eef0f3" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="#34d399" strokeWidth={stroke} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-black text-slate-600">{Math.round(percent)}%</span>
      </div>
    </div>
  )
}

// Shown only during a chained session (entered via "Flashcard") so it's clear the
// pipeline continues Flashcard -> Nối Từ -> Điền Từ, matching the same tracker already
// used on /vocabulary-by-topic.
function ChainStepTracker({ current }: { current: StudyMode }) {
  const order: StudyMode[] = ['flashcard', 'matching', 'fill_in']
  const currentIdx = order.indexOf(current)
  return (
    <div className="flex items-center justify-center gap-1.5 sm:gap-2 py-1">
      {order.map((m, i) => {
        const Icon = MODE_META[m].icon
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'upcoming'
        return (
          <React.Fragment key={m}>
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
                {MODE_META[m].label}
              </span>
            </div>
            {i < order.length - 1 && (
              <div className={`h-0.5 w-8 sm:w-16 rounded-full mb-4 transition-all ${i < currentIdx ? 'bg-emerald-400' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default function TocflDictionaryPage() {
  const supabase = createClient()

  const [levelInfos, setLevelInfos] = useState<LevelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null)

  // Mode row button clicked but this mode already has learned words — shows the
  // "Học/Nối/Điền Từ Mới" vs "Ôn Tập Từ Đã Học" sub-modal.
  const [learnStyleMode, setLearnStyleMode] = useState<StudyMode | null>(null)
  const [activeMode, setActiveMode] = useState<StudyMode>('flashcard')
  const [reviewMode, setReviewMode] = useState(false)
  // True when the current/pending review session is drilling a "chưa biết"/"chưa
  // xong" retry pool (via "Học Từ Không Biết" for flashcard, or "Điền Từ Chưa Xong"
  // for fill_in) rather than a normal "already learned" review — always paired with
  // reviewMode(true) so the existing skip-persist/skip-chain branches in
  // finishFlashcardStage/handleMatchingRoundComplete/handleFillInSubmit apply
  // unchanged; which retry pool it reads is decided by `activeMode` at call time.
  const [unknownReviewMode, setUnknownReviewMode] = useState(false)
  const [chainMode, setChainMode] = useState(false)
  const [currentStageMode, setCurrentStageMode] = useState<StudyMode>('flashcard')

  // Mode picked but stage size not chosen yet — shows the size chooser in place of
  // the mode row + dictionary table.
  const [sizeChooserOpen, setSizeChooserOpen] = useState(false)
  const [stageSizeChoice, setStageSizeChoice] = useState<number>(DEFAULT_STAGE_SIZE)
  const [customStageSize, setCustomStageSize] = useState('')
  const [stageSize, setStageSize] = useState(DEFAULT_STAGE_SIZE)

  const [step, setStep] = useState<'levels' | 'detail' | 'flashcard' | 'matching' | 'fill_in' | 'complete'>('levels')
  const [stageWords, setStageWords] = useState<DictWord[]>([])
  const [stageNumber, setStageNumber] = useState(1)
  const [totalStages, setTotalStages] = useState(1)
  const [levelFullyComplete, setLevelFullyComplete] = useState(false)

  const [flashIdx, setFlashIdx] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)

  const [matchingRound, setMatchingRound] = useState(0)
  const [matchingType, setMatchingType] = useState<'hanzi_pinyin' | 'hanzi_viet'>('hanzi_pinyin')
  const [roundVocabs, setRoundVocabs] = useState<DictWord[]>([])

  // Full dictionary table for the currently-viewed level (Row 2 of the detail view).
  const [tableWords, setTableWords] = useState<DictWord[]>([])
  const [tableLoading, setTableLoading] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [tablePage, setTablePage] = useState(1)

  const progressAdvancedRef = useRef(false)

  // Live copy of the active level's flashcard-mode unknown_word_ids/unknown_resolved_count
  // — populated whenever a flashcard stage loads, mutated and persisted immediately on
  // every Biết/Không Biết tap (see persistUnknownState).
  const unknownIdsRef = useRef<string[]>([])
  const unknownResolvedRef = useRef<number>(0)
  // Mirrors unknownIdsRef.current.length for display purposes — refs can't be read
  // during render (React rules-of-hooks), so this is updated in lockstep everywhere
  // unknownIdsRef.current is reassigned.
  const [unknownRemaining, setUnknownRemaining] = useState(0)

  // Same shape as unknownIdsRef/unknownResolvedRef/unknownRemaining above, but for the
  // level's mode='fill_in' unknown_word_ids/unknown_resolved_count — words answered
  // incorrectly/left incomplete on a Điền Từ submit, resurfaced via "Điền Từ Chưa Xong".
  const fillInUnknownIdsRef = useRef<string[]>([])
  const fillInUnknownResolvedRef = useRef<number>(0)
  const [fillInUnknownRemaining, setFillInUnknownRemaining] = useState(0)

  async function loadLevelInfos() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await ensureProfile(supabase)

      const counts: Record<string, number> = {}
      await Promise.all(
        LEVEL_ORDER.map(async (lvl) => {
          const { count } = await supabase
            .from('tocfl8000_words')
            .select('id', { count: 'exact', head: true })
            .eq('level', lvl)
          if (count) counts[lvl] = count
        })
      )

      const { data: progressRows } = await supabase
        .from('tocfl8000_progress')
        .select('level, mode, current_index, unknown_word_ids, unknown_resolved_count')
        .eq('user_id', user.id)

      const progressByLevelMode: Record<string, Record<string, number>> = {}
      const unknownByLevel: Record<string, { count: number; resolved: number }> = {}
      const fillInUnknownByLevel: Record<string, { count: number; resolved: number }> = {}
      for (const p of progressRows || []) {
        if (!progressByLevelMode[p.level]) progressByLevelMode[p.level] = {}
        progressByLevelMode[p.level][p.mode] = p.current_index
        if (p.mode === 'flashcard') {
          unknownByLevel[p.level] = {
            count: (p.unknown_word_ids || []).length,
            resolved: p.unknown_resolved_count || 0,
          }
        } else if (p.mode === 'fill_in') {
          fillInUnknownByLevel[p.level] = {
            count: (p.unknown_word_ids || []).length,
            resolved: p.unknown_resolved_count || 0,
          }
        }
      }

      const levels = sortLevels(Object.keys(counts))
      setLevelInfos(
        levels.map((lvl) => {
          const total = counts[lvl] || 0
          const learnedFlashcard = Math.min(progressByLevelMode[lvl]?.['flashcard'] || 0, total)
          const unknownCount = Math.min(unknownByLevel[lvl]?.count || 0, learnedFlashcard)
          const unknownResolvedCount = unknownByLevel[lvl]?.resolved || 0
          const knownFlashcard = learnedFlashcard - unknownCount
          const learnedMatching = Math.min(progressByLevelMode[lvl]?.['matching'] || 0, knownFlashcard)
          const learnedFillIn = Math.min(progressByLevelMode[lvl]?.['fill_in'] || 0, knownFlashcard)
          const fillInUnknownCount = Math.min(fillInUnknownByLevel[lvl]?.count || 0, learnedFillIn)
          const fillInUnknownResolvedCount = fillInUnknownByLevel[lvl]?.resolved || 0
          return {
            level: lvl,
            total,
            learnedFlashcard,
            knownFlashcard,
            unknownCount,
            unknownResolvedCount,
            learnedMatching,
            learnedFillIn,
            fillInUnknownCount,
            fillInUnknownResolvedCount,
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

  async function loadTableForLevel(lvl: string) {
    setTableLoading(true)
    try {
      const data = await fetchAllRows<DictWord>((from, to) =>
        supabase
          .from('tocfl8000_words')
          .select('id, hanzi, pinyin, vietnamese, pos, example_hanzi, example_pinyin, example_vietnamese')
          .eq('level', lvl)
          .order('order_index', { ascending: true })
          .range(from, to)
      )
      setTableWords(data)
    } catch (err) {
      console.error('Lỗi khi tải từ điển:', err)
    } finally {
      setTableLoading(false)
    }
  }

  const handleSelectLevel = (lvl: string) => {
    setSelectedLevel(lvl)
    setSizeChooserOpen(false)
    setLearnStyleMode(null)
    setReviewMode(false)
    setUnknownReviewMode(false)
    setTableSearch('')
    setTablePage(1)
    setStep('detail')
    loadTableForLevel(lvl)
  }

  async function fetchProgressRow(userId: string, lvl: string, mode: StudyMode): Promise<ProgressRow | null> {
    const { data } = await supabase
      .from('tocfl8000_progress')
      .select('word_order, current_index, unknown_word_ids, unknown_resolved_count')
      .eq('user_id', userId)
      .eq('level', lvl)
      .eq('mode', mode)
      .maybeSingle()
    return data
  }

  async function startLevelMode(lvl: string, mode: StudyMode, size: number, isReview: boolean = false, isUnknownReview: boolean = false) {
    setLoading(true)
    setStageSize(size)
    setActiveMode(mode)
    setReviewMode(isReview)
    setUnknownReviewMode(isUnknownReview)
    setChainMode(!isReview && mode === 'flashcard')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      if (isReview) {
        const progress = await fetchProgressRow(user.id, lvl, mode)
        const learnedIds = isUnknownReview ? (progress?.unknown_word_ids || []) : getLearnedIds(progress)
        if (mode === 'flashcard') {
          unknownIdsRef.current = progress?.unknown_word_ids || []
          unknownResolvedRef.current = progress?.unknown_resolved_count || 0
          setUnknownRemaining(unknownIdsRef.current.length)
        } else if (mode === 'fill_in') {
          fillInUnknownIdsRef.current = progress?.unknown_word_ids || []
          fillInUnknownResolvedRef.current = progress?.unknown_resolved_count || 0
          setFillInUnknownRemaining(fillInUnknownIdsRef.current.length)
        }
        if (learnedIds.length === 0) { setLoading(false); return }
        const shuffled = shuffleArray(learnedIds)
        await loadStage(lvl, mode, shuffled, 0, learnedIds.length, size)
      } else if (mode === 'flashcard') {
        const allWords = await fetchAllRows<{ id: string }>((from, to) =>
          supabase
            .from('tocfl8000_words')
            .select('id')
            .eq('level', lvl)
            .order('order_index', { ascending: true })
            .range(from, to)
        )
        const allIds = allWords.map((w) => w.id)
        if (allIds.length === 0) { setLoading(false); return }

        let progress = await fetchProgressRow(user.id, lvl, 'flashcard')
        const idsMatch =
          progress && progress.word_order.length === allIds.length &&
          new Set(progress.word_order).size === new Set(allIds).size &&
          [...new Set(progress.word_order)].every((id) => allIds.includes(id))

        if (!progress || !idsMatch) {
          const wordOrder = shuffleArray(allIds)
          const { data: upserted } = await supabase
            .from('tocfl8000_progress')
            .upsert(
              { user_id: user.id, level: lvl, mode: 'flashcard', word_order: wordOrder, current_index: 0 },
              { onConflict: 'user_id,level,mode' }
            )
            .select('word_order, current_index')
            .single()
          progress = upserted
        }
        if (!progress) { setLoading(false); return }
        unknownIdsRef.current = progress.unknown_word_ids || []
        unknownResolvedRef.current = progress.unknown_resolved_count || 0
        setUnknownRemaining(unknownIdsRef.current.length)
        await loadStage(lvl, 'flashcard', progress.word_order, progress.current_index, allIds.length, size)
      } else {
        const parentProgress = await fetchProgressRow(user.id, lvl, 'flashcard')
        const learnedIds = getKnownIds(parentProgress)
        if (learnedIds.length === 0) { setLoading(false); return }

        const thisProgress = await fetchProgressRow(user.id, lvl, mode)
        let newWordOrder: string[]
        let newCurrentIndex: number
        if (thisProgress) {
          const completedIds = thisProgress.word_order.slice(0, thisProgress.current_index).filter((id) => learnedIds.includes(id))
          const remainingLearnedIds = learnedIds.filter((id) => !completedIds.includes(id))
          newWordOrder = [...completedIds, ...shuffleArray(remainingLearnedIds)]
          newCurrentIndex = completedIds.length
        } else {
          newWordOrder = shuffleArray(learnedIds)
          newCurrentIndex = 0
        }

        const { data: upserted } = await supabase
          .from('tocfl8000_progress')
          .upsert(
            { user_id: user.id, level: lvl, mode, word_order: newWordOrder, current_index: newCurrentIndex, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,level,mode' }
          )
          .select('word_order, current_index, unknown_word_ids, unknown_resolved_count')
          .single()
        if (!upserted) { setLoading(false); return }
        if (mode === 'fill_in') {
          fillInUnknownIdsRef.current = upserted.unknown_word_ids || []
          fillInUnknownResolvedRef.current = upserted.unknown_resolved_count || 0
          setFillInUnknownRemaining(fillInUnknownIdsRef.current.length)
        }
        await loadStage(lvl, mode, upserted.word_order, upserted.current_index, learnedIds.length, size)
      }
    } catch (err) {
      console.error('Lỗi khi bắt đầu học:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadStage(lvl: string, mode: StudyMode, wordOrder: string[], currentIndex: number, total: number, size: number) {
    const stageIds = wordOrder.slice(currentIndex, currentIndex + size)

    if (stageIds.length === 0) {
      setLevelFullyComplete(true)
      setStep('complete')
      return
    }

    const { data: wordsData } = await supabase
      .from('tocfl8000_words')
      .select('id, hanzi, pinyin, vietnamese, pos, example_hanzi, example_pinyin, example_vietnamese')
      .in('id', stageIds)

    const byId: Record<string, DictWord> = {}
    for (const w of wordsData || []) byId[w.id] = w
    const ordered = shuffleArray(stageIds.map((id) => byId[id]).filter(Boolean))

    setStageWords(ordered)
    setStageNumber(Math.floor(currentIndex / size) + 1)
    setTotalStages(Math.ceil(total / size))
    setLevelFullyComplete(false)
    setFlashIdx(0)
    setIsFlipped(false)
    setCurrentStageMode(mode)
    if (mode === 'matching') {
      // Reset round state from the freshly-fetched `ordered` array (not the `stageWords`
      // state, which hasn't committed the update in this tick yet) — otherwise any entry
      // into Matching other than the Flashcard->Matching chain transition would render
      // with a stale/empty roundVocabs. Same fix as /vocabulary-by-topic's loadStage.
      setMatchingRound(0)
      setMatchingType('hanzi_pinyin')
      setRoundVocabs(ordered.slice(0, ITEMS_PER_ROUND))
    }
    progressAdvancedRef.current = false
    setStep(mode)
  }

  const persistProgressAdvance = async (mode: StudyMode, lvl: string, count: number): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

      const { data: progress } = await supabase
        .from('tocfl8000_progress')
        .select('word_order, current_index')
        .eq('user_id', user.id)
        .eq('level', lvl)
        .eq('mode', mode)
        .maybeSingle()

      let finalIndex = 0
      let finalOrderLength = 0

      if (!progress) {
        // Initialize progress if it doesn't exist (e.g. during chainMode)
        if (mode === 'flashcard') {
          const allWords = await fetchAllRows<{ id: string }>((from, to) =>
            supabase
              .from('tocfl8000_words')
              .select('id')
              .eq('level', lvl)
              .order('order_index', { ascending: true })
              .range(from, to)
          )
          const allIds = allWords.map((w) => w.id)
          const wordOrder = shuffleArray(allIds)
          const { data: upserted } = await supabase
            .from('tocfl8000_progress')
            .upsert(
              { user_id: user.id, level: lvl, mode: 'flashcard', word_order: wordOrder, current_index: count, updated_at: new Date().toISOString() },
              { onConflict: 'user_id,level,mode' }
            )
            .select('word_order, current_index')
            .single()
          
          if (upserted) {
            finalIndex = upserted.current_index
            finalOrderLength = upserted.word_order.length
          }
        } else {
          const parentProgress = await fetchProgressRow(user.id, lvl, 'flashcard')
          const learnedIds = getKnownIds(parentProgress)
          const stageWordIds = stageWords.map((w) => w.id)
          const remainingIds = learnedIds.filter((id) => !stageWordIds.includes(id))
          const wordOrder = [...stageWordIds, ...shuffleArray(remainingIds)]
          
          const { data: upserted } = await supabase
            .from('tocfl8000_progress')
            .upsert(
              { user_id: user.id, level: lvl, mode, word_order: wordOrder, current_index: count, updated_at: new Date().toISOString() },
              { onConflict: 'user_id,level,mode' }
            )
            .select('word_order, current_index')
            .single()

          if (upserted) {
            finalIndex = upserted.current_index
            finalOrderLength = upserted.word_order.length
          }
        }
      } else {
        const newIndex = Math.min(progress.current_index + count, progress.word_order.length)
        await supabase
          .from('tocfl8000_progress')
          .update({ current_index: newIndex, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('level', lvl)
          .eq('mode', mode)
        
        finalIndex = newIndex
        finalOrderLength = progress.word_order.length
      }

      setLevelInfos((prev) =>
        prev.map((l) => {
          if (l.level !== lvl) return l
          if (mode === 'flashcard') return { ...l, learnedFlashcard: finalIndex }
          if (mode === 'matching') return { ...l, learnedMatching: finalIndex }
          return { ...l, learnedFillIn: finalIndex }
        })
      )

      return finalIndex >= finalOrderLength
    } catch (err) {
      console.error('Lỗi khi lưu tiến độ:', err)
      return false
    }
  }

  // Persists the live unknownIdsRef/unknownResolvedRef to the level's flashcard
  // progress row immediately (not batched) — each Biết/Không Biết tap is a discrete
  // save action.
  const persistUnknownState = async (newIds: string[], newResolved: number) => {
    if (!selectedLevel) return
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('tocfl8000_progress')
        .update({ unknown_word_ids: newIds, unknown_resolved_count: newResolved, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('level', selectedLevel)
        .eq('mode', 'flashcard')

      setLevelInfos((prev) =>
        prev.map((l) =>
          l.level === selectedLevel
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
    } else {
      finishFlashcardStage()
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

  const finishFlashcardStage = async () => {
    if (progressAdvancedRef.current || !selectedLevel) return
    progressAdvancedRef.current = true
    if (reviewMode) {
      setLevelFullyComplete(false)
      setStep('complete')
      progressAdvancedRef.current = false
      return
    }
    await persistProgressAdvance('flashcard', selectedLevel, stageWords.length)
    const knownWords = stageWords.filter((w) => !unknownIdsRef.current.includes(w.id))
    if (knownWords.length === 0) {
      setStep('complete')
    } else {
      setStageWords(knownWords)
      setMatchingRound(0)
      setMatchingType('hanzi_pinyin')
      setRoundVocabs(knownWords.slice(0, ITEMS_PER_ROUND))
      setCurrentStageMode('matching')
      setStep('matching')
    }
    progressAdvancedRef.current = false
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

  const handleMatchingRoundComplete = async () => {
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
      return
    }

    if (!selectedLevel || progressAdvancedRef.current) return
    progressAdvancedRef.current = true

    if (reviewMode) {
      setLevelFullyComplete(false)
      setStep('complete')
      progressAdvancedRef.current = false
      return
    }

    const fullyComplete = await persistProgressAdvance('matching', selectedLevel, stageWords.length)

    if (chainMode) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const fillInProgress = await fetchProgressRow(user.id, selectedLevel, 'fill_in')
        fillInUnknownIdsRef.current = fillInProgress?.unknown_word_ids || []
        fillInUnknownResolvedRef.current = fillInProgress?.unknown_resolved_count || 0
        setFillInUnknownRemaining(fillInUnknownIdsRef.current.length)
      }
      setCurrentStageMode('fill_in')
      setStep('fill_in')
      progressAdvancedRef.current = false
    } else {
      setLevelFullyComplete(fullyComplete)
      setStep('complete')
      if (fullyComplete) triggerGrandConfetti()
    }
  }

  // Same shape as persistUnknownState above, but for the level's mode='fill_in' row.
  const persistFillInUnknownState = async (newIds: string[], newResolved: number) => {
    if (!selectedLevel) return
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('tocfl8000_progress')
        .update({ unknown_word_ids: newIds, unknown_resolved_count: newResolved, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('level', selectedLevel)
        .eq('mode', 'fill_in')

      setLevelInfos((prev) =>
        prev.map((l) =>
          l.level === selectedLevel
            ? { ...l, fillInUnknownCount: newIds.length, fillInUnknownResolvedCount: newResolved }
            : l
        )
      )
    } catch (err) {
      console.error('Lỗi khi lưu trạng thái điền từ chưa xong:', err)
    }
  }

  // Wired as FillInExercise's onComplete: merges this submit's correct/incorrect words
  // into the level's fill_in unknown_word_ids pool (resolving previously "chưa xong"
  // words that got right this time, queuing newly-wrong/unfinished ones) — runs for
  // every fill_in submit (normal, "already learned" review, or retry-review), safe
  // unconditionally since re-adding an id already in the pool is a no-op.
  const handleFillInSubmit = async (result: FillInResult) => {
    if (!selectedLevel) return

    let ids = fillInUnknownIdsRef.current
    let resolved = fillInUnknownResolvedRef.current
    for (const id of result.correctIds) {
      if (ids.includes(id)) {
        ids = ids.filter((x) => x !== id)
        resolved += 1
      }
    }
    for (const id of result.incorrectIds) {
      if (!ids.includes(id)) ids = [...ids, id]
    }
    fillInUnknownIdsRef.current = ids
    fillInUnknownResolvedRef.current = resolved
    setFillInUnknownRemaining(ids.length)
    await persistFillInUnknownState(ids, resolved)

    if (progressAdvancedRef.current) return
    progressAdvancedRef.current = true

    if (reviewMode) {
      setLevelFullyComplete(false)
      setStep('complete')
      progressAdvancedRef.current = false
      return
    }

    const fullyComplete = await persistProgressAdvance('fill_in', selectedLevel, stageWords.length)
    setLevelFullyComplete(fullyComplete)
    setStep('complete')
    if (fullyComplete) triggerGrandConfetti()
  }

  const continueNextStage = async () => {
    if (!selectedLevel) return
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      if (activeMode !== 'flashcard') {
        const parentProgress = await fetchProgressRow(user.id, selectedLevel, 'flashcard')
        const learnedIds = getKnownIds(parentProgress)
        const thisProgress = await fetchProgressRow(user.id, selectedLevel, activeMode)

        if (thisProgress) {
          const completedIds = thisProgress.word_order.slice(0, thisProgress.current_index).filter((id) => learnedIds.includes(id))
          const remainingLearnedIds = learnedIds.filter((id) => !completedIds.includes(id))
          const newWordOrder = [...completedIds, ...shuffleArray(remainingLearnedIds)]
          const newCurrentIndex = completedIds.length

          const { data: upserted } = await supabase
            .from('tocfl8000_progress')
            .update({ word_order: newWordOrder, current_index: newCurrentIndex, updated_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('level', selectedLevel)
            .eq('mode', activeMode)
            .select('word_order, current_index')
            .single()

          if (upserted) {
            await loadStage(selectedLevel, activeMode, upserted.word_order, upserted.current_index, learnedIds.length, stageSize)
            return
          }
        }
      }

      const { data: progress } = await supabase
        .from('tocfl8000_progress')
        .select('word_order, current_index, unknown_word_ids, unknown_resolved_count')
        .eq('user_id', user.id)
        .eq('level', selectedLevel)
        .eq('mode', activeMode)
        .single()
      if (!progress) return
      if (activeMode === 'flashcard') {
        unknownIdsRef.current = progress.unknown_word_ids || []
        unknownResolvedRef.current = progress.unknown_resolved_count || 0
        setUnknownRemaining(unknownIdsRef.current.length)
      } else if (activeMode === 'fill_in') {
        fillInUnknownIdsRef.current = progress.unknown_word_ids || []
        fillInUnknownResolvedRef.current = progress.unknown_resolved_count || 0
        setFillInUnknownRemaining(fillInUnknownIdsRef.current.length)
      }
      await loadStage(selectedLevel, activeMode, progress.word_order, progress.current_index, progress.word_order.length, stageSize)
    } finally {
      setLoading(false)
    }
  }

  const restartMode = async (lvl: string, mode: StudyMode) => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      let wordOrder: string[] = []
      if (mode === 'flashcard') {
        const allWords = await fetchAllRows<{ id: string }>((from, to) =>
          supabase.from('tocfl8000_words').select('id').eq('level', lvl).range(from, to)
        )
        wordOrder = shuffleArray(allWords.map((w) => w.id))
      } else {
        const parentProgress = await fetchProgressRow(user.id, lvl, 'flashcard')
        wordOrder = shuffleArray(getKnownIds(parentProgress))
      }

      await supabase
        .from('tocfl8000_progress')
        .upsert(
          {
            user_id: user.id,
            level: lvl,
            mode,
            word_order: wordOrder,
            current_index: 0,
            ...(mode === 'flashcard' || mode === 'fill_in' ? { unknown_word_ids: [], unknown_resolved_count: 0 } : {}),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,level,mode' }
        )

      if (mode === 'flashcard') {
        unknownIdsRef.current = []
        unknownResolvedRef.current = 0
        setUnknownRemaining(0)
      } else if (mode === 'fill_in') {
        fillInUnknownIdsRef.current = []
        fillInUnknownResolvedRef.current = 0
        setFillInUnknownRemaining(0)
      }

      setLevelInfos((prev) =>
        prev.map((l) => {
          if (l.level !== lvl) return l
          if (mode === 'flashcard') return { ...l, learnedFlashcard: 0, knownFlashcard: 0, unknownCount: 0, unknownResolvedCount: 0, learnedMatching: 0, learnedFillIn: 0 }
          if (mode === 'matching') return { ...l, learnedMatching: 0 }
          return { ...l, learnedFillIn: 0, fillInUnknownCount: 0, fillInUnknownResolvedCount: 0 }
        })
      )
      setStep('detail')
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

  const getMatchingTitle = () => (matchingType === 'hanzi_pinyin' ? 'Chữ Hán ↔ Phiên âm' : 'Chữ Hán ↔ Nghĩa Việt')

  const currentInfo = levelInfos.find((l) => l.level === selectedLevel)
  const remaining = !currentInfo
    ? 0
    : unknownReviewMode
    ? (activeMode === 'fill_in' ? currentInfo.fillInUnknownCount : currentInfo.unknownCount)
    : reviewMode
    ? modeLearnedCount(currentInfo, activeMode)
    : modePoolTotal(currentInfo, activeMode) - modeLearnedCount(currentInfo, activeMode)

  const isSearchingTable = tableSearch.trim().length > 0
  const filteredTableWords = useMemo(() => {
    if (!isSearchingTable) return tableWords
    const q = tableSearch.trim().toLowerCase()
    const qToneless = stripTones(q)
    return tableWords.filter(
      (w) =>
        w.hanzi.includes(tableSearch.trim()) ||
        w.vietnamese.toLowerCase().includes(q) ||
        stripTones(w.pinyin).includes(qToneless) ||
        (w.example_vietnamese?.toLowerCase().includes(q) ?? false)
    )
  }, [tableWords, tableSearch, isSearchingTable])

  useEffect(() => {
    setTablePage(1)
  }, [tableSearch])

  const tableTotalPages = Math.max(1, Math.ceil(filteredTableWords.length / TABLE_PAGE_SIZE))
  const tablePageWords = filteredTableWords.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
        <span>🎓</span> Từ Điển TOCFL
        <span className="text-[#1877f2] animate-sparkle">✦</span>
      </h2>

      {step === 'levels' ? (
        <div className="space-y-5">
          <div className="relative overflow-hidden bg-gradient-to-r from-blue-400 to-sky-500 text-white p-6 rounded-[24px] shadow-sm space-y-2">
            <Library className="w-28 h-28 absolute -right-4 -bottom-6 text-white/15 rotate-[-12deg] pointer-events-none" />
            <h3 className="text-xl font-extrabold flex items-center gap-2 relative">Chọn Cấp Độ</h3>
            <p className="font-semibold text-sm text-white/90 relative max-w-lg">
              Từ vựng lấy từ 華語八千詞表 — bộ từ vựng chính thức của TOCFL, cấp độ A1/A2/B1. Mỗi cấp độ có
              Flashcard, Nối Từ, Điền Từ để luyện tập, và bên dưới là toàn bộ từ điển của cấp độ đó kèm ví dụ
              đầy đủ để tra cứu.
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
                const pctFlash = info.total ? (info.learnedFlashcard / info.total) * 100 : 0
                const pctMatch = info.knownFlashcard ? (info.learnedMatching / info.knownFlashcard) * 100 : 0
                const pctFillIn = info.knownFlashcard ? (info.learnedFillIn / info.knownFlashcard) * 100 : 0
                const bothDone = info.total > 0 && info.learnedFillIn >= info.total
                return (
                  <button
                    key={info.level}
                    onClick={() => handleSelectLevel(info.level)}
                    className="cartoon-card cursor-pointer p-5 bg-white text-left space-y-3"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-slate-800 text-xl">{info.level}</span>
                      {bothDone && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 whitespace-nowrap">
                          🎉 Hoàn thành
                        </span>
                      )}
                      <span className="text-xs text-slate-400 font-bold ml-auto">{info.total} từ</span>
                      <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </div>
                    <div className="flex items-center justify-around gap-1 pt-1 border-t border-slate-100">
                      <div className="flex flex-col items-center gap-0.5" title={`Flashcard: ${info.learnedFlashcard}/${info.total}`}>
                        <ProgressRing percent={pctFlash} size={36} stroke={4} />
                        <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div className="flex flex-col items-center gap-0.5" title={`Nối Từ: ${info.learnedMatching}/${info.knownFlashcard}`}>
                        <ProgressRing percent={pctMatch} size={36} stroke={4} />
                        <Puzzle className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div className="flex flex-col items-center gap-0.5" title={`Điền Từ: ${info.learnedFillIn}/${info.knownFlashcard}`}>
                        <ProgressRing percent={pctFillIn} size={36} stroke={4} />
                        <Keyboard className="w-3.5 h-3.5 text-slate-400" />
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
                    {(info.fillInUnknownCount > 0 || info.fillInUnknownResolvedCount > 0) && (
                      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100">
                        <Keyboard className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <p className="text-[11px] font-bold text-amber-600">
                          {info.fillInUnknownCount} từ điền chưa xong
                          <span className="text-slate-400 font-semibold">
                            {' '}· đã ôn lại {info.fillInUnknownResolvedCount}/{info.fillInUnknownResolvedCount + info.fillInUnknownCount}
                          </span>
                        </p>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : step === 'detail' ? (
        <div className="space-y-6">
          <button
            onClick={() => setStep('levels')}
            className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Quay lại chọn cấp độ
          </button>

          {sizeChooserOpen && currentInfo ? (
            <div className="cartoon-card p-6 bg-white space-y-4">
              <button
                onClick={() => setSizeChooserOpen(false)}
                className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
              </button>

              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 shrink-0">
                  {React.createElement(unknownReviewMode ? AlertTriangle : reviewMode ? RotateCcw : MODE_META[activeMode].icon, { className: 'w-5 h-5' })}
                </div>
                <div>
                  <h4 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    {selectedLevel} — Số từ mỗi đợt
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">
                      {unknownReviewMode
                        ? activeMode === 'fill_in'
                          ? 'Điền Từ Chưa Xong'
                          : 'Từ Không Biết'
                        : reviewMode
                        ? `${MODE_META[activeMode].label} · Ôn tập`
                        : MODE_META[activeMode].label}
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500 font-semibold">
                    {unknownReviewMode
                      ? activeMode === 'fill_in'
                        ? 'Ôn lại các từ bạn đã điền sai hoặc chưa điền xong — điền đúng để từ đó không hiện lại nữa.'
                        : 'Ôn lại các từ bạn đã đánh dấu "Không Biết" — chọn Biết để từ đó không hiện lại nữa.'
                      : reviewMode
                      ? `Chọn số từ muốn ôn tập lại trong số các từ bạn đã ${MODE_VERB[activeMode]} xong.`
                      : activeMode === 'flashcard'
                      ? 'Học xong Flashcard sẽ tự động chuyển sang Nối Từ, rồi Điền Từ.'
                      : `Học xong đợt này sẽ chuyển sang đợt ${MODE_META[activeMode].label.toLowerCase()} tiếp theo.`}
                  </p>
                </div>
              </div>

              {remaining <= 0 ? (
                <div className="py-6 space-y-3 text-center">
                  <span className="text-4xl block">⚠️</span>
                  <h4 className="font-black text-slate-800 text-base">Không có từ nào để ôn tập</h4>
                  <p className="text-slate-500 text-xs font-semibold max-w-sm mx-auto">
                    {unknownReviewMode
                      ? activeMode === 'fill_in'
                        ? 'Bạn không còn từ nào chưa điền đúng trong cấp độ này.'
                        : 'Bạn không còn từ nào ở nhóm "chưa biết" trong cấp độ này.'
                      : reviewMode
                      ? `Bạn chưa ${MODE_VERB[activeMode]} từ nào để ôn tập.`
                      : activeMode === 'matching'
                      ? (currentInfo?.knownFlashcard ?? 0) === 0
                        ? 'Bạn chưa biết từ nào bằng Flashcard. Vui lòng học Flashcard trước.'
                        : 'Bạn đã Nối Từ xong tất cả các từ đã biết bằng Flashcard. Hãy học thêm Flashcard mới!'
                      : activeMode === 'fill_in'
                      ? (currentInfo?.knownFlashcard ?? 0) === 0
                        ? 'Bạn chưa biết từ nào bằng Flashcard. Vui lòng học Flashcard trước.'
                        : 'Bạn đã Điền Từ xong tất cả các từ đã biết bằng Flashcard. Hãy học thêm Flashcard mới!'
                      : 'Bạn đã học hết tất cả các từ trong cấp độ này bằng Flashcard!'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div>
                        <span className="block text-[10px] font-bold text-slate-400 uppercase leading-normal">
                          {unknownReviewMode ? 'Đã ôn lại xong' : reviewMode ? `${MODE_LEARNED_LABEL[activeMode]} (có thể ôn)` : MODE_LEARNED_LABEL[activeMode]}
                        </span>
                        <span className="text-sm font-black text-slate-700">
                          {unknownReviewMode
                            ? (activeMode === 'fill_in' ? currentInfo?.fillInUnknownResolvedCount ?? 0 : currentInfo?.unknownResolvedCount ?? 0)
                            : currentInfo
                            ? modeLearnedCount(currentInfo, activeMode)
                            : 0} từ
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold text-emerald-500 uppercase leading-normal">
                          {unknownReviewMode ? (activeMode === 'fill_in' ? 'Còn chưa xong' : 'Còn chưa biết') : reviewMode ? 'Có thể ôn tập' : 'Có thể học'}
                        </span>
                        <span className="text-sm font-black text-emerald-600">{remaining} từ</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-500 block">Chọn số từ đợt này:</span>
                    <div className="flex flex-wrap gap-2">
                      {STAGE_SIZE_PRESETS.filter((n) => n <= remaining).map((n) => {
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
                          <span className="block text-[10px] font-bold normal-case opacity-80">Tất cả còn lại</span>
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
                        if (val === '') { setCustomStageSize(''); return }
                        const num = parseInt(val, 10)
                        if (!isNaN(num)) setCustomStageSize(Math.min(remaining, Math.max(1, num)).toString())
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
                      const lvl = selectedLevel
                      setSizeChooserOpen(false)
                      if (lvl) startLevelMode(lvl, activeMode, size, reviewMode, unknownReviewMode)
                    }}
                    className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                  >
                    Bắt Đầu Học <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Row 1: Flashcard / Nối Từ / Điền Từ */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(['flashcard', 'matching', 'fill_in'] as StudyMode[]).map((m) => {
                  const meta = MODE_META[m]
                  const Icon = meta.icon
                  const learned = currentInfo ? modeLearnedCount(currentInfo, m) : 0
                  const poolTotal = currentInfo ? modePoolTotal(currentInfo, m) : 0
                  const pct = poolTotal ? (learned / poolTotal) * 100 : 0
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        if (!currentInfo) return
                        if (modeLearnedCount(currentInfo, m) > 0) {
                          setLearnStyleMode(m)
                          return
                        }
                        setActiveMode(m)
                        setReviewMode(false)
                        setUnknownReviewMode(false)
                        setSizeChooserOpen(true)
                        const rem = modePoolTotal(currentInfo, m) - modeLearnedCount(currentInfo, m)
                        setStageSizeChoice(Math.min(Math.max(rem, 1), DEFAULT_STAGE_SIZE))
                        setCustomStageSize('')
                      }}
                      className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-2"
                    >
                      <Icon className="w-8 h-8 mx-auto text-blue-500" />
                      <p className="font-black text-slate-700 text-sm">{meta.label}</p>
                      <p className="text-[11px] text-slate-400 font-semibold leading-snug">{meta.desc}</p>
                      <div className="flex items-center justify-center gap-2 pt-1">
                        <ProgressRing percent={pct} size={30} stroke={3.5} />
                        <span className="text-[11px] font-bold text-slate-500">{learned}/{poolTotal}</span>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Row 2: full dictionary table for this level */}
              <div className="space-y-3">
                <div className="cartoon-card p-3 bg-white flex items-center gap-2">
                  <Search className="w-5 h-5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Tra cứu theo Hán tự, Pinyin hoặc nghĩa tiếng Việt..."
                    className="flex-1 outline-none font-bold text-base bg-transparent"
                  />
                </div>

                <div className="cartoon-card bg-white overflow-hidden">
                  {tableLoading ? (
                    <div className="p-12 text-center">
                      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="font-bold text-slate-500">Đang tải từ điển...</p>
                    </div>
                  ) : tablePageWords.length === 0 ? (
                    <div className="p-12 text-center space-y-4">
                      <span className="text-6xl animate-float inline-block">📖</span>
                      <h3 className="text-xl font-extrabold text-slate-700">
                        {isSearchingTable ? 'Không tìm thấy từ nào phù hợp' : 'Chưa có dữ liệu từ điển cho cấp độ này'}
                      </h3>
                    </div>
                  ) : (
                    <WordCardList
                      startIndex={(tablePage - 1) * TABLE_PAGE_SIZE}
                      words={tablePageWords.map((w) => ({
                        id: w.id,
                        hanzi: w.hanzi,
                        pinyin: w.pinyin,
                        vietnamese: w.vietnamese,
                        pos: w.pos,
                        examples: w.example_hanzi
                          ? [{ hanzi: w.example_hanzi, pinyin: w.example_pinyin || '', vietnamese: w.example_vietnamese || '' }]
                          : [],
                      }))}
                    />
                  )}
                </div>

                {!tableLoading && filteredTableWords.length > 0 && (
                  <Pagination currentPage={tablePage} totalPages={tableTotalPages} onPageChange={setTablePage} />
                )}
              </div>
            </>
          )}

          {learnStyleMode && currentInfo && (
            <div
              className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4"
              onClick={() => setLearnStyleMode(null)}
            >
              <div
                className="cartoon-panel bg-white p-6 max-w-lg w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h4 className="font-black text-slate-800 text-lg text-center">
                  {selectedLevel} — {MODE_META[learnStyleMode].label}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(() => {
                    const verb = MODE_VERB[learnStyleMode]
                    const learned = modeLearnedCount(currentInfo, learnStyleMode)
                    const poolTotal = modePoolTotal(currentInfo, learnStyleMode)
                    const newRemaining = poolTotal - learned
                    const NewIcon = MODE_META[learnStyleMode].icon
                    return (
                      <button
                        disabled={newRemaining <= 0}
                        onClick={() => {
                          setActiveMode(learnStyleMode)
                          setReviewMode(false)
                          setUnknownReviewMode(false)
                          setSizeChooserOpen(true)
                          setLearnStyleMode(null)
                          setStageSizeChoice(Math.min(Math.max(newRemaining, 1), DEFAULT_STAGE_SIZE))
                          setCustomStageSize('')
                        }}
                        className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <NewIcon className="w-8 h-8 mx-auto text-blue-500" />
                        <p className="font-black text-slate-700 text-sm">{MODE_NEW_LABEL[learnStyleMode]}</p>
                        <p className="text-[11px] text-slate-400 font-semibold leading-snug">
                          {newRemaining > 0 ? `${newRemaining} từ chưa ${verb}` : `Đã ${verb} hết từ mới`}
                        </p>
                      </button>
                    )
                  })()}
                  <button
                    onClick={() => {
                      const learned = modeLearnedCount(currentInfo, learnStyleMode)
                      setActiveMode(learnStyleMode)
                      setReviewMode(true)
                      setUnknownReviewMode(false)
                      setSizeChooserOpen(true)
                      setLearnStyleMode(null)
                      setStageSizeChoice(Math.min(Math.max(learned, 1), DEFAULT_STAGE_SIZE))
                      setCustomStageSize('')
                    }}
                    className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5"
                  >
                    <RotateCcw className="w-8 h-8 mx-auto text-emerald-500" />
                    <p className="font-black text-slate-700 text-sm">Ôn Tập Từ Đã Học</p>
                    <p className="text-[11px] text-slate-400 font-semibold leading-snug">
                      {modeLearnedCount(currentInfo, learnStyleMode)} từ đã {MODE_VERB[learnStyleMode]}
                    </p>
                  </button>
                  {learnStyleMode === 'flashcard' && (
                    <button
                      disabled={currentInfo.unknownCount === 0}
                      onClick={() => {
                        setActiveMode('flashcard')
                        setReviewMode(true)
                        setUnknownReviewMode(true)
                        setSizeChooserOpen(true)
                        setLearnStyleMode(null)
                        setStageSizeChoice(Math.min(Math.max(currentInfo.unknownCount, 1), DEFAULT_STAGE_SIZE))
                        setCustomStageSize('')
                      }}
                      className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5 sm:col-span-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" />
                      <p className="font-black text-slate-700 text-sm">Học Từ Không Biết</p>
                      <p className="text-[11px] text-slate-400 font-semibold leading-snug">
                        {currentInfo.unknownCount > 0
                          ? `Ôn lại ${currentInfo.unknownCount} từ đã đánh dấu "không biết"`
                          : 'Chưa có từ nào bị đánh dấu "không biết"'}
                      </p>
                    </button>
                  )}
                  {learnStyleMode === 'fill_in' && (
                    <button
                      disabled={currentInfo.fillInUnknownCount === 0}
                      onClick={() => {
                        setActiveMode('fill_in')
                        setReviewMode(true)
                        setUnknownReviewMode(true)
                        setSizeChooserOpen(true)
                        setLearnStyleMode(null)
                        setStageSizeChoice(Math.min(Math.max(currentInfo.fillInUnknownCount, 1), DEFAULT_STAGE_SIZE))
                        setCustomStageSize('')
                      }}
                      className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5 sm:col-span-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Keyboard className="w-8 h-8 mx-auto text-amber-500" />
                      <p className="font-black text-slate-700 text-sm">Điền Từ Chưa Xong</p>
                      <p className="text-[11px] text-slate-400 font-semibold leading-snug">
                        {currentInfo.fillInUnknownCount > 0
                          ? `Ôn lại ${currentInfo.fillInUnknownCount} từ đã điền sai hoặc chưa xong`
                          : 'Chưa có từ nào bị điền sai/chưa xong'}
                      </p>
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setLearnStyleMode(null)}
                  className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 block mx-auto"
                >
                  Hủy
                </button>
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
                {unknownReviewMode ? `${selectedLevel} · Ôn Tập Từ Không Biết` : `${selectedLevel} · Đợt ${stageNumber}/${totalStages} · ${reviewMode ? 'Ôn Tập' : 'Flashcard'}`}
              </span>
            </div>
            <button onClick={() => { setStep('detail'); setReviewMode(false); setUnknownReviewMode(false) }} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          {chainMode && <ChainStepTracker current={currentStageMode} />}

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
                  {selectedLevel} · Đợt {stageNumber}/{totalStages} · Vòng {matchingRound + 1}/{Math.ceil(stageWords.length / ITEMS_PER_ROUND)}
                  {reviewMode ? ' · Ôn Tập' : ''}
                </span>
              </div>
            </div>
            <button onClick={() => { setStep('detail'); setReviewMode(false) }} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          {chainMode && <ChainStepTracker current={currentStageMode} />}

          <MatchingExercise vocabs={roundVocabs} matchType={matchingType} onComplete={handleMatchingRoundComplete} />
        </div>
      ) : step === 'fill_in' ? (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center text-purple-500 shrink-0">
                <Keyboard className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-sm text-slate-500 uppercase">
                {unknownReviewMode ? `${selectedLevel} · Ôn Tập Điền Từ Chưa Xong` : `${selectedLevel} · Đợt ${stageNumber}/${totalStages} · ${reviewMode ? 'Ôn Tập' : 'Điền Từ'}`}
              </span>
            </div>
            <button onClick={() => { setStep('detail'); setReviewMode(false); setUnknownReviewMode(false) }} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          {chainMode && <ChainStepTracker current={currentStageMode} />}

          <FillInExercise words={stageWords} onComplete={handleFillInSubmit} />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="cartoon-card bg-white p-8 text-center space-y-6 animate-float max-w-md mx-auto">
            <div className="w-20 h-20 bg-emerald-100 rounded-full shadow-md flex items-center justify-center text-emerald-500 mx-auto">
              {unknownReviewMode ? <AlertTriangle className="w-12 h-12" /> : reviewMode ? <RotateCcw className="w-12 h-12" /> : levelFullyComplete ? <Trophy className="w-12 h-12" /> : <CheckCircle className="w-12 h-12" />}
            </div>

            <div className="space-y-2">
              <h3 className="text-3xl font-black text-slate-800">
                {reviewMode ? 'Ôn Tập Xong! 🎉' : levelFullyComplete ? 'Hoàn Thành Toàn Bộ! 🎉' : `Xong Đợt ${stageNumber}! 🎉`}
              </h3>
              <p className="text-slate-500 font-bold">
                {unknownReviewMode
                  ? activeMode === 'fill_in'
                    ? fillInUnknownRemaining > 0
                      ? `Còn ${fillInUnknownRemaining} từ vẫn chưa điền đúng trong cấp độ ${selectedLevel}.`
                      : `Bạn đã điền đúng hết các từ "chưa xong" trong cấp độ ${selectedLevel}! 🎉`
                    : unknownRemaining > 0
                    ? `Còn ${unknownRemaining} từ vẫn chưa biết trong cấp độ ${selectedLevel}.`
                    : `Bạn đã học hết các từ "chưa biết" trong cấp độ ${selectedLevel}! 🎉`
                  : reviewMode
                  ? `Bạn đã ôn tập lại các từ đã học trong cấp độ ${selectedLevel}.`
                  : levelFullyComplete
                  ? `Chúc mừng! Bạn đã ${MODE_META[activeMode].label.toLowerCase()} hết cấp độ ${selectedLevel}.`
                  : `Còn ${totalStages - stageNumber} đợt nữa để hoàn thành ${MODE_META[activeMode].label.toLowerCase()} cấp độ này.`}
              </p>
              <span className="inline-block text-xs font-black px-3 py-1 rounded-full bg-blue-50 text-blue-600">
                {reviewMode ? `Đã ôn tập ${stageWords.length} từ` : `+${stageWords.length} từ đã học trong đợt này`}
              </span>
            </div>

            {unknownReviewMode ? (
              <div className="flex flex-col gap-2">
                {(activeMode === 'fill_in' ? fillInUnknownRemaining : unknownRemaining) > 0 && (
                  <button
                    onClick={() => selectedLevel && startLevelMode(selectedLevel, activeMode, stageSize, true, true)}
                    className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" /> Ôn Tập Lại
                  </button>
                )}
                <button
                  onClick={() => { setStep('detail'); setReviewMode(false); setUnknownReviewMode(false) }}
                  className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
                >
                  Quay Lại Cấp Độ
                </button>
              </div>
            ) : reviewMode ? (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => selectedLevel && startLevelMode(selectedLevel, activeMode, stageSize, true)}
                  className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Ôn Tập Lại
                </button>
                <button
                  onClick={() => { setStep('detail'); setReviewMode(false) }}
                  className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
                >
                  Quay Lại Cấp Độ
                </button>
              </div>
            ) : levelFullyComplete ? (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => selectedLevel && restartMode(selectedLevel, activeMode)}
                  className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Học Lại Từ Đầu
                </button>
                <button
                  onClick={() => setStep('detail')}
                  className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
                >
                  Quay Lại Cấp Độ
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button onClick={continueNextStage} className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2">
                  Học Đợt Tiếp Theo <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setStep('detail')}
                  className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
                >
                  Quay Lại Cấp Độ
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
