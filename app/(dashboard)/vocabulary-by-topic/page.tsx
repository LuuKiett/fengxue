'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/utils/supabasePagination'
import { shuffleArray } from '@/lib/utils/shuffle'
import { sortTopicKeys } from '@/lib/utils/topicVocabulary'
import { ensureProfile } from '@/lib/utils/ensureProfile'
import Flashcard from '@/components/learn/Flashcard'
import MatchingExercise from '@/components/exercises/MatchingExercise'
import FillInExercise from '@/components/exercises/FillInExercise'
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  CheckCircle,
  BookOpen,
  Puzzle,
  Keyboard,
  Trophy,
  Layers,
} from 'lucide-react'
import confetti from 'canvas-confetti'

const LEVELS = ['A1', 'A2', 'B1', 'B2']
const LEVEL_LABELS: Record<string, string> = {
  A1: 'Vỡ lòng',
  A2: 'Sơ cấp',
  B1: 'Trung cấp',
  B2: 'Trung cao cấp',
}

const STAGE_SIZE_PRESETS = [10, 20, 30, 50]
const DEFAULT_STAGE_SIZE = 50
const ITEMS_PER_ROUND = 6

type StudyMode = 'flashcard' | 'matching' | 'fill_in'

interface TopicInfo {
  topicKey: string
  total: number
  label: string
  icon: string
  learnedFlashcard: number
  learnedMatching: number
  learnedFillIn: number
}

interface TopicWord {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
  example_hanzi: string | null
  example_pinyin: string | null
  example_vietnamese: string | null
}

interface ProgressRow {
  word_order: string[]
  current_index: number
}

function getLearnedIds(progress: ProgressRow | null): string[] {
  return progress ? progress.word_order.slice(0, progress.current_index) : []
}

// How many words are already "learned" in a given mode, and the size of the pool
// that mode draws new words from. Matching and Fill-in both draw independently from
// the count already learned in Flashcard — Fill-in does NOT require Matching first
// (per explicit user request: finishing Flashcard alone should unlock Fill-in).
function modeLearnedCount(info: TopicInfo, mode: StudyMode): number {
  return mode === 'flashcard' ? info.learnedFlashcard : mode === 'matching' ? info.learnedMatching : info.learnedFillIn
}
function modePoolTotal(info: TopicInfo, mode: StudyMode): number {
  return mode === 'flashcard' ? info.total : info.learnedFlashcard
}
const MODE_VERB: Record<StudyMode, string> = { flashcard: 'học', matching: 'nối', fill_in: 'điền' }
const MODE_LEARNED_LABEL: Record<StudyMode, string> = { flashcard: 'Đã học', matching: 'Đã nối', fill_in: 'Đã điền' }
const MODE_NEW_LABEL: Record<StudyMode, string> = { flashcard: 'Học Từ Mới', matching: 'Nối Từ Mới', fill_in: 'Điền Từ Mới' }

// Small circular progress indicator, compact enough for 3 to sit side by side on a card.
function ProgressRing({ percent, size = 30, stroke = 3.5 }: { percent: number; size?: number; stroke?: number }) {
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
        <span className="text-[8px] font-black text-slate-600">{Math.round(percent)}%</span>
      </div>
    </div>
  )
}

const MODE_META: Record<StudyMode, { label: string; icon: typeof BookOpen; desc: string }> = {
  flashcard: { label: 'Flashcard', icon: BookOpen, desc: 'Học thẻ, sau đó nối từ và điền từ' },
  matching: { label: 'Nối Từ', icon: Puzzle, desc: 'Ôn lại các từ đã học bằng Flashcard' },
  fill_in: { label: 'Điền Từ', icon: Keyboard, desc: 'Ôn lại các từ đã học bằng Flashcard' },
}

// Shown only during a chained session (entered via "Flashcard") so it's clear the
// pipeline continues Flashcard -> Nối Từ -> Điền Từ, not just "Flashcard" alone.
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

