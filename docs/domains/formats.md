# Formats domain

## Overview

The `formats` domain is the seam where raw bytes become a `Book`, and the home of
the lightweight decoders that are *not* their own domain. Each format is a
`BookFormat` (`{ name, sniff, decode }`) registered through the public `open(input,
{ formats })` seam — the same seam third parties use, with no format baked into
core. EPUB (`src/formats/epub`) is heavy enough to own its own domain doc; this doc
covers the seam itself and the plain-text decoder
(`src/formats/text`). Sniffers run in the caller's registration order and the first
claim wins, so richer formats are listed before catch-all ones.

Code:

- `src/formats/index.ts` — an internal convenience barrel (`export { epub, fb2, text }`)
  for tests and the demo, which import it by path. It is deliberately **not** in the
  package's `exports` map: each decoder ships as its own subpath so a consumer pulls
  only the closure it uses. See [`release.md`](release.md).
- `src/formats/text/index.ts` — the plain-text decoder.
- `src/formats/fb2/index.ts` — the FictionBook 2 decoder.
- `src/formats/xml.ts` — the shared headless XML parser (`parseXml` + helpers +
  `decodeXml`), used by both `epub` and `fb2`. It lives at the `formats` root, not
  under `epub`, precisely because it is cross-format infrastructure; neither format
  reaches into the other.

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

### FB2 (FictionBook 2)

- **The whole book is one XML file, and the model fit it without bending** (2026-08-25,
  PLAN M4-2). No container, no manifest, cross-references by element id — the second
  seam probe. `description/title-info` → metadata; each top-level `<section>` of the
  main `<body>` → one Book section (`s0`, `s1`, …); each named `<body name="notes">`
  → one section (`nb0`, …); inline base64 `<binary>` → resources resolved by
  `Section.resolve`; cover from `title-info/coverpage`; `document-info/id` →
  `BookMetadata.identifier` when non-empty, the document's own identity claim and the
  only stable key a host has for the positions it persists. Zero core/layout/view diff.
- **Body-level content before the first `<section>` is prepended to `s0`, not given a
  section of its own.** A main `<body>` may open with a `<title>`, `<epigraph>`s and an
  `<image>` — the book's own title page. Dropping it would break the transparency rule,
  and a leading `front` section would renumber every `s<n>` behind it: FB2 section ids
  are index-synthesized, so renumbering shifts positions a host has already persisted.
  The preamble renders one heading level above the chapters it introduces (`<title>` →
  `<h1>`) and its element ids map to `s0` for link rewriting. A body whose only
  pre-section children are whitespace gets no preamble, so such a book's markup is
  byte-identical either way.
- **One undecodable `<binary>` is dropped, never fatal.** Invalid base64 in a single
  image must not cost the whole book, so the binary is skipped: that id resolves to
  `undefined` and stays out of `Book.resources`, every other binary still loads. The
  model has no report channel — a `resolve` miss *is* the documented degrade for a
  broken resource, the same lazy refusal EPUB makes for an unreadable entry.
- **The TOC recurses to whatever depth the sections nest.** Every nested `<section>`
  carrying a `<title>` becomes a child entry targeting the owning top-level Book
  section, with the nested element id as `fragment` — nesting is a rendering detail, so
  all depths live in that one section's markup. An untitled level contributes no entry
  of its own but still yields its titled descendants, so a labelled depth is never lost
  behind an unlabelled parent.
- **In-book links are rewritten to `sectionId#elementId` so the reader can follow
  them across sections.** The reader resolves a `goTo(href)` by matching the href
  *path* to a `section.id`, and a bare `#id` only seeks the *current* section. So at
  decode time every FB2 element id is mapped to the Book section that renders it, and
  every authored `#id` link is rewritten to `<sectionId>#id`. This is what makes a
  footnote — whose body lives in a separate `notes` section — jump correctly and
  return via the reader's existing back-stack, with **no** view or reader change.
