'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { TocflPaper, TocflQuestion, TocflSection } from '@/lib/types/tocfl'
import { estimateBand } from '@/lib/types/tocfl'
import { useTocflPaper, buildSteps, formatTime, StepCard, type Step } from '@/components/tocfl/examShared'
import {
  ArrowLeft, Headphones, BookOpenCheck, Clock, Volume2, ChevronRight, ChevronLeft,
  CheckCircle2, Trophy, RotateCcw, Home,
} from 'lucide-react'
import confetti from 'canvas-confetti'

type Phase = 'intro' | 'listening' | 'reading' | 'result'

export default function TocflExamPage() {
  const params = useParams()
  const paperNumber = Number(params.paper)
  const supabase = createClient()

  const { loading, paper, questions } = useTocflPaper(paperNumber)
  const [phase, setPhase] = useState<Phase>('intro')
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})

  const [listeningStepIndex, setListeningStepIndex] = useState(0)
  const [readingStepIndex, setReadingStepIndex] = useState(0)
  const [timeRemaining, setTimeRemaining] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const listeningQuestions = useMemo(() => questions.filter((q) => q.section === 'listening'), [questions])
  const readingQuestions = useMemo(() => questions.filter((q) => q.section === 'reading'), [questions])
  const listeningSteps = useMemo(() => buildSteps(listeningQuestions), [listeningQuestions])
  const readingSteps = useMemo(() => buildSteps(readingQuestions), [readingQuestions])

  // Countdown timer for whichever section is active
  useEffect(() => {
    if (phase !== 'listening' && phase !== 'reading') return
    if (timeRemaining <= 0) {
      handleTimeUp()
      return
    }
    const t = setTimeout(() => setTimeRemaining((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeRemaining])

  // Autoplay listening audio for the current step's question(s)
  useEffect(() => {
    if (phase !== 'listening') return
    const q = listeningSteps[listeningStepIndex]?.questions[0]
    if (!q?.audio_path || !audioRef.current) return
    audioRef.current.currentTime = 0
    audioRef.current.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, listeningStepIndex])

  async function startExam() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !paper) return
      const { data: attempt } = await supabase
        .from('tocfl_attempts')
        .insert({ user_id: user.id, paper_id: paper.id, status: 'in_progress' })
        .select('id')
        .single()
      setAttemptId(attempt?.id || null)
    } catch (err) {
      console.error('Lỗi khi bắt đầu bài thi:', err)
    }
    setAnswers({})
    setListeningStepIndex(0)
    setReadingStepIndex(0)
    setTimeRemaining((paper?.listening_time_minutes || 60) * 60)
    setPhase('listening')
  }

  function selectAnswer(questionId: string, index: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: index }))
  }

  function goNextListening() {
    if (listeningStepIndex < listeningSteps.length - 1) {
      setListeningStepIndex((i) => i + 1)
    } else {
      enterReading()
    }
  }

  function enterReading() {
    setReadingStepIndex(0)
    setTimeRemaining((paper?.reading_time_minutes || 60) * 60)
    setPhase('reading')
  }

  function handleTimeUp() {
    if (phase === 'listening') {
      enterReading()
    } else if (phase === 'reading') {
      finishExam()
    }
  }

  async function finishExam() {
    const listeningTotal = listeningQuestions.length
    const readingTotal = readingQuestions.length
    const listeningCorrect = listeningQuestions.filter((q) => answers[q.id] === q.correct_index).length
    const readingCorrect = readingQuestions.filter((q) => answers[q.id] === q.correct_index).length
    const totalCorrect = listeningCorrect + readingCorrect
    const totalQuestions = listeningTotal + readingTotal
    const scorePercent = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0
    const bandResult = estimateBand(listeningCorrect, readingCorrect, listeningTotal || readingTotal || 50)

    setPhase('result')
    if (scorePercent >= 60) {
      confetti({ particleCount: 100, spread: 75, origin: { y: 0.6 } })
    }

    try {
      if (attemptId) {
        await supabase
          .from('tocfl_attempts')
          .update({
            status: 'completed',
            listening_correct: listeningCorrect,
            listening_total: listeningTotal,
            reading_correct: readingCorrect,
            reading_total: readingTotal,
            total_correct: totalCorrect,
            total_questions: totalQuestions,
            score_percent: scorePercent,
            band_result: bandResult,
            answers,
            completed_at: new Date().toISOString(),
          })
          .eq('id', attemptId)
      }
    } catch (err) {
      console.error('Lỗi khi lưu kết quả:', err)
    }
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

  return (
    <div className="space-y-6">
      {phase === 'intro' && <IntroScreen paper={paper} onStart={startExam} />}

      {phase === 'listening' && listeningSteps.length > 0 && (
        <ExamRunner
          section="listening"
          paperTitle={paper.title}
          steps={listeningSteps}
          stepIndex={listeningStepIndex}
          timeRemaining={timeRemaining}
          answers={answers}
          onSelect={selectAnswer}
          onNext={goNextListening}
          onJump={null}
          audioRef={audioRef}
        />
      )}

      {phase === 'reading' && readingSteps.length > 0 && (
        <ExamRunner
          section="reading"
          paperTitle={paper.title}
          steps={readingSteps}
          stepIndex={readingStepIndex}
          timeRemaining={timeRemaining}
          answers={answers}
          onSelect={selectAnswer}
          onNext={() =>
            readingStepIndex < readingSteps.length - 1
              ? setReadingStepIndex((i) => i + 1)
              : finishExam()
          }
          onPrev={readingStepIndex > 0 ? () => setReadingStepIndex((i) => i - 1) : undefined}
          onJump={(i) => setReadingStepIndex(i)}
          onSubmit={finishExam}
          audioRef={null}
        />
      )}

      {phase === 'result' && (
        <ResultScreen
          paper={paper}
          listeningQuestions={listeningQuestions}
          readingQuestions={readingQuestions}
          answers={answers}
          onRetry={startExam}
        />
      )}
    </div>
  )
}

