# Layout domain

## Overview

The paginator: turning a decoded section's markup into pages. `src/layout` is still a placeholder — this doc records the outcome of the pagination prototype (`bench/`), which is the measured basis for building it.

`bench/` is a throwaway benchmark, deliberately outside `src/`: `bench/page.html` (the fixed 800×600 harness), `bench/strategies/{naive,chunked,split,position}.js`, `bench/server.mjs`, `bench/run.mjs` (Playwright driver). Run it with `npm run bench`. Fixtures are generated from the gitignored corpus by `scripts/make-bench-fixture.mjs` and are themselves gitignored.

## Verdict

**GO on the hybrid approach — with one amendment to its shape, and a correction to why it works.**

Chunk-and-virtualize is worth building. It buys a 4.9× faster initial render and a 7.0× faster font-size re-layout on a 500KB section, against costs that are real but bounded and mostly UX-shaped rather than performance-shaped.

Two things the prototype changed about the bet as `PLAN.md` §4 stated it:

1. **Chunks cannot be blocks in one shared column flow** (see Gotchas — this is a hard rendering constraint, not a tuning choice). Each chunk gets its own multi-column context, absolutely positioned at a measured offset.
2. **The two halves of the bet buy different things, and neither is redundant.** Chunking alone buys the initial render. `content-visibility` alone buys the re-layout. The plan assumed chunking was what bought the speed; that is true for render and false for re-layout.

## Key decisions

- **2026-08-24 — Go on chunked + virtualized CSS multi-column.** Measured below. No other M2 unit was blocked on anything else in this doc.
- **Each chunk is its own multi-column context, absolutely positioned.** Forced by layout containment (Gotchas). The consequence — every chunk boundary is a forced page break — is accepted, and it is what the page-count cost below buys.
- **`content-visibility: auto` is kept, for re-layout only.** It is not a general-purpose accelerator here: it makes bulk realization ~4× slower (93.4 ms vs 22.1 ms to resolve the exact page count on the synthetic fixture). It earns its place because appearance changes are frequent and interactive, and full-document realization is not.
- **Chunk budget: 8000 characters.** The sweep below shows chunk size is the whole tradeoff dial with no free setting. 8000 sits where page inflation is tolerable and seek latency stays comfortably sub-frame.
- **Page-turn latency is not a decision input.** Both strategies are 20–100× under a frame budget; the measure cannot separate them (Gotchas).

## Measurements

Chromium 151.0.7922.34, win32 x64, 800×600 viewport, 16px Georgia, dpr 1. Three measured runs after a discarded warm-up, fresh page each, 60 turns per run. Median across runs.

**synthetic-500k — 512,783 B, single section, real Gutenberg prose**

| | pages | render ms | re-layout ms | turn cpu p50/p95 | seek cpu p50/p95 | JS heap | DOM / layout objects |
|---|---|---|---|---|---|---|---|
| naive | 218 | 159.1 | 102.6 | 0.20 / 0.20 | 0.10 / 0.20 | 1.9 MB | 2999 / 8077 |
| chunked | 252 | **32.8** | **14.6** | 0.20 / 3.60 | 1.20 / 7.10 | 4.5 MB | 2864 / 7596 |

**real-largest — 184,797 B, Pride and Prejudice `item8` (largest real section in the corpus)**

| | pages | render ms | re-layout ms | turn cpu p50/p95 | seek cpu p50/p95 | JS heap | DOM / layout objects |
|---|---|---|---|---|---|---|---|
| naive | 89 | 59.2 | 38.4 | 0.10 / 0.20 | 0.10 / 0.20 | 1.6 MB | 1082 / 2125 |
| chunked | 96 | **20.2** | **9.6** | 0.10 / 2.90 | 0.80 / 3.00 | 2.9 MB | 1103 / 2151 |

**Stability.** Render times repeat to ±0.5 ms across separate full invocations, against effect sizes of 3–7×. The noise is orders of magnitude below the effect; these numbers support a decision.

**`content-visibility` ablation** — the causal result, and the reason the verdict credits it rather than chunking for re-layout:

| re-layout ms | naive | chunked, cv on | chunked, cv off |
|---|---|---|---|
| synthetic-500k | 103.1 | **15.1** | 141.3 |
| real-largest | 38.9 | **9.6** | 49.9 |

Without `content-visibility`, chunking is a **re-layout regression** — 1.37× slower than naive on the synthetic fixture, 1.28× on the real one. Initial render, by contrast, is unaffected by it (32.8 vs 35.1 ms), so that win is chunking's alone.

**Chunk-size sweep**, synthetic fixture. There is no free setting:

| budget (chars) | extra pages | render ms | re-layout ms | seek cpu p95 |
|---|---|---|---|---|
| 3 000 | +45.0% | 27.4 | 12.3 | 4.3 |
| 8 000 | +15.6% | 31.4 | 15.4 | 6.9 |
| 20 000 | +4.1% | 37.8 | 20.2 | 15.8 |
| 60 000 | +1.8% | 68.9 | 47.1 | 45.3 (max) |

### What chunking costs

