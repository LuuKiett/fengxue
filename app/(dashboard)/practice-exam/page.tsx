'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { TocflPaper } from '@/lib/types/tocfl'
import { sortLevels } from '@/lib/utils/dictionaryLevels'
import {
  LISTENING_TYPES,
  FULL_MOCK_READING_TYPES,
  type PracticeQuestion,
  type PracticeWord,
} from '@/lib/utils/practiceGenerator'
import { buildPassageBlocks, buildMockSection, buildQuickSet, type ComprehensionPassageData } from '@/lib/utils/examGenerator'
import { speak } from '@/lib/utils/speak'
import {
  Sparkles,
  Volume2,
  ArrowRight,
  CheckCircle,
  XCircle,
  Trophy,
  RotateCcw,
  ExternalLink,
  ClipboardList,
  Clock,
  Headphones,
  BookOpenCheck,
} from 'lucide-react'
import confetti from 'canvas-confetti'

const QUESTION_COUNTS = [20, 30, 50]
// Matches the real TOCFL Band A (A1+A2) test structure: 100 questions total,
// 120 minutes total, split into a 50-question/60-minute listening section and a
// 50-question/60-minute reading section (per tocfl.edu.tw's published format).
const LISTENING_COUNT = 50
const READING_COUNT = 50
const SECTION_TIME = 60 * 60

