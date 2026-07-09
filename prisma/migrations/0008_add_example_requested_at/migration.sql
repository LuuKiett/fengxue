-- Migration: 0008_add_example_requested_at
ALTER TABLE public.vocabularies
  ADD COLUMN IF NOT EXISTS example_requested_at TIMESTAMPTZ;

-- Optional: index for querying pending requests
CREATE INDEX IF NOT EXISTS idx_vocab_example_requested_at ON public.vocabularies(example_requested_at);
