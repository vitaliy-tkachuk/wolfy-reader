/**
 * The package root: the browser-facing reader facade plus the headless core it
 * operates on.
 *
 *   import { open, render } from 'wolfy-reader';
 *   import { epub } from 'wolfy-reader/epub';
 *
 * Core travels with the facade because `render` takes a `Book` and `open` is the
 * only public way to make one — splitting them would make the common case a
 * three-import dance, and the facade's own surface already names `Position`,
 * `TocItem` and `SentenceRange` in its signatures.
 *
 * Both re-exports resolve to the same emitted modules as `wolfy-reader/core`, so
 * there is one `open`, one `Position` model and one set of error constructors
 * however a consumer reaches them — `instanceof BookError` holds across entries.
 *
 * Headless consumers should import `wolfy-reader/core` instead. This root reaches
 * `src/layout` and `src/view`; it is import-safe under Node today and the pack
 * fidelity check keeps it that way, but only `/core` carries the guarantee.
 *
 * Format decoders are deliberately absent: each is its own subpath because their
 * closures differ by an order of magnitude — only `epub` pulls the ZIP reader —
 * and `open(input, { formats })` takes an explicit list by design.
 */
export * from './core/index.ts';
export * from './reader/index.ts';
