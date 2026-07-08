import { shuffleArray } from '@/lib/utils/shuffle'
import {
  generatePracticeQuestions,
  type PracticeQuestion,
  type PracticeWord,
  type QuestionKind,
} from '@/lib/utils/practiceGenerator'

export interface ComprehensionSubQuestionData {
  id: string
  order_index: number
  question_hanzi: string
  options: string[]
  correct_index: number
}

export interface ComprehensionPassageData {
  id: string
  mode: 'reading' | 'listening'
  passage_hanzi: string
  passage_pinyin: string
  passage_vietnamese: string
  comprehension_questions: ComprehensionSubQuestionData[]
}

/**
 * Turns each fetched passage into an ordered "block" of PracticeQuestion objects (one
 * per sub-question). Blocks are kept together and in order wherever they're used, so a
 * passage's questions always appear right after one another with the passage text
 * available — never scattered individually through the quiz. Each sub-question's
 * options are shuffled independently (matching how every other question type in
 * practiceGenerator.ts randomizes option order).
 */
export function buildPassageBlocks(passages: ComprehensionPassageData[]): PracticeQuestion[][] {
  return passages.map((passage) => {
    const sorted = [...passage.comprehension_questions].sort((a, b) => a.order_index - b.order_index)
    return sorted.map((sub, i) => {
      const correctValue = sub.options[sub.correct_index]
      const options = shuffleArray(sub.options)
      return {
        id: `passage-${sub.id}`,
        type: 'passage',
        mode: passage.mode,
        passageId: passage.id,
        passageHanzi: passage.passage_hanzi,
        passagePinyin: passage.passage_pinyin,
        passageVietnamese: passage.passage_vietnamese,
        subIndex: i + 1,
        subTotal: sorted.length,
        prompt: sub.question_hanzi,
        options,
        correctIndex: options.indexOf(correctValue),
      }
    })
  })
}

/**
 * Builds one section (Listening or Reading) of the Full Mock exam: every available
 * passage block for that section is included first (there are few enough that we
 * always want all of them), then the remainder is filled with discrete questions —
 * mirroring the real exam's structure of a discrete-item part followed by a
 * passage-based part (問答/詞語替換 first, 言談理解/短文閱讀 second).
 */
export function buildMockSection(
  words: PracticeWord[],
  passageBlocks: PracticeQuestion[][],
  count: number,
  discreteTypes: QuestionKind[]
): PracticeQuestion[] {
  const shuffledBlocks = shuffleArray(passageBlocks)
  const passageQuestions: PracticeQuestion[] = []
  for (const block of shuffledBlocks) {
    if (passageQuestions.length + block.length > count) continue
    passageQuestions.push(...block)
  }
  const discreteCount = Math.max(0, count - passageQuestions.length)
  const discreteQuestions = generatePracticeQuestions(words, discreteCount, discreteTypes)
  return [...discreteQuestions, ...passageQuestions]
}

const QUICK_PASSAGE_RATIO = 0.4

/**
 * Builds a Quick Practice set: a mix of discrete vocab questions and passage
 * sub-questions, capped so passages never dominate a short quick-practice session.
 * Unlike the Full Mock (which groups passages into their own "part" at the end),
 * Quick Practice has no formal sections, so blocks are shuffled together freely.
 */
export function buildQuickSet(words: PracticeWord[], passageBlocks: PracticeQuestion[][], count: number): PracticeQuestion[] {
  const maxPassageSubQuestions = Math.floor(count * QUICK_PASSAGE_RATIO)
  const shuffledBlocks = shuffleArray(passageBlocks)
  const chosenBlocks: PracticeQuestion[][] = []
  let used = 0
  for (const block of shuffledBlocks) {
    if (used + block.length > maxPassageSubQuestions) continue
    chosenBlocks.push(block)
    used += block.length
  }

  const discreteCount = count - used
  const discreteQuestions = generatePracticeQuestions(words, discreteCount)

  const allBlocks: PracticeQuestion[][] = [...discreteQuestions.map((q) => [q]), ...chosenBlocks]
  return shuffleArray(allBlocks).flat()
}