function IntroScreen({ paper, onStart }: { paper: TocflPaper; onStart: () => void }) {
  return (
    <div className="space-y-6">
      <Link href="/thi-thu" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" /> Quay lại danh sách đề
      </Link>

      <div className="cartoon-panel p-6 md:p-8 space-y-5 bg-white">
        <h2 className="text-2xl font-black text-slate-800">{paper.title}</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-blue-50 rounded-2xl p-4 flex items-center gap-3">
            <Headphones className="w-8 h-8 text-blue-500 shrink-0" />
            <div>
              <div className="font-black text-slate-800">Phần Nghe — 50 câu</div>
              <div className="text-xs text-slate-500 font-bold">{paper.listening_time_minutes} phút</div>
            </div>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-4 flex items-center gap-3">
            <BookOpenCheck className="w-8 h-8 text-emerald-500 shrink-0" />
            <div>
              <div className="font-black text-slate-800">Phần Đọc — 50 câu</div>
              <div className="text-xs text-slate-500 font-bold">{paper.reading_time_minutes} phút</div>
            </div>
          </div>
        </div>

        <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 text-sm font-semibold text-amber-800 space-y-1.5">
          <p>📌 Đề thi được số hóa từ bộ đề gốc TOCFL Band A — đúng hình ảnh, đúng file nghe cho từng câu.</p>
          <p>📌 Phần nghe: âm thanh phát tự động cho từng câu, không thể quay lại câu trước (giống thi thật).</p>
          <p>📌 Phần đọc: có thể tự do di chuyển giữa các câu, nộp bài bất cứ lúc nào trong thời gian cho phép.</p>
          <p>📌 Điểm số hiển thị sau khi nộp bài là điểm ước tính (số câu đúng / tổng), không phải điểm quy đổi
            chính thức của SC-TOP vì thang điểm gốc không được công bố công khai.</p>
          <p>📌 Muốn luyện tập tự do (không giới hạn thứ tự, nộp bài bất cứ lúc nào cho cả 2 phần)? Vào{' '}
            <Link href="/practice-exam" className="underline font-black">Luyện Đề TOCFL</Link>.</p>
        </div>

        <button onClick={onStart} className="cartoon-btn w-full text-base py-3">
          Bắt Đầu Thi
        </button>
      </div>
    </div>
  )
}

