'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getDaysInMonth, toLocalDateString, formatDate } from '@/lib/utils/date'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Check } from 'lucide-react'

interface DateStatus {
  completedCount: number // out of 2
}

export default function ExercisesPage() {
  const supabase = createClient()
  
  const [currentDate, setCurrentDate] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [completionMap, setCompletionMap] = useState<{ [dateStr: string]: DateStatus }>({})
  const [vocabCountMap, setVocabCountMap] = useState<{ [dateStr: string]: number }>({})

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const monthNames = [
    'Tháng Một', 'Tháng Hai', 'Tháng Ba', 'Tháng Tư', 'Tháng Năm', 'Tháng Sáu',
    'Tháng Bảy', 'Tháng Tám', 'Tháng Chín', 'Tháng Mười', 'Tháng Mười Một', 'Tháng Mười Hai'
  ]

  const loadCompletionData = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Start and end dates for the current month view
      const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const lastDay = new Date(year, month + 1, 0).getDate()
      const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`

      const { data: records, error } = await supabase
        .from('exercise_records')
        .select('date, exercise_type, is_completed')
        .eq('user_id', user.id)
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)
        .eq('is_completed', true)

      if (error) throw error

      const tempMap: { [dateStr: string]: DateStatus } = {}

      if (records) {
        records.forEach(r => {
          // Count only the remaining matching exercise types
          const matchingTypes = ['hanzi_pinyin', 'hanzi_viet']
          if (matchingTypes.includes(r.exercise_type)) {
            if (!tempMap[r.date]) {
              tempMap[r.date] = { completedCount: 0 }
            }
            tempMap[r.date].completedCount++
          }
        })
      }

      setCompletionMap(tempMap)

      // Vocab count per day, so the calendar shows at a glance which days have words
      const { data: sets } = await supabase
        .from('vocabulary_sets')
        .select('id, date')
        .eq('user_id', user.id)
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)

      const setIdToDate: Record<string, string> = {}
      for (const s of sets || []) setIdToDate[s.id] = s.date
      const setIds = Object.keys(setIdToDate)

      const vocabCountByDate: Record<string, number> = {}
      if (setIds.length > 0) {
        const { data: vocabRows } = await supabase
          .from('vocabularies')
          .select('set_id')
          .in('set_id', setIds)

        for (const v of vocabRows || []) {
          const d = setIdToDate[v.set_id]
          if (d) vocabCountByDate[d] = (vocabCountByDate[d] || 0) + 1
        }
      }
      setVocabCountMap(vocabCountByDate)
    } catch (err) {
      console.error('Error fetching calendar records:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCompletionData()
  }, [currentDate])

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const days = getDaysInMonth(year, month)
  
  // Calculate empty spaces before start of month to align calendar grid
  const startDayOfWeek = days[0].getDay() // 0 = Sunday, 1 = Monday, etc.
  // We'll align Monday as first day or Sunday as first day. Let's do Monday (1) as start.
  // If startDayOfWeek is 0 (Sunday), it should be position 6 (0-indexed where Mon=0)
  const adjustedStart = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1

  const gridCells: (Date | null)[] = []
  
  // Add empty slots
  for (let i = 0; i < adjustedStart; i++) {
    gridCells.push(null)
  }
  
  // Add actual days
  days.forEach(day => {
    gridCells.push(day)
  })

  const weekdayHeaders = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Title */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
          <span>📅</span> Lịch Học Luyện Tập
        </h2>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-bold text-slate-500 bg-white p-3 border border-slate-100 rounded-2xl shadow-sm">
          <div className="flex items-center gap-1">
            <span className="w-3.5 h-3.5 rounded-full bg-emerald-400 border border-emerald-300 block"></span>
            <span>Đã hoàn thành</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3.5 h-3.5 rounded-full bg-amber-300 border border-amber-200 block"></span>
            <span>Chưa xong</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3.5 h-3.5 rounded-full bg-slate-100 border border-slate-200 block"></span>
            <span>Chưa làm</span>
          </div>
        </div>
      </div>

      {/* Calendar Card */}
      <div className="cartoon-card bg-white p-6 relative">
        {/* Month Selector header */}
        <div className="flex justify-between items-center mb-6">
          <button 
            onClick={handlePrevMonth}
            className="cartoon-btn cartoon-btn-secondary p-2.5 flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-blue-500 animate-bounce" />
            {monthNames[month]} {year}
          </h3>

          <button 
            onClick={handleNextMonth}
            className="cartoon-btn cartoon-btn-secondary p-2.5 flex items-center justify-center"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="h-80 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
            <p className="font-bold text-slate-500 text-sm">Đang đồng bộ dữ liệu tiến độ...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-black text-slate-400">
              {weekdayHeaders.map(h => (
                <div key={h}>{h}</div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-2">
              {gridCells.map((day, idx) => {
                if (!day) {
                  return <div key={`empty-${idx}`} className="aspect-square bg-slate-50/50 rounded-xl"></div>
                }

                const dateStr = toLocalDateString(day)
                const status = completionMap[dateStr]
                
                let cellClass = 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-sm'
                let labelIcon = null

                if (status) {
                  if (status.completedCount === 3) {
                    cellClass = 'bg-emerald-400 border-transparent text-white shadow-md shadow-emerald-100 scale-102 hover:bg-emerald-500'
                    labelIcon = <Check className="w-3 h-3 stroke-[3]" />
                  } else if (status.completedCount > 0) {
                    cellClass = 'bg-amber-300 border-transparent text-slate-800 shadow-md shadow-amber-100 hover:bg-amber-400'
                  }
                }

                const vocabCount = vocabCountMap[dateStr]

                return (
                  <Link
                    key={dateStr}
                    href={`/exercises/${dateStr}`}
                    className={`aspect-square border rounded-xl flex flex-col items-center justify-between p-1.5 transition-all font-black text-sm relative ${cellClass}`}
                  >
                    <span className="self-start">{day.getDate()}</span>
                    {vocabCount > 0 && (
                      <span
                        className="absolute top-10 right-11 min-w-[15px] px-1 text-lg font-black rounded-full bg-white/90 text-green-600 border border-green-100 text-center leading-tight"
                        title={`${vocabCount} từ vựng`}
                      >
                        {vocabCount}
                      </span>
                    )}
                    <div className="absolute bottom-1 right-1">
                      {labelIcon}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
