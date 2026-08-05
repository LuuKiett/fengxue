-- Migration: 0023_textbook_vocab_progress
-- Per-user progress for /textbook, mirroring tocfl8000_progress exactly (3-mode gating
-- chain + "Biết/Không Biết" unknown-word tracking baked in from the start):
-- `mode` is 'flashcard' | 'matching' | 'fill_in':
--   - 'flashcard' pool = every textbook_vocab_words row at this lesson_id
--   - 'matching' pool  = words already known (learned minus "không biết") in 'flashcard'
--   - 'fill_in' pool   = same known-in-'flashcard' pool (independent of 'matching')
-- unknown_word_ids/unknown_resolved_count are reused per-mode-row like
-- tocfl8000_progress: on the 'flashcard' row they track Biết/Không Biết; on the
-- 'fill_in' row they track the separate "Điền Từ Chưa Xong" retry pool (words answered
-- wrong/left incomplete on submit). Keyed by lesson_id alone (already globally unique
-- across both Đương Đại 1 and 2, 1-30) rather than (book_id, lesson_id) - no book_id
-- column needed here. Deliberately a separate table from dictionary_progress/
-- full_dictionary_progress/topic_vocabulary_progress/tocfl8000_progress - same
-- reasoning as those: an independently-drillable content source must not risk
-- desyncing another page's progress semantics.
CREATE TABLE IF NOT EXISTS public.textbook_vocab_progress (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL,
  lesson_id               INTEGER     NOT NULL,
  mode                    TEXT        NOT NULL,
  word_order              UUID[]      NOT NULL DEFAULT '{}',
  current_index           INTEGER     NOT NULL DEFAULT 0,
  unknown_word_ids        UUID[]      NOT NULL DEFAULT '{}',
  unknown_resolved_count  INTEGER     NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT textbook_vocab_progress_pkey PRIMARY KEY (id),
  CONSTRAINT textbook_vocab_progress_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.profiles(id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'textbook_vocab_progress_user_lesson_mode_key'
  ) THEN
    ALTER TABLE public.textbook_vocab_progress
      ADD CONSTRAINT textbook_vocab_progress_user_lesson_mode_key UNIQUE (user_id, lesson_id, mode);
  END IF;
END $$;

ALTER TABLE public.textbook_vocab_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'textbook_vocab_progress' AND policyname = 'Users can manage own textbook vocab progress'
  ) THEN
    CREATE POLICY "Users can manage own textbook vocab progress"
      ON public.textbook_vocab_progress FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
