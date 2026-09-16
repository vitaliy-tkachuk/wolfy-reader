# Testing domain

## Overview

Cross-format decoder testing: the differential harness that proves independent
decoders agree on the same book's prose, plus the decode-without-crash sweeps over
license-clean corpora. This domain owns the *comparison* strategy, not the per-format
tests (those live with their formats). Its reason to exist is stated in PLAN §4: two
editions of one Gutenberg title (EPUB, TXT) must extract to the same text — a cheap,
strong correctness signal, and the safety net any further decoder is built against.

Code:

- `test/support/differential.ts` — extraction, boilerplate stripping, normalization,
  and the window score (the reusable pieces).
- `test/differential.test.ts` — the suite: EPUB↔TXT differential, divergence
  detection, Standard Ebooks decode+prose, W3C epub-testsuite decode-without-crash.
- `test/corpus/` — gitignored; populated by `npm run fetch-corpus`
  (`scripts/fetch-corpus.mjs`).

## Key decisions

- **Compare by sampled windows, not exact equality** (2026-08-25). Two editions of a
  title genuinely differ in front matter, transcriber notes, and punctuation, so
  exact equality is either impossible or forces over-normalization that can no longer
  fail. Instead, contiguous word windows (25 words, 20 of them, sampled from the
  middle 80% to skip edition drift in the margins) from one edition must appear
  verbatim in the other. In practice the real Gutenberg pairs score **100%** both
  directions, far above the **0.85** threshold — the margin is the point: the bar is
  high enough that a corrupt/divergent decode fails, low enough that margin drift
  does not. Both directions are required so a decode that drops or mangles text fails
  from either side.
- **Content selection is separate from normalization.** `stripGutenbergBoilerplate`
  (cut the license header/footer between the `*** START/END OF … ***` markers) is
  content selection; `normalizeWords` (Unicode-fold, lowercase, drop soft hyphens,
  unify quotes, keep letter/digit/apostrophe runs) is normalization. Keeping them
  apart lets a third format reuse the normalizer untouched — the boilerplate concern
  is Gutenberg-specific, the normalizer is not.
- **Extraction is format-neutral.** `extractBookText(book)` strips markup from every
  section's bytes and works on any `Book`, because every decoder emits markup
  sections. There is no per-format extractor branch, so the harness never reshapes as
  formats are added. The format table in the suite (`FORMAT_BY_EXT`) is the only
  extensible seam: a further format is one row.

## Implementation notes

- **The divergence test is the guard against over-normalization.** It reverses one
  decode's word stream (same vocabulary, no shared contiguous window) and asserts the
  score drops below 0.2, then asserts a decode matches itself above threshold —
  proving the low score is the corruption, not a broken scorer. This is what keeps
  the normalizer honest: normalize so hard the reversed text still scored high and
  this test fails.
- **Graceful skip is load-bearing.** Every case skips when `test/corpus/` is absent
  (the gitignored-corpus idiom shared with `test/epub-corpus.test.ts`): `filesIn`
  returns `[]` on a missing directory, and the `skip` guards fire. CI caches the
  corpus; a fresh clone without it still runs green.
- **One-command flow:** `npm run fetch-corpus` → `npm test`. The fetch script ships 5
  Gutenberg EPUB+TXT pairs (the `>= 5 titles` acceptance), Standard Ebooks
  Frankenstein, and the W3C epub-tests subset.

## Gotchas

- **The epub-testsuite contract is "decode without an untyped crash".** Spec edge
  cases may legitimately fail to decode; the assertion is that a failure is a typed
  `BookError`, and a success exposes a `sections` array — never an untyped throw.
- **Do not raise the threshold toward the observed 100%.** The 15-point gap absorbs a
  future title whose editions drift more; pinning it to the current corpus would make
  the suite brittle against a legitimately messier pair.

## Patterns

- **Headless by rule.** The whole domain is `node:test`, no browser — differential
  decode is a pure byte→text comparison. Nothing here is user-facing, so `/demo`
  shows nothing new; the payload is the harness.
