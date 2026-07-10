'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useTocflPaper, buildSteps, StepCard } from '@/components/tocfl/examShared'
import { ResultScreen } from '../../thi-thu/[paper]/page'
import { ArrowLeft, Headphones, BookOpenCheck, Volume2, Send } from 'lucide-react'
import confetti from 'canvas-confetti'

export default function PracticePaperPage() {
  const params = useParams()
  const paperNumber = Number(params.paper)
  const { loading, paper, questions } = useTocflPaper(paperNumber)

  const [phase, setPhase] = useState<'quiz' | 'result'>('quiz')
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [activeSection, setActiveSection] = useState<'listening' | 'reading'>('listening')
  const [stepIndex, setStepIndex] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const listeningQuestions = useMemo(() => questions.filter((q) => q.section === 'listening'), [questions])
  const readingQuestions = useMemo(() => questions.filter((q) => q.section === 'reading'), [questions])
  const listeningSteps = useMemo(() => buildSteps(listeningQuestions), [listeningQuestions])
  const readingSteps = useMemo(() => buildSteps(readingQuestions), [readingQuestions])

  const steps = activeSection === 'listening' ? listeningSteps : readingSteps
  const step = steps[stepIndex]
  const currentAudioPath = activeSection === 'listening' ? step?.questions[0]?.audio_path : null

  // Autoplay audio whenever landing on a listening question (still helpful for
  // practice — user can also just replay via the visible <audio controls>).
  useEffect(() => {
    if (activeSection !== 'listening' || !currentAudioPath || !audioRef.current) return
    audioRef.current.currentTime = 0
    audioRef.current.play().catch(() => {})
  }, [activeSection, currentAudioPath, stepIndex])

  function selectAnswer(questionId: string, index: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: index }))
  }

  function jumpTo(section: 'listening' | 'reading', targetStepIndex: number) {
    setActiveSection(section)
    setStepIndex(targetStepIndex)
  }

  function goNext() {
    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1)
    } else if (activeSection === 'listening' && readingSteps.length > 0) {
      jumpTo('reading', 0)
    }
  }

  function submit() {
    setPhase('result')
    const totalCorrect =
      listeningQuestions.filter((q) => answers[q.id] === q.correct_index).length +
      readingQuestions.filter((q) => answers[q.id] === q.correct_index).length
    const totalQuestions = listeningQuestions.length + readingQuestions.length
    if (totalQuestions > 0 && totalCorrect / totalQuestions >= 0.6) {
      confetti({ particleCount: 100, spread: 75, origin: { y: 0.6 } })
    }
  }

  function retry() {
    setAnswers({})
    setActiveSection('listening')
    setStepIndex(0)
    setPhase('quiz')
  }

  if (loading) {
    return (
      <div className="p-16 text-center">
        <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
      </div>
    )
  }

  if (!paper) {
    return <div className="cartoon-card p-8 text-center text-slate-500 font-bold">Không tìm thấy đề thi.</div>
  }

  if (phase === 'result') {
    return (
      <ResultScreen
        paper={paper}
        listeningQuestions={listeningQuestions}
        readingQuestions={readingQuestions}
        answers={answers}
        onRetry={retry}
        backHref="/practice-exam"
        backLabel="Về Luyện Đề TOCFL"
      />
    )
  }

  const answeredTotal = [...listeningQuestions, ...readingQuestions].filter((q) => answers[q.id] !== undefined).length
  const totalAll = listeningQuestions.length + readingQuestions.length

  return (
    <div className="space-y-4">
      <Link href="/practice-exam" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" /> Quay lại Luyện Đề TOCFL
      </Link>

      <div className="cartoon-panel p-4 flex flex-wrap items-center justify-between gap-3 bg-white sticky top-0 z-10">
        <span className="font-black text-slate-800">{paper.title} — Luyện Tập Tự Do</span>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-500">Đã trả lời {answeredTotal}/{totalAll}</span>
          <button onClick={submit} className="cartoon-btn-danger px-4 py-2 flex items-center gap-1.5 text-xs">
            <Send className="w-3.5 h-3.5" /> Nộp Bài
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => jumpTo('listening', 0)}
          className={`flex-1 cartoon-card p-3 flex items-center justify-center gap-2 ${
            activeSection === 'listening' ? 'ring-2 ring-[#189fec]' : ''
          }`}
        >
          <Headphones className="w-5 h-5 text-blue-500" />
          <span className="font-black text-sm text-slate-700">Phần Nghe</span>
        </button>
        <button
          onClick={() => jumpTo('reading', 0)}
          className={`flex-1 cartoon-card p-3 flex items-center justify-center gap-2 ${
            activeSection === 'reading' ? 'ring-2 ring-[#189fec]' : ''
          }`}
        >
          <BookOpenCheck className="w-5 h-5 text-emerald-500" />
          <span className="font-black text-sm text-slate-700">Phần Đọc</span>
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 space-y-4">
          {activeSection === 'listening' && currentAudioPath && (
            <div className="cartoon-card p-4 bg-blue-50 flex items-center gap-3">
              <Volume2 className="w-6 h-6 text-blue-500 shrink-0 animate-pulse" />
              <div className="flex-1">
                <div className="font-black text-slate-700 text-sm">Âm thanh câu {step.questions[0].question_number}</div>
                <audio key={currentAudioPath} ref={audioRef} src={currentAudioPath} controls className="w-full h-8 mt-1" />
              </div>
            </div>
          )}

          {step ? (
            <StepCard step={step} showPromptText={activeSection === 'reading'} answers={answers} onSelect={selectAnswer} />
          ) : (
            <div className="cartoon-panel p-8 text-center text-slate-400 font-bold">Không có câu hỏi.</div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={stepIndex === 0}
              className="cartoon-btn-secondary px-5 py-2.5 disabled:opacity-40"
            >
              Câu trước
            </button>
            <button onClick={goNext} className="cartoon-btn px-5 py-2.5">
              {stepIndex < steps.length - 1
                ? 'Câu tiếp theo'
                : activeSection === 'listening'
                ? 'Sang Phần Đọc'
                : 'Câu cuối cùng'}
            </button>
          </div>
        </div>

        <div className="lg:w-64 shrink-0 space-y-4">
          <QuestionPalette
            title="Phần Nghe"
            icon={<Headphones className="w-4 h-4 text-blue-500" />}
            steps={listeningSteps}
            answers={answers}
            isActive={activeSection === 'listening'}
            activeStepIndex={activeSection === 'listening' ? stepIndex : -1}
            onJump={(i) => jumpTo('listening', i)}
          />
          <QuestionPalette
            title="Phần Đọc"
            icon={<BookOpenCheck className="w-4 h-4 text-emerald-500" />}
            steps={readingSteps}
            answers={answers}
            isActive={activeSection === 'reading'}
            activeStepIndex={activeSection === 'reading' ? stepIndex : -1}
            onJump={(i) => jumpTo('reading', i)}
          />
        </div>
      </div>
    </div>
  )
}

function QuestionPalette({
  title, icon, steps, answers, isActive, activeStepIndex, onJump,
}: {
  title: string
  icon: React.ReactNode
  steps: ReturnType<typeof buildSteps>
  answers: Record<string, number>
  isActive: boolean
  activeStepIndex: number
  onJump: (index: number) => void
}) {
  return (
    <div className="cartoon-panel p-4 bg-white">
      <div className="font-black text-slate-700 text-sm mb-3 flex items-center gap-1.5">{icon} {title}</div>
      <div className="grid grid-cols-6 lg:grid-cols-5 gap-1.5">
        {steps.map((s, i) => {
          const allAnswered = s.questions.every((q) => answers[q.id] !== undefined)
          const isCurrent = isActive && i === activeStepIndex
          return (
            <button
              key={i}
              onClick={() => onJump(i)}
              className={`w-8 h-8 rounded-lg text-[11px] font-black flex items-center justify-center transition-all ${
                isCurrent
                  ? 'bg-[#189fec] text-white ring-2 ring-offset-1 ring-[#189fec]'
                  : allAnswered
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {s.questions[0].question_number}
            </button>
          )
        })}
      </div>
    </div>
  )
}