export default function VocabularyByTopicPage() {
  const supabase = createClient()

  const [level, setLevel] = useState('A1')
  const [topicInfos, setTopicInfos] = useState<TopicInfo[]>([])
  const [loading, setLoading] = useState(true)

  // Topic clicked but mode not chosen yet — shows the Flashcard/Nối Từ/Điền Từ modal.
  const [modeSelectTopicKey, setModeSelectTopicKey] = useState<string | null>(null)
  // A mode chosen for a topic that already has learned words in that same mode —
  // shows the "học mới" / "Ôn Tập Từ Đã Học" sub-modal for whichever mode this is.
  const [learnStyleTopicKey, setLearnStyleTopicKey] = useState<string | null>(null)
  const [learnStyleMode, setLearnStyleMode] = useState<StudyMode>('flashcard')
  // Mode chosen for the topic currently being set up/studied.
  const [activeMode, setActiveMode] = useState<StudyMode>('flashcard')
  // True when the current/pending flashcard session is a review of already-learned
  // words (picked via the "Ôn Tập Từ Đã Học" option) rather than new words — review
  // sessions never advance `topic_vocabulary_progress` and never chain into Nối Từ.
  const [reviewMode, setReviewMode] = useState(false)
  // Whether this session should auto-chain forward (flashcard -> matching -> fill_in).
  // Only true when the user entered via "Flashcard"; direct "Nối Từ"/"Điền Từ" entry
  // only drills that single mode's own backlog.
  const [chainMode, setChainMode] = useState(false)
  // Which progress row is actively being advanced right now (changes as a chained
  // session moves from flashcard -> matching -> fill_in).
  const [currentStageMode, setCurrentStageMode] = useState<StudyMode>('flashcard')

  // Topic+mode picked but not started — shows the stage-size chooser.
  const [pendingTopicKey, setPendingTopicKey] = useState<string | null>(null)
  const [stageSizeChoice, setStageSizeChoice] = useState<number>(DEFAULT_STAGE_SIZE)
  const [customStageSize, setCustomStageSize] = useState('')
  const [stageSize, setStageSize] = useState(DEFAULT_STAGE_SIZE)

  const [step, setStep] = useState<'select' | 'flashcard' | 'matching' | 'fill_in' | 'complete'>('select')
  const [activeTopicKey, setActiveTopicKey] = useState<string | null>(null)
  const [stageWords, setStageWords] = useState<TopicWord[]>([])
  const [stageNumber, setStageNumber] = useState(1)
  const [totalStages, setTotalStages] = useState(1)
  const [topicFullyComplete, setTopicFullyComplete] = useState(false)

  const [flashIdx, setFlashIdx] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)

  const [matchingRound, setMatchingRound] = useState(0)
  const [matchingType, setMatchingType] = useState<'hanzi_pinyin' | 'hanzi_viet'>('hanzi_pinyin')
  const [roundVocabs, setRoundVocabs] = useState<TopicWord[]>([])

  // Cross-topic "Ôn Tập Nhóm Chủ Đề" — lets a student pick several topics at once and
  // review a random shuffle of words already learned via Flashcard across all of them,
  // in whichever of the 3 study modes they pick. Fully separate from the per-topic flow
  // above: it never touches `topic_vocabulary_progress` (same "review, no persistence"
  // contract as the single-topic `reviewMode` above), it just reuses reviewMode=true +
  // chainMode=false + the existing stageWords/flashIdx/matchingRound state and the same
  // Flashcard/MatchingExercise/FillInExercise rendering, with `activeTopicKey` set to a
  // sentinel ('__group__') so the existing reviewMode guards (`if (!activeTopicKey)
  // return`) stay satisfied without matching any real topic.
  const [groupPickMode, setGroupPickMode] = useState(false)
  const [selectedGroupTopics, setSelectedGroupTopics] = useState<string[]>([])
  const [groupModeModalOpen, setGroupModeModalOpen] = useState(false)
  const [groupMode, setGroupMode] = useState<StudyMode>('flashcard')
  const [groupSizeStep, setGroupSizeStep] = useState(false)
  const [groupStageSizeChoice, setGroupStageSizeChoice] = useState<number>(DEFAULT_STAGE_SIZE)
  const [groupCustomStageSize, setGroupCustomStageSize] = useState('')
  const [groupSessionActive, setGroupSessionActive] = useState(false)

  const progressAdvancedRef = useRef(false)

  async function loadTopicInfosForLevel(lvl: string) {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await ensureProfile(supabase)

      const rows = await fetchAllRows<{ topic_key: string; topic_label: string; topic_icon: string }>((from, to) =>
        supabase
          .from('topic_vocabulary')
          .select('topic_key, topic_label, topic_icon')
          .eq('level', lvl)
          .range(from, to)
      )
      const counts: Record<string, { total: number; label: string; icon: string }> = {}
      for (const r of rows) {
        if (!counts[r.topic_key]) counts[r.topic_key] = { total: 0, label: r.topic_label, icon: r.topic_icon }
        counts[r.topic_key].total++
      }

      const { data: progressRows } = await supabase
        .from('topic_vocabulary_progress')
        .select('topic_key, mode, current_index')
        .eq('user_id', user.id)
        .eq('level', lvl)

      const progressByTopicMode: Record<string, Record<string, number>> = {}
      for (const p of progressRows || []) {
        if (!progressByTopicMode[p.topic_key]) progressByTopicMode[p.topic_key] = {}
        progressByTopicMode[p.topic_key][p.mode] = p.current_index
      }

      const topicKeys = sortTopicKeys(Object.keys(counts))
      setTopicInfos(
        topicKeys.map((topicKey) => {
          const total = counts[topicKey].total
          const learnedFlashcard = Math.min(progressByTopicMode[topicKey]?.['flashcard'] || 0, total)
          const learnedMatching = Math.min(progressByTopicMode[topicKey]?.['matching'] || 0, learnedFlashcard)
          const learnedFillIn = Math.min(progressByTopicMode[topicKey]?.['fill_in'] || 0, learnedFlashcard)
          return {
            topicKey,
            total,
            label: counts[topicKey].label,
            icon: counts[topicKey].icon,
            learnedFlashcard,
            learnedMatching,
            learnedFillIn,
          }
        })
      )
    } catch (err) {
      console.error('Lỗi khi tải danh sách chủ đề:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTopicInfosForLevel(level)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level])

  const handleSelectLevel = (lvl: string) => {
    setLevel(lvl)
    setPendingTopicKey(null)
    setModeSelectTopicKey(null)
    setLearnStyleTopicKey(null)
    setReviewMode(false)
    // Selected topic keys were checked against this level's topic list — a topic_key
    // string can repeat across levels (e.g. "home-living" exists at both A1 and A2),
    // so a stale selection would otherwise silently carry over to the wrong level.
    setGroupPickMode(false)
    setSelectedGroupTopics([])
    setGroupSizeStep(false)
    setGroupModeModalOpen(false)
  }

  async function fetchProgressRow(userId: string, topicKey: string, mode: StudyMode): Promise<ProgressRow | null> {
    const { data } = await supabase
      .from('topic_vocabulary_progress')
      .select('word_order, current_index')
      .eq('user_id', userId)
      .eq('level', level)
      .eq('topic_key', topicKey)
      .eq('mode', mode)
      .maybeSingle()
    return data
  }

  async function startTopic(topicKey: string, mode: StudyMode, size: number, isReview: boolean = false) {
    setLoading(true)
    setStageSize(size)
    setActiveTopicKey(topicKey)
    setActiveMode(mode)
    setReviewMode(isReview)
    setChainMode(!isReview && mode === 'flashcard')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      if (isReview) {
        const progress = await fetchProgressRow(user.id, topicKey, mode)
        const learnedIds = getLearnedIds(progress)
        if (learnedIds.length === 0) { setLoading(false); return }
        const shuffled = shuffleArray(learnedIds)
        await loadStage(topicKey, mode, shuffled, 0, learnedIds.length, size)
      } else if (mode === 'flashcard') {
        const allWords = await fetchAllRows<{ id: string }>((from, to) =>
          supabase
            .from('topic_vocabulary')
            .select('id')
            .eq('level', level)
            .eq('topic_key', topicKey)
            .order('order_index', { ascending: true })
            .range(from, to)
        )
        const allIds = allWords.map((w) => w.id)
        if (allIds.length === 0) { setLoading(false); return }

        let progress = await fetchProgressRow(user.id, topicKey, 'flashcard')
        const idsMatch =
          progress && progress.word_order.length === allIds.length &&
          new Set(progress.word_order).size === new Set(allIds).size &&
          [...new Set(progress.word_order)].every((id) => allIds.includes(id))

        if (!progress || !idsMatch) {
          const wordOrder = shuffleArray(allIds)
          const { data: upserted } = await supabase
            .from('topic_vocabulary_progress')
            .upsert(
              { user_id: user.id, level, topic_key: topicKey, mode: 'flashcard', word_order: wordOrder, current_index: 0 },
              { onConflict: 'user_id,level,topic_key,mode' }
            )
            .select('word_order, current_index')
            .single()
          progress = upserted
        }
        if (!progress) { setLoading(false); return }
        await loadStage(topicKey, 'flashcard', progress.word_order, progress.current_index, allIds.length, size)
      } else {
        // Matching and Fill-in both draw independently from words already learned via
        // Flashcard — Fill-in is not gated behind completing Matching first.
        const parentProgress = await fetchProgressRow(user.id, topicKey, 'flashcard')
        const learnedIds = getLearnedIds(parentProgress)
        if (learnedIds.length === 0) { setLoading(false); return }

        const thisProgress = await fetchProgressRow(user.id, topicKey, mode)
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
          .from('topic_vocabulary_progress')
          .upsert(
            { user_id: user.id, level, topic_key: topicKey, mode, word_order: newWordOrder, current_index: newCurrentIndex, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,level,topic_key,mode' }
          )
          .select('word_order, current_index')
          .single()
        if (!upserted) { setLoading(false); return }
        await loadStage(topicKey, mode, upserted.word_order, upserted.current_index, learnedIds.length, size)
      }
    } catch (err) {
      console.error('Lỗi khi bắt đầu học chủ đề:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadStage(topicKey: string, mode: StudyMode, wordOrder: string[], currentIndex: number, total: number, size: number) {
    const stageIds = wordOrder.slice(currentIndex, currentIndex + size)

    if (stageIds.length === 0) {
      setTopicFullyComplete(true)
      setStep('complete')
      return
    }

    const { data: wordsData } = await supabase
      .from('topic_vocabulary')
      .select('id, hanzi, pinyin, vietnamese, example_hanzi, example_pinyin, example_vietnamese')
      .in('id', stageIds)

    const byId: Record<string, TopicWord> = {}
    for (const w of wordsData || []) byId[w.id] = w
    const ordered = shuffleArray(stageIds.map((id) => byId[id]).filter(Boolean))

    setStageWords(ordered)
    setStageNumber(Math.floor(currentIndex / size) + 1)
    setTotalStages(Math.ceil(total / size))
    setTopicFullyComplete(false)
    setFlashIdx(0)
    setIsFlipped(false)
    setCurrentStageMode(mode)
    if (mode === 'matching') {
      // Reset round state from the freshly-fetched `ordered` array, not the
      // `stageWords` state (still stale here — setStageWords above hasn't committed
      // yet) and not via prepareMatchingRound (reads that same stale `stageWords`
      // closure). Without this, any entry into Matching that goes through loadStage
      // directly — i.e. anything other than the Flashcard->Matching chain transition,
      // which sets this up manually in finishFlashcardStage — left `roundVocabs` at
      // its last value (empty on a fresh session), rendering MatchingExercise with no
      // cards at all.
      setMatchingRound(0)
      setMatchingType('hanzi_pinyin')
      setRoundVocabs(ordered.slice(0, ITEMS_PER_ROUND))
    }
    progressAdvancedRef.current = false
    setStep(mode)
  }

  const persistProgressAdvance = async (mode: StudyMode, topicKey: string, count: number): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

      const { data: progress } = await supabase
        .from('topic_vocabulary_progress')
        .select('word_order, current_index')
        .eq('user_id', user.id)
        .eq('level', level)
        .eq('topic_key', topicKey)
        .eq('mode', mode)
        .single()

      if (!progress) return false

      const newIndex = Math.min(progress.current_index + count, progress.word_order.length)
      await supabase
        .from('topic_vocabulary_progress')
        .update({ current_index: newIndex, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('level', level)
        .eq('topic_key', topicKey)
        .eq('mode', mode)

      const fullyComplete = newIndex >= progress.word_order.length

      setTopicInfos((prev) =>
        prev.map((t) => {
          if (t.topicKey !== topicKey) return t
          if (mode === 'flashcard') return { ...t, learnedFlashcard: newIndex }
          if (mode === 'matching') return { ...t, learnedMatching: newIndex }
          return { ...t, learnedFillIn: newIndex }
        })
      )

      return fullyComplete
    } catch (err) {
      console.error('Lỗi khi lưu tiến độ:', err)
      return false
    }
  }

  const handleFlashNext = () => {
    setIsFlipped(false)
    if (flashIdx < stageWords.length - 1) {
      setFlashIdx(flashIdx + 1)
    } else {
      finishFlashcardStage()
    }
  }

  const finishFlashcardStage = async () => {
    if (progressAdvancedRef.current || !activeTopicKey) return
    progressAdvancedRef.current = true
    if (reviewMode) {
      setTopicFullyComplete(false)
      setStep('complete')
      progressAdvancedRef.current = false
      return
    }
    await persistProgressAdvance('flashcard', activeTopicKey, stageWords.length)
    setMatchingRound(0)
    setMatchingType('hanzi_pinyin')
    prepareMatchingRound(0)
    setCurrentStageMode('matching')
    setStep('matching')
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

    if (!activeTopicKey || progressAdvancedRef.current) return
    progressAdvancedRef.current = true

    if (reviewMode) {
      setTopicFullyComplete(false)
      setStep('complete')
      progressAdvancedRef.current = false
      return
    }

    const fullyComplete = await persistProgressAdvance('matching', activeTopicKey, stageWords.length)

    if (chainMode) {
      setCurrentStageMode('fill_in')
      setStep('fill_in')
      progressAdvancedRef.current = false
    } else {
      setTopicFullyComplete(fullyComplete)
      setStep('complete')
      if (fullyComplete) triggerGrandConfetti()
    }
  }

  const handleFillInComplete = async () => {
    if (!activeTopicKey || progressAdvancedRef.current) return
    progressAdvancedRef.current = true

    if (reviewMode) {
      setTopicFullyComplete(false)
      setStep('complete')
      progressAdvancedRef.current = false
      return
    }

    const fullyComplete = await persistProgressAdvance('fill_in', activeTopicKey, stageWords.length)
    setTopicFullyComplete(fullyComplete)
    setStep('complete')
    if (fullyComplete) triggerGrandConfetti()
  }

  const continueNextStage = async () => {
    if (!activeTopicKey) return
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      if (activeMode !== 'flashcard') {
        const parentProgress = await fetchProgressRow(user.id, activeTopicKey, 'flashcard')
        const learnedIds = getLearnedIds(parentProgress)
        const thisProgress = await fetchProgressRow(user.id, activeTopicKey, activeMode)

        if (thisProgress) {
          const completedIds = thisProgress.word_order.slice(0, thisProgress.current_index).filter((id) => learnedIds.includes(id))
          const remainingLearnedIds = learnedIds.filter((id) => !completedIds.includes(id))
          const newWordOrder = [...completedIds, ...shuffleArray(remainingLearnedIds)]
          const newCurrentIndex = completedIds.length

          const { data: upserted } = await supabase
            .from('topic_vocabulary_progress')
            .update({ word_order: newWordOrder, current_index: newCurrentIndex, updated_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('level', level)
            .eq('topic_key', activeTopicKey)
            .eq('mode', activeMode)
            .select('word_order, current_index')
            .single()

          if (upserted) {
            await loadStage(activeTopicKey, activeMode, upserted.word_order, upserted.current_index, learnedIds.length, stageSize)
            return
          }
        }
      }

      const { data: progress } = await supabase
        .from('topic_vocabulary_progress')
        .select('word_order, current_index')
        .eq('user_id', user.id)
        .eq('level', level)
        .eq('topic_key', activeTopicKey)
        .eq('mode', activeMode)
        .single()
      if (!progress) return
      await loadStage(activeTopicKey, activeMode, progress.word_order, progress.current_index, progress.word_order.length, stageSize)
    } finally {
      setLoading(false)
    }
  }

  const restartMode = async (topicKey: string, mode: StudyMode) => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      let wordOrder: string[] = []
      if (mode === 'flashcard') {
        const allWords = await fetchAllRows<{ id: string }>((from, to) =>
          supabase.from('topic_vocabulary').select('id').eq('level', level).eq('topic_key', topicKey).range(from, to)
        )
        wordOrder = shuffleArray(allWords.map((w) => w.id))
      } else {
        const parentProgress = await fetchProgressRow(user.id, topicKey, 'flashcard')
        wordOrder = shuffleArray(getLearnedIds(parentProgress))
      }

      await supabase
        .from('topic_vocabulary_progress')
        .upsert(
          { user_id: user.id, level, topic_key: topicKey, mode, word_order: wordOrder, current_index: 0, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,level,topic_key,mode' }
        )

      setTopicInfos((prev) =>
        prev.map((t) => {
          if (t.topicKey !== topicKey) return t
          if (mode === 'flashcard') return { ...t, learnedFlashcard: 0, learnedMatching: 0, learnedFillIn: 0 }
          if (mode === 'matching') return { ...t, learnedMatching: 0 }
          return { ...t, learnedFillIn: 0 }
        })
      )
      setStep('select')
      setActiveTopicKey(null)
      setPendingTopicKey(null)
    } finally {
      setLoading(false)
    }
  }

  async function startGroupReview(size: number) {
    setLoading(true)
    setGroupSizeStep(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const topicsForSession = selectedGroupTopics
      const modeForSession = groupMode

      const allLearnedIds: string[] = []
      for (const topicKey of topicsForSession) {
        const progress = await fetchProgressRow(user.id, topicKey, 'flashcard')
        allLearnedIds.push(...getLearnedIds(progress))
      }
      if (allLearnedIds.length === 0) { setLoading(false); return }

      const pickedIds = shuffleArray(allLearnedIds).slice(0, size)
      const { data: wordsData } = await supabase
        .from('topic_vocabulary')
        .select('id, hanzi, pinyin, vietnamese, example_hanzi, example_pinyin, example_vietnamese')
        .in('id', pickedIds)

      const byId: Record<string, TopicWord> = {}
      for (const w of wordsData || []) byId[w.id] = w
      const ordered = shuffleArray(pickedIds.map((id) => byId[id]).filter(Boolean))

      setStageWords(ordered)
      setStageSize(size)
      setStageNumber(1)
      setTotalStages(1)
      setTopicFullyComplete(false)
      setFlashIdx(0)
      setIsFlipped(false)
      setActiveMode(modeForSession)
      setCurrentStageMode(modeForSession)
      setReviewMode(true)
      setChainMode(false)
      setActiveTopicKey('__group__')
      setGroupSessionActive(true)
      if (modeForSession === 'matching') {
        setMatchingRound(0)
        setMatchingType('hanzi_pinyin')
        setRoundVocabs(ordered.slice(0, ITEMS_PER_ROUND))
      }
      progressAdvancedRef.current = false
      setStep(modeForSession)
    } catch (err) {
      console.error('Lỗi khi bắt đầu ôn tập nhóm chủ đề:', err)
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
    if (matchingType === 'hanzi_pinyin') return 'Chữ Hán ↔ Phiên âm'
    return 'Chữ Hán ↔ Nghĩa Việt'
  }

  const info = topicInfos.find((t) => t.topicKey === pendingTopicKey)
  const remaining = !info
    ? 0
    : reviewMode
    ? modeLearnedCount(info, activeMode)
    : modePoolTotal(info, activeMode) - modeLearnedCount(info, activeMode)

  const modeSelectInfo = topicInfos.find((t) => t.topicKey === modeSelectTopicKey)
  const learnStyleInfo = topicInfos.find((t) => t.topicKey === learnStyleTopicKey)
  const activeTopicInfo = topicInfos.find((t) => t.topicKey === activeTopicKey)

  // Group review's pool is always words learned via Flashcard, regardless of which of
  // the 3 study modes is picked to review them in — there's no per-topic gating chain
  // (matching/fill_in "parent pool") to reuse once topics are mixed together.
  const groupLearnedTotal = topicInfos
    .filter((t) => selectedGroupTopics.includes(t.topicKey))
    .reduce((sum, t) => sum + t.learnedFlashcard, 0)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
        <span>🗂️</span> Học Từ Vựng Theo Chủ Đề
        <span className="text-[#1877f2] animate-sparkle">✦</span>
      </h2>

      {step === 'select' ? (
        <div className="space-y-5">
          {groupSizeStep ? (
            <div className="cartoon-card p-6 bg-white space-y-4">
              <button
                onClick={() => setGroupSizeStep(false)}
                className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Quay lại chọn chế độ
              </button>

              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 shrink-0">
                  {React.createElement(MODE_META[groupMode].icon, { className: 'w-5 h-5' })}
                </div>
                <div>
                  <h4 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    Ôn Tập Nhóm Chủ Đề — Số từ mỗi đợt
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">
                      {MODE_META[groupMode].label} · Ôn tập
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500 font-semibold">
                    Chọn số từ muốn ôn tập ngẫu nhiên trong số các từ đã học bằng Flashcard ở {selectedGroupTopics.length} chủ đề đã chọn.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                <div className="text-center">
                  <span className="block text-[10px] font-bold text-emerald-500 uppercase leading-normal">
                    Tổng từ đã học (Flashcard) ở các chủ đề đã chọn
                  </span>
                  <span className="text-sm font-black text-emerald-600">{groupLearnedTotal} từ</span>
                </div>
              </div>

              {groupLearnedTotal === 0 ? (
                <p className="text-xs text-center text-red-500 font-bold py-2">
                  Các chủ đề đã chọn chưa có từ nào học bằng Flashcard. Vui lòng học Flashcard trước.
                </p>
              ) : (
                <>
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-500 block">Chọn số từ đợt này:</span>
                    <div className="flex flex-wrap gap-2">
                      {STAGE_SIZE_PRESETS.filter((n) => n <= groupLearnedTotal).map((n) => {
                        const active = !groupCustomStageSize && groupStageSizeChoice === n
                        return (
                          <button
                            key={n}
                            onClick={() => { setGroupStageSizeChoice(n); setGroupCustomStageSize('') }}
                            className={`cursor-pointer px-4 py-2.5 rounded-2xl font-black text-sm transition-all border-2 ${
                              active
                                ? 'bg-[#1877f2] border-blue-600 text-white shadow-sm'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-blue-200'
                            }`}
                          >
                            <span className="block">{n} từ</span>
                          </button>
                        )
                      })}
                      {!STAGE_SIZE_PRESETS.includes(groupLearnedTotal) && (
                        <button
                          onClick={() => { setGroupStageSizeChoice(groupLearnedTotal); setGroupCustomStageSize('') }}
                          className={`cursor-pointer px-4 py-2.5 rounded-2xl font-black text-sm transition-all border-2 ${
                            !groupCustomStageSize && groupStageSizeChoice === groupLearnedTotal
                              ? 'bg-[#1877f2] border-blue-600 text-white shadow-sm'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-blue-200'
                          }`}
                        >
                          <span className="block">{groupLearnedTotal} từ</span>
                          <span className="block text-[10px] font-bold normal-case opacity-80">Tất cả</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 block">
                      Hoặc nhập số tùy chỉnh (Tối đa {groupLearnedTotal} từ):
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={groupLearnedTotal}
                      value={groupCustomStageSize}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === '') { setGroupCustomStageSize(''); return }
                        const num = parseInt(val, 10)
                        if (!isNaN(num)) setGroupCustomStageSize(Math.min(groupLearnedTotal, Math.max(1, num)).toString())
                      }}
                      placeholder={`VD: ${Math.min(25, groupLearnedTotal)}`}
                      className="w-36 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold text-sm"
                    />
                  </div>

                  <button
                    onClick={() => {
                      const size = groupCustomStageSize
                        ? Math.max(1, Math.min(groupLearnedTotal, parseInt(groupCustomStageSize, 10) || DEFAULT_STAGE_SIZE))
                        : Math.min(groupLearnedTotal, groupStageSizeChoice)
                      startGroupReview(size)
                    }}
                    className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                  >
                    Bắt Đầu Ôn Tập <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ) : !pendingTopicKey ? (
            <>
              {/* Level tabs */}
              <div className="flex gap-2 flex-wrap">
                {LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => handleSelectLevel(lvl)}
                    className={`cursor-pointer px-4 py-2.5 rounded-2xl font-black text-sm transition-all border-2 ${
                      level === lvl
                        ? 'bg-[#1877f2] border-blue-600 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-blue-200'
                    }`}
                  >
                    {lvl}
                    <span className={`block text-[10px] font-bold normal-case ${level === lvl ? 'text-white/80' : 'text-slate-400'}`}>
                      {LEVEL_LABELS[lvl]}
                    </span>
                  </button>
                ))}
              </div>

              {/* Group-topic picker toggle */}
              <div className="flex items-center justify-between flex-wrap gap-2 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                <button
                  onClick={() => {
                    setGroupPickMode((v) => !v)
                    setSelectedGroupTopics([])
                  }}
                  className={`cursor-pointer px-3 py-2 rounded-xl font-black text-xs border-2 flex items-center gap-1.5 transition-all ${
                    groupPickMode
                      ? 'bg-blue-50 border-blue-300 text-blue-600'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-blue-200'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" /> {groupPickMode ? 'Đang Chọn Nhóm Chủ Đề' : 'Chọn Nhóm Chủ Đề'}
                </button>
                {groupPickMode && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">Đã chọn {selectedGroupTopics.length} chủ đề</span>
                    <button
                      disabled={selectedGroupTopics.length === 0}
                      onClick={() => setGroupModeModalOpen(true)}
                      className="cartoon-btn px-4 py-2 text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      Bắt Đầu Ôn Tập <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {loading ? (
                <div className="cartoon-card p-8 bg-white text-center">
                  <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <p className="text-xs text-slate-400 font-bold">Đang tải danh sách chủ đề...</p>
                </div>
              ) : topicInfos.length === 0 ? (
                <div className="cartoon-card p-8 bg-white text-center space-y-2">
                  <span className="text-5xl inline-block">📭</span>
                  <p className="text-slate-400 font-semibold">Chưa có từ vựng theo chủ đề cho cấp độ này.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {topicInfos.map((t) => {
                    const pctFlash = t.total ? (t.learnedFlashcard / t.total) * 100 : 0
                    const pctMatch = t.learnedFlashcard ? (t.learnedMatching / t.learnedFlashcard) * 100 : 0
                    const pctFillIn = t.learnedFlashcard ? (t.learnedFillIn / t.learnedFlashcard) * 100 : 0
                    const bothDone = t.total > 0 && t.learnedFillIn >= t.total
                    const isSelectedForGroup = selectedGroupTopics.includes(t.topicKey)
                    return (
                      <button
                        key={t.topicKey}
                        onClick={() => {
                          if (groupPickMode) {
                            setSelectedGroupTopics((prev) =>
                              prev.includes(t.topicKey) ? prev.filter((k) => k !== t.topicKey) : [...prev, t.topicKey]
                            )
                            return
                          }
                          setModeSelectTopicKey(t.topicKey)
                        }}
                        className={`cartoon-card cursor-pointer p-4 bg-white text-left space-y-3 relative ${
                          groupPickMode && isSelectedForGroup ? 'ring-2 ring-blue-400 border-blue-300' : ''
                        }`}
                      >
                        {groupPickMode && (
                          <div
                            className={`absolute top-2.5 right-2.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                              isSelectedForGroup ? 'bg-blue-500 border-blue-600' : 'bg-white border-slate-300'
                            }`}
                          >
                            {isSelectedForGroup && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <div className="text-3xl leading-none shrink-0">{t.icon}</div>
                          <div className="min-w-0 flex-1">
                            <div className="font-black text-slate-800 text-sm leading-snug flex items-center gap-1.5 flex-wrap">
                              {t.label}
                              {bothDone && (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 whitespace-nowrap">🎉</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 font-bold">{t.total} từ</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-around gap-1 pt-1 border-t border-slate-100">
                          <div className="flex flex-col items-center gap-0.5" title={`Flashcard: ${t.learnedFlashcard}/${t.total}`}>
                            <ProgressRing percent={pctFlash} />
                            <BookOpen className="w-3 h-3 text-slate-400" />
                          </div>
                          <div className="flex flex-col items-center gap-0.5" title={`Nối Từ: ${t.learnedMatching}/${t.learnedFlashcard}`}>
                            <ProgressRing percent={pctMatch} />
                            <Puzzle className="w-3 h-3 text-slate-400" />
                          </div>
                          <div className="flex flex-col items-center gap-0.5" title={`Điền Từ: ${t.learnedFillIn}/${t.learnedFlashcard}`}>
                            <ProgressRing percent={pctFillIn} />
                            <Keyboard className="w-3 h-3 text-slate-400" />
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          ) : remaining <= 0 ? (
            <div className="cartoon-card p-6 bg-white space-y-4 text-center">
              <button
                onClick={() => setPendingTopicKey(null)}
                className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 mx-auto"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Quay lại chọn chủ đề
              </button>
              <div className="py-6 space-y-3">
                <span className="text-4xl block">⚠️</span>
                <h4 className="font-black text-slate-800 text-base">Không có từ nào để ôn tập</h4>
                <p className="text-slate-500 text-xs font-semibold max-w-sm mx-auto">
                  {reviewMode
                    ? `Bạn chưa ${MODE_VERB[activeMode]} từ nào để ôn tập.`
                    : activeMode === 'matching'
                    ? (info?.learnedFlashcard ?? 0) === 0
                      ? 'Bạn chưa học từ nào bằng Flashcard. Vui lòng học Flashcard trước.'
                      : 'Bạn đã Nối Từ xong tất cả các từ đã học bằng Flashcard. Hãy học thêm Flashcard mới!'
                    : activeMode === 'fill_in'
                    ? (info?.learnedFlashcard ?? 0) === 0
                      ? 'Bạn chưa học từ nào bằng Flashcard. Vui lòng học Flashcard trước.'
                      : 'Bạn đã Điền Từ xong tất cả các từ đã học bằng Flashcard. Hãy học thêm Flashcard mới!'
                    : 'Bạn đã học hết tất cả các từ trong chủ đề này bằng Flashcard!'}
                </p>
              </div>
            </div>
          ) : (
            <div className="cartoon-card p-6 bg-white space-y-4">
              <button
                onClick={() => setPendingTopicKey(null)}
                className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Quay lại chọn chủ đề
              </button>

              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 shrink-0">
                  {React.createElement(reviewMode ? RotateCcw : MODE_META[activeMode].icon, { className: 'w-5 h-5' })}
                </div>
                <div>
                  <h4 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    {info?.icon} {info?.label} — Số từ mỗi đợt
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">
                      {reviewMode ? `${MODE_META[activeMode].label} · Ôn tập` : MODE_META[activeMode].label}
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500 font-semibold">
                    {reviewMode
                      ? `Chọn số từ muốn ôn tập lại trong số các từ bạn đã ${MODE_VERB[activeMode]} xong.`
                      : activeMode === 'flashcard'
                      ? 'Học xong Flashcard sẽ tự động chuyển sang Nối Từ, rồi Điền Từ.'
                      : `Học xong đợt này sẽ chuyển sang đợt ${MODE_META[activeMode].label.toLowerCase()} tiếp theo.`}
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase leading-normal">
                      {reviewMode ? `${MODE_LEARNED_LABEL[activeMode]} (có thể ôn)` : MODE_LEARNED_LABEL[activeMode]}
                    </span>
                    <span className="text-sm font-black text-slate-700">
                      {info ? modeLearnedCount(info, activeMode) : 0} từ
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-emerald-500 uppercase leading-normal">
                      {reviewMode ? 'Có thể ôn tập' : 'Có thể học'}
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
                  const topicKey = pendingTopicKey
                  setPendingTopicKey(null)
                  startTopic(topicKey, activeMode, size, reviewMode)
                }}
                className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
              >
                Bắt Đầu Học <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {modeSelectTopicKey && modeSelectInfo && (
            <div
              className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4"
              onClick={() => setModeSelectTopicKey(null)}
            >
              <div
                className="cartoon-panel bg-white p-6 max-w-lg w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h4 className="font-black text-slate-800 text-lg text-center">
                  {modeSelectInfo.icon} {modeSelectInfo.label} — Chọn Chế Độ Học
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(['flashcard', 'matching', 'fill_in'] as StudyMode[]).map((m) => {
                    const meta = MODE_META[m]
                    const Icon = meta.icon
                    return (
                      <button
                        key={m}
                        onClick={() => {
                          // Any mode on a topic that already has learned words *in that
                          // same mode*: ask "new words" vs "review learned words" first,
                          // instead of assuming new-words-only (see learnStyleTopicKey
                          // modal below) — otherwise a topic fully drilled in this mode
                          // has an empty "new words" pool and nothing to do.
                          if (modeLearnedCount(modeSelectInfo, m) > 0) {
                            setLearnStyleMode(m)
                            setLearnStyleTopicKey(modeSelectInfo.topicKey)
                            setModeSelectTopicKey(null)
                            return
                          }
                          setActiveMode(m)
                          setReviewMode(false)
                          setPendingTopicKey(modeSelectInfo.topicKey)
                          setModeSelectTopicKey(null)
                          const rem = modePoolTotal(modeSelectInfo, m) - modeLearnedCount(modeSelectInfo, m)
                          setStageSizeChoice(Math.min(Math.max(rem, 1), DEFAULT_STAGE_SIZE))
                          setCustomStageSize('')
                        }}
                        className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5"
                      >
                        <Icon className="w-8 h-8 mx-auto text-blue-500" />
                        <p className="font-black text-slate-700 text-sm">{meta.label}</p>
                        <p className="text-[11px] text-slate-400 font-semibold leading-snug">{meta.desc}</p>
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={() => setModeSelectTopicKey(null)}
                  className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 block mx-auto"
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          {learnStyleTopicKey && learnStyleInfo && (
            <div
              className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4"
              onClick={() => setLearnStyleTopicKey(null)}
            >
              <div
                className="cartoon-panel bg-white p-6 max-w-lg w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h4 className="font-black text-slate-800 text-lg text-center">
                  {learnStyleInfo.icon} {learnStyleInfo.label} — {MODE_META[learnStyleMode].label}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(() => {
                    const verb = MODE_VERB[learnStyleMode]
                    const learned = modeLearnedCount(learnStyleInfo, learnStyleMode)
                    const poolTotal = modePoolTotal(learnStyleInfo, learnStyleMode)
                    const newRemaining = poolTotal - learned
                    const NewIcon = MODE_META[learnStyleMode].icon
                    return (
                      <button
                        disabled={newRemaining <= 0}
                        onClick={() => {
                          setActiveMode(learnStyleMode)
                          setReviewMode(false)
                          setPendingTopicKey(learnStyleInfo.topicKey)
                          setLearnStyleTopicKey(null)
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
                      const learned = modeLearnedCount(learnStyleInfo, learnStyleMode)
                      setActiveMode(learnStyleMode)
                      setReviewMode(true)
                      setPendingTopicKey(learnStyleInfo.topicKey)
                      setLearnStyleTopicKey(null)
                      setStageSizeChoice(Math.min(Math.max(learned, 1), DEFAULT_STAGE_SIZE))
                      setCustomStageSize('')
                    }}
                    className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5"
                  >
                    <RotateCcw className="w-8 h-8 mx-auto text-emerald-500" />
                    <p className="font-black text-slate-700 text-sm">Ôn Tập Từ Đã Học</p>
                    <p className="text-[11px] text-slate-400 font-semibold leading-snug">
                      {modeLearnedCount(learnStyleInfo, learnStyleMode)} từ đã {MODE_VERB[learnStyleMode]}
                    </p>
                  </button>
                </div>
                <button
                  onClick={() => setLearnStyleTopicKey(null)}
                  className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 block mx-auto"
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          {groupModeModalOpen && (
            <div
              className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4"
              onClick={() => setGroupModeModalOpen(false)}
            >
              <div
                className="cartoon-panel bg-white p-6 max-w-lg w-full space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h4 className="font-black text-slate-800 text-lg text-center">
                  🗂️ Ôn Tập {selectedGroupTopics.length} Chủ Đề — Chọn Chế Độ
                </h4>
                <p className="text-xs text-slate-500 font-semibold text-center -mt-2">
                  Sẽ ôn lại các từ đã học bằng Flashcard, gộp ngẫu nhiên từ các chủ đề đã chọn.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(['flashcard', 'matching', 'fill_in'] as StudyMode[]).map((m) => {
                    const meta = MODE_META[m]
                    const Icon = meta.icon
                    return (
                      <button
                        key={m}
                        onClick={() => {
                          setGroupMode(m)
                          setGroupModeModalOpen(false)
                          setGroupSizeStep(true)
                          setGroupStageSizeChoice(Math.min(Math.max(groupLearnedTotal, 1), DEFAULT_STAGE_SIZE))
                          setGroupCustomStageSize('')
                        }}
                        className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5"
                      >
                        <Icon className="w-8 h-8 mx-auto text-blue-500" />
                        <p className="font-black text-slate-700 text-sm">{meta.label}</p>
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={() => setGroupModeModalOpen(false)}
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
                <BookOpen className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-sm text-slate-500 uppercase">
                {groupSessionActive ? `🗂️ Ôn Tập ${selectedGroupTopics.length} Chủ Đề` : `${activeTopicInfo?.icon} ${activeTopicInfo?.label}`} · Đợt {stageNumber}/{totalStages} · {reviewMode ? 'Ôn Tập' : 'Flashcard'}
              </span>
            </div>
            <button onClick={() => { setStep('select'); setReviewMode(false); setGroupSessionActive(false) }} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
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
            <button onClick={handleFlashNext} className="cartoon-btn px-5 py-3 text-sm flex items-center gap-2">
              {flashIdx === stageWords.length - 1 ? (reviewMode ? 'Hoàn Thành Ôn Tập' : 'Chuyển Sang Nối Từ') : 'Tiếp theo'} <ArrowRight className="w-4 h-4" />
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
                  {groupSessionActive ? `🗂️ Ôn Tập ${selectedGroupTopics.length} Chủ Đề` : `${activeTopicInfo?.icon} ${activeTopicInfo?.label}`} · Đợt {stageNumber}/{totalStages} · Vòng {matchingRound + 1}/{Math.ceil(stageWords.length / ITEMS_PER_ROUND)}
                  {reviewMode ? ' · Ôn Tập' : ''}
                </span>
              </div>
            </div>
            <button onClick={() => { setStep('select'); setReviewMode(false); setGroupSessionActive(false) }} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
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
                {groupSessionActive ? `🗂️ Ôn Tập ${selectedGroupTopics.length} Chủ Đề` : `${activeTopicInfo?.icon} ${activeTopicInfo?.label}`} · Đợt {stageNumber}/{totalStages} · {reviewMode ? 'Ôn Tập' : 'Điền Từ'}
              </span>
            </div>
            <button onClick={() => { setStep('select'); setReviewMode(false); setGroupSessionActive(false) }} className="cursor-pointer font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          {chainMode && <ChainStepTracker current={currentStageMode} />}

          <FillInExercise words={stageWords} onComplete={handleFillInComplete} />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="cartoon-card bg-white p-8 text-center space-y-6 animate-float max-w-md mx-auto">
            <div className="w-20 h-20 bg-emerald-100 rounded-full shadow-md flex items-center justify-center text-emerald-500 mx-auto">
              {reviewMode ? <RotateCcw className="w-12 h-12" /> : topicFullyComplete ? <Trophy className="w-12 h-12" /> : <CheckCircle className="w-12 h-12" />}
            </div>

            <div className="space-y-2">
              <h3 className="text-3xl font-black text-slate-800">
                {reviewMode ? 'Ôn Tập Xong! 🎉' : topicFullyComplete ? 'Hoàn Thành Toàn Bộ! 🎉' : `Xong Đợt ${stageNumber}! 🎉`}
              </h3>
              <p className="text-slate-500 font-bold">
                {groupSessionActive
                  ? `Bạn đã ôn tập lại các từ đã học bằng Flashcard trong ${selectedGroupTopics.length} chủ đề đã chọn.`
                  : reviewMode
                  ? `Bạn đã ôn tập lại các từ đã học trong chủ đề ${activeTopicInfo?.label}.`
                  : topicFullyComplete
                  ? `Chúc mừng! Bạn đã ${MODE_META[activeMode].label.toLowerCase()} hết chủ đề ${activeTopicInfo?.label}.`
                  : `Còn ${totalStages - stageNumber} đợt nữa để hoàn thành ${MODE_META[activeMode].label.toLowerCase()} chủ đề này.`}
              </p>
              <span className="inline-block text-xs font-black px-3 py-1 rounded-full bg-blue-50 text-blue-600">
                {reviewMode ? `Đã ôn tập ${stageWords.length} từ` : `+${stageWords.length} từ đã học trong đợt này`}
              </span>
            </div>

            {reviewMode ? (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() =>
                    groupSessionActive ? startGroupReview(stageSize) : activeTopicKey && startTopic(activeTopicKey, activeMode, stageSize, true)
                  }
                  className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Ôn Tập Lại
                </button>
                <button
                  onClick={() => {
                    setStep('select')
                    setReviewMode(false)
                    setGroupSessionActive(false)
                    if (groupSessionActive) {
                      setGroupPickMode(false)
                      setSelectedGroupTopics([])
                    }
                    loadTopicInfosForLevel(level)
                  }}
                  className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
                >
                  Quay Lại Chọn Chủ Đề
                </button>
              </div>
            ) : topicFullyComplete ? (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => activeTopicKey && restartMode(activeTopicKey, activeMode)}
                  className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Học Lại Từ Đầu
                </button>
                <button
                  onClick={() => { setStep('select'); loadTopicInfosForLevel(level) }}
                  className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
                >
                  Quay Lại Chọn Chủ Đề
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button onClick={continueNextStage} className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2">
                  Học Đợt Tiếp Theo <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setStep('select'); loadTopicInfosForLevel(level) }}
                  className="cartoon-btn cartoon-btn-secondary w-full py-3 text-sm"
                >
                  Quay Lại Chọn Chủ Đề
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
