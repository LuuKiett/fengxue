'use client'

import React, { useEffect, useState } from 'react'
import { Volume2, BookOpen, Loader2 } from 'lucide-react'
import { speak } from '@/lib/utils/speak'

interface ExampleSentence {
  sentence: string
  pinyin: string
  translation: string
}

interface FlashcardProps {
  hanzi: string
  pinyin: string
  vietnamese: string
  isFlipped: boolean
  onFlip: () => void
  // When the caller already has a real example sentence for this word (e.g. from
  // dictionary_words), pass it here to use it directly instead of falling back to the
  // generic /api/examples lookup (which only covers ~30 curated words and otherwise
  // generates a formulaic "我在學習「X」這個詞" placeholder). Pass `null` explicitly to
  // mean "confirmed no example available" without triggering a fetch; omit the prop
  // entirely to keep the old fetch-based behavior (used by pages studying user-added
  // vocab, which has no per-word example data of its own).
  example?: ExampleSentence | null
}

export default function Flashcard({
  hanzi,
  pinyin,
  vietnamese,
  isFlipped,
  onFlip,
  example
}: FlashcardProps) {
  const [examples, setExamples] = useState<ExampleSentence[]>([])
  const [examplesLoading, setExamplesLoading] = useState(false)

  // Fetch example sentences when card changes (skipped entirely if the caller already
  // supplied a real example via the `example` prop)
  useEffect(() => {
    if (!hanzi) return

    if (example !== undefined) {
      setExamples(example ? [example] : [])
      setExamplesLoading(false)
      return
    }

    setExamples([])
    setExamplesLoading(true)

    fetch(`/api/examples?hanzi=${encodeURIComponent(hanzi)}`)
      .then(r => r.json())
      .then(data => {
        if (data.examples) setExamples(data.examples)
      })
      .catch(() => {})
      .finally(() => setExamplesLoading(false))
  }, [hanzi, example])

  // TTS capability for Chinese characters
  const speakHanzi = (e: React.MouseEvent, text?: string) => {
    e.stopPropagation()
    speak(text || hanzi)
  }

  return (
    <div
      className="w-full max-w-2xl relative cursor-pointer perspective-1000 mx-auto md:h[480px] h-[400px]"
      onClick={onFlip}
    >
      <div className={`w-full h-full relative duration-500 transform-style-3d flashcard-inner ${isFlipped ? 'flashcard-flipped' : ''}`}>

        {/* FRONT SIDE (Hanzi) */}
        <div className="absolute inset-0 w-full backface-hidden bg-white border border-indigo-100 rounded-3xl shadow-xl shadow-indigo-100/40 flex flex-col items-center justify-between p-6">
          <div className="flex justify-between w-full items-center">
            <span className="text-xs font-black px-3 py-1 bg-blue-50 border border-blue-200 rounded-full text-blue-600 shadow-sm">
              繁體字
            </span>
            <button
              onClick={(e) => speakHanzi(e)}
              className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all text-slate-700 active:translate-y-0.5"
              title="Phát âm (Phổ thông hoá)"
            >
              <Volume2 className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <span className="font-chinese md:text-8xl text-6xl text-slate-800 leading-normal select-none">
              {hanzi}
            </span>
          </div>

          <div className="text-sm font-extrabold text-slate-400">
            Chạm vào thẻ để xem nghĩa 💡
          </div>
        </div>

        {/* BACK SIDE (Pinyin + Vietnamese + Examples) — scrolls internally so longer
            content (multiple example sentences) never overflows past the card and
            overlaps whatever sits below it on the page. */}
        <div className="w-full backface-hidden bg-blue-50/55 border border-blue-100 rounded-3xl shadow-xl shadow-blue-100/40 flex flex-col p-6 gap-5 flashcard-back overflow-y-auto">
          
          {/* Header */}
          <div className="flex justify-between w-full items-center">
            <span className="text-xs font-black px-3 py-1 bg-blue-100 border border-blue-200 rounded-full text-blue-700 shadow-sm">
              Giải Nghĩa
            </span>
            <button
              onClick={(e) => speakHanzi(e)}
              className="p-2 border border-blue-200 rounded-xl hover:bg-blue-100 transition-all text-slate-700 active:translate-y-0.5"
              title="Phát âm"
            >
              <Volume2 className="w-5 h-5" />
            </button>
          </div>

          {/* Pinyin + Meaning */}
          <div className="flex flex-col items-center gap-3">
            <div className="text-center">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Phiên âm</span>
              <span className="text-4xl font-black text-blue-600 font-sans tracking-wide">
                {pinyin}
              </span>
            </div>

            <div className="w-16 border-t-2 border-slate-300" />

            <div className="text-center">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Nghĩa tiếng Việt</span>
              <span className="text-xl font-extrabold text-slate-800 leading-snug">
                {vietnamese}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-blue-200" />

          {/* Example Sentences Section */}
          <div onClick={e => e.stopPropagation()} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Câu ví dụ</span>
            </div>

            {examplesLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                <span className="text-xs text-slate-400 font-semibold">Đang tải câu ví dụ...</span>
              </div>
            ) : examples.length > 0 ? (
              <div className="space-y-3">
                {examples.map((ex, i) => (
                  <div key={i} className="bg-white/70 border border-blue-100 rounded-xl p-3 space-y-1 text-left">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-chinese text-slate-800 md:text-2xl leading-snug flex-1">
                        {ex.sentence}
                      </p>
                      <button
                        onClick={(e) => speakHanzi(e, ex.sentence)}
                        className="flex-shrink-0 p-1 rounded-lg hover:bg-blue-100 text-slate-400 hover:text-blue-600 transition-colors"
                        title="Nghe câu ví dụ"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-md font-semibold text-blue-500 italic">{ex.pinyin}</p>
                    <p className="text-md font-semibold text-slate-500">{ex.translation}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-semibold italic py-1">
                Không có câu ví dụ cho từ này.
              </p>
            )}
          </div>

          <div className="text-sm font-extrabold text-slate-400 text-center mt-auto pt-2">
            Chạm vào thẻ để quay lại Hán tự 🔄
          </div>
        </div>

      </div>
    </div>
  )
}
