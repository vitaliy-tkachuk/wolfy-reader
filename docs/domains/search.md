# Search domain

## Overview

`src/search` is full-text search over a book: a headless matcher that scans decoded
section text and yields jumpable hits. Its public surface is the `reader.search`
facade method (see [`view.md`](view.md)); the engine underneath is three modules:

- `extract.ts` — decode a section's bytes (BOM-aware) and strip its markup to plain
  text, plus entity decoding.
- `normalize.ts` — the folding policy that decides when two strings match, with an
  offset map back to raw text.
- `matcher.ts` — normalized literal substring search over one section (`matchText`),
  and the lazy whole-book scan (`searchBook`).

**It is headless by rule and DOM-free.** It imports only `src/core`
(`capturePosition`, `Position`, `Book`, `Section`) and platform primitives
(`Intl.Segmenter`, `TextDecoder`) — never `document`/`window`, never `src/view` or
`src/layout` — so the whole matcher runs under `node:test`. That is why search
quality is asserted headlessly on decoded text; only jump-to-hit landing needs a
browser.

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

### Extraction anchors into the same text the frame measures

The extractor mirrors `textContent`: every tag contributes zero characters, so a
match split across inline markup (`wo<em>rd</em>`) is found as `word`, **and** the
resulting offsets line up with the frame's `sectionText()` (also `textContent` of the
same tree). That alignment is what lets a hit's `capturePosition`-built `Position`
resolve back inside the frame and land on the right page. If extraction inserted
whitespace at block boundaries that the frame does not, or decoded entities the frame
leaves raw, an anchored quote could drift and resolution would miss.

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
  so extraction hand-strips tags, skips raw-text containers (`script`/`style`/`head`/
  `title`/`template`) by jumping to their matching end tag, and decodes the common
  named + numeric HTML entities. An unknown entity is left verbatim.
- **The hit's `text`/`Position` re-resolve against the *frame's* section text, which
  differs from extraction only in the entity/whitespace edges above.** Keep the two
  extraction contracts aligned; a divergence surfaces as a jump that lands on the
  section's first page (a soft resolution miss) rather than the hit's page.
