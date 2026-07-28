-- SQL Schema for FengXue Chinese Learning Platform

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL DEFAULT '',
    phone TEXT UNIQUE NOT NULL DEFAULT '',
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" 
    ON public.profiles FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
    ON public.profiles FOR INSERT 
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
    ON public.profiles FOR UPDATE 
    USING (auth.uid() = id);

-- Create vocabulary_sets table
CREATE TABLE IF NOT EXISTS public.vocabulary_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Enable RLS for vocabulary_sets
ALTER TABLE public.vocabulary_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own vocabulary sets" 
    ON public.vocabulary_sets FOR ALL 
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create vocabularies table
CREATE TABLE IF NOT EXISTS public.vocabularies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id UUID NOT NULL REFERENCES public.vocabulary_sets(id) ON DELETE CASCADE,
    hanzi TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    vietnamese TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    -- Backfilled at Excel-import time when the word matches dictionary_words
    example_hanzi TEXT,
    example_pinyin TEXT,
    example_vietnamese TEXT,
    -- Browsing category on /vocabulary: 'study' (Từ vựng tự học) or 'practice' (Từ vựng khác)
    source TEXT NOT NULL DEFAULT 'study' CHECK (source IN ('study', 'practice')),
    -- Where the example sentence came from: 'manual' | 'ai' | 'dictionary' | NULL
    example_source TEXT CHECK (example_source IS NULL OR example_source IN ('manual', 'ai', 'dictionary')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for vocabularies
ALTER TABLE public.vocabularies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own vocabularies" 
    ON public.vocabularies FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM public.vocabulary_sets 
            WHERE id = vocabularies.set_id AND user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.vocabulary_sets 
            WHERE id = vocabularies.set_id AND user_id = auth.uid()
        )
    );

-- Create exercise_records table
CREATE TABLE IF NOT EXISTS public.exercise_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    exercise_type TEXT NOT NULL, -- 'hanzi_pinyin', 'pinyin_viet', 'hanzi_viet', 'flashcard'
    is_completed BOOLEAN DEFAULT FALSE,
    score INTEGER,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date, exercise_type)
);

-- Enable RLS for exercise_records
ALTER TABLE public.exercise_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own exercise records" 
    ON public.exercise_records FOR ALL 
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create dictionary_words table
-- Shared, read-only reference dictionary imported from vocabulary PDFs (e.g. TOCFL Band A/B/C).
-- Rows are written only by scripts/import-dictionary-pdf.js, never by end users.
CREATE TABLE IF NOT EXISTS public.dictionary_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    band TEXT NOT NULL,        -- top-level grouping, e.g. 'A', 'B' (matches the source PDF's band)
    level TEXT NOT NULL,       -- sub-level printed per-word in the source, e.g. 'A1', 'A2', 'B1'...
    hanzi TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    vietnamese TEXT NOT NULL,
    pos TEXT,                  -- part-of-speech tag from source (N, VA, VS, M, Det, Adv, Prep...)
    order_index INTEGER DEFAULT 0,
    example_hanzi TEXT,        -- self-authored example sentence (scripts/generate-dictionary-examples.js)
    example_pinyin TEXT,
    example_vietnamese TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(level, hanzi, pinyin, vietnamese)
);

ALTER TABLE public.dictionary_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read dictionary"
    ON public.dictionary_words FOR SELECT
    TO authenticated
    USING (true);

-- Create dictionary_progress table
-- Tracks, per user + level + mode, which dictionary_words the user has already been
-- through so that "Ôn tập theo từ điển" stages never repeat a word until the whole
-- level has been covered. `mode` ('flashcard' | 'fill_in') keeps Flashcard and Điền
-- Từ progress independent of each other for the same level.
CREATE TABLE IF NOT EXISTS public.dictionary_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'flashcard',
    word_order UUID[] NOT NULL DEFAULT '{}',
    current_index INTEGER NOT NULL DEFAULT 0,
    -- Both only meaningful on the mode='flashcard' row — see migration 0017.
    unknown_word_ids UUID[] NOT NULL DEFAULT '{}',
    unknown_resolved_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, level, mode)
);

ALTER TABLE public.dictionary_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own dictionary progress"
    ON public.dictionary_progress FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create practice_sessions table
