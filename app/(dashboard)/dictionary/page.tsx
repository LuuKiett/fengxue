'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { stripTones } from '@/lib/utils/pinyin'
import { sortLevels } from '@/lib/utils/dictionaryLevels'
import Pagination from '@/components/ui/Pagination'
import { Search, BookMarked, Volume2 } from 'lucide-react'

interface DictWord {
  id: string
  band: string
  level: string
  hanzi: string
  pinyin: string
  vietnamese: string
  pos: string | null
  example_hanzi: string | null
  example_pinyin: string | null
  example_vietnamese: string | null
}

function speak(text: string) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-TW'
    utterance.rate = 0.85
    window.speechSynthesis.speak(utterance)
  }
}

const PAGE_SIZE = 24

export default function DictionaryPage() {
  const supabase = createClient()

  const [words, setWords] = useState<DictWord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeLevel, setActiveLevel] = useState<string>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    async function loadDictionary() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('dictionary_words')
          .select('id, band, level, hanzi, pinyin, vietnamese, pos, example_hanzi, example_pinyin, example_vietnamese')
          .order('level', { ascending: true })
          .order('order_index', { ascending: true })

        if (error) throw error
        setWords(data || [])

        if (data && data.length > 0) {
          const levels = sortLevels(Array.from(new Set(data.map((w) => w.level))))
          setActiveLevel(levels[0])
        }
      } catch (err) {
        console.error('Lỗi khi tải từ điển:', err)
      } finally {
        setLoading(false)
      }
    }
    loadDictionary()
  }, [supabase])

  const levels = useMemo(
    () => sortLevels(Array.from(new Set(words.map((w) => w.level)))),
    [words]
  )

  const isSearching = search.trim().length > 0

  const filteredWords = useMemo(() => {
    if (!isSearching) {
      return words.filter((w) => w.level === activeLevel)
    }
    const q = search.trim().toLowerCase()
    const qToneless = stripTones(q)
    return words.filter(
      (w) =>
        w.hanzi.includes(search.trim()) ||
        w.vietnamese.toLowerCase().includes(q) ||
        stripTones(w.pinyin).includes(qToneless) ||
        (w.example_vietnamese?.toLowerCase().includes(q) ?? false)
    )
  }, [words, activeLevel, search, isSearching])

  // Reset to page 1 whenever the active tab or search query changes
  useEffect(() => {
    setPage(1)
  }, [activeLevel, search])

  const totalPages = Math.max(1, Math.ceil(filteredWords.length / PAGE_SIZE))
  const pageWords = filteredWords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
        <span>📚</span> Từ Điển
        <span className="text-[#1877f2] animate-sparkle">✦</span>
      </h2>

      {/* Search box */}
      <div className="cartoon-card p-3 bg-white flex items-center gap-2">
        <Search className="w-5 h-5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tra cứu theo Hán tự, Pinyin hoặc nghĩa tiếng Việt..."
          className="flex-1 outline-none font-bold text-base bg-transparent"
        />
      </div>

      {/* Level tabs (hidden while searching across all levels) */}
      {!isSearching && (
        <div className="flex flex-wrap gap-2">
          {levels.map((lvl) => (
            <button
              key={lvl}
              onClick={() => setActiveLevel(lvl)}
              className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${
                activeLevel === lvl
                  ? 'bg-[#1877f2] text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      )}

      {isSearching && (
        <p className="text-sm font-bold text-slate-500 flex items-center gap-1.5">
          <BookMarked className="w-4 h-4 text-blue-500" />
          Tìm thấy {filteredWords.length} từ trên tất cả các cấp độ
        </p>
      )}

      {/* Word list */}
      <div className="cartoon-card bg-white overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="font-bold text-slate-500">Đang tải từ điển...</p>
          </div>
        ) : pageWords.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <span className="text-6xl animate-float inline-block">📖</span>
            <h3 className="text-xl font-extrabold text-slate-700">
              {isSearching ? 'Không tìm thấy từ nào phù hợp' : 'Chưa có dữ liệu từ điển cho cấp độ này'}
            </h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-nowrap sm:text-wrap">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="p-4 font-black text-slate-700 text-base">Hán Tự</th>
                  <th className="p-4 font-black text-slate-700 text-base">Pinyin</th>
                  <th className="p-4 font-black text-slate-700 text-base">Nghĩa Tiếng Việt</th>
                  <th className="p-4 font-black text-slate-700 text-base">Ví Dụ</th>
                  <th className="p-4 font-black text-slate-700 text-base text-center">Cấp Độ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700 text-base">
                {pageWords.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50 align-top">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-chinese text-3xl font-bold text-slate-900">{w.hanzi}</span>
                        <button
                          onClick={() => speak(w.hanzi)}
                          className="p-1 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                          title="Phát âm"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                    <td className="p-4 text-blue-600 font-bold text-lg">
                      {w.pinyin}
                      {w.pos && (
                        <span className="ml-2 text-[11px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 align-middle">
                          {w.pos}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-slate-800">{w.vietnamese || '—'}</td>
                    <td className="p-4 min-w-[240px]">
                      {w.example_hanzi ? (
                        <div className="flex items-start gap-1.5">
                          <div className="space-y-1">
                            <p className="font-chinese font-bold text-3xl text-slate-800 leading-snug">{w.example_hanzi}</p>
                            <p className="text-sm text-blue-500 italic">{w.example_pinyin}</p>
                            <p className="text-sm text-slate-500">{w.example_vietnamese}</p>
                          </div>
                          <button
                            onClick={() => speak(w.example_hanzi!)}
                            className="p-1 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors flex-shrink-0"
                            title="Nghe câu ví dụ"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-300 italic">Chưa có ví dụ</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <span className="text-xs font-black px-2 py-1 rounded-full bg-blue-50 text-blue-600">
                        {w.level}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && filteredWords.length > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  )
}
