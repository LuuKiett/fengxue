'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { stripTones } from '@/lib/utils/pinyin'
import { sortLevels } from '@/lib/utils/dictionaryLevels'
import { fetchAllRows } from '@/lib/utils/supabasePagination'
import Pagination from '@/components/ui/Pagination'
import WordCardList from '@/components/dictionary/WordCardList'
import { Search, BookMarked } from 'lucide-react'

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
        // Paginated (not a plain unbounded select): PostgREST caps any single response
        // at 1000 rows by default, which silently truncated this page once Band B
        // pushed dictionary_words past that.
        const data = await fetchAllRows<DictWord>((from, to) =>
          supabase
            .from('dictionary_words')
            .select('id, band, level, hanzi, pinyin, vietnamese, pos, example_hanzi, example_pinyin, example_vietnamese')
            .order('level', { ascending: true })
            .order('order_index', { ascending: true })
            .range(from, to)
        )
        setWords(data)

        if (data.length > 0) {
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

  // The scrollable area is the dashboard layout's <main>, not the window (it's the
  // overflow-y-auto container in app/(dashboard)/layout.tsx) — so switching pages needs
  // to scroll that element back to top, otherwise the list changes underneath you while
  // you're still scrolled halfway down the previous page.
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

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
          <WordCardList
            startIndex={(page - 1) * PAGE_SIZE}
            words={pageWords.map((w) => ({
              id: w.id,
              hanzi: w.hanzi,
              pinyin: w.pinyin,
              vietnamese: w.vietnamese,
              pos: w.pos,
              level: w.level,
              examples: w.example_hanzi
                ? [{ hanzi: w.example_hanzi, pinyin: w.example_pinyin || '', vietnamese: w.example_vietnamese || '' }]
                : [],
            }))}
          />
        )}
      </div>

      {!loading && filteredWords.length > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  )
}
