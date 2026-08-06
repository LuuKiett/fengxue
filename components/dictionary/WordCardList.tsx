'use client'

import { useState } from 'react'
import { ChevronDown, Volume2 } from 'lucide-react'
import { speak } from '@/lib/utils/speak'

export interface WordCardExample {
  hanzi: string
  pinyin: string
  vietnamese: string
}

export interface WordCardItem {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
  pos?: string | null
  hanViet?: string | null
  level?: string | null
  tocflBand?: number | null
  examples: WordCardExample[]
}

interface WordCardListProps {
  words: WordCardItem[]
  // Offsets the "1, 2, 3..." badge so numbering stays continuous across pages of a
  // paginated list, e.g. (page - 1) * PAGE_SIZE.
  startIndex?: number
}

// Shared word-browsing row for every "từ điển"-style page (/dictionary,
// /full-dictionary, /tocfl-dictionary, /textbook) — mirrors zh.taiwandiary.vn's own
// word-list card design per explicit user request: numbered badge, hanzi in the
// site's dark navy ink color + pinyin + nghĩa collapsed by default, click anywhere on
// the row (not just the "Chi tiết" pill) to reveal POS/level/TOCFL tags plus every
// example sentence with its own speaker button.
export default function WordCardList({ words, startIndex = 0 }: WordCardListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="divide-y divide-slate-100">
      {words.map((w, idx) => {
        const expanded = expandedIds.has(w.id)
        const hasTags = w.level || w.pos || w.tocflBand || w.hanViet
        return (
          <div key={w.id} className="p-4 sm:p-5 ">
            <div
              onClick={() => toggle(w.id)}
              className="bg-white cursor-pointer flex items-start gap-3 -m-3 p-2 rounded-2xl hover:bg-slate-50 transition-colors"
            >
              <span className="w-7 h-7 rounded-full bg-blue-50 text-[#1182b7] flex items-center justify-center font-black text-xs shrink-0 mt-1">
                {startIndex + idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  <span className="font-chinese text-2xl sm:text-3xl text-[#1182b7]">{w.hanzi}</span>
                  <span className="text-[#1182b7] font-bold text-base">{w.pinyin}</span>
                </div>
                <p className="text-slate-500 font-semibold text-sm mt-0.5">{w.vietnamese || '—'}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full font-black text-xs border-2 transition-colors ${
                    expanded ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  Chi tiết
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); speak(w.hanzi) }}
                  className="p-2 rounded-full text-slate-300 hover:text-[#1182b7] hover:bg-blue-50 transition-colors"
                  title="Phát âm"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {expanded && (
              <div className="mt-3 space-y-3">
                {hasTags && (
                  <div className="flex flex-wrap gap-1.5">
                    {w.level && (
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-full border border-blue-200 text-blue-600 bg-blue-50">
                        {w.level}
                      </span>
                    )}
                    {w.pos && (
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-full border border-slate-200 text-slate-500">
                        {w.pos}
                      </span>
                    )}
                    {w.tocflBand && (
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-full border border-amber-200 text-amber-600 bg-amber-50">
                        TOCFL {w.tocflBand}
                      </span>
                    )}
                    {w.hanViet && (
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-full border border-indigo-200 text-indigo-500 bg-indigo-50">
                        Hán Việt: {w.hanViet}
                      </span>
                    )}
                  </div>
                )}

                {w.examples.length > 0 ? (
                  <div className="space-y-2">
                    {w.examples.map((ex, i) => (
                      <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl p-3 flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="font-chinese text-xl text-[#173a5e] leading-snug">{ex.hanzi}</p>
                          <p className="text-sm text-[#1182b7] font-bold">{ex.pinyin}</p>
                          <p className="text-sm text-slate-500">{ex.vietnamese}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); speak(ex.hanzi) }}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-[#1182b7] hover:bg-white transition-colors flex-shrink-0"
                          title="Nghe câu ví dụ"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-slate-300 italic">Chưa có ví dụ</span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
