import { shuffleArray } from '@/lib/utils/shuffle'

export interface PracticeWord {
  id: string
  hanzi: string
  pinyin: string
  vietnamese: string
  pos: string | null
  example_hanzi: string | null
  example_pinyin: string | null
  example_vietnamese: string | null
}

export type PracticeQuestion =
  | {
      id: string
      type: 'mcq'
      kind: 'hanzi_pinyin' | 'hanzi_viet' | 'viet_hanzi' | 'listen_hanzi'
      prompt: string
      promptIsHanzi: boolean
      options: string[]
      correctIndex: number
    }
  | {
      id: string
      type: 'cloze'
      before: string
      after: string
      answer: string
      pinyinHint: string
      vietnameseHint: string
      options: string[]
      correctIndex: number
    }
  | {
      id: string
      type: 'reorder'
      segments: string[]
      correctOrder: string[]
      vietnameseHint: string
    }

// Connector phrases from scripts/generate-dictionary-examples.js's templates (minus the
// {w}/{m} slots) plus a handful of common function words — used so the sentence-reorder
// exercise can chunk a generated example sentence into sensible pieces without needing
// full Chinese word segmentation.
const KNOWN_CHUNKS = [
  '這是', '我有一個', '你喜歡', '他現在要', '你想', '我每天', '今天很', '這個很', '我覺得很',
  '他', '來學校', '都很忙', '我在學習', '這個詞', '請用', '造句', '是很常用的詞',
  '我', '你', '她', '我們', '嗎', '「', '」', '。', '？', '！',
]

function segmentHanzi(sentence: string, vocabHanzi: string[]): string[] {
  const known = new Set([...KNOWN_CHUNKS, ...vocabHanzi])
  const maxLen = Math.max(...Array.from(known, (w) => w.length), 1)
  const segments: string[] = []
  let i = 0
  while (i < sentence.length) {
    let matched: string | null = null
    for (let len = Math.min(maxLen, sentence.length - i); len >= 1; len--) {
      const candidate = sentence.slice(i, i + len)
      if (known.has(candidate)) { matched = candidate; break }
    }
    const piece = matched || sentence[i]
    segments.push(piece)
    i += piece.length
  }
  return segments.filter((s) => s.trim().length > 0)
}

function pickDistractors(pool: PracticeWord[], excludeId: string, field: 'pinyin' | 'vietnamese' | 'hanzi', count: number): string[] {
  const candidates = shuffleArray(pool.filter((w) => w.id !== excludeId))
  const seen = new Set<string>()
  const result: string[] = []
  for (const c of candidates) {
    const value = c[field]
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length >= count) break
  }
  return result
}

function makeMcq(word: PracticeWord, pool: PracticeWord[], kind: 'hanzi_pinyin' | 'hanzi_viet' | 'viet_hanzi'): PracticeQuestion | null {
  const field = kind === 'hanzi_pinyin' ? 'pinyin' : kind === 'hanzi_viet' ? 'vietnamese' : 'hanzi'
  const correct = word[field]
  if (!correct) return null

  const distractors = pickDistractors(pool, word.id, field, 3)
  if (distractors.length < 3) return null

  const options = shuffleArray([correct, ...distractors])
  return {
    id: `mcq-${kind}-${word.id}`,
    type: 'mcq',
    kind,
    prompt: kind === 'viet_hanzi' ? word.vietnamese : word.hanzi,
    promptIsHanzi: kind !== 'viet_hanzi',
    options,
    correctIndex: options.indexOf(correct),
  }
}

// Real TOCFL listening comprehension: you hear the word spoken and must pick the
// matching HANZI from the options (not pinyin, not the Vietnamese meaning) — this is
// what actually tests whether you recognize the character by ear.
function makeListeningMcq(word: PracticeWord, pool: PracticeWord[]): PracticeQuestion | null {
  const correct = word.hanzi
  const distractors = pickDistractors(pool, word.id, 'hanzi', 3)
  if (distractors.length < 3) return null

  const options = shuffleArray([correct, ...distractors])
  return {
    id: `listen-${word.id}`,
    type: 'mcq',
    kind: 'listen_hanzi',
    prompt: word.hanzi, // never rendered as text in listening mode — only spoken aloud
    promptIsHanzi: true,
    options,
    correctIndex: options.indexOf(correct),
  }
}

