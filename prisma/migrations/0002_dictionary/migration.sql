-- Migration: 0002_dictionary
-- Adds the shared reference dictionary (imported from vocabulary PDFs) and per-user
-- dictionary-level review progress for the "Ôn tập theo từ điển" feature.

-- ============================================================
-- DICTIONARY_WORDS TABLE
-- Read-only reference data, written only by scripts/import-dictionary-pdf.js.
-- ============================================================
CREATE TABLE IF NOT EXISTS "dictionary_words" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "band"        TEXT        NOT NULL,
    "level"       TEXT        NOT NULL,
    "hanzi"       TEXT        NOT NULL,
    "pinyin"      TEXT        NOT NULL,
    "vietnamese"  TEXT        NOT NULL,
    "pos"         TEXT,
    "order_index" INTEGER     NOT NULL DEFAULT 0,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "dictionary_words_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dictionary_words_level_hanzi_pinyin_vietnamese_key" UNIQUE ("level", "hanzi", "pinyin", "vietnamese")
);

ALTER TABLE "dictionary_words" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read dictionary"
    ON "dictionary_words" FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- DICTIONARY_PROGRESS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS "dictionary_progress" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"       UUID        NOT NULL,
    "level"         TEXT        NOT NULL,
    "word_order"    UUID[]      NOT NULL DEFAULT '{}',
    "current_index" INTEGER     NOT NULL DEFAULT 0,
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "dictionary_progress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dictionary_progress_user_id_level_key" UNIQUE ("user_id", "level"),
    CONSTRAINT "dictionary_progress_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "profiles"("id") ON DELETE CASCADE
);

ALTER TABLE "dictionary_progress" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own dictionary progress"
    ON "dictionary_progress" FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
