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

- `vocabulary_sets` is unique per `(user_id, date)` — one set per user per cal
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
  pinyin / tiếng Việt), sized to match the main word inputs. A row only counts as
  having a manual example when **all three** fields are filled in (partial input is
  discarded as "no example", since Flashcard needs all three to render one).
- The example's pinyin field reuses the exact same TOCFL IME-style composer as the
  main word row (`lookupExampleSuggestions`/`selectExampleSuggestion`/
  `exampleComposingBuffer`/`exampleSuggestions` in `app/(dashboard)/vocabulary/page.tsx`
  — deliberately a parallel copy of `lookupSuggestions`/`selectSuggestion`/etc, not a
  shared helper, matching how the edit-modal composer is already a separate copy
  rather than a refactor). Each pick appends to `exampleHanzi`/`examplePinyin`, so a
  whole sentence is composed the same way a word is: type pinyin without tones, pick a
  candidate, repeat.
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

## TOCFL mock-exam transcription (reading-N.json / listening-N.json)

- Source PDFs live under `TOCFL PHỒN THỂ/` (gitignored, not committed — see
  `scripts/tocfl-content/reading-N.json` / `listening-N.json` for the actual output).
  `đọc band A/đáp án đề N.pdf` is always a real answer grid. **`nghe band A pdf/đáp án
  đề N.pdf` is NOT reliably a transcript** — only Đề 1's version is a 9-page spoken
  script; Đề 2–5's versions (confirmed for at least Đề 2–5) are a single-page answer
  grid only, structurally identical to the reading answer key, with no dialogue text.
  Check `fitz.open(path).page_count` before assuming transcript content — a 9-page doc
  is a script, a 1-page doc is grid-only.
- When the local `nghe band A pdf/đáp án đề N.pdf` is grid-only (no transcript), **do
  not guess/reconstruct dialogue from images before trying the official source** — the
  full listening script is published at `https://tocfl.edu.tw/assets/files/mock/ls_mockM_test_BandA_listen.pdf`
  (confirmed live for M=2,3,4,5; M=1 404s, presumably because that one already ships
  as the 9-page local transcript). **M is not the same as the paper's Đề number** —
  read it off the extracted audio folder name instead, e.g. `scratchpad/audio/N/
  mock2_BandA_mp3_vie/` means Đề N corresponds to M=2. This script gives verbatim
  Part 1 questions+options and Part 2/3/4 dialogues; it was cross-checked word-for-word
  against `nghe band A pdf/dien giai nghe band A/Q*.pdf` (a shared cross-paper item
  bank of ~140 explanation snippets keyed by opaque `Q########` ids, useful as a
  secondary source/sanity-check for Part 3/4-style 4-line dialogues specifically — grep
  its dumped text for a known option phrase to find a paper's block, which tends to be
  numerically contiguous per paper, e.g. Đề 4's Part 3+4 was the contiguous run
  `Q00352800`–`Q00353700`). Only fall back to image/answer-key-based reconstruction
  (lower-confidence, flag it explicitly) if neither the official script nor the item
  bank yields a match — with the official script available, that fallback should now
  be rare. No equivalent gap exists for reading: its PDF always has a real text layer
  (`text.txt`), so reading content is never reconstructed.
- For listening Part 1/2/3 image options, the crop-order from the page-image
  extraction pipeline (`p{page}_i{idx}.*`, `idx` increasing) reliably corresponds to
  left-to-right/top-to-bottom (A)(B)(C) reading order — confirmed by cross-referencing
  each resulting image's content against the dialogue/question text and the official
  correct-letter answer for every group in Đề 4's Part 2 (Q26–40) and Part 3 (Q41–45).
  Trust `idx*3+j → label "ABC"[j]` without needing per-question manual disambiguation,
  but still spot-check a handful of the final copied files by eye before finishing.
- **Per-image extraction via `doc.extract_image(xref)` (raw embedded stream) breaks on
  CMYK JPEGs** — it skips the PDF's `/Decode` array, so the un-inverted colors come out
  dark/inverted. The fix is to crop from the rendered page instead:
  `page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=fitz.Rect(bbox))`. **But this
  clip+matrix approach has its own zoom-dependent bug in this PyMuPDF build (1.28.0 /
  MuPDF 1.29.0): at `zoom=300/72` it silently compositing the wrong tile for at least
  one bbox region** (confirmed: Đề 4 listening `q29_C` — the `(chicken-restaurant over
  cinema)` image — rendered as an unrelated `(sink/toilet shelf)` image from a
  different question's bbox, while the *identical* `clip=fitz.Rect(bbox)` on the same
  page at `zoom=150/72` rendered correctly). This is invisible to naive
  pixel-diff/dHash checks against a same-zoom "ground truth" crop of the full page,
  since a wrong-but-similarly-sparse line drawing can still hash close to the right
  one — verify page-crop correctness against a full-page render done at a **different**
  zoom than the one being audited (e.g. audit 150dpi production output against a
  freshly-rendered 200dpi ground truth crop, not another 150dpi one), and treat a
  handful of manual eyeball spot-checks as non-optional even when the automated diff
  says "clean." Use `zoom=150/72` (150dpi) for these per-image crops — confirmed
  correct across all of Đề 4's 147 crops (reading `images/` + listening `images/`) via
  this cross-zoom dHash audit, worst-case distance 7/64 bits, vs. clearly-wrong crops
  scoring much higher when this bug was triggered at 300dpi.
