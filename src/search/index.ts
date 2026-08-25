/**
 * Full-text search: a headless matcher over decoded section text, yielding jumpable
 * hits. Imports only `src/core` + platform primitives (`DOMParser`, `Intl.Segmenter`,
 * `TextDecoder`), so it runs under `node:test` with no browser and passes
 * `npm run check:core`. The whole-book scan (`searchBook`) is a lazy async generator
 * that never buffers the book whole and cleans up on early `break`.
 */
export { searchBook, matchText, type SearchHit, type SearchOptions } from './matcher.ts';
export { extractText, extractSectionText, decodeSectionBytes, type ReadingResolver } from './extract.ts';
export { normalizeText, normalizeQuery, type NormalizedText } from './normalize.ts';
