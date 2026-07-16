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

## Band A supplement + Band B import (`dictionary_words`, migrations 0010/0011)

- Source: `OTAB19.xlsx` (gitignored, user-supplied), sheet `BAN A` (a personal
  self-quiz export, columns B/C/D = hanzi/pinyin/nghĩa; columns G-J are unrelated quiz
  self-check data, not dictionary content) and sheet `BAN B` (4005 rows, columns
  index/hanzi/pinyin/nghĩa/điền-hán-tự/check/loại/level, level already tagged `B1`/
  `B2` — used verbatim, never re-derived, since the user explicitly wants their own
  spreadsheet's band labels as the source of truth).
- Migration `0010_band_a_supplement` adds 25 words present in `BAN A` but missing from
  the original A1/A2 import — cross-checked by hanzi, normalizing full-width vs
  half-width parens/slashes first (naive exact-string diff falsely flagged `車（子）`
  as missing; it already existed as `車(子)` half-width). Slash/variant entries whose
  meaning was already covered by an existing word (`他/她` when `他` already meant
  "anh ấy, cô ấy", `午餐/午飯` when `午餐` already existed, etc.) were intentionally
  **not** duplicated. Band A itself was never deleted or edited — additive only, per
  explicit user instruction.
- Migration `0011_band_b` imports Band B wholesale (3953 clean rows after dropping 14
  bare alphabet section-header rows, 1 emoji-corrupted row, and 8 exact duplicates from
  the raw 4005; ~22 rows had hanzi+pinyin but no Vietnamese meaning in the source and
  were hand-filled from general Chinese vocabulary knowledge — see
  `scripts/output/band-b.review.txt` for the full raw-row audit trail this was
  reconciled against). `example_*` columns are left NULL — Band B examples are
  authored in a separate follow-up pass (see below), by hand/AI rather than templates,
  per explicit user request for "chính xác, thực tế" quality.
- **pinyin-pro (3.28.1) mis-reads common function-word polyphones regardless of
  context**: 們 → wrongly "mén" (should be neutral "men"), 麼 → wrongly "mó" (should be
  neutral "me" in 什麼/怎麼/那麼/這麼), 車 → wrongly "jū" (surname/chess reading; should
  be "chē" for the vehicle word), 還 → wrongly "huán" (should be "hái" in 還沒/還是/還
  有). This is a **pre-existing bug already present in previously-committed data**
  (e.g. `scripts/output/band-a-examples-real.sql` has "huǒ jū bān cì" instead of "huǒ
  chē bān cì") — not something introduced this session, just newly confirmed. New
  hand-authored example pinyin in this session worked around it by generating each
  sentence's pinyin via `pinyin-pro`'s array mode (one entry per character) and
  overriding the exact character positions matching 們/麼/車/還 before joining — the
  one-off script used for migration `0010`'s examples was not kept in the repo, but
  the technique is worth reusing if similar generation scripts are run again. No
  blanket fix was applied to the ~900 already-committed Band A example rows —
  flagging here in case a future session wants to do a targeted find-and-fix pass.

## `/review-dictionary` "Điền Từ" (fill-in-the-blank) mode

- Alongside the existing Flashcard→Matching pipeline, clicking a level card now opens
  a mode-select modal (Flashcard vs Điền Từ) before the existing stage-size chooser.
  Điền Từ shows a table (`components/exercises/FillInExercise.tsx`): hanzi given up
  front, student reconstructs it by typing toneless pinyin into the same TOCFL/CC-CEDICT
  IME-style composer used on `/vocabulary` (own self-contained copy of the composer
  logic — deliberate duplication, matching this codebase's established pattern of not
  sharing that particular piece of state, see the vocabulary composer's own comments).
  A row auto-grades (Đúng/Sai + reveals nghĩa) the instant the composed answer's
  character length reaches the target word's length — no separate submit step per row.
- `dictionary_progress` gained a `mode` column (`'flashcard' | 'fill_in'`, migration
  `0012_dictionary_progress_mode`; unique constraint changed from `(user_id, level)` to
  `(user_id, level, mode)`) so the two modes never share or clobber each other's
  per-level progress. Every dictionary_progress query in `review-dictionary/page.tsx`
  needed an added `.eq('mode', activeMode)` / `mode` upsert field — grep for
  `activeMode` there before adding a new progress-touching code path. Level-select
  cards show two independent progress rings (Flashcard + Điền Từ) per level.
- **Điền Từ (fill_in) word pool is restricted to learned flashcard words**:
  - The pool of words available to study in `fill_in` mode is restricted to words that the user has already studied and marked complete in `flashcard` mode (extracted from the `word_order` array up to `current_index` of the flashcard progress).
  - Syncing happens during `startLevel` and `continueNextStage`: already completed `fill_in` words are retained at the beginning of the `fill_in` progress `word_order` array, while newly learned flashcard words are appended in a shuffled order.
  - If no flashcards are learned, or if all learned words have been completed in `fill_in`, the page displays a warning card instead of the stage size presets. A direct "restart" helper exists to reset `fill_in` mode back to the learned flashcards pool.
  - Custom stage sizes and presets are capped by the remaining reviewable learned words (`learnedFlashcard - learnedFillIn`).
- **`/review-dictionary` never called `ensureProfile()`** (only `/vocabulary` and the
  import API route did) — a user whose very first page after signup is
  `/review-dictionary` had no `profiles` row yet, so the first `dictionary_progress`
  upsert 409'd on the `dictionary_progress_user_id_fkey` FK. There is **no DB trigger**
  actually creating profile rows in this project currently (confirmed by querying a
  freshly-signed-up test user: zero `profiles` row after browsing multiple pages) —
  `ensureProfile()` is the *only* thing that does it, despite its comment describing
  itself as a "safety net" for when a trigger hasn't fired. Now called from
  `loadLevelInfos()` too. If a new profile-dependent page/table is added anywhere,
  check it calls `ensureProfile()` first rather than assuming a trigger exists.

## `dictionary_words` row-count cap (PostgREST default 1000-row limit)

Band B roughly quintupled `dictionary_words` (~900 → ~4850 rows), which silently
exposed a latent bug: **Supabase/PostgREST caps any single `select()` response at 1000
rows by default (`db.max_rows`)**, regardless of what `.limit()`/no-limit was
requested client-side — invisible before because every unfiltered or per-level query
happened to stay under 1000. Symptoms observed: `/dictionary` silently showed only a
truncated word list; `/review-dictionary`'s level cards showed wildly wrong totals
(A2 read "14" instead of 386, B2 didn't appear as a card at all); starting a Flashcard/
Điền Từ session on B1/B2 would have built stages from an incomplete, arbitrarily-cut
word set. Fixed via `lib/utils/supabasePagination.ts`'s `fetchAllRows()` (loops
`.range()` in pages of 1000 until a short page comes back) for anywhere all matching
rows are genuinely needed, and via `{ count: 'exact', head: true }` per-level requests
(no rows fetched at all) for the level-card counts specifically. **Any new query
against `dictionary_words` (or any other table that could plausibly exceed 1000 rows)
must use one of these two patterns, never a bare `.select()`.**

## Pinyin suggestion composer (`/vocabulary` + `/review-dictionary` Điền Từ)

- **Numbered-tone input** ("ni3" → "nǐ") is now supported everywhere the toneless
  composer exists (`lib/utils/pinyin.ts`'s `parseNumberedSyllable`/`syllableTone`/
  `sortByRequestedTone`, wired into all 5 `lookupSuggestions`-shaped functions across
  `vocabulary/page.tsx` and `FillInExercise.tsx`). A query matching `^[a-z]+[1-5]$` is
  parsed into `{base, tone}`; the toneless `base` is used for the actual index lookup,
  then results are reordered (not filtered — a wrong/mistyped tone still surfaces
  something) so entries whose first-syllable tone matches come first.
- **`loadTocflIndex()` had a race condition** that silently dropped suggestions: its
  dedup guard (`if (indexRef.current || loadingRef.current) return`) let a
  `lookupSuggestions` call that fired *while the ~5.5MB index was still downloading/
  parsing* return immediately with a null index instead of waiting for the in-flight
  load — meaning the very first keystroke right after focusing a composer input (the
  most common case: `onFocus` kicks off the load, then the user immediately types)
  frequently showed zero suggestions for no visible reason. This is very likely what
  was behind reports of "nhiều từ muốn ghi mà nó không hiện gợi ý" (many words don't
  show suggestions). Fixed by storing the in-flight fetch as a `Promise` (not a
  boolean) that every caller awaits — same fix applied in both
  `vocabulary/page.tsx` and `FillInExercise.tsx` (2 separate copies, not shared, same
  reasoning as above).
- **`public/tocfl-index.json` now also merges this project's own `dictionary_words`**
  at top priority (`l: 0`, ranks before every real TOCFL level 1-7), via
  `scripts/dump-own-dictionary.js` (writes `scripts/output/own-dictionary-words.json`,
  requires `DATABASE_URL`/`pg`, a devDependency added this session) →
  `scripts/build-dictionary-index.js` (also merges CC-CEDICT + the PSeitz TOCFL list
  as before; `MAX_PER_KEY` raised 12→24, per-lookup prefix-search slice raised 8→15).
  **Re-run both scripts in that order whenever `dictionary_words` changes materially**
  (a new band imported, a batch of examples/words added) so the composer keeps
  suggesting every word actually in this app's own dictionary, not just what CC-CEDICT/
  TOCFL happen to rank highly.

## `/learn` calendar vocab-count badges

`components/ui/DatePicker.tsx` (the dropdown calendar used on `/learn` and `/vocabulary`)
now optionally accepts `vocabCountMap` (dateStr -> count, renders a small badge per day,
same idea as `/exercises`'s calendar grid) and `onMonthChange(year, month)` (fired on
mount and whenever the dropdown's viewed month changes). Both are optional so the
`/vocabulary` usages are unaffected. `/learn/page.tsx` owns the actual fetch
(`loadMonthVocabCounts`, mirroring `/exercises`'s `loadCompletionData` vocab-count half)
and passes the result down — the DatePicker component itself stays DB-agnostic.

## Hán tự font (`--font-chinese` / `.font-chinese`)

Switched from **Noto Sans SC** (Simplified Chinese, sans) to **Noto Serif TC**
(Traditional Chinese, serif) in `app/layout.tsx` + `app/globals.css`, to match the font
monchinese.me actually uses for hanzi (their `--font-hanzi` defaults to
`var(--font-hanzi-serif), "Noto Serif TC", "PingFang TC", "Microsoft JhengHei", serif` —
confirmed by fetching their compiled CSS). This was a real correctness bug, not just a
style mismatch: this app teaches TOCFL/Taiwan (Traditional) content, so Simplified-region
glyph variants were subtly wrong for some characters, not just visually different.
**Gotcha hit while verifying:** an already-running `next dev` process did not pick up the
`.font-chinese { font-family: ... }` literal rule in `globals.css` via HMR — the
Tailwind-generated `--font-chinese`-based utility recompiled fine, but the hardcoded
rule kept serving the old value until the dev server was fully restarted (`.next/dev`
cleared). If a future font/global-CSS change looks like it "didn't take" in a
long-running dev session, restart the dev server before assuming the edit is wrong.

## Topic-based vocabulary learning (`/vocabulary-by-topic`, `topic_vocabulary` table)

New page linked from the sidebar as "Học Theo Chủ Đề", directly below "Ôn Tập Từ Điển".
Lets a student browse+flashcard vocabulary grouped into the same ~14 life-topic
categories monchinese.me uses (🏠 Nhà cửa & Đời sống, 📚 Học tập & Giáo dục, 💬 Thông tin
& Giao tiếp, etc. — canonical order in `lib/utils/topicVocabulary.ts`'s `TOPIC_ORDER`),
per level A1/A2/B1/B2. monchinese splits each (level, topic) into multiple `#1/#2/#3...`
sub-collections; those are merged into one group here per explicit user request.

- **Backing table is `topic_vocabulary` (migration `0013_topic_vocabulary`), deliberately
  NOT a column on `dictionary_words` and NOT new rows mixed into it.** This was a hard
  requirement — the feature must never risk `dictionary_progress`/`exercise_records` or
  any other existing student progress data. It has its own RLS read-only policy
  (`Anyone authenticated can read topic vocabulary`, same shape as `dictionary_words`'s)
  and no progress/completion tracking of its own — this page is pure browsing/flashcard,
  not a spaced-repetition system, so there was nothing progress-related to build.
- **A1/A2/B1 rows (848 words) are scraped from monchinese.me**, per explicit user
  instruction to source real content (including their example sentences) rather than
  auto-classifying our own dictionary_words for those levels. `scripts/
  scrape-monchinese-words.js words` fetches all 60 `/learn/<slug>` collection pages
  (slugs + topic metadata pre-extracted into `scripts/output/monchinese-slugs.json`,
  itself derived by regex-scraping monchinese.me/learn's SSR'd HTML — see git history if
  that ever needs regenerating, e.g. if they add new collections) and regex-parses each
  word's hanzi/hanzi_variant(simplified)/pinyin/vietnamese/pos/dictionary-link straight
  out of the server-rendered `<li><details>` markup (no JS execution needed — the list is
  SSR'd, only individual card *expansion* is client-side). `... examples` then visits
  every unique word's `/dictionary/<hanzi>` page and pulls the first entry under that
  page's own "Ví dụ" section (hanzi + Vietnamese translation only — monchinese's
  dictionary page doesn't print pinyin for examples, only TTS audio). Both steps are
  idempotent/re-runnable; a 250ms/200ms per-request delay was used to be a reasonably
  polite scraper. Confirmed 100% example coverage (845/845 unique words) on the one run
  done so far.
- **B2 rows (2471 words) are this app's own `dictionary_words` (level='B2'), auto-
  classified into the same topic taxonomy by keyword** (`scripts/classify-b2-topics.js`),
  since monchinese.me's `/learn` page has no B2/CEFR-labeled collections at all (only
  A1/A2/B1, plus non-CEFR "L0/N1/N2" tiers) — confirmed by scraping their page's full
  level list. This was an explicit user decision among 3 offered options (borrow their
  N1 tier / auto-classify our own B2 / leave B2 empty), not something to reconsider
  without asking again. Classification checks `pos` first for grammatical function words
  (`Conj`/`Prep`/`Det`/`Ptc`/`Vaux` → `function-words`, matching monchinese's "Từ chức
  năng & Hư từ" bucket), then falls back to Vietnamese-gloss keyword matching against a
  curated per-topic keyword list, narrowest/most-specific topics checked first (health,
  law, personality, food... before broad catch-alls like work-finance/home-living/
  communication). **~79% of B2 words (1945/2471) fall into a catch-all `other` ("Khác")
  topic** — this is not a keyword-coverage bug to chase further; B2-level vocabulary
  trends heavily abstract/formal-register (詞彙, 措施, 促進, 傳統...) and genuinely doesn't
  fit monchinese's beginner-life-topic taxonomy no matter how much the keyword lists are
  expanded (spot-checked a 60-word sample of the "other" bucket to confirm this before
  accepting the result). If B2 topic coverage ever needs improving, the leverage is in
  `TOPIC_KEYWORDS` in `classify-b2-topics.js`, but expect diminishing returns.
- **Regenerating the seed**: `node scripts/scrape-monchinese-words.js` (or `words`/
  `examples` individually) → `node scripts/classify-b2-topics.js` → `node scripts/
  build-topic-vocab-seed.js` → `npx prisma db execute --file scripts/output/
  topic-vocab-seed.sql`. The seed SQL uses `ON CONFLICT (level, topic_key, hanzi,
  pinyin) DO UPDATE`, so it's safe to re-run. Only re-run the B2 classification step
  after `dictionary_words` B2 content changes; only re-run the monchinese scrape if
  their site content changes (unlikely to need often).
- **pinyin-pro polyphone workaround extended**: generating pinyin for the scraped
  monchinese example sentences (which only ship hanzi + Vietnamese, no pinyin) hit a new
  case beyond the 們/麼/車/還 already documented above — **乾 defaults to the rare "qián"
  (trigram/surname) reading instead of "gān" (dry)**, which is virtually always the
  intended reading in everyday vocab like 乾淨/餅乾. Added to the same blanket
  character-substitution fix, now in `build-topic-vocab-seed.js`'s `POLYPHONE_FIXES`
  (this project has two independent copies of this workaround now — the original
  one-off Band A script wasn't kept in the repo, per the earlier note above).

## Điền Từ (fill-in) rolled out to the topic page + `/learn`, `/exercises/[date]`, `/review`

Follow-up session to the topic-vocabulary work above, per explicit user request: "Nối Từ"
(matching) and "Điền Từ" (fill-in) needed to follow Flashcard on `/vocabulary-by-topic`
(with per-mode progress persisted and shown on the topic cards), and `/learn`,
`/exercises/[date]`, `/review` each needed their own Điền Từ addition too.

- **`topic_vocabulary_progress`** (migration `0014`) — mirrors `dictionary_progress`'s
  shape (`word_order` uuid array + `current_index`) but keyed by `(user_id, level,
  topic_key, mode)` with **three** modes instead of two: `'flashcard'` (pool = every
  word in the topic), `'matching'` (pool = words already completed in `'flashcard'`),
  `'fill_in'` (pool = words already completed in `'matching'`) — a two-step gating
  chain, extending the exact pattern `dictionary_progress` already used for its single
  `fill_in`-gated-by-`flashcard` mode. Fully separate table from `dictionary_progress`,
  so this can never touch the existing Ôn Tập Từ Điển progress.
- **Two distinct entry paths through `/vocabulary-by-topic`'s mode-select modal**
  (Flashcard / Nối Từ / Điền Từ, shown on every topic-card click): choosing
  **"Flashcard"** sets `chainMode=true` and auto-advances Flashcard → Nối Từ → Điền Từ
  for the *same* stage batch in one sitting (all three progress rows advance together,
  by the same word count) — `ChainStepTracker` (a 3-icon version of review-dictionary's
  `StepTracker`) is shown throughout so it's visually obvious this is one pipeline, not
  three unrelated screens. Choosing **"Nối Từ" or "Điền Từ" directly** sets
  `chainMode=false` and only drills that single mode's own backlog (words available per
  the gating chain but not yet done in *that* mode) — only that mode's progress
  advances, and no `ChainStepTracker` is shown. Both paths share the same stage-size
  chooser UI as review-dictionary (`STAGE_SIZE_PRESETS`), sized against whichever mode's
  own "remaining" count is relevant — necessary because topic sizes now range from 4
  words (B2 travel) to 1945 (B2 "Khác"), and a giant single Nối Từ/Điền Từ batch would
  be unusable.
- **Gotcha hit while verifying**: the stage-size chooser's description text
  originally read `chainMode ? '...' : '...'`, but `chainMode` state isn't set until
  `startTopic()` actually runs (which only happens after the user clicks "Bắt Đầu
  Học") — so the chooser screen always showed the *previous* session's chainMode value
  (stale on first visit, or leftover from whatever mode was last started). Fixed by
  checking `activeMode === 'flashcard'` directly at that specific call site instead of
  the `chainMode` state, since `activeMode` is set synchronously the moment a mode
  button in the modal is clicked. The actual chained-session screens (flashcard/
  matching/fill_in steps themselves) don't have this bug — `chainMode` is set at the
  top of `startTopic()`, before any `await`, so it's committed well before `loadStage`
  flips `step` to render one of those screens.
- **Topic cards now show 3 compact `ProgressRing`s** (Flashcard/Nối Từ/Điền Từ,
  `size=30` vs review-dictionary's `size=40` for its 2-ring cards — needed to fit a
  third ring in the same card width) instead of opening a topic directly; clicking a
  card now always opens the mode-select modal first. Verified via direct
  `topic_vocabulary_progress` DB seeding + screenshot that ring percentages compute
  correctly (`learnedMatching / learnedFlashcard`, `learnedFillIn / learnedMatching` —
  each ring's denominator is the *parent* mode's learned count, not the topic total,
  matching the gating chain).
- **`exercise_records.exercise_type` collision avoided**: `/exercises/[date]` already
  needed its own new `'fill_in'` type for its 3rd exercise card. `/learn`'s new Điền Từ
  mode could **not** reuse the same `'fill_in'` string — `exercise_records`' unique key
  is `(user_id, date, exercise_type)`, so completing Điền Từ on one page would silently
  mark the *other* page's same-day Điền Từ exercise complete too. `/learn` now writes
  `'learn_fill_in'` instead (see `EXERCISE_TYPE` map in `learn/page.tsx`), keeping the
  two fully independent. `/review`'s Điền Từ step doesn't need a new type at all — it
  folds into the same single `'review_cumulative'` summary record the page already
  wrote at the end of its (now longer) Flashcard → Nối Từ → Điền Từ pipeline.
- **Fixed a dormant bug while adding `/exercises/[date]`'s 3rd card**: `/exercises`
  (the calendar) and `/dashboard` both had `completedCount === 2`/`=== 3` off-by-one
  mismatches — `/exercises/page.tsx`'s calendar checked `completedCount === 3` for the
  "fully done" green checkmark but only ever counted 2 exercise types
  (`hanzi_pinyin`/`hanzi_viet`), so that checkmark could **never** trigger; `/dashboard`
  was internally consistent at `/2` and `=== 2` but for the same reason under-counted.
  Both now count `hanzi_pinyin`/`hanzi_viet`/`fill_in` (3 types) and use `=== 3`/`/3` —
  this was very likely the original intended design (a 3rd exercise type that never got
  built), not a new threshold invented for this feature.
- `/exercises/[date]`'s Điền Từ card passes the whole day's `vocabs` array to
  `FillInExercise` directly (no chunking) since a day's vocab set is naturally small.
  `/review`'s Điền Từ step likewise passes the whole `mergedVocabs` array at once (no
  `ITEMS_PER_ROUND` batching like its Matching step uses) — `FillInExercise` renders as
  a scrollable table, which stays usable at larger counts unlike `MatchingExercise`'s
  fixed 2-column visual game board, so only Matching genuinely needs chunking.

## Flashcard "Ôn Tập Từ Đã Học" (review already-learned words) on `/vocabulary-by-topic`

Previously, once `remaining` (`total - learnedFlashcard`) hit 0 for a topic's Flashcard
mode, the stage-size chooser was entirely unreachable — the page showed a dead-end
"Bạn đã học hết tất cả các từ..." warning with no way to revisit words already learned,
and there was no way to re-drill a *partial* batch (e.g. 10 learned out of 50) either.
Per explicit user request, added a review path that sits alongside (not replacing) the
existing new-words flow:

- New state: `learnStyleTopicKey` (drives a new sub-modal) and `reviewMode` (boolean,
  threaded through `startTopic`/`finishFlashcardStage`/the stage-size chooser/the
  completion screen).
- Clicking **"Flashcard"** in the existing mode-select modal now branches: if
  `learnedFlashcard > 0` for that topic, it opens a new "Học Từ Mới" / "Ôn Tập Từ Đã
  Học" sub-modal instead of going straight to the stage-size chooser (topics with
  `learnedFlashcard === 0` skip straight to the chooser as before, since there's
  nothing to review yet). "Học Từ Mới" is disabled once `total - learnedFlashcard <=
  0` (fully learned) but "Ôn Tập Từ Đã Học" is always available whenever any words
  have been learned — this is what fixes the old dead-end for a topic learned 100%.
- **Review sessions never touch `topic_vocabulary_progress`.** `startTopic(topicKey,
  'flashcard', size, isReview=true)` pulls `getLearnedIds()` from the existing
  flashcard progress row, shuffles a fresh batch of up to `size` of those *already-
  learned* ids, and feeds it through the **same** `loadStage()` used by the real
  flow (passed as `(shuffled, 0, learnedIds.length, size)` — `loadStage` just slices
  `wordOrder.slice(currentIndex, currentIndex+size)`, so reusing it as-is with a
  synthetic 0-indexed word_order works with no changes to that function). Reaching
  the end of a review batch (`finishFlashcardStage`, checked via the `reviewMode`
  state) skips `persistProgressAdvance` and the auto-chain into Nối Từ entirely, going
  straight to a review-flavored completion screen ("Ôn Tập Xong!") with two buttons:
  "Ôn Tập Lại" (calls `startTopic` again — reshuffles a new random batch from the same
  learned pool, does not chain to a "next stage" like the real flow's `current_index`-
  based continuation, since a review pool has no forward pointer to advance) and
  "Quay Lại Chọn Chủ Đề".
- Because review is a dead-end/reshuffle loop rather than a paginated sequence, the
  stage-size chooser's "remaining" for review mode is simply `learnedFlashcard` itself
  (capped by the same `STAGE_SIZE_PRESETS`), not a countdown that depletes — reviewing
  10 words twice in a row is expected and fine, unlike the real flow where finishing a
  stage advances `current_index` so the same words can't be redrawn.
- **Update:** the Matching/Điền Từ review gap above was fixed in a follow-up session —
  see "Review mode extended to Matching/Điền Từ" below. This bullet is kept only as
  the historical note that motivated the fix.

## Review mode extended to Matching/Điền Từ on `/vocabulary-by-topic`

Users hit a dead end picking "Nối Từ" or "Điền Từ" directly (not via the Flashcard
chain) on a topic already fully drilled in that mode: the mode-select modal only ever
computed a "new words" pool (`parentMode`'s learned count minus this mode's learned
count), which is 0 once everything's been matched/filled-in, so nothing loaded and
there was no way to redo it — this is the exact gap flagged in the note above.
Generalized the same "review already-learned pool, no progress writes, reshuffle
dead-end" pattern Flashcard already had to all three modes:

- `learnStyleTopicKey`'s sub-modal ("[Mode] Mới" / "Ôn Tập Từ Đã Học") now opens for
  **any** mode once that mode has `> 0` learned words, not just Flashcard — gated via
  a new `learnStyleMode` state (which mode the modal is currently offering) instead of
  being hardcoded to `'flashcard'`. Two helpers, `modeLearnedCount(info, mode)` and
  `modePoolTotal(info, mode)`, centralize "how many learned in this mode" / "size of
  this mode's own draw pool" (flashcard draws from `total`; matching draws from
  `learnedFlashcard`; fill_in draws from `learnedMatching`) — used everywhere the old
  code inlined a `mode === 'flashcard' ? ... : mode === 'matching' ? ... : ...` ternary
  keyed only off `learnedFlashcard`.
- `startTopic`'s `isReview` branch now fetches the progress row for **the mode being
  reviewed** (`fetchProgressRow(user.id, topicKey, mode)`), not always `'flashcard'` —
  so reviewing Matching pulls from Matching's own completed pool (words already
  matched), not the Flashcard pool.
- `handleMatchingRoundComplete`/`handleFillInComplete` gained the same `reviewMode`
  early-return `finishFlashcardStage` already had: skip `persistProgressAdvance`
  entirely and go straight to a non-chaining completion screen. Without this, a
  Matching/Điền Từ review session would have silently advanced real progress on
  words that were, by definition, already complete.
- The completion screen's "Ôn Tập Lại" button was hardcoded to
  `startTopic(activeTopicKey, 'flashcard', ...)` — changed to `activeMode` so
  reshuffle-and-repeat works for whichever mode is actually being reviewed.
- Stage-chooser copy ("Đã học"/"Có thể ôn tập"/empty-pool warning) generalized via
  `MODE_VERB`/`MODE_LEARNED_LABEL`/`MODE_NEW_LABEL` lookup tables instead of text
  hardcoded to Flashcard/"học" wording.

## Bug: entering Matching any way other than the Flashcard chain rendered an empty board

Found via a live-DB check (querying `topic_vocabulary_progress` directly with a small
`pg` script) after a user report of "chọn Nối Từ / Điền Từ không ra gì cả" — the
`matching` progress row for their topic had exactly the right word_order (their 6
learned-but-unmatched flashcard words, all valid ids in `topic_vocabulary`), so the
data layer was fine; the bug was purely in the client never rendering it.

**Root cause**: `loadStage()` — the one function every entry path (direct mode
selection, "Học Đợt Tiếp Theo" via `continueNextStage`, and the review flow added
above) funnels through to actually load a stage's words — sets `stageWords` but never
touches `roundVocabs`/`matchingRound`/`matchingType`. Those are only initialized by
`finishFlashcardStage()`'s manual `setMatchingRound(0); setMatchingType('hanzi_pinyin');
prepareMatchingRound(0)`, which runs solely on the Flashcard→Matching **chain**
transition (`chainMode`). Any other way of reaching the Matching screen left
`roundVocabs` at its previous value (`[]` on a fresh session) — `MatchingExercise`
then rendered with an empty `vocabs` array: no crash, just a blank board, which reads
as "nothing happens when I click Nối Từ." Fill-in never had this problem since
`FillInExercise` is handed `stageWords` directly (no per-round slicing), so only
Matching was affected — and only via non-chain entry, so it was invisible as long as
the Flashcard→Matching→Điền Từ chain was the only path anyone exercised.

**Fix**: `loadStage()` itself now resets `matchingRound`/`matchingType` and populates
`roundVocabs` (`ordered.slice(0, ITEMS_PER_ROUND)`) whenever `mode === 'matching'`,
using the just-fetched local `ordered` array — **not** `prepareMatchingRound()` and
**not** the `stageWords` state, both of which would read the pre-update stale closure
value in the same tick `setStageWords(ordered)` was called. This makes every entry
path (direct selection, continue-next-stage, review) correctly initialize the round
board, not just the chain path. `finishFlashcardStage()`'s own manual reset is
untouched (it doesn't call `loadStage`, since it reuses the already-loaded Flashcard
stage's words) — the two now duplicate the same reset logic for their two different
call shapes, which is fine.

**Lesson**: when a "mode X" screen depends on per-mode UI state (like Matching's
round/type/roundVocabs) that isn't part of the generic stage payload, initializing
that state only in one specific transition path (the chain) rather than in the shared
loader function every path funnels through is a trap — the bug stays invisible until
someone exercises a different entry path into that same mode.

## Desktop font size (`app/globals.css`)

The whole UI (built mobile-first with Tailwind's rem-based `text-xs`/`text-sm`/etc.)
read too small on PC per explicit user feedback. Fixed with a single global lever
instead of touching every component's classes: `html { font-size: 18px }` inside
`@media (min-width: 1024px)` in `app/globals.css` (root is the browser default 16px
below that breakpoint). Since every Tailwind text utility here is `rem`-based, this
scales all of them proportionally (~12.5%) on desktop/laptop viewports while leaving
mobile/tablet untouched — no component-level changes needed. If further enlargement is
requested, adjust this one value rather than hunting through individual `text-*`
classes; if it turns out uneven (some fixed-`px` element now looks small next to
scaled-up text next to it), that's the tradeoff of a root-level fix and would need a
targeted per-component fix instead.

---

**Rule for future sessions:** when you finish a task in this repo, update this file
with anything a future agent would need to know that isn't obvious from the code —
new architectural decisions, gotchas you hit, non-obvious "why"s. Keep entries
concise; prune anything that's become stale or is now just derivable from reading the
code.
