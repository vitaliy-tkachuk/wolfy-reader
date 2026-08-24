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

The source tree exists as scaffolding; decoders, paginator and view fill the directories milestone by milestone:

- `src/core` — the stable contract: `Book` model, `Position`, `TocItem`, typed errors, the `open()` entry point and format-registry seam
- `src/zip` — from-scratch ZIP container reader built on `DecompressionStream('deflate-raw')`
- `src/formats` — per-format decoders (`epub`, `fb2`, `text`; `mobi` later), each producing a `Book`
- `src/layout` — the paginator: chunked, virtualized CSS multi-column
- `src/view` — the renderer and hardened sandboxed-iframe host
- `src/react` — React bindings as a separate subpath export (reserved; whether it ships in v1 is an open decision, so the directory is not created yet)
- `test/fixtures` — small, license-clean book fixtures (committed)
- `test/corpus` — Project Gutenberg / Standard Ebooks corpus (gitignored, downloaded by `scripts/fetch-corpus.mjs`)
- `demo/index.html` — framework-free decoder proof and the primary development surface: opens a book through the public API and shows metadata, cover, TOC and section bytes. It renders section content as escaped text, never as live markup — the hardened sandboxed-iframe host belongs to `src/view`
- `docs` — architecture, domain docs, workflow

## Important boundaries

- **`src/core` is the stability promise** (2026-08-24). The `Book` model — optional metadata (`title`, `author`, `language`, `cover`), a `TocItem` tree, sections in reading order, a resource map, and optional presentation flags (`direction`, `fixedLayout`, and `scripted` per section) — and, once it lands, the `Position` format are the semver contract; everything else may churn. Names in `src/core` are frozen as if they can never be renamed, and carry no format's vocabulary. **Core is also headless by rule**: nothing reachable from `src/core/index.ts` may import `src/layout` or `src/view`, in either value or type position, so a Node consumer importing the core entry can never load a module that touches `document`/`window`. `npm run check:core` enforces it mechanically — see [`docs/domains/tooling.md`](domains/tooling.md).
- **The frozen surface grew once, deliberately: `Section.resolve?()`** (2026-08-24). Sections carry an optional `resolve(reference: string): Resource | undefined` — the format maps a reference *as it appears inside that section's own content* to the resource it names. It was added because rendering book content needs images, stylesheets and fonts, and nothing in the model could answer "what resource does `../images/foo.jpg` in this section refer to?" — the direct consequence of removing paths from the model. The two alternatives were both worse: a path-keyed resource map would put container paths back into a format-neutral model, and shipping the view with no resource loading would render books unstyled and imageless. It is optional and additive, so no existing consumer changed. Additive growth of `src/core` is allowed when the alternative is leaking a format's vocabulary into the model; renames and removals still are not.
- **The model is format-neutral by rule** (2026-08-24): sections are id-addressed lazy byte payloads with a media type, not file paths; TOC entries target `sectionId` + optional `fragment`, never an href; the cover is data (`Resource`: media type + lazy bytes), never a container path. This is what lets single-XML-file FB2, file-less TXT, and PalmDB-record MOBI share one model with EPUB. See `docs/domains/core.md` for the per-shape rationale.
- **No format is baked into core.** `open(input, { formats })` takes an explicit format list; a format is a `BookFormat` (sniffer + decoder over a normalized `ByteSource`), and third-party formats register through exactly the same public seam as built-ins. Sniffers run in registration order; the first claim wins.
- **Bytes in, `Book` out.** Input is `ArrayBuffer | Blob | File | RangeReader` (an object `{ size, read(offset, length) }` — size is required so tail-anchored containers like ZIP can locate their end structures), normalized once into `ByteSource`. The library never fetches and never persists; the optional `StorageAdapter` is host-implemented and only ever *called* by the library, via the decoder's `FormatContext`.
- **Failures are typed.** Every library error extends `BookError` (`UnrecognizedFormatError`, `CorruptContainerError`, `EncryptedContentError`); `open()` wraps any untyped decode failure in `CorruptContainerError` with `cause`, so hosts always catch by class.

## Known constraints

- **Fixed layout is detected, never rendered** (2026-08-24). `Book.fixedLayout` records that a book declares fixed-size pages so a host can refuse it or hand it elsewhere; rendering stays reflow-only, permanently. There is no partial fixed-layout path and none is planned.
- **Range-reader inputs must supply their total size.** Tail-anchored containers (ZIP's end-of-central-directory) cannot be located otherwise.
- **A chunk cannot be a block in a shared column flow** (2026-08-24). `content-visibility: auto` applies layout containment, and a layout-contained box cannot fragment across columns — it collapses to a single column and clips the rest. The paginator therefore gives each chunk its own multi-column context, which makes every chunk boundary a forced page break (measured cost: +8–16% pages). This constrains the sandboxed-iframe host and the page↔position mapping built on it. Measurements and the go decision live in [`docs/domains/layout.md`](domains/layout.md).
