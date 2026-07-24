'use client'

import React, { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getDaysInMonth, getTodayString, toLocalDateString, formatDate } from '@/lib/utils/date'
import { shuffleArray } from '@/lib/utils/shuffle'
import Flashcard from '@/components/learn/Flashcard'
import MatchingExercise from '@/components/exercises/MatchingExercise'
import FillInExercise from '@/components/exercises/FillInExercise'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Check,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Dumbbell,
  Keyboard,
  Sparkles,
  CheckCircle
} from 'lucide-react'
import confetti from 'canvas-confetti'

interface VocabItem {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
  example_hanzi?: string | null
  example_pinyin?: string | null
  example_vietnamese?: string | null
}

export default function ReviewPage() {
  const supabase = createClient()
  
  // Available dates that contain vocab
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [vocabCountMap, setVocabCountMap] = useState<Record<string, number>>({})

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const monthNames = [
    'Tháng Một', 'Tháng Hai', 'Tháng Ba', 'Tháng Tư', 'Tháng Năm', 'Tháng Sáu',
    'Tháng Bảy', 'Tháng Tám', 'Tháng Chín', 'Tháng Mười', 'Tháng Mười Một', 'Tháng Mười Hai'
  ]

  // Combined vocab for study
  const [mergedVocabs, setMergedVocabs] = useState<VocabItem[]>([])
  
  // Study states: 'select' | 'flashcard' | 'matching' | 'complete'
  const [step, setStep] = useState<'select' | 'flashcard' | 'matching' | 'fill_in' | 'complete'>('select')
  
  // Active Flashcard index and states
  const [flashIdx, setFlashIdx] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)

  // Matching exercise batching
  const [matchingRound, setMatchingRound] = useState(0)
  const [matchingType, setMatchingType] = useState<'hanzi_pinyin' | 'hanzi_viet'>('hanzi_pinyin')
  const [roundVocabs, setRoundVocabs] = useState<VocabItem[]>([])
  const ITEMS_PER_ROUND = 15

  // Fetch all dates with vocabulary sets
  useEffect(() => {
    async function loadDates() {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: sets } = await supabase
          .from('vocabulary_sets')
          .select('date')
          .eq('user_id', user.id)
          .order('date', { ascending: false })

        if (sets) {
          setAvailableDates(sets.map(s => s.date))
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadDates()
  }, [supabase])

  useEffect(() => {
    async function loadMonthData() {
      setCalendarLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`
        const lastDay = new Date(year, month + 1, 0).getDate()
        const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`

        const { data: sets, error: setsErr } = await supabase
          .from('vocabulary_sets')
          .select('id, date')
          .eq('user_id', user.id)
          .gte('date', startOfMonth)
          .lte('date', endOfMonth)

        if (setsErr) throw setsErr

        const setIdToDate: Record<string, string> = {}
        for (const s of sets || []) setIdToDate[s.id] = s.date
        const setIds = Object.keys(setIdToDate)

        const vocabCountByDate: Record<string, number> = {}
        if (setIds.length > 0) {
          const { data: vocabRows, error: vocabErr } = await supabase
            .from('vocabularies')
            .select('set_id')
            .in('set_id', setIds)

          if (vocabErr) throw vocabErr

          for (const v of vocabRows || []) {
            const d = setIdToDate[v.set_id]
            if (d) vocabCountByDate[d] = (vocabCountByDate[d] || 0) + 1
          }
        }

        setVocabCountMap(vocabCountByDate)
      } catch (err) {
        console.error(err)
      } finally {
        setCalendarLoading(false)
      }
    }

    loadMonthData()
  }, [currentDate, supabase])

  const toggleDateSelection = (d: string) => {
    if (!availableDates.includes(d)) return
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })
  }

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const selectLast7Days = () => {
    const today = new Date()
    const last7: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setDate(today.getDate() - i)
      const dateStr = toLocalDateString(d)
      if (availableDates.includes(dateStr)) {
        last7.push(dateStr)
      }
    }
    setSelectedDates(new Set(last7))
  }

  const selectCurrentMonth = () => {
    const today = new Date()
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const matching = availableDates.filter(d => d.startsWith(currentMonthStr))
    setSelectedDates(new Set(matching))
  }

  const startReview = async () => {
    if (selectedDates.size === 0) return
    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 1. Get sets
      const dateList = Array.from(selectedDates)
      const { data: sets } = await supabase
        .from('vocabulary_sets')
        .select('id')
        .eq('user_id', user.id)
        .in('date', dateList)

      if (!sets || sets.length === 0) {
        setMergedVocabs([])
        setLoading(false)
        return
      }

      // 2. Fetch all vocabularies
      const setIds = sets.map(s => s.id)
      const { data: list } = await supabase
        .from('vocabularies')
        .select('id, hanzi, pinyin, vietnamese, example_hanzi, example_pinyin, example_vietnamese')
        .in('set_id', setIds)

      if (list && list.length > 0) {
        setMergedVocabs(shuffleArray(list))
        setFlashIdx(0)
        setIsFlipped(false)
        setStep('flashcard')
      } else {
        setMergedVocabs([])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Flashcard Controls
  const handleFlashNext = () => {
    setIsFlipped(false)
    if (flashIdx < mergedVocabs.length - 1) {
      setFlashIdx(flashIdx + 1)
    } else {
      // Transition to matching
      setMatchingRound(0)
      setMatchingType('hanzi_pinyin')
      prepareMatchingRound(0)
      setStep('matching')
    }
  }

  const handleFlashPrev = () => {
    setIsFlipped(false)
    if (flashIdx > 0) {
      setFlashIdx(flashIdx - 1)
    }
  }

  // Matching Rounds Control
  const prepareMatchingRound = (roundIndex: number) => {
    const startIndex = roundIndex * ITEMS_PER_ROUND
    const endIndex = Math.min(startIndex + ITEMS_PER_ROUND, mergedVocabs.length)
    const items = mergedVocabs.slice(startIndex, endIndex)
    setRoundVocabs(items)
  }

  const handleRoundComplete = () => {
    const totalRounds = Math.ceil(mergedVocabs.length / ITEMS_PER_ROUND)
    
    // Play confetti on round end
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 }
    })

    if (matchingRound < totalRounds - 1) {
      // Next round in the current type
      const nextRound = matchingRound + 1
      setMatchingRound(nextRound)
      prepareMatchingRound(nextRound)
    } else {
      if (matchingType === 'hanzi_pinyin') {
        setMatchingType('hanzi_viet')
        setMatchingRound(0)
        prepareMatchingRound(0)
      } else {
        setStep('fill_in')
      }
    }
  }

  const handleFillInComplete = () => {
    setStep('complete')
    triggerGrandConfetti()
    saveReviewRecord()
  }

  const saveReviewRecord = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Save summary record for today
      const todayStr = getTodayString()
      await supabase
        .from('exercise_records')
        .upsert({
          user_id: user.id,
          date: todayStr,
          exercise_type: 'review_cumulative',
          is_completed: true,
          score: 100,
          completed_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date,exercise_type'
        })
    } catch (err) {
      console.error(err)
    }
  }

  const triggerGrandConfetti = () => {
    const duration = 3 * 1000
    const end = Date.now() + duration

    const frame = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 }
      })
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 }
      })

      if (Date.now() < end) {
        requestAnimationFrame(frame)
      }
    }
    frame()
  }

  const getReviewTitle = () => {
    if (matchingType === 'hanzi_pinyin') return 'Vòng 1: Chữ Hán ↔ Phiên âm'
    return 'Vòng 2: Chữ Hán ↔ Nghĩa Việt'
  }

  const days = getDaysInMonth(year, month)
  const startDayOfWeek = days[0].getDay()
  const adjustedStart = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1
  const gridCells: (Date | null)[] = []
  for (let i = 0; i < adjustedStart; i++) gridCells.push(null)
  days.forEach(day => gridCells.push(day))
  const weekdayHeaders = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

  return (
    <div className="space-y-6">
      {/* Title */}
      <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
        <span>🔥</span> Ôn Tập Tổng Hợp
      </h2>

      {step === 'select' ? (
        /* DATE SELECTION SCREEN */
        <div className="space-y-6 max-w-4xl mx-auto px-4">
          <div className="bg-gradient-to-r from-blue-400 to-sky-500 text-white p-6 rounded-[24px] shadow-sm space-y-4">
            <h3 className="text-xl font-extrabold flex items-center gap-2">
              <Sparkles className="w-6 h-6 animate-pulse" /> Ôn Tập Đa Ngày
            </h3>
            <p className="font-semibold text-sm text-white/90">
              Lựa chọn nhiều ngày, cả tuần hoặc cả tháng để gộp toàn bộ từ vựng lại học cùng một lúc. Hệ thống sẽ tự động xáo trộn và dẫn dắt bạn qua Flashcards và các Bài tập nối từ.
            </p>
            
            <div className="flex gap-2">
              <button 
                onClick={selectLast7Days}
                disabled={availableDates.length === 0}
                className="cartoon-btn-secondary px-3 py-2 text-xs font-black rounded-xl"
              >
                7 Ngày Gần Nhất
              </button>
              <button 
                onClick={selectCurrentMonth}
                disabled={availableDates.length === 0}
                className="cartoon-btn-secondary px-3 py-2 text-xs font-black rounded-xl"
              >
                Tháng Hiện Tại
              </button>
            </div>
          </div>

          <div className="cartoon-card p-6 bg-white space-y-4">
            <h4 className="font-extrabold text-slate-800">Chọn các ngày để ôn tập:</h4>
            
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-black text-slate-600">
                <CalendarIcon className="w-4 h-4 text-blue-500" />
                Chọn ngày trong tháng
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>Đã chọn</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-200"></span>Có từ</span>
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center">
                <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                <p className="text-xs text-slate-400 font-bold">Đang tải lịch sử từ vựng...</p>
              </div>
            ) : availableDates.length === 0 ? (
              <p className="text-slate-400 font-semibold text-center py-6">
                Chưa có ngày nào có từ vựng. Vui lòng thêm từ vựng trước nhé!
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="cartoon-btn cartoon-btn-secondary p-2.5 flex items-center justify-center"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <h5 className="text-lg font-black text-slate-800 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-blue-500" />
                    {monthNames[month]} {year}
                  </h5>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="cartoon-btn cartoon-btn-secondary p-2.5 flex items-center justify-center"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {calendarLoading ? (
                  <div className="p-6 text-center">
                    <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="text-xs text-slate-400 font-bold">Đang tải lịch cho tháng này...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-black text-slate-400">
                      {weekdayHeaders.map(h => <div key={h}>{h}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {gridCells.map((day, idx) => {
                        if (!day) {
                          return <div key={`empty-${idx}`} className="aspect-square rounded-xl bg-slate-50/70" />
                        }

                        const dateStr = toLocalDateString(day)
                        const vocabCount = vocabCountMap[dateStr] || 0
                        const hasVocab = vocabCount > 0
                        const isSelected = selectedDates.has(dateStr)

                        let cellClass = 'border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50'
                        if (isSelected) {
                          cellClass = 'border border-blue-600 bg-blue-500 text-white shadow-md'
                        } else if (hasVocab) {
                          cellClass = 'border border-amber-200 bg-amber-50 text-slate-700 hover:bg-amber-100'
                        } else {
                          cellClass = 'border border-slate-100 bg-slate-100/70 text-slate-400 cursor-not-allowed'
                        }

                        return (
                          <button
                            key={dateStr}
                            type="button"
                            disabled={!hasVocab}
                            onClick={() => toggleDateSelection(dateStr)}
                            className={`aspect-square rounded-xl p-1.5 transition-all font-black text-sm relative ${cellClass}`}
                            title={hasVocab ? `${vocabCount} từ vựng` : 'Không có từ vựng'}
                          >
                            <span className="absolute left-1.5 top-1.5">{day.getDate()}</span>
                            {hasVocab && (
                              <span className={`absolute md:right-1.5 md:top-1.5 right-0 top-0 min-w-[12px] h-[12px] px-1 rounded-full text-[8px] font-black flex items-center justify-center ${isSelected ? 'bg-white/20 text-white' : 'bg-white text-amber-700 border border-amber-100'}`}>
                                {vocabCount}
                              </span>
                            )}
                            {isSelected && <Check className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={startReview}
              disabled={selectedDates.size === 0 || loading}
              className="cartoon-btn w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              Bắt Đầu Ôn Tập ({selectedDates.size} ngày) <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : step === 'flashcard' ? (
        /* FLASHCARD MERGED STUDY */
        <div className="space-y-6 max-w-9xl mx-auto px-4">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 shrink-0">
                <BookOpen className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-sm text-slate-500 uppercase">
                Phần 1: Học Thẻ Flashcards
              </span>
            </div>
            <button
              onClick={() => setStep('select')}
              className="font-extrabold text-xs text-red-500 hover:underline"
            >
              Thoát ôn tập
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-black text-slate-500">
              <span>TIẾN ĐỘ: {flashIdx} / {mergedVocabs.length} TỪ</span>
              <span>{Math.round((flashIdx / mergedVocabs.length) * 100)}%</span>
            </div>
            <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full transition-all duration-300"
                style={{ width: `${(flashIdx / mergedVocabs.length) * 100}%` }}
              ></div>
            </div>
          </div>

          <Flashcard
            hanzi={mergedVocabs[flashIdx].hanzi}
            pinyin={mergedVocabs[flashIdx].pinyin}
            vietnamese={mergedVocabs[flashIdx].vietnamese}
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped(!isFlipped)}
            example={
              mergedVocabs[flashIdx].example_hanzi
                ? {
                    sentence: mergedVocabs[flashIdx].example_hanzi!,
                    pinyin: mergedVocabs[flashIdx].example_pinyin || '',
                    translation: mergedVocabs[flashIdx].example_vietnamese || '',
                  }
                : undefined
            }
          />

          <div className="flex justify-between items-center gap-4 max-w-md mx-auto">
            <button 
              onClick={handleFlashPrev}
              disabled={flashIdx === 0}
              className="cartoon-btn cartoon-btn-secondary px-4 py-3 text-sm flex items-center gap-2 disabled:opacity-30 disabled:pointer-events-none"
            >
              <ArrowLeft className="w-4 h-4" /> Trước đó
            </button>

            <button 
              onClick={() => setIsFlipped(!isFlipped)}
              className="cartoon-btn cartoon-btn-secondary px-5 py-3 text-sm"
            >
              Lật Thẻ 🔄
            </button>

            <button 
              onClick={handleFlashNext}
              className="cartoon-btn px-5 py-3 text-sm flex items-center gap-2"
            >
              {flashIdx === mergedVocabs.length - 1 ? 'Chuyển Sang Bài Tập' : 'Tiếp theo'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : step === 'matching' ? (
        /* MATCHING GAME (BATCHED BY ITEMS_PER_ROUND) */
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500 shrink-0">
                <Dumbbell className="w-4 h-4" />
              </div>
              <div>
                <span className="font-black text-slate-800 block text-sm">{getReviewTitle()}</span>
                <span className="text-[10px] text-slate-500 font-bold uppercase">
                  Vòng {matchingRound + 1} / {Math.ceil(mergedVocabs.length / ITEMS_PER_ROUND)}
                </span>
              </div>
            </div>
            <button
              onClick={() => setStep('select')}
              className="font-extrabold text-xs text-red-500 hover:underline"
            >
              Thoát ôn tập
            </button>
          </div>

          <MatchingExercise
            vocabs={roundVocabs}
            matchType={matchingType}
            onComplete={handleRoundComplete}
          />
        </div>
      ) : step === 'fill_in' ? (
        /* FILL-IN (ĐIỀN TỪ) — final step, covers all merged vocabs at once */
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center text-purple-500 shrink-0">
                <Keyboard className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-sm text-slate-500 uppercase">
                Phần 3: Điền Từ ({mergedVocabs.length} từ)
              </span>
            </div>
            <button
              onClick={() => setStep('select')}
              className="font-extrabold text-xs text-red-500 hover:underline"
            >
              Thoát ôn tập
            </button>
          </div>

          <FillInExercise words={mergedVocabs} onComplete={handleFillInComplete} />
        </div>
      ) : (
        /* COMPLETE SCREEN */
        <div className="cartoon-card bg-white p-8 text-center space-y-6 animate-float max-w-md mx-auto">
          <div className="w-20 h-20 bg-emerald-100 rounded-full shadow-md flex items-center justify-center text-emerald-500 mx-auto">
            <CheckCircle className="w-12 h-12" />
          </div>
          
          <div className="space-y-2">
            <h3 className="text-3xl font-black text-slate-800">Hoàn Thành! 🎉</h3>
            <p className="text-slate-500 font-bold">
              Chúc mừng! Bạn đã ôn tập xuất sắc qua {mergedVocabs.length} từ vựng từ {selectedDates.size} ngày học vừa qua!
            </p>
          </div>

          <button 
            onClick={() => setStep('select')}
            className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
          >
            Quay Lại Chọn Ngày
          </button>
        </div>
      )}
    </div>
  )
}
