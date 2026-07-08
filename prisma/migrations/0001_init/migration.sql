-- Migration: 0001_init
-- Creates all tables, enables RLS, adds policies, and sets up the auto-profile trigger.
-- Run via: npx prisma migrate dev --name init

-- ============================================================
-- PROFILES TABLE
-- NOTE: We reference auth.users manually here because Prisma
--       cannot model cross-schema foreign keys automatically.
-- ============================================================
CREATE TABLE IF NOT EXISTS "profiles" (
    "id"         UUID        NOT NULL,
    "full_name"  TEXT        NOT NULL DEFAULT '',
    "phone"      TEXT        NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profiles_phone_key" UNIQUE ("phone"),
    CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id")
        REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
    ON "profiles" FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON "profiles" FOR INSERT
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON "profiles" FOR UPDATE
    USING (auth.uid() = id);

-- ============================================================
-- VOCABULARY_SETS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS "vocabulary_sets" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID        NOT NULL,
    "date"       DATE        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "vocabulary_sets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vocabulary_sets_user_id_date_key" UNIQUE ("user_id", "date"),
    CONSTRAINT "vocabulary_sets_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "profiles"("id") ON DELETE CASCADE
);

ALTER TABLE "vocabulary_sets" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own vocabulary sets"
    ON "vocabulary_sets" FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- VOCABULARIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS "vocabularies" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "set_id"      UUID        NOT NULL,
    "hanzi"       TEXT        NOT NULL,
    "pinyin"      TEXT        NOT NULL,
    "vietnamese"  TEXT        NOT NULL,
    "order_index" INTEGER     NOT NULL DEFAULT 0,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "vocabularies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vocabularies_set_id_fkey" FOREIGN KEY ("set_id")
        REFERENCES "vocabulary_sets"("id") ON DELETE CASCADE
);

ALTER TABLE "vocabularies" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own vocabularies"
    ON "vocabularies" FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM "vocabulary_sets"
            WHERE "vocabulary_sets"."id" = "vocabularies"."set_id"
              AND "vocabulary_sets"."user_id" = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM "vocabulary_sets"
            WHERE "vocabulary_sets"."id" = "vocabularies"."set_id"
              AND "vocabulary_sets"."user_id" = auth.uid()
        )
    );

-- ============================================================
-- EXERCISE_RECORDS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS "exercise_records" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"       UUID        NOT NULL,
    "date"          DATE        NOT NULL,
    "exercise_type" TEXT        NOT NULL,
    "is_completed"  BOOLEAN     NOT NULL DEFAULT FALSE,
    "score"         INTEGER,
    "completed_at"  TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "exercise_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exercise_records_user_id_date_exercise_type_key" UNIQUE ("user_id", "date", "exercise_type"),
    CONSTRAINT "exercise_records_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "profiles"("id") ON DELETE CASCADE
);

ALTER TABLE "exercise_records" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own exercise records"
    ON "exercise_records" FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TRIGGER: Auto-create profile row when a new auth user signs up
-- Uses SECURITY DEFINER to bypass RLS
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
