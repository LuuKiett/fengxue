import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface GeneratedExample {
  example_hanzi: string
  example_pinyin: string
  example_vietnamese: string
}

function extractJson(text: string): GeneratedExample | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    if (
      typeof parsed.example_hanzi === 'string' &&
      typeof parsed.example_pinyin === 'string' &&
      typeof parsed.example_vietnamese === 'string'
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function callOpenRouter(apiKey: string, prompt: string, model: string): Promise<GeneratedExample | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.7 })
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.error('OpenRouter processor fetch failed:', res.status, txt)
      return null
    }
    const data = await res.json().catch(() => null)
    const content: string | undefined = data?.choices?.[0]?.message?.content
    if (!content) return null
    return extractJson(content)
  } catch (err) {
    console.error('OpenRouter processor error:', err)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Missing OpenRouter API key' }, { status: 500 })

    // Find vocabularies that have no example and haven't been requested yet,
    // and were created at least 5 minutes ago so the user sees the add first.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    const { data: rows, error } = await supabase
      .from('vocabularies')
      .select('id, hanzi, pinyin, vietnamese')
      .is('example_hanzi', null)
      .or('example_requested_at.is.null')
      .lte('created_at', fiveMinAgo)
      .limit(10)

    if (error) throw error
    if (!rows || rows.length === 0) return NextResponse.json({ success: true, processed: 0 })

    for (const row of rows) {
      // mark requested immediately to ensure one-attempt behavior
      await supabase.from('vocabularies').update({ example_requested_at: new Date().toISOString() }).eq('id', row.id)

      const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'
      const fallback = process.env.OPENROUTER_FALLBACK_MODEL

      const prompt = `Bạn là trợ lý dạy tiếng Trung. Cho từ vựng tiếng Trung phồn thể "${row.hanzi}" (pinyin: ${row.pinyin}, nghĩa tiếng Việt: "${row.vietnamese}"), hãy đặt MỘT câu ví dụ ngắn, đơn giản, tự nhiên dùng từ này.\n\nChỉ trả lời bằng đúng một object JSON, không thêm chữ nào khác, không dùng markdown, theo đúng định dạng:\n{"example_hanzi": "câu ví dụ chữ Hán phồn thể", "example_pinyin": "pinyin có dấu thanh của câu đó", "example_vietnamese": "bản dịch tiếng Việt của câu đó"}`

      // try main model
      let example = await callOpenRouter(apiKey, prompt, model)
      if (!example && fallback) {
        await sleep(1500)
        example = await callOpenRouter(apiKey, prompt, fallback)
      }

      if (example) {
        const { error: updErr } = await supabase.from('vocabularies').update({
          example_hanzi: example.example_hanzi,
          example_pinyin: example.example_pinyin,
          example_vietnamese: example.example_vietnamese,
          example_source: 'ai',
          updated_at: new Date().toISOString()
        }).eq('id', row.id)
        if (updErr) console.error('Failed to save example:', updErr)
      }
    }

    return NextResponse.json({ success: true, processed: rows.length })
  } catch (err: any) {
    console.error('Process-new queue error:', err)
    return NextResponse.json({ error: err?.message || 'Error' }, { status: 500 })
  }
}
