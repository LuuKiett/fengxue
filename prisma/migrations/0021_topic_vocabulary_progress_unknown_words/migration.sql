-- Migration: 0021_topic_vocabulary_progress_unknown_words
-- Same "Biết / Không Biết"-shaped tracking as 0017/0018, mirrored onto
-- topic_vocabulary_progress. Unlike 0017/0018 this isn't used for Flashcard mode
-- (vocabulary-by-topic never got that feature) — it's repurposed for Điền Từ mode
-- rows, holding word ids answered incorrectly/left incomplete on submit so they can
-- be resurfaced via a "Ôn Tập Từ Chưa Xong" review pass. See KNOWLEDGE.md.
ALTER TABLE public.topic_vocabulary_progress
  ADD COLUMN IF NOT EXISTS unknown_word_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.topic_vocabulary_progress
  ADD COLUMN IF NOT EXISTS unknown_resolved_count INTEGER NOT NULL DEFAULT 0;
