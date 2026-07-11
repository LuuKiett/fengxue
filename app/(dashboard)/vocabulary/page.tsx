'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getTodayString, formatDate } from '@/lib/utils/date'
import { ensureProfile } from '@/lib/utils/ensureProfile'
import { pinyin } from 'pinyin-pro'
import { stripTones } from '@/lib/utils/pinyin'
import { segmentPinyin, type ComposedCandidate } from '@/lib/utils/pinyinSegment'
import DatePicker from '@/components/ui/DatePicker'
import { speak } from '@/lib/utils/speak'
import {
  Plus,
  Trash2,
  Edit,
  Download,
  Upload,
  Save,
  X,
  FileSpreadsheet,
  AlertCircle,
  Volume2,
  BookOpen,
  Layers
} from 'lucide-react'

type VocabSource = 'study' | 'practice'

interface VocabItem {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
  source: VocabSource
  example_hanzi?: string | null
  example_pinyin?: string | null
  example_vietnamese?: string | null
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

  // Navtab: which source category is currently being browsed/added to
  const [activeTab, setActiveTab] = useState<VocabSource>('study')
  const filteredVocabList = vocabList.filter(v => v.source === activeTab)
  const studyCount = vocabList.filter(v => v.source === 'study').length
  const practiceCount = vocabList.filter(v => v.source === 'practice').length

