'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getTodayString, formatDate } from '@/lib/utils/date'
import { shuffleArray } from '@/lib/utils/shuffle'
import Flashcard from '@/components/learn/Flashcard'
import FillInExercise from '@/components/exercises/FillInExercise'
import DatePicker from '@/components/ui/DatePicker'
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  CheckCircle,
  BookOpen,
  Keyboard
} from 'lucide-react'

interface VocabItem {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
  example_hanzi?: string | null
  example_pinyin?: string | null
  example_vietnamese?: string | null
}

type VocabularySource = 'study' | 'practice'
type LearnMode = 'flashcard' | 'fill_in'

export default function LearnPage() {
  const supabase = createClient()

  const [date, setDate] = useState(getTodayString())
  const [loading, setLoading] = useState(false)
  const [vocabs, setVocabs] = useState<VocabItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [savingRecord, setSavingRecord] = useState(false)
  const [selectedSource, setSelectedSource] = useState<VocabularySource | null>(null)
  const [learnMode, setLearnMode] = useState<LearnMode | null>(null)
  const [vocabCountMap, setVocabCountMap] = useState<{ [dateStr: string]: number }>({})

  // Load vocabularies for selected date and source category
  const loadVocabSet = async (targetDate: string, source: VocabularySource) => {
    setLoading(true)
    setIsCompleted(false)
    setCurrentIdx(0)
    setIsFlipped(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: set } = await supabase
        .from('vocabulary_sets')
        .select('id')
        .eq('user_id', user.id)
        .eq('date', targetDate)
        .single()

      if (!set) {
        setVocabs([])
        return
      }

      const { data: list } = await supabase
        .from('vocabularies')
        .select('id, hanzi, pinyin, vietnamese, example_hanzi, example_pinyin, example_vietnamese')
        .eq('set_id', set.id)
        .eq('source', source)

      if (list) {
        setVocabs(shuffleArray(list))
      } else {
        setVocabs([])
      }
    } catch (err) {
      console.error(err)
      setVocabs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setSelectedSource(null)
    setLearnMode(null)
    setVocabs([])
    setIsCompleted(false)
    setCurrentIdx(0)
    setIsFlipped(false)
  }, [date])

  // Vocab count per day for whichever month the DatePicker currently has open, so the
  // calendar shows the same at-a-glance word counts as /exercises's calendar.
  const loadMonthVocabCounts = async (year: number, month: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const lastDay = new Date(year, month + 1, 0).getDate()
      const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`

      const { data: sets } = await supabase
        .from('vocabulary_sets')
        .select('id, date')
        .eq('user_id', user.id)
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)

      const setIdToDate: Record<string, string> = {}
      for (const s of sets || []) setIdToDate[s.id] = s.date
      const setIds = Object.keys(setIdToDate)

      const counts: Record<string, number> = {}
      if (setIds.length > 0) {
        const { data: vocabRows } = await supabase
          .from('vocabularies')
          .select('set_id')
          .in('set_id', setIds)

        for (const v of vocabRows || []) {
          const d = setIdToDate[v.set_id]
          if (d) counts[d] = (counts[d] || 0) + 1
        }
      }
      setVocabCountMap(counts)
    } catch (err) {
      console.error('Error fetching calendar vocab counts:', err)
    }
  }

  useEffect(() => {
    if (!selectedSource || !learnMode) return
    loadVocabSet(date, selectedSource)
  }, [date, selectedSource, learnMode])

  const handleNext = () => {
    setIsFlipped(false)
    if (currentIdx < vocabs.length - 1) {
      setCurrentIdx(currentIdx + 1)
    } else {
      // Completed all cards
      setIsCompleted(true)
      saveProgress('flashcard')
    }
  }

  const handlePrev = () => {
    setIsFlipped(false)
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1)
    }
  }

  const handleRestart = () => {
    setIsCompleted(false)
    setCurrentIdx(0)
    setIsFlipped(false)
    setVocabs(shuffleArray(vocabs))
  }

  const handleSelectSource = (source: VocabularySource) => {
    setSelectedSource(source)
  }

  const handleSelectMode = (mode: LearnMode) => {
    setLearnMode(mode)
  }

  const resetToCategoryPicker = () => {
    setSelectedSource(null)
    setLearnMode(null)
  }

  // exercise_records' unique key is (user_id, date, exercise_type) — /exercises/[date]
  // already owns the 'fill_in' exercise_type for its own Điền Từ card, so this page's
  // Điền Từ mode is recorded under a distinct 'learn_fill_in' type. Sharing 'fill_in'
  // would make completing one accidentally mark the other page's exercise done too.
  const EXERCISE_TYPE: Record<LearnMode, string> = { flashcard: 'flashcard', fill_in: 'learn_fill_in' }

  const saveProgress = async (mode: LearnMode) => {
    setSavingRecord(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase
        .from('exercise_records')
        .upsert({
          user_id: user.id,
          date,
          exercise_type: EXERCISE_TYPE[mode],
          is_completed: true,
          completed_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date,exercise_type'
        })
    } catch (err) {
      console.error('Error saving learn record:', err)
    } finally {
      setSavingRecord(false)
    }
  }

  const handleFillInComplete = () => {
    setIsCompleted(true)
    saveProgress('fill_in')
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
            <span>📖</span> Học Từ Mới
          </h2>
          {selectedSource && (
            <p className="text-xs font-bold text-[#1877f2] flex items-center gap-2">
              Danh mục: {selectedSource === 'study' ? 'Từ vựng tự học' : 'Từ vựng khác'}
              <button
                onClick={resetToCategoryPicker}
                className="text-[10px] text-slate-400 hover:text-red-500 underline ml-1 font-bold"
              >
                (Đổi danh mục)
              </button>
            </p>
          )}
        </div>

        {/* Date Selector */}
        <div className="cartoon-panel px-1 py-0.5 bg-white text-sm relative z-30">
          <DatePicker
            value={date}
            onChange={setDate}
            vocabCountMap={vocabCountMap}
            onMonthChange={loadMonthVocabCounts}
          />
        </div>
      </div>

      {/* Main Flashcard Container */}
      {!selectedSource ? (
        <div className="cartoon-card bg-white p-8 text-center space-y-4">
          <h3 className="text-xl font-extrabold text-slate-700">Chọn danh mục từ vựng để học</h3>
          <p className="text-slate-500 font-semibold max-w-md mx-auto">
            Chọn đúng tab từ vựng mà bạn đã tạo cho ngày {formatDate(date)} để tải flashcard phù hợp.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => handleSelectSource('study')}
              className="cartoon-btn px-5 py-3 text-sm"
            >
              Từ vựng tự học
            </button>
            <button
              onClick={() => handleSelectSource('practice')}
              className="cartoon-btn cartoon-btn-secondary px-5 py-3 text-sm"
            >
              Từ vựng khác
            </button>
          </div>
        </div>
      ) : !learnMode ? (
        <div className="cartoon-card bg-white p-8 text-center space-y-4">
          <h3 className="text-xl font-extrabold text-slate-700">Chọn chế độ học</h3>
          <p className="text-slate-500 font-semibold max-w-md mx-auto">
            Học từ mới bằng Flashcard, hoặc luyện Điền Từ nếu bạn đã quen mặt chữ rồi.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto">
            <button
              onClick={() => handleSelectMode('flashcard')}
              className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5"
            >
              <BookOpen className="w-8 h-8 mx-auto text-blue-500" />
              <p className="font-black text-slate-700 text-sm">Flashcard</p>
              <p className="text-[11px] text-slate-400 font-semibold leading-snug">Lật thẻ học nghĩa</p>
            </button>
            <button
              onClick={() => handleSelectMode('fill_in')}
              className="cartoon-card cursor-pointer p-4 bg-white text-center space-y-1.5"
            >
              <Keyboard className="w-8 h-8 mx-auto text-purple-500" />
              <p className="font-black text-slate-700 text-sm">Điền Từ</p>
              <p className="text-[11px] text-slate-400 font-semibold leading-snug">Gõ pinyin để ghép đúng chữ Hán</p>
            </button>
          </div>
          <button
            onClick={resetToCategoryPicker}
            className="text-xs font-bold text-slate-400 hover:text-slate-600 underline"
          >
            Đổi danh mục
          </button>
        </div>
      ) : loading ? (
        <div className="cartoon-card bg-white p-12 text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="font-bold text-slate-500">Đang chuẩn bị thẻ học...</p>
        </div>
      ) : vocabs.length === 0 ? (
        <div className="cartoon-card bg-white p-12 text-center space-y-4">
          <span className="text-6xl animate-float inline-block">🐼</span>
          <h3 className="text-xl font-extrabold text-slate-700">Không tìm thấy từ vựng học hôm nay!</h3>
          <p className="text-slate-500 font-semibold max-w-sm mx-auto">
            Chưa có từ vựng {selectedSource === 'study' ? 'tự học' : 'khác'} nào cho ngày này. Hãy thêm một số từ vựng vào tab phù hợp trước khi bắt đầu học nhé.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/vocabulary" className="cartoon-btn px-6 py-2.5 inline-block text-sm">
              Quản lý từ vựng
            </Link>
            <button
              onClick={resetToCategoryPicker}
              className="cartoon-btn cartoon-btn-secondary px-6 py-2.5 inline-block text-sm"
            >
              Chọn danh mục khác
            </button>
          </div>
        </div>
      ) : isCompleted ? (
        /* Completed Screen */
        <div className="cartoon-card bg-white p-8 text-center space-y-6 animate-float">
          <div className="w-20 h-20 bg-emerald-100 rounded-full border-4 border-slate-800 shadow-[3px_3px_0px_0px_#1e293b] flex items-center justify-center text-emerald-500 mx-auto">
            <CheckCircle className="w-12 h-12" />
          </div>

          <div className="space-y-2">
            <h3 className="text-3xl font-black text-slate-800">Tuyệt Vời! 🎉</h3>
            <p className="text-slate-500 font-bold">Bạn đã học xong toàn bộ {vocabs.length} từ vựng của ngày {formatDate(date)}</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleRestart}
              className="cartoon-btn cartoon-btn-secondary px-5 py-3 text-sm flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Học Lại Từ Đầu
            </button>
            <button
              onClick={resetToCategoryPicker}
              className="cartoon-btn cartoon-btn-secondary px-5 py-3 text-sm flex items-center justify-center gap-2"
            >
              Đổi danh mục
            </button>
            <Link
              href={`/exercises/${date}`}
              className="cartoon-btn cartoon-btn-accent px-5 py-3 text-sm flex items-center justify-center gap-2"
            >
              Làm Bài Tập Ngay <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      ) : learnMode === 'fill_in' ? (
        /* Điền Từ Study Screen */
        <FillInExercise
          words={vocabs}
          onComplete={handleFillInComplete}
        />
      ) : (
        /* Flashcard Study Screen */
        <div className="space-y-6">
          {/* Progress Indicator */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-black text-slate-500">
              <span>ĐÃ HỌC: {currentIdx} / {vocabs.length} TỪ</span>
              <span>{Math.round((currentIdx / vocabs.length) * 100)}%</span>
            </div>
            <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-green-500 rounded-full transition-all duration-500"
                style={{ width: `${(currentIdx / vocabs.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Flashcard Render */}
          <Flashcard
            hanzi={vocabs[currentIdx].hanzi}
            pinyin={vocabs[currentIdx].pinyin}
            vietnamese={vocabs[currentIdx].vietnamese}
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped(!isFlipped)}
            example={
              vocabs[currentIdx].example_hanzi
                ? {
                    sentence: vocabs[currentIdx].example_hanzi!,
                    pinyin: vocabs[currentIdx].example_pinyin || '',
                    translation: vocabs[currentIdx].example_vietnamese || '',
                  }
                : undefined
            }
          />

          {/* Navigation Controls */}
          <div className="flex justify-between items-center gap-4 max-w-lg mx-auto pt-2">
            <button
              onClick={handlePrev}
              disabled={currentIdx === 0}
              className="cartoon-btn cartoon-btn-secondary px-4 py-3 text-sm flex items-center gap-2 disabled:opacity-30 disabled:pointer-events-none"
            >
              <ArrowLeft className="w-4 h-4" /> Trước đó
            </button>

            <button
              onClick={() => setIsFlipped(!isFlipped)}
              className="cartoon-btn cartoon-btn-secondary px-5 py-3 text-sm font-bold"
            >
              Lật thẻ
            </button>

            <button
              onClick={handleNext}
              className="cartoon-btn px-5 py-3 text-sm flex items-center gap-2"
            >
              {currentIdx === vocabs.length - 1 ? 'Hoàn Thành' : 'Tiếp theo'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
