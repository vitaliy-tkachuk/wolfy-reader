# Position domain

## Overview

`src/core/position.ts` owns reading positions: capturing a point in a section as a
`Position`, and serializing it to and from an opaque, versioned string a host
persists. A `Position` is content-addressed — backed by a Hypothesis-style
`TextAnchor` (exact quote + prefix/suffix context) so it survives reflow,
font-size, and layout changes. The public surface (`Position`, `TextAnchor`,
`capturePosition`, `serializePosition`, `parsePosition`, `CapturePositionOptions`)
re-exports through `src/core/index.ts` and is part of the semver stability
promise. Core stays headless: capture consumes caller-supplied plain text and a
UTF-16 offset — no DOM, HTML, or Range.

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
- `serializePosition` / `parsePosition` are exact inverses. `parsePosition`
  validates the prefix, JSON validity, required-field presence and types, and the
  version, in that order, throwing `CorruptContainerError` on any failure.

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
