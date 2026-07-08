-- Migration: 0005_vocabulary_examples
-- Adds optional example-sentence columns to vocabularies (user-added/imported words),
-- mirroring dictionary_words' example_hanzi/example_pinyin/example_vietnamese. Populated
-- at Excel-import time by matching each imported word against dictionary_words so
-- Flashcard can show a real, accurate example instead of falling back to the generic
-- /api/examples lookup.

ALTER TABLE "vocabularies"
  ADD COLUMN IF NOT EXISTS "example_hanzi" TEXT,
  ADD COLUMN IF NOT EXISTS "example_pinyin" TEXT,
  ADD COLUMN IF NOT EXISTS "example_vietnamese" TEXT;
