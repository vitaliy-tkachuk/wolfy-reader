# Layout domain

## Overview

The paginator turns a decoded section's markup into pages inside the sandboxed
view host. It is the engine the reader facade (M2-4) consumes; it owns no host
vocabulary, never fetches, and never persists.

Modules:

- `src/layout/chunk.ts` — pure chunk-boundary rules over a structural `ChunkNode`
  view of a top-level node list (`chunkNodes`), plus `chunkElement` to adapt a
  live DOM body. DOM-free by design so the rules are unit-testable under
  `node:test`. Default budget `DEFAULT_CHUNK_CHARS = 8000`.
- `src/layout/normalize.ts` — pure string transforms applied before chunking on
  the raw-markup path: `normalizeSelfClosing` (XHTML non-void self-close →
  open+close), `substituteDropCapAlt` (`<img alt>` → text), and
  `normalizeSectionMarkup` (both, in order). The `ContentHost` render path already
  does the DOM-side equivalents in its sanitizer; these cover the raw-markup path.
- `src/layout/index.ts` — the `Paginator` class: the public engine surface.
- `src/view/{protocol,frame,host}.ts` — the frame-side layout, measurement,
  chunking, and eviction the paginator drives over the postMessage protocol.

`bench/` is a throwaway benchmark, deliberately outside `src/`, kept as the
measured basis for the decisions below. Run it with `npm run bench`. Fixtures are
generated from the gitignored corpus and are themselves gitignored.

## Architecture

Chunking runs **host-side**, on the sanitized DOM, before the body markup crosses
into the frame. `ContentHost.renderChunked` calls `chunkElement` on the sanitized
document body and wraps each chunk in a container
(`<div class="wolfyreader-chunk" data-chunk-index data-chunk-start data-chunk-end>`)
carrying its cumulative, end-exclusive character range over the tiled section
text. Only *measurement* (`Range.getClientRects`, per-chunk multi-column geometry)
must run in-frame under the opaque origin; chunking is pure string/DOM work that
does not, so it stays host-side where it is testable and where the same sanitize +
resources pipeline already holds the DOM. See "Where chunking runs" below.

The `Paginator` wraps a `ContentHost` over a container element and bridges page
geometry to the headless `Position` model in `src/core`. Core is *called*, never
changed: a page maps to a `Position` through `offsetOfPage` → `capturePosition`,
and a `Position` maps back through `resolvePosition` → `pageOfOffset`. The offset
spaces differ — `resolvePosition` returns a grapheme index while the frame speaks
UTF-16 code units — so the paginator converts between them with `Intl.Segmenter`
(exact for surrogate pairs, combining sequences, emoji clusters).

Public surface consumed by the facade (M2-4): `paginate(section, request?)`,
`relayout`, `switchMode(mode)`, `refine`, `goToPage`/`nextPage`/`previousPage`,
`positionOfPage`/`pageOfPosition`, `chapterProgress`/`bookProgress`,
`diagnostics`, `sectionText`, `destroy`, plus the `host`/`section`/`options`/
`state`/`page` getters. Defaults: paginated mode, `chunkChars` 8000,
`windowChunks` 2, `columnGap` 40, page size from the container's
`clientWidth`/`clientHeight`.

## Verdict (carried from the M2-1 prototype)

**GO on the hybrid approach — with one amendment to its shape, and a correction to
why it works.**

Chunk-and-virtualize is worth building. It buys a 4.9× faster initial render and a
7.0× faster font-size re-layout on a 500KB section, against costs that are real but
bounded and mostly UX-shaped rather than performance-shaped.

Two things the prototype changed about the bet as `PLAN.md` §4 stated it:

1. **Chunks cannot be blocks in one shared column flow** (see Gotchas — a hard
   rendering constraint, not a tuning choice). Each chunk gets its own multi-column
   context, absolutely positioned at a measured offset.
2. **The two halves of the bet buy different things, and neither is redundant.**
   Chunking alone buys the initial render. `content-visibility` alone buys the
   re-layout. The plan assumed chunking was what bought the speed; that is true for
   render and false for re-layout.

