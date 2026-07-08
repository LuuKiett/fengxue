'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { shuffleArray } from '@/lib/utils/shuffle'
import { sortLevels } from '@/lib/utils/dictionaryLevels'
import Flashcard from '@/components/learn/Flashcard'
import MatchingExercise from '@/components/exercises/MatchingExercise'
import {
  ArrowRight,
  ArrowLeft,
  Sparkles,
  CheckCircle,
  Trophy,
  RotateCcw,
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
  learned: number
}

const STAGE_SIZE_PRESETS = [10, 20, 30, 50]
const DEFAULT_STAGE_SIZE = 50
const ITEMS_PER_ROUND = 6

export default function ReviewDictionaryPage() {
  const supabase = createClient()

  const [levelInfos, setLevelInfos] = useState<LevelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeLevel, setActiveLevel] = useState<string | null>(null)

  // Level picked but not yet started — shows the "how many words per round?" chooser
  const [pendingLevel, setPendingLevel] = useState<string | null>(null)
  const [stageSizeChoice, setStageSizeChoice] = useState<number>(DEFAULT_STAGE_SIZE)
  const [customStageSize, setCustomStageSize] = useState('')
  // The size actually used for the level currently in progress (kept stable across its stages)
  const [stageSize, setStageSize] = useState(DEFAULT_STAGE_SIZE)

  const [step, setStep] = useState<'select' | 'flashcard' | 'matching' | 'complete'>('select')
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

  async function loadLevelInfos() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: words } = await supabase.from('dictionary_words').select('level')
      const counts: Record<string, number> = {}
      for (const w of words || []) counts[w.level] = (counts[w.level] || 0) + 1

      const { data: progressRows } = await supabase
        .from('dictionary_progress')
        .select('level, current_index')
        .eq('user_id', user.id)

      const progressByLevel: Record<string, number> = {}
      for (const p of progressRows || []) progressByLevel[p.level] = p.current_index

      const levels = sortLevels(Object.keys(counts))
      setLevelInfos(
        levels.map((level) => ({
          level,
          total: counts[level],
          learned: Math.min(progressByLevel[level] || 0, counts[level]),
        }))
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

      const { data: allWords } = await supabase
        .from('dictionary_words')
        .select('id')
        .eq('level', level)
        .order('order_index', { ascending: true })

      const allIds = (allWords || []).map((w) => w.id)
      if (allIds.length === 0) { setLoading(false); return }

      let { data: progress } = await supabase
        .from('dictionary_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('level', level)
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
            { user_id: user.id, level, word_order: wordOrder, current_index: 0 },
            { onConflict: 'user_id,level' }
          )
          .select('*')
          .single()
        progress = upserted
      }

      if (!progress) { setLoading(false); return }

      await loadStage(level, progress.word_order, progress.current_index, allIds.length, size)
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
        .single()

      if (!progress) return

      const newIndex = Math.min(progress.current_index + stageWords.length, progress.word_order.length)
      await supabase
        .from('dictionary_progress')
        .update({ current_index: newIndex, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('level', activeLevel)

      const fullyComplete = newIndex >= progress.word_order.length
      setLevelFullyComplete(fullyComplete)

      setLevelInfos((prev) =>
        prev.map((l) => (l.level === activeLevel ? { ...l, learned: newIndex } : l))
      )
    } catch (err) {
      console.error('Lỗi khi lưu tiến độ:', err)
    }
  }

  const handleFlashNext = () => {
    setIsFlipped(false)
    if (flashIdx < stageWords.length - 1) {
      setFlashIdx(flashIdx + 1)
    } else {
      persistProgressAdvance()
      setMatchingRound(0)
      setMatchingType('hanzi_pinyin')
      prepareMatchingRound(0)
      setStep('matching')
    }
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
      const { data: progress } = await supabase
        .from('dictionary_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('level', activeLevel)
        .single()
      if (!progress) return
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

      const { data: allWords } = await supabase
        .from('dictionary_words')
        .select('id')
        .eq('level', activeLevel)

      const allIds = (allWords || []).map((w) => w.id)
      const wordOrder = shuffleArray(allIds)

      await supabase
        .from('dictionary_progress')
        .update({ word_order: wordOrder, current_index: 0, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('level', activeLevel)

      setLevelInfos((prev) => prev.map((l) => (l.level === activeLevel ? { ...l, learned: 0 } : l)))
      setStep('select')
      setActiveLevel(null)
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

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
        <span>📔</span> Ôn Tập Theo Từ Điển
      </h2>

      {step === 'select' ? (
        <div className="space-y-6">
          {!pendingLevel ? (
            <>
              <div className="bg-gradient-to-r from-blue-400 to-sky-500 text-white p-6 rounded-[24px] shadow-sm space-y-2">
                <h3 className="text-xl font-extrabold flex items-center gap-2">
                  <Sparkles className="w-6 h-6 animate-pulse" /> Chọn Cấp Độ Để Ôn Tập
                </h3>
                <p className="font-semibold text-sm text-white/90">
                  Mỗi cấp độ được chia thành nhiều đợt (bạn chọn số từ mỗi đợt). Học hết đợt này sẽ chuyển sang
                  đợt tiếp theo, không lặp lại từ đã học cho đến khi hoàn thành toàn bộ cấp độ.
                </p>
              </div>

              <div className="cartoon-card p-6 bg-white space-y-3">
                {loading ? (
                  <div className="p-8 text-center">
                    <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="text-xs text-slate-400 font-bold">Đang tải dữ liệu từ điển...</p>
                  </div>
                ) : levelInfos.length === 0 ? (
                  <p className="text-slate-400 font-semibold text-center py-6">
                    Chưa có dữ liệu từ điển. Vui lòng import từ điển trước.
                  </p>
                ) : (
                  levelInfos.map((info) => {
                    const isDone = info.learned >= info.total
                    return (
                      <button
                        key={info.level}
                        onClick={() => { setPendingLevel(info.level); setStageSizeChoice(DEFAULT_STAGE_SIZE); setCustomStageSize('') }}
                        className="w-full flex items-center justify-between p-4 rounded-2xl border-2 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left"
                      >
                        <div>
                          <span className="font-black text-slate-800 text-lg">{info.level}</span>
                          <p className="text-xs font-bold text-slate-400">
                            {info.learned}/{info.total} từ đã học {isDone && '🎉'}
                          </p>
                        </div>
                        <div className="w-24 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-400 rounded-full transition-all"
                            style={{ width: `${info.total ? (info.learned / info.total) * 100 : 0}%` }}
                          />
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            <div className="cartoon-card p-6 bg-white space-y-4">
              <button
                onClick={() => setPendingLevel(null)}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Quay lại chọn cấp độ
              </button>

              <h4 className="font-black text-slate-800 text-lg">{pendingLevel} — Số từ mỗi đợt ôn</h4>
              <p className="text-xs text-slate-500 font-semibold">
                Học xong flashcard của một đợt xong sẽ chuyển sang bài tập nối từ, rồi mới đến đợt tiếp theo.
              </p>

              <div className="flex flex-wrap gap-2">
                {STAGE_SIZE_PRESETS.map((n) => (
                  <button
                    key={n}
                    onClick={() => { setStageSizeChoice(n); setCustomStageSize('') }}
                    className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${
                      !customStageSize && stageSizeChoice === n
                        ? 'bg-[#1877f2] text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {n} từ
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Hoặc nhập số tùy chỉnh:</label>
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={customStageSize}
                  onChange={(e) => setCustomStageSize(e.target.value)}
                  placeholder="VD: 25"
                  className="w-32 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold text-sm"
                />
              </div>

              <button
                onClick={() => {
                  const size = customStageSize
                    ? Math.max(5, Math.min(200, parseInt(customStageSize, 10) || DEFAULT_STAGE_SIZE))
                    : stageSizeChoice
                  const level = pendingLevel
                  setPendingLevel(null)
                  startLevel(level, size)
                }}
                className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
              >
                Bắt Đầu Ôn Tập <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      ) : step === 'flashcard' ? (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <span className="font-extrabold text-sm text-slate-500 uppercase">
              {activeLevel} · Đợt {stageNumber}/{totalStages} · Học Flashcards
            </span>
            <button onClick={() => setStep('select')} className="font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-black text-slate-500">
              <span>TIẾN ĐỘ: {flashIdx} / {stageWords.length} TỪ</span>
              <span>{Math.round((flashIdx / stageWords.length) * 100)}%</span>
            </div>
            <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all duration-300"
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
              {flashIdx === stageWords.length - 1 ? 'Chuyển Sang Bài Tập' : 'Tiếp theo'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : step === 'matching' ? (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <span className="font-black text-slate-800 block text-sm">{getMatchingTitle()}</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase">
                {activeLevel} · Đợt {stageNumber}/{totalStages} · Vòng {matchingRound + 1}/{Math.ceil(stageWords.length / ITEMS_PER_ROUND)}
              </span>
            </div>
            <button onClick={() => setStep('select')} className="font-extrabold text-xs text-red-500 hover:underline">
              Thoát
            </button>
          </div>

          <MatchingExercise vocabs={roundVocabs} matchType={matchingType} onComplete={handleRoundComplete} />
        </div>
      ) : (
        <div className="cartoon-card bg-white p-8 text-center space-y-6 animate-float max-w-md mx-auto">
          <div className="w-20 h-20 bg-emerald-100 rounded-full shadow-md flex items-center justify-center text-emerald-500 mx-auto">
            {levelFullyComplete ? <Trophy className="w-12 h-12" /> : <CheckCircle className="w-12 h-12" />}
          </div>

          <div className="space-y-2">
            <h3 className="text-3xl font-black text-slate-800">
              {levelFullyComplete ? 'Hoàn Thành Toàn Bộ Cấp Độ! 🎉' : `Xong Đợt ${stageNumber}! 🎉`}
            </h3>
            <p className="text-slate-500 font-bold">
              {levelFullyComplete
                ? `Chúc mừng! Bạn đã học hết toàn bộ từ vựng cấp độ ${activeLevel}.`
                : `Còn ${totalStages - stageNumber} đợt nữa để hoàn thành cấp độ ${activeLevel}.`}
            </p>
          </div>

          {levelFullyComplete ? (
            <div className="flex flex-col gap-2">
              <button onClick={restartLevel} className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2">
                <RotateCcw className="w-4 h-4" /> Học Lại Từ Đầu
              </button>
              <button
                onClick={() => { setStep('select'); loadLevelInfos() }}
                className="cartoon-btn-secondary w-full py-3 text-sm"
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
                className="cartoon-btn-secondary w-full py-3 text-sm"
              >
                Quay Lại Chọn Cấp Độ
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
