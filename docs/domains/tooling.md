# Tooling domain

## Overview

The repo skeleton and dev tooling: `package.json`, `tsconfig.json`, npm scripts, the corpus download script (`scripts/fetch-corpus.mjs`), `.gitignore` rules, and the source directory layout (`src/core`, `src/zip`, `src/formats`, `src/layout`, `src/view`, `test/`, `demo/`). There is deliberately no bundler, CI, lint tooling, or publishing config — that apparatus belongs to the release milestone, not to day-one development.

## Key decisions

- **`typescript` is the only devDependency** (latest stable, currently the 7.x native compiler). `@types/node` is not installed: tests are plain `.mjs` for now, so nothing needs Node type declarations. Add it the moment tests are written in TypeScript — not before.
- **`module`/`moduleResolution: nodenext`** rather than `bundler`: there is no bundler by design, and `nodenext` is the mode that forces explicit `.js` extensions on relative imports, keeping `tsc` output (when emit starts) directly loadable by both Node and browsers.
- **`noEmit: true`** — `tsc` is a typechecker only at this stage; no build output exists, so `dist/` stays empty and gitignored until packaging work begins.
- **Tests via bare `node:test`**, invoked with a glob (`node --test "test/**/*.test.mjs"`). A directory argument (`node --test test/`) fails on Windows — Node tries to resolve it as a module — so the glob form is the portable one.
- **Corpus is downloaded, never committed.** `test/corpus/` is gitignored; only small license-clean fixtures live in `test/fixtures/` (committed).

## Implementation notes

- npm scripts: `npm test` (node:test glob run), `npm run typecheck` (`tsc --noEmit`), `npm run fetch-corpus` (`node scripts/fetch-corpus.mjs`).
- `tsconfig.json` includes `src/` only. Each `src/` subdirectory holds a placeholder `index.ts` containing `export {}` — real modules replace them as milestones land.
- `scripts/fetch-corpus.mjs` uses only Node built-ins (`fetch`, `node:fs/promises`, `node:path`, `node:url`). It downloads Gutenberg titles as EPUB+TXT *pairs* (same title in both formats feeds differential decoder testing) plus a Standard Ebooks EPUB, is idempotent (skips files already present), and exits non-zero if any download fails.
- `demo/index.html` is one self-contained file: a file input and a `#reader` div with an inline module script. It stays framework-free by rule.

## Gotchas

- `tsc --noEmit` errors with "no inputs were found" if `src/` holds only `.gitkeep` files — the placeholder `export {}` modules are what keep the typecheck green, so don't replace them with bare `.gitkeep`s.
- Standard Ebooks serves an HTML "your download has started" interstitial instead of the file unless the download URL carries `?source=download`. Sanity-check downloaded EPUBs by their `PK\x03\x04` magic bytes.
- Gutenberg's stable per-format URLs are `https://www.gutenberg.org/ebooks/<id>.epub3.images` and `<id>.txt.utf-8` (both redirect to the cache; follow redirects).
