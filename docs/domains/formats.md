# Formats domain

## Overview

The `formats` domain is the seam where raw bytes become a `Book`, and the home of
the lightweight decoders that are *not* their own domain. Each format is a
`BookFormat` (`{ name, sniff, decode }`) registered through the public `open(input,
{ formats })` seam — the same seam third parties use, with no format baked into
core. EPUB (`src/formats/epub`) and MOBI (later) are heavy enough to own their own
domain docs; this doc covers the seam itself and the plain-text decoder
(`src/formats/text`). Sniffers run in the caller's registration order and the first
claim wins, so richer formats are listed before catch-all ones.

Code:

- `src/formats/index.ts` — the public barrel: `export { epub, text }`.
- `src/formats/text/index.ts` — the plain-text decoder (this doc's subject).

## Key decisions

- **TXT is the seam probe, not a feature** (2026-08-25, PLAN M4-1). Its whole value
  is proving the decoder seam is real and not EPUB-shaped: a format with no
  container, no manifest, and no markup synthesizes everything the `Book` model
  needs — id-addressed lazy sections, a coarse TOC, minimal metadata — through the
  identical public seam EPUB uses, and it required **zero** changes to
  `src/core`, `src/layout`, or `src/view` (the enforced seam check; see Gotchas).
- **Sections are emitted as XHTML, not raw text.** The view renders a section by
  sanitizing its bytes as HTML/XHTML, so the text decoder wraps paragraphs in `<p>`
  and headings in `<h2>` and hands back a well-formed XHTML document per section
  (`application/xhtml+xml`). This keeps the view untouched — a text book renders
  through exactly the same pipeline as an EPUB chapter.
- **Coarse chapter split, degrading to one section.** Blank-line-separated blocks
  are paragraphs; a short single-line block that reads as a chapter heading (a
  keyword like `CHAPTER`/`BOOK`/`PART`/`LETTER…`, or a short all-caps line) starts a
  new section and a TOC entry. A file with no detectable heading becomes one
  synthetic section, so a headingless text still reads. The heuristic is
  deliberately shallow — "good enough for reading", not structural fidelity.
- **Encoding: BOM wins, then strict UTF-8, then windows-1252.** A UTF-8/UTF-16
  BOM picks the encoding outright (and its bytes are stripped); otherwise UTF-8 is
  tried with `{ fatal: true }` and a throw falls back to windows-1252 — the codepage
  most non-UTF-8 Western TXT actually uses. `Intl`-free, `TextDecoder`-only, no
  dependency.
- **No `resolve`, no resources.** Plain text references nothing, so the section
  omits `Section.resolve` entirely (the model allows it to be absent) and the book's
  `resources` map is empty — a concrete demonstration that those parts of the model
  are genuinely optional, not EPUB assumptions.

## Implementation notes

- `text.sniff` is a conservative last-resort claim: a Unicode BOM is a positive
  signal; a zip signature (`PK\x03\x04`), a PDF (`%PDF`), an XML/HTML document (first
  non-space glyph `<`, which covers FB2 and XHTML), or an unmarked NUL byte (binary,
  or BOM-less UTF-16 we refuse to guess) all reject; anything else is accepted.
  Registered *after* richer formats, it only ever sees bytes nothing else claimed.
- `decode` reads the whole source (`source.read(0, source.size)`), decodes, normalizes
  line endings to `\n`, splits into blocks, routes headings vs paragraphs, and emits
  one XHTML section per chapter. A block's internal newlines are soft wraps and
  collapse into one paragraph. Markup-significant characters in the text (`& < >`)
  are XML-escaped, so raw `<b>` in the source never becomes an element.
- Metadata is best-effort from Project Gutenberg conventions: a `Title:`/`Author:`
  header block, or the `The Project Gutenberg eBook of TITLE, by AUTHOR` banner.
  Anything not found is omitted, never set to `undefined` (matches the
  `exactOptionalPropertyTypes` model rule).

## Gotchas

- **The seam check is the acceptance, not the decoder.** At task close,
  `git diff --stat src/core src/layout src/view` MUST be empty. If a new format ever
  seems to *need* a core/layout/view change, that is the finding — stop and surface
  it rather than quietly widening the seam; the model is the stability promise.
- **Registration order matters.** `open(input, { formats: [epub, text] })` — text
  last, so it never steals an EPUB (which it would otherwise decode as one synthetic
  blob of zip noise). The order is the caller's; the demo and tests both list text
  last.
- **Heading detection is intentionally shallow.** It will miss unconventional
  chapter styling and can over-split on an all-caps line that is not a heading. That
  is acceptable for a reading-grade TXT; do not grow it into a structure parser.

## Patterns

- **Decoder correctness is headless.** The whole text decoder is tested under
  `node:test` (`test/text.test.ts`) with no browser: synthetic structure, the
  windows-1252 / BOM / UTF-16 encoding paths asserted on payload (not just shape),
  sniff guards, registry ordering, and a corpus pass over `test/corpus/gutenberg-*.txt`
  that skips gracefully when the gitignored corpus is absent. Rendering rides the
  existing view's browser coverage. This mirrors the epub domain's headless-decoder
  rule.