## Key decisions

- **2026-08-24 — Go on chunked + virtualized CSS multi-column.** Measured below.
- **2026-08-25 — Chunking runs host-side, over the sanitized DOM.** Measurement
  needs the opaque-origin frame; chunking does not, and running it host-side keeps
  the boundary rules pure and unit-testable and reuses the sanitize/resources
  pipeline that already holds the DOM. `renderChunked` emits chunk containers with
  cumulative, end-exclusive char ranges; the frame tiles them into the section
  text it measures against.
- **2026-08-25 — Eviction policy: a `windowChunks` window plus `content-visibility`,
  with geometry retained.** The frame keeps the active chunk and `windowChunks`
  (default 2) either side realized; chunks outside the window are un-realized but
  their measured geometry is retained, so page numbers do not shift when a chunk is
  evicted and re-realized on return. This closes the prototype's "eviction
  unmeasured" gap — see Measurements → Eviction.
- **2026-08-25 — Estimation strategy: estimate at first paint, firm via `refine`.**
  The first `paginate` returns a page count that may be an estimate
  (`PaginationState.firm === false`) computed from the realized window; `refine`
  forces a full relayout that measures every chunk and firms the count
  (`firm === true`). Callers surface `firm` so the churn is visible rather than
  presented as precise. See "Estimated-page-count churn" below.
- **2026-08-25 — Protocol versioning: `PROTOCOL_VERSION = 2`, hand-maintained.**
  The message set (`paginate`/`relayout`/`goToPage`/`offsetOfPage`/`pageOfOffset`/
  `sectionText`/`diagnostics` and their replies) is typed and validated on both
  sides. The frame's copy of the host-message validator lives in a template string
  in `frame.ts` (it cannot import), so `protocol.ts` and that copy are kept in step
  by hand; any change bumps the version and edits both.
- **Each chunk is its own multi-column context, absolutely positioned.** Forced by
  layout containment (Gotchas). Every chunk boundary is a forced page break —
  accepted, and it is what the page-count cost below buys.
- **`content-visibility: auto` is kept, for re-layout only.** It makes bulk
  realization ~4× slower (93.4 ms vs 22.1 ms to resolve the exact page count on the
  synthetic fixture). It earns its place because appearance changes are frequent
  and interactive, and full-document realization is not.
- **Chunk budget: 8000 characters.** The sweep below shows chunk size is the whole
  tradeoff dial with no free setting. 8000 sits where page inflation is tolerable
  and seek latency stays comfortably sub-frame.
- **Page-turn latency is not a decision input.** Both strategies are 20–100× under
  a frame budget; the measure cannot separate them (Gotchas).

## Measurements

Chromium 151.0.7922.34, win32 x64, 800×600 viewport, 16px Georgia, dpr 1. Three
measured runs after a discarded warm-up, fresh page each, 60 turns per run. Median
across runs.

**synthetic-500k — 512,783 B, single section, real Gutenberg prose**

| | pages | render ms | re-layout ms | turn cpu p50/p95 | seek cpu p50/p95 | JS heap | DOM / layout objects |
|---|---|---|---|---|---|---|---|
| naive | 218 | 159.1 | 102.6 | 0.20 / 0.20 | 0.10 / 0.20 | 1.9 MB | 2999 / 8077 |
| chunked | 252 | **32.8** | **14.6** | 0.20 / 3.60 | 1.20 / 7.10 | 4.5 MB | 2864 / 7596 |

**real-largest — 184,797 B, Pride and Prejudice `item8` (largest real section)**

| | pages | render ms | re-layout ms | turn cpu p50/p95 | seek cpu p50/p95 | JS heap | DOM / layout objects |
|---|---|---|---|---|---|---|---|
| naive | 89 | 59.2 | 38.4 | 0.10 / 0.20 | 0.10 / 0.20 | 1.6 MB | 1082 / 2125 |
| chunked | 96 | **20.2** | **9.6** | 0.10 / 2.90 | 0.80 / 3.00 | 2.9 MB | 1103 / 2151 |

