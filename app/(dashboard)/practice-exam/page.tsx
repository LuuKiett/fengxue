'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { TocflPaper } from '@/lib/types/tocfl'
import { Sparkles, Trophy, ExternalLink, ClipboardList } from 'lucide-react'

export default function PracticeExamPage() {
  const supabase = createClient()

  const [officialPapers, setOfficialPapers] = useState<TocflPaper[]>([])
  const [loadingPapers, setLoadingPapers] = useState(true)

  useEffect(() => {
    async function loadPapers() {
      setLoadingPapers(true)
      const { data } = await supabase.from('tocfl_papers').select('*').eq('band', 'A').order('paper_number')
      setOfficialPapers((data || []) as TocflPaper[])
      setLoadingPapers(false)
    }
    loadPapers()
  }, [supabase])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
        <span>📝</span> Luyện Đề TOCFL
      </h2>

      <div className="bg-gradient-to-r from-blue-400 to-sky-500 text-white p-6 rounded-[24px] shadow-sm space-y-2">
        <h3 className="text-xl font-extrabold flex items-center gap-2">
          <Sparkles className="w-6 h-6 animate-pulse" /> 5 Đề Chính Thức TOCFL Band A
        </h3>
        <p className="font-semibold text-sm text-white/90">
          Luyện tập tự do trên đúng nội dung 5 bộ đề thi thật — có thể nhảy tới bất kỳ câu nào, nộp bài bất cứ lúc
          nào, làm được bao nhiêu tính điểm bấy nhiêu.
        </p>
      </div>

      <div className="cartoon-panel p-5 bg-white space-y-3">
        <h4 className="font-extrabold text-slate-800 flex items-center gap-1.5">
          <Trophy className="w-5 h-5 text-amber-400" /> Chọn Đề
        </h4>
        <p className="text-xs text-slate-500 font-semibold">
          Muốn thi có tính giờ và lưu lịch sử điểm? Vào{' '}
          <Link href="/thi-thu" className="underline">Thi Thử TOCFL</Link>.
        </p>
        {loadingPapers ? (
          <div className="p-6 text-center">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          </div>
        ) : officialPapers.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {officialPapers.map((p) => (
              <Link
                key={p.id}
                href={`/practice-exam/${p.paper_number}`}
                className="cartoon-card p-3 text-center font-black text-slate-700 hover:text-[#189fec]"
              >
                Đề {p.paper_number}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 font-semibold text-center py-6">Chưa có đề nào được thêm.</p>
        )}
      </div>

      <div className="cartoon-card p-5 bg-white space-y-2">
        <h4 className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm">
          <ClipboardList className="w-4 h-4 text-blue-500" /> Tài liệu chính thức
        </h4>
        <p className="text-xs text-slate-500 font-semibold">
          Muốn làm đề thi thử và nghe file âm thanh chính thức của TOCFL? Ủy ban華測會 (SC-TOP) phát hành miễn phí tại:
        </p>
        <a
          href="https://tocfl.edu.tw/tocfl/index.php/exam/test/page/19"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-black text-blue-500 hover:underline flex items-center gap-1"
        >
          tocfl.edu.tw — Mô Phỏng Thí Đề <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  )
}
