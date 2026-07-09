-- Migration: 0007_vocabulary_example_source
-- Tracks where a vocabulary word's example sentence came from, so the AI
-- generate-example endpoint (app/api/vocabulary/generate-example) never overwrites an
-- example the user typed by hand on /vocabulary, or one backfilled from dictionary_words
-- at import time.

ALTER TABLE "vocabularies"
  ADD COLUMN IF NOT EXISTS "example_source" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vocabularies_example_source_check'
  ) THEN
    ALTER TABLE "vocabularies"
      ADD CONSTRAINT "vocabularies_example_source_check"
      CHECK ("example_source" IS NULL OR "example_source" IN ('manual', 'ai', 'dictionary'));
  END IF;
END $$;