-- Attempt history for the auto-generated TOCFL practice-exam quizzes (MCQ/cloze/reorder).
CREATE TABLE IF NOT EXISTS public.practice_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    total_questions INTEGER NOT NULL,
    correct_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own practice sessions"
    ON public.practice_sessions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create comprehension_passages / comprehension_questions tables
-- Shared, read-only reading/listening comprehension content for the practice-exam
-- feature (short passages and two-speaker dialogues), modeled on TOCFL Band A's
-- 短文閱讀 (reading passage) and 問答/言談理解 (listening dialogue) question types.
-- Rows are written only by scripts/build-comprehension-seed.js, never by end users.
CREATE TABLE IF NOT EXISTS public.comprehension_passages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level TEXT NOT NULL,             -- 'A1' | 'A2'
    mode TEXT NOT NULL,              -- 'reading' | 'listening'
    passage_hanzi TEXT NOT NULL,     -- đoạn văn, hoặc hội thoại dạng "A：...\nB：..."
    passage_pinyin TEXT NOT NULL,
    passage_vietnamese TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.comprehension_passages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read comprehension passages"
    ON public.comprehension_passages FOR SELECT
    TO authenticated
    USING (true);

CREATE TABLE IF NOT EXISTS public.comprehension_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passage_id UUID NOT NULL REFERENCES public.comprehension_passages(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    question_hanzi TEXT NOT NULL,
    options TEXT[] NOT NULL,
    correct_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.comprehension_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read comprehension questions"
    ON public.comprehension_questions FOR SELECT
    TO authenticated
    USING (true);

-- Real TOCFL Band A official mock-exam papers (5 papers, listening + reading,
-- sourced from the official past-paper PDFs/audio). Rows written only by
-- scripts/build-tocfl-seed.js, never by end users.
CREATE TABLE IF NOT EXISTS public.tocfl_papers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    band TEXT NOT NULL DEFAULT 'A',
    paper_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    listening_time_minutes INTEGER NOT NULL DEFAULT 60,
    reading_time_minutes INTEGER NOT NULL DEFAULT 60,
    listening_intro_audio JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(band, paper_number)
);

ALTER TABLE public.tocfl_papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read tocfl papers"
    ON public.tocfl_papers FOR SELECT
    TO authenticated
    USING (true);

CREATE TABLE IF NOT EXISTS public.tocfl_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paper_id UUID NOT NULL REFERENCES public.tocfl_papers(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('listening', 'reading')),
    part_number INTEGER NOT NULL,
    question_number INTEGER NOT NULL,
    question_type TEXT NOT NULL,
    group_key TEXT,
    order_index INTEGER NOT NULL,
    prompt_hanzi TEXT,
    prompt_image_path TEXT,
    passage_hanzi TEXT,
    audio_path TEXT,
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

-- Per-user mock-exam attempt history, powering the score-progress grid on /thi-thu.
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
    band_result TEXT,
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

-- Backs the "Học Từ Vựng Theo Chủ Đề" page. Deliberately separate from dictionary_words/
-- dictionary_progress so this feature can never touch existing student progress. A1/A2/B1
-- rows are scraped from monchinese.me's topic collections (their #1/#2/#3 sub-groups merged
-- into one set per topic); B2 rows are this app's own dictionary_words auto-classified into
-- the same topic taxonomy by keyword (monchinese has no B2 tier to source from).
CREATE TABLE IF NOT EXISTS public.topic_vocabulary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level TEXT NOT NULL,
    topic_key TEXT NOT NULL,
    topic_label TEXT NOT NULL,
    topic_icon TEXT NOT NULL,
    hanzi TEXT NOT NULL,
    hanzi_variant TEXT,
    pinyin TEXT NOT NULL,
    vietnamese TEXT NOT NULL,
    pos TEXT,
    example_hanzi TEXT,
    example_pinyin TEXT,
    example_vietnamese TEXT,
    source TEXT NOT NULL DEFAULT 'monchinese',
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(level, topic_key, hanzi, pinyin)
);

CREATE INDEX IF NOT EXISTS idx_topic_vocabulary_level_topic ON public.topic_vocabulary(level, topic_key);

ALTER TABLE public.topic_vocabulary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read topic vocabulary"
    ON public.topic_vocabulary FOR SELECT
    TO authenticated
    USING (true);

