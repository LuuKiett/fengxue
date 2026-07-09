import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const datesParam = searchParams.get('dates') || searchParams.get('date')
    
    if (!datesParam) {
      return NextResponse.json({ error: 'Thiếu tham số ngày (dates hoặc date)' }, { status: 400 })
    }

    const dates = datesParam.split(',').map(d => d.trim())
    const wb = XLSX.utils.book_new()

    let addedSheets = 0

    for (const dateStr of dates) {
      // 1. Get vocab set
      const { data: set } = await supabase
        .from('vocabulary_sets')
        .select('id')
        .eq('user_id', user.id)
        .eq('date', dateStr)
        .single()

      if (!set) continue

      // 2. Get vocabularies
      const { data: vocabs } = await supabase
        .from('vocabularies')
        .select('hanzi, pinyin, vietnamese, source, example_hanzi, example_pinyin, example_vietnamese')
        .eq('set_id', set.id)
        .order('order_index', { ascending: true })

      if (vocabs && vocabs.length > 0) {
        const worksheet = XLSX.utils.json_to_sheet(
          vocabs.map((v) => ({
            'Chữ Hoa': v.hanzi,
            'Pinyin': v.pinyin,
            'Tiếng Việt': v.vietnamese,
            'Nguồn Từ': v.source === 'practice' ? 'practice' : 'study',
            'Ví Dụ - Chữ Hán': v.example_hanzi ?? '',
            'Ví Dụ - Pinyin': v.example_pinyin ?? '',
            'Ví Dụ - Tiếng Việt': v.example_vietnamese ?? '',
          }))
        )
        XLSX.utils.book_append_sheet(wb, worksheet, dateStr)
        addedSheets++
      }
    }

    if (addedSheets === 0) {
      // Create a dummy empty sheet if no vocabulary is found
      const worksheet = XLSX.utils.json_to_sheet([{ 'Chữ Hoa': '', 'Pinyin': '', 'Tiếng Việt': '', 'Nguồn Từ': '', 'Ví Dụ - Chữ Hán': '', 'Ví Dụ - Pinyin': '', 'Ví Dụ - Tiếng Việt': '' }])
      XLSX.utils.book_append_sheet(wb, worksheet, 'No_Data')
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const filename = dates.length === 1 ? `vocab-${dates[0]}.xlsx` : 'vocab-multiple-dates.xlsx'

    return new NextResponse(buffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    })
  } catch (err: any) {
    console.error('Export error:', err)
    return NextResponse.json({ error: err?.message || 'Lỗi hệ thống khi export Excel' }, { status: 500 })
  }
}
