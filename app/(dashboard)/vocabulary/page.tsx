'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getTodayString, formatDate } from '@/lib/utils/date'
import { ensureProfile } from '@/lib/utils/ensureProfile'
import { stripTones } from '@/lib/utils/pinyin'
import { segmentPinyin, type ComposedCandidate } from '@/lib/utils/pinyinSegment'
import DatePicker from '@/components/ui/DatePicker'
import {
  Plus,
  Trash2,
  Edit,
  Download,
  Upload,
  Save,
  X,
  FileSpreadsheet,
  AlertCircle
} from 'lucide-react'

interface VocabItem {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
}

export default function VocabularyPage() {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [date, setDate] = useState(getTodayString())
  const [vocabList, setVocabList] = useState<VocabItem[]>([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editItem, setEditItem] = useState<VocabItem | null>(null)

  // Multi-row add form state
  const [newRows, setNewRows] = useState<Omit<VocabItem, 'id'>[]>([
    { hanzi: '', pinyin: '', vietnamese: '' }
  ])

  // Single-row edit form state
  const [editHanzi, setEditHanzi] = useState('')
  const [editPinyin, setEditPinyin] = useState('')
  const [editVietnamese, setEditVietnamese] = useState('')

  // Load vocab for selected date
  const loadVocab = async (targetDate: string) => {
    setLoading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Ensure profile exists (safety net if trigger not yet set up)
      await ensureProfile(supabase)

      // Find the vocabulary set
      const { data: vocabSet } = await supabase
        .from('vocabulary_sets')
        .select('id')
        .eq('user_id', user.id)
        .eq('date', targetDate)
        .single()

      if (!vocabSet) {
        setVocabList([])
        return
      }

      // Fetch all vocab for this set
      const { data: vocabs, error: fetchErr } = await supabase
        .from('vocabularies')
        .select('id, hanzi, pinyin, vietnamese')
        .eq('set_id', vocabSet.id)
        .order('order_index', { ascending: true })

      if (fetchErr) throw fetchErr
      setVocabList(vocabs || [])
    } catch (err: any) {
      console.error(err)
      setError('Không thể tải từ vựng: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadVocab(date)
  }, [date])

  // Auto-hide status messages
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(''), 4000)
      return () => clearTimeout(t)
    }
  }, [success])

  // Helpers for relative date changes
  const shiftDate = (offset: number) => {
    const d = new Date(date)
    d.setDate(d.getDate() + offset)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    setDate(`${year}-${month}-${day}`)
  }

  // CREATE VOCABULARY SET & ITEMS
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionLoading(true)
    setError('')

    const validRows = newRows.filter(r => r.hanzi.trim() && r.pinyin.trim() && r.vietnamese.trim())
    if (validRows.length === 0) {
      setError('Vui lòng điền đầy đủ 3 cột cho ít nhất 1 dòng')
      setActionLoading(false)
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Chưa đăng nhập')

      // Ensure profile exists before writing any FK-dependent data
      const profileOk = await ensureProfile(supabase)
      if (!profileOk) throw new Error('Không thể tạo hồ sơ người dùng. Vui lòng đăng xuất và đăng nhập lại.')

      // 1. Get or create set
      let { data: set } = await supabase
        .from('vocabulary_sets')
        .select('id')
        .eq('user_id', user.id)
        .eq('date', date)
        .single()

      if (!set) {
        const { data: newSet, error: setErr } = await supabase
          .from('vocabulary_sets')
          .insert({ user_id: user.id, date })
          .select('id')
          .single()

        if (setErr) throw setErr
        set = newSet
      }

      // 2. Insert items
      if (set) {
        const startOrder = vocabList.length
        const { error: insertErr } = await supabase
          .from('vocabularies')
          .insert(
            validRows.map((r, i) => ({
              set_id: set!.id,
              hanzi: r.hanzi.trim(),
              pinyin: r.pinyin.trim(),
              vietnamese: r.vietnamese.trim(),
              order_index: startOrder + i
            }))
          )

        if (insertErr) throw insertErr

        setSuccess('Thêm từ vựng thành công! 🎉')
        setIsAddModalOpen(false)
        setNewRows([{ hanzi: '', pinyin: '', vietnamese: '' }])
        loadVocab(date)
      }
    } catch (err: any) {
      console.error(err)
      setError('Lỗi khi thêm từ vựng: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // ── TOCFL Traditional Chinese Autocomplete ──────────────────────────────
  // Loaded once from /tocfl-index.json (14,423 words, pinyin → [{t,p,l}])
  type TocflEntry = { t: string; p: string; l: number | null }
  type SuggestionEntry = TocflEntry | ComposedCandidate
  const tocflIndexRef = useRef<Record<string, TocflEntry[]> | null>(null)
  const tocflLoadingRef = useRef(false)
  // Sorted key list, built once the index loads, so prefix lookups can binary-search
  // instead of linearly scanning all ~85k merged keys on every keystroke.
  const sortedKeysRef = useRef<string[] | null>(null)

  const loadTocflIndex = useCallback(async () => {
    if (tocflIndexRef.current || tocflLoadingRef.current) return
    tocflLoadingRef.current = true
    try {
      const res = await fetch('/tocfl-index.json')
      const idx = await res.json()
      tocflIndexRef.current = idx
      sortedKeysRef.current = Object.keys(idx).sort()
    } catch (e) {
      console.error('Failed to load TOCFL index:', e)
    } finally {
      tocflLoadingRef.current = false
    }
  }, [])

  // Binary-search the sorted key list for the range of keys starting with `prefix`.
  const prefixSearchKeys = (keys: string[], prefix: string): string[] => {
    const lowerBound = (target: string) => {
      let lo = 0, hi = keys.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (keys[mid] < target) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    const start = lowerBound(prefix)
    const end = lowerBound(prefix + '￿')
    return keys.slice(start, end)
  }

  // Active suggestions per row: { rowIndex: SuggestionEntry[] }
  const [suggestions, setSuggestions] = useState<{ [rowIndex: number]: SuggestionEntry[] }>({})
  // What's currently being typed in the pinyin box per row — kept separate from
  // row.pinyin (which is the accumulated/committed value) so that, like a phone
  // Pinyin keyboard, picking a candidate clears the composing text and lets you
  // keep typing the next character/word instead of finishing the row.
  const [composingBuffer, setComposingBuffer] = useState<{ [rowIndex: number]: string }>({})
  // Debounce timers per row
  const debounceRefs = useRef<{ [rowIndex: number]: ReturnType<typeof setTimeout> }>({})

  // Shifts index-keyed maps down by one after a row is removed, so suggestions/
  // composing state for rows after the removed one stay attached to the right row.
  function reindexAfterRemoval<T>(map: { [rowIndex: number]: T }, removedIndex: number) {
    const next: { [rowIndex: number]: T } = {}
    for (const [key, value] of Object.entries(map)) {
      const k = Number(key)
      if (k === removedIndex) continue
      next[k > removedIndex ? k - 1 : k] = value
    }
    return next
  }

  const addNewRow = () => {
    setNewRows([...newRows, { hanzi: '', pinyin: '', vietnamese: '' }])
  }

  const removeNewRow = (index: number) => {
    if (newRows.length === 1) return
    setNewRows(newRows.filter((_, i) => i !== index))
    setSuggestions(prev => reindexAfterRemoval(prev, index))
    setComposingBuffer(prev => reindexAfterRemoval(prev, index))
    if (debounceRefs.current[index]) clearTimeout(debounceRefs.current[index])
    debounceRefs.current = reindexAfterRemoval(debounceRefs.current, index)
  }

  const updateNewRowField = (index: number, field: 'hanzi' | 'pinyin' | 'vietnamese', value: string) => {
    const updated = [...newRows]
    updated[index][field] = value
    setNewRows(updated)
  }

  // Runs the exact/prefix/composed suggestion lookup against whatever the user is
  // currently typing in a row's composing buffer.
  const lookupSuggestions = (index: number, query: string) => {
    if (debounceRefs.current[index]) clearTimeout(debounceRefs.current[index])

    const normalizedQuery = stripTones(query)
    if (!normalizedQuery) {
      setSuggestions(prev => { const n = { ...prev }; delete n[index]; return n })
      return
    }

    debounceRefs.current[index] = setTimeout(async () => {
      if (!tocflIndexRef.current) await loadTocflIndex()
      const idx = tocflIndexRef.current
      if (!idx) return

      // Exact match first, then prefix match
      let results: TocflEntry[] = idx[normalizedQuery] || []
      if (results.length === 0) {
        // Prefix search via binary search over the sorted key list
        const keys = sortedKeysRef.current ?? Object.keys(idx).sort()
        sortedKeysRef.current = keys
        const matchingKeys = prefixSearchKeys(keys, normalizedQuery).filter(k => k !== normalizedQuery)
        results = matchingKeys
          .sort((a, b) => (idx[a][0]?.l ?? 99) - (idx[b][0]?.l ?? 99))
          .flatMap(k => idx[k])
          .slice(0, 8)
      }

      // IME-style composition fallback: when the typed pinyin spans more than one
      // dictionary word (e.g. typing several characters continuously without spaces,
      // like "nihaoma" for 你好嗎), decompose it into known segments and pin the
      // composed multi-hanzi result at the top of the list.
      const composed = normalizedQuery.length > 2 ? segmentPinyin(normalizedQuery, idx) : null
      const finalResults: SuggestionEntry[] = composed ? [composed, ...results] : results

      if (finalResults.length > 0) {
        setSuggestions(prev => ({ ...prev, [index]: finalResults }))
      } else {
        setSuggestions(prev => { const n = { ...prev }; delete n[index]; return n })
      }
    }, 150)
  }

  const updateComposingBuffer = (index: number, value: string) => {
    setComposingBuffer(prev => ({ ...prev, [index]: value }))
    lookupSuggestions(index, value)
  }

  // Picking a suggestion appends it to the row's committed hanzi/pinyin and clears
  // the composing buffer — exactly like tapping a candidate on a phone Pinyin
  // keyboard: the word gets committed and you keep typing the next one.
  const selectSuggestion = (rowIndex: number, item: SuggestionEntry) => {
    const updated = [...newRows]
    const current = updated[rowIndex]
    updated[rowIndex] = {
      hanzi: current.hanzi + item.t,
      pinyin: current.pinyin ? `${current.pinyin} ${item.p}` : item.p,
      vietnamese: current.vietnamese,
    }
    setNewRows(updated)

    setComposingBuffer(prev => ({ ...prev, [rowIndex]: '' }))
    setSuggestions(prev => {
      const next = { ...prev }
      delete next[rowIndex]
      return next
    })
  }

  // "1 nghĩa có 2 từ khác nhau": instead of appending to the row being composed,
  // add this candidate as a brand-new row (copying the current Vietnamese meaning),
  // so both variants can be kept side by side without retyping.
  const addSuggestionAsNewRow = (item: SuggestionEntry, vietnamese: string) => {
    setNewRows(prev => [...prev, { hanzi: item.t, pinyin: item.p, vietnamese }])
  }

  const clearComposition = (rowIndex: number) => {
    const updated = [...newRows]
    updated[rowIndex] = { ...updated[rowIndex], hanzi: '', pinyin: '' }
    setNewRows(updated)
    setComposingBuffer(prev => ({ ...prev, [rowIndex]: '' }))
  }

  // EDIT VOCABULARY
  const openEditModal = (item: VocabItem) => {
    setEditItem(item)
    setEditHanzi(item.hanzi)
    setEditPinyin(item.pinyin)
    setEditVietnamese(item.vietnamese)
    setIsEditModalOpen(true)
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editItem) return
    setActionLoading(true)
    setError('')

    if (!editHanzi.trim() || !editPinyin.trim() || !editVietnamese.trim()) {
      setError('Vui lòng nhập đầy đủ các trường')
      setActionLoading(false)
      return
    }

    try {
      const { error: updateErr } = await supabase
        .from('vocabularies')
        .update({
          hanzi: editHanzi.trim(),
          pinyin: editPinyin.trim(),
          vietnamese: editVietnamese.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', editItem.id)

      if (updateErr) throw updateErr

      setSuccess('Cập nhật từ vựng thành công! ✏️')
      setIsEditModalOpen(false)
      setEditItem(null)
      loadVocab(date)
    } catch (err: any) {
      console.error(err)
      setError('Lỗi khi sửa từ vựng: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // DELETE VOCABULARY
  const handleDeleteItem = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa từ vựng này không?')) return
    setActionLoading(true)
    setError('')

    try {
      const { error: delErr } = await supabase
        .from('vocabularies')
        .delete()
        .eq('id', id)

      if (delErr) throw delErr

      setSuccess('Đã xóa từ vựng 🗑️')
      loadVocab(date)
    } catch (err: any) {
      console.error(err)
      setError('Lỗi khi xóa từ vựng: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // EXCEL EXPORT
  const handleExport = () => {
    window.open(`/api/vocabulary/export?date=${date}`, '_blank')
  }

  // EXCEL IMPORT
  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setActionLoading(true)
    setError('')
    setSuccess('')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/vocabulary/import', {
        method: 'POST',
        body: formData
      })
      const result = await res.json()

      if (result.error) {
        setError(result.error)
      } else {
        const dates: { date: string; count: number }[] = result.dates || []
        const breakdown = dates.map(d => `${formatDate(d.date)}: ${d.count} từ`).join(', ')
        setSuccess(`Đã import thành công ${result.importedCount} từ vựng! 🎉${breakdown ? ` (${breakdown})` : ''}`)

        const importedDateStrs = dates.map(d => d.date)
        if (importedDateStrs.length > 0 && !importedDateStrs.includes(date)) {
          // Currently-viewed date has no relation to what was just imported — jump to it
          // so the result is immediately visible instead of looking empty.
          setDate(importedDateStrs[0])
        } else {
          loadVocab(date)
        }
      }
    } catch (err: any) {
      setError('Lỗi khi tải file lên: ' + err.message)
    } finally {
      setActionLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // EXCEL TEMPLATE DOWNLOAD
  const handleDownloadTemplate = () => {
    window.open('/api/vocabulary/template', '_blank')
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
          <span>📖</span> Từ Vựng Hàng Ngày
          <span className="text-[#1877f2] animate-sparkle">✦</span>
        </h2>
      </div>

      {/* Date & Actions Bar */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
        {/* Date Selector */}
        <div className="cartoon-panel p-3 bg-white flex items-center justify-between sm:justify-start gap-2 relative z-30">
          <button onClick={() => shiftDate(-1)} className="cartoon-btn-secondary px-3 py-1.5 text-xs font-black rounded-xl">
            ◀ Trước
          </button>

          <DatePicker value={date} onChange={setDate} />

          <button onClick={() => shiftDate(1)} className="cartoon-btn-secondary px-3 py-1.5 text-xs font-black rounded-xl">
            Sau ▶
          </button>
        </div>

        {/* Buttons Grid/Flex - Fully Responsive */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="cartoon-btn px-4 py-2 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Thêm Từ
          </button>
          <button
            onClick={handleExport}
            disabled={vocabList.length === 0}
            className="cartoon-btn-secondary px-4 py-2 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Xuất Excel
          </button>
          <button
            onClick={handleImportClick}
            className="cartoon-btn-accent px-4 py-2 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <Upload className="w-4 h-4" /> Nhập Excel
          </button>
          <button
            onClick={handleDownloadTemplate}
            className="cartoon-btn-secondary px-4 py-2 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4" /> File Mẫu
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xlsx, .xls"
            className="hidden"
          />
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 p-4 rounded-2xl font-bold flex items-center gap-2 animate-shake">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-2xl font-bold">
          {success}
        </div>
      )}

      {/* Main List */}
      <div className="cartoon-card bg-white overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="font-bold text-slate-500">Đang tải danh sách từ vựng...</p>
          </div>
        ) : vocabList.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <span className="text-6xl animate-float inline-block">🐼</span>
            <h3 className="text-xl font-extrabold text-slate-700">Chưa có từ vựng nào cho ngày này!</h3>
            <p className="text-slate-500 max-w-sm mx-auto font-semibold">
              Nhấp vào nút <span className="text-blue-500 font-bold">Thêm Từ Vựng</span> ở trên để bắt đầu thêm từ mới của riêng bạn hoặc nhập file Excel mẫu.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse md:text-nowrap">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="p-4 font-black text-slate-700 text-sm">#</th>
                  <th className="p-4 font-black text-slate-700 text-sm">Chữ Hoa (Hanzi)</th>
                  <th className="p-4 font-black text-slate-700 text-sm">Pinyin</th>
                  <th className="p-4 font-black text-slate-700 text-sm">Nghĩa Tiếng Việt</th>
                  <th className="p-4 font-black text-slate-700 text-sm text-center">Hành Động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                {vocabList.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="p-4 font-bold text-slate-400">{index + 1}</td>
                    <td className="p-4 font-chinese text-2xl font-bold text-slate-900">{item.hanzi}</td>
                    <td className="p-4 text-blue-600 font-bold">{item.pinyin}</td>
                    <td className="p-4 text-slate-800">{item.vietnamese}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEditModal(item)}
                          className="p-2 border border-slate-200 rounded-xl hover:bg-amber-50 text-amber-600 transition-all active:translate-y-0.5"
                          title="Sửa từ"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="p-2 border border-slate-200 rounded-xl hover:bg-red-50 text-red-600 transition-all active:translate-y-0.5"
                          title="Xóa từ"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MULTI-ROW ADD MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 py-8 overflow-y-auto">
          <div className="cartoon-panel bg-white w-full md:max-w-5xl p-6 relative flex flex-col min-h-[90vh] overflow-y-auto max-h-[90vh]">
            <button
              onClick={() => setIsAddModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 border border-slate-200 rounded-xl hover:bg-slate-50"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-extrabold text-slate-800 mb-4 flex items-center gap-2">
              <span>➕</span> Thêm Từ Vựng ({formatDate(date)})
            </h3>

            <form onSubmit={handleAddSubmit} className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 mb-4" style={{ overflowX: 'visible' }}>
                {newRows.map((row, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-slate-50 p-3 rounded-2xl border border-dashed border-slate-200">

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 w-full relative">
                      {/* Hanzi Input */}
                      <div className="flex flex-col">
                        <input
                          type="text"
                          placeholder="Chữ Hoa (Hán tự)"
                          value={row.hanzi}
                          onChange={(e) => updateNewRowField(idx, 'hanzi', e.target.value)}
                          className="px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-chinese font-bold text-2xl bg-white"
                        />
                      </div>

                      {/* Pinyin Input + TOCFL Dropdown suggestion (phone-IME style composing) */}
                      <div className="flex flex-col" style={{ position: 'relative' }}>
                        <input
                          type="text"
                          placeholder="Pinyin (gõ không dấu: ni, hao...)"
                          value={composingBuffer[idx] || ''}
                          onFocus={() => loadTocflIndex()}
                          onChange={(e) => updateComposingBuffer(idx, e.target.value)}
                          className="px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold text-md bg-white"
                        />
                        {row.hanzi && (
                          <div className="flex items-center gap-1.5 mt-1 px-0.5">
                            <span className="text-[10px] font-bold text-slate-400 truncate">
                              Đã ghép: <span className="font-chinese text-slate-600">{row.hanzi}</span> ({row.pinyin})
                            </span>
                            <button
                              type="button"
                              onClick={() => clearComposition(idx)}
                              className="text-[10px] font-black text-red-400 hover:text-red-600 flex-shrink-0"
                            >
                              Xóa
                            </button>
                          </div>
                        )}
                        {/* Autocomplete Suggestion Panel — floats above everything */}
                        {suggestions[idx] && suggestions[idx].length > 0 && (
                          <div
                            className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-1.5 space-y-0.5 max-h-52 overflow-y-auto"
                            style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20000 }}
                          >
                            <div className="flex items-center gap-1.5 px-2 py-1">
                              <span className="text-[9px] font-black text-blue-500 uppercase tracking-wider">⌨️ TOCFL 繁體 — {suggestions[idx].length} gợi ý</span>
                            </div>
                            {suggestions[idx].map((item, sugIdx) => (
                              <div
                                key={sugIdx}
                                className="w-full flex items-center gap-1.5 hover:bg-blue-50 rounded-xl transition-colors"
                              >
                                <button
                                  type="button"
                                  onMouseDown={(e) => { e.preventDefault(); selectSuggestion(idx, item) }}
                                  className="flex-1 text-left px-2.5 py-2 flex items-center gap-3"
                                  title="Ghép vào từ đang gõ"
                                >
                                  <span className="font-chinese text-lg text-blue-600 font-bold min-w-[2rem]">{item.t}</span>
                                  <span className="text-slate-500 font-semibold text-xs flex-1">{item.p}</span>
                                  {'composed' in item ? (
                                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 bg-purple-100 text-purple-700">Ghép từ</span>
                                  ) : item.l === null ? (
                                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 bg-slate-100 text-slate-500">詞典</span>
                                  ) : (
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${item.l <= 2 ? 'bg-green-100 text-green-700' :
                                      item.l <= 4 ? 'bg-amber-100 text-amber-700' :
                                        'bg-red-100 text-red-700'
                                      }`}>L{item.l}</span>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onMouseDown={(e) => { e.preventDefault(); addSuggestionAsNewRow(item, row.vietnamese) }}
                                  className="px-2 py-2 mr-1 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-100 flex-shrink-0 font-black text-sm"
                                  title="Thêm thành dòng riêng (cùng nghĩa, từ khác)"
                                >
                                  +
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Vietnamese Input */}
                      <div className="flex flex-col">
                        <input
                          type="text"
                          placeholder="Nghĩa Tiếng Việt"
                          value={row.vietnamese}
                          onChange={(e) => updateNewRowField(idx, 'vietnamese', e.target.value)}
                          className="px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold text-sm bg-white"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeNewRow(idx)}
                      disabled={newRows.length === 1}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-xl disabled:opacity-30 border border-transparent hover:border-red-100 flex-shrink-0"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center border-t border-slate-100 pt-4 bg-white">
                <button
                  type="button"
                  onClick={addNewRow}
                  className="cartoon-btn cartoon-btn-secondary px-4 py-2 text-sm flex items-center gap-2"
                >
                  + Thêm Dòng
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="cartoon-btn cartoon-btn-secondary px-4 py-2 text-sm"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="cartoon-btn px-5 py-2 text-sm flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" /> {actionLoading ? 'Đang lưu...' : 'Lưu Lại'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SINGLE-ROW EDIT MODAL */}
      {isEditModalOpen && editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="cartoon-panel bg-white w-full max-w-md p-6 relative">
            <button
              onClick={() => setIsEditModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 border border-slate-200 rounded-xl hover:bg-slate-50"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-extrabold text-slate-800 mb-4 flex items-center gap-2">
              <span>✏️</span> Sửa Từ Vựng
            </h3>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Chữ Hoa (Hanzi)</label>
                <input
                  type="text"
                  value={editHanzi}
                  onChange={(e) => setEditHanzi(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-chinese font-bold text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Pinyin</label>
                <input
                  type="text"
                  value={editPinyin}
                  onChange={(e) => setEditPinyin(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Tiếng Việt</label>
                <input
                  type="text"
                  value={editVietnamese}
                  onChange={(e) => setEditVietnamese(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="cartoon-btn cartoon-btn-secondary px-4 py-2 text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="cartoon-btn px-5 py-2 text-sm flex items-center gap-2"
                >
                  <Save className="w-4 h-4" /> {actionLoading ? 'Đang lưu...' : 'Cập Nhật'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
