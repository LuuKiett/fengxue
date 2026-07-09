-- Migration: 0006_vocabulary_source
-- Splits a user's vocabulary into two browsing categories on /vocabulary:
-- 'study' (Từ vựng tự học) and 'practice' (Từ vựng khác). Lives on the word itself
-- (not vocabulary_sets) so a single day's set can contain a mix of both.

ALTER TABLE "vocabularies"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'study';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vocabularies_source_check'
  ) THEN
    ALTER TABLE "vocabularies"
      ADD CONSTRAINT "vocabularies_source_check" CHECK ("source" IN ('study', 'practice'));
  END IF;
END $$;
