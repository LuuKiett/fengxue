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

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

async function callOpenRouter(
  hanzi: string,
  pinyin: string,
  vietnamese: string,
  modelOverride?: string
): Promise<GeneratedExample | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const defaultModel = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL || undefined
  const model = modelOverride || defaultModel

  const prompt = `Bạn là trợ lý dạy tiếng Trung. Cho từ vựng tiếng Trung phồn thể "${hanzi}" (pinyin: ${pinyin}, nghĩa tiếng Việt: "${vietnamese}"), hãy đặt MỘT câu ví dụ ngắn, đơn giản, tự nhiên dùng từ này.\n\nChỉ trả lời bằng đúng một object JSON, không thêm chữ nào khác, không dùng markdown, theo đúng định dạng:\n{"example_hanzi": "câu ví dụ chữ Hán phồn thể", "example_pinyin": "pinyin có dấu thanh của câu đó", "example_vietnamese": "bản dịch tiếng Việt của câu đó"}`

  const maxAttempts = 5
  const baseBackoff = 2000 // 2s base
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
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

      const text = await res.text().catch(() => '')
      let data: any = null
      try { data = text ? JSON.parse(text) : null } catch { /* ignore JSON parse */ }

      if (res.ok) {
        const content: string | undefined = data?.choices?.[0]?.message?.content
        if (!content) return null
        return extractJson(content)
      }

      // Handle rate limit: if Retry-After header present, respect it
      const retryAfterHeader = res.headers.get('Retry-After')
      let retryAfter = retryAfterHeader ? Math.ceil(Number(retryAfterHeader) * 1000) : undefined

      // Try to parse provider metadata for retry guidance
      const providerMetadata = data?.error?.metadata || data?.metadata || null
      if (!retryAfter && providerMetadata) {
        const sec = providerMetadata.retry_after_seconds || providerMetadata.retry_after_seconds_raw
        if (sec) retryAfter = Math.ceil(Number(sec) * 1000)
      }

      console.warn(`OpenRouter request attempt ${attempt} failed:`, res.status, data || text)

      if (res.status === 429 && attempt < maxAttempts) {
        // Respect Retry-After if provided, otherwise exponential backoff.
        // Cap waits at 60 seconds to avoid short retry churn when upstream is heavily rate-limited.
        const cappedRetryAfter = retryAfter ? Math.min(retryAfter, 60000) : undefined
        const waitMs = cappedRetryAfter ?? Math.min(baseBackoff * Math.pow(2, attempt - 1), 60000)
        console.info(`Rate limited, waiting ${waitMs}ms before retry (attempt ${attempt})`)
        await sleep(waitMs)
        continue
      }

      // Non-retriable or max attempts reached -> break
      break
    } catch (err) {
      console.error('OpenRouter fetch error:', err)
      if (attempt < maxAttempts) {
        const waitMs = Math.min(500 * attempt, 2000)
        await sleep(waitMs)
        continue
      }
      break
    }
  }

  // If we have a fallback model configured and it's different, try it once
  if (fallbackModel && fallbackModel !== model) {
    try {
      console.info('Attempting OpenRouter fallback model:', fallbackModel)
      const res2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: fallbackModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
        }),
      })

      if (!res2.ok) {
        const txt = await res2.text().catch(() => '')
        console.error('OpenRouter fallback request failed:', res2.status, txt)
        return null
      }
      const data2 = await res2.json().catch(() => null)
      const content2: string | undefined = data2?.choices?.[0]?.message?.content
      if (!content2) return null
      return extractJson(content2)
    } catch (err) {
      console.error('OpenRouter fallback error:', err)
      return null
    }
  }

  return null
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
