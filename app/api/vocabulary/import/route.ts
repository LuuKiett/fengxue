import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/utils/ensureProfile'
import { stripTones } from '@/lib/utils/pinyin'
import * as XLSX from 'xlsx'

interface ParsedRow {
  hanzi: string
  pinyin: string
  vietnamese: string
  source: 'study' | 'practice'
  example_hanzi?: string
  example_pinyin?: string
  example_vietnamese?: string
  order_index: number
}

interface DictMatch {
  hanzi: string
  pinyin: string
  example_hanzi: string | null
  example_pinyin: string | null
  example_vietnamese: string | null
}

function parseSheetRows(worksheet: XLSX.WorkSheet): Omit<ParsedRow, 'order_index'>[] {
  const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[]
  return jsonData
    .map((row) => {
      const hanzi = row['Chữ Hoa'] || row['hanzi'] || ''
      const pinyin = row['Pinyin'] || row['pinyin'] || ''
      const vietnamese = row['Tiếng Việt'] || row['vietnamese'] || row['viet'] || ''
      const sourceRaw = String(row['Nguồn Từ'] || row['source'] || '').trim().toLowerCase()
      const source: 'study' | 'practice' = sourceRaw === 'practice' ? 'practice' : 'study'
      const exampleHanzi = row['Ví Dụ - Chữ Hán'] || row['Example Hanzi'] || row['example_hanzi'] || ''
      const examplePinyin = row['Ví Dụ - Pinyin'] || row['Example Pinyin'] || row['example_pinyin'] || ''
      const exampleVietnamese = row['Ví Dụ - Tiếng Việt'] || row['Example Vietnamese'] || row['example_vietnamese'] || ''
      return {
        hanzi: String(hanzi).trim(),
        pinyin: String(pinyin).trim(),
        vietnamese: String(vietnamese).trim(),
        source,
        example_hanzi: String(exampleHanzi).trim(),
        example_pinyin: String(examplePinyin).trim(),
        example_vietnamese: String(exampleVietnamese).trim(),
      }
    })
    .filter((r) => r.hanzi && r.pinyin && r.vietnamese)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 })
    }

    // Ensure profile row exists before any FK-dependent write
    await ensureProfile(supabase)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'Không tìm thấy file upload' }, { status: 400 })
    }
    // The date the caller currently has selected in the UI (or picked via the import
    // date picker) — when present, every row from every sheet in the file is imported
    // into this single date, regardless of what the sheet tabs are named. This is the
    // common case (one file = one day's word list). Sheet-name-as-date is kept as a
    // fallback for files that don't specify a target date, so bulk multi-day exports
    // (produced via /api/vocabulary/export?dates=...) can still round-trip.
    const targetDateRaw = formData.get('date')
    const targetDate = typeof targetDateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetDateRaw)
      ? targetDateRaw
      : null

    const bytes = await file.arrayBuffer()
    const workbook = XLSX.read(bytes, { type: 'array' })

    const results: { [date: string]: ParsedRow[] } = {}

    if (targetDate) {
      const allRows = workbook.SheetNames.flatMap((sheetName) => parseSheetRows(workbook.Sheets[sheetName]))
      if (allRows.length > 0) {
        results[targetDate] = allRows.map((r, index) => ({ ...r, order_index: index }))
      }
    } else {
      for (const sheetName of workbook.SheetNames) {
        // Validate date format YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sheetName)) {
          continue
        }
        const parsedRows = parseSheetRows(workbook.Sheets[sheetName]).map((r, index) => ({ ...r, order_index: index }))
        if (parsedRows.length > 0) {
          results[sheetName] = parsedRows
        }
      }
    }

    if (Object.keys(results).length === 0) {
      return NextResponse.json({
        error: targetDate
          ? 'Không tìm thấy dòng dữ liệu hợp lệ nào. Kiểm tra các cột phải tên là "Chữ Hoa", "Pinyin", "Tiếng Việt" (có thể có thêm "Ví Dụ - Chữ Hán", "Ví Dụ - Pinyin", "Ví Dụ - Tiếng Việt").'
          : 'Không tìm thấy dòng dữ liệu hợp lệ nào. Kiểm tra: tên sheet phải đúng định dạng YYYY-MM-DD, và các cột phải tên là "Chữ Hoa", "Pinyin", "Tiếng Việt" (có thể có thêm "Ví Dụ - Chữ Hán", "Ví Dụ - Pinyin", "Ví Dụ - Tiếng Việt").',
      }, { status: 400 })
    }

    // Backfill accurate example sentences from dictionary_words for any imported word
    // that matches an entry there, so Flashcard shows the same real example used on
    // /dictionary and /review-dictionary instead of falling back to a generic one.
    const allHanzi = Array.from(new Set(Object.values(results).flatMap((rows) => rows.map((r) => r.hanzi))))
    const dictByHanzi = new Map<string, DictMatch[]>()
    if (allHanzi.length > 0) {
      const { data: dictMatches } = await supabase
        .from('dictionary_words')
        .select('hanzi, pinyin, example_hanzi, example_pinyin, example_vietnamese')
        .in('hanzi', allHanzi)

      for (const d of (dictMatches || []) as DictMatch[]) {
        if (!dictByHanzi.has(d.hanzi)) dictByHanzi.set(d.hanzi, [])
        dictByHanzi.get(d.hanzi)!.push(d)
      }
    }

    const findExample = (hanzi: string, pinyin: string) => {
      const candidates = dictByHanzi.get(hanzi)
      if (!candidates || candidates.length === 0) return null
      // Prefer the entry whose pinyin also matches (handles multiple dictionary
      // entries sharing the same hanzi with different readings), else take the first.
      const best = candidates.find((c) => stripTones(c.pinyin) === stripTones(pinyin)) || candidates[0]
      if (!best.example_hanzi) return null
      return {
        example_hanzi: best.example_hanzi,
        example_pinyin: best.example_pinyin,
        example_vietnamese: best.example_vietnamese,
      }
    }

    let importedCount = 0
    let matchedCount = 0
    const perDate: { date: string; count: number }[] = []
    const failures: { date: string; message: string }[] = []

    for (const [dateStr, rows] of Object.entries(results)) {
      let { data: set } = await supabase
        .from('vocabulary_sets')
        .select('id')
        .eq('user_id', user.id)
        .eq('date', dateStr)
        .single()

      if (!set) {
        const { data: newSet, error: setError } = await supabase
          .from('vocabulary_sets')
          .insert({
            user_id: user.id,
            date: dateStr,
          })
          .select('id')
          .single()

        if (setError) {
          console.error(`Error creating set for date ${dateStr}:`, setError)
          failures.push({ date: dateStr, message: setError.message })
          continue
        }
        set = newSet
      }

      if (set) {
        // Clear existing vocabularies to avoid duplication
        await supabase
          .from('vocabularies')
          .delete()
          .eq('set_id', set.id)

        // Insert new ones
        const { error: insertError } = await supabase
          .from('vocabularies')
          .insert(
            rows.map((r) => {
              const hasManualExample = Boolean(r.example_hanzi && r.example_pinyin && r.example_vietnamese)
              const example = hasManualExample
                ? {
                    example_hanzi: r.example_hanzi,
                    example_pinyin: r.example_pinyin,
                    example_vietnamese: r.example_vietnamese,
                  }
                : findExample(r.hanzi, r.pinyin)
              if (example) matchedCount++
              return {
                set_id: set.id,
                hanzi: r.hanzi,
                pinyin: r.pinyin,
                vietnamese: r.vietnamese,
                order_index: r.order_index,
                source: r.source,
                example_hanzi: example?.example_hanzi ?? null,
                example_pinyin: example?.example_pinyin ?? null,
                example_vietnamese: example?.example_vietnamese ?? null,
                example_source: hasManualExample ? 'manual' : example ? 'dictionary' : null,
              }
            })
          )

        if (insertError) {
          console.error(`Error inserting vocab for set ${set.id}:`, insertError)
          failures.push({ date: dateStr, message: insertError.message })
        } else {
          importedCount += rows.length
          perDate.push({ date: dateStr, count: rows.length })
        }
      }
    }

    if (importedCount === 0) {
      return NextResponse.json({
        error: failures.length > 0
          ? `Import thất bại cho tất cả các ngày: ${failures.map(f => `${f.date} (${f.message})`).join('; ')}`
          : 'Không có từ vựng nào được nhập.',
      }, { status: 400 })
    }

    return NextResponse.json({ success: true, importedCount, matchedCount, dates: perDate, failures })
  } catch (err: any) {
    console.error('Import error:', err)
    return NextResponse.json({ error: err?.message || 'Lỗi hệ thống khi import' }, { status: 500 })
  }
}
