# Tooling domain

## Overview

The repo skeleton and dev tooling: `package.json`, `tsconfig.json`, npm scripts, the corpus download script (`scripts/fetch-corpus.mjs`), `.gitignore` rules, and the source directory layout (`src/core`, `src/zip`, `src/formats`, `src/layout`, `src/view`, `test/`, `demo/`). There is deliberately no bundler, CI, lint tooling, or publishing config — that apparatus belongs to the release milestone, not to day-one development.

## Key decisions

- **Two devDependencies only: `typescript` (7.x native compiler) and `@types/node`.** Both are latest stable. Nothing else is ever added at runtime — `dependencies` stays `{}` permanently.
- **`module`/`moduleResolution: nodenext`** rather than `bundler`: there is no bundler by design, and `nodenext` keeps `tsc` output (once emit starts) directly loadable by both Node and browsers.
- **Relative imports carry `.ts` extensions, rewritten to `.js` on emit** (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`). This is what lets a `.ts` test import `../src/zip/index.ts` and run under Node's type stripping with no build step. A `.js`-extension import would resolve at build time but break every headless test run, because type stripping does not map `.js` back to `.ts`.
- **`noEmit: true`** — `tsc` is a typechecker only at this stage; no build output exists, so `dist/` stays empty and gitignored until packaging work begins.
- **Tests via bare `node:test`**, written in TypeScript and invoked with a glob (`node --test "test/**/*.test.ts"`). Node runs them directly via type stripping — no transpile step, no test framework. A directory argument (`node --test test/`) fails on Windows — Node tries to resolve it as a module — so the glob form is the portable one.
- **Corpus is downloaded, never committed.** `test/corpus/` is gitignored; only small license-clean fixtures live in `test/fixtures/` (committed).

## Implementation notes

- npm scripts: `npm test` (node:test glob run over `test/**/*.test.ts`), `npm run typecheck` (`tsc --noEmit`), `npm run fetch-corpus` (`node scripts/fetch-corpus.mjs`).
- `tsconfig.json` includes `src/` and `test/`, so tests are typechecked alongside the source they exercise. Each `src/` subdirectory holds a placeholder `index.ts` containing `export {}` — real modules replace them as milestones land.
- `scripts/fetch-corpus.mjs` uses only Node built-ins (`fetch`, `node:fs/promises`, `node:path`, `node:url`). It downloads Gutenberg titles as EPUB+TXT *pairs* (same title in both formats feeds differential decoder testing) plus a Standard Ebooks EPUB, is idempotent (skips files already present), and exits non-zero if any download fails.
- `demo/index.html` is one self-contained file: a file input and a `#reader` div with an inline module script. It stays framework-free by rule.

## Gotchas

- `tsc --noEmit` errors with "no inputs were found" if `src/` holds only `.gitkeep` files — the placeholder `export {}` modules are what keep the typecheck green, so don't replace them with bare `.gitkeep`s.
- Node's type stripping resolves import specifiers literally. An internal `import './dep.js'` throws at test time even though it typechecks — always write `./dep.ts`.
- Standard Ebooks serves an HTML "your download has started" interstitial instead of the file unless the download URL carries `?source=download`. Sanity-check downloaded EPUBs by their `PK\x03\x04` magic bytes.
- Gutenberg's stable per-format URLs are `https://www.gutenberg.org/ebooks/<id>.epub3.images` and `<id>.txt.utf-8` (both redirect to the cache; follow redirects).
