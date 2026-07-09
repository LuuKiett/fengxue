'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { TocflPaper, TocflAttempt } from '@/lib/types/tocfl'
import { Headphones, BookOpenCheck, Clock, TrendingUp, TrendingDown, Minus, PlayCircle, Trophy } from 'lucide-react'

interface PaperCardData {
  paper: TocflPaper
  attempts: TocflAttempt[]
}

export default function ThiThuPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<PaperCardData[]>([])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const [{ data: papers }, attemptsRes] = await Promise.all([
          supabase.from('tocfl_papers').select('*').eq('band', 'A').order('paper_number'),
          user
            ? supabase
                .from('tocfl_attempts')
                .select('*')
                .eq('user_id', user.id)
                .eq('status', 'completed')
                .order('created_at', { ascending: true })
            : Promise.resolve({ data: [] as TocflAttempt[] }),
        ])

        const attemptsByPaper = new Map<string, TocflAttempt[]>()
        for (const a of (attemptsRes.data || []) as TocflAttempt[]) {
          const list = attemptsByPaper.get(a.paper_id) || []
          list.push(a)
          attemptsByPaper.set(a.paper_id, list)
        }

        setCards(
          ((papers || []) as TocflPaper[]).map((paper) => ({
            paper,
            attempts: attemptsByPaper.get(paper.id) || [],
          }))
        )
      } catch (err) {
        console.error('Lỗi khi tải danh sách đề thi:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [supabase])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
        <span>🎓</span> Thi Thử TOCFL Band A
      </h2>

      <div className="bg-gradient-to-r from-blue-400 to-sky-500 text-white p-6 rounded-[24px] shadow-sm space-y-2">
        <h3 className="text-xl font-extrabold flex items-center gap-2">
          <Trophy className="w-6 h-6" /> 5 Đề Thi Thử Chính Thức
        </h3>
        <p className="font-semibold text-sm text-white/90">
          Đề thi được số hóa 100% từ bộ đề gốc TOCFL Band A (入門基礎級模擬試題): đầy đủ hình ảnh, file nghe thật cho
          từng câu, đúng cấu trúc 5 phần nghe + 5 phần đọc, 100 câu, 120 phút. Làm bài xong sẽ chấm điểm và lưu lại
          lịch sử để theo dõi tiến bộ.
        </p>
      </div>

      {loading ? (
        <div className="p-10 text-center">
          <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      ) : cards.length === 0 ? (
        <div className="cartoon-card p-8 text-center text-slate-500 font-bold">
          Chưa có đề thi nào được nạp vào hệ thống.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map(({ paper, attempts }) => (
            <PaperCard key={paper.id} paper={paper} attempts={attempts} />
          ))}
        </div>
      )}
    </div>
  )
}

function PaperCard({ paper, attempts }: PaperCardData) {
  const best = attempts.reduce<TocflAttempt | null>(
    (acc, a) => (acc === null || (a.score_percent ?? 0) > (acc.score_percent ?? 0) ? a : acc),
    null
  )
  const latest = attempts[attempts.length - 1] || null
  const prev = attempts.length >= 2 ? attempts[attempts.length - 2] : null

  let trend: 'up' | 'down' | 'same' | null = null
  if (latest && prev) {
    if ((latest.score_percent ?? 0) > (prev.score_percent ?? 0)) trend = 'up'
    else if ((latest.score_percent ?? 0) < (prev.score_percent ?? 0)) trend = 'down'
    else trend = 'same'
  }

  return (
    <Link href={`/thi-thu/${paper.paper_number}`} className="cartoon-card p-5 flex flex-col gap-3 bg-white">
      <div className="flex items-center justify-between">
        <span className="font-black text-slate-800 text-lg">Đề {paper.paper_number}</span>
        <span className="text-[11px] font-bold text-white bg-[#189fec] px-2.5 py-1 rounded-full">Band A</span>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 bg-blue-50 rounded-xl px-2.5 py-2 flex items-center gap-1.5">
          <Headphones className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-[11px] font-bold text-slate-600">Nghe {paper.listening_time_minutes}p</span>
        </div>
        <div className="flex-1 bg-emerald-50 rounded-xl px-2.5 py-2 flex items-center gap-1.5">
          <BookOpenCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-[11px] font-bold text-slate-600">Đọc {paper.reading_time_minutes}p</span>
        </div>
      </div>

      {attempts.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-4 text-slate-400 font-bold text-sm gap-1.5">
          <PlayCircle className="w-5 h-5" /> Chưa làm lần nào
        </div>
      ) : (
        <div className="space-y-1.5 py-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Điểm cao nhất</span>
            <span className="font-black text-slate-800">{best?.score_percent?.toFixed(0)}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Lần gần nhất</span>
            <span className="font-black text-slate-800 flex items-center gap-1">
              {latest?.score_percent?.toFixed(0)}%
              {trend === 'up' && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
              {trend === 'down' && <TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
              {trend === 'same' && <Minus className="w-3.5 h-3.5 text-slate-400" />}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Số lần thi</span>
            <span className="font-black text-slate-800 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" /> {attempts.length}
            </span>
          </div>
        </div>
      )}

      <span className="cartoon-btn w-full text-center mt-auto">
        {attempts.length === 0 ? 'Bắt Đầu Thi' : 'Thi Lại'}
      </span>
    </Link>
  )
}
