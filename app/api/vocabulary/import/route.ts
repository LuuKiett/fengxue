import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/utils/ensureProfile'
import * as XLSX from 'xlsx'

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

    const bytes = await file.arrayBuffer()
    const workbook = XLSX.read(bytes, { type: 'array' })

    const results: { [date: string]: any[] } = {}

    for (const sheetName of workbook.SheetNames) {
      // Validate date format YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sheetName)) {
        continue
      }

      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[]
      
      const parsedRows = jsonData
        .map((row, index) => {
          const hanzi = row['Chữ Hoa'] || row['hanzi'] || '';
          const pinyin = row['Pinyin'] || row['pinyin'] || '';
          const vietnamese = row['Tiếng Việt'] || row['vietnamese'] || row['viet'] || '';
          return {
            hanzi: String(hanzi).trim(),
            pinyin: String(pinyin).trim(),
            vietnamese: String(vietnamese).trim(),
            order_index: index,
          }
        })
        .filter(r => r.hanzi && r.pinyin && r.vietnamese)

      if (parsedRows.length > 0) {
        results[sheetName] = parsedRows
      }
    }

    let importedCount = 0

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
            rows.map(r => ({
              set_id: set.id,
              hanzi: r.hanzi,
              pinyin: r.pinyin,
              vietnamese: r.vietnamese,
              order_index: r.order_index,
            }))
          )

        if (insertError) {
          console.error(`Error inserting vocab for set ${set.id}:`, insertError)
        } else {
          importedCount += rows.length
        }
      }
    }

    return NextResponse.json({ success: true, importedCount })
  } catch (err: any) {
    console.error('Import error:', err)
    return NextResponse.json({ error: err?.message || 'Lỗi hệ thống khi import' }, { status: 500 })
  }
}
