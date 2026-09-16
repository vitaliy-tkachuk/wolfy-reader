# Graph Report - wolfy-reader  (2026-09-17)

## Corpus Check
- 130 files · ~166,993 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1395 nodes · 2605 edges · 82 communities (78 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8fb65057`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ContentHost
- fb2/index.ts
- reader/index.ts
- ReaderImpl
- zip/index.ts
- check-pack.mjs
- make-bench-fixture.mjs
- extract.ts
- harness.js
- Formats domain
- guards.test.ts
- compilerOptions
- make-epub-fixtures.mjs
- package.json
- ImageZoom
- core/index.ts
- run.mjs
- Paginator
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
- react-entry.mjs
- view.browser.mjs
- react/index.ts
- decorations.browser.mjs
- imagezoom.browser.mjs
- Describe-project skill
- Coding Conventions
- Implement skill
- Reader
- differential.test.ts
- appearance.ts
- selection.browser.mjs
- Contributing
- Search domain
- devDependencies
- search.browser.mjs
- serve-demo.mjs
- view/index.ts
- Appearance domain
- EPUB domain
- position.ts
- Architecture
- Core domain
- Position domain
- ZIP domain
- check-guards.mjs
- Tooling domain
- chunk.ts
- layout.browser.mjs
- protocol.ts
- tts.browser.mjs
- Testing domain
- frame.ts
- react
- reader.browser.mjs
- position-segmentation-perf.test.ts
- peerDependenciesMeta
- 📖 wolfy-reader
- layout/index.ts
- React domain
- AGENTS.md
- Section
- patterns.md
- scripts
- release-please-config.json
- keywords
- Release domain
- files
- repository
- {{PROJECT_NAME}}
- a11y.browser.mjs

## God Nodes (most connected - your core abstractions)
1. `ReaderImpl` - 50 edges
2. `Paginator` - 40 edges
3. `ContentHost` - 30 edges
4. `Section` - 24 edges
5. `Book` - 19 edges
6. `Reader` - 18 edges
7. `Position` - 18 edges
8. `attribute()` - 18 edges
9. `compilerOptions` - 18 edges
10. `startServer()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `element()` --indirect_call--> `Reader()`  [INFERRED]
  test/browser/react-entry.mjs → src/react/index.ts
- `openFb2()` --calls--> `open()`  [EXTRACTED]
  test/fb2.test.ts → src/core/open.ts
- `openText()` --calls--> `open()`  [EXTRACTED]
  test/text.test.ts → src/core/open.ts
- `HookConsumer()` --calls--> `useReader()`  [EXTRACTED]
  test/browser/react-entry.mjs → src/react/index.ts
- `values()` --calls--> `findCssReferences()`  [EXTRACTED]
  test/view.test.ts → src/view/css.ts

## Import Cycles
- None detected.

## Communities (82 total, 4 thin omitted)

### Community 1 - "fb2/index.ts"
Cohesion: 0.07
Nodes (68): sectionLookup(), collapseWhitespace(), escapeXmlAttribute(), escapeXmlText(), decodeSegment(), directoryOf(), HrefTarget, resolveHref() (+60 more)

### Community 2 - "reader/index.ts"
Cohesion: 0.12
Nodes (19): decodeFragment(), GoToTarget, lastSegment(), ReaderError, ReaderEvent, ReaderEventHandler, ReaderEventMap, ReaderOptions (+11 more)

### Community 3 - "ReaderImpl"
Cohesion: 0.17
Nodes (3): isPosition(), ReaderImpl, NavIntent

### Community 4 - "zip/index.ts"
Cohesion: 0.10
Nodes (36): CentralRecord, parseCentralDirectory(), crc32(), TABLE, CentralDirectoryLocation, findEocd(), locateCentralDirectory(), readZip64() (+28 more)

### Community 5 - "check-pack.mjs"
Cohesion: 0.10
Nodes (30): attribution, banner, entryFiles(), manifest, manifestPath, repo, repoRoot, checkManifest() (+22 more)

### Community 6 - "make-bench-fixture.mjs"
Cohesion: 0.09
Nodes (27): allowedAttributes, altTextOf(), buildSynthetic(), corpusDir, cursorOver(), droppedElements, escapeText(), forbiddenPatterns (+19 more)

### Community 7 - "extract.ts"
Cohesion: 0.12
Nodes (27): decodeText(), attributeOf(), decodeEntities(), endsTagName(), extractSectionText(), extractText(), findEndTag(), NAMED (+19 more)

### Community 8 - "harness.js"
Cohesion: 0.13
Nodes (20): exactPageCount(), forceLayout(), nextPaint(), positions(), quantiles(), relayout(), seeks(), setup() (+12 more)

### Community 9 - "Formats domain"
Cohesion: 0.25
Nodes (7): FB2 (FictionBook 2), Formats domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns

### Community 10 - "guards.test.ts"
Cohesion: 0.17
Nodes (6): consumerTerm, corpusManifest, distBuilt, GuardRun, repoRoot, scriptsDir

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
Cohesion: 0.05
Nodes (52): Book, BookMetadata, ReadingDirection, Resource, SectionRef, TocItem, BookError, CorruptContainerError (+44 more)

### Community 16 - "run.mjs"
Cohesion: 0.17
Nodes (19): benchDir, fmt(), fmtSpread(), main(), measureOnce(), median(), metricsToObject(), pad() (+11 more)

### Community 17 - "Paginator"
Cohesion: 0.16
Nodes (4): clamp(), Paginator, PaginateOptions, PaginationState

### Community 18 - "Branch A — New work (intake + scaffold)"
Cohesion: 0.11
Nodes (18): A1 — Load durable context, A2 — Classify, A3 — Detect conflicts, A4 — Ask clarifying questions (if needed), A5 — Emit the structured summary, A6 — Scaffold artifacts, A7 — Report, Analyze skill (+10 more)

### Community 19 - "exports"
Cohesion: 0.12
Nodes (17): default, types, default, types, exports, ./core, ./epub, ./fb2 (+9 more)

### Community 20 - "Feature Workflow"
Cohesion: 0.11
Nodes (18): Always-approval triggers, Anti-goals, Committing, Completing a task, Complexity levels, Context review (Level 2+), Default process, Domain doc shape (+10 more)

### Community 21 - "compilerOptions"
Cohesion: 0.15
Nodes (12): ./tsconfig.json, compilerOptions, declaration, declarationMap, noEmit, outDir, removeComments, rootDir (+4 more)

### Community 22 - "View domain"
Cohesion: 0.11
Nodes (19): Accessibility — the pointer-free contract, Decorations (draw-only), Gotchas, Human input — keyboard, swipe, tap zones, Image handling and tap-to-zoom, Key decisions, Known gaps, Overview (+11 more)

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
Cohesion: 0.05
Nodes (62): baseMediaType(), ClassifiedReference, classifyReference(), DISCARDED_HTML_ELEMENTS, DISCARDED_SVG_ELEMENTS, FONT_TYPES, imageReadingText(), isServableResource() (+54 more)

### Community 27 - "appearance.browser.mjs"
Cohesion: 0.12
Nodes (19): allSectionText(), browserDir, chunkColumnWidth(), contentFrame(), CORPUS_BOOKS, corpusDir, corpusPresent, fixtureDir (+11 more)

### Community 28 - "Layout domain"
Cohesion: 0.14
Nodes (14): Architecture, Chunk-boundary strategy, Correctness checks, Cross-browser status, Estimated-page-count churn (resolved — now documented and surfaced), Eviction (resolved — was "unmeasured" in the prototype), Gotchas, Implementation notes (+6 more)

### Community 29 - "react-entry.mjs"
Cohesion: 0.18
Nodes (14): calls, element(), events, frames(), HookConsumer(), mount(), mountHook(), observe() (+6 more)

### Community 30 - "view.browser.mjs"
Cohesion: 0.18
Nodes (8): browserDir, contentFrame(), corpusDir, fixtureDir, probes, renderSection(), renderSynthetic(), repoRoot

### Community 31 - "react/index.ts"
Cohesion: 0.18
Nodes (15): APPEARANCE_KEYS, appearanceDiff(), MutableAppearance, Reader(), ReaderCallbacks, ReaderProps, sameRecord(), useReader() (+7 more)

### Community 32 - "decorations.browser.mjs"
Cohesion: 0.24
Nodes (8): anchorOnPage(), browserDir, contentFrame(), fixtureDir, frameSectionText(), overlayBoxes(), phraseRect(), repoRoot

### Community 33 - "imagezoom.browser.mjs"
Cohesion: 0.24
Nodes (11): browserDir, contentFrame(), fixtureDir, imageBox(), openBook(), openReader(), overlayState(), repoRoot (+3 more)

### Community 34 - "Describe-project skill"
Cohesion: 0.18
Nodes (10): Describe-project skill, Hard rules, Stack categories by project type, Step 1 — Gather project info, Step 2 — Patch `docs/architecture.md`, Step 3 — Render `README.md` from `docs/readme-template.md`, Step 4 — Rewrite the AGENTS.md "Project-specific guidance" section, Step 5 — Append stack-specific `.gitignore` entries (+2 more)

### Community 35 - "Coding Conventions"
Cohesion: 0.17
Nodes (11): Coding Conventions, Comments, Commits, Demonstrating, Dependencies, Documentation, General, Language & framework specifics (+3 more)

### Community 36 - "Implement skill"
Cohesion: 0.13
Nodes (12): Hard rules, Implement skill, Step 1 — Identify the target, Step 2 — Load context, Step 3 — Re-check conflicts, Step 4 — Execute, Step 5 — Verify, Step 6 — Close out (+4 more)

### Community 37 - "Reader"
Cohesion: 0.10
Nodes (4): SentenceRange, PaginateRequest, Reader, LayoutMode

### Community 38 - "differential.test.ts"
Cohesion: 0.19
Nodes (11): corpusDir, FORMAT_BY_EXT, formats, normalizedBody(), pairs, testsuiteDir, differentialScore(), extractBookText() (+3 more)

### Community 39 - "appearance.ts"
Cohesion: 0.19
Nodes (19): Appearance, declarations(), DEFAULT_DARK, DEFAULT_LIGHT, forcedRoot(), isReflowingUpdate(), mergeAppearance(), normalizeVarName() (+11 more)

### Community 40 - "selection.browser.mjs"
Cohesion: 0.24
Nodes (7): browserDir, contentFrame(), events(), fixtureDir, repoRoot, selectRange(), waitForSelection()

### Community 41 - "Contributing"
Cohesion: 0.22
Nodes (9): Checks, Contributing, Demo, Developing a consumer against source, Knowledge graph, Releasing, Setup on a new machine, Stack (+1 more)

### Community 42 - "Search domain"
Cohesion: 0.22
Nodes (9): Do not route the whole-book scan through the frame, Gotchas, Highlighting a hit rides the same anchor as the jump, Implementation notes, Key decisions, Normalization policy, One canonical reading text, shared by capture and resolution (2026-08-26), Overview (+1 more)

### Community 43 - "devDependencies"
Cohesion: 0.13
Nodes (15): esbuild, devDependencies, esbuild, playwright, react-dom, @types/node, @types/react, @types/react-dom (+7 more)

### Community 44 - "search.browser.mjs"
Cohesion: 0.25
Nodes (7): browserDir, contentFrame(), corpusBook, corpusDir, fixtureDir, overlayBoxes(), repoRoot

### Community 45 - "serve-demo.mjs"
Cohesion: 0.14
Nodes (13): contentTypes, demoMounts, listen(), makeHandler(), notFound(), repoRoot, startServer(), browserDir (+5 more)

### Community 46 - "view/index.ts"
Cohesion: 0.27
Nodes (11): ContentHostError, ContentHostOptions, Pending, RenderReport, SectionRenderCache, ViolationReport, FrameMessage, Measurement (+3 more)

### Community 47 - "Appearance domain"
Cohesion: 0.25
Nodes (8): Appearance domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns, The position-preserving invariant (tested), The reflow path — position preserved by content anchor

### Community 48 - "EPUB domain"
Cohesion: 0.33
Nodes (6): EPUB domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns

### Community 49 - "position.ts"
Cohesion: 0.15
Nodes (22): codeUnitOffsetToGraphemeIndex(), capturePosition(), CapturePositionOptions, captureSegmented(), collapseWhitespace(), endsOnSentenceTerminal(), isSerialPayload(), join() (+14 more)

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

### Community 54 - "check-guards.mjs"
Cohesion: 0.15
Nodes (20): checkCorpus(), checkDependencies(), checkPeers(), checkVocabulary(), CONSUMER_TERMS, exists(), fail(), label() (+12 more)

### Community 55 - "Tooling domain"
Cohesion: 0.40
Nodes (5): Gotchas, Implementation notes, Key decisions, Overview, Tooling domain

### Community 56 - "chunk.ts"
Cohesion: 0.19
Nodes (9): ATOMIC, Chunk, chunkElement(), ChunkNode, chunkNodes(), ChunkResult, ChunkStats, DEFAULT_CHUNK_CHARS (+1 more)

### Community 57 - "layout.browser.mjs"
Cohesion: 0.22
Nodes (7): browserDir, corpusBook, corpusDir, fixtureDir, imageSection(), longSection(), repoRoot

### Community 59 - "protocol.ts"
Cohesion: 0.39
Nodes (7): asFrameMessage(), asHostMessage(), asPaginateOptions(), asPaginationState(), asRecord(), HostMessage, PageAnchor

### Community 61 - "tts.browser.mjs"
Cohesion: 0.40
Nodes (5): boxCount(), browserDir, contentFrame(), fixtureDir, repoRoot

### Community 62 - "Testing domain"
Cohesion: 0.29
Nodes (6): Gotchas, Implementation notes, Key decisions, Overview, Patterns, Testing domain

### Community 63 - "frame.ts"
Cohesion: 0.15
Nodes (14): assembleChunkedBody(), assembleFrameDocument(), CHUNK_CLASS, CHUNK_END_ATTR, CHUNK_INDEX_ATTR, CHUNK_START_ATTR, ChunkPart, CONTENT_ROOT_ID (+6 more)

### Community 64 - "react"
Cohesion: 0.50
Nodes (4): react, peerDependencies, react, react

### Community 65 - "reader.browser.mjs"
Cohesion: 0.18
Nodes (9): browserDir, contentFrame(), corpusBook, corpusDir, fixtureDir, frameScrolls(), openBook(), openReader() (+1 more)

### Community 66 - "position-segmentation-perf.test.ts"
Cohesion: 0.33
Nodes (5): CountingSegmenter, graphemeSlice(), meter, sentenceTexts, TEXT

### Community 67 - "peerDependenciesMeta"
Cohesion: 0.67
Nodes (3): peerDependenciesMeta, react, optional

### Community 68 - "📖 wolfy-reader"
Cohesion: 0.17
Nodes (12): Development, Features, Install, License, Package surface, Quickstart, React, Scope (+4 more)

### Community 69 - "layout/index.ts"
Cohesion: 0.15
Nodes (16): countGraphemes(), Grapheme, graphemeIndexToCodeUnitOffset(), graphemeSegmenter, segmentGraphemes(), contextScore(), findGraphemeOccurrences(), Position (+8 more)

### Community 70 - "React domain"
Cohesion: 0.33
Nodes (5): Gotchas, Implementation notes, Key decisions, Overview, React domain

### Community 71 - "AGENTS.md"
Cohesion: 0.33
Nodes (5): Complexity levels, Core rules, Knowledge graph — query it first to save tokens, Project-specific guidance, Response style for Level 2+ work

### Community 73 - "patterns.md"
Cohesion: 0.40
Nodes (4): Anti-pattern template, Pattern name, Pattern template, Patterns

### Community 74 - "scripts"
Cohesion: 0.14
Nodes (14): scripts, bench, build, check:core, check:guards, check:pack, check:size, clean (+6 more)

### Community 77 - "keywords"
Cohesion: 0.29
Nodes (7): keywords, browser, ebook, epub, fb2, pagination, reader

### Community 78 - "Release domain"
Cohesion: 0.33
Nodes (6): Gotchas, Implementation notes, Key decisions, Overview, Release domain, Releasing

### Community 79 - "files"
Cohesion: 0.67
Nodes (3): files, dist, src

### Community 80 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 81 - "{{PROJECT_NAME}}"
Cohesion: 0.33
Nodes (5): Knowledge graph, Overview, {{PROJECT_NAME}}, Stack, Working with AI agents

### Community 82 - "a11y.browser.mjs"
Cohesion: 0.29
Nodes (3): browserDir, fixtureDir, repoRoot

## Knowledge Gaps
- **476 isolated node(s):** `Stack`, `Setup on a new machine`, `Checks`, `Demo`, `Developing a consumer against source` (+471 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Paginator` connect `Paginator` to `ContentHost`, `reader/index.ts`, `ReaderImpl`, `layout/index.ts`, `Section`, `view/index.ts`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `Section` connect `Section` to `fb2/index.ts`, `reader/index.ts`, `ReaderImpl`, `layout/index.ts`, `extract.ts`, `view/index.ts`, `core/index.ts`, `Paginator`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `ReaderImpl` connect `ReaderImpl` to `reader/index.ts`, `layout/index.ts`, `Reader`, `extract.ts`, `Section`, `appearance.ts`, `core/index.ts`, `Paginator`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `Stack`, `Setup on a new machine`, `Checks` to the rest of the system?**
  _476 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fb2/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0691333982473223 - nodes in this community are weakly interconnected._
- **Should `reader/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12333333333333334 - nodes in this community are weakly interconnected._
- **Should `zip/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09577677224736049 - nodes in this community are weakly interconnected._