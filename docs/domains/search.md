# Search domain

## Overview

`src/search` is full-text search over a book: a headless matcher that scans decoded
section text and yields jumpable hits. Its public surface is the `reader.search`
facade method (see [`view.md`](view.md)); the engine underneath is three modules:

- `extract.ts` — decode a section's bytes (BOM-aware) and strip its markup to the
  canonical reading text (see the key decision below), plus entity decoding.
- `normalize.ts` — the folding policy that decides when two strings match, with an
  offset map back to raw text.
- `matcher.ts` — normalized literal substring search over one section (`matchText`),
  and the lazy whole-book scan (`searchBook`).

**It is headless by rule and DOM-free.** It imports only `src/core`
(`capturePosition`, `Position`, `Book`, `Section`, and the internal
`reading-text.ts` policy) and platform primitives (`Intl.Segmenter`,
`TextDecoder`) — never `document`/`window`, never `src/view` or `src/layout` — so
the whole matcher runs under `node:test`. That is why search quality is asserted
headlessly on decoded text; only jump-to-hit landing needs a browser.

## Key decisions

### Normalization policy

Query and section text are folded the same way before matching:

- **Case-insensitive** (`toLowerCase`). The overwhelmingly expected default for
  reader search — nobody types the book's capitalization.
- **Unicode NFC.** Each grapheme is canonically composed, so a pre-composed `é`
  matches a decomposed `e`+combining-acute. EPUB text arrives in either form.
- **Diacritics preserved.** `café` does not match `cafe`. Stripping marks is
  locale-sensitive (German ä vs a, Turkish dotless ı) and is a wrong default for
  many languages; it belongs in a later, opt-in dimension, not baked in.
- **Smart punctuation folded to ASCII.** Curly quotes → straight, en/em dash and the
  minus sign → hyphen-minus, Unicode spaces → a normal space. A reader types
  `don't`; the book prints `don’t`. Without this fold the most common apostrophe/dash
  queries silently fail.
- **Whitespace collapsed.** Every run of whitespace — including the newlines and
  indentation that sit between block tags in the source markup — folds to a single
  space, and leading/trailing space folds off. A query never fails on invisible
  layout whitespace or on a line break inside a matched phrase.

Matching is **literal (normalized) substring** only — no ranking, fuzzy/stemmed
matching, or regex. Those are deliberately out of scope for the current engine.

### Do not route the whole-book scan through the frame

`Paginator.sectionText()` returns the frame-measured, chunk-concatenated text for the
**currently paginated** section only and needs a browser. Search must scan *every*
section without painting it, so the matcher decodes `Section.load()` bytes and strips
markup itself. This is the load-bearing architectural boundary: the scan is
independent of what is on screen, and driving it does not disturb the reader's
position or require the paginator at all.

### One canonical reading text, shared by capture and resolution (2026-08-26)

A hit's `Position` is captured over extracted text but resolves against the frame's
`sectionText()` — the `textContent` of the **sanitized, resource-applied, chunked**
body. Those are not the same as the raw source: sanitization discards elements with
their children, the resource layer substitutes `alt` text for an `<img>` it cannot
serve (Gutenberg drop caps), and the chunker drops whitespace-only top-level text
nodes. An anchor captured over raw source whose quote/context spanned any of those
regions used to hard-miss silently. So there is now **one canonical reading-text
definition** and both sides speak it:

- The shared policy lives in `src/core/reading-text.ts` (core-internal, not public
  surface — the `graphemes.ts` pattern): the discarded-element tables (re-exported
  by `src/view/allowlist.ts` as `HTML_DISCARDED`/`SVG_DISCARDED`), reference
  classification/normalization (re-exported by `src/view/reference.ts`), the
  servable-media-type predicate, and `imageReadingText` — the headless mirror of
  `applyResources`' img branch. Search imports it from `src/core`, so the headless
  boundary holds; view imports the same tables, so the definition cannot fork.
- The extractor mirrors the pipeline: inline markup contributes zero characters
  (`wo<em>rd</em>` is `word`), unwrapped elements keep their text, discarded
  elements contribute nothing, an `<img>` contributes `''` when servable and its
  `alt` when the frame will substitute it (which is why `searchBook` passes
  `section.resolve` into `extractSectionText`), and whitespace-only top-level text
  runs are dropped exactly as `chunkElement` drops those nodes. It applies HTML's
  implied `</p>`/`</li>`/`</dt|dd>` so real books' unclosed paragraphs do not defeat
  the top-level rule.
- Consequence worth knowing: the frame's text has **no separator between block
  elements** (their inter-tag whitespace nodes are top-level and dropped), so
  extraction has none either. A query spanning a paragraph boundary matches only
  as the frame concatenates it; that is fidelity, not a bug.

