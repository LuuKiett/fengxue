-- Migration: 0004_comprehension
-- Adds shared, read-only reading/listening comprehension content for the
-- practice-exam feature (short passages and two-speaker dialogues), modeled on
-- TOCFL Band A's 短文閱讀 (reading passage) and 問答/言談理解 (listening dialogue)
-- question types. Populated by scripts/build-comprehension-seed.js's generated
-- SQL, never written to by end users.

-- ============================================================
-- COMPREHENSION_PASSAGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS "comprehension_passages" (
    "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "level"               TEXT        NOT NULL,
    "mode"                TEXT        NOT NULL,
    "passage_hanzi"       TEXT        NOT NULL,
    "passage_pinyin"      TEXT        NOT NULL,
    "passage_vietnamese"  TEXT        NOT NULL,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "comprehension_passages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "comprehension_passages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read comprehension passages"
    ON "comprehension_passages" FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- COMPREHENSION_QUESTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS "comprehension_questions" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "passage_id"     UUID        NOT NULL,
    "order_index"    INTEGER     NOT NULL DEFAULT 0,
    "question_hanzi" TEXT        NOT NULL,
    "options"        TEXT[]      NOT NULL,
    "correct_index"  INTEGER     NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "comprehension_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comprehension_questions_passage_id_fkey" FOREIGN KEY ("passage_id")
        REFERENCES "comprehension_passages"("id") ON DELETE CASCADE
);

ALTER TABLE "comprehension_questions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read comprehension questions"
    ON "comprehension_questions" FOR SELECT
    TO authenticated
    USING (true);
