-- Migration: 0015_full_dictionary_progress
-- Per-user progress for the new "Tổng Hợp Từ Điển" page (/full-dictionary), mirroring
-- topic_vocabulary_progress's 3-mode gating chain but keyed by level only (no topic
-- axis — this page studies dictionary_words directly, grouped by level). `mode` is
-- 'flashcard' | 'matching' | 'fill_in':
--   - 'flashcard' pool = every dictionary_words row at this level
--   - 'matching' pool  = words already completed in 'flashcard'
--   - 'fill_in' pool   = words already completed in 'matching'
-- Deliberately a NEW table, not a third mode value on dictionary_progress — this page's
-- Nối Từ mode is an independently-drillable entry point (unlike /review-dictionary's
-- Flashcard, which only auto-chains into matching without persisting its own matching
-- progress row), so reusing dictionary_progress would need a different current_index
-- semantics for the same (user_id, level, 'flashcard') row and could desync /review-
-- dictionary's own progress. Keeping it fully separate avoids touching that page at all.
CREATE TABLE IF NOT EXISTS public.full_dictionary_progress (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  level         TEXT        NOT NULL,
  mode          TEXT        NOT NULL,
  word_order    UUID[]      NOT NULL DEFAULT '{}',
  current_index INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT full_dictionary_progress_pkey PRIMARY KEY (id),
  CONSTRAINT full_dictionary_progress_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.profiles(id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'full_dictionary_progress_user_level_mode_key'
  ) THEN
    ALTER TABLE public.full_dictionary_progress
      ADD CONSTRAINT full_dictionary_progress_user_level_mode_key UNIQUE (user_id, level, mode);
  END IF;
END $$;

ALTER TABLE public.full_dictionary_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'full_dictionary_progress' AND policyname = 'Users can manage own full dictionary progress'
  ) THEN
    CREATE POLICY "Users can manage own full dictionary progress"
      ON public.full_dictionary_progress FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