- Per-paper part boundaries are **not guaranteed to match Đề 1's**. Đề 2's reading
  Part 3 (選詞填空) turned out to be a single 5-question group (Q31–35) instead of
  Đề 1's two groups of 5 (Q31–40), with the freed-up range absorbed into Part 4
  (完成段落) as *two* passage groups (Q36–40 and Q41–45) instead of Đề 1's one.
  Similarly Đề 2's listening Part 2/3 boundary fell at Q11–25/Q26–40 (15+15) rather
  than Đề 1's Q11–28/Q29–40 (18+12). Đề 5's listening boundary is different again:
  Part1=Q1–25, Part2=Q26–40, Part3=Q41–45, Part4=Q46–50 (25+15+5+5) — confirmed both
  from the exam PDF's own `第N部分(第X～Y題)` headers and from the official script's
  matching part breaks. Đề 5's reading boundary matches Đề 1's shape (15/15/10/5/5,
  with reading Part 3 split into two 5-question groups g31_35/g36_40). Always verify
  part boundaries from the paper's own `text.txt` (reading) or page-image layout +
  `manifest.json` image-per-page counts (listening) before assuming a fixed template.
- **Mapping between a paper's "Đề N" and the vendor's own mock number `M`** (used in
  the `ls_mockM_test_BandA_listen.pdf` URL): empirically `M = 6 - N` for Đề 1–4 (Đề 1
  → mock5, Đề 2 → mock4, Đề 3 → mock3, Đề 4 → mock2 — read straight off each
  `scratchpad/audio/N/mockM_BandA_mp3_*/` folder name). Đề 5 breaks the pattern: its
  audio archive's internal folder is literally named `mock_BandA_mp3_vie` with **no
  digit at all** (confirmed via `UnRAR.exe lb` on the `.rar`, not just the extracted
  folder — ruling out an extraction-step accident). This lines up with the earlier
  finding that `M=1` 404s on the numbered URL: `M=1` isn't numbered in the vendor's own
  naming either. The actual URL that works for this case is the number-less
  `https://tocfl.edu.tw/assets/files/mock/ls_mock_test_BandA_listen.pdf` (200 OK, 9
  pages) — try this exact no-digit variant whenever a paper's audio folder name also
  lacks a digit, instead of concluding the script is unavailable.
