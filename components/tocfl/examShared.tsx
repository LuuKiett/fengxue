'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TocflPaper, TocflQuestion } from '@/lib/types/tocfl'

export interface Step {
  groupKey: string | null
  questions: TocflQuestion[]
}

export function buildSteps(questions: TocflQuestion[]): Step[] {
  const steps: Step[] = []
  for (const q of questions) {
    const last = steps[steps.length - 1]
    if (q.group_key && last && last.groupKey === q.group_key) {
      last.questions.push(q)
    } else {
      steps.push({ groupKey: q.group_key, questions: [q] })
    }
  }
  return steps
}

export function formatTime(totalSeconds: number) {
  const m = Math.floor(Math.max(0, totalSeconds) / 60)
  const s = Math.max(0, totalSeconds) % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Loads a paper (by paper_number, band A) and all of its questions, sorted
 * listening-then-reading by order_index. Shared by the strict "Thi Thử" exam and
 * the free-navigation "Luyện Đề" practice mode — both use the same real content. */
export function useTocflPaper(paperNumber: number) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [paper, setPaper] = useState<TocflPaper | null>(null)
  const [questions, setQuestions] = useState<TocflQuestion[]>([])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data: paperData } = await supabase
          .from('tocfl_papers')
          .select('*')
          .eq('band', 'A')
          .eq('paper_number', paperNumber)
          .single()
        if (!paperData) return
        setPaper(paperData as TocflPaper)

        const { data: qData } = await supabase
          .from('tocfl_questions')
          .select('*')
          .eq('paper_id', paperData.id)
        const all = ((qData || []) as TocflQuestion[]).sort((a, b) => {
          if (a.section !== b.section) return a.section === 'listening' ? -1 : 1
          return a.order_index - b.order_index
        })
        setQuestions(all)
      } catch (err) {
        console.error('Lỗi khi tải đề thi:', err)
      } finally {
        setLoading(false)
      }
    }
    if (paperNumber) load()
  }, [paperNumber, supabase])

  return { loading, paper, questions }
}

export function StepCard({
  step, showPromptText, answers, onSelect,
}: {
  step: Step
  showPromptText: boolean
  answers: Record<string, number>
  onSelect: (questionId: string, index: number) => void
}) {
  const shared = step.questions[0]
  const isGroup = step.questions.length > 1

  return (
    <div className="cartoon-panel p-5 md:p-6 bg-white space-y-5">
      {shared.prompt_image_path && (
        <div className="flex justify-center">
          <img
            src={shared.prompt_image_path}
            alt=""
            className="max-w-full max-h-80 object-contain rounded-xl border-2 border-slate-100"
          />
        </div>
      )}

      {showPromptText && shared.passage_hanzi && (
        <div className="bg-slate-50 rounded-2xl p-4 font-chinese text-lg leading-relaxed text-slate-800 whitespace-pre-line">
          {shared.passage_hanzi}
        </div>
      )}

      {step.questions.map((q) => (
        <div key={q.id} className="space-y-3">
          {showPromptText && (isGroup || !shared.passage_hanzi) && q.prompt_hanzi && (
            <div className="flex items-start gap-2">
              <span className="font-black text-[#189fec] shrink-0">Câu {q.question_number}.</span>
              <span className="font-chinese text-lg text-slate-800 whitespace-pre-line">{q.prompt_hanzi}</span>
            </div>
          )}
          {!showPromptText && (
            <span className="font-black text-[#189fec] text-sm">Câu {q.question_number}</span>
          )}

          <QuestionOptions question={q} selected={answers[q.id]} onSelect={(idx) => onSelect(q.id, idx)} />
        </div>
      ))}
    </div>
  )
}

export function QuestionOptions({
  question, selected, onSelect,
}: {
  question: TocflQuestion
  selected: number | undefined
  onSelect: (index: number) => void
}) {
  const hasImages = question.options.some((o) => o.imagePath)

  if (hasImages) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {question.options.map((opt, idx) => (
          <button
            key={opt.label}
            onClick={() => onSelect(idx)}
            className={`cartoon-card p-2 flex flex-col items-center gap-1.5 ${
              selected === idx ? 'ring-3 ring-[#189fec]' : ''
            }`}
          >
            <span className="font-black text-slate-500 text-xs">({opt.label})</span>
            {opt.imagePath && (
              <img src={opt.imagePath} alt="" className="w-full h-28 object-contain" />
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {question.options.map((opt, idx) => (
        <button
          key={opt.label}
          onClick={() => onSelect(idx)}
          className={`text-left px-4 py-2.5 rounded-xl font-bold text-sm border-2 transition-all flex items-center gap-2 ${
            selected === idx
              ? 'bg-[#e7f3ff] border-[#189fec] text-[#0e6bab]'
              : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
          }`}
        >
          <span className="font-black">({opt.label})</span>
          <span className="font-chinese">{opt.text}</span>
        </button>
      ))}
    </div>
  )
}