These render (≈32.8 / 20.2 ms) and re-layout (≈14.6 / 9.6 ms) figures are the
reference ceilings the browser timing test asserts against as a regression guard;
they are nice-to-have, not gating, and skip when the corpus is absent.

**Stability.** Render times repeat to ±0.5 ms across separate full invocations,
against effect sizes of 3–7×. Independently, the built paginator's *page count* is
now asserted stable directly: `test/browser/layout.browser.mjs` paginates the same
fixture at the same viewport N times and requires an identical count each time.

**`content-visibility` ablation** — the causal result:

| re-layout ms | naive | chunked, cv on | chunked, cv off |
|---|---|---|---|
| synthetic-500k | 103.1 | **15.1** | 141.3 |
| real-largest | 38.9 | **9.6** | 49.9 |

Without `content-visibility`, chunking is a re-layout regression — 1.37× slower
than naive on the synthetic fixture, 1.28× on the real one. Initial render is
unaffected by it (32.8 vs 35.1 ms), so that win is chunking's alone.

**Chunk-size sweep**, synthetic fixture. There is no free setting:

| budget (chars) | extra pages | render ms | re-layout ms | seek cpu p95 |
|---|---|---|---|---|
| 3 000 | +45.0% | 27.4 | 12.3 | 4.3 |
| 8 000 | +15.6% | 31.4 | 15.4 | 6.9 |
| 20 000 | +4.1% | 37.8 | 20.2 | 15.8 |
| 60 000 | +1.8% | 68.9 | 47.1 | 45.3 (max) |

### Eviction (resolved — was "unmeasured" in the prototype)

The prototype never un-realized a chunk, so after a full seek pass its DOM/layout
counts sat at parity with naive and its memory advantage decayed to nothing. The
built paginator evicts: only the active chunk and `windowChunks` (default 2) either
side stay realized. `test/browser/layout.browser.mjs` drives a full seek pass
across a long section and asserts, via `diagnostics().realizedChunks`, that the
realized-chunk count stays **bounded** (does not grow with the number of chunks
seen) and that returning to an evicted chunk re-realizes it correctly. Retained
per-chunk geometry keeps page numbers stable across eviction, so the count does not
shift under the reader. This is what makes the virtualization advantage survive a
reading session rather than only the first pass through a chapter.

### Estimated-page-count churn (resolved — now documented and surfaced)

The page count at first paint is an estimate, off by −1.6% (synthetic) and −11.5%
(real) in the prototype, and it shifts as chunks are measured. This is the least
visible cost in the timings and the most felt one in use: the reader's page numbers
and progress bar move under them. The built paginator makes the churn *explicit*
rather than hiding it — `PaginationState.firm` is `false` while the count is an
estimate and `true` once every chunk is measured; `refine()` forces the firming
relayout, and `chapterProgress`/`bookProgress` carry `firm` through so a caller can
show "≈ N pages" until it settles. Book-level counts across un-laid-out sections
are explicitly approximate (`BookProgress.approximate` is always `true`): only the
current section is laid out, so any span across siblings is an even-weight estimate.

### What chunking costs

- **+15.6% pages** on the synthetic fixture, +7.9% on the real one — the forced
  page break at every chunk boundary.
- **Worse seek p95** — 7.10 ms vs naive's 0.20 ms on cold chunks. Still ~2× under a
  frame at 8000 chars; not so at 20000+.
- **The estimate churns until firm** (above).

## Implementation notes

### Chunk-boundary strategy

Derived from the real section (571 top-level blocks, 552 `<p>`, max nesting depth
5), not from theory. Implemented in `chunk.ts`, pinned by `test/layout.test.ts`.

- **Split only between top-level children.** Depth-1 boundaries cover ~99% of a
  real section; descending further is not worth the complexity.
- **An element larger than one chunk is emitted whole, never descended into.**
  Lydia's letter in `item8` is a single `<p>` of 10,142 characters (median `<p>`
  is 209, p95 is 854). Descending would put a boundary mid-paragraph, restarting
  justification in a new formatting context mid-sentence. One chunk at ~1.25×
  budget is the cheaper defect.
