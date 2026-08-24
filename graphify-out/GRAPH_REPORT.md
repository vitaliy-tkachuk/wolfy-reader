# Graph Report - .  (2026-08-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 654 nodes · 1136 edges · 34 communities (33 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bd223818`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- host.ts
- core/index.ts
- epub/index.ts
- zip/index.ts
- make-bench-fixture.mjs
- sanitize.ts
- harness.js
- compilerOptions
- make-epub-fixtures.mjs
- package.json
- run.mjs
- view.browser.mjs
- Branch A — New work (intake + scaffold)
- View domain
- Feature Workflow
- check-core-purity.mjs
- make-zip-fixtures.mjs
- css.ts
- AGENTS.md
- Describe-project skill
- Coding Conventions
- Layout domain
- Implement skill
- wolfyReader
- AGENTS.md
- architecture.md
- Architecture
- Core domain
- ZIP domain
- fetch-corpus.mjs
- Tooling domain
- patterns.md

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 18 edges
2. `ContentHost` - 14 edges
3. `ResourceRegistry` - 14 edges
4. `Feature Workflow` - 14 edges
5. `attribute()` - 12 edges
6. `parseXml()` - 12 edges
7. `findCssReferences()` - 11 edges
8. `View domain` - 11 edges
9. `BookError` - 10 edges
10. `StorageAdapter` - 10 edges

## Surprising Connections (you probably didn't know these)
- `main()` --indirect_call--> `label()`  [INFERRED]
  bench/run.mjs → scripts/check-core-purity.mjs
- `values()` --calls--> `findCssReferences()`  [EXTRACTED]
  test/view.test.ts → src/view/css.ts
- `replaceAll()` --calls--> `rewriteCssReferences()`  [EXTRACTED]
  test/view.test.ts → src/view/css.ts
- `openFixture()` --calls--> `open()`  [EXTRACTED]
  test/epub.test.ts → src/core/open.ts
- `scrubAttributes()` --indirect_call--> `attribute()`  [INFERRED]
  src/view/sanitize.ts → src/formats/epub/xml.ts

## Import Cycles
- None detected.

## Communities (34 total, 1 thin omitted)

### Community 0 - "host.ts"
Cohesion: 0.06
Nodes (39): Section, assembleFrameDocument(), contentSecurityPolicy(), coordinationScript(), createNonce(), escapeAttribute(), FrameDocumentParts, RESET_CSS (+31 more)

### Community 1 - "core/index.ts"
Cohesion: 0.07
Nodes (38): Book, BookMetadata, ReadingDirection, Resource, TocItem, BookError, CorruptContainerError, EncryptedContentError (+30 more)

### Community 2 - "epub/index.ts"
Cohesion: 0.11
Nodes (44): decodeSegment(), directoryOf(), HrefTarget, resolveHref(), asZipSource(), bridged(), buildBook(), buildToc() (+36 more)

### Community 3 - "zip/index.ts"
Cohesion: 0.12
Nodes (31): CentralRecord, parseCentralDirectory(), CentralDirectoryLocation, findEocd(), locateCentralDirectory(), readZip64(), toSafeNumber(), ZipEncryptedEntryError (+23 more)

### Community 4 - "make-bench-fixture.mjs"
Cohesion: 0.09
Nodes (27): allowedAttributes, altTextOf(), buildSynthetic(), corpusDir, cursorOver(), droppedElements, escapeText(), forbiddenPatterns (+19 more)

### Community 5 - "sanitize.ts"
Cohesion: 0.11
Nodes (25): CELL, GRADIENT, HTML_DISCARDED, HTML_ELEMENTS, HTML_GLOBAL_ATTRIBUTES, isAllowedReference(), LINK_SCHEMES, MEDIA_SCHEMES (+17 more)

### Community 6 - "harness.js"
Cohesion: 0.13
Nodes (20): exactPageCount(), forceLayout(), nextPaint(), positions(), quantiles(), relayout(), seeks(), setup() (+12 more)

### Community 7 - "compilerOptions"
Cohesion: 0.08
Nodes (25): dom, dom.iterable, es2022, node, src, test, compilerOptions, allowImportingTsExtensions (+17 more)

### Community 8 - "make-epub-fixtures.mjs"
Cohesion: 0.09
Nodes (17): buildZip(), chapterStub, epub2Entries, epub3Entries, hostileEntries, hostileVectors, makePng(), mimetypeEntry (+9 more)

### Community 9 - "package.json"
Cohesion: 0.09
Nodes (22): author, description, devDependencies, playwright, @types/node, typescript, license, name (+14 more)

### Community 10 - "run.mjs"
Cohesion: 0.17
Nodes (19): benchDir, fmt(), fmtSpread(), main(), measureOnce(), median(), metricsToObject(), pad() (+11 more)

### Community 11 - "view.browser.mjs"
Cohesion: 0.12
Nodes (15): contentTypes, demoMounts, listen(), makeHandler(), notFound(), repoRoot, startServer(), browserDir (+7 more)

