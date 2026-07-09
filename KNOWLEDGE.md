# FengXue — Project Knowledge

Read this before starting work. It captures architecture decisions and gotchas that
aren't obvious from just reading the code.

## Stack

- Next.js 16 (App Router). This version renamed `middleware.ts` → **`proxy.ts`**
  ("Middleware is now called Proxy") — see `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`.
  Root `proxy.ts` wraps `lib/supabase/middleware.ts`'s `updateSession`. Any new
  auth-gated route relies on that file, not a `middleware.ts`.
- Runtime DB/auth: **Supabase** (`@supabase/supabase-js`, `@supabase/ssr`). Every page
  queries `supabase.from(...)` directly client-side; there's no REST/service layer for
  CRUD except the Excel import/export/template routes, `/api/examples`, and
  `/api/vocabulary/generate-example`.
- **Prisma is schema/migration tooling only** — zero runtime `PrismaClient` usage
  anywhere. `prisma/schema.prisma` documents the shape; the actual DB lives in
  Supabase Postgres.
- Styling: Tailwind v4 + a custom "cartoon" utility set (`cartoon-btn`, `cartoon-card`,
  `cartoon-panel`, etc. in `app/globals.css`) + `lucide-react` icons.

## Migrations — how to actually apply one

Migrations are **hand-written SQL**, not `prisma migrate dev` output (folder names like
`0001_init`, `0006_vocabulary_source` don't follow Prisma's timestamp convention, so
`prisma migrate deploy` isn't used here). To add a column/table:

1. Write `prisma/migrations/000N_name/migration.sql` (idempotent — use
   `ADD COLUMN IF NOT EXISTS`, and a `DO $$ ... IF NOT EXISTS (SELECT 1 FROM
   pg_constraint ...) $$` guard for constraints, since `ADD CONSTRAINT IF NOT EXISTS`
   isn't valid Postgres syntax).
2. Mirror the change in `prisma/schema.prisma` (for docs/typing) **and** in
   `schema.sql` at the repo root (a manually-maintained full DDL dump used for fresh
   Supabase project setup).
3. Apply it to the live DB with:
   ```
   npx prisma db execute --file prisma/migrations/000N_name/migration.sql
   ```
   (reads `DATABASE_URL` from `prisma.config.ts` → `.env`; no `--schema` flag on this
   Prisma version). This is the only step that actually changes the live Supabase DB —
   editing `schema.prisma`/`schema.sql` alone does nothing at runtime.

## Data model notes

- `vocabulary_sets` is unique per `(user_id, date)` — one set per user per calendar
  day. `/vocabulary`, `/learn`, `/exercises/[date]` are all scoped to a single date's
  set.
- `vocabularies.source` (`'study' | 'practice'`, default `'study'`, added in migration
  `0006_vocabulary_source`) drives the two navtabs on `/vocabulary` — **"Từ Vựng Tự
  Học"** vs **"Từ Vựng Khác"**. It's per-word, not per-set, so one day's set can mix
  both. The Excel import/export/template routes read/write this via a `"Nguồn Từ"`
  column (`study`/`practice`, literal English values).
- `vocabularies`/`dictionary_words` both carry `example_hanzi/example_pinyin/
  example_vietnamese`. Import backfills these from `dictionary_words` on match;
  manually-added words instead get them from OpenRouter (see below).

## AI example-sentence generation (OpenRouter)

- `app/api/vocabulary/generate-example/route.ts` — server-only route, takes a
  `vocabularyId`, re-fetches the word from the DB (never trusts client-supplied
  hanzi/pinyin/vietnamese), verifies the vocab's set belongs to the authenticated user,
  calls OpenRouter chat completions, and writes `example_*` + `example_source: 'ai'`
  back onto that row.
- Wired from `app/(dashboard)/vocabulary/page.tsx`'s `handleAddSubmit`: after inserting
  new rows, it fires `generateExampleForWord(id)` per row **without awaiting** — word
  creation must not block on a slow/rate-limited free-tier model — and only for rows
  whose returned `example_source` isn't `'manual'` (see below). Failures are
  swallowed; the word just has no example until a future dictionary-import match or
  retry.
- Config lives in `.env` (gitignored) as `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`.
  `.env.example` documents both with empty/placeholder values — **never put a real key
  in `.env.example` or anywhere else that's committed.**
- Free-tier models on OpenRouter can be globally rate-limited at the account level
  (429 from OpenRouter itself, not from our code) — all free models fail together when
  this happens, not just one. Confirmed via direct `/api/v1/models` query that the
  actual list of `:free` model ids drifts over time (many ids from training-era
  knowledge 404 now) — **query `https://openrouter.ai/api/v1/models` live and filter
  `id.endsWith(':free')` instead of assuming a model slug still exists.**

## Manual example sentences (`vocabularies.example_source`)

- Migration `0007_vocabulary_example_source` adds `example_source` (`'manual' | 'ai' |
  'dictionary' | NULL`) to `vocabularies`, so the AI route never clobbers an example
  that came from somewhere else.
- On `/vocabulary`'s add-word modal, each row has a "Thêm ví dụ" (book icon) button
  next to the row's delete button — toggles an inline 3-input sub-panel (ví dụ Hán tự /
  pinyin / tiếng Việt). A row only counts as having a manual example when **all three**
  fields are filled in (partial input is discarded as "no example", since Flashcard
  needs all three to render one).
- `handleAddSubmit` sets `example_source: 'manual'` on insert for those rows and
  **skips firing `generateExampleForWord`** for them (checked via the row's returned
  `example_source`, not row-index correlation with `validRows` — Postgres doesn't
  strictly guarantee `RETURNING` order matches a multi-row `VALUES` insert's order).
  Import-backfilled examples (from `dictionary_words` matches) are tagged
  `'dictionary'`.
- Defense in depth: `generate-example`'s route handler independently checks
  `vocab.example_hanzi` before calling OpenRouter and skips (returns
  `{success:true, skipped:true}`) if one already exists, regardless of what the client
  believed — so even a future caller that doesn't know about `example_source` can't
  accidentally overwrite a manual/dictionary example.

## Known bug pattern (fixed, but same shape could reappear elsewhere)

`components/exercises/MatchingExercise.tsx`'s completion-trigger effect used to list
`onComplete` in its dependency array. Since `onComplete` is a fresh closure on every
parent re-render, when a round finished the parent (`app/(dashboard)/review/page.tsx`,
`ITEMS_PER_ROUND = 6` batching) would re-render with *both* new `vocabs` and a new
`onComplete` in the same commit. The vocabs-reset effect (declared first) reset
`completionFiredRef` synchronously before the completion effect re-ran in the same
pass — so the completion effect fired a second time immediately, reading the
*previous* round's still-stale `matchedIds`/`leftItems`, and skipped straight past the
round that had just been prepared (e.g. a 10-word set would do 6 words then jump
straight from `hanzi_pinyin` to `hanzi_viet`, dropping the remaining 4).

Fix: keep the latest `onComplete` in a ref (`onCompleteRef`, synced via its own small
effect) and remove `onComplete` from the completion effect's deps, so that effect only
re-runs on genuine match progress (`matchedIds`/`leftItems` changing), never merely
because the parent handed over a new callback identity. **Lesson: don't put
non-memoized callback props in a completion/one-shot effect's dependency array** — use
a ref if the effect needs the latest callback but shouldn't re-run when it changes.

## Auth flow

Supabase Auth via `signInWithPassword`/`signUp`, phone number mapped to a synthetic
email (`${phone}@fengxue.com`). Login button shows "Đang xác thực..." and stays in its
loading state through `router.push('/dashboard')` + `router.refresh()` — `loading` is
only reset to `false` on the error paths, not in a `finally`, since a successful login
unmounts the page before there's a chance to flip it back.

---

**Rule for future sessions:** when you finish a task in this repo, update this file
with anything a future agent would need to know that isn't obvious from the code —
new architectural decisions, gotchas you hit, non-obvious "why"s. Keep entries
concise; prune anything that's become stale or is now just derivable from reading the
code.