- **Never end a chunk on a heading or `<hr>`.** The boundary is a forced page
  break, so a trailing heading is an orphan. Defer it to the next chunk. The defer
  loop stops while only one node is held, so a leading heading is never flushed
  ahead of an empty chunk.
- **Atomic — never split inside:** `table`, `pre`, `ol`, `ul`, `dl`, `figure`,
  `blockquote`, `svg`, `math`. Splitting restates row alignment, list numbering, or
  preformatted whitespace in a second formatting context.
- **Bare top-level text nodes** are glued to the open chunk; whitespace-only ones
  are dropped by `chunkElement` before the rules run.

### Correctness checks

The benchmark compares rendered `textContent` byte-for-byte between strategies
(modulo collapsed inter-block whitespace) and checks every chunk box for column
overflow — a strategy that silently clips text would otherwise benchmark well. The
built paginator's browser test carries the same intent: scrolled-mode parity
asserts `textContent` matches paginated mode modulo whitespace with no clipping.

## Gotchas

- **`content-visibility: auto` applies layout containment, and a layout-contained
  box cannot fragment across columns.** Measured: six blocks in one 400×300 column
  flow occupy 50 columns plain and 6 columns with `content-visibility: auto` — one
  column each, the rest clipped. Hence per-chunk absolutely-positioned contexts.
- **A fragmented element has no usable height.**
  `getBoundingClientRect().height` on a column-fragmented element returns the
  column height, not its extent through the flow — so an off-screen chunk cannot be
  swapped for a correctly sized spacer. Hence the absolutely-positioned per-chunk
  contexts with retained geometry.
- **Empty inline elements return empty `getClientRects()`.** `item8` carries 114
  zero-width page-anchor spans mid-paragraph. Any `Range`-based page-boundary or
  position lookup length-checks every rect list rather than assuming geometry
  exists. Whitespace-only text nodes hit the same guard.
- **XHTML self-closing non-void tags are a correctness trap in an HTML context.**
  `<a id="CHAPTER_XLVIII"/>` appears 13 times in `item8`; an HTML parser ignores
  the slash, so injecting it as `innerHTML` lets the anchor swallow the rest of the
  section. `normalizeSelfClosing` rewrites it before chunking on the raw-markup
  path; the `ContentHost` sanitizer does the DOM-side equivalent on the render
  path.
- **In this corpus, image policy is text policy.** Gutenberg sets each chapter's
  drop cap as `<img alt="T">`. A naive strip deletes the first letter of every
  chapter. `substituteDropCapAlt` puts the `alt` back as text.
- **Double-rAF page-turn timing is frame-quantized and proves nothing.** Every
  strategy reads 16.7–16.8 ms because that is the frame interval. Real separation
  lives only in the CPU measure.
- **`performance.memory.usedJSHeapSize` measures the wrong thing here.** It is the
  JS heap only — it excludes the layout tree, style cache, paint and GPU memory.
  Chunked's heap reads *larger* purely because the splitter retains chunk HTML as
  strings. CDP `LayoutObjects` and DOM node counts are the closer proxies, and the
  built paginator's eviction test uses `diagnostics().realizedChunks`/`domNodes`.
- **The 500KB fixture is synthetic** — no real corpus section approaches it. The
  largest across four books is 187KB, and longer books chunk *more* aggressively,
  not less (War and Peace: 1.8MB → 368 sections, largest 48KB).

## Cross-browser status

Single machine, single OS, single browser: the measurements and the browser tests
run under Chromium only (full Chromium via the `chromium` channel, not the headless
shell — sandbox/CSP/opaque-origin semantics are under test). Safari and Firefox
fragmentation behaviour under layout containment is **unverified**. Per the task's
scope, cross-browser hardening is not gated on this unit; if a fragmentation
blocker surfaces on another engine it becomes its own task. This is a known,
accepted limitation, not an oversight.
