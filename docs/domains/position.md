# Position domain

## Overview

`src/core/position.ts` owns reading positions: capturing a point in a section as a
`Position`, serializing it to and from an opaque versioned string a host persists,
and resolving a `Position` back against (possibly changed) section text. A
`Position` is content-addressed — backed by a Hypothesis-style `TextAnchor` (exact
quote + prefix/suffix context) so it survives reflow, font-size, and layout
changes. The public surface (`Position`, `TextAnchor`, `ResolvedPosition`,
`capturePosition`, `serializePosition`, `parsePosition`, `resolvePosition`,
`CapturePositionOptions`) re-exports through `src/core/index.ts` and is part of the
semver stability promise. Core stays headless: capture and resolution consume
caller-supplied plain text and UTF-16 offsets — no DOM, HTML, or Range.

## Key decisions

- **The anchor matches by content, not by offset.** `TextAnchor` carries `exact`,
  `prefix`, and `suffix` (bounded windows), plus an `offset`. The offset is a
  grapheme index into the section and is a **tiebreak only** — used to pick among
  duplicate quotes, never to locate a match on its own. This is deliberate: text
  content is stable across reflow while character positions are not.
- **The serialized form is version-first and host-opaque.** It is a single string
  `wr1:{…json…}` — a leading `wr1:` version prefix followed by a JSON payload whose
  first field is also `v`. Hosts store the string verbatim and never parse it. The
  redundant version signal (prefix + field) means an unknown future version is
  detectable before and after JSON parsing. The `progress` number rides on the
  `Position` object (and inside the payload as `p`) so host UI — scrollbars,
  "42%" — never has to decode the string. Field keys in the payload are short
  (`s`, `p`, `e`, `pre`, `suf`, `o`) to keep persisted strings compact; they are an
  internal encoding detail behind the opaque contract, not public names.
- **A malformed or unknown-version string throws `CorruptContainerError`.** Parsing
  a broken position is a structural failure the host catches by class, mirroring the
  decoder error convention. This is distinct from a *resolution* miss (matching an
  anchor against live content), which is returned as a value, never thrown.
- **Boundaries are snapped with `Intl.Segmenter`.** The requested offset is snapped
  to the start of the word it lands in (word granularity); every window edge is a
  grapheme-cluster boundary. An anchor therefore never splits a surrogate pair,
  combining sequence, emoji ZWJ cluster, or flag sequence.
- **A resolution miss is a value, not an error.** `resolvePosition` returns
  `undefined` when the quote is gone from the target text — it never throws and
  never logs. This does not contradict the typed-`BookError` convention: a miss is
  an *expected outcome* (the content genuinely changed), so the caller degrades
  softly (skip the restore, drop the decoration), exactly as `Section.resolve()`
  returns `undefined`. Only a structural fault — a malformed or unknown-version
  serialized string in `parsePosition` — is a thrown `BookError`.

## Implementation notes

- `capturePosition(text, offset, sectionId, options?)`:
  1. Segments `text` into grapheme clusters once (each cluster keeps its UTF-16
     index).
  2. Maps the UTF-16 `offset` to the grapheme index at or after it, then snaps that
     to the start of its word segment.
  3. Slices the quote (`quoteLength` graphemes, default 32) and the prefix/suffix
     context windows (`contextLength` each, default 32) on grapheme boundaries.
  4. Computes `progress = start / totalGraphemes` (0 for empty text).
- `Intl.Segmenter` instances are cached per locale (grapheme segmentation is
  locale-independent, so it uses one shared instance).
- **Batch-capture invariant: segment once per text, never per sentence or per
  occurrence** (2026-08-26). Segmentation over a section is O(text), not
  O(text × sentences). `segmentSentences` builds one internal `SegmentedText`
  (the grapheme array plus a lazily-built sorted word-start array) and every
  per-sentence capture reuses it; `resolvePosition` segments the anchor
  prefix/suffix once, outside the occurrence-scoring loop; code-unit↔grapheme
  conversions are binary searches over the sorted grapheme-boundary array —
  never a linear re-segmentation per lookup. The shared boundary helper lives in
  `src/core/graphemes.ts` (internal — not re-exported from `src/core/index.ts`,
  so not public surface) and also backs the paginator's grapheme→code-unit
  mapping in `src/layout`. The batch path is byte-identical to per-call capture
  by contract; `test/position-segmentation-perf.test.ts` guards both the
  identity (batch vs single serialization) and the cost (a metered
  `Intl.Segmenter` work budget that the quadratic path exceeds ~300×). Any new
  per-sentence/per-occurrence code must take the precomputed arrays, not
  re-segment. (Broader segmenter-cache consolidation across modules is T007's,
  not settled here.)
