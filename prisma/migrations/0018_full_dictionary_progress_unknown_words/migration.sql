-- Migration: 0018_full_dictionary_progress_unknown_words
-- Same "Biết / Không Biết" tracking as 0017, mirrored onto full_dictionary_progress
-- for /full-dictionary's Flashcard mode. See 0017's comment for the exact semantics.
ALTER TABLE public.full_dictionary_progress
  ADD COLUMN IF NOT EXISTS unknown_word_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.full_dictionary_progress
  ADD COLUMN IF NOT EXISTS unknown_resolved_count INTEGER NOT NULL DEFAULT 0;
