'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils/date'
import MatchingExercise from '@/components/exercises/MatchingExercise'
import FillInExercise from '@/components/exercises/FillInExercise'
import { ArrowLeft, Award } from 'lucide-react'
import confetti from 'canvas-confetti'

interface VocabItem {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
}

type ExerciseType = 'hanzi_pinyin' | 'hanzi_viet' | 'fill_in'

const SOURCE_LABELS: { [key: string]: string } = {
  study: 'Từ Vựng Tự Học',
  practice: 'Từ Vựng Khác',
}

export default function DateExercisesPage() {
  return (
    <Suspense fallback={
      <div className="cartoon-card bg-white p-12 text-center max-w-xl mx-auto">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="font-bold text-slate-500">Đang chuẩn bị bài tập luyện...</p>
      </div>
    }>
      <DateExercisesPageInner />
    </Suspense>
  )
}

function DateExercisesPageInner() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const dateStr = params.date as string
  const sourceParam = searchParams.get('source') // 'study' | 'practice' | 'all' | null
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [vocabs, setVocabs] = useState<VocabItem[]>([])
  
  // Exercise states: 'list' | 'playing'
  const [mode, setMode] = useState<'list' | 'playing'>('list')
  const [activeType, setActiveType] = useState<ExerciseType | null>(null)

  // Completion records
  const [records, setRecords] = useState<{ [key: string]: boolean }>({
    hanzi_pinyin: false,
    hanzi_viet: false,
    fill_in: false
  })

  const loadData = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Load vocab set
      const { data: set } = await supabase
        .from('vocabulary_sets')
        .select('id')
        .eq('user_id', user.id)
        .eq('date', dateStr)
        .single()

      if (set) {
        let query = supabase
          .from('vocabularies')
          .select('id, hanzi, pinyin, vietnamese')
          .eq('set_id', set.id)

        if (sourceParam === 'study' || sourceParam === 'practice') {
          query = query.eq('source', sourceParam)
        }

        const { data: list } = await query
        setVocabs(list || [])
      }

      // Load completed exercise records
      const { data: recs } = await supabase
        .from('exercise_records')
        .select('exercise_type, is_completed')
        .eq('user_id', user.id)
        .eq('date', dateStr)

      const statusMap = {
        hanzi_pinyin: false,
        hanzi_viet: false,
        fill_in: false
      }

      if (recs) {
        recs.forEach(r => {
          if (r.exercise_type in statusMap) {
            statusMap[r.exercise_type as keyof typeof statusMap] = r.is_completed
          }
        })
      }
      setRecords(statusMap)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [dateStr, sourceParam])

  const startExercise = (type: ExerciseType) => {
    setActiveType(type)
    setMode('playing')
  }

  const handleExerciseComplete = async (score: number) => {
    if (!activeType) return
    
    // Trigger confetti animation
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    })

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Save to database
      await supabase
        .from('exercise_records')
        .upsert({
          user_id: user.id,
          date: dateStr,
          exercise_type: activeType,
          is_completed: true,
          score,
          completed_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date,exercise_type'
        })

      // Reload data to refresh checklist status
      await loadData()
      setMode('list')
      setActiveType(null)
    } catch (err) {
      console.error('Error saving exercise record:', err)
      setMode('list')
      setActiveType(null)
    }
  }

  const handleFillInComplete = () => handleExerciseComplete(100)

  const getExerciseTitle = (type: string) => {
    if (type === 'hanzi_pinyin') return 'Chữ Hán ↔ Phiên âm (Pinyin)'
    if (type === 'hanzi_viet') return 'Chữ Hán ↔ Nghĩa Việt'
    if (type === 'fill_in') return 'Điền Từ'
    return ''
  }

  if (loading) {
    return (
      <div className="cartoon-card bg-white p-12 text-center max-w-xl mx-auto">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="font-bold text-slate-500">Đang chuẩn bị bài tập luyện...</p>
      </div>
    )
  }

  if (vocabs.length === 0) {
    return (
      <div className="cartoon-card bg-white p-12 text-center max-w-xl mx-auto space-y-4">
        <span className="text-6xl animate-float inline-block">🐼</span>
        <h3 className="text-xl font-extrabold text-slate-700">
          {sourceParam && SOURCE_LABELS[sourceParam]
            ? `Chưa có từ vựng nào thuộc mục "${SOURCE_LABELS[sourceParam]}" cho ngày này!`
            : 'Chưa có từ vựng học nào cho ngày này!'}
        </h3>
        <p className="text-slate-500 font-semibold max-w-sm mx-auto">
          Vui lòng thêm từ vựng trước khi thực hiện bài tập nối từ.
        </p>
        <Link href="/vocabulary" className="cartoon-btn px-6 py-2 text-sm inline-block">
          Thêm Từ Vựng
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Navigation and Title */}
      <div className="flex items-center gap-3">
        {mode === 'playing' ? (
          <button 
            onClick={() => { setMode('list'); setActiveType(null); }}
            className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 bg-white"
          >
            <ArrowLeft className="w-5 h-5 text-slate-800" />
          </button>
        ) : (
          <Link 
            href="/exercises"
            className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 bg-white"
          >
            <ArrowLeft className="w-5 h-5 text-slate-800" />
          </Link>
        )}
        <div>
          <h2 className="text-2xl font-black text-slate-800">
            {mode === 'playing' ? getExerciseTitle(activeType!) : 'Bài Tập Luyện Tập'}
          </h2>
          <p className="text-xs font-bold text-slate-500">
            Ngày {formatDate(dateStr)}
            {sourceParam && SOURCE_LABELS[sourceParam] && (
              <span className="ml-2 px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-600 rounded-full text-[10px] font-black uppercase tracking-wide">
                {SOURCE_LABELS[sourceParam]}
              </span>
            )}
          </p>
        </div>
      </div>

      {mode === 'list' ? (
        /* LIST MODE: Display Cards */
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white p-6 rounded-[24px] shadow-sm flex items-center justify-between gap-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-extrabold flex items-center gap-2">
                <Award className="w-7 h-7" /> Thử Thách Luyện Tập
              </h3>
              <p className="font-semibold text-amber-50 max-w-md">
                Hoàn thành cả 3 bài tập để nhận dấu tích xanh hoàn tất trên lịch tiến độ tháng nhé! 🌟
              </p>
            </div>
            <div className="hidden sm:flex text-6xl animate-float">🎓</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="cartoon-card p-5 bg-white flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center font-bold text-blue-600">1</span>
                  {records.hanzi_pinyin && (
                    <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-[10px] font-black text-emerald-700 rounded-full">XONG</span>
                  )}
                </div>
                <h4 className="font-extrabold text-slate-800 text-lg">Chữ Hán ↔ Pinyin</h4>
                <p className="text-xs text-slate-500 font-semibold">Nối ký tự tiếng Trung với cách viết phiên âm đúng.</p>
              </div>
              <button
                onClick={() => startExercise('hanzi_pinyin')}
                className="cartoon-btn w-full py-2.5 text-xs text-center"
              >
                {records.hanzi_pinyin ? 'Luyện Lại 🔄' : 'Bắt Đầu 🚀'}
              </button>
            </div>

            <div className="cartoon-card p-5 bg-white flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center font-bold text-blue-600">2</span>
                  {records.hanzi_viet && (
                    <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-[10px] font-black text-emerald-700 rounded-full">XONG</span>
                  )}
                </div>
                <h4 className="font-extrabold text-slate-800 text-lg">Chữ Hán ↔ Nghĩa Việt</h4>
                <p className="text-xs text-slate-500 font-semibold">Nối mặt chữ với nghĩa tiếng Việt tương ứng.</p>
              </div>
              <button
                onClick={() => startExercise('hanzi_viet')}
                className="cartoon-btn w-full py-2.5 text-xs text-center"
              >
                {records.hanzi_viet ? 'Luyện Lại 🔄' : 'Bắt Đầu 🚀'}
              </button>
            </div>

            <div className="cartoon-card p-5 bg-white flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center font-bold text-blue-600">3</span>
                  {records.fill_in && (
                    <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-[10px] font-black text-emerald-700 rounded-full">XONG</span>
                  )}
                </div>
                <h4 className="font-extrabold text-slate-800 text-lg">Điền Từ</h4>
                <p className="text-xs text-slate-500 font-semibold">Gõ pinyin để ghép đúng chữ Hán cho từng từ.</p>
              </div>
              <button
                onClick={() => startExercise('fill_in')}
                className="cartoon-btn w-full py-2.5 text-xs text-center"
              >
                {records.fill_in ? 'Luyện Lại 🔄' : 'Bắt Đầu 🚀'}
              </button>
            </div>
          </div>
        </div>
      ) : activeType === 'fill_in' ? (
        /* PLAYING MODE: Fill-in Exercise */
        <FillInExercise words={vocabs} onComplete={handleFillInComplete} />
      ) : (
        /* PLAYING MODE: Display Game */
        <MatchingExercise
          vocabs={vocabs}
          matchType={activeType!}
          onComplete={handleExerciseComplete}
        />
      )}
    </div>
  )
}
