# Architecture

> This file holds global architecture **and** cross-cutting decisions (stack, database, auth, deployment, API style, etc.) woven into the section each affects — date significant ones inline. Domain-local decisions live in `docs/domains/<domain>.md` instead. There is no separate decisions folder.

## Purpose

Read ebooks in the browser — with pages that turn, text you can search, and typography you can change without losing your place.

wolfyReader renders ebooks in the browser — EPUB, FB2 and plain text today, MOBI/AZW3 later — with paginated and scrolled reading, chapter and TOC navigation, in-book search, and live appearance controls for font, theme and margins. It is built from scratch on platform primitives, carries zero runtime dependencies, and treats its API as a promise rather than a moving target: the `Book` model and the `Position` format are covered by semver. Reading position survives font-size and layout changes, and untrusted book content renders inside a hardened sandboxed iframe. It targets developers who want a reader that is small, pleasant to use, and safe with untrusted files — not a spec-conformance or DRM reading system.

## Current stack

- Language: TypeScript — ESM only (`"type": "module"`), no CJS build
- Build system: TypeScript compiler (`tsc`), no bundler; `node:test` for tests, Playwright for browser tests (dev-only)
- Package registry: npm — `wolfyreader` (unscoped; availability confirmed)
- Target platforms / runtimes: Browsers with `DecompressionStream` — Chrome 80+, Safari 16.4+, Firefox 113+

## Main application areas

Planned layout (decided in the implementation plan; the directories do not exist yet):

- `src/core` — the stable contract: `Book` model, `Position`, `TocItem`, typed errors, the `open()` entry point and format-registry seam
- `src/zip` — from-scratch ZIP container reader built on `DecompressionStream('deflate-raw')`
- `src/formats` — per-format decoders (`epub`, `fb2`, `text`; `mobi` later), each producing a `Book`
- `src/layout` — the paginator: chunked, virtualized CSS multi-column
- `src/view` — the renderer and hardened sandboxed-iframe host
- `src/react` — React bindings, shipped as a separate subpath export
- `test/fixtures` — small, license-clean book fixtures (committed)
- `test/corpus` — Project Gutenberg / Standard Ebooks corpus (gitignored, downloaded by script)
- `demo` — framework-free reference viewer; the primary development surface
- `docs` — architecture, domain docs, workflow

## Important boundaries

Document architectural rules here as they are decided.

Examples (pick what fits the project type):

- Core logic stays free of I/O and side effects; I/O lives at the edges.
- External access (DB, network, filesystem) goes through one approved layer, not scattered across modules.
- Platform- or OS-specific code is isolated behind an abstraction, kept out of core logic.
- The public API surface stays separate from internal implementation details.

## Known constraints

- None recorded yet.