  // Modals state
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editItem, setEditItem] = useState<VocabItem | null>(null)
  // Import date picker — defaults to whatever date is currently selected on the page,
  // so importing "just works" for the common case, but is still overridable via the
  // calendar before you pick a file.
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [importDate, setImportDate] = useState(date)
  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false)

  // Multi-row add form state — source comes from the category modal (pendingSource),
  // not the row form. Each row can optionally carry a hand-typed example sentence
  // (shown/hidden via showExample); when present it's saved with example_source
  // 'manual' and skips AI generation. Rows without one get an AI-generated example
  // (example_source 'ai') fired after insert.
  const [newRows, setNewRows] = useState<{
    hanzi: string
    pinyin: string
    vietnamese: string
    showExample: boolean
    exampleHanzi: string
    examplePinyin: string
    exampleVietnamese: string
  }[]>([
    { hanzi: '', pinyin: '', vietnamese: '', showExample: false, exampleHanzi: '', examplePinyin: '', exampleVietnamese: '' }
  ])
  // Which source category the "Thêm Từ" button is currently adding into — chosen via
  // the category-select modal that opens before the actual add-word modal.
  const [pendingSource, setPendingSource] = useState<VocabSource>('study')

  // Single-row edit form state
  const [editHanzi, setEditHanzi] = useState('')
  const [editPinyin, setEditPinyin] = useState('')
  const [editVietnamese, setEditVietnamese] = useState('')
  const [editExampleHanzi, setEditExampleHanzi] = useState('')
  const [editExamplePinyin, setEditExamplePinyin] = useState('')
  const [editExampleVietnamese, setEditExampleVietnamese] = useState('')
  const [editExampleComposingBuffer, setEditExampleComposingBuffer] = useState('')
  const [editExampleSuggestions, setEditExampleSuggestions] = useState<SuggestionEntry[]>([])
  const editExampleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

      // Fetch all vocab for this set (both source categories — the navtabs filter
      // client-side so switching tabs doesn't need a re-fetch)
      const { data: vocabs, error: fetchErr } = await supabase
        .from('vocabularies')
        .select('id, hanzi, pinyin, vietnamese, source, example_hanzi, example_pinyin, example_vietnamese')
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

  // Asks the AI example-sentence endpoint to generate & save an example for one word.
  // Best-effort: swallows errors since a failed generation shouldn't surface to the
  // user or block adding vocabulary (the Flashcard/review pages just show no example).
  // generation will be handled periodically by server-side processor (process-new)

  // CREATE VOCABULARY SET & ITEMS
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionLoading(true)
    setError('')

    const validRows = newRows.map((r, idx) => {
      const hanzi = r.hanzi.trim()
      const derived = derivedPinyinByRow[idx]?.trim() || ''
      const rowPinyin = r.pinyin.trim() || derived || (hanzi ? pinyin(hanzi, { toneType: 'symbol', type: 'string', separator: ' ' }) : '')
      return {
        ...r,
        hanzi,
        pinyin: rowPinyin,
        vietnamese: r.vietnamese.trim()
      }
    }).filter(r => r.hanzi && r.pinyin && r.vietnamese)

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

      // 2. Insert items into the category chosen in the category-select modal. A row
      // only counts as having a manual example when all 3 example fields are filled in
      // (a partial example isn't usable on Flashcard, so it's treated as none).
      if (set) {
        const startOrder = vocabList.length
        const { data: inserted, error: insertErr } = await supabase
          .from('vocabularies')
          .insert(
            validRows.map((r, i) => {
              const hasManualExample = Boolean(
                r.exampleHanzi.trim() && r.examplePinyin.trim() && r.exampleVietnamese.trim()
              )
              return {
                set_id: set!.id,
                hanzi: r.hanzi,
                pinyin: r.pinyin,
                vietnamese: r.vietnamese,
                order_index: startOrder + i,
                source: pendingSource,
                example_hanzi: hasManualExample ? r.exampleHanzi.trim() : null,
                example_pinyin: hasManualExample ? r.examplePinyin.trim() : null,
                example_vietnamese: hasManualExample ? r.exampleVietnamese.trim() : null,
                example_source: hasManualExample ? 'manual' : null
              }
            })
          )
          .select('id, example_source')

        if (insertErr) throw insertErr

        setSuccess('Thêm từ vựng thành công! 🎉')
        setIsAddModalOpen(false)
        setNewRows([{ hanzi: '', pinyin: '', vietnamese: '', showExample: false, exampleHanzi: '', examplePinyin: '', exampleVietnamese: '' }])
        setDerivedPinyinByRow({})
        setDerivedExamplePinyinByRow({})
        setActiveTab(pendingSource)
        loadVocab(date)

        // Fire-and-forget: ask the AI to draft an example sentence for each new word
        // that doesn't already have a manual one. Not awaited — word creation
        // shouldn't block on it, and results land silently via a background DB update
        // that /learn and /review pick up next time they load.
        // Examples will be generated by the periodic server-side job (after ~5 minutes)
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
  // Derived pinyin committed from selected suggestions so the row keeps the pinyin
  // based on the hanzi choices instead of duplicating the raw input + selected value.
  const [derivedPinyinByRow, setDerivedPinyinByRow] = useState<{ [rowIndex: number]: string }>({})
  // Debounce timers per row
  const debounceRefs = useRef<{ [rowIndex: number]: ReturnType<typeof setTimeout> }>({})

  // Same TOCFL suggestion engine as above, but for the per-row "Thêm ví dụ" example
  // sentence composer — a sentence is just several picks appended one after another,
  // same as composing a multi-character word.
  const [exampleSuggestions, setExampleSuggestions] = useState<{ [rowIndex: number]: SuggestionEntry[] }>({})
  const [exampleComposingBuffer, setExampleComposingBuffer] = useState<{ [rowIndex: number]: string }>({})
  // Derived example pinyin committed from selected suggestions — same purpose as
  // derivedPinyinByRow above, so picking a candidate replaces the raw typed text
  // instead of appending accented pinyin after it (e.g. "ni" + picking 你 → "nǐ",
  // not "ni nǐ").
  const [derivedExamplePinyinByRow, setDerivedExamplePinyinByRow] = useState<{ [rowIndex: number]: string }>({})
  const exampleDebounceRefs = useRef<{ [rowIndex: number]: ReturnType<typeof setTimeout> }>({})

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

  const generatePinyinForRow = (index: number) => {
    const row = newRows[index]
    if (!row.hanzi.trim()) return
    const generated = pinyin(row.hanzi.trim(), { toneType: 'symbol', type: 'string', separator: ' ' })
    const updated = [...newRows]
    updated[index] = {
      ...updated[index],
      pinyin: generated
    }
    setNewRows(updated)
    setDerivedPinyinByRow(prev => ({ ...prev, [index]: generated }))
    setComposingBuffer(prev => ({ ...prev, [index]: generated }))
  }

  // Same auto-pinyin-from-hanzi shortcut as generatePinyinForRow above, just for the
  // "Thêm ví dụ" example sentence fields instead of the main word fields.
  const generateExamplePinyinForRow = (index: number) => {
    const row = newRows[index]
    if (!row.exampleHanzi.trim()) return
    const generated = pinyin(row.exampleHanzi.trim(), { toneType: 'symbol', type: 'string', separator: ' ' })
    const updated = [...newRows]
    updated[index] = {
      ...updated[index],
      examplePinyin: generated
    }
    setNewRows(updated)
    setDerivedExamplePinyinByRow(prev => ({ ...prev, [index]: generated }))
    setExampleComposingBuffer(prev => ({ ...prev, [index]: generated }))
  }

  const addNewRow = () => {
    setNewRows([...newRows, { hanzi: '', pinyin: '', vietnamese: '', showExample: false, exampleHanzi: '', examplePinyin: '', exampleVietnamese: '' }])
  }

  const removeNewRow = (index: number) => {
    if (newRows.length === 1) return
    setNewRows(newRows.filter((_, i) => i !== index))
    setSuggestions(prev => reindexAfterRemoval(prev, index))
    setComposingBuffer(prev => reindexAfterRemoval(prev, index))
    setDerivedPinyinByRow(prev => reindexAfterRemoval(prev, index))
    if (debounceRefs.current[index]) clearTimeout(debounceRefs.current[index])
    debounceRefs.current = reindexAfterRemoval(debounceRefs.current, index)
    setExampleSuggestions(prev => reindexAfterRemoval(prev, index))
    setExampleComposingBuffer(prev => reindexAfterRemoval(prev, index))
    setDerivedExamplePinyinByRow(prev => reindexAfterRemoval(prev, index))
    if (exampleDebounceRefs.current[index]) clearTimeout(exampleDebounceRefs.current[index])
    exampleDebounceRefs.current = reindexAfterRemoval(exampleDebounceRefs.current, index)
  }

  const updateNewRowField = (index: number, field: 'hanzi' | 'pinyin' | 'vietnamese', value: string) => {
    const updated = [...newRows]
    const current = updated[index]
    const trimmedValue = value.trim()

    if (field === 'hanzi') {
      const fallbackPinyin = trimmedValue ? pinyin(trimmedValue, { toneType: 'symbol', type: 'string', separator: ' ' }) : ''
      updated[index] = {
        ...current,
        hanzi: value,
        pinyin: current.pinyin.trim() ? current.pinyin : fallbackPinyin,
      }
      setNewRows(updated)

      if (trimmedValue) {
        setDerivedPinyinByRow(prev => ({ ...prev, [index]: fallbackPinyin }))
      } else {
        setDerivedPinyinByRow(prev => {
          const next = { ...prev }
          delete next[index]
          return next
        })
      }
      return
    }

    updated[index][field] = value
    setNewRows(updated)

    if (field === 'pinyin') {
      setComposingBuffer(prev => ({ ...prev, [index]: value }))
      lookupSuggestions(index, value)
      if (trimmedValue === '') {
        setDerivedPinyinByRow(prev => {
          const next = { ...prev }
          delete next[index]
          return next
        })
      }
    }
  }

  // Toggles the manual example sub-section open/closed for one row of the add form.
  const toggleRowExample = (index: number) => {
    const updated = [...newRows]
    updated[index] = { ...updated[index], showExample: !updated[index].showExample }
    setNewRows(updated)
  }

  const updateNewRowExampleField = (
    index: number,
    field: 'exampleHanzi' | 'examplePinyin' | 'exampleVietnamese',
    value: string
  ) => {
    const updated = [...newRows]
    updated[index] = { ...updated[index], [field]: value }
    setNewRows(updated)

    if (field === 'examplePinyin') {
      setExampleComposingBuffer(prev => ({ ...prev, [index]: value }))
      lookupExampleSuggestions(index, value)
    }
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
    setNewRows(prev => {
      const next = [...prev]
      next[index] = { ...next[index], pinyin: value }
      return next
    })
    if (value.trim() === '') {
      setDerivedPinyinByRow(prev => {
        const next = { ...prev }
        delete next[index]
        return next
      })
    }
    lookupSuggestions(index, value)
  }

  // Picking a suggestion appends it to the row's committed hanzi/pinyin and clears
  // the composing buffer — exactly like tapping a candidate on a phone Pinyin
  // keyboard: the word gets committed and you keep typing the next one.
  const selectSuggestion = (rowIndex: number, item: SuggestionEntry) => {
    const updated = [...newRows]
    const current = updated[rowIndex]
    const existingDerivedPinyin = derivedPinyinByRow[rowIndex]?.trim() ?? ''
    const nextDerivedPinyin = existingDerivedPinyin ? `${existingDerivedPinyin} ${item.p}` : item.p

    updated[rowIndex] = {
      ...current,
      hanzi: current.hanzi + item.t,
      pinyin: nextDerivedPinyin,
    }
    setNewRows(updated)
    setDerivedPinyinByRow(prev => ({ ...prev, [rowIndex]: nextDerivedPinyin }))

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
    setNewRows(prev => [...prev, { hanzi: item.t, pinyin: item.p, vietnamese, showExample: false, exampleHanzi: '', examplePinyin: '', exampleVietnamese: '' }])
  }

  const clearComposition = (rowIndex: number) => {
    const updated = [...newRows]
    updated[rowIndex] = { ...updated[rowIndex], hanzi: '', pinyin: '' }
    setNewRows(updated)
    setComposingBuffer(prev => ({ ...prev, [rowIndex]: '' }))
    setDerivedPinyinByRow(prev => {
      const next = { ...prev }
      delete next[rowIndex]
      return next
    })
  }

  // ── "Thêm ví dụ" pinyin autocomplete — same TOCFL suggestion engine as the word
  // fields above, just writing into exampleHanzi/examplePinyin instead of hanzi/pinyin
  // so a whole example sentence can be composed pick-by-pick the same way a word is.
  const lookupExampleSuggestions = (index: number, query: string) => {
    if (exampleDebounceRefs.current[index]) clearTimeout(exampleDebounceRefs.current[index])

    const normalizedQuery = stripTones(query)
    if (!normalizedQuery) {
      setExampleSuggestions(prev => { const n = { ...prev }; delete n[index]; return n })
      return
    }

    exampleDebounceRefs.current[index] = setTimeout(async () => {
      if (!tocflIndexRef.current) await loadTocflIndex()
      const idx = tocflIndexRef.current
      if (!idx) return

      let results: TocflEntry[] = idx[normalizedQuery] || []
      if (results.length === 0) {
        const keys = sortedKeysRef.current ?? Object.keys(idx).sort()
        sortedKeysRef.current = keys
        const matchingKeys = prefixSearchKeys(keys, normalizedQuery).filter(k => k !== normalizedQuery)
        results = matchingKeys
          .sort((a, b) => (idx[a][0]?.l ?? 99) - (idx[b][0]?.l ?? 99))
          .flatMap(k => idx[k])
          .slice(0, 8)
      }

      const composed = normalizedQuery.length > 2 ? segmentPinyin(normalizedQuery, idx) : null
      const finalResults: SuggestionEntry[] = composed ? [composed, ...results] : results

      if (finalResults.length > 0) {
        setExampleSuggestions(prev => ({ ...prev, [index]: finalResults }))
      } else {
        setExampleSuggestions(prev => { const n = { ...prev }; delete n[index]; return n })
      }
    }, 150)
  }

  const updateExampleComposingBuffer = (index: number, value: string) => {
    setExampleComposingBuffer(prev => ({ ...prev, [index]: value }))
    setNewRows(prev => {
      const next = [...prev]
      next[index] = { ...next[index], examplePinyin: value }
      return next
    })
    if (value.trim() === '') {
      setDerivedExamplePinyinByRow(prev => {
        const next = { ...prev }
        delete next[index]
        return next
      })
    }
    lookupExampleSuggestions(index, value)
  }

  const selectExampleSuggestion = (rowIndex: number, item: SuggestionEntry) => {
    const updated = [...newRows]
    const current = updated[rowIndex]
    const existingDerivedPinyin = derivedExamplePinyinByRow[rowIndex]?.trim() ?? ''
    const nextDerivedPinyin = existingDerivedPinyin ? `${existingDerivedPinyin} ${item.p}` : item.p

    updated[rowIndex] = {
      ...current,
      exampleHanzi: current.exampleHanzi + item.t,
      examplePinyin: nextDerivedPinyin,
    }
    setNewRows(updated)
    setDerivedExamplePinyinByRow(prev => ({ ...prev, [rowIndex]: nextDerivedPinyin }))

    setExampleComposingBuffer(prev => ({ ...prev, [rowIndex]: '' }))
    setExampleSuggestions(prev => {
      const next = { ...prev }
      delete next[rowIndex]
      return next
    })
  }

  const clearExampleComposition = (rowIndex: number) => {
    const updated = [...newRows]
    updated[rowIndex] = { ...updated[rowIndex], exampleHanzi: '', examplePinyin: '' }
    setNewRows(updated)
    setExampleComposingBuffer(prev => ({ ...prev, [rowIndex]: '' }))
    setDerivedExamplePinyinByRow(prev => {
      const next = { ...prev }
      delete next[rowIndex]
      return next
    })
  }

  // ── Edit-modal pinyin autocomplete — same TOCFL suggestion engine as the Add form
  // (loadTocflIndex/prefixSearchKeys/segmentPinyin above), just single-row since the
  // edit modal only ever edits one word at a time instead of an array of rows.
  const [editComposingBuffer, setEditComposingBuffer] = useState('')
  const [editSuggestions, setEditSuggestions] = useState<SuggestionEntry[]>([])
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lookupEditSuggestions = (query: string) => {
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current)

    const normalizedQuery = stripTones(query)
    if (!normalizedQuery) {
      setEditSuggestions([])
      return
    }

    editDebounceRef.current = setTimeout(async () => {
      if (!tocflIndexRef.current) await loadTocflIndex()
      const idx = tocflIndexRef.current
      if (!idx) return

      let results: TocflEntry[] = idx[normalizedQuery] || []
      if (results.length === 0) {
        const keys = sortedKeysRef.current ?? Object.keys(idx).sort()
        sortedKeysRef.current = keys
        const matchingKeys = prefixSearchKeys(keys, normalizedQuery).filter(k => k !== normalizedQuery)
        results = matchingKeys
          .sort((a, b) => (idx[a][0]?.l ?? 99) - (idx[b][0]?.l ?? 99))
          .flatMap(k => idx[k])
          .slice(0, 8)
      }

      const composed = normalizedQuery.length > 2 ? segmentPinyin(normalizedQuery, idx) : null
      const finalResults: SuggestionEntry[] = composed ? [composed, ...results] : results
      setEditSuggestions(finalResults)
    }, 150)
  }

  const updateEditComposingBuffer = (value: string) => {
    setEditComposingBuffer(value)
    setEditPinyin(value)
    lookupEditSuggestions(value)
  }

  const selectEditSuggestion = (item: SuggestionEntry) => {
    setEditHanzi(prev => prev + item.t)
    setEditPinyin(prev => (prev ? `${prev} ${item.p}` : item.p))
    setEditComposingBuffer('')
    setEditSuggestions([])
  }

  const clearEditComposition = () => {
    setEditHanzi('')
    setEditPinyin('')
    setEditComposingBuffer('')
  }

  const generateEditPinyin = () => {
    if (!editHanzi.trim()) return
    const generated = pinyin(editHanzi.trim(), { toneType: 'symbol', type: 'string', separator: ' ' })
    setEditPinyin(generated)
    setEditComposingBuffer(generated)
  }

  const lookupEditExampleSuggestions = (query: string) => {
    if (editExampleDebounceRef.current) clearTimeout(editExampleDebounceRef.current)

    const normalizedQuery = stripTones(query)
    if (!normalizedQuery) {
      setEditExampleSuggestions([])
      return
    }

    editExampleDebounceRef.current = setTimeout(async () => {
      if (!tocflIndexRef.current) await loadTocflIndex()
      const idx = tocflIndexRef.current
      if (!idx) return

      let results: TocflEntry[] = idx[normalizedQuery] || []
      if (results.length === 0) {
        const keys = sortedKeysRef.current ?? Object.keys(idx).sort()
        sortedKeysRef.current = keys
        const matchingKeys = prefixSearchKeys(keys, normalizedQuery).filter(k => k !== normalizedQuery)
        results = matchingKeys
          .sort((a, b) => (idx[a][0]?.l ?? 99) - (idx[b][0]?.l ?? 99))
          .flatMap(k => idx[k])
          .slice(0, 8)
      }

      const composed = normalizedQuery.length > 2 ? segmentPinyin(normalizedQuery, idx) : null
      const finalResults: SuggestionEntry[] = composed ? [composed, ...results] : results
      setEditExampleSuggestions(finalResults)
    }, 150)
  }

  const updateEditExampleComposingBuffer = (value: string) => {
    setEditExampleComposingBuffer(value)
    setEditExamplePinyin(value)
    lookupEditExampleSuggestions(value)
  }

  const selectEditExampleSuggestion = (item: SuggestionEntry) => {
    setEditExampleHanzi(prev => prev + item.t)
    setEditExamplePinyin(prev => (prev ? `${prev} ${item.p}` : item.p))
    setEditExampleComposingBuffer('')
    setEditExampleSuggestions([])
  }

  const clearEditExampleComposition = () => {
    setEditExampleHanzi('')
    setEditExamplePinyin('')
    setEditExampleComposingBuffer('')
  }

  // EDIT VOCABULARY
  const openEditModal = (item: VocabItem) => {
    setEditItem(item)
    setEditHanzi(item.hanzi)
    setEditPinyin(item.pinyin)
    setEditVietnamese(item.vietnamese)
    setEditExampleHanzi(item.example_hanzi ?? '')
    setEditExamplePinyin(item.example_pinyin ?? '')
    setEditExampleVietnamese(item.example_vietnamese ?? '')
    setEditExampleComposingBuffer('')
    setEditExampleSuggestions([])
    setEditComposingBuffer('')
    setEditSuggestions([])
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

    const hasManualExample = Boolean(
      editExampleHanzi.trim() && editExamplePinyin.trim() && editExampleVietnamese.trim()
    )

    try {
      const { error: updateErr } = await supabase
        .from('vocabularies')
        .update({
          hanzi: editHanzi.trim(),
          pinyin: editPinyin.trim(),
          vietnamese: editVietnamese.trim(),
          example_hanzi: hasManualExample ? editExampleHanzi.trim() : null,
          example_pinyin: hasManualExample ? editExamplePinyin.trim() : null,
          example_vietnamese: hasManualExample ? editExampleVietnamese.trim() : null,
          example_source: hasManualExample ? 'manual' : null,
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

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  const toggleSelectAll = () => {
    const ids = filteredVocabList.map(v => v.id)
    const allSelected = ids.length > 0 && ids.every(id => selectedIds.includes(id))
    setSelectedIds(allSelected ? [] : ids)
  }

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.length === 0) return
    setActionLoading(true)
    setError('')
    try {
      const { error: delErr } = await supabase
        .from('vocabularies')
        .delete()
        .in('id', selectedIds)

      if (delErr) throw delErr

      setSuccess(`Đã xóa ${selectedIds.length} từ vựng 🗑️`)
      setSelectedIds([])
      setIsBulkDeleteModalOpen(false)
      loadVocab(date)
    } catch (err: any) {
      console.error(err)
      setError('Lỗi khi xóa từ vựng: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // EXCEL IMPORT — opens a date-picker modal (defaulting to the currently-viewed date)
  // before the file dialog, so every row in the file lands on exactly the date you mean
  // instead of having to name Excel sheet tabs "YYYY-MM-DD" to control the target date.
  const handleImportClick = () => {
    setImportDate(date)
    setIsImportModalOpen(true)
  }

  const handleImportPickFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsImportModalOpen(false)
    setActionLoading(true)
    setError('')
    setSuccess('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('date', importDate)

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
        const matchedNote = result.matchedCount > 0 ? ` — ${result.matchedCount} từ lấy được câu ví dụ chuẩn từ từ điển 📖` : ''
        setSuccess(`Đã import thành công ${result.importedCount} từ vựng! 🎉${breakdown ? ` (${breakdown})` : ''}${matchedNote}`)

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
            onClick={() => setIsCategoryModalOpen(true)}
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
          <button
            onClick={() => setIsBulkDeleteModalOpen(true)}
            disabled={selectedIds.length === 0}
            className="cartoon-btn-secondary px-4 py-2 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
            title="Xóa các từ đã chọn"
          >
            <Trash2 className="w-4 h-4 text-red-600" /> Xóa đã chọn
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

      {/* Navtabs: Từ vựng tự học vs Từ vựng khác, each with a live word count */}
      <div className="cartoon-panel p-1.5 bg-white flex items-center gap-1.5 w-fit">
        <button
          onClick={() => setActiveTab('study')}
          className={`px-4 py-2 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition-all ${
            activeTab === 'study' ? 'bg-[#1877f2] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Từ Vựng Tự Học
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${activeTab === 'study' ? 'bg-white/25' : 'bg-slate-100'}`}>
            {studyCount}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('practice')}
          className={`px-4 py-2 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition-all ${
            activeTab === 'practice' ? 'bg-[#1877f2] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Layers className="w-4 h-4" /> Từ Vựng Khác
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${activeTab === 'practice' ? 'bg-white/25' : 'bg-slate-100'}`}>
            {practiceCount}
          </span>
        </button>
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
        ) : filteredVocabList.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <span className="text-6xl animate-float inline-block">🐼</span>
            <h3 className="text-xl font-extrabold text-slate-700">
              {activeTab === 'study' ? 'Chưa có từ vựng tự học nào cho ngày này!' : 'Chưa có từ vựng khác nào cho ngày này!'}
            </h3>
            <p className="text-slate-500 max-w-sm mx-auto font-semibold">
              Nhấp vào nút <span className="text-blue-500 font-bold">Thêm Từ</span> ở trên để bắt đầu thêm từ mới của riêng bạn hoặc nhập file Excel mẫu.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-nowrap">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="p-4 font-black text-slate-700 text-sm">
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={filteredVocabList.length > 0 && filteredVocabList.every(v => selectedIds.includes(v.id))}
                      className="w-4 h-4"
                    />
                  </th>
                  <th className="p-4 font-black text-slate-700 text-sm">#</th>
                  <th className="p-4 font-black text-slate-700 text-sm">Chữ Hoa (Hanzi)</th>
                  <th className="p-4 font-black text-slate-700 text-sm hidden md:table-cell">Pinyin</th>
                  <th className="p-4 font-black text-slate-700 text-sm hidden md:table-cell">Nghĩa Tiếng Việt</th>
                  <th className="p-4 font-black text-slate-700 text-sm">Ví Dụ</th>
                  <th className="p-4 font-black text-slate-700 text-sm text-center">Hành Động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                {filteredVocabList.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="p-4 font-bold text-slate-400">{index + 1}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-chinese text-3xl font-bold text-slate-900">{item.hanzi}</span>
                        <button
                          onClick={() => speak(item.hanzi)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                          title="Phát âm"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="md:hidden">
                        <div className="text-blue-600 font-bold">{item.pinyin}</div>
                        <span className="text-green-500 block">{item.vietnamese || '—'}</span>
                      </div>
                    </td>
                    <td className="p-4 text-blue-600 font-bold hidden md:table-cell">{item.pinyin}</td>
                    <td className="p-4 text-slate-800 hidden md:table-cell">{item.vietnamese}</td>
                    <td className="p-4 min-w-[240px]">
                      {item.example_hanzi ? (
                        <div className="flex items-start gap-1.5">
                          <div className="space-y-1">
                            <p className="font-chinese font-bold text-2xl text-slate-800 leading-snug">{item.example_hanzi}</p>
                            <p className="text-sm text-blue-500 italic">{item.example_pinyin}</p>
                            <p className="text-sm text-slate-500">{item.example_vietnamese}</p>
                          </div>
                          <button
                            onClick={() => speak(item.example_hanzi!)}
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

      {/* CATEGORY-SELECT MODAL — asks which list to add into before opening the actual
          add-word form, so newly added words land in (and the page switches to) the
          right navtab. */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="cartoon-panel bg-white w-full max-w-sm p-6 relative">
            <button
              onClick={() => setIsCategoryModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 border border-slate-200 rounded-xl hover:bg-slate-50"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-extrabold text-slate-800 mb-1 flex items-center gap-2">
              <span>➕</span> Thêm Vào Đâu?
            </h3>
            <p className="text-xs text-slate-500 font-semibold mb-5">
              Chọn loại từ vựng muốn thêm vào cho ngày {formatDate(date)}.
            </p>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setPendingSource('study')
                  setIsCategoryModalOpen(false)
                  setIsAddModalOpen(true)
                }}
                className="w-full cartoon-panel p-4 bg-white hover:bg-blue-50 flex items-center gap-3 text-left transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 shrink-0">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-extrabold text-slate-800 text-sm">Từ Vựng Tự Học</div>
                  <div className="text-xs text-slate-400 font-semibold">{studyCount} từ trong ngày này</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPendingSource('practice')
                  setIsCategoryModalOpen(false)
                  setIsAddModalOpen(true)
                }}
                className="w-full cartoon-panel p-4 bg-white hover:bg-blue-50 flex items-center gap-3 text-left transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500 shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-extrabold text-slate-800 text-sm">Từ Vựng Khác</div>
                  <div className="text-xs text-slate-400 font-semibold">{practiceCount} từ trong ngày này</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

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

            <h3 className="text-2xl font-extrabold text-slate-800 mb-1 flex items-center gap-2">
              <span>➕</span> Thêm Từ Vựng ({formatDate(date)})
            </h3>
            <p className="text-xs font-black uppercase tracking-wider text-blue-500 mb-3">
              Vào mục: {pendingSource === 'study' ? 'Từ Vựng Tự Học' : 'Từ Vựng Khác'}
            </p>

            <form onSubmit={handleAddSubmit} className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 mb-4" style={{ overflowX: 'visible' }}>
                {newRows.map((row, idx) => (
                  <div key={idx} className="bg-slate-50 p-3 rounded-2xl border border-dashed border-slate-200 space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 w-full relative">
                      {/* Hanzi Input */}
                      <div className="flex flex-col relative justify-center">
                        <input
                          type="text"
                          placeholder="Chữ Hoa (Hán tự)"
                          value={row.hanzi}
                          onChange={(e) => updateNewRowField(idx, 'hanzi', e.target.value)}
                          className="px-3 py-2 pr-10 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-chinese font-bold text-2xl bg-white w-full"
                        />
                        {row.hanzi.trim() && (
                          <button
                            type="button"
                            onClick={() => generatePinyinForRow(idx)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-blue-500 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs font-bold transition-all active:translate-y-0.5"
                            title="Tạo Pinyin tự động"
                          >
                            🪄
                          </button>
                        )}
                      </div>

                      {/* Pinyin Input + TOCFL Dropdown suggestion (phone-IME style composing) */}
                      <div className="flex flex-col" style={{ position: 'relative' }}>
                        <input
                          type="text"
                          placeholder="Pinyin (gõ không dấu: ni, hao...)"
                          value={row.pinyin}
                          onFocus={() => loadTocflIndex()}
                          onChange={(e) => updateComposingBuffer(idx, e.target.value)}
                          className="px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold text-md bg-white"
                        />
                        {row.hanzi && (
                          <div className="flex items-center gap-1.5 mt-1 px-0.5">
                            <span className="text-[10px] font-bold text-slate-400 truncate">
                              Đã ghép: <span className="font-chinese text-slate-600">{row.hanzi}</span> ({derivedPinyinByRow[idx] || ''})
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

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleRowExample(idx)}
                        className={`p-2 rounded-xl border transition-all active:translate-y-0.5 ${
                          row.showExample
                            ? 'bg-blue-50 border-blue-200 text-blue-600'
                            : 'border-transparent text-slate-400 hover:bg-blue-50 hover:border-blue-100 hover:text-blue-600'
                        }`}
                        title="Thêm ví dụ cho từ này (dùng khi học Flashcard)"
                      >
                        <BookOpen className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeNewRow(idx)}
                        disabled={newRows.length === 1}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-xl disabled:opacity-30 border border-transparent hover:border-red-100 flex-shrink-0"
                        title="Xóa dòng"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {row.showExample && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-amber-50/60 border border-dashed border-amber-200 rounded-xl p-3 relative">
                      {/* Ví Dụ - Hán Tự */}
                      <div className="flex flex-col relative justify-center">
                        <input
                          type="text"
                          placeholder="Ví Dụ - Chữ Hán"
                          value={row.exampleHanzi}
                          onChange={(e) => updateNewRowExampleField(idx, 'exampleHanzi', e.target.value)}
                          className="px-3 py-2 pr-10 border border-amber-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-amber-100 font-chinese font-bold text-2xl bg-white w-full"
                        />
                        {row.exampleHanzi.trim() && (
                          <button
                            type="button"
                            onClick={() => generateExamplePinyinForRow(idx)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-amber-500 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg text-xs font-bold transition-all active:translate-y-0.5"
                            title="Tạo Pinyin tự động"
                          >
                            🪄
                          </button>
                        )}
                      </div>

                      {/* Ví Dụ - Pinyin + cùng bộ gợi ý TOCFL kiểu IME như ô Thêm Từ */}
                      <div className="flex flex-col" style={{ position: 'relative' }}>
                        <input
                          type="text"
                          placeholder="Pinyin (gõ không dấu: ni, hao...)"
                          value={row.examplePinyin}
                          onFocus={() => loadTocflIndex()}
                          onChange={(e) => updateExampleComposingBuffer(idx, e.target.value)}
                          className="px-3 py-2 border border-amber-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-amber-100 font-bold text-md bg-white"
                        />
                        {row.exampleHanzi && (
                          <div className="flex items-center gap-1.5 mt-1 px-0.5">
                            <span className="text-[10px] font-bold text-amber-600/70 truncate">
                              Đã ghép: <span className="font-chinese text-amber-700">{row.exampleHanzi}</span> ({derivedExamplePinyinByRow[idx] || ''})
                            </span>
                            <button
                              type="button"
                              onClick={() => clearExampleComposition(idx)}
                              className="text-[10px] font-black text-red-400 hover:text-red-600 flex-shrink-0"
                            >
                              Xóa
                            </button>
                          </div>
                        )}
                        {exampleSuggestions[idx] && exampleSuggestions[idx].length > 0 && (
                          <div
                            className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-1.5 space-y-0.5 max-h-52 overflow-y-auto"
                            style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20000 }}
                          >
                            <div className="flex items-center gap-1.5 px-2 py-1">
                              <span className="text-[9px] font-black text-amber-600 uppercase tracking-wider">⌨️ TOCFL 繁體 — {exampleSuggestions[idx].length} gợi ý</span>
                            </div>
                            {exampleSuggestions[idx].map((item, sugIdx) => (
                              <button
                                key={sugIdx}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); selectExampleSuggestion(idx, item) }}
                                className="w-full text-left px-2.5 py-2 flex items-center gap-3 hover:bg-amber-50 rounded-xl transition-colors"
                                title="Ghép vào câu ví dụ đang gõ"
                              >
                                <span className="font-chinese text-lg text-amber-700 font-bold min-w-[2rem]">{item.t}</span>
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
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Ví Dụ - Nghĩa Tiếng Việt */}
                      <div className="flex flex-col">
                        <input
                          type="text"
                          placeholder="Ví Dụ - Nghĩa Tiếng Việt"
                          value={row.exampleVietnamese}
                          onChange={(e) => updateNewRowExampleField(idx, 'exampleVietnamese', e.target.value)}
                          className="px-3 py-2 border border-amber-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-amber-100 font-bold text-sm bg-white"
                        />
                      </div>
                    </div>
                  )}
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center border-t border-slate-100 pt-4 bg-white gap-2">
                <button
                  type="button"
                  onClick={addNewRow}
                  className="cartoon-btn cartoon-btn-secondary px-4 py-2 text-sm flex items-center gap-2"
                >
                  + Thêm Dòng
                </button>
                <div className="flex gap-2">
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

      {/* IMPORT DATE PICKER MODAL */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="cartoon-panel bg-white w-full max-w-sm p-6 relative">
            <button
              onClick={() => setIsImportModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 border border-slate-200 rounded-xl hover:bg-slate-50"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-extrabold text-slate-800 mb-2 flex items-center gap-2">
              <span>📥</span> Nhập Excel
            </h3>
            <p className="text-xs text-slate-500 font-semibold mb-4">
              Chọn ngày muốn nhập từ vựng vào, rồi chọn file Excel. Toàn bộ từ trong file sẽ được thêm vào đúng ngày này.
            </p>

            <label className="block text-sm font-bold text-slate-700 mb-1">Ngày nhập vào</label>
            <div className="cartoon-panel p-2.5 bg-white flex items-center mb-5 w-fit">
              <DatePicker value={importDate} onChange={setImportDate} />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="cartoon-btn cartoon-btn-secondary px-4 py-2 text-sm"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleImportPickFile}
                className="cartoon-btn px-5 py-2 text-sm flex items-center gap-2"
              >
                <Upload className="w-4 h-4" /> Chọn File Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK DELETE CONFIRM MODAL */}
      {isBulkDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="cartoon-panel bg-white w-full max-w-sm p-6 relative">
            <button
              onClick={() => setIsBulkDeleteModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 border border-slate-200 rounded-xl hover:bg-slate-50"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-extrabold text-slate-800 mb-2 flex items-center gap-2">Xác nhận xóa</h3>
            <p className="text-sm text-slate-600 mb-4">Bạn có chắc chắn muốn xóa <strong>{selectedIds.length}</strong> từ vựng đã chọn? Hành động này không thể hoàn tác.</p>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setIsBulkDeleteModalOpen(false)}
                className="cartoon-btn cartoon-btn-secondary px-4 py-2 text-sm"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                disabled={actionLoading}
                className="cartoon-btn px-5 py-2 text-sm flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> {actionLoading ? 'Đang xóa...' : 'Xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SINGLE-ROW EDIT MODAL */}
      {isEditModalOpen && editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="cartoon-panel bg-white w-full max-w-5xl p-6 relative">
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Chữ Hoa (Hanzi)</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={editHanzi}
                      onChange={(e) => setEditHanzi(e.target.value)}
                      className="w-full px-4 py-2 pr-12 border border-slate-300 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-chinese font-bold text-lg bg-white"
                    />
                    {editHanzi.trim() && (
                      <button
                        type="button"
                        onClick={generateEditPinyin}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-blue-500 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs font-bold transition-all"
                        title="Tạo Pinyin tự động"
                      >
                        🪄
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ position: 'relative' }}>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Pinyin</label>
                  <input
                    type="text"
                    placeholder="Gõ không dấu để gợi ý (ni, hao...)"
                    value={editPinyin}
                    onFocus={() => loadTocflIndex()}
                    onChange={(e) => updateEditComposingBuffer(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-100 font-bold"
                  />
                  <div className="flex items-center gap-1.5 mt-1 px-0.5">
                    <span className="text-[10px] font-bold text-slate-400 truncate">
                      Pinyin hiện tại: <span className="font-semibold text-slate-600">{editPinyin || '—'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={clearEditComposition}
                      className="text-[10px] font-black text-red-400 hover:text-red-600 flex-shrink-0"
                    >
                      Xóa
                    </button>
                  </div>
                  {editSuggestions.length > 0 && (
                    <div
                      className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-1.5 space-y-0.5 max-h-52 overflow-y-auto"
                      style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20000 }}
                    >
                      <div className="flex items-center gap-1.5 px-2 py-1">
                        <span className="text-[9px] font-black text-blue-500 uppercase tracking-wider">⌨️ TOCFL 繁體 — {editSuggestions.length} gợi ý</span>
                      </div>
                      {editSuggestions.map((item, sugIdx) => (
                        <button
                          key={sugIdx}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); selectEditSuggestion(item) }}
                          className="w-full text-left px-2.5 py-2 flex items-center gap-3 hover:bg-blue-50 rounded-xl transition-colors"
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
                      ))}
                    </div>
                  )}
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
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-amber-600" />
                  <h4 className="text-sm font-black text-slate-700">Ví Dụ (tùy chọn)</h4>
                </div>
                <p className="text-xs text-slate-500 font-semibold">Nếu từ đã có ví dụ thì sẽ hiện ở đây để chỉnh sửa. Nếu chưa có thì để trống để thêm mới.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Ví Dụ - Chữ Hán</label>
                    <input
                      type="text"
                      value={editExampleHanzi}
                      onChange={(e) => setEditExampleHanzi(e.target.value)}
                      className="w-full px-4 py-2 border border-amber-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-amber-100 font-chinese font-bold text-lg bg-white"
                      placeholder="Ví dụ tiếng Hán"
                    />
                  </div>

                  <div style={{ position: 'relative' }}>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Ví Dụ - Pinyin</label>
                    <input
                      type="text"
                      value={editExamplePinyin}
                      onFocus={() => loadTocflIndex()}
                      onChange={(e) => updateEditExampleComposingBuffer(e.target.value)}
                      className="w-full px-4 py-2 border border-amber-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-amber-100 font-bold bg-white"
                      placeholder="Gõ không dấu để gợi ý (ni, hao...)"
                    />
                    <div className="flex items-center gap-1.5 mt-1 px-0.5">
                      <span className="text-[10px] font-bold text-amber-600/70 truncate">
                        Đã ghép: <span className="font-semibold text-amber-700">{editExamplePinyin || '—'}</span>
                      </span>
                      <button
                        type="button"
                        onClick={clearEditExampleComposition}
                        className="text-[10px] font-black text-red-400 hover:text-red-600 flex-shrink-0"
                      >
                        Xóa
                      </button>
                    </div>
                    {editExampleSuggestions.length > 0 && (
                      <div
                        className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-1.5 space-y-0.5 max-h-52 overflow-y-auto"
                        style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20000 }}
                      >
                        <div className="flex items-center gap-1.5 px-2 py-1">
                          <span className="text-[9px] font-black text-amber-600 uppercase tracking-wider">⌨️ TOCFL 繁體 — {editExampleSuggestions.length} gợi ý</span>
                        </div>
                        {editExampleSuggestions.map((item, sugIdx) => (
                          <button
                            key={sugIdx}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); selectEditExampleSuggestion(item) }}
                            className="w-full text-left px-2.5 py-2 flex items-center gap-3 hover:bg-amber-50 rounded-xl transition-colors"
                            title="Ghép vào ví dụ đang gõ"
                          >
                            <span className="font-chinese text-lg text-amber-700 font-bold min-w-[2rem]">{item.t}</span>
                            <span className="text-slate-500 font-semibold text-xs flex-1">{item.p}</span>
                            {'composed' in item ? (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 bg-purple-100 text-purple-700">Ghép từ</span>
                            ) : item.l === null ? (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 bg-slate-100 text-slate-500">詞典</span>
                            ) : (
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${item.l <= 2 ? 'bg-green-100 text-green-700' : item.l <= 4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>L{item.l}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Ví Dụ - Tiếng Việt</label>
                    <input
                      type="text"
                      value={editExampleVietnamese}
                      onChange={(e) => setEditExampleVietnamese(e.target.value)}
                      className="w-full px-4 py-2 border border-amber-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-amber-100 font-bold bg-white"
                      placeholder="Nghĩa tiếng Việt"
                    />
                  </div>
                </div>
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
