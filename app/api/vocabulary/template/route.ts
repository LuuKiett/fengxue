import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function GET(request: NextRequest) {
  try {
    const wb = XLSX.utils.book_new()
    
    // Sample rows showing structure
    const sampleData = [
      {
        'Chữ Hoa': '你好',
        'Pinyin': 'nǐ hǎo',
        'Tiếng Việt': 'Xin chào',
        'Nguồn Từ': 'study'
      },
      {
        'Chữ Hoa': '谢谢',
        'Pinyin': 'xièxie',
        'Tiếng Việt': 'Cảm ơn',
        'Nguồn Từ': 'study'
      },
      {
        'Chữ Hoa': '再见',
        'Pinyin': 'zàijiàn',
        'Tiếng Việt': 'Tạm biệt',
        'Nguồn Từ': 'practice'
      }
    ]

    const worksheet = XLSX.utils.json_to_sheet(sampleData)

    // Set column widths for better Excel readability
    worksheet['!cols'] = [
      { wch: 15 }, // Chữ Hoa
      { wch: 15 }, // Pinyin
      { wch: 20 }, // Tiếng Việt
      { wch: 12 }  // Nguồn Từ
    ]

    // Append to sheet with today's date format as a hint for tab name format
    const todayStr = new Date().toISOString().split('T')[0]
    XLSX.utils.book_append_sheet(wb, worksheet, todayStr)

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buffer, {
      headers: {
        'Content-Disposition': `attachment; filename="fengxue-mau-tu-vung.xlsx"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    })
  } catch (err: any) {
    console.error('Template export error:', err)
    return NextResponse.json({ error: err?.message || 'Lỗi hệ thống khi tải file mẫu' }, { status: 500 })
  }
}
