'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { stripTones } from '@/lib/utils/pinyin'
import { sortLevels } from '@/lib/utils/dictionaryLevels'
import Pagination from '@/components/ui/Pagination'
import { Search, BookMarked } from 'lucide-react'

interface DictWord {
  id: string
  band: string
  level: string
  hanzi: string
  pinyin: string
  vietnamese: string
  pos: string | null
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
          .select('id, band, level, hanzi, pinyin, vietnamese, pos')
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
        stripTones(w.pinyin).includes(qToneless)
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
          className="flex-1 outline-none font-bold text-sm bg-transparent"
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
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="p-4 font-black text-slate-700 text-sm">Hán Tự</th>
                  <th className="p-4 font-black text-slate-700 text-sm">Pinyin</th>
                  <th className="p-4 font-black text-slate-700 text-sm">Nghĩa Tiếng Việt</th>
                  <th className="p-4 font-black text-slate-700 text-sm text-center">Cấp Độ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                {pageWords.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className="p-4 font-chinese text-2xl font-bold text-slate-900">{w.hanzi}</td>
                    <td className="p-4 text-blue-600 font-bold">
                      {w.pinyin}
                      {w.pos && (
                        <span className="ml-2 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 align-middle">
                          {w.pos}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-slate-800">{w.vietnamese || '—'}</td>
                    <td className="p-4 text-center">
                      <span className="text-[10px] font-black px-2 py-1 rounded-full bg-blue-50 text-blue-600">
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