Known edges that remain, all degrading to the ordinary soft miss (a value, never an
error): a resource that resolves servable but whose bytes fail to *load* (the frame
substitutes alt, the mirror cannot see the failure); a surviving body `<style>`'s
CSS text (present in frame text, deliberately never extracted — CSS is source, not
prose, and resolution is content-addressed so extra frame text cannot break an
anchor); named entities outside the extractor's table; and heavily malformed markup
where the tokenizer's approximation of the HTML parser diverges. Change
`src/core/reading-text.ts` and the `applyResources` image branch together.

## Implementation notes

- **`SearchHit` is `{ text, context, position, sectionIndex }`.** `text` is the raw
  matched run; `context` is the match surrounded by neighbouring text, trimmed to
  whole words at both edges via `Intl.Segmenter` and whitespace-collapsed for a
  one-line display; `position` is a content-addressed `Position` from
  `capturePosition(rawText, rawOffset, section.id)`, jumpable via `goTo`.
- **The offset map is the bridge.** `normalizeText(raw)` returns the folded string
  plus `map[i]` = the raw UTF-16 offset that produced normalized code unit `i` (and
  `map[len]` = raw length). A match at normalized `[a, b)` maps to raw `[map[a],
  map[b])`; `capturePosition` takes the raw offset directly (it converts UTF-16 →
  grapheme internally). The map is built grapheme-by-grapheme so the fold stays
  anchorable even where `toLowerCase`/NFC change length. The raw text handed to
  `capturePosition` is never NFC-rewritten — it must stay byte-identical to what the
  paginator measures.
- **The scan is a lazy async generator.** `searchBook(book, query)` loads, extracts,
  matches and releases one section at a time and `yield`s each hit as it is found —
  the book is never buffered whole, so the first hit surfaces before the last section
  is decoded. A consumer that `break`s halts the scan (the generator's cleanup runs on
  return); no later section is loaded. `matchText` is the pure per-section unit both
  the scan and the tests drive.
- **`reader.search` does not go through the navigation queue.** It reads bytes
  headlessly and drives neither the paginator nor the frame, so it composes with
  reading rather than blocking it — the same reasoning that keeps `selection`
  reporting off the queue. The consumer's `goTo(hit.position)` is what enqueues.
- **`onSection` is a test-only instrumentation seam** on `searchBook` — it fires with
  each section index just before that section is decoded, so a test proves laziness by
  counting decodes rather than inferring it from an eventual result.

### Highlighting a hit rides the same anchor as the jump

A hit is not only jumpable, it is *highlightable* off the identical anchor. After
`goTo(hit.position)` lands, a consumer calls `decorate(id, hit.position, { className })`
(the draw-only decorations API — see [`view.md`](view.md)) to draw a visible highlight
over the hit's span with its class. Both the jump and the highlight resolve `hit.position`
against the frame-measured section text through the same `Position` machinery, so **no new
addressing is introduced** — the highlight sits exactly where the jump landed. The demo
does this on a hit-row click, reusing one decoration id so a single hit is highlighted at
a time.

- **The soft miss stays inert on the highlight leg too.** A hit whose `Position` no longer
  resolves (the content changed, or the extraction/frame edge divergence above shifts the
  quote out of reach) decorates to **nothing and throws nothing** — the exact
  position/decoration soft-miss contract the jump already follows. A stale hit degrades
  quietly on both legs: the jump lands on the section's first page and the highlight draws
  no box. There is no new error path.

## Gotchas

- **Sections are the scan unit — a match spanning a section boundary is not found.**
  Each section is extracted and matched independently; a query whose text straddles
  two sections yields nothing. This is an accepted limitation of the current engine.
- **A blank (empty or whitespace-only) query yields nothing** — `normalizeQuery`
  folds it to `''` and both `matchText` and `searchBook` return immediately.
- **Extraction is a tag-stripping tokenizer, not `DOMParser`.** `DOMParser` is a
  browser primitive with no headless Node global, and search only needs text content,
  so extraction hand-strips tags, skips `head` and every discarded/raw-text container
  by jumping to its matching end tag, and decodes the common named + numeric HTML
  entities. An unknown entity is left verbatim.
- **The hit's `text`/`Position` re-resolve against the *frame's* section text.**
  Capture mirrors it through the shared reading-text policy (see the key decision
  above); the residual divergences listed there surface as a jump that lands on the
  section's first page (a soft resolution miss) rather than the hit's page. Proven
  both headlessly (`test/search.test.ts`, capture text equals the simulated frame
  text) and in the browser (`test/browser/search.browser.mjs`, a hit spanning an
  alt-substituted drop cap and a discarded element jumps and highlights —
  `test/fixtures/epub/search-anchors.epub`).
