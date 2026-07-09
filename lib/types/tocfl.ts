// Types for the real TOCFL Band A mock-exam feature (/thi-thu), backed by
// tocfl_papers / tocfl_questions / tocfl_attempts (see prisma/migrations/0009_tocfl_exam).

export type TocflSection = 'listening' | 'reading'

export interface TocflOption {
  label: string
  text?: string
  imagePath?: string
}

export interface TocflQuestion {
  id: string
  paper_id: string
  section: TocflSection
  part_number: number
  question_number: number
  question_type: string
  group_key: string | null
  order_index: number
  prompt_hanzi: string | null
  prompt_image_path: string | null
  passage_hanzi: string | null
  audio_path: string | null
  options: TocflOption[]
  correct_index: number
}

export interface TocflPaper {
  id: string
  band: string
  paper_number: number
  title: string
  listening_time_minutes: number
  reading_time_minutes: number
  listening_intro_audio: Record<string, string>
}

export type TocflAttemptStatus = 'in_progress' | 'completed' | 'abandoned'

export interface TocflAttempt {
  id: string
  user_id: string
  paper_id: string
  status: TocflAttemptStatus
  listening_correct: number | null
  listening_total: number | null
  reading_correct: number | null
  reading_total: number | null
  total_correct: number | null
  total_questions: number | null
  score_percent: number | null
  band_result: string | null
  answers: Record<string, number>
  started_at: string
  completed_at: string | null
  created_at: string
}

// Estimated banding only — TOCFL's real pass/fail cut uses IRT scaled scoring from a
// proprietary item bank that SC-TOP never publishes, so this can't be reproduced
// exactly. These thresholds mirror the commonly-cited approximate correct-rate
// guidance used by Band A prep courses (~60% ≈ A1, ~80% ≈ A2), applied per-section
// since the real exam grades listening and reading independently.
export function estimateBand(listeningCorrect: number, readingCorrect: number, perSectionTotal: number): string {
  const lRate = listeningCorrect / perSectionTotal
  const rRate = readingCorrect / perSectionTotal
  const minRate = Math.min(lRate, rRate)
  if (minRate >= 0.8) return 'A2 (Cơ sở)'
  if (minRate >= 0.6) return 'A1 (Nhập môn)'
  return 'Chưa đạt'
}
