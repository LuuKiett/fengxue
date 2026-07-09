import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface GeneratedExample {
  example_hanzi: string
  example_pinyin: string
  example_vietnamese: string
}

// Pulls the first {...} block out of the model's reply so this still works if the
// model wraps its JSON in prose or a ```json fence despite the prompt asking not to.
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

async function callOpenRouter(hanzi: string, pinyin: string, vietnamese: string): Promise<GeneratedExample | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'

  const prompt = `Bạn là trợ lý dạy tiếng Trung. Cho từ vựng tiếng Trung phồn thể "${hanzi}" (pinyin: ${pinyin}, nghĩa tiếng Việt: "${vietnamese}"), hãy đặt MỘT câu ví dụ ngắn, đơn giản, tự nhiên dùng từ này.

Chỉ trả lời bằng đúng một object JSON, không thêm chữ nào khác, không dùng markdown, theo đúng định dạng:
{"example_hanzi": "câu ví dụ chữ Hán phồn thể", "example_pinyin": "pinyin có dấu thanh của câu đó", "example_vietnamese": "bản dịch tiếng Việt của câu đó"}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  })

  if (!res.ok) {
    console.error('OpenRouter request failed:', res.status, await res.text().catch(() => ''))
    return null
  }

  const data = await res.json()
  const content: string | undefined = data?.choices?.[0]?.message?.content
  if (!content) return null

  return extractJson(content)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 })
    }

    const { vocabularyId } = await request.json()
    if (!vocabularyId || typeof vocabularyId !== 'string') {
      return NextResponse.json({ error: 'Thiếu vocabularyId' }, { status: 400 })
    }

    const { data: vocab } = await supabase
      .from('vocabularies')
      .select('id, hanzi, pinyin, vietnamese, set_id, example_hanzi, example_source')
      .eq('id', vocabularyId)
      .single()

    if (!vocab) {
      return NextResponse.json({ error: 'Không tìm thấy từ vựng' }, { status: 404 })
    }

    // Never overwrite an example that's already there — whether typed by hand on
    // /vocabulary ('manual'), backfilled from dictionary_words ('dictionary'), or a
    // previous AI generation. This check is the actual guarantee; the client only
    // avoids calling this route for manual examples as an optimization.
    if (vocab.example_hanzi) {
      return NextResponse.json({ success: true, skipped: true })
    }

    // Ownership check: the vocab's set must belong to the authenticated user.
    const { data: set } = await supabase
      .from('vocabulary_sets')
      .select('id')
      .eq('id', vocab.set_id)
      .eq('user_id', user.id)
      .single()

    if (!set) {
      return NextResponse.json({ error: 'Không có quyền truy cập từ vựng này' }, { status: 403 })
    }

    const example = await callOpenRouter(vocab.hanzi, vocab.pinyin, vocab.vietnamese)
    if (!example) {
      return NextResponse.json({ error: 'Không thể tạo câu ví dụ lúc này' }, { status: 502 })
    }

    const { error: updateErr } = await supabase
      .from('vocabularies')
      .update({
        example_hanzi: example.example_hanzi,
        example_pinyin: example.example_pinyin,
        example_vietnamese: example.example_vietnamese,
        example_source: 'ai',
      })
      .eq('id', vocabularyId)

    if (updateErr) throw updateErr

    return NextResponse.json({ success: true, example })
  } catch (err: any) {
    console.error('Generate example error:', err)
    return NextResponse.json({ error: err?.message || 'Lỗi hệ thống khi tạo câu ví dụ' }, { status: 500 })
  }
}
