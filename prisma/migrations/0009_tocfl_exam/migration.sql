-- Migration: 0009_tocfl_exam
-- Real TOCFL Band A mock-exam feature: official past-paper content (5 papers,
-- listening + reading, images + per-question audio) plus per-user attempt history
-- so /thi-thu can show score progress per paper on a grid card.

-- One row per official mock test paper (đề), per band.
CREATE TABLE IF NOT EXISTS public.tocfl_papers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    band TEXT NOT NULL DEFAULT 'A',
    paper_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    listening_time_minutes INTEGER NOT NULL DEFAULT 60,
    reading_time_minutes INTEGER NOT NULL DEFAULT 60,
    -- Part-intro instruction audio for the listening section, keyed by part number
    -- ("1".."5") -> public/ path. Optional; played once when entering that part.
    listening_intro_audio JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(band, paper_number)
);

ALTER TABLE public.tocfl_papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read tocfl papers"
    ON public.tocfl_papers FOR SELECT
    TO authenticated
    USING (true);

-- Every question across both sections of a paper.
-- Rows are written only by scripts/build-tocfl-seed.js, never by end users.
CREATE TABLE IF NOT EXISTS public.tocfl_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paper_id UUID NOT NULL REFERENCES public.tocfl_papers(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('listening', 'reading')),
    part_number INTEGER NOT NULL,
    question_number INTEGER NOT NULL,
    question_type TEXT NOT NULL,
    -- Groups sub-questions that share one passage/situational image and must be
    -- presented together as one exam screen (e.g. reading Part 4's 5 blanks sharing
    -- one passage + one 6-choice word bank). NULL when the question stands alone.
    group_key TEXT,
    order_index INTEGER NOT NULL,
    prompt_hanzi TEXT,
    prompt_image_path TEXT,
    passage_hanzi TEXT,
    audio_path TEXT,
    -- [{ "label": "A", "text": "...", "image_path": "..." }, ...] — text and
    -- image_path are each optional per-option depending on the part's format.
    options JSONB NOT NULL,
    correct_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(paper_id, section, question_number)
);

CREATE INDEX IF NOT EXISTS idx_tocfl_questions_paper ON public.tocfl_questions(paper_id, section, order_index);

ALTER TABLE public.tocfl_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read tocfl questions"
    ON public.tocfl_questions FOR SELECT
    TO authenticated
    USING (true);

-- Per-user mock-exam attempt history, so each paper's grid card can show past
-- scores and whether the user is improving.
CREATE TABLE IF NOT EXISTS public.tocfl_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    paper_id UUID NOT NULL REFERENCES public.tocfl_papers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    listening_correct INTEGER,
    listening_total INTEGER,
    reading_correct INTEGER,
    reading_total INTEGER,
    total_correct INTEGER,
    total_questions INTEGER,
    score_percent NUMERIC(5,2),
    -- Estimated band only — TOCFL's real pass/fail cut uses IRT scaled scoring from
    -- a proprietary item bank that isn't public, so this is a labeled approximation,
    -- never presented as the official result. See KNOWLEDGE.md.
    band_result TEXT,
    -- { questionId: selectedIndex }
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tocfl_attempts_user_paper ON public.tocfl_attempts(user_id, paper_id, created_at);

ALTER TABLE public.tocfl_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tocfl attempts"
    ON public.tocfl_attempts FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