- **The official `ls_mock*_test_BandA_listen.pdf` script does not print Part 4's
  (A)(B)(C)(D) text options** — it only has the spoken dialogue + the final spoken
  question line, because those options are never read aloud (only Part 1's options
  are spoken; Part 2–4 options are print-only). For Part 4 text options, read them
  straight off the actual exam PDF's own text layer instead (`scratchpad/listeningN/
  text.txt`, the last page(s), right after the `第四部分` header) — the printed test
  booklet always includes them even though the listening PDF has no text layer for
  the spoken dialogue itself. Confirmed working for Đề 5 (Q46–50 options pulled
  verbatim from `text.txt` page 16, not reconstructed).
- Confirmed via a cross-zoom dHash audit (`scratchpad/audit_crops.py`) that Đề 1–3's
  crops (520 total across both sections) are also clean at 150dpi — 0 flagged. All 5
  papers' image pipelines now standardize on `CROP_DPI = 150` in `extract_images.py`.

## Exercises source picker (`/exercises`, `/exercises/[date]`)

`vocabularies.source` (`study`/`practice`, see Data model notes above) means a single
day's set can mix both categories. `/exercises` (the calendar) now fetches a
`source` breakdown alongside the existing vocab-count query and, when a clicked
date has vocab in **both** categories, opens a modal (instead of navigating
straight through a `Link`) offering "Từ Vựng Tự Học" / "Từ Vựng Khác" / "Cả Hai" —
each option pushes `/exercises/[date]?source=study|practice|all`. Days with only
one category (or no vocab) skip the modal and navigate directly.
`/exercises/[date]/page.tsx` reads that `?source=` param via `useSearchParams` and
filters the `vocabularies` query with `.eq('source', ...)` when it's `study` or
`practice` (no filter for `all`/missing — preserves old links that never had the
param). Since this version of Next.js suspends `useSearchParams` on a full/direct
page load (not just client navigations — see
`node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`), the page
component had to be split into an outer default export that just wraps an inner
`DateExercisesPageInner` in `<Suspense>`, otherwise production builds fail with
"Missing Suspense boundary with useSearchParams". Exercise completion records
(`exercise_records`) are still tracked per-date only, not per-source-selection —
picking "Từ Vựng Khác" and finishing both games marks the whole date complete on
the calendar, same as before.

## TOCFL mock-exam feature architecture (`/thi-thu`, `/practice-exam/[paper]`)

Two distinct exam-taking UIs share the same DB content (`tocfl_papers` /
`tocfl_questions`, migration `0009_tocfl_exam`) and the same rendering components in
`components/tocfl/examShared.tsx` (`useTocflPaper`, `buildSteps`, `StepCard`,
`QuestionOptions`, `formatTime`):

- **`/thi-thu/[paper]`** — strict timed mock exam (matches the real test): listening
  section is forward-only (no jumping back, audio autoplays once per question, 60min
  countdown auto-advances to reading on expiry), reading section is free-navigation
  within itself with a jump palette, submit only appears in reading. Every completed
  attempt is persisted to `tocfl_attempts` (used by `/thi-thu`'s grid cards to show
  score history/trend per paper).
- **`/practice-exam/[paper]`** — free-navigation practice mode: both sections combined
  into one view with a "Phần Nghe"/"Phần Đọc" section-tab toggle plus a right-side
  question-number panel (spans all 100 questions) that jumps directly to any question
  in either section on click, no timer, "Nộp Bài" is always visible and scores
  whatever's been answered so far. Does **not** write to `tocfl_attempts` (this mode
  is deliberately not counted in the Thi Thử score-history grid — it's practice, not a
  mock-exam attempt).

`/practice-exam` (the index) used to also offer an auto-generated quiz mode
("Luyện Tập Nhanh"/"Thi Thử Đầy Đủ", built from `dictionary_words` +
`comprehension_passages` via `lib/utils/practiceGenerator.ts`/`examGenerator.ts`,
saved to `practice_sessions`) — that's been removed from the page entirely per
user request; it now only lists the 5 official papers (linking into
`/practice-exam/[paper]`) plus the official tocfl.edu.tw resource link.
`practiceGenerator.ts`/`examGenerator.ts` and the `comprehension_passages` /
`practice_sessions` tables still exist (nothing was migrated away) but are no
longer referenced from any page — only touch them if this feature comes back.

Key rendering rule in `StepCard`/`ExamRunner`: **`prompt_hanzi` (the question/dialogue
text) is only rendered when `showPromptText` is true, which both pages only pass for
`section === 'reading'`.** The real TOCFL listening booklet never prints the spoken
question or dialogue — only the picture (if any) and the answer choices are on the
page, everything else is audio-only. This also happens to sidestep an integrity issue:
for papers whose "answer key" PDF turned out to be a bare grid with no transcript, the
`promptHanzi` text stored in the DB for listening Parts 1–3 was sometimes
*reconstructed* to fit the correct answer rather than transcribed verbatim
(`correctIndex` is always grid-verified regardless) — since it's never displayed
during either exam mode, that distinction doesn't leak into the UI, only into the
stored data.

`options` on a `tocfl_questions` row is `[{label, text?, imagePath?}]` — `QuestionOptions`
switches to an image-grid layout automatically whenever any option has `imagePath`.
`group_key` bundles multiple question rows that must render as one screen (reading
Part 3's shared situational image, Part 4's shared 6-choice passage cloze) — see
`buildSteps()`, which folds consecutive same-`group_key` questions into a single
`Step`.

**Re-seeding a paper after fixing its content/assets**: edit `scripts/tocfl-content/
reading-N.json` / `listening-N.json` (or the images/audio under `public/tocfl/A/...`),
then `node scripts/build-tocfl-seed.js N` (or with no args to reseed all found
papers) followed by `npx prisma db execute --file scripts/output/tocfl-seed.sql` — the
generated SQL uses `ON CONFLICT ... DO UPDATE`, so it's safe to re-run against an
already-seeded paper. If only the image/audio *file bytes* changed (same path), no
reseed is needed at all — Next.js serves `public/` statically.

**Estimated banding (`estimateBand` in `lib/types/tocfl.ts`)**: TOCFL's real pass/fail
cut uses IRT scaled scoring calibrated from a proprietary SC-TOP item bank, which
isn't published — this can't be reproduced exactly by anyone outside SC-TOP. Both exam
modes show a raw score (số câu đúng/tổng) plus a clearly-labeled *estimated* band
(commonly-cited ~60%/~80% correct-rate thresholds), never presented as the official
result.

---

**Rule for future sessions:** when you finish a task in this repo, update this file
with anything a future agent would need to know that isn't obvious from the code —
new architectural decisions, gotchas you hit, non-obvious "why"s. Keep entries
concise; prune anything that's become stale or is now just derivable from reading the
code.
