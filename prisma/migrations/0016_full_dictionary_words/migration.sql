-- Migration: 0016_full_dictionary_words
-- Backs the "Tổng Hợp Từ Điển" page's dictionary browsing table + study pool. Per
-- explicit user request, the A1/A2/B1/B2 word lists for this page must come 100% from
-- monchinese.me/dictionary?level=X (hanzi, pinyin, meaning, examples), not this app's
-- own dictionary_words — mirroring exactly why topic_vocabulary (migration 0013) is a
-- separate table from dictionary_words rather than new rows mixed into it: this page
-- must never risk dictionary_progress/full_dictionary_progress rows pointing at IDs
-- that could shift if the word source ever changes, and the two dictionaries can
-- legitimately disagree on which words belong to which CEFR level.
CREATE TABLE IF NOT EXISTS public.full_dictionary_words (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  level             TEXT        NOT NULL,
  hanzi             TEXT        NOT NULL,
  hanzi_variant     TEXT,
  pinyin            TEXT        NOT NULL,
  vietnamese        TEXT        NOT NULL,
  pos               TEXT,
  example_hanzi     TEXT,
  example_pinyin    TEXT,
  example_vietnamese TEXT,
  source            TEXT        NOT NULL DEFAULT 'monchinese',
  order_index       INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT full_dictionary_words_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'full_dictionary_words_level_hanzi_pinyin_key'
  ) THEN
    ALTER TABLE public.full_dictionary_words
      ADD CONSTRAINT full_dictionary_words_level_hanzi_pinyin_key UNIQUE (level, hanzi, pinyin);
  END IF;
END $$;

ALTER TABLE public.full_dictionary_words ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'full_dictionary_words' AND policyname = 'Anyone authenticated can read full dictionary words'
  ) THEN
    CREATE POLICY "Anyone authenticated can read full dictionary words"
      ON public.full_dictionary_words FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
