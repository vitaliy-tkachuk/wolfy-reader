# Core domain

## Overview

`src/core` is the stability promise of the library: the `Book` model, the typed error hierarchy, the `open()` entry point with its format-registry seam, input normalization, and the host-implemented `StorageAdapter` interface. Everything else in the repo may churn; these names and shapes are covered by semver. Modules: `book.ts` (model), `errors.ts`, `source.ts` (input forms + `ByteSource` normalization), `format.ts` (the seam), `storage.ts`, `open.ts`, re-exported through `index.ts`.

## Key decisions

- **The `Book` model is format-neutral by construction** (2026-08-24). Every shape was chosen so plain-text, single-XML-file, and PalmDB formats fit without bending:
  - **Sections are id-addressed lazy byte payloads** (`{ id, mediaType, load() }`), not file paths. FB2 is one XML file whose `<section>` elements become sections; MOBI text is assembled from PalmDB records; TXT synthesizes sections from heuristics. Only EPUB has files — so files appear nowhere in the model.
  - **`TocItem` targets `sectionId` + optional `fragment`, never an href.** MOBI TOCs come from `filepos` byte offsets, FB2 from element ids, TXT from synthesized headings; a decoder resolves whatever it has to a section id up front.
  - **The cover is a `Resource` (media type + lazy bytes), never a container path.** FB2 inlines it as base64, MOBI stores it in an EXTH record; a path-shaped cover would be EPUB-only.
  - **All metadata fields are optional and omitted when unknown** — a bare Gutenberg TXT has no author, language, or cover.
- **`RangeReader` is an object `{ size, read }`, not a bare callback.** The read signature is exactly `(offset, length) => Promise<Uint8Array>`, but container formats need the total size to locate tail-anchored structures (ZIP's end-of-central-directory); a bare function cannot supply it.
- **The format seam is fully public.** `BookFormat` (`name`, `sniff(source)`, `decode(source, context)`) is the same interface built-in and third-party formats implement; `open(input, { formats })` takes an explicit list and bakes nothing in. Sniffers run in registration order; the first claim wins; a claim followed by a decode failure does not fall through to later formats.
- **Errors are a typed hierarchy under `BookError`:** `UnrecognizedFormatError` (no sniffer claimed the input), `CorruptContainerError` (damaged structure), `EncryptedContentError` (DRM-free only — encountering encryption is a typed refusal, not a crash). Decoders throw these directly; `open()` wraps any non-`BookError` decode failure in `CorruptContainerError` with the original as `cause`, so hosts can always catch by class.
- **`StorageAdapter` (`get`/`set`/`delete`) is host-implemented; the library only calls it.** It reaches decoders through the `FormatContext` argument of `decode()`. The library itself never fetches and never persists.

## Implementation notes

- `toByteSource()` normalizes all four input forms (`ArrayBuffer`, `Blob`, `File` — a `Blob` subtype — and `RangeReader`) into one `ByteSource` (`size`, ranged `read()`, cached whole-input `bytes()`), so sniffers and decoders consume a single shape. Small-file formats call `bytes()`; ZIP/PalmDB readers use `read()` and never need the whole file in memory.
- `open()` flow: normalize input → for each format, `await sniff(source)` → first `true` wins → `decode(source, context)` → map failures to typed errors → no claimant means `UnrecognizedFormatError`. A non-input value rejects with `TypeError` before any format runs.
- `sniff` may return `boolean` or `Promise<boolean>`; `open()` awaits either.
- The stub format used by `test/core.test.ts` registers through the public seam only — it is the standing proof that a third-party format needs nothing internal.

## Gotchas

- `exactOptionalPropertyTypes` is on: `{ cover?: Resource }` rejects an explicit `undefined`. Decoders must *omit* unknown optional fields — build metadata and `TocItem.fragment` with conditional spreads, never `field: maybeUndefined`.
- `TocItem.children` is always present (possibly empty), so consumers traverse without null checks; decoders must supply `[]`.
- Section ids must be unique within a book — `Book.section(id)` and `TocItem.sectionId` depend on it.
- Internal imports carry `.ts` extensions (`./book.ts`); a `.js` extension typechecks but throws under Node's type stripping at test time.
- `ByteSource.read()` past end of data returns fewer bytes rather than throwing (ArrayBuffer/Blob slicing clamps); range-reader hosts should match that behavior.
