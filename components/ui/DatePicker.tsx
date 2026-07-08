'use client'

import React, { useEffect, useRef, useState } from 'react'
import { getDaysInMonth, toLocalDateString, formatDate, getTodayString } from '@/lib/utils/date'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'

interface DatePickerProps {
  value: string // YYYY-MM-DD
  onChange: (date: string) => void
  className?: string
}

const WEEKDAY_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const MONTH_NAMES = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
]

export default function DatePicker({ value, onChange, className }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value) : new Date()))
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (value) setViewDate(new Date(value))
  }, [value])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const days = getDaysInMonth(year, month)
  const startDayOfWeek = days[0].getDay()
  const adjustedStart = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1

  const gridCells: (Date | null)[] = []
  for (let i = 0; i < adjustedStart; i++) gridCells.push(null)
  days.forEach((d) => gridCells.push(d))

  const handlePick = (day: Date) => {
    onChange(toLocalDateString(day))
    setOpen(false)
  }

  const handleToday = () => {
    onChange(getTodayString())
    setOpen(false)
  }

  return (
    <div className={`relative ${className || ''}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl hover:bg-slate-50 transition-colors"
      >
        <CalendarIcon className="w-5 h-5 text-[#1877f2]" />
        <span className="font-black text-slate-700 text-sm">{formatDate(value)}</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-72 bg-white rounded-2xl border border-slate-200 shadow-xl p-4 animate-bounce-in left-0">
          <div className="flex justify-between items-center mb-3">
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              className="cartoon-btn-secondary w-8 h-8 flex items-center justify-center rounded-lg"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-black text-slate-800 text-sm">{MONTH_NAMES[month]} {year}</span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              className="cartoon-btn-secondary w-8 h-8 flex items-center justify-center rounded-lg"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-400 mb-1">
            {WEEKDAY_HEADERS.map((h) => (
              <div key={h}>{h}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 mb-3">
            {gridCells.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} className="aspect-square" />
              const dateStr = toLocalDateString(day)
              const isSelected = dateStr === value
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => handlePick(day)}
                  className={`aspect-square rounded-lg text-xs font-bold transition-all ${
                    isSelected
                      ? 'bg-[#1877f2] text-white'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={handleToday}
            className="cartoon-btn-secondary w-full py-1.5 text-xs font-black rounded-xl"
          >
            Hôm nay
          </button>
        </div>
      )}
    </div>
  )
}