function makeCloze(word: PracticeWord, pool: PracticeWord[]): PracticeQuestion | null {
  if (!word.example_hanzi || !word.example_hanzi.includes(word.hanzi)) return null

  const idx = word.example_hanzi.indexOf(word.hanzi)
  const before = word.example_hanzi.slice(0, idx)
  const after = word.example_hanzi.slice(idx + word.hanzi.length)

  const distractors = pickDistractors(pool, word.id, 'hanzi', 3)
  if (distractors.length < 3) return null

  const options = shuffleArray([word.hanzi, ...distractors])
  return {
    id: `cloze-${word.id}`,
    type: 'cloze',
    before,
    after,
    answer: word.hanzi,
    pinyinHint: word.example_pinyin || '',
    vietnameseHint: word.example_vietnamese || '',
    options,
    correctIndex: options.indexOf(word.hanzi),
  }
}

function makeReorder(word: PracticeWord, vocabHanzi: string[]): PracticeQuestion | null {
  if (!word.example_hanzi) return null
  const correctOrder = segmentHanzi(word.example_hanzi, vocabHanzi)
  if (correctOrder.length < 3 || correctOrder.length > 8) return null

  let segments = shuffleArray(correctOrder)
  // Make sure the shuffle actually shuffled something (avoid a trivially "solved" question)
  if (segments.every((s, i) => s === correctOrder[i])) {
    segments = [...segments].reverse()
  }

  return {
    id: `reorder-${word.id}`,
    type: 'reorder',
    segments,
    correctOrder,
    vietnameseHint: word.example_vietnamese || '',
  }
}

export type QuestionKind = 'mcq_hp' | 'mcq_hv' | 'mcq_vh' | 'mcq_listen' | 'cloze' | 'reorder'
const ALL_TYPES: QuestionKind[] = ['mcq_hp', 'mcq_hv', 'mcq_vh', 'cloze', 'reorder']
// Real TOCFL listening sections are pure audio comprehension: you hear the word spoken
// and pick the matching HANZI (not pinyin, not the Vietnamese meaning) from the options.
export const LISTENING_TYPES: QuestionKind[] = ['mcq_listen']

/** Builds a shuffled, varied set of practice questions for a level's word pool. */
export function generatePracticeQuestions(
  words: PracticeWord[],
  count: number,
  allowedTypes: QuestionKind[] = ALL_TYPES
): PracticeQuestion[] {
  const vocabHanzi = words.map((w) => w.hanzi)
  const questions: PracticeQuestion[] = []

  const wordOrder = shuffleArray(words)
  const typeCycle: QuestionKind[] = allowedTypes.length > 0 ? allowedTypes : ALL_TYPES
  let wordPointer = 0
  let typePointer = 0
  let attempts = 0
  const maxAttempts = count * 20

  while (questions.length < count && attempts < maxAttempts) {
    attempts++
    if (wordPointer >= wordOrder.length) {
      wordOrder.splice(0, wordOrder.length, ...shuffleArray(words))
      wordPointer = 0
    }
    const word = wordOrder[wordPointer++]
    const type = typeCycle[typePointer++ % typeCycle.length]

    let q: PracticeQuestion | null = null
    if (type === 'mcq_hp') q = makeMcq(word, words, 'hanzi_pinyin')
    else if (type === 'mcq_hv') q = makeMcq(word, words, 'hanzi_viet')
    else if (type === 'mcq_vh') q = makeMcq(word, words, 'viet_hanzi')
    else if (type === 'mcq_listen') q = makeListeningMcq(word, words)
    else if (type === 'cloze') q = makeCloze(word, words)
    else q = makeReorder(word, vocabHanzi)

    if (q && !questions.find((existing) => existing.id === q!.id)) {
      questions.push(q)
    }
  }

  return questions
}
