# Graph Report - wolfyReader  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1046 nodes · 1960 edges · 62 communities (57 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b6d8c7b0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Paginator
- epub/index.ts
- ReaderImpl
- resources.ts
- zip/index.ts
- sanitize.ts
- make-bench-fixture.mjs
- matcher.ts
- harness.js
- reader/index.ts
- position.ts
- compilerOptions
- make-epub-fixtures.mjs
- package.json
- appearance.ts
- view/index.ts
- run.mjs
- layout.test.ts
- Branch A — New work (intake + scaffold)
- core/index.ts
- Feature Workflow
- AGENTS.md
- View domain
- input.browser.mjs
- check-core-purity.mjs
- make-zip-fixtures.mjs
- frame.ts
- appearance.browser.mjs
- Layout domain
- BookError
- view.browser.mjs
- core/source.ts
- decorations.browser.mjs
- imagezoom.browser.mjs
- Describe-project skill
- Coding Conventions
- Implement skill
- core.test.ts
- ImageZoom
- reader.browser.mjs
- selection.browser.mjs
- architecture.md
- Search domain
- layout.browser.mjs
- search.browser.mjs
- serve-demo.mjs
- epub-corpus.test.ts
- Appearance domain
- EPUB domain
- wolfyReader
- Architecture
- Core domain
- Position domain
- ZIP domain
- fetch-corpus.mjs
- Tooling domain
- {{PROJECT_NAME}}
- ContentHost
- layout/index.ts
- Position

