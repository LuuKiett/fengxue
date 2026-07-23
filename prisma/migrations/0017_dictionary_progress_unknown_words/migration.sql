-- Migration: 0017_dictionary_progress_unknown_words
-- Adds "Biết / Không Biết" tracking to /review-dictionary's Flashcard mode. Only
-- meaningful on the (user_id, level, mode='flashcard') row:
--   - unknown_word_ids: words currently flagged "không biết", not yet re-answered
--     "biết" — this is the pool the new "Học Từ Không Biết" mode drills, and it's
--     excluded from the words Điền Từ is allowed to pull from (see KNOWLEDGE.md).
--   - unknown_resolved_count: lifetime count of words that were once in the unknown
--     pool and got resolved back to "biết" since the last full level reset — paired
--     with unknown_word_ids.length to show an "X/Y đã ôn lại" progress stat.
-- current_index/word_order semantics are unchanged: a word still only appears once
-- per learning cycle regardless of which button is tapped.
ALTER TABLE public.dictionary_progress
  ADD COLUMN IF NOT EXISTS unknown_word_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.dictionary_progress
  ADD COLUMN IF NOT EXISTS unknown_resolved_count INTEGER NOT NULL DEFAULT 0;