function ExamRunner({
  section, paperTitle, steps, stepIndex, timeRemaining, answers, onSelect, onNext, onPrev, onJump, onSubmit, audioRef,
}: {
  section: TocflSection
  paperTitle: string
  steps: Step[]
  stepIndex: number
  timeRemaining: number
  answers: Record<string, number>
  onSelect: (questionId: string, index: number) => void
  onNext: () => void
  onPrev?: () => void
  onJump: ((index: number) => void) | null
  onSubmit?: () => void
  audioRef: React.RefObject<HTMLAudioElement | null> | null
}) {
  const step = steps[stepIndex]
  const isListening = section === 'listening'
  const currentAudioPath = step?.questions[0]?.audio_path

  const answeredCount = useMemo(() => {
    const allQ = steps.flatMap((s) => s.questions)
    return allQ.filter((q) => answers[q.id] !== undefined).length
  }, [steps, answers])
  const totalQ = steps.reduce((sum, s) => sum + s.questions.length, 0)

  return (
    <div className="space-y-4">
      <div className="cartoon-panel p-4 flex flex-wrap items-center justify-between gap-3 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          {isListening ? (
            <Headphones className="w-5 h-5 text-blue-500" />
          ) : (
            <BookOpenCheck className="w-5 h-5 text-emerald-500" />
          )}
          <span className="font-black text-slate-800">
            {paperTitle} — {isListening ? 'Phần Nghe' : 'Phần Đọc'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold text-slate-500">
            Đã trả lời {answeredCount}/{totalQ}
          </span>
          <span
            className={`flex items-center gap-1.5 font-black px-3 py-1.5 rounded-xl ${
              timeRemaining <= 60 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Clock className="w-4 h-4" /> {formatTime(timeRemaining)}
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 space-y-4">
          {isListening && currentAudioPath && audioRef && (
            <div className="cartoon-card p-4 bg-blue-50 flex items-center gap-3">
              <Volume2 className="w-6 h-6 text-blue-500 shrink-0 animate-pulse" />
              <div className="flex-1">
                <div className="font-black text-slate-700 text-sm">Đang phát âm thanh câu {step.questions[0].question_number}</div>
                <audio
                  key={currentAudioPath}
                  ref={audioRef}
                  src={currentAudioPath}
                  controls
                  className="w-full h-8 mt-1"
                />
              </div>
            </div>
          )}

          <StepCard step={step} showPromptText={!isListening} answers={answers} onSelect={onSelect} />

          <div className="flex items-center justify-between gap-3">
            {onPrev ? (
              <button onClick={onPrev} className="cartoon-btn-secondary px-5 py-2.5 flex items-center gap-1.5">
                <ChevronLeft className="w-4 h-4" /> Câu trước
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {!isListening && onSubmit && (
                <button onClick={onSubmit} className="cartoon-btn-danger px-5 py-2.5">
                  Nộp Bài
                </button>
              )}
              <button onClick={onNext} className="cartoon-btn px-5 py-2.5 flex items-center gap-1.5">
                {stepIndex < steps.length - 1 ? 'Câu tiếp theo' : isListening ? 'Chuyển sang Phần Đọc' : 'Nộp Bài'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {onJump && (
          <div className="lg:w-56 shrink-0">
            <div className="cartoon-panel p-4 bg-white lg:sticky lg:top-24">
              <div className="font-black text-slate-700 text-sm mb-3">Danh sách câu hỏi</div>
              <div className="grid grid-cols-6 lg:grid-cols-5 gap-1.5">
                {steps.map((s, i) => {
                  const allAnswered = s.questions.every((q) => answers[q.id] !== undefined)
                  const isCurrent = i === stepIndex
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
          </div>
        )}
      </div>
    </div>
  )
}

export function ResultScreen({
  paper, listeningQuestions, readingQuestions, answers, onRetry, backHref = '/thi-thu', backLabel = 'Về Danh Sách Đề',
}: {
  paper: TocflPaper
  listeningQuestions: TocflQuestion[]
  readingQuestions: TocflQuestion[]
  answers: Record<string, number>
  onRetry: () => void
  backHref?: string
  backLabel?: string
}) {
  const listeningCorrect = listeningQuestions.filter((q) => answers[q.id] === q.correct_index).length
  const readingCorrect = readingQuestions.filter((q) => answers[q.id] === q.correct_index).length
  const totalCorrect = listeningCorrect + readingCorrect
  const totalQuestions = listeningQuestions.length + readingQuestions.length
  const scorePercent = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0
  const bandResult = estimateBand(listeningCorrect, readingCorrect, listeningQuestions.length || 50)

  return (
    <div className="space-y-6">
      <div className="cartoon-panel p-6 md:p-8 bg-white text-center space-y-4">
        <Trophy className="w-14 h-14 text-amber-400 mx-auto" />
        <h2 className="text-xl font-black text-slate-800">{paper.title} — Kết Quả</h2>
        <div className="text-5xl font-black text-[#189fec]">{scorePercent.toFixed(0)}%</div>
        <div className="inline-block bg-amber-100 text-amber-700 font-black px-4 py-1.5 rounded-full text-sm">
          Ước tính: {bandResult}
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 max-w-md mx-auto">
          <div className="bg-blue-50 rounded-2xl p-4">
            <Headphones className="w-6 h-6 text-blue-500 mx-auto mb-1" />
            <div className="font-black text-slate-800">{listeningCorrect}/{listeningQuestions.length}</div>
            <div className="text-xs font-bold text-slate-500">Nghe</div>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-4">
            <BookOpenCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
            <div className="font-black text-slate-800">{readingCorrect}/{readingQuestions.length}</div>
            <div className="text-xs font-bold text-slate-500">Đọc</div>
          </div>
        </div>

        <p className="text-xs font-semibold text-slate-400 max-w-md mx-auto pt-2">
          Điểm ước tính dựa trên số câu trả lời đúng, không phải thang điểm quy đổi chính thức của SC-TOP.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-3">
          <button onClick={onRetry} className="cartoon-btn flex items-center justify-center gap-2">
            <RotateCcw className="w-4 h-4" /> Thi Lại Đề Này
          </button>
          <Link href={backHref} className="cartoon-btn-secondary flex items-center justify-center gap-2 px-4">
            <Home className="w-4 h-4" /> {backLabel}
          </Link>
        </div>
      </div>

      <ReviewList
        title="Chi tiết Phần Nghe"
        icon={<Headphones className="w-5 h-5 text-blue-500" />}
        questions={listeningQuestions}
        answers={answers}
      />
      <ReviewList
        title="Chi tiết Phần Đọc"
        icon={<BookOpenCheck className="w-5 h-5 text-emerald-500" />}
        questions={readingQuestions}
        answers={answers}
      />
    </div>
  )
}

function ReviewList({
  title, icon, questions, answers,
}: {
  title: string
  icon: React.ReactNode
  questions: TocflQuestion[]
  answers: Record<string, number>
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cartoon-panel bg-white overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-center justify-between">
        <span className="font-black text-slate-800 flex items-center gap-2">{icon} {title}</span>
        <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="p-4 pt-0 grid grid-cols-8 sm:grid-cols-10 gap-1.5">
          {questions.map((q) => {
            const isCorrect = answers[q.id] === q.correct_index
            const isAnswered = answers[q.id] !== undefined
            return (
              <div
                key={q.id}
                title={`Câu ${q.question_number}: ${isAnswered ? (isCorrect ? 'Đúng' : 'Sai') : 'Chưa trả lời'}`}
                className={`aspect-square rounded-lg flex items-center justify-center text-[11px] font-black ${
                  !isAnswered
                    ? 'bg-slate-100 text-slate-400'
                    : isCorrect
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-rose-100 text-rose-600'
                }`}
              >
                {isAnswered ? (isCorrect ? <CheckCircle2 className="w-3.5 h-3.5" /> : q.question_number) : q.question_number}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