// Speaks a two-speaker dialogue line by line ("A：…\nB：…"), stripping the speaker
// label before speaking it and alternating pitch per speaker so the two voices are
// easier to tell apart by ear — there's no real multi-voice TTS available here.
function speakDialogue(passageHanzi: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const lines = passageHanzi.split('\n').filter((l) => l.trim().length > 0)
  lines.forEach((line, i) => {
    const spoken = line.replace(/^\s*[^\s:：]{1,2}[:：]\s*/, '')
    speak(spoken, { pitch: i % 2 === 0 ? 1 : 1.3 })
  })
}

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function PracticeExamPage() {
  const supabase = createClient()

  const [levels, setLevels] = useState<string[]>([])
  const [loadingLevels, setLoadingLevels] = useState(true)

  const [examMode, setExamMode] = useState<'quick' | 'full'>('quick')
  const [step, setStep] = useState<'select' | 'quiz' | 'result'>('select')
  const [level, setLevel] = useState<string | null>(null)
  const [questionCount, setQuestionCount] = useState(20)
  const [loadingQuiz, setLoadingQuiz] = useState(false)

  const [section, setSection] = useState<'listening' | 'reading' | null>(null)
  const [timeRemaining, setTimeRemaining] = useState(SECTION_TIME)

  const [questions, setQuestions] = useState<PracticeQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [reorderBank, setReorderBank] = useState<string[]>([])
  const [reorderAnswer, setReorderAnswer] = useState<string[]>([])
  const [answered, setAnswered] = useState(false)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [score, setScore] = useState(0)
  const [sectionScores, setSectionScores] = useState({ listening: 0, reading: 0 })
  // Listening passages hide their hanzi transcript by default (revealing it would let
  // you read the answer instead of listening for it) — this toggles a manual reveal.
  const [showTranscript, setShowTranscript] = useState(false)

  const [officialPapers, setOfficialPapers] = useState<TocflPaper[]>([])

  useEffect(() => {
    async function loadPapers() {
      const { data } = await supabase.from('tocfl_papers').select('*').eq('band', 'A').order('paper_number')
      setOfficialPapers((data || []) as TocflPaper[])
    }
    loadPapers()
  }, [supabase])

  useEffect(() => {
    async function loadLevels() {
      setLoadingLevels(true)
      try {
        const { data } = await supabase.from('dictionary_words').select('level')
        const uniqueLevels = sortLevels(Array.from(new Set((data || []).map((w) => w.level))))
        setLevels(uniqueLevels)
      } catch (err) {
        console.error('Lỗi khi tải cấp độ:', err)
      } finally {
        setLoadingLevels(false)
      }
    }
    loadLevels()
  }, [supabase])

  const currentQuestion = questions[currentIndex]
  const isListeningQuestion =
    examMode === 'full' && section === 'listening' && currentQuestion?.type === 'mcq' && currentQuestion.promptIsHanzi
  const isListeningPassage = currentQuestion?.type === 'passage' && currentQuestion.mode === 'listening'
  const isPictureQuestion = currentQuestion?.type === 'picture'
  // Real exams never reveal per-question correctness — only the final score. Quick
  // practice is the opposite: instant right/wrong feedback is the point, so you learn
  // as you go. `answered` still gates advancing to the next question in both modes;
  // this only controls whether the answer is actually *shown*.
  const showFeedback = answered && examMode === 'quick'

  // Countdown for the "full mock exam" mode, matching real per-section time limits.
  useEffect(() => {
    if (step !== 'quiz' || examMode !== 'full') return
    if (timeRemaining <= 0) {
      handleTimeUp()
      return
    }
    const t = setTimeout(() => setTimeRemaining((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, examMode, timeRemaining])

  // Auto-play the word's pronunciation for listening-section questions.
  useEffect(() => {
    if (isListeningQuestion && currentQuestion?.type === 'mcq') {
      speak(currentQuestion.prompt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isListeningQuestion])

  // Auto-play the word for picture-choice (看圖辨義) questions — same idea as the plain
  // listening MCQ above, just a separate question type since the options are emoji.
  useEffect(() => {
    if (isPictureQuestion && currentQuestion?.type === 'picture') {
      speak(currentQuestion.prompt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isPictureQuestion])

  // Auto-play listening-dialogue passages every time their question comes up (a
  // passage spans multiple consecutive sub-questions, and since each is its own
  // screen, replaying on every one of them means you never land on a sub-question
  // without having just heard the audio for it).
  useEffect(() => {
    if (isListeningPassage && currentQuestion?.type === 'passage') {
      speakDialogue(currentQuestion.passageHanzi)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isListeningPassage])

  const startQuiz = async (lvl: string) => {
    setLevel(lvl)
    setLoadingQuiz(true)
    try {
      const [{ data }, { data: passageData }] = await Promise.all([
        supabase
          .from('dictionary_words')
          .select('id, hanzi, pinyin, vietnamese, pos, example_hanzi, example_pinyin, example_vietnamese')
          .eq('level', lvl),
        supabase
          .from('comprehension_passages')
          .select('id, mode, passage_hanzi, passage_pinyin, passage_vietnamese, comprehension_questions(id, order_index, question_hanzi, options, correct_index)')
          .eq('level', lvl),
      ])

      const words = (data || []) as PracticeWord[]
      const passages = (passageData || []) as ComprehensionPassageData[]

      let generated: PracticeQuestion[]
      if (examMode === 'full') {
        const listeningBlocks = buildPassageBlocks(passages.filter((p) => p.mode === 'listening'))
        const readingBlocks = buildPassageBlocks(passages.filter((p) => p.mode === 'reading'))
        const listeningQs = buildMockSection(words, listeningBlocks, LISTENING_COUNT, LISTENING_TYPES)
        const readingQs = buildMockSection(words, readingBlocks, READING_COUNT, FULL_MOCK_READING_TYPES)
        generated = [...listeningQs, ...readingQs]
        setSection('listening')
        setTimeRemaining(SECTION_TIME)
      } else {
        const allBlocks = buildPassageBlocks(passages)
        generated = buildQuickSet(words, allBlocks, questionCount)
        setSection(null)
      }

      setQuestions(generated)
      setCurrentIndex(0)
      setScore(0)
      setSectionScores({ listening: 0, reading: 0 })
      setupQuestionState(generated[0])
      setStep('quiz')
    } catch (err) {
      console.error('Lỗi khi tạo đề luyện tập:', err)
    } finally {
      setLoadingQuiz(false)
    }
  }

  const setupQuestionState = (q: PracticeQuestion | undefined) => {
    setSelectedIndex(null)
    setAnswered(false)
    setIsCorrect(null)
    setShowTranscript(false)
    if (q?.type === 'reorder') {
      setReorderBank(q.segments)
      setReorderAnswer([])
    }
  }

  const recordAnswer = (correct: boolean) => {
    if (correct) {
      setScore((s) => s + 1)
      if (examMode === 'full' && section) {
        setSectionScores((prev) => ({ ...prev, [section]: prev[section] + 1 }))
      }
    }
  }

  const handleSelectOption = (optionIndex: number) => {
    if (answered || !currentQuestion) return
    if (currentQuestion.type !== 'mcq' && currentQuestion.type !== 'cloze' && currentQuestion.type !== 'passage' && currentQuestion.type !== 'picture') return

    const correct = optionIndex === currentQuestion.correctIndex
    setSelectedIndex(optionIndex)
    setAnswered(true)
    setIsCorrect(correct)
    recordAnswer(correct)
  }

  const handleReorderPick = (segment: string, bankIndex: number) => {
    if (answered) return
    setReorderBank((prev) => prev.filter((_, i) => i !== bankIndex))
    setReorderAnswer((prev) => [...prev, segment])
  }

  const handleReorderUndo = (answerIndex: number) => {
    if (answered) return
    const segment = reorderAnswer[answerIndex]
    setReorderAnswer((prev) => prev.filter((_, i) => i !== answerIndex))
    setReorderBank((prev) => [...prev, segment])
  }

  const handleCheckReorder = () => {
    if (!currentQuestion || currentQuestion.type !== 'reorder' || answered) return
    const correct = reorderAnswer.join('') === currentQuestion.correctOrder.join('')
    setAnswered(true)
    setIsCorrect(correct)
    recordAnswer(correct)
  }

  const handleNext = async () => {
    if (currentIndex < questions.length - 1) {
      const nextIndex = currentIndex + 1
      if (examMode === 'full' && nextIndex === LISTENING_COUNT) {
        setSection('reading')
        setTimeRemaining(SECTION_TIME)
      }
      setCurrentIndex(nextIndex)
      setupQuestionState(questions[nextIndex])
    } else {
      await finishQuiz()
    }
  }

  const handleTimeUp = () => {
    if (section === 'listening' && questions.length > LISTENING_COUNT) {
      setSection('reading')
      setTimeRemaining(SECTION_TIME)
      setCurrentIndex(LISTENING_COUNT)
      setupQuestionState(questions[LISTENING_COUNT])
    } else {
      finishQuiz()
    }
  }

  const finishQuiz = async () => {
    setStep('result')
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } })
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !level) return
      await supabase.from('practice_sessions').insert({
        user_id: user.id,
        level,
        total_questions: questions.length,
        correct_count: score,
      })
    } catch (err) {
      console.error('Lỗi khi lưu kết quả luyện tập:', err)
    }
  }

  const backToSelect = () => {
    setStep('select')
    setLevel(null)
    setQuestions([])
    setSection(null)
  }

  const sectionQuestionNumber =
    examMode === 'full' && section === 'reading' ? currentIndex - LISTENING_COUNT + 1 : currentIndex + 1
  const sectionQuestionTotal =
    examMode === 'full' ? (section === 'listening' ? LISTENING_COUNT : READING_COUNT) : questions.length

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
        <span>📝</span> Luyện Đề TOCFL
      </h2>

      {step === 'select' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-400 to-sky-500 text-white p-6 rounded-[24px] shadow-sm space-y-2">
            <h3 className="text-xl font-extrabold flex items-center gap-2">
              <Sparkles className="w-6 h-6 animate-pulse" /> Luyện Đề Trắc Nghiệm
            </h3>
            <p className="font-semibold text-sm text-white/90">
              Đề được tự động sinh ra từ bộ từ điển TOCFL đã import (trắc nghiệm, điền từ vào câu, sắp xếp câu),
              kèm đoạn hội thoại nghe và đoạn văn đọc hiểu, xáo trộn khác nhau mỗi lần làm để luyện tập hiệu quả cho kỳ thi A1/A2.
            </p>
          </div>

          {officialPapers.length > 0 && (
            <div className="cartoon-panel p-5 bg-white space-y-3">
              <h4 className="font-extrabold text-slate-800 flex items-center gap-1.5">
                <Trophy className="w-5 h-5 text-amber-400" /> 5 Đề Chính Thức (Bộ Đề Thật TOCFL Band A)
              </h4>
              <p className="text-xs text-slate-500 font-semibold">
                Luyện tập tự do trên đúng nội dung đề thi thật — có thể nhảy tới bất kỳ câu nào, nộp bài bất cứ lúc
                nào, làm được bao nhiêu tính điểm bấy nhiêu. Muốn thi có tính giờ và lưu lịch sử điểm? Vào{' '}
                <Link href="/thi-thu" className="underline">Thi Thử TOCFL</Link>.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {officialPapers.map((p) => (
                  <Link
                    key={p.id}
                    href={`/practice-exam/${p.paper_number}`}
                    className="cartoon-card p-3 text-center font-black text-slate-700 hover:text-[#189fec]"
                  >
                    Đề {p.paper_number}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Exam mode toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setExamMode('quick')}
              className={`cartoon-card p-4 text-left space-y-1 ${examMode === 'quick' ? 'ring-2 ring-[#1877f2]' : ''}`}
            >
              <span className="font-black text-slate-800 block">⚡ Luyện Tập Nhanh</span>
              <span className="text-xs text-slate-500 font-semibold">Chọn số câu tùy ý, không giới hạn thời gian.</span>
            </button>
            <button
              onClick={() => setExamMode('full')}
              className={`cartoon-card p-4 text-left space-y-1 ${examMode === 'full' ? 'ring-2 ring-[#1877f2]' : ''}`}
            >
              <span className="font-black text-slate-800 block">🎯 Thi Thử Đầy Đủ</span>
              <span className="text-xs text-slate-500 font-semibold">100 câu — đúng cấu trúc đề thi TOCFL Band A thật.</span>
            </button>
          </div>

          <div className="cartoon-card p-6 bg-white space-y-4">
            <h4 className="font-extrabold text-slate-800">Chọn cấp độ:</h4>
            {loadingLevels ? (
              <div className="p-6 text-center">
                <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {levels.map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setLevel(lvl)}
                    className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${
                      level === lvl
                        ? 'bg-[#1877f2] text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            )}

            {examMode === 'quick' ? (
              <>
                <h4 className="font-extrabold text-slate-800 pt-2">Số câu hỏi:</h4>
                <div className="flex gap-2">
                  {QUESTION_COUNTS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setQuestionCount(c)}
                      className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${
                        questionCount === c
                          ? 'bg-[#1877f2] text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {c} câu
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-blue-50 rounded-2xl p-3 flex items-center gap-2.5">
                  <Headphones className="w-6 h-6 text-blue-500 shrink-0" />
                  <div>
                    <div className="font-black text-slate-800 text-sm">Nghe: 50 câu</div>
                    <div className="text-[11px] text-slate-500 font-bold">60 phút</div>
                  </div>
                </div>
                <div className="bg-emerald-50 rounded-2xl p-3 flex items-center gap-2.5">
                  <BookOpenCheck className="w-6 h-6 text-emerald-500 shrink-0" />
                  <div>
                    <div className="font-black text-slate-800 text-sm">Đọc: 50 câu</div>
                    <div className="text-[11px] text-slate-500 font-bold">60 phút</div>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => level && startQuiz(level)}
              disabled={!level || loadingQuiz}
              className="cartoon-btn w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loadingQuiz ? 'Đang tạo đề...' : 'Bắt Đầu Luyện Đề'} <ArrowRight className="w-5 h-5" />
            </button>
          </div>

          <div className="cartoon-card p-5 bg-white space-y-2">
            <h4 className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm">
              <ClipboardList className="w-4 h-4 text-blue-500" /> Tài liệu chính thức
            </h4>
            <p className="text-xs text-slate-500 font-semibold">
              Muốn làm đề thi thử và nghe file âm thanh chính thức của TOCFL? Ủy ban華測會 (SC-TOP) phát hành miễn phí tại:
            </p>
            <a
              href="https://tocfl.edu.tw/tocfl/index.php/exam/test/page/19"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-black text-blue-500 hover:underline flex items-center gap-1"
            >
              tocfl.edu.tw — Mô Phỏng Thí Đề <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {step === 'quiz' && currentQuestion && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <span className="font-black text-slate-800 text-sm block">
                {examMode === 'full' ? (section === 'listening' ? '🎧 Phần Nghe' : '📖 Phần Đọc') : level}
              </span>
              <span className="text-[10px] text-slate-400 font-bold uppercase">
                Câu {sectionQuestionNumber}/{sectionQuestionTotal}
                {examMode === 'full' &&
                  (currentQuestion.type === 'passage'
                    ? ` · Phần 2: ${currentQuestion.mode === 'listening' ? 'Hội thoại' : 'Đoạn văn'} (câu ${currentQuestion.subIndex}/${currentQuestion.subTotal})`
                    : ' · Phần 1: Câu rời rạc')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {examMode === 'full' && (
                <span
                  className={`flex items-center gap-1 font-mono font-black text-sm px-2.5 py-1 rounded-lg ${
                    timeRemaining < 60 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" /> {formatTime(timeRemaining)}
                </span>
              )}
              <button onClick={backToSelect} className="font-extrabold text-xs text-red-500 hover:underline">
                Thoát
              </button>
            </div>
          </div>

          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 transition-all duration-300"
              style={{ width: `${((sectionQuestionNumber - 1) / sectionQuestionTotal) * 100}%` }}
            />
          </div>

          <div className="cartoon-card bg-white p-6 space-y-5 w-full">
            {currentQuestion.type === 'mcq' && (
              <>
                {isListeningQuestion ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <button
                      onClick={() => speak(currentQuestion.prompt)}
                      className="w-20 h-20 rounded-full bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-blue-500 hover:bg-blue-100 transition-all"
                    >
                      <Volume2 className="w-9 h-9" />
                    </button>
                    <span className="text-xs font-bold text-slate-400">Nghe và chọn đáp án đúng</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <span className={currentQuestion.promptIsHanzi ? 'font-chinese text-6xl font-bold text-slate-800' : 'text-4xl font-extrabold text-slate-800 text-center'}>
                      {currentQuestion.prompt}
                    </span>
                    {currentQuestion.promptIsHanzi && (
                      <button onClick={() => speak(currentQuestion.prompt)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400">
                        <Volume2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {currentQuestion.options.map((opt, i) => {
                    const isSelected = selectedIndex === i
                    const isCorrectOption = i === currentQuestion.correctIndex
                    let cls = 'bg-white border-slate-200 hover:bg-slate-50'
                    if (showFeedback && isCorrectOption) cls = 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    else if (showFeedback && isSelected && !isCorrectOption) cls = 'bg-red-50 border-red-300 text-red-600 animate-shake'
                    else if (answered && isSelected) cls = 'bg-blue-50 border-blue-300 text-blue-700'
                    return (
                      <button
                        key={i}
                        onClick={() => handleSelectOption(i)}
                        disabled={answered}
                        className={`p-3 rounded-2xl border-2 font-bold text-4xl transition-all ${cls} ${
                          currentQuestion.kind === 'viet_hanzi' || currentQuestion.kind === 'listen_hanzi'
                            ? 'font-chinese text-4xl'
                            : ''
                        }`}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {currentQuestion.type === 'picture' && (
              <>
                <div className="flex flex-col items-center gap-3 py-2">
                  <button
                    onClick={() => speak(currentQuestion.prompt)}
                    className="w-20 h-20 rounded-full bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-blue-500 hover:bg-blue-100 transition-all"
                    title="Nghe lại"
                  >
                    <Volume2 className="w-9 h-9" />
                  </button>
                  <span className="text-xs font-bold text-slate-400">Nghe và chọn hình đúng</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {currentQuestion.options.map((opt, i) => {
                    const isSelected = selectedIndex === i
                    const isCorrectOption = i === currentQuestion.correctIndex
                    let cls = 'bg-white border-slate-200 hover:bg-slate-50'
                    if (showFeedback && isCorrectOption) cls = 'bg-emerald-50 border-emerald-300'
                    else if (showFeedback && isSelected && !isCorrectOption) cls = 'bg-red-50 border-red-300 animate-shake'
                    else if (answered && isSelected) cls = 'bg-blue-50 border-blue-300'
                    return (
                      <button
                        key={i}
                        onClick={() => handleSelectOption(i)}
                        disabled={answered}
                        className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-1.5 ${cls}`}
                      >
                        <span className="text-[10px] font-black text-slate-400">{String.fromCharCode(65 + i)}</span>
                        <span className="text-6xl leading-none">{opt}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {currentQuestion.type === 'cloze' && (
              <>
                <div className="text-center space-y-2">
                  <p className="font-chinese text-4xl font-bold text-slate-800 leading-relaxed">
                    {currentQuestion.before}
                    <span className="inline-block min-w-[2.5rem] border-b-4 border-dashed border-blue-400 mx-1 text-blue-400">
                      {showFeedback ? currentQuestion.answer : '   '}
                    </span>
                    {currentQuestion.after}
                  </p>
                  <p className="text-xs text-blue-500 italic">{currentQuestion.pinyinHint}</p>
                  <p className="text-xs text-slate-500 font-semibold">{currentQuestion.vietnameseHint}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {currentQuestion.options.map((opt, i) => {
                    const isSelected = selectedIndex === i
                    const isCorrectOption = i === currentQuestion.correctIndex
                    let cls = 'bg-white border-slate-200 hover:bg-slate-50'
                    if (showFeedback && isCorrectOption) cls = 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    else if (showFeedback && isSelected && !isCorrectOption) cls = 'bg-red-50 border-red-300 text-red-600 animate-shake'
                    else if (answered && isSelected) cls = 'bg-blue-50 border-blue-300 text-blue-700'
                    return (
                      <button
                        key={i}
                        onClick={() => handleSelectOption(i)}
                        disabled={answered}
                        className={`p-3 rounded-2xl border-2 font-chinese font-bold text-3xl transition-all ${cls}`}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {currentQuestion.type === 'reorder' && (
              <>
                <p className="text-xs text-slate-500 font-semibold text-center">{currentQuestion.vietnameseHint}</p>
                <div className="min-h-[3.5rem] flex flex-wrap gap-2 justify-center p-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  {reorderAnswer.length === 0 && (
                    <span className="text-xs text-slate-300 font-semibold py-2">Chạm vào các mảnh bên dưới để ghép câu</span>
                  )}
                  {reorderAnswer.map((seg, i) => (
                    <button
                      key={i}
                      onClick={() => handleReorderUndo(i)}
                      disabled={answered}
                      className="font-chinese font-bold text-4xl px-3 py-1.5 rounded-xl bg-blue-100 text-blue-700 border border-blue-200"
                    >
                      {seg}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {reorderBank.map((seg, i) => (
                    <button
                      key={i}
                      onClick={() => handleReorderPick(seg, i)}
                      disabled={answered}
                      className="font-chinese font-bold text-4xl px-3 py-1.5 rounded-xl bg-white border-2 border-slate-200 hover:bg-slate-50"
                    >
                      {seg}
                    </button>
                  ))}
                </div>
                {showFeedback && isCorrect === false && (
                  <p className="text-center text-sm font-bold text-red-500">
                    Đáp án đúng: <span className="font-chinese text-4xl">{currentQuestion.correctOrder.join('')}</span>
                  </p>
                )}
                {!answered && (
                  <button
                    onClick={handleCheckReorder}
                    disabled={reorderBank.length > 0}
                    className="cartoon-btn cartoon-btn-secondary w-full py-2.5 text-sm disabled:opacity-40"
                  >
                    Kiểm Tra
                  </button>
                )}
              </>
            )}

            {currentQuestion.type === 'passage' && (
              <>
                {currentQuestion.mode === 'reading' ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-left">
                    <p className="font-chinese text-2xl font-bold text-slate-800 leading-relaxed whitespace-pre-line">
                      {currentQuestion.passageHanzi}
                    </p>
                    <p className="text-xs text-blue-500 italic">{currentQuestion.passagePinyin}</p>
                    <p className="text-xs text-slate-500 font-semibold">{currentQuestion.passageVietnamese}</p>
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 text-center">
                    <button
                      onClick={() => speakDialogue(currentQuestion.passageHanzi)}
                      className="w-16 h-16 rounded-full bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-blue-500 hover:bg-blue-100 transition-all mx-auto"
                      title="Nghe lại hội thoại"
                    >
                      <Volume2 className="w-7 h-7" />
                    </button>
                    <button
                      onClick={() => setShowTranscript((s) => !s)}
                      className="text-xs font-bold text-blue-500 hover:underline block mx-auto"
                    >
                      {showTranscript ? 'Ẩn lời thoại' : 'Hiện lời thoại'}
                    </button>
                    {showTranscript && (
                      <div className="text-left space-y-1 pt-2 border-t border-slate-200">
                        <p className="font-chinese text-xl font-bold text-slate-800 whitespace-pre-line">
                          {currentQuestion.passageHanzi}
                        </p>
                        <p className="text-xs text-blue-500 italic whitespace-pre-line">{currentQuestion.passagePinyin}</p>
                        <p className="text-xs text-slate-500 font-semibold">{currentQuestion.passageVietnamese}</p>
                      </div>
                    )}
                  </div>
                )}

                <p className="font-chinese text-3xl font-bold text-slate-800 text-center">{currentQuestion.prompt}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {currentQuestion.options.map((opt, i) => {
                    const isSelected = selectedIndex === i
                    const isCorrectOption = i === currentQuestion.correctIndex
                    let cls = 'bg-white border-slate-200 hover:bg-slate-50'
                    if (showFeedback && isCorrectOption) cls = 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    else if (showFeedback && isSelected && !isCorrectOption) cls = 'bg-red-50 border-red-300 text-red-600 animate-shake'
                    else if (answered && isSelected) cls = 'bg-blue-50 border-blue-300 text-blue-700'
                    return (
                      <button
                        key={i}
                        onClick={() => handleSelectOption(i)}
                        disabled={answered}
                        className={`p-3 rounded-2xl border-2 font-chinese font-bold text-2xl transition-all ${cls}`}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {showFeedback && (
              <div className={`flex items-center justify-center gap-2 font-black text-sm ${isCorrect ? 'text-emerald-600' : 'text-red-500'}`}>
                {isCorrect ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                {isCorrect ? 'Chính xác!' : 'Chưa đúng'}
              </div>
            )}
            {answered && examMode === 'full' && (
              <div className="flex items-center justify-center gap-2 font-black text-sm text-blue-500">
                <CheckCircle className="w-5 h-5" /> Đã ghi nhận đáp án
              </div>
            )}
          </div>

          <button
            onClick={handleNext}
            disabled={!answered}
            className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            {currentIndex === questions.length - 1 ? 'Xem Kết Quả' : 'Câu Tiếp Theo'} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 'result' && (
        <div className="cartoon-card bg-white p-8 text-center space-y-6 animate-float max-w-md mx-auto">
          <div className="w-20 h-20 bg-amber-100 rounded-full shadow-md flex items-center justify-center text-amber-500 mx-auto">
            <Trophy className="w-12 h-12" />
          </div>
          <div className="space-y-2">
            <h3 className="text-3xl font-black text-slate-800">Hoàn Thành! 🎉</h3>
            <p className="text-slate-500 font-bold">
              Bạn trả lời đúng {score}/{questions.length} câu ({Math.round((score / questions.length) * 100)}%) ở cấp độ {level}.
            </p>
          </div>

          {examMode === 'full' && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-blue-50 rounded-xl p-3">
                <div className="font-black text-blue-600 text-lg">{sectionScores.listening}/{LISTENING_COUNT}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Nghe</div>
              </div>
              <div className="bg-emerald-50 rounded-xl p-3">
                <div className="font-black text-emerald-600 text-lg">{sectionScores.reading}/{READING_COUNT}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Đọc</div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={() => level && startQuiz(level)}
              className="cartoon-btn w-full py-3 text-sm flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Làm Đề Khác
            </button>
            <button onClick={backToSelect} className="cartoon-btn-secondary w-full py-3 text-sm">
              Chọn Cấp Độ Khác
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
