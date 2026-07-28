-- Migration: 0019_tocfl8000_words
-- Backs the "Từ Điển TOCFL" page (/tocfl-dictionary). Content is imported from the
-- official 華語八千詞表 (Huayu 8000-word list, 20240923 revision) xlsx, restricted to the
-- 3 levels the user is currently studying (per explicit user request):
--   入門級(Level 1) -> A1, 基礎級(Level 2) -> A2, 進階級(Level 3) -> B1
-- (準備級一級/二級 pre-A1 Novice tiers and 高階級/流利級 B2+ tiers are intentionally
-- skipped.) Deliberately a NEW table, not rows merged into dictionary_words/
-- full_dictionary_words - same reasoning as topic_vocabulary/full_dictionary_words: this
-- page's word list must track the official 8000-word source exactly (which can legitimately
-- disagree with this app's other dictionaries on level assignment) and must never risk
-- existing progress rows pointing at IDs that could shift.
CREATE TABLE IF NOT EXISTS public.tocfl8000_words (
  id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
  level              TEXT        NOT NULL,
  context            TEXT,
  hanzi              TEXT        NOT NULL,
  pinyin             TEXT        NOT NULL,
  vietnamese         TEXT        NOT NULL,
  pos                TEXT,
  example_hanzi      TEXT,
  example_pinyin     TEXT,
  example_vietnamese TEXT,
  order_index        INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tocfl8000_words_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tocfl8000_words_level_hanzi_pinyin_key'
  ) THEN
    ALTER TABLE public.tocfl8000_words
      ADD CONSTRAINT tocfl8000_words_level_hanzi_pinyin_key UNIQUE (level, hanzi, pinyin);
  END IF;
END $$;

ALTER TABLE public.tocfl8000_words ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tocfl8000_words' AND policyname = 'Anyone authenticated can read tocfl8000 words'
  ) THEN
    CREATE POLICY "Anyone authenticated can read tocfl8000 words"
      ON public.tocfl8000_words FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
