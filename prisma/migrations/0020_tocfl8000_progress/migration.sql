-- Migration: 0020_tocfl8000_progress
-- Per-user progress for /tocfl-dictionary, mirroring full_dictionary_progress exactly
-- (3-mode gating chain keyed by level only, plus "Biết/Không Biết" unknown-word
-- tracking baked in from the start rather than as a later follow-up migration like
-- dictionary_progress/full_dictionary_progress needed) - `mode` is
-- 'flashcard' | 'matching' | 'fill_in':
--   - 'flashcard' pool = every tocfl8000_words row at this level
--   - 'matching' pool  = words already known (learned minus "không biết") in 'flashcard'
--   - 'fill_in' pool   = same known-in-'flashcard' pool (independent of 'matching')
-- Deliberately a separate table from dictionary_progress/full_dictionary_progress/
-- topic_vocabulary_progress - same reasoning as those: an independently-drillable
-- content source must not risk desyncing another page's progress semantics.
CREATE TABLE IF NOT EXISTS public.tocfl8000_progress (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL,
  level                   TEXT        NOT NULL,
  mode                    TEXT        NOT NULL,
  word_order              UUID[]      NOT NULL DEFAULT '{}',
  current_index           INTEGER     NOT NULL DEFAULT 0,
  -- Both only meaningful on the mode='flashcard' row - see full_dictionary_progress's
  -- migration 0018 for the exact semantics this mirrors.
  unknown_word_ids        UUID[]      NOT NULL DEFAULT '{}',
  unknown_resolved_count  INTEGER     NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tocfl8000_progress_pkey PRIMARY KEY (id),
  CONSTRAINT tocfl8000_progress_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.profiles(id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tocfl8000_progress_user_level_mode_key'
  ) THEN
    ALTER TABLE public.tocfl8000_progress
      ADD CONSTRAINT tocfl8000_progress_user_level_mode_key UNIQUE (user_id, level, mode);
  END IF;
END $$;

ALTER TABLE public.tocfl8000_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tocfl8000_progress' AND policyname = 'Users can manage own tocfl8000 progress'
  ) THEN
    CREATE POLICY "Users can manage own tocfl8000 progress"
      ON public.tocfl8000_progress FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