-- Per-user progress for the topic-vocabulary page, mirroring dictionary_progress's shape
-- but keyed by (level, topic_key) and with a third mode ('flashcard' | 'matching' |
-- 'fill_in'). 'matching' pool = words already completed in 'flashcard'; 'fill_in' pool =
-- words already completed in 'matching' — a two-step gating chain (see migration 0014).
CREATE TABLE IF NOT EXISTS public.topic_vocabulary_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    topic_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    word_order UUID[] NOT NULL DEFAULT '{}',
    current_index INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, level, topic_key, mode)
);

ALTER TABLE public.topic_vocabulary_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own topic vocabulary progress"
    ON public.topic_vocabulary_progress FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Per-user progress for the "Tổng Hợp Từ Điển" page (/full-dictionary), mirroring
-- topic_vocabulary_progress's 3-mode gating chain but keyed by level only (this page
-- studies dictionary_words directly, not topic_vocabulary — no topic axis). See
-- migration 0015's comment for why this is a separate table from dictionary_progress.
CREATE TABLE IF NOT EXISTS public.full_dictionary_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    mode TEXT NOT NULL,
    word_order UUID[] NOT NULL DEFAULT '{}',
    current_index INTEGER NOT NULL DEFAULT 0,
    -- Both only meaningful on the mode='flashcard' row — see migration 0018.
    unknown_word_ids UUID[] NOT NULL DEFAULT '{}',
    unknown_resolved_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, level, mode)
);

ALTER TABLE public.full_dictionary_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own full dictionary progress"
    ON public.full_dictionary_progress FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Backs the "Tổng Hợp Từ Điển" page's dictionary browsing table + study pool. Sourced
-- 100% from monchinese.me/dictionary?level=X per explicit user request — deliberately
-- separate from dictionary_words for the same reason topic_vocabulary is: this page's
-- content must track monchinese exactly, which can legitimately disagree with this
-- app's own TOCFL-band dictionary_words content.
CREATE TABLE IF NOT EXISTS public.full_dictionary_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level TEXT NOT NULL,
    hanzi TEXT NOT NULL,
    hanzi_variant TEXT,
    pinyin TEXT NOT NULL,
    vietnamese TEXT NOT NULL,
    pos TEXT,
    example_hanzi TEXT,
    example_pinyin TEXT,
    example_vietnamese TEXT,
    source TEXT NOT NULL DEFAULT 'monchinese',
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(level, hanzi, pinyin)
);

ALTER TABLE public.full_dictionary_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read full dictionary words"
    ON public.full_dictionary_words FOR SELECT
    TO authenticated
    USING (true);

-- Backs the "Từ Điển TOCFL" page (/tocfl-dictionary). Content is imported from the
-- official 華語八千詞表 (Huayu 8000-word list) xlsx, restricted to A1/A2/B1 (入門級/
-- 基礎級/進階級) per explicit user request — deliberately a separate table from
-- dictionary_words/full_dictionary_words for the same reason topic_vocabulary is: this
-- page's word list must track the official 8000-word source exactly.
CREATE TABLE IF NOT EXISTS public.tocfl8000_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level TEXT NOT NULL,
    context TEXT,
    hanzi TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    vietnamese TEXT NOT NULL,
    pos TEXT,
    example_hanzi TEXT,
    example_pinyin TEXT,
    example_vietnamese TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(level, hanzi, pinyin)
);

ALTER TABLE public.tocfl8000_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read tocfl8000 words"
    ON public.tocfl8000_words FOR SELECT
    TO authenticated
    USING (true);

-- Per-user progress for /tocfl-dictionary, mirroring full_dictionary_progress's 3-mode
-- gating chain (flashcard / matching / fill_in, keyed by level only) plus its own
-- unknown-word "Biết/Không Biết" tracking (see migration 0020's comment for the exact
-- semantics this mirrors, taken from full_dictionary_progress's migrations 0015+0018).
CREATE TABLE IF NOT EXISTS public.tocfl8000_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    mode TEXT NOT NULL,
    word_order UUID[] NOT NULL DEFAULT '{}',
    current_index INTEGER NOT NULL DEFAULT 0,
    unknown_word_ids UUID[] NOT NULL DEFAULT '{}',
    unknown_resolved_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, level, mode)
);

ALTER TABLE public.tocfl8000_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tocfl8000 progress"
    ON public.tocfl8000_progress FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TRIGGER: Auto-create profile on user signup
-- This runs with SECURITY DEFINER so it bypasses RLS
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
