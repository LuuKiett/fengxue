'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getTodayString, formatDate } from '@/lib/utils/date'
import {
  BookOpen,
  GraduationCap,
  Dumbbell,
  Calendar,
  CheckCircle2,
  XCircle,
  HelpCircle
} from 'lucide-react'

export default function DashboardPage() {
  const supabase = createClient()
  const todayStr = getTodayString()

  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    vocabCount: 0,
    flashcardCompleted: false,
    exercisesCompletedCount: 0,
  })

  useEffect(() => {
    async function loadStats() {
      try {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // 1. Get today's vocabulary set
        const { data: vocabSet } = await supabase
          .from('vocabulary_sets')
          .select('id')
          .eq('user_id', user.id)
          .eq('date', todayStr)
          .single()

        let vocabCount = 0
        if (vocabSet) {
          const { count } = await supabase
            .from('vocabularies')
            .select('id', { count: 'exact', head: true })
            .eq('set_id', vocabSet.id)
          vocabCount = count || 0
        }

        // 2. Get today's exercise records
        const { data: records } = await supabase
          .from('exercise_records')
          .select('exercise_type, is_completed')
          .eq('user_id', user.id)
          .eq('date', todayStr)

        const flashcardCompleted = !!records?.find(
          (r) => r.exercise_type === 'flashcard' && r.is_completed
        )
        const matchingTypes = ['hanzi_pinyin', 'hanzi_viet', 'fill_in']
        const exercisesCompletedCount = records
          ? records.filter((r) => matchingTypes.includes(r.exercise_type) && r.is_completed).length
          : 0

        setStats({
          vocabCount,
          flashcardCompleted,
          exercisesCompletedCount,
        })
      } catch (err) {
        console.error('Lỗi khi tải thông tin thống kê:', err)
      } finally {
        setLoading(false)
      }
    }

    loadStats()
  }, [supabase, todayStr])

  const motivationalQuotes = [
    { zh: "温故而知新", vi: "Ôn lại việc cũ để biết thêm việc mới." },
    { zh: "学无止境", vi: "Sự học là vô bờ bến." },
    { zh: "千里之行，始于足下", vi: "Hành trình vạn dặm khởi đầu từ một bước chân." },
    { zh: "一口吃不成胖子", vi: "Một miếng ăn không thể béo ngay được (Dục tốc bất đạt)." }
  ]

  const quote = motivationalQuotes[new Date().getDate() % motivationalQuotes.length]

  return (
    <div className="space-y-6">
      {/* Welcome mascot card */}
      <div className="bg-gradient-to-r from-blue-400 to-indigo-500 text-white p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 rounded-[24px] shadow-sm">
        <div className="space-y-3 text-center md:text-left">
          <h2 className="text-3xl font-extrabold">Chào mừng đến với FengXue! 🐼</h2>
          <p className="text-white/90 font-semibold max-w-lg">
            Hôm nay là ngày <span className="underline font-bold text-yellow-300">{formatDate(todayStr)}</span>. Hãy cùng nhau học thêm nhiều từ vựng thú vị nhé!
          </p>
          <div className="bg-white/20 p-3 rounded-xl inline-block max-w-md border border-white/30 text-left">
            <p className="font-chinese text-xl text-yellow-300">{quote.zh}</p>
            <p className="text-xs font-semibold text-white/90 mt-1">💡 {quote.vi}</p>
          </div>
        </div>
        <div className="w-24 h-24 relative flex items-center justify-center bg-white rounded-full border border-slate-100 shadow-sm shrink-0 animate-float">
          {/* Decorative Mascot text representation */}
          <span className="text-5xl">🐼</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="cartoon-card p-6 flex items-center gap-4 bg-white">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-800">{loading ? '...' : stats.vocabCount}</div>
            <div className="text-xs font-bold text-slate-400">Từ vựng hôm nay</div>
          </div>
        </div>

        <div className="cartoon-card p-6 flex items-center gap-4 bg-white">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <div className="text-lg font-black text-slate-800">
              {loading ? '...' : stats.flashcardCompleted ? 'Đã học 🎉' : 'Chưa học 📖'}
            </div>
            <div className="text-xs font-bold text-slate-400">Học từ mới (Flashcards)</div>
          </div>
        </div>

        <div className="cartoon-card p-6 flex items-center gap-4 bg-white">
          <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600">
            <Dumbbell className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-slate-800">
              {loading ? '...' : `${stats.exercisesCompletedCount}/3`}
            </div>
            <div className="text-xs font-bold text-slate-400">Bài tập nối từ đã xong</div>
          </div>
        </div>
      </div>

      {/* Main Actions / Today's Checklist */}
      <div className="cartoon-card p-6 bg-white space-y-4">
        <h3 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
          <span>📋</span> Nhiệm Vụ Hôm Nay
        </h3>

        <div className="divide-y-3 divide-slate-100">
          {/* Step 1: Manage Vocab */}
          <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex gap-3 items-start">
              {stats.vocabCount > 0 ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-6 h-6 text-slate-300 shrink-0 mt-0.5" />
              )}
              <div>
                <h4 className="font-extrabold text-slate-800 text-base">Bước 1: Chuẩn bị từ vựng</h4>
                <p className="text-sm font-semibold text-slate-500">
                  Thêm hoặc import danh sách từ vựng cho ngày hôm nay ({stats.vocabCount} từ hiện có).
                </p>
              </div>
            </div>
            <Link href="/vocabulary" className="cartoon-btn px-4 py-2 text-sm text-center">
              Quản lý từ vựng
            </Link>
          </div>

          {/* Step 2: Learn Flashcards */}
          <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex gap-3 items-start">
              {stats.flashcardCompleted ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-6 h-6 text-slate-300 shrink-0 mt-0.5" />
              )}
              <div>
                <h4 className="font-extrabold text-slate-800 text-base">Bước 2: Học từ mới qua Flashcard</h4>
                <p className="text-sm font-semibold text-slate-500">
                  Học mặt chữ, cách phát âm (Pinyin) và ngữ nghĩa thông qua bộ thẻ lật 3D.
                </p>
              </div>
            </div>
            <Link
              href="/learn"
              className={`cartoon-btn px-4 py-2 text-sm text-center ${stats.vocabCount === 0 ? 'opacity-50 pointer-events-none' : ''
                }`}
            >
              Học Flashcard
            </Link>
          </div>

          {/* Step 3: Exercise */}
          <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex gap-3 items-start">
              {stats.exercisesCompletedCount === 3 ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-6 h-6 text-slate-300 shrink-0 mt-0.5" />
              )}
              <div>
                <h4 className="font-extrabold text-slate-800 text-base">Bước 3: Bài tập rèn luyện</h4>
                <p className="text-sm font-semibold text-slate-500">
                  Luyện tập nối Chữ Hán ↔ Pinyin, Chữ Hán ↔ Nghĩa tiếng Việt và Điền Từ để tăng cường trí nhớ.
                </p>
              </div>
            </div>
            <Link
              href={`/exercises/${todayStr}`}
              className={`cartoon-btn px-4 py-2 text-sm text-center ${stats.vocabCount === 0 || !stats.flashcardCompleted
                ? 'opacity-50 pointer-events-none' : ''
                }`}
            >
              Làm bài tập
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