## God Nodes (most connected - your core abstractions)
1. `ReaderImpl` - 45 edges
2. `Paginator` - 39 edges
3. `ContentHost` - 31 edges
4. `Section` - 18 edges
5. `Position` - 18 edges
6. `compilerOptions` - 18 edges
7. `Reader` - 16 edges
8. `Book` - 15 edges
9. `ResourceRegistry` - 14 edges
10. `capturePosition()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `values()` --calls--> `findCssReferences()`  [EXTRACTED]
  test/view.test.ts → src/view/css.ts
- `replaceAll()` --calls--> `rewriteCssReferences()`  [EXTRACTED]
  test/view.test.ts → src/view/css.ts
- `SelectionEvent` --references--> `Position`  [EXTRACTED]
  src/reader/index.ts → src/core/position.ts
- `assertRoundTrip()` --calls--> `parsePosition()`  [EXTRACTED]
  test/position.test.ts → src/core/position.ts
- `assertRoundTrip()` --calls--> `serializePosition()`  [EXTRACTED]
  test/position.test.ts → src/core/position.ts

## Import Cycles
- None detected.

## Communities (62 total, 5 thin omitted)

### Community 0 - "Paginator"
Cohesion: 0.14
Nodes (4): clamp(), Paginator, PaginateOptions, PaginationState

### Community 1 - "epub/index.ts"
Cohesion: 0.10
Nodes (45): decodeSegment(), directoryOf(), HrefTarget, resolveHref(), asZipSource(), bridged(), buildBook(), buildToc() (+37 more)

### Community 3 - "resources.ts"
Cohesion: 0.09
Nodes (32): CssReference, CssReferenceKind, escapeCssUrl(), findCssReferences(), isIdentChar(), matchesAt(), readReference(), readString() (+24 more)

### Community 4 - "zip/index.ts"
Cohesion: 0.12
Nodes (31): CentralRecord, parseCentralDirectory(), CentralDirectoryLocation, findEocd(), locateCentralDirectory(), readZip64(), toSafeNumber(), ZipEncryptedEntryError (+23 more)

### Community 5 - "sanitize.ts"
Cohesion: 0.10
Nodes (28): CELL, GRADIENT, HTML_DISCARDED, HTML_ELEMENTS, HTML_GLOBAL_ATTRIBUTES, HTML_NAMESPACE, isAllowedReference(), LINK_SCHEMES (+20 more)

### Community 6 - "make-bench-fixture.mjs"
Cohesion: 0.09
Nodes (27): allowedAttributes, altTextOf(), buildSynthetic(), corpusDir, cursorOver(), droppedElements, escapeText(), forbiddenPatterns (+19 more)

### Community 7 - "matcher.ts"
Cohesion: 0.14
Nodes (23): decodeEntities(), decodeSectionBytes(), extractSectionText(), extractText(), findEndTag(), NAMED, SKIP, tagName() (+15 more)

### Community 8 - "harness.js"
Cohesion: 0.13
Nodes (20): exactPageCount(), forceLayout(), nextPaint(), positions(), quantiles(), relayout(), seeks(), setup() (+12 more)

### Community 9 - "reader/index.ts"
Cohesion: 0.10
Nodes (25): decodeFragment(), GoToTarget, isPosition(), lastSegment(), LinkClick, ReaderError, ReaderEvent, ReaderEventHandler (+17 more)

### Community 10 - "position.ts"
Cohesion: 0.12
Nodes (24): capturePosition(), CapturePositionOptions, codeUnitOffsetToGraphemeIndex(), contextScore(), findGraphemeOccurrences(), Grapheme, graphemeSegmenter(), graphemeSegmenters (+16 more)

### Community 11 - "compilerOptions"
Cohesion: 0.08
Nodes (25): dom, dom.iterable, es2022, node, src, test, compilerOptions, allowImportingTsExtensions (+17 more)

### Community 12 - "make-epub-fixtures.mjs"
Cohesion: 0.09
Nodes (18): buildZip(), chapterStub, epub2Entries, epub3Entries, hostileEntries, hostileVectors, makePng(), makeSolidPng() (+10 more)

### Community 13 - "package.json"
Cohesion: 0.09
Nodes (22): author, description, devDependencies, playwright, @types/node, typescript, playwright, license (+14 more)

### Community 14 - "appearance.ts"
Cohesion: 0.19
Nodes (19): Appearance, declarations(), DEFAULT_DARK, DEFAULT_LIGHT, forcedRoot(), isReflowingUpdate(), mergeAppearance(), normalizeVarName() (+11 more)

### Community 15 - "view/index.ts"
Cohesion: 0.20
Nodes (17): ContentHostError, Pending, RenderReport, ViolationReport, asFrameMessage(), asHostMessage(), asPaginateOptions(), asPaginationState() (+9 more)

### Community 16 - "run.mjs"
Cohesion: 0.17
Nodes (19): benchDir, fmt(), fmtSpread(), main(), measureOnce(), median(), metricsToObject(), pad() (+11 more)

### Community 17 - "layout.test.ts"
Cohesion: 0.15
Nodes (15): ATOMIC, Chunk, chunkElement(), ChunkNode, chunkNodes(), ChunkResult, ChunkStats, DEFAULT_CHUNK_CHARS (+7 more)

### Community 18 - "Branch A — New work (intake + scaffold)"
Cohesion: 0.11
Nodes (18): A1 — Load durable context, A2 — Classify, A3 — Detect conflicts, A4 — Ask clarifying questions (if needed), A5 — Emit the structured summary, A6 — Scaffold artifacts, A7 — Report, Analyze skill (+10 more)

### Community 19 - "core/index.ts"
Cohesion: 0.25
Nodes (9): Book, BookMetadata, ReadingDirection, Resource, TocItem, BookFormat, FormatContext, OpenOptions (+1 more)

### Community 20 - "Feature Workflow"
Cohesion: 0.11
Nodes (18): Always-approval triggers, Anti-goals, Committing, Completing a task, Complexity levels, Context review (Level 2+), Default process, Domain doc shape (+10 more)

### Community 21 - "AGENTS.md"
Cohesion: 0.15
Nodes (9): Complexity levels, Core rules, Knowledge graph — query it first to save tokens, Project-specific guidance, Response style for Level 2+ work, Anti-pattern template, Pattern name, Pattern template (+1 more)

### Community 22 - "View domain"
Cohesion: 0.12
Nodes (17): Decorations (draw-only), Gotchas, Human input — keyboard, swipe, tap zones (T003), Image handling and tap-to-zoom, Key decisions, Known gaps, Overview, Parse, normalize and sanitize — one pass (+9 more)

### Community 23 - "input.browser.mjs"
Cohesion: 0.15
Nodes (14): afterGesture(), browserDir, contentFrame(), corpusBook, corpusDir, fixtureDir, openBook(), openReader() (+6 more)

### Community 24 - "check-core-purity.mjs"
Cohesion: 0.15
Nodes (14): blankComments(), chainOf(), entry, failures, forbiddenRoots, isFile(), label(), parents (+6 more)

### Community 25 - "make-zip-fixtures.mjs"
Cohesion: 0.15
Nodes (14): alpha, buildZip(), contentDir, dataBin, fakeEncryptedPayload, lorem, loremLines, outDir (+6 more)

### Community 26 - "frame.ts"
Cohesion: 0.15
Nodes (15): assembleChunkedBody(), assembleFrameDocument(), CHUNK_CLASS, CHUNK_END_ATTR, CHUNK_INDEX_ATTR, CHUNK_START_ATTR, ChunkPart, CONTENT_ROOT_ID (+7 more)

### Community 27 - "appearance.browser.mjs"
Cohesion: 0.17
Nodes (11): browserDir, chunkColumnWidth(), contentFrame(), corpusDir, fixtureDir, HOSTILE_CSS, PLAIN, repoRoot (+3 more)

### Community 28 - "Layout domain"
Cohesion: 0.14
Nodes (14): Architecture, Chunk-boundary strategy, Correctness checks, Cross-browser status, Estimated-page-count churn (resolved — now documented and surfaced), Eviction (resolved — was "unmeasured" in the prototype), Gotchas, Implementation notes (+6 more)

### Community 29 - "BookError"
Cohesion: 0.23
Nodes (8): BookError, CorruptContainerError, EncryptedContentError, UnrecognizedFormatError, open(), fixture(), openFixture(), PNG_MAGIC

### Community 30 - "view.browser.mjs"
Cohesion: 0.18
Nodes (8): browserDir, contentFrame(), corpusDir, fixtureDir, probes, renderSection(), renderSynthetic(), repoRoot

### Community 31 - "core/source.ts"
Cohesion: 0.24
Nodes (8): ByteSource, fromBlob(), fromBytes(), fromRangeReader(), isRangeReader(), RangeRead, RangeReader, toByteSource()

### Community 32 - "decorations.browser.mjs"
Cohesion: 0.24
Nodes (8): anchorOnPage(), browserDir, contentFrame(), fixtureDir, frameSectionText(), overlayBoxes(), phraseRect(), repoRoot

### Community 33 - "imagezoom.browser.mjs"
Cohesion: 0.24
Nodes (11): browserDir, contentFrame(), fixtureDir, imageBox(), openBook(), openReader(), overlayState(), repoRoot (+3 more)

### Community 34 - "Describe-project skill"
Cohesion: 0.18
Nodes (10): Describe-project skill, Hard rules, Stack categories by project type, Step 1 — Gather project info, Step 2 — Patch `docs/architecture.md`, Step 3 — Render `README.md` from `README.template.md`, Step 4 — Rewrite the AGENTS.md "Project-specific guidance" section, Step 5 — Append stack-specific `.gitignore` entries (+2 more)

### Community 35 - "Coding Conventions"
Cohesion: 0.18
Nodes (11): Coding Conventions, Comments, Commits, Demonstrating, Dependencies, Documentation, General, Language & framework specifics (+3 more)

### Community 36 - "Implement skill"
Cohesion: 0.20
Nodes (10): Hard rules, Implement skill, Step 1 — Identify the target, Step 2 — Load context, Step 3 — Re-check conflicts, Step 4 — Execute, Step 5 — Verify, Step 6 — Close out (+2 more)

### Community 37 - "core.test.ts"
Cohesion: 0.22
Nodes (9): BookInput, inputShapes, makeBook(), payload, stubBytes, stubFormat, StubPayload, StubTocItem (+1 more)

### Community 39 - "reader.browser.mjs"
Cohesion: 0.22
Nodes (7): browserDir, corpusBook, corpusDir, fixtureDir, openBook(), openReader(), repoRoot

### Community 40 - "selection.browser.mjs"
Cohesion: 0.24
Nodes (7): browserDir, contentFrame(), events(), fixtureDir, repoRoot, selectRange(), waitForSelection()

### Community 42 - "Search domain"
Cohesion: 0.22
Nodes (9): Do not route the whole-book scan through the frame, Extraction anchors into the same text the frame measures, Gotchas, Highlighting a hit rides the same anchor as the jump, Implementation notes, Key decisions, Normalization policy, Overview (+1 more)

### Community 43 - "layout.browser.mjs"
Cohesion: 0.22
Nodes (5): browserDir, corpusBook, corpusDir, fixtureDir, repoRoot

### Community 44 - "search.browser.mjs"
Cohesion: 0.25
Nodes (7): browserDir, contentFrame(), corpusBook, corpusDir, fixtureDir, overlayBoxes(), repoRoot

### Community 45 - "serve-demo.mjs"
Cohesion: 0.36
Nodes (7): contentTypes, demoMounts, listen(), makeHandler(), notFound(), repoRoot, startServer()

### Community 46 - "epub-corpus.test.ts"
Cohesion: 0.25
Nodes (3): corpusDir, countToc(), testsuiteDir

### Community 47 - "Appearance domain"
Cohesion: 0.29
Nodes (7): Appearance domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns, The reflow path — position preserved by content anchor

### Community 48 - "EPUB domain"
Cohesion: 0.29
Nodes (6): EPUB domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns

### Community 49 - "wolfyReader"
Cohesion: 0.29
Nodes (7): Getting Started, Knowledge graph, Overview, Running Locally, Stack, wolfyReader, Working with AI agents

### Community 50 - "Architecture"
Cohesion: 0.33
Nodes (6): Architecture, Current stack, Important boundaries, Known constraints, Main application areas, Purpose

### Community 51 - "Core domain"
Cohesion: 0.33
Nodes (5): Core domain, Gotchas, Implementation notes, Key decisions, Overview

### Community 52 - "Position domain"
Cohesion: 0.33
Nodes (5): Gotchas, Implementation notes, Key decisions, Overview, Position domain

### Community 53 - "ZIP domain"
Cohesion: 0.33
Nodes (5): Gotchas, Implementation notes, Key decisions, Overview, ZIP domain

### Community 54 - "fetch-corpus.mjs"
Cohesion: 0.33
Nodes (3): corpusDir, downloads, W3C_TESTS

### Community 55 - "Tooling domain"
Cohesion: 0.40
Nodes (5): Gotchas, Implementation notes, Key decisions, Overview, Tooling domain

### Community 56 - "{{PROJECT_NAME}}"
Cohesion: 0.40
Nodes (5): Knowledge graph, Overview, {{PROJECT_NAME}}, Stack, Working with AI agents

### Community 60 - "layout/index.ts"
Cohesion: 0.10
Nodes (9): BookProgress, ChapterProgress, GRAPHEME_SEGMENTER, PaginateRequest, PaginatorDiagnostics, PaginatorError, Reader, ContentHostOptions (+1 more)

## Knowledge Gaps
- **338 isolated node(s):** `PaginatorDiagnostics`, `GuideReference`, `MutableElement`, `Grapheme`, `SerialPayload` (+333 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Section` connect `ContentHost` to `Paginator`, `epub/index.ts`, `ReaderImpl`, `matcher.ts`, `reader/index.ts`, `view/index.ts`, `core/index.ts`, `layout/index.ts`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `Paginator` connect `Paginator` to `ReaderImpl`, `reader/index.ts`, `ContentHost`, `layout/index.ts`, `Position`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `ReaderImpl` connect `ReaderImpl` to `Paginator`, `matcher.ts`, `reader/index.ts`, `appearance.ts`, `core/index.ts`, `ContentHost`, `layout/index.ts`, `Position`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **What connects `PaginatorDiagnostics`, `GuideReference`, `MutableElement` to the rest of the system?**
  _338 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Paginator` be split into smaller, more focused modules?**
  _Cohesion score 0.14193548387096774 - nodes in this community are weakly interconnected._
- **Should `epub/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1013277428371768 - nodes in this community are weakly interconnected._
- **Should `resources.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09308510638297872 - nodes in this community are weakly interconnected._