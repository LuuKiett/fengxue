-- Migration: 0022_textbook_vocab_words
-- Backs the "Sách Giáo Khoa" page (/textbook). Content is imported 100% from the
-- public zh.taiwandiary.vn vocab API (api.php?action=get_vocabularies&lesson_id=N),
-- covering every lesson of "Đương Đại 1" (book_id 1, lesson_id 1-15) and "Đương Đại 2"
-- (book_id 2, lesson_id 16-30) per explicit user request — books 3-6 (Đương Đại 3-6)
-- exist on the source site but are out of scope. Deliberately a new table, not rows
-- merged into dictionary_words/full_dictionary_words/tocfl8000_words - same reasoning
-- as those: this page's word list must track the source site exactly and must never
-- risk another page's progress rows.
--
-- Unlike every other *_words table in this schema (which store a single
-- example_hanzi/example_pinyin/example_vietnamese triple per word), the source API
-- returns a variable number of example sentences per word (confirmed 2-10 across a
-- sample lesson) - `examples` is a JSONB array of {hanzi, pinyin, vietnamese} objects
-- to preserve every example, matching the user's "y chang 100%" (identical to the
-- source) requirement instead of truncating to one.
CREATE TABLE IF NOT EXISTS public.textbook_vocab_words (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  book_id     INTEGER     NOT NULL,
  book_name   TEXT        NOT NULL,
  lesson_id   INTEGER     NOT NULL,
  lesson_no   INTEGER     NOT NULL,
  lesson_name TEXT        NOT NULL,
  hanzi       TEXT        NOT NULL,
  pinyin      TEXT        NOT NULL,
  pos         TEXT,
  han_viet    TEXT,
  vietnamese  TEXT        NOT NULL,
  tocfl_band  INTEGER,
  examples    JSONB       NOT NULL DEFAULT '[]',
  order_index INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT textbook_vocab_words_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_textbook_vocab_words_lesson
  ON public.textbook_vocab_words (lesson_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'textbook_vocab_words_lesson_hanzi_pinyin_key'
  ) THEN
    ALTER TABLE public.textbook_vocab_words
      ADD CONSTRAINT textbook_vocab_words_lesson_hanzi_pinyin_key UNIQUE (lesson_id, hanzi, pinyin);
  END IF;
END $$;

ALTER TABLE public.textbook_vocab_words ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'textbook_vocab_words' AND policyname = 'Anyone authenticated can read textbook vocab words'
  ) THEN
    CREATE POLICY "Anyone authenticated can read textbook vocab words"
      ON public.textbook_vocab_words FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