- `serializePosition` / `parsePosition` are exact inverses. `parsePosition`
  validates the prefix, JSON validity, required-field presence and types, and the
  version, in that order, throwing `CorruptContainerError` on any failure.
- `resolvePosition(position, text)` matches by content and returns a
  `ResolvedPosition` (`sectionId`, grapheme `offset`, grapheme `length`) or
  `undefined`. Everything works in grapheme space, so a `ResolvedPosition.offset`
  is directly comparable to a `TextAnchor.offset`. The **disambiguation ladder**:
  1. Find every occurrence of the exact quote (grapheme-cluster comparison, so a
     cluster inside the quote is matched whole).
  2. Score each occurrence by how many stored prefix graphemes still precede it plus
     how many stored suffix graphemes still follow it (contiguous from the quote
     outward). Highest score wins — this is the content match.
  3. On a score tie, pick the occurrence whose start is nearest the stored offset.
     The offset is consulted **only** at this final rung; it never overrides a
     better content match.
  A quote with no occurrences returns `undefined`. An empty-quote anchor (captured
  at end-of-text or in empty text) resolves to a zero-length location at the stored
  offset, clamped to the target length.

## Gotchas

- `TextAnchor.offset` is a **grapheme index**, not a UTF-16 code-unit index. A
  4-code-unit emoji counts as one. `capturePosition` takes a code-unit offset (what
  a caller gets from DOM/string APIs) and converts; the stored offset is graphemes.
- The stored offset is a tiebreak, not a locator — a resolver must not trust it
  alone. When content shifts, the quote and context still identify the spot; the
  offset only disambiguates identical quotes.
- `exactOptionalPropertyTypes` is on: `CapturePositionOptions` fields are read with
  `??` defaults, never assigned an explicit `undefined`.
- `parsePosition` throwing (not returning `undefined`) is intentional and is the one
  place in the position domain that raises: a corrupt/foreign string is a structural
  fault, whereas a live-content match failure is a value-level miss.
- **Sentence segmentation is a headless enabler built on capture.** `segmentSentences(text, sectionId, options?)` splits section text with `Intl.Segmenter` (sentence granularity) and returns `SentenceRange[]` (`{ text, position }`), capturing each sentence's `Position` with `quoteLength` set to the sentence's grapheme count — so the anchored quote is the *whole* sentence and `resolvePosition` returns its full span, which is what lets `decorate` highlight the entire sentence rather than just its start. Whitespace-only segments are dropped. **Merge past Intl's newline over-split.** Section text is `textContent`, which keeps the source's newlines (the page hides them via `white-space:normal`); UAX #29 ends a "sentence" at every hard line break, so raw Intl segmentation fragmented one visual sentence at each wrapped source line — a short line became a two-word "sentence." So adjacent Intl segments are accumulated until the run ends on sentence-terminal punctuation (`. ! ? …` + trailing closers); the anchor spans the raw newline-bearing run (to still content-match the frame text) while `SentenceRange.text` collapses whitespace to single spaces. Abbreviations still split (a period genuinely ends sentences); a punctuation-less line merges forward. It is the TTS enabler (out of scope to *speak*, in scope to *enable*): the library exposes ranges, a host reads them. Pure core, no DOM — same headless contract as `capturePosition`. The reader surfaces it as `reader.sentences()` over the current section (see [`view.md`](view.md)); the additive-surface decision is in [`../architecture.md`](../architecture.md).
- **The appearance invariant is the payoff of this resolver.** `setAppearance`/
  `setMode` capture a `Position` for the page start, re-lay out, and resolve it back —
  content-addressed, so the reading place survives a reflow that moves every page
  number. The tolerance is stated over the paragraph at the *top* of the page (the
  restore anchors on the page-start offset), tested as a parameterized invariant in
  `test/browser/appearance.browser.mjs`; the cross-cutting decision lives in
  [`docs/architecture.md`](../architecture.md) and the mechanism in
  [`appearance`](appearance.md). A same-text resolution miss degrades soft to page 0,
  exactly the soft-miss contract this domain guarantees.
