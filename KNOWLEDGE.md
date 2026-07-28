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

## Cross-topic "Ôn Tập Nhóm Chủ Đề" (group review) on `/vocabulary-by-topic`

Per explicit user request: a toggle ("Chọn Nhóm Chủ Đề") on the topic-select grid that,
when on, renders a checkbox on every topic card instead of opening the per-topic
mode-select modal on click. Checking 1+ topics reveals a "Bắt Đầu Ôn Tập" button that
opens a mode-select modal (Flashcard/Nối Từ/Điền Từ, same 3 choices as the per-topic
flow) → a size chooser (same `STAGE_SIZE_PRESETS`/custom-input UI as the per-topic
chooser) → the exercise itself, drawing a random shuffle of words pooled across every
selected topic.

- **The pool is always words already learned via Flashcard** (`learnedFlashcard`,
  summed across the selected topics), regardless of which of the 3 modes is picked to
  review them in — this was an explicit requirement, not a default I chose. There's no
  per-topic gating chain to preserve once topics are mixed (matching/fill_in normally
  draw from their own parent mode's learned pool; group mode doesn't, it always reads
  each selected topic's `flashcard` progress row directly via `fetchProgressRow`).
- **Implemented as a variant of the existing single-topic `reviewMode`, not a new
  parallel state machine.** `startGroupReview(size)` collects `getLearnedIds()` from
  every selected topic's `flashcard` progress row, shuffles+slices them, fetches those
  `topic_vocabulary` rows (word ids are unique across topics/levels, so `.in('id', ...)`
  works with no per-topic disambiguation needed), and sets the exact same
  `reviewMode=true, chainMode=false` combination the per-topic "Ôn Tập Từ Đã Học" path
  already uses — meaning `finishFlashcardStage`/`handleMatchingRoundComplete`/
  `handleFillInComplete`'s existing `if (reviewMode) { ...; return }` early-outs (skip
  `persistProgressAdvance`, skip chaining) needed **zero changes** to cover the group
  case too. `activeTopicKey` is set to a sentinel string (`'__group__'`) purely to keep
  those functions' `if (!activeTopicKey) return` guards satisfied — it's never looked
  up against `topicInfos`, since a new `groupSessionActive` boolean gates every place
  that would otherwise render `activeTopicInfo?.icon`/`.label` (the 3 exercise-step
  headers + the completion screen's title/message/"Ôn Tập Lại" handler), showing
  `🗂️ Ôn Tập N Chủ Đề` instead.
- **`selectedGroupTopics`/`groupPickMode` are reset on level change** (in
  `handleSelectLevel`) — `topic_key` strings repeat across levels (e.g. "home-living"
  exists at both A1 and A2 as separate `topic_vocabulary` rows), and `startGroupReview`
  looks up each selected key's `flashcard` progress via `fetchProgressRow(..., level,
  ...)` against whatever `level` is currently selected — so a stale cross-level
  selection would have silently reviewed the wrong level's progress.
- Verified end-to-end with Playwright against the live dev server (fresh signup, drove
  Flashcard on 2 topics to seed a learned pool, then the full group toggle → checkbox
  select → mode modal → size chooser → session → completion-screen flow) — the size
  chooser correctly totaled `3+2=5` across the two topics, the Matching session's board
  showed a real shuffle of words from both topics, and the completion screen's
  "Ôn Tập Lại"/"Quay Lại Chọn Chủ Đề" both rendered correctly. Console-only 406s seen
  during that run are a pre-existing, unrelated cold-start artifact (`vocabulary_sets`/
  `profiles` `.maybeSingle()` queries 406ing for a user with zero rows yet on
  `/dashboard`) — reproduced identically on a bare register+dashboard visit with no
  group-review interaction at all, so not something this feature introduced.

## "Tổng Hợp Từ Điển" full-dictionary page (`/full-dictionary`, `full_dictionary_words`,
## `full_dictionary_progress`)

New page linked from the sidebar directly below "Học Theo Chủ Đề". Per level (A1/A2/B1/
B2), it combines Flashcard/Nối Từ/Điền Từ study (row 1) with the entire level's
dictionary — hanzi/pinyin/nghĩa + full example sentences — browsable as a searchable
table underneath (row 2), so a student can drill words *and* look any of them up in
full reference form without leaving the page.

- **Word list, pinyin, and examples are 100% scraped from monchinese.me/dictionary?
  level=X per explicit user request** — this is a hard requirement the user restated
  after an initial version of this page shipped using this app's own `dictionary_words`
  as the source; that version was reworked to match. The two dictionaries can and do
  disagree on content, so this page never falls back to `dictionary_words`.
- **The plain `/dictionary?level=X` listing page cannot be crawled directly** — it
  hard-caps at exactly 120 results ("120 kết quả") regardless of any pagination-shaped
  query param tried (`page`, `limit`, `offset`, `size` are all silently ignored; page 2
  returns the *same* 120 hrefs as page 1). Confirmed A1/A2/B1/B2 all hit this same cap.
  **The workaround: that same endpoint also accepts `&q=<term>`, which performs a real
  filtered search** (combined with `level=`) that returns genuine, much-smaller result
  counts — e.g. `level=B2&q=hao` returns exactly 46 real results, not capped. Single-
  Latin-letter `q` values behave unpredictably (some real letters return 0 results even
  though matches exist — likely a bug on their end, not something to rely on), but real
  2+ character pinyin syllables work reliably. **The crawl enumerates all ~403 standard
  toneless Mandarin syllables** (derived from `pinyin-pro` over the entire CJK Unified
  Ideographs block, see `buildSyllableList()`) as successive `q=` values per level and
  unions the results (dedup by the word's `/dictionary/<hanzi>` href) — since every
  Chinese word's pinyin necessarily contains at least one full syllable from that set,
  this is a complete crawl, not a sample. The script logs a warning for any single
  query that returns ≥115 results (a sign it might itself be truncated, needing further
  subdivision) — zero such warnings fired across all 4 levels this session, giving
  good confidence the crawl is complete. Final counts: A1=341, A2=475, B1=1177,
  B2=2251 (4244 total, 4100 unique hrefs — 144 words are cross-tagged into more than
  one level by monchinese).
- **`scripts/scrape-full-dictionary.js`** is the crawler, in 3 modes: `list` (the
  syllable-enumeration crawl above, writes `scripts/output/full-dictionary-words.json`),
  `examples` (fetches `/dictionary/<hanzi>` for every unique word found — a direct
  per-word lookup is NOT subject to the listing cap — parses the same "Ví dụ" section
  `scripts/scrape-monchinese-words.js` already parses for `topic_vocabulary`, and
  generates example pinyin via `pinyin-pro` + the same `POLYPHONE_FIXES` map (們/麼/車/
  還/乾) documented elsewhere in this file — a third independent copy of that
  workaround), and `sql` (merges both into `scripts/output/full-dictionary-seed.sql`,
  `ON CONFLICT (level, hanzi, pinyin) DO UPDATE`, safe to re-run). Got a real example
  for 4100/4100 unique words this run (100% coverage) — re-run `list` → `examples` →
  `sql` → `npx prisma db execute --file scripts/output/full-dictionary-seed.sql` if
  monchinese's content changes and this page ever needs a refresh.
- **`full_dictionary_words` (migration 0016) is a dedicated table, deliberately NOT
  mixed into `dictionary_words`** — same reasoning as `topic_vocabulary`'s own
  separation (see its comment above): this page's content must track monchinese
  exactly and must never risk `dictionary_progress`/exercise-record data tied to
  `dictionary_words` IDs. Read-only RLS policy for authenticated users, same shape as
  `topic_vocabulary`'s.
- **`full_dictionary_progress` (migration 0015) is a separate table from both
  `dictionary_progress`** (used by `/review-dictionary`, keyed off `dictionary_words`)
  **and `topic_vocabulary_progress`** (used by `/vocabulary-by-topic`, keyed off
  `topic_vocabulary`) — this page's Nối Từ is an independently-drillable mode with its
  own persisted progress, whereas `/review-dictionary`'s Flashcard only *auto-chains*
  into matching without ever persisting a standalone matching-progress row, so reusing
  `dictionary_progress` for a third mode would have needed different `current_index`
  semantics on the same row and could have desynced that page's own progress. Keyed by
  `(user_id, level, mode)` with the same 3-mode gating chain `topic_vocabulary_progress`
  already established (flashcard pool = whole level in `full_dictionary_words`;
  matching pool = learned-in-flashcard; fill_in pool = learned-in-matching), just
  without a `topic_key` column since this page has no topic axis. `word_order` entries
  are `full_dictionary_words.id` values, not `dictionary_words.id`.
- **Page architecture is `/vocabulary-by-topic`'s state machine with the topic axis
  removed**, not built from scratch: mode-select-with-review-submodal
  (`learnStyleMode`), chain-mode Flashcard→Matching→Điền Từ (`chainMode`/
  `currentStageMode`/`ChainStepTracker`), the stage-size chooser, and the completion
  screen are all the same pattern as vocabulary-by-topic minus `topicKey`/group-review
  (cross-topic review doesn't have an analogue here — there's no second grouping axis
  once "level" is already the only selector). One structural difference: instead of
  vocabulary-by-topic's modal-based mode-select (topic click → modal → mode buttons),
  here the level detail view *is* the per-level screen, so the 3 mode buttons render
  directly as Row 1 of that view (no extra click-through modal needed) — clicking one
  either opens the New-vs-Review sub-modal (if that mode already has learned words) or
  goes straight to the stage-size chooser, exactly mirroring vocabulary-by-topic's
  `learnStyleTopicKey` sub-modal logic with `topicKey` dropped.
- **Row 2 (the full word table) reuses `/dictionary/page.tsx`'s table markup/columns**
  (Hán Tự/Pinyin/Nghĩa/Ví Dụ, `speak()` buttons, `fetchAllRows` pagination pattern,
  `stripTones` search) but queries `full_dictionary_words` instead of `dictionary_words`
  and is scoped to the single already-selected level (no level tabs — level is fixed by
  having navigated into that level's detail view), with its own local search/pagination
  state, since this page needed the browsing UX embedded alongside the exercise row
  rather than as a standalone destination.
- **Unrelated side effect of this session's B2 scraping work**: while backfilling this
  app's own `dictionary_words` B2 examples (a separate, smaller task done first — see
  `scripts/backfill-b2-examples.js`, keyed by this app's own B2 word list, not
  monchinese's), B2 example coverage in `dictionary_words` went from 499/2471 to
  2418/2471, which also directly improves `/dictionary` and `/review-dictionary`'s
  Flashcard example display for B2 — those pages were otherwise untouched this session.

## Điền Từ (fill_in) no longer gated behind Nối Từ (matching) on `/vocabulary-by-topic`
## and `/full-dictionary`

Per explicit user request: finishing Flashcard alone should be enough to unlock
Điền Từ — a student shouldn't have to also finish Nối Từ first. Both pages previously
implemented a strict 3-step gating chain (flashcard → matching → fill_in, each mode's
pool = the previous mode's learned count); `/review-dictionary` never had this problem
since it only ever had 2 modes (flashcard/fill_in, matching is just an internal
sub-step of its Flashcard flow, not a separate gate) — its `learnedFillIn` was already
capped against `learnedFlashcard` directly (see the "Điền Từ word pool is restricted
to learned flashcard words" note above), so it needed no change.

**Fix, mirrored identically in both `vocabulary-by-topic/page.tsx` and
`full-dictionary/page.tsx`** (2 independent copies of the same state machine, per this
codebase's established pattern of not sharing this particular logic — see the
Topic-based vocabulary learning note above): Matching and Fill-in now both draw
independently from words already learned in **Flashcard**, instead of Fill-in drawing
from Matching's learned count.

- `modePoolTotal()`: `fill_in`'s branch now returns `info.learnedFlashcard` (previously
  `info.learnedMatching`) — same value `matching`'s branch already returned, so both
  non-flashcard modes now share one pool source.
- The `learnedFillIn` cap in the level/topic-list loader (`Math.min(...,
  learnedMatching)` → `Math.min(..., learnedFlashcard)`) — otherwise a `fill_in`
  progress row with `current_index` legitimately ahead of `learnedMatching` (now
  possible) would get silently clamped back down.
- Every `parentMode: StudyMode = mode === 'matching' ? 'flashcard' : 'matching'`
  ternary (in `startTopic`/`continueNextStage`/`restartMode`, 3 call sites per page) —
  this pattern assumed fill_in's parent was always matching; replaced with an
  unconditional `fetchProgressRow(..., 'flashcard')` in the non-flashcard branch, since
  now *both* matching and fill_in share the same parent.
- `restartMode`'s progress-reset map: restarting **Matching** no longer zeroes
  `learnedFillIn` (`{ ...t, learnedMatching: 0, learnedFillIn: 0 }` →
  `{ ...t, learnedMatching: 0 }`) — Fill-in's progress is no longer downstream of
  Matching's, so wiping Matching must not touch it. Restarting **Flashcard** still
  zeroes both (correct — everything downstream of Flashcard resets).
- Topic/level-card progress-ring math and tooltips: `pctFillIn`/the Điền Từ ring's
  denominator changed from `learnedMatching` to `learnedFlashcard` (e.g.
  `t.learnedMatching ? (t.learnedFillIn / t.learnedMatching) * 100 : 0` →
  `t.learnedFlashcard ? (t.learnedFillIn / t.learnedFlashcard) * 100 : 0`), and the
  "nothing to review" empty-pool warning text for `fill_in` was reworded from
  "Bạn chưa Nối Từ từ nào..." to "Bạn chưa học từ nào bằng Flashcard...".
- **The Flashcard→Matching→Điền Từ chain-mode pipeline itself is unaffected** — a
  chained session still visits Matching before Điền Từ for the same stage batch (that
  flow doesn't consult `modePoolTotal`/the gating chain at all; it just reuses the
  already-loaded `stageWords` across steps). This fix only affects **direct** entry
  into Điền Từ (via the mode-select modal or the New-vs-Review sub-modal) — that path
  now pulls straight from Flashcard's learned pool instead of requiring a matching
  pass first.

## "Biết / Không Biết" flashcard tracking (`/review-dictionary` + `/full-dictionary`)

Per explicit user request, Flashcard mode on both pages now ends every card in an
explicit **Biết** (green) / **Không Biết** (red) choice instead of a plain "Tiếp
theo"/"Chuyển Sang..." button — replacing the last-card action, not adding to it.
Both buttons still advance `flashIdx`/`current_index` (a word is only *shown* once
per learning cycle regardless of the answer); the difference is purely which pool a
word ends up in afterward.

- **New columns on `dictionary_progress`/`full_dictionary_progress`** (migrations
  `0017`/`0018`, only meaningful on the `mode='flashcard'` row): `unknown_word_ids
  UUID[]` (words currently flagged "không biết", not yet re-answered "biết") and
  `unknown_resolved_count INTEGER` (lifetime count of words that were once unknown
  and got resolved back to "biết" since the last full level reset — paired with
  `unknown_word_ids.length` for an "X/Y đã ôn lại" progress stat shown on level
  cards). `current_index`/`learnedFlashcard` semantics are otherwise unchanged.
- **"Known" pool, not "learned" pool, feeds Điền Từ/Nối Từ.** A word counted in
  `current_index` (reviewed) but still in `unknown_word_ids` must NOT appear in
  Điền Từ or Nối Từ. This is a read-time filter, not a stored array: both pages have
  a `getKnownIds(progress)` helper = `word_order.slice(0, current_index)` minus
  whatever's in that row's `unknown_word_ids`, used everywhere a "learned ids" pool
  used to be read directly (`startLevel`/`startLevelMode`'s fill_in/matching
  branches, `continueNextStage`, `restartLevel`/`restartMode`,
  `handleRestartFillInDirectly`). `LevelInfo` gained a derived `knownFlashcard =
  learnedFlashcard - unknownCount` field that all "remaining to learn" math for
  Điền Từ/Nối Từ now uses instead of raw `learnedFlashcard` (on `/full-dictionary`,
  `modePoolTotal()`'s matching/fill_in branches changed from `info.learnedFlashcard`
  → `info.knownFlashcard` — this is the literal "Nối Từ/Điền Từ chỉ hiện từ đã
  biết" requirement).
- **Two refs, not state, hold the live unknown set during a session**
  (`unknownIdsRef`/`unknownResolvedRef`) — populated whenever a flashcard stage
  loads (every `startLevel(Mode)`/`continueNextStage` code path that touches
  `mode='flashcard'`), mutated + persisted **immediately** on every tap via a
  `persistUnknownState(newIds, newResolved)` helper (one `update` per tap, not
  batched with the stage-end `persistProgressAdvance`) — each Biết/Không Biết is a
  discrete, user-visible save, unlike the once-per-stage progress advance. Marking
  **Biết** on a word already in the unknown set removes it + bumps the resolved
  counter; marking **Không Biết** only adds to the set in the *normal* (non-review)
  flow — during an unknown-review session it's a no-op (the word's already there).
- **"Học Từ Không Biết" is a 3rd option alongside the existing mode choices**
  (`/review-dictionary`'s mode-select modal; `/full-dictionary`'s per-mode
  `learnStyleMode` New-vs-Review sub-modal, but only rendered when
  `learnStyleMode==='flashcard'`), disabled when `unknownCount===0`. Drilling it is
  a **dead-end reshuffle draw from `unknown_word_ids` directly** — the same "review
  already learned pool, no progress writes" shape already established for
  `/full-dictionary`'s/`vocabulary-by-topic`'s "Ôn Tập Từ Đã Học" review flows (see
  above), not a new state machine:
  - On `/review-dictionary` (which has no pre-existing reviewMode concept): a new
    `unknownReviewMode` boolean plus dedicated `startUnknownReview()`/
    `loadUnknownStage()` functions that bypass `word_order`/`current_index`
    pagination entirely and load a shuffled slice of `unknown_word_ids` straight
    into `stageWords`. Finishing skips the flashcard→matching chain and
    `persistProgressAdvance` (goes straight to a `complete` step variant), since
    these words already have their `current_index` position — only their
    known/unknown status is changing.
  - On `/full-dictionary` (which already has a `reviewMode` boolean with exactly
    this skip-persist/skip-chain behavior baked into
    `finishFlashcardStage`/`handleMatchingRoundComplete`/`handleFillInComplete`):
    starting unknown-review sets **both** `reviewMode(true)` and a new
    `unknownReviewMode(true)`, with `chainMode` staying `false` — so none of those
    three completion handlers needed any code changes. `startLevelMode` gained an
    `isUnknownReview` flag that, inside its existing `isReview` branch, swaps the
    pool source from `getLearnedIds(progress)` to `progress.unknown_word_ids`;
    everything else (shuffle, `loadStage(lvl, mode, shuffled, 0, ids.length,
    size)`) is identical to the pre-existing review path.
- **Full level reset (`restartLevel`/`restartMode('flashcard')`) also clears
  `unknown_word_ids: []`/`unknown_resolved_count: 0`** on the flashcard row — per
  explicit requirement, a word only stops reappearing in "Học Từ Không Biết"
  permanently once marked biết again, or until the *whole level* is reset from
  scratch (never by itself expiring).
- Buttons use the existing `.cartoon-btn-danger`/`.cartoon-btn-success` utility
  classes (`app/globals.css`) rather than raw Tailwind `bg-red-500`/etc, since a
  bare Tailwind background utility and `.cartoon-btn`'s own `background: var(...)`
  rule have equal specificity and the winner depends on stylesheet source order —
  the dedicated variant classes avoid that risk entirely and match the app's
  existing button design system.

## "Từ Điển TOCFL" page (`/tocfl-dictionary`, `tocfl8000_words`, `tocfl8000_progress`)

New page linked from the sidebar as "Từ Điển TOCFL", directly below "Tổng Hợp Chủ Đề"
(`/full-dictionary`). Same Flashcard/Nối Từ/Điền Từ + browsable-table architecture as
`/full-dictionary`, restricted to A1/A2/B1 per explicit user request (the levels the
user is actually studying for TOCFL).

- **Word list source is `華語八千詞表20240923.xlsx`** (the official TOCFL 8000-word
  list, 20240923 revision, user-supplied, gitignored — same handling as `OTAB19.xlsx`
  although note `OTAB19.xlsx` itself ended up tracked in git; this file was left
  untracked pending an explicit user decision to commit it). The xlsx uses the
  *revised* TOCFL banding (準備級 Novice 1/2 pre-A1, 入門級/基礎級/進階級/高階級/流利級
  Level 1-5) rather than the older A1/A2/B1/B2/C1/C2 labels — mapped as
  入門級(Level 1)→A1, 基礎級(Level 2)→A2, 進階級(Level 3)→B1. 準備級一級/二級 (pre-A1)
  and 高階級/流利級 (B2+) sheets are intentionally skipped. 2005 words total
  (A1=347, A2=485, B1=1173).
- **Pipeline**: `scripts/extract-tocfl8000.js` (xlsx → `scripts/output/
  tocfl8000-raw.json`, also normalizes the source's mixed breve/caron tone-3 marks —
  ă/ĭ/ŏ/ŭ → ǎ/ǐ/ǒ/ǔ — to standard Hanyu Pinyin; the source's own per-word pinyin is
  trusted as-is otherwise, since it's already correctly context-disambiguated for
  polyphones like 還/車/麼 rather than needing pinyin-pro regeneration) →
  `scripts/match-tocfl8000-translations.js` (cross-matches each word's hanzi — trying
  the raw string, each `/`-separated variant, that variant with any zhuyin-annotation
  paren *stripped* e.g. `部分(˙ㄈㄣ)`→`部分`, and that variant with paren markers
  *removed but content kept* e.g. `籃(子)`→`籃子` — against this app's own
  `dictionary_words` and `full_dictionary_words` tables, dictionary_words taking
  priority when both match) → `scripts/patch-tocfl8000-manual.js` (hand-translates
  whatever's left) → `scripts/build-tocfl8000-seed.js` (→ `scripts/output/
  tocfl8000-seed.sql`, `ON CONFLICT (level, hanzi, pinyin) DO UPDATE`, safe to re-run).
  Local cross-matching reused 99.7% of translations (1999/2005) from words this app
  already has vetted Vietnamese for; only 6 words (司機, 家具, 馬路, 秘密/祕密, 脖(子),
  日期) needed fresh hand translation, plus a tone-typo fix on 2 more (叔叔 corrected
  shú→shū, 日期's 期 corrected qí→qī) — both confirmed against standard Hanyu Pinyin,
  not just carried over from the source. Re-run the full pipeline (in the order above,
  ending with `npx prisma db execute --file scripts/output/tocfl8000-seed.sql`) only
  if the source xlsx changes; the two local dictionaries it cross-matches against
  don't need to be re-run in lockstep since matching is a one-time import step, not a
  live join.
- **`tocfl8000_words`/`tocfl8000_progress` (migrations 0019/0020) are deliberately
  separate tables**, not rows merged into `dictionary_words`/`full_dictionary_words`
  — same reasoning as `topic_vocabulary`/`full_dictionary_words`: this page's word
  list must track the official 8000-word source exactly and must never risk another
  page's progress rows pointing at IDs that could shift. Unlike `full_dictionary_
  progress` (which got its `unknown_word_ids`/`unknown_resolved_count` columns via a
  later follow-up migration, 0018), `tocfl8000_progress` bakes the "Biết/Không Biết"
  tracking in from its first migration, since that feature already existed on
  `/full-dictionary` by the time this page was built and there was no reason to ship
  it in two steps.
- **Page implementation (`app/(dashboard)/tocfl-dictionary/page.tsx`) is `/full-
  dictionary/page.tsx` copied verbatim and renamed** (`full_dictionary_words` →
  `tocfl8000_words`, `full_dictionary_progress` → `tocfl8000_progress`,
  `FullDictionaryPage` → `TocflDictionaryPage`) — same 3-mode gating chain (Flashcard
  pool = whole level, Matching/Fill-in pools both = known-in-Flashcard independently,
  per the earlier "no longer gated behind Matching" fix), same chain-mode Flashcard→
  Matching→Điền Từ pipeline, same review/unknown-review sub-flows, same paginated
  browse table with search. `LEVEL_ORDER`/`sortLevels()` (`lib/utils/
  dictionaryLevels.ts`) needed no changes — it already tolerates a level subset (no
  B2/C1/C2 rows here) since it filters `LEVEL_ORDER` down to whatever levels are
  actually present.
- **Not merged into `public/tocfl-index.json`** (the shared pinyin-suggestion index
  `FillInExercise`'s composer reads from) — same as `full_dictionary_words`/
  `topic_vocabulary` before it, which also never got their own dump-into-index step;
  the existing CC-CEDICT + PSeitz-TOCFL-list merge already covers standard TOCFL
  vocabulary well. Only `dictionary_words` (this app's own user-facing dictionary) is
  dumped into that index, via `scripts/dump-own-dictionary.js`.
- Verified end-to-end with Playwright against the live dev server (fresh signup →
  `/tocfl-dictionary` level cards showing correct real counts 347/485/1173 → A1 detail
  view's browse table rendering real hanzi/pinyin/nghĩa/ví dụ → started a Flashcard
  stage, answered through it, confirmed the Flashcard→Matching chain transition
  rendered a real (non-empty) round board — the exact failure mode documented above
  under "Bug: entering Matching any way other than the Flashcard chain rendered an
  empty board" would have shown up here if the copy-paste had missed anything, it
  didn't since the whole `loadStage` fix came along with the file copy). Console-only
  `getUser()` "Failed to fetch" + 406 errors seen during registration/dashboard load
  are the same pre-existing cold-start artifacts noted elsewhere in this file, not
  something this page introduced.

---

**Rule for future sessions:** when you finish a task in this repo, update this file
with anything a future agent would need to know that isn't obvious from the code —
new architectural decisions, gotchas you hit, non-obvious "why"s. Keep entries
concise; prune anything that's become stale or is now just derivable from reading the
code.
