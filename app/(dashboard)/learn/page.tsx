'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getTodayString, formatDate } from '@/lib/utils/date'
import { shuffleArray } from '@/lib/utils/shuffle'
import Flashcard from '@/components/learn/Flashcard'
import DatePicker from '@/components/ui/DatePicker'
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  CheckCircle,
  HelpCircle,
  Play
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

export default function LearnPage() {
  const supabase = createClient()

  const [date, setDate] = useState(getTodayString())
  const [loading, setLoading] = useState(false)
  const [vocabs, setVocabs] = useState<VocabItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [savingRecord, setSavingRecord] = useState(false)

  // Load vocabularies for selected date
  const loadVocabSet = async (targetDate: string) => {
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
    loadVocabSet(date)
  }, [date])

  const handleNext = () => {
    setIsFlipped(false)
    if (currentIdx < vocabs.length - 1) {
      setCurrentIdx(currentIdx + 1)
    } else {
      // Completed all cards
      setIsCompleted(true)
      saveProgress()
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

  const saveProgress = async () => {
    setSavingRecord(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Save or update exercise_records
      await supabase
        .from('exercise_records')
        .upsert({
          user_id: user.id,
          date,
          exercise_type: 'flashcard',
          is_completed: true,
          completed_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date,exercise_type'
        })
    } catch (err) {
      console.error('Error saving flashcard record:', err)
    } finally {
      setSavingRecord(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
          <span>📖</span> Học Từ Mới
        </h2>

        {/* Date Selector */}
        <div className="cartoon-panel px-1 py-0.5 bg-white text-sm relative z-30">
          <DatePicker value={date} onChange={setDate} />
        </div>
      </div>

      {/* Main Flashcard Container */}
      {loading ? (
        <div className="cartoon-card bg-white p-12 text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="font-bold text-slate-500">Đang chuẩn bị thẻ học...</p>
        </div>
      ) : vocabs.length === 0 ? (
        <div className="cartoon-card bg-white p-12 text-center space-y-4">
          <span className="text-6xl animate-float inline-block">🐼</span>
          <h3 className="text-xl font-extrabold text-slate-700">Không tìm thấy từ vựng học hôm nay!</h3>
          <p className="text-slate-500 font-semibold max-w-sm mx-auto">
            Hãy thêm một số từ vựng vào ngày này trong trang quản lý từ vựng trước khi bắt đầu học nhé.
          </p>
          <Link href="/vocabulary" className="cartoon-btn px-6 py-2.5 inline-block text-sm">
            Quản lý từ vựng
          </Link>
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
            <Link
              href={`/exercises/${date}`}
              className="cartoon-btn cartoon-btn-accent px-5 py-3 text-sm flex items-center justify-center gap-2"
            >
              Làm Bài Tập Ngay <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
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
