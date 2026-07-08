-- Migration: 0003_dictionary_examples
-- Adds self-authored example sentences to dictionary_words (populated by
-- scripts/generate-dictionary-examples.js), and a lightweight practice_sessions
-- table for the TOCFL practice-exam feature.

ALTER TABLE "dictionary_words"
  ADD COLUMN IF NOT EXISTS "example_hanzi" TEXT,
  ADD COLUMN IF NOT EXISTS "example_pinyin" TEXT,
  ADD COLUMN IF NOT EXISTS "example_vietnamese" TEXT;

-- ============================================================
-- PRACTICE_SESSIONS TABLE
-- Attempt history for the auto-generated TOCFL practice-exam quizzes.
-- Separate from exercise_records since this isn't date-keyed daily practice.
-- ============================================================
CREATE TABLE IF NOT EXISTS "practice_sessions" (
    "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"          UUID        NOT NULL,
    "level"            TEXT        NOT NULL,
    "total_questions"  INTEGER     NOT NULL,
    "correct_count"    INTEGER     NOT NULL,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "practice_sessions_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "profiles"("id") ON DELETE CASCADE
);

ALTER TABLE "practice_sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own practice sessions"
    ON "practice_sessions" FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
