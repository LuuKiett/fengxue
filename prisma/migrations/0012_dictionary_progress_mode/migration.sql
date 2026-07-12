-- Migration: 0012_dictionary_progress_mode
-- Adds a `mode` column to dictionary_progress so Flashcard and Điền Từ (fill-in-the-
-- blank) study progress on /review-dictionary are tracked independently per level —
-- previously there was only one progress row per (user_id, level), shared by whatever
-- exercise type was run. Existing rows default to 'flashcard' (the only mode that
-- existed before), so nobody's current flashcard progress is lost or reset.
ALTER TABLE public.dictionary_progress
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'flashcard';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dictionary_progress_user_id_level_key'
  ) THEN
    ALTER TABLE public.dictionary_progress DROP CONSTRAINT dictionary_progress_user_id_level_key;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dictionary_progress_user_id_level_mode_key'
  ) THEN
    ALTER TABLE public.dictionary_progress
      ADD CONSTRAINT dictionary_progress_user_id_level_mode_key UNIQUE (user_id, level, mode);
  END IF;
END $$;