- **+15.6% pages** on the synthetic fixture, +7.9% on the real one — the forced page break at every chunk boundary.
- **The page count at first paint is an estimate**, off by −1.6% (synthetic) and −11.5% (real), and it shifts as chunks are measured. The reader's page numbers and progress bar move under them. This is the least visible cost in the timings and probably the most felt one in use.
- **Worse seek p95** — 7.10 ms vs naive's 0.20 ms on cold chunks. Still ~2× under a frame at 8000 chars; not so at 20000+.
- **The memory advantage decays to nothing.** After a full seek pass, chunked holds 2864 nodes / 7596 layout objects against naive's 2999 / 8077 — essentially parity, because nothing is ever un-realized. Virtualization only pays while the reader has not yet been through the chapter. **Production needs chunk eviction; this prototype does not implement it and therefore has not measured it.**

## Implementation notes

### Chunk-boundary strategy

Derived from the real section (571 top-level blocks, 552 `<p>`, max nesting depth 5), not from theory.

- **Split only between top-level children.** Depth-1 boundaries cover ~99% of a real section; descending further is not worth the complexity.
- **An element larger than one chunk is emitted whole, never descended into.** This fires on the first real book: Lydia's letter in `item8` is a single `<p>` of 10,142 characters (median `<p>` is 209, p95 is 854 — a ~50× outlier tail). Descending would put a chunk boundary mid-paragraph, restarting justification in a new formatting context mid-sentence. One chunk at ~1.25× budget is the cheaper defect. At an 8000-char budget the real section yields exactly 1 oversized chunk; at 3000 it yields 6.
- **Never end a chunk on a heading or `<hr>`.** The boundary is a forced page break, so a trailing heading is an orphan. Defer it to the next chunk.
- **Atomic — never split inside:** `table`, `pre`, `ol`, `ul`, `dl`, `figure`, `blockquote`, `svg`, `math`. Splitting restates row alignment, list numbering, or preformatted whitespace in a second formatting context.
- **Bare top-level text nodes** are glued to the open chunk; whitespace-only ones are dropped.

### Correctness checks the benchmark runs

Rendered `textContent` is compared byte-for-byte between strategies (modulo collapsed inter-block whitespace), and every chunk box is checked for column overflow. A pagination strategy that silently clips text would otherwise benchmark extremely well.

## Gotchas

- **`content-visibility: auto` applies layout containment, and a layout-contained box cannot fragment across columns.** This invalidates the literal form of the plan's bet. Measured directly: six blocks in one 400×300 column flow occupy **50 columns** plain and **6 columns** with `content-visibility: auto` — one column each, the rest of every block's text clipped away. Chunks-as-blocks-in-a-shared-flow does not render correctly at all, so it cannot be compared against a control.
- **The obvious repair also fails: a fragmented element has no usable height.** `getBoundingClientRect().height` on a column-fragmented element returns the column height, not its extent through the flow — so an off-screen chunk cannot be swapped for a correctly sized spacer. There is no height to give it. Hence the absolutely-positioned per-chunk contexts.
- **Empty inline elements return empty `getClientRects()`.** `item8` carries 114 zero-width page-anchor spans (`<span class="x-ebookmaker-pageno"><a id="page_357"></a></span>`) mid-paragraph. Any `Range`-based page-boundary or position lookup must length-check every rect list rather than assume geometry exists. Whitespace-only text nodes hit the same guard.
- **XHTML self-closing non-void tags are a correctness trap in an HTML context.** `<a id="CHAPTER_XLVIII"/>` appears 13 times in `item8`; an HTML parser ignores the slash, so injecting the raw markup as `innerHTML` lets that anchor swallow the entire rest of the section. Normalize to `<a …></a>` **before** chunking — otherwise the DOM being chunked is not the DOM the author wrote.
- **In this corpus, image policy is text policy.** Gutenberg's ebookmaker sets each chapter's drop cap as `<img alt="T">` inside `<span class="letra">`. A naive image strip silently deletes the first letter of all 13 chapters ("HE whole party were in hopes…"). Substitute `alt` back as a text node.
- **Double-rAF page-turn timing is frame-quantized and proves nothing.** Every strategy reads 16.7–16.8 ms because that is the frame interval. Real separation lives only in the CPU measure (`goToPage` → forced layout read).
- **`performance.memory.usedJSHeapSize` measures the wrong thing here.** It is the JS heap only — it excludes the layout tree, style cache, paint and GPU memory, i.e. exactly what the columnizer holds. Chunked's heap reads *larger* (4.5 vs 1.9 MB) purely because the splitter retains chunk HTML as strings. CDP `LayoutObjects` and DOM node counts are the closer proxies. `LayoutDuration`/`RecalcStyleDuration` in `results.json` are cumulative process totals since `Performance.enable`, not per-measure figures.
- **The 500KB fixture is synthetic** — no real corpus section approaches it. The largest across four books is 187KB, and longer books chunk *more* aggressively, not less (War and Peace: 1.8MB → 368 sections, largest 48KB). Its paragraph-length distribution is more uniform than the real section's, which is why the oversized-element case shows up in `real-largest` and not in the synthetic one at 8000 chars.

## Open for M2-3

- **Chunk eviction** — unmeasured, and the thing that decides whether the memory claim survives a reading session.
- **Estimated-page-count churn** — the reader-visible cost the timings do not price.
- Single machine, single OS, single browser. Safari and Firefox fragmentation behaviour under containment is unverified.
