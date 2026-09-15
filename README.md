# wolfy-reader

Read ebooks in the browser — with pages that turn, text you can search, and typography you can change without losing your place.

## Overview

wolfy-reader renders ebooks in the browser — EPUB, FB2 and plain text today, MOBI/AZW3 later — with paginated and scrolled reading, chapter and TOC navigation, in-book search, and live appearance controls for font, theme and margins. It is built from scratch on platform primitives, carries zero runtime dependencies, and treats its API as a promise rather than a moving target: the `Book` model and the `Position` format are covered by semver. Reading position is preserved across every appearance change by contract — after a font, line-height, margin, column or paginated↔scrolled change, the paragraph at the top of your page is still on your page (the stated tolerance, tested as an invariant; scrolled mode holds to section granularity), and untrusted book content renders inside a hardened sandboxed iframe. It targets developers who want a reader that is small, pleasant to use, and safe with untrusted files — not a spec-conformance or DRM reading system.

## Stack

- Language: TypeScript — ESM only (`"type": "module"`), no CJS build
- Build system: TypeScript compiler (`tsc`), no bundler; `node:test` for tests, Playwright for browser tests (dev-only)
- Package registry: npm — `wolfy-reader` (unscoped; availability confirmed)
- Target platforms / runtimes: Browsers with `DecompressionStream` — Chrome 80+, Safari 16.4+, Firefox 113+

## Getting Started

```bash
npm install
npm run fetch-corpus # download the gitignored test corpus (Gutenberg + Standard Ebooks + W3C)
npm test             # node:test suite, headless — includes the differential decode suite
npm run test:browser # Playwright suites for the sandboxed frame
npm run typecheck    # tsc --noEmit
npm run check:core   # fail if src/core reaches src/layout or src/view
npm run bench        # pagination benchmark (needs the corpus)
```

The differential decode suite (`test/differential.test.ts`) proves the decoders
agree: for each title shipped as both EPUB and TXT, it decodes each, strips
boilerplate, normalizes, and asserts the prose matches across formats. It is
headless and **skips gracefully when the corpus is absent** — run `npm run
fetch-corpus` first to exercise it. This is the safety net MOBI/AZW3 will be
built against.

### Setup on a new machine

A clone gives you the source, the docs, the committed fixtures and the knowledge graph. Four things are deliberately not in the repo and are set up per machine:

```bash
npm install                      # 1. required
npx playwright install chromium  # 2. required for `npm run test:browser` (~115 MB)
npm run fetch-corpus             # 3. optional — real books, ~30 MB, gitignored
graphify hook install            # 4. optional — per-clone, see Knowledge graph below
```

1. **`npm install`** — `dependencies` is permanently empty; this installs the dev toolchain only.
2. **`npx playwright install chromium`** — the `playwright` package has no postinstall step, so `npm install` alone leaves you with no browser and `npm run test:browser` fails. Browser suites launch full Chromium (`channel: 'chromium'`), not the headless shell.
3. **`npm run fetch-corpus`** — downloads Project Gutenberg + Standard Ebooks titles into gitignored `test/corpus/`. Skipping it is safe: corpus-backed tests skip gracefully by rule and `npm test` stays green. Without it, `npm run bench` skips and the benchmark fixtures cannot be generated.
4. **`graphify hook install`** — the git hooks that rebuild the knowledge graph are local-only; a fresh clone has none until you install them.

Everything above is regenerable. The one file that is not in the repo and cannot be rebuilt is the local `PLAN.md` implementation plan — copy it across by hand if you are moving machines mid-project.

> Benchmark timings recorded in [`docs/domains/layout.md`](docs/domains/layout.md) are machine-specific. On different hardware, re-baseline with `npm run bench` and compare the chunked-vs-naive *ratios* (3–7x, far above machine variance) rather than the absolute milliseconds.

## Running Locally

```bash
npm run demo
```

This starts a dependency-free dev server (Node built-ins only) and prints the URL — `http://localhost:8080/` by default, or the next free port if 8080 is busy. It serves exactly two directories: `demo/` (at `/`, so `/` opens the demo) and `src/` (at `/src/`, so the demo can import library modules); no other repo path is reachable. `.ts` files are served with type annotations stripped (`node:module`'s `stripTypeScriptTypes`), so the browser runs the TypeScript sources directly — no bundler, no build step.

The demo is the primary development surface: pick an EPUB and it opens the book through the public API and shows what the decoder produced — metadata and cover, the nested table of contents, and the reading order. Clicking a chapter renders it as live markup inside the hardened sandboxed frame, with the book's own stylesheets and images, next to a panel listing everything the sanitizer removed and everything the Content Security Policy blocked. Decode failures surface as the library's typed errors by class name. It stays framework-free by rule. Opening `demo/index.html` as a `file://` URL does not work — browsers block ES module loading over `file://`.

## Working with AI agents

This repo uses a [lightweight spec-driven workflow](https://github.com/vitaliy-tkachuk/ai-spec-template). AI agents (Claude Code, Cursor, Codex, Copilot, Aider, etc.) follow the rules in [`AGENTS.md`](AGENTS.md).

Key docs:

- [`AGENTS.md`](AGENTS.md) — canonical instructions for AI agents
- [`docs/feature-workflow.md`](docs/feature-workflow.md) — complexity levels (0–3) and required artifacts
- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/coding-conventions.md`](docs/coding-conventions.md) — coding conventions
- [`docs/patterns.md`](docs/patterns.md) — cross-domain reusable patterns
- [`docs/domains/`](docs/domains/) — per-domain durable knowledge (the permanent record)

Architectural decisions live in `docs/architecture.md`. Task files (`docs/tasks/`) are ephemeral, local-only, and gitignored.

### Knowledge graph

If `graphify-out/graph.json` is present, it is a committed [graphify](https://github.com/safishamsi/graphify) knowledge graph of this repo. Agents query it before reading files (`graphify query "<question>"`), which is far cheaper than sweeping the tree — see [`AGENTS.md`](AGENTS.md#knowledge-graph--query-it-first-to-save-tokens).

The graph auto-rebuilds after each commit via local git hooks. Those hooks are not committed, so run `graphify hook install` once per clone. If the repo has no graph yet, build one with `/graphify .` and commit `graphify-out/`.
