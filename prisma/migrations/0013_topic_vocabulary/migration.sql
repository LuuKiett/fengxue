-- Migration: 0013_topic_vocabulary
-- New table backing the "Học Từ Vựng Theo Chủ Đề" page. Deliberately a brand-new,
-- fully separate table (not a `topic` column on dictionary_words, and not new rows
-- mixed into dictionary_words) so this feature can never touch dictionary_progress /
-- exercise_records / any existing student progress data. A1/A2/B1 rows are sourced
-- from monchinese.me's topic collections (scripts/scrape-monchinese-words.js); B2 rows
-- are this app's own dictionary_words (level='B2'), auto-classified into the same topic
-- taxonomy by keyword (scripts/classify-b2-topics.js) since monchinese has no B2 tier.
CREATE TABLE IF NOT EXISTS public.topic_vocabulary (
  id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
  level              TEXT        NOT NULL,
  topic_key          TEXT        NOT NULL,
  topic_label        TEXT        NOT NULL,
  topic_icon         TEXT        NOT NULL,
  hanzi              TEXT        NOT NULL,
  hanzi_variant      TEXT,
  pinyin             TEXT        NOT NULL,
  vietnamese         TEXT        NOT NULL,
  pos                TEXT,
  example_hanzi      TEXT,
  example_pinyin     TEXT,
  example_vietnamese TEXT,
  source             TEXT        NOT NULL DEFAULT 'monchinese',
  order_index        INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT topic_vocabulary_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_topic_vocabulary_level_topic
  ON public.topic_vocabulary (level, topic_key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topic_vocabulary_level_topic_hanzi_pinyin_key'
  ) THEN
    ALTER TABLE public.topic_vocabulary
      ADD CONSTRAINT topic_vocabulary_level_topic_hanzi_pinyin_key UNIQUE (level, topic_key, hanzi, pinyin);
  END IF;
END $$;

ALTER TABLE public.topic_vocabulary ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'topic_vocabulary' AND policyname = 'Anyone authenticated can read topic vocabulary'
  ) THEN
    CREATE POLICY "Anyone authenticated can read topic vocabulary"
      ON public.topic_vocabulary FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
