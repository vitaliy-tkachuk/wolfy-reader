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
(`<div class="wolfy-reader-chunk" data-chunk-index data-chunk-start data-chunk-end>`)
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
`relayout`, `switchMode(mode)`, `resize`, `refine`, `goToPage`/`nextPage`/`previousPage`,
`positionOfPage`/`pageOfPosition`, `chapterProgress`/`bookProgress`,
`setThemeCss(css)` / `applyAppearance(css, geometry)`, `diagnostics`,
`sectionText`, `destroy`, plus the `host`/`section`/`options`/`state`/`page`
getters. Defaults: paginated mode, `chunkChars` 8000, `windowChunks` 2,
`columnGap` 40, `columnCount` 1, page size from the container's
`clientWidth`/`clientHeight`.

**Appearance-driven re-layout reuses the mode-switch machinery.** A live
appearance change lands through one of two entries. `setThemeCss(css)` handles a
colour-only theme: geometry is invariant, so it captures a `Position`,
re-assembles, and restores the *exact* page. `applyAppearance(css, { columnCount,
columnGap })` handles a reflowing typography knob (font/size/line-height/margin/
columns): geometry changes, so it reuses the exact capture → re-layout → resolve →
restore path that `switchMode` uses (shared as `#reapply`), restoring the
*nearest* anchor page. **`resize()` is the same capture → re-paginate → seek-back,
but re-reads the container's `clientWidth`/`clientHeight`** — page geometry is
captured once at `paginate`, so a container that later resizes leaves the frame's
content at the old size (it scrolls when shrunk, gaps when grown). `resize()` no-ops
(returns `null`) when the size is unchanged or the container is `0×0` (hidden), so a
`ResizeObserver` can call it on every notification without churn; the reader owns
that observer (see [`view.md`](view.md)). `PaginateRequest`/`resolveOptions` carry `columnCount`
(1 or 2) through to `PaginateOptions`, and the frame splits each per-chunk
multi-column context into that many columns per page — `stride()` advances by N
column strides so a page paints N columns at once.

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
- **2026-08-25 — Protocol versioning: hand-maintained, now at `PROTOCOL_VERSION =
  8`.** The layout message set (`paginate`/`relayout`/`goToPage`/`offsetOfPage`/
  `pageOfOffset`/`sectionText`/`diagnostics` and their replies) is typed and
  validated on both sides; the wire is shared with the reader facade, which grew the
  version well past the layout-only `2` (link/input/selection/image-tap; see
  [`view.md`](view.md)). The typography half added one *field*, `columnCount` on
  `PaginateOptions`, taking it to `8`. The frame's copy of the host-message
  validator lives in a template string in `frame.ts` (it cannot import), so
  `protocol.ts` and that `validateHost` copy are kept in step by hand; any change
  bumps the version and edits both.
- **2026-08-26 — Page→offset mapping is a binary search, not a per-character
  walk.** `offsetOfPage` in the coordination script used to probe every character
  with `getClientRects` until one landed in the page's column band. Column flow is
  monotonic — the page band a character paints in never decreases as its text
  offset grows — so the first character of a page is found by binary search over
  the chunk's text (~log n rect probes over an ≤8000-char chunk). Characters with
  no client rects (zero-width anchors, collapsed whitespace) are skipped by
  scanning forward to the next measurable character inside each probe; a page
  band holding no measurable character falls back to the chunk's start offset,
  as before. Relatedly, `pointAtOffset` (the decorations seam) realizes **only
  the chunk that owns the offset**: the accumulation walk reads `textContent`
  (DOM, not layout), so a decoration in a late chunk no longer force-realizes
  every earlier chunk and the content-visibility eviction window survives —
  asserted by the "decoration realization window" case in
  `test/browser/layout.browser.mjs`. The paginator's section-text cache also
  survives same-section reflows (mode switch, appearance) now, since the text is
  invariant; it still invalidates on a section change. These compose with the
  host's per-section render-input cache (see [`view.md`](view.md)), which is what
  stops a font-size tick re-decoding and re-minting resources.
- **Each chunk is its own multi-column context, absolutely positioned.** Forced by
  layout containment (Gotchas). Every chunk boundary is a forced page break —
  accepted, and it is what the page-count cost below buys.
- **The chunk box must be `overflow: visible`; only the root box clips.** A page
  turn reveals a later column by translating the whole chunk left, so its
  multi-column overflow (columns 2, 3, …, which lay out to the right) has to
  stay paintable. `overflow: hidden` on the chunk travels with the box under the
  translate and paints only the first column — every page after the first goes
  blank while `getClientRects` still reports laid-out positions for the clipped
  columns, so the blank is invisible to a layout-only probe. The viewport clip
  lives on the `#wolfy-reader-content` root. Regression:
  `test/browser/layout.browser.mjs` "paginated pages paint their content" probes
  with `elementFromPoint` (which honours the clip) rather than rects.
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

These figures are measurements of one machine through the bench harness. They are
**not** what the browser timing test asserts, and they are not comparable to what it
measures: the bench times a strategy's render, while the browser guard times the
public `paginate()` path end to end, which is a different and larger piece of work.

**The browser timing guard is denominated in machine units, not milliseconds.** The
page first times a fixed text-layout loop — rewrite a paragraph, read its box, forty
times — and then asserts the paginator's cost as a multiple of that unit. Machine
speed cancels out, which is the whole point: the same commit measured 574 ms and
1139 ms on consecutive CI runs, so any absolute ceiling is a statement about the
runner rather than about the paginator. The calibration deliberately avoids the
paginator — a ratio between two paginate calls moves with both, so a uniform
slowdown would divide out and leave the guard blind to it. The case remains
nice-to-have rather than gating, and skips when the corpus is absent.

**Calibration removes most of the machine difference, not all of it.** Measured
across two runners: a laptop renders the largest real section in ~250 ms and
`ubuntu-latest` in ~830 ms, which is ~70 and ~75 machine units — the point of the
unit. But the ratio still drifts about 30% between CI runs (75u and 100u on
consecutive runs of one commit), because the paginate path includes frame
round-trips that do not scale with pure layout speed. So the thresholds keep real
headroom over the widest observation rather than hugging it; a guard tightened to
the best-looking sample is a guard that goes red on a busy afternoon.

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

- **`refine()` cannot be used to measure what a re-layout costs.** It returns the
  current state immediately when that state is already firm, so timing it measures an
  early return — a timing assertion built on it passes without any work happening.
  `relayout()` is the unconditional path and the one to time; the browser harness
  exposes both for exactly this reason.
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
  section. The `ContentHost` sanitizer handles it on the render path by re-importing
  XHTML into an HTML document. (A string-level `src/layout/normalize.ts` once
  duplicated this for a "raw-markup path" that no longer exists — every section now
  reaches the paginator through the host, so the module was deleted as dead code,
  2026-08-26.)
- **In this corpus, image policy is text policy.** Gutenberg sets each chapter's
  drop cap as `<img alt="T">`. A naive strip deletes the first letter of every
  chapter. The resource layer substitutes the `alt` text for an image it cannot
  serve (`applyResources` in `src/view/resources.ts`).
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
