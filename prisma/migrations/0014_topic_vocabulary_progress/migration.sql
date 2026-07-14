-- Migration: 0014_topic_vocabulary_progress
-- Per-user progress for the "Học Từ Vựng Theo Chủ Đề" page, mirroring
-- dictionary_progress's shape but keyed by (level, topic_key) instead of just level,
-- and with a third mode. `mode` is 'flashcard' | 'matching' | 'fill_in':
--   - 'flashcard' pool = every word in (level, topic_key)
--   - 'matching' pool  = words already completed in 'flashcard' (gated, like
--     dictionary_progress's fill_in-gated-by-flashcard pattern)
--   - 'fill_in' pool   = words already completed in 'matching' (gated one step further)
-- Entering via the "Flashcard" mode-select option chains Flashcard -> Nối Từ -> Điền Từ
-- for the same stage batch, advancing all three progress rows together; entering
-- directly via "Nối Từ" or "Điền Từ" only drills that mode's own backlog and advances
-- only that mode's row. Fully separate from dictionary_progress — never touches it.
CREATE TABLE IF NOT EXISTS public.topic_vocabulary_progress (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  level         TEXT        NOT NULL,
  topic_key     TEXT        NOT NULL,
  mode          TEXT        NOT NULL,
  word_order    UUID[]      NOT NULL DEFAULT '{}',
  current_index INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT topic_vocabulary_progress_pkey PRIMARY KEY (id),
  CONSTRAINT topic_vocabulary_progress_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.profiles(id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topic_vocabulary_progress_user_level_topic_mode_key'
  ) THEN
    ALTER TABLE public.topic_vocabulary_progress
      ADD CONSTRAINT topic_vocabulary_progress_user_level_topic_mode_key UNIQUE (user_id, level, topic_key, mode);
  END IF;
END $$;

ALTER TABLE public.topic_vocabulary_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'topic_vocabulary_progress' AND policyname = 'Users can manage own topic vocabulary progress'
  ) THEN
    CREATE POLICY "Users can manage own topic vocabulary progress"
      ON public.topic_vocabulary_progress FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