- **Images reference the binary by a *bare* id, not `#id`.** The view classifies a
  `#…` reference as an in-page fragment and will not serve it as a resource, so
  `<image l:href="#pic1"/>` renders as `<img src="pic1"/>` and `Section.resolve`
  maps the bare id (and, defensively, `#id`) to the `<binary>`. The view then serves
  it as a `data:` URL like any other resource.
- **XML parsing reuses the shared headless parser, never `DOMParser`.** Node has no
  `DOMParser` and decoder tests must run headless (the recorded epub-domain rule), so
  FB2 uses `src/formats/xml.ts`. `decodeXml` honors the XML `encoding` declaration —
  real FB2 is frequently **windows-1251**, and assuming UTF-8 would mojibake every
  Cyrillic character; a BOM still wins over the declaration, and an unknown label
  falls back to UTF-8.
- **Unknown FB2 elements render transparently** (their children only), so content is
  never dropped even for tags the renderer does not explicitly map. Known inline tags
  (`emphasis`→`em`, `strong`, `sub`/`sup`, …) and block tags (`section`, `title`→`h2..h6`
  by depth, `poem`/`stanza`/`v`, `cite`→`blockquote`, `epigraph`) map to XHTML.
  **`table`/`tr`/`th`/`td` map to their XHTML namesakes**, because rendering them
  transparently would concatenate a row's cells into one run of text. Only the
  presentation attributes the view's allowlist keeps are emitted — `align` on `table`,
  `align`/`valign` on `tr`, `align`/`colspan`/`rowspan`/`valign` on `th`/`td` — since
  anything else is stripped on the way into the frame. FB2 spells no `thead`/`tbody`; a
  stray one unwraps and its rows still land in the table.
- **FB2 parses tolerantly; every other `parseXml` caller stays strict** (2026-08-26,
  2026-08-26). Real-world FB2 is frequently hand-edited and sloppy — a valueless attribute,
  an unquoted value, one mismatched close tag — and an all-or-nothing parse would
  discard an otherwise-readable book over a single slip. `parseXml(input, { tolerant:
  true })` recovers: valueless attributes become empty strings, unquoted values read
  to the next whitespace/tag end, a mismatched close closes the nearest matching
  ancestor (or is ignored when nothing matches), and elements left open at EOF are
  auto-closed. Strict remains the default and EPUB's container/OPF/nav parsing is
  unchanged — those documents are machine-generated inside a zip, where malformedness
  really does mean corruption. Grossly malformed FB2 still fails and is wrapped in
  `CorruptContainerError`.
- **`fb2.sniff` decodes a UTF-16 BOM head before testing for `<FictionBook`**
  (2026-08-26). The sniff reads the head as Latin-1 (one byte → one char) so
  the root name is legible under any single-byte encoding — but in UTF-16 every other
  byte is NUL, `<FictionBook` never matches, and a BOM'd UTF-16 FictionBook fell
  through to `text.sniff` (which accepts any BOM as a positive text signal) and
  decoded as plain text. The sniff now decodes an FF FE / FE FF head as UTF-16LE/BE
  first; `decodeXml` already honored the BOM at decode time, so only the sniff needed
  widening. `text.sniff` stays a genuine last resort — the fix is making the richer
  format claim its bytes, never making the catch-all pickier.

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
- **FB2 the same, plus one load-bearing browser test.** `test/fb2.test.ts` covers
  decode headlessly — metadata, section/TOC structure, the footnote href rewrite,
  image/`Section.resolve` mapping, the windows-1251 encoding path, and a
  resilience/structure fixture (`structure.fb2`: an undecodable binary beside a good
  one, a body-level preamble, a table, three levels of nesting) — payload asserted.
  The single behavior that cannot be headless — a real footnote *click*
  jumping to the notes section and `back()` returning — is `test/browser/fb2.browser.mjs`,
  because the link-click interception, postMessage round-trip, and back-stack live in
  the real reader and the opaque-origin frame. The browser harness (`harness.html`)
  opens with `formats: [epub, fb2, text]`.
