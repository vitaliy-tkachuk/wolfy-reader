# Graph Report - wolfy-reader  (2026-09-16)

## Corpus Check
- 118 files · ~153,062 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1277 nodes · 2435 edges · 80 communities (77 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `05d20704`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Paginator
- epub/index.ts
- ReaderImpl
- ContentHost
- zip/index.ts
- check-pack.mjs
- make-bench-fixture.mjs
- reader/index.ts
- harness.js
- Formats domain
- resources.ts
- compilerOptions
- make-epub-fixtures.mjs
- package.json
- ImageZoom
- core/index.ts
- run.mjs
- chunk.ts
- Branch A — New work (intake + scaffold)
- exports
- Feature Workflow
- compilerOptions
- View domain
- input.browser.mjs
- check-core-purity.mjs
- make-zip-fixtures.mjs
- sanitize.ts
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
- position.test.ts
- open
- view/index.ts
- selection.browser.mjs
- host.ts
- Search domain
- layout.browser.mjs
- search.browser.mjs
- serve-demo.mjs
- epub-corpus.test.ts
- Appearance domain
- EPUB domain
- wolfy-reader
- Architecture
- Core domain
- Position domain
- ZIP domain
- fetch-corpus.mjs
- Tooling domain
- {{PROJECT_NAME}}
- view.test.ts
- frame.ts
- tts.browser.mjs
- Testing domain
- extract.ts
- differential.test.ts
- reader.browser.mjs
- position-segmentation-perf.test.ts
- a11y.browser.mjs
- reading-text.ts
- core.test.ts
- Section
- AGENTS.md
- patterns.md
- scripts
- devDependencies
- keywords
- Release domain
- files
- repository

## God Nodes (most connected - your core abstractions)
1. `ReaderImpl` - 50 edges
2. `Paginator` - 40 edges
3. `ContentHost` - 30 edges
4. `Section` - 24 edges
5. `Book` - 21 edges
6. `Position` - 18 edges
7. `attribute()` - 18 edges
8. `compilerOptions` - 18 edges
9. `Reader` - 17 edges
10. `startServer()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `decode()` --calls--> `open()`  [EXTRACTED]
  test/differential.test.ts → src/core/open.ts
- `openFixture()` --calls--> `open()`  [EXTRACTED]
  test/epub.test.ts → src/core/open.ts
- `openFb2()` --calls--> `open()`  [EXTRACTED]
  test/fb2.test.ts → src/core/open.ts
- `openText()` --calls--> `open()`  [EXTRACTED]
  test/text.test.ts → src/core/open.ts
- `values()` --calls--> `findCssReferences()`  [EXTRACTED]
  test/view.test.ts → src/view/css.ts

## Import Cycles
- None detected.

## Communities (80 total, 3 thin omitted)

### Community 0 - "Paginator"
Cohesion: 0.06
Nodes (42): codeUnitOffsetToGraphemeIndex(), countGraphemes(), Grapheme, graphemeIndexToCodeUnitOffset(), graphemeSegmenter, segmentGraphemes(), CapturePositionOptions, captureSegmented() (+34 more)

### Community 1 - "epub/index.ts"
Cohesion: 0.06
Nodes (75): Resource, TocItem, sectionLookup(), collapseWhitespace(), escapeXmlAttribute(), escapeXmlText(), decodeSegment(), directoryOf() (+67 more)

### Community 2 - "ReaderImpl"
Cohesion: 0.09
Nodes (6): SentenceRange, lastSegment(), Reader, ReaderImpl, stripExtension(), LayoutMode

### Community 4 - "zip/index.ts"
Cohesion: 0.11
Nodes (35): CentralRecord, parseCentralDirectory(), crc32(), TABLE, CentralDirectoryLocation, findEocd(), locateCentralDirectory(), readZip64() (+27 more)

### Community 5 - "check-pack.mjs"
Cohesion: 0.14
Nodes (20): attribution, banner, entryFiles(), manifest, manifestPath, repo, repoRoot, checkManifest() (+12 more)

### Community 6 - "make-bench-fixture.mjs"
Cohesion: 0.09
Nodes (27): allowedAttributes, altTextOf(), buildSynthetic(), corpusDir, cursorOver(), droppedElements, escapeText(), forbiddenPatterns (+19 more)

### Community 7 - "reader/index.ts"
Cohesion: 0.08
Nodes (36): capturePosition(), decodeFragment(), GoToTarget, isPosition(), LinkClick, ReaderError, ReaderEvent, ReaderEventHandler (+28 more)

### Community 8 - "harness.js"
Cohesion: 0.12
Nodes (20): exactPageCount(), forceLayout(), nextPaint(), positions(), quantiles(), relayout(), seeks(), setup() (+12 more)

### Community 9 - "Formats domain"
Cohesion: 0.25
Nodes (7): FB2 (FictionBook 2), Formats domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns

### Community 10 - "resources.ts"
Cohesion: 0.20
Nodes (11): baseMediaType(), classifyReference(), isServableResource(), decodeText(), XLINK_NAMESPACE, applyResources(), applySvgReference(), NO_ANCESTORS (+3 more)

### Community 11 - "compilerOptions"
Cohesion: 0.08
Nodes (25): dom, dom.iterable, es2022, node, test, compilerOptions, allowImportingTsExtensions, exactOptionalPropertyTypes (+17 more)

### Community 12 - "make-epub-fixtures.mjs"
Cohesion: 0.09
Nodes (18): buildZip(), chapterStub, epub2Entries, epub3Entries, hostileEntries, hostileVectors, makePng(), makeSolidPng() (+10 more)

### Community 13 - "package.json"
Cohesion: 0.15
Nodes (12): author, bugs, url, description, homepage, license, main, name (+4 more)

### Community 15 - "core/index.ts"
Cohesion: 0.26
Nodes (9): Book, BookMetadata, ReadingDirection, SectionRef, BookFormat, FormatContext, OpenOptions, BookInput (+1 more)

### Community 16 - "run.mjs"
Cohesion: 0.17
Nodes (19): benchDir, fmt(), fmtSpread(), main(), measureOnce(), median(), metricsToObject(), pad() (+11 more)

### Community 17 - "chunk.ts"
Cohesion: 0.19
Nodes (9): ATOMIC, Chunk, chunkElement(), ChunkNode, chunkNodes(), ChunkResult, ChunkStats, DEFAULT_CHUNK_CHARS (+1 more)

### Community 18 - "Branch A — New work (intake + scaffold)"
Cohesion: 0.11
Nodes (18): A1 — Load durable context, A2 — Classify, A3 — Detect conflicts, A4 — Ask clarifying questions (if needed), A5 — Emit the structured summary, A6 — Scaffold artifacts, A7 — Report, Analyze skill (+10 more)

### Community 19 - "exports"
Cohesion: 0.14
Nodes (14): default, types, default, types, exports, ./core, ./epub, ./fb2 (+6 more)

### Community 20 - "Feature Workflow"
Cohesion: 0.11
Nodes (18): Always-approval triggers, Anti-goals, Committing, Completing a task, Complexity levels, Context review (Level 2+), Default process, Domain doc shape (+10 more)

### Community 21 - "compilerOptions"
Cohesion: 0.15
Nodes (12): ./tsconfig.json, compilerOptions, declaration, declarationMap, noEmit, outDir, removeComments, rootDir (+4 more)

### Community 22 - "View domain"
Cohesion: 0.11
Nodes (19): Accessibility (T002 — the pointer-free contract), Decorations (draw-only), Gotchas, Human input — keyboard, swipe, tap zones (T003), Image handling and tap-to-zoom, Key decisions, Known gaps, Overview (+11 more)

### Community 23 - "input.browser.mjs"
Cohesion: 0.15
Nodes (15): afterGesture(), browserDir, contentFrame(), corpusBook, corpusDir, fixtureDir, openBook(), openReader() (+7 more)

### Community 24 - "check-core-purity.mjs"
Cohesion: 0.15
Nodes (14): blankComments(), chainOf(), entry, failures, forbiddenRoots, isFile(), label(), parents (+6 more)

### Community 25 - "make-zip-fixtures.mjs"
Cohesion: 0.15
Nodes (14): alpha, buildZip(), contentDir, dataBin, fakeEncryptedPayload, lorem, loremLines, outDir (+6 more)

### Community 26 - "sanitize.ts"
Cohesion: 0.11
Nodes (25): CELL, GRADIENT, HTML_ELEMENTS, HTML_GLOBAL_ATTRIBUTES, HTML_NAMESPACE, isAllowedReference(), LINK_SCHEMES, MEDIA_SCHEMES (+17 more)

### Community 27 - "appearance.browser.mjs"
Cohesion: 0.12
Nodes (19): allSectionText(), browserDir, chunkColumnWidth(), contentFrame(), CORPUS_BOOKS, corpusDir, corpusPresent, fixtureDir (+11 more)

### Community 28 - "Layout domain"
Cohesion: 0.14
Nodes (14): Architecture, Chunk-boundary strategy, Correctness checks, Cross-browser status, Estimated-page-count churn (resolved — now documented and surfaced), Eviction (resolved — was "unmeasured" in the prototype), Gotchas, Implementation notes (+6 more)

### Community 29 - "BookError"
Cohesion: 0.24
Nodes (7): BookError, CorruptContainerError, EncryptedContentError, UnrecognizedFormatError, fixture(), openFixture(), PNG_MAGIC

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
Cohesion: 0.13
Nodes (12): Hard rules, Implement skill, Step 1 — Identify the target, Step 2 — Load context, Step 3 — Re-check conflicts, Step 4 — Execute, Step 5 — Verify, Step 6 — Close out (+4 more)

### Community 38 - "open"
Cohesion: 0.21
Nodes (9): open(), epub, fb2, text, decode(), openFb2(), corpusDir, openText() (+1 more)

### Community 39 - "view/index.ts"
Cohesion: 0.16
Nodes (24): ReaderOptions, Appearance, declarations(), DEFAULT_DARK, DEFAULT_LIGHT, forcedRoot(), isReflowingUpdate(), mergeAppearance() (+16 more)

### Community 40 - "selection.browser.mjs"
Cohesion: 0.24
Nodes (7): browserDir, contentFrame(), events(), fixtureDir, repoRoot, selectRange(), waitForSelection()

### Community 41 - "host.ts"
Cohesion: 0.18
Nodes (16): ContentHostError, Pending, RenderReport, SectionRenderCache, asFrameMessage(), asHostMessage(), asPaginateOptions(), asPaginationState() (+8 more)

### Community 42 - "Search domain"
Cohesion: 0.22
Nodes (9): Do not route the whole-book scan through the frame, Gotchas, Highlighting a hit rides the same anchor as the jump, Implementation notes, Key decisions, Normalization policy, One canonical reading text, shared by capture and resolution (2026-08-26), Overview (+1 more)

### Community 43 - "layout.browser.mjs"
Cohesion: 0.22
Nodes (7): browserDir, corpusBook, corpusDir, fixtureDir, imageSection(), longSection(), repoRoot

### Community 44 - "search.browser.mjs"
Cohesion: 0.25
Nodes (7): browserDir, contentFrame(), corpusBook, corpusDir, fixtureDir, overlayBoxes(), repoRoot

### Community 45 - "serve-demo.mjs"
Cohesion: 0.21
Nodes (10): contentTypes, demoMounts, listen(), makeHandler(), notFound(), repoRoot, startServer(), browserDir (+2 more)

### Community 46 - "epub-corpus.test.ts"
Cohesion: 0.22
Nodes (4): corpusDir, countToc(), testsuiteDir, html()

### Community 47 - "Appearance domain"
Cohesion: 0.25
Nodes (8): Appearance domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns, The position-preserving invariant (tested), The reflow path — position preserved by content anchor

### Community 48 - "EPUB domain"
Cohesion: 0.33
Nodes (6): EPUB domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns

### Community 49 - "wolfy-reader"
Cohesion: 0.25
Nodes (8): Getting Started, Knowledge graph, Overview, Running Locally, Setup on a new machine, Stack, wolfy-reader, Working with AI agents

### Community 50 - "Architecture"
Cohesion: 0.33
Nodes (6): Architecture, Current stack, Important boundaries, Known constraints, Main application areas, Purpose

### Community 51 - "Core domain"
Cohesion: 0.40
Nodes (5): Core domain, Gotchas, Implementation notes, Key decisions, Overview

### Community 52 - "Position domain"
Cohesion: 0.40
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

### Community 57 - "view.test.ts"
Cohesion: 0.19
Nodes (17): CssReference, CssReferenceKind, escapeCssUrl(), findCssReferences(), isIdentChar(), matchesAt(), readReference(), readString() (+9 more)

### Community 59 - "frame.ts"
Cohesion: 0.16
Nodes (13): assembleChunkedBody(), assembleFrameDocument(), CHUNK_CLASS, CHUNK_END_ATTR, CHUNK_INDEX_ATTR, CHUNK_START_ATTR, ChunkPart, CONTENT_ROOT_ID (+5 more)

### Community 61 - "tts.browser.mjs"
Cohesion: 0.40
Nodes (5): boxCount(), browserDir, contentFrame(), fixtureDir, repoRoot

### Community 62 - "Testing domain"
Cohesion: 0.29
Nodes (6): Gotchas, Implementation notes, Key decisions, Overview, Patterns, Testing domain

### Community 63 - "extract.ts"
Cohesion: 0.26
Nodes (12): imageReadingText(), attributeOf(), decodeEntities(), endsTagName(), extractText(), findEndTag(), NAMED, P_CLOSERS (+4 more)

### Community 64 - "differential.test.ts"
Cohesion: 0.21
Nodes (11): corpusDir, FORMAT_BY_EXT, formats, normalizedBody(), pairs, testsuiteDir, differentialScore(), extractBookText() (+3 more)

### Community 65 - "reader.browser.mjs"
Cohesion: 0.20
Nodes (9): browserDir, contentFrame(), corpusBook, corpusDir, fixtureDir, frameScrolls(), openBook(), openReader() (+1 more)

### Community 66 - "position-segmentation-perf.test.ts"
Cohesion: 0.33
Nodes (5): CountingSegmenter, graphemeSlice(), meter, sentenceTexts, TEXT

### Community 67 - "a11y.browser.mjs"
Cohesion: 0.29
Nodes (3): browserDir, fixtureDir, repoRoot

### Community 68 - "reading-text.ts"
Cohesion: 0.23
Nodes (9): ClassifiedReference, DISCARDED_HTML_ELEMENTS, DISCARDED_SVG_ELEMENTS, FONT_TYPES, normalizeReference(), ReadingResolver, ReferenceKind, stripUrlWhitespace() (+1 more)

### Community 69 - "core.test.ts"
Cohesion: 0.25
Nodes (8): inputShapes, makeBook(), payload, stubBytes, stubFormat, StubPayload, StubTocItem, toTocItem()

### Community 70 - "Section"
Cohesion: 0.22
Nodes (3): Section, BuiltSection, createNonce()

### Community 71 - "AGENTS.md"
Cohesion: 0.33
Nodes (5): Complexity levels, Core rules, Knowledge graph — query it first to save tokens, Project-specific guidance, Response style for Level 2+ work

### Community 73 - "patterns.md"
Cohesion: 0.40
Nodes (4): Anti-pattern template, Pattern name, Pattern template, Patterns

### Community 74 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, bench, build, check:core, check:pack, clean, demo, fetch-corpus (+4 more)

### Community 76 - "devDependencies"
Cohesion: 0.22
Nodes (9): esbuild, devDependencies, esbuild, playwright, @types/node, typescript, playwright, @types/node (+1 more)

### Community 77 - "keywords"
Cohesion: 0.29
Nodes (7): keywords, browser, ebook, epub, fb2, pagination, reader

### Community 78 - "Release domain"
Cohesion: 0.40
Nodes (5): Gotchas, Implementation notes, Key decisions, Overview, Release domain

### Community 79 - "files"
Cohesion: 0.67
Nodes (3): files, src, dist

### Community 80 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **428 isolated node(s):** `strategies`, `viewport`, `benchDir`, `repoRoot`, `contentTypes` (+423 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Paginator` connect `Paginator` to `ReaderImpl`, `ContentHost`, `Section`, `reader/index.ts`, `harness.js`, `host.ts`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `Section` connect `Section` to `Paginator`, `epub/index.ts`, `ReaderImpl`, `ContentHost`, `reader/index.ts`, `host.ts`, `core/index.ts`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `ReaderImpl` connect `ReaderImpl` to `Paginator`, `Section`, `view/index.ts`, `reader/index.ts`, `core/index.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `strategies`, `viewport`, `benchDir` to the rest of the system?**
  _428 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Paginator` be split into smaller, more focused modules?**
  _Cohesion score 0.05844155844155844 - nodes in this community are weakly interconnected._
- **Should `epub/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06153846153846154 - nodes in this community are weakly interconnected._
- **Should `ReaderImpl` be split into smaller, more focused modules?**
  _Cohesion score 0.08590441621294616 - nodes in this community are weakly interconnected._