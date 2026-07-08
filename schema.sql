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
-- Tracks, per user + level, which dictionary_words the user has already been through so that
-- "Ôn tập theo từ điển" stages never repeat a word until the whole level has been covered.
CREATE TABLE IF NOT EXISTS public.dictionary_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    word_order UUID[] NOT NULL DEFAULT '{}',
    current_index INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, level)
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