### Community 12 - "Branch A — New work (intake + scaffold)"
Cohesion: 0.11
Nodes (18): A1 — Load durable context, A2 — Classify, A3 — Detect conflicts, A4 — Ask clarifying questions (if needed), A5 — Emit the structured summary, A6 — Scaffold artifacts, A7 — Report, Analyze skill (+10 more)

### Community 13 - "View domain"
Cohesion: 0.11
Nodes (17): EPUB domain, Gotchas, Implementation notes, Key decisions, Overview, Patterns, Gotchas, Key decisions (+9 more)

### Community 14 - "Feature Workflow"
Cohesion: 0.11
Nodes (18): Always-approval triggers, Anti-goals, Committing, Completing a task, Complexity levels, Context review (Level 2+), Default process, Domain doc shape (+10 more)

### Community 15 - "check-core-purity.mjs"
Cohesion: 0.15
Nodes (14): blankComments(), chainOf(), entry, failures, forbiddenRoots, isFile(), label(), parents (+6 more)

### Community 16 - "make-zip-fixtures.mjs"
Cohesion: 0.15
Nodes (14): alpha, buildZip(), contentDir, dataBin, fakeEncryptedPayload, lorem, loremLines, outDir (+6 more)

### Community 17 - "css.ts"
Cohesion: 0.25
Nodes (15): CssReference, CssReferenceKind, escapeCssUrl(), findCssReferences(), isIdentChar(), matchesAt(), readReference(), readString() (+7 more)

### Community 18 - "AGENTS.md"
Cohesion: 0.19
Nodes (5): Knowledge graph, Overview, {{PROJECT_NAME}}, Stack, Working with AI agents

### Community 19 - "Describe-project skill"
Cohesion: 0.18
Nodes (10): Describe-project skill, Hard rules, Stack categories by project type, Step 1 — Gather project info, Step 2 — Patch `docs/architecture.md`, Step 3 — Render `README.md` from `README.template.md`, Step 4 — Rewrite the AGENTS.md "Project-specific guidance" section, Step 5 — Append stack-specific `.gitignore` entries (+2 more)

### Community 20 - "Coding Conventions"
Cohesion: 0.18
Nodes (11): Coding Conventions, Comments, Commits, Demonstrating, Dependencies, Documentation, General, Language & framework specifics (+3 more)

### Community 21 - "Layout domain"
Cohesion: 0.18
Nodes (11): Chunk-boundary strategy, Correctness checks the benchmark runs, Gotchas, Implementation notes, Key decisions, Layout domain, Measurements, Open for M2-3 (+3 more)

### Community 22 - "Implement skill"
Cohesion: 0.20
Nodes (10): Hard rules, Implement skill, Step 1 — Identify the target, Step 2 — Load context, Step 3 — Re-check conflicts, Step 4 — Execute, Step 5 — Verify, Step 6 — Close out (+2 more)

### Community 23 - "wolfyReader"
Cohesion: 0.29
Nodes (7): Getting Started, Knowledge graph, Overview, Running Locally, Stack, wolfyReader, Working with AI agents

### Community 24 - "AGENTS.md"
Cohesion: 0.33
Nodes (5): Complexity levels, Core rules, Knowledge graph — query it first to save tokens, Project-specific guidance, Response style for Level 2+ work

### Community 26 - "Architecture"
Cohesion: 0.33
Nodes (6): Architecture, Current stack, Important boundaries, Known constraints, Main application areas, Purpose

### Community 27 - "Core domain"
Cohesion: 0.33
Nodes (5): Core domain, Gotchas, Implementation notes, Key decisions, Overview

### Community 28 - "ZIP domain"
Cohesion: 0.33
Nodes (5): Gotchas, Implementation notes, Key decisions, Overview, ZIP domain

### Community 29 - "fetch-corpus.mjs"
Cohesion: 0.33
Nodes (3): corpusDir, downloads, W3C_TESTS

### Community 30 - "Tooling domain"
Cohesion: 0.40
Nodes (5): Gotchas, Implementation notes, Key decisions, Overview, Tooling domain

### Community 31 - "patterns.md"
Cohesion: 0.40
Nodes (4): Anti-pattern template, Pattern name, Pattern template, Patterns

## Knowledge Gaps
- **238 isolated node(s):** `strategies`, `viewport`, `benchDir`, `repoRoot`, `contentTypes` (+233 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Section` connect `host.ts` to `core/index.ts`, `epub/index.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `Resource` connect `core/index.ts` to `host.ts`, `epub/index.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `strategies`, `viewport`, `benchDir` to the rest of the system?**
  _238 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `host.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06377151799687011 - nodes in this community are weakly interconnected._
- **Should `core/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06778846153846153 - nodes in this community are weakly interconnected._
- **Should `epub/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11010558069381599 - nodes in this community are weakly interconnected._
- **Should `zip/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12181616832779624 - nodes in this community are weakly interconnected._