/**
 * The headless full-text matcher. Normalized literal substring search over a
 * section's extracted text, yielding jumpable hits. Imports only `src/core`
 * (`capturePosition`, `Position`, `Book`, `Section`) and platform primitives, so it
 * runs under `node:test` with no browser.
 *
 * The whole-book scan is a lazy async generator: it decodes and scans one section at
 * a time and yields hits as it goes, so the book is never buffered whole and a
 * consumer that `break`s stops the scan (the generator's cleanup runs on return).
 */
import { capturePosition, type Book, type Position, type Section } from '../core/index.ts';
import { collapseWhitespace as collapse } from '../core/text.ts';

import { extractSectionText } from './extract.ts';
import { normalizeQuery, normalizeText } from './normalize.ts';

/** One search hit: the matched text, a clean context window, and a jumpable position. */
export interface SearchHit {
  /** The verbatim matched run, in the section's raw text. */
  readonly text: string;
  /**
   * The match surrounded by context, trimmed to whole words at both ends via
   * `Intl.Segmenter` — no leading/trailing partial word.
   */
  readonly context: string;
  /**
   * A content-addressed `Position` at the match, built with `capturePosition`. Pass
   * it to `reader.goTo(hit.position)` to land on the hit's page.
   */
  readonly position: Position;
  /** 0-based index of the section this hit falls in, in reading order. */
  readonly sectionIndex: number;
}

export interface SearchOptions {
  /**
   * Characters of surrounding context to aim for on each side of the match before
   * word-boundary trimming. Default 40.
   */
  readonly contextRadius?: number;
  /** Locale for word segmentation of the context. Defaults to the runtime default. */
  readonly locale?: string;
}

const DEFAULT_CONTEXT_RADIUS = 40;

/**
 * All hits for `query` within one section's already-extracted `rawText`. Pure over
 * strings — no I/O — so it is the unit the section scan and the tests both drive.
 * A blank (whitespace-only or empty) query yields nothing.
 */
export function* matchText(
  rawText: string,
  query: string,
  sectionId: string,
  sectionIndex: number,
  options: SearchOptions = {},
): Generator<SearchHit> {
  const needle = normalizeQuery(query);
  if (needle === '') return;

  const { text: haystack, map } = normalizeText(rawText);
  const radius = options.contextRadius ?? DEFAULT_CONTEXT_RADIUS;

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return;
    const end = at + needle.length;

    // Map the normalized match span back onto the raw text. `map[end]` points at the
    // start of the character *after* the match, which — when that character is a
    // collapsed space — lies past a run of raw whitespace; trim it so the matched
    // text ends on real content. The anchor still starts at `rawStart`.
    const rawStart = map[at]!;
    const rawEnd = trimEnd(rawText, rawStart, map[end]!);
    const matched = rawText.slice(rawStart, rawEnd);

    // Context window in normalized space, then mapped back and word-trimmed on the
    // raw text so the shown context carries no partial word at either edge.
    const ctxNormStart = Math.max(0, at - radius);
    const ctxNormEnd = Math.min(haystack.length, end + radius);
    const rawCtxStart = map[ctxNormStart]!;
    const rawCtxEnd = map[ctxNormEnd]!;
    const context = trimToWords(
      rawText,
      rawCtxStart,
      rawCtxEnd,
      rawStart,
      rawEnd,
      options.locale,
    );

    yield {
      text: matched,
      context,
      position: capturePosition(rawText, rawStart, sectionId),
      sectionIndex,
    };

    // Advance past this match; guard against a zero-length needle (impossible here,
    // an empty needle returned above) so the loop always progresses.
    from = end > at ? end : at + 1;
  }
}

/**
 * Trims a raw context window `[start, end)` inward to whole-word boundaries via
 * `Intl.Segmenter`, never cutting into the match span `[matchStart, matchEnd)`. A
 * word straddling the left edge is dropped forward to its end (the next word's
 * start); a word straddling the right edge is dropped back to its start. The result
 * is whitespace-collapsed for a compact one-line context.
 */
function trimToWords(
  text: string,
  start: number,
  end: number,
  matchStart: number,
  matchEnd: number,
  locale: string | undefined,
): string {
  // Segment a slice wider than the window so a word straddling an edge is visible
  // whole. Offsets are relative to the wide slice, so add `lo`.
  const lo = Math.max(0, Math.min(start, matchStart) - 24);
  const hi = Math.min(text.length, Math.max(end, matchEnd) + 24);
  let head = start;
  let tail = end;
  for (const seg of wordSegmenter(locale).segment(text.slice(lo, hi))) {
    if (!seg.isWordLike) continue;
    const segStart = lo + seg.index;
    const segEnd = segStart + seg.segment.length;
    // A word-like segment straddling the left edge: move head to its end (the next
    // word's start), but never past the match start.
    if (segStart < start && segEnd > start) head = Math.min(matchStart, segEnd);
    // A word-like segment straddling the right edge: move tail to its start, but
    // never before the match end.
    if (segStart < end && segEnd > end) tail = Math.max(matchEnd, segStart);
  }
  return collapse(text.slice(head, tail));
}

/** Pull `end` back past any trailing whitespace, never before `start`. */
function trimEnd(text: string, start: number, end: number): number {
  let at = end;
  while (at > start && /\s/.test(text[at - 1]!)) at -= 1;
  return at;
}

let cachedWordSegmenter: { locale: string | undefined; segmenter: Intl.Segmenter } | undefined;

function wordSegmenter(locale: string | undefined): Intl.Segmenter {
  if (cachedWordSegmenter === undefined || cachedWordSegmenter.locale !== locale) {
    cachedWordSegmenter = { locale, segmenter: new Intl.Segmenter(locale, { granularity: 'word' }) };
  }
  return cachedWordSegmenter.segmenter;
}

/**
 * Lazily scans every section of `book` for `query`, one section at a time, yielding
 * each hit as it is found. The book is never buffered whole: each section's bytes are
 * loaded, extracted, matched and released before the next is touched. A consumer that
 * stops early (`break`/`return`) halts the scan — no later section is loaded.
 *
 * `onSection` (test-only instrumentation seam) fires with each section's index the
 * moment before it is decoded, so a test can prove laziness by counting decodes.
 */
export async function* searchBook(
  book: Book,
  query: string,
  options: SearchOptions & { onSection?: (index: number) => void } = {},
): AsyncGenerator<SearchHit> {
  const needle = normalizeQuery(query);
  if (needle === '') return;

  const sections = book.sections;
  for (let index = 0; index < sections.length; index += 1) {
    const section: Section = sections[index]!;
    options.onSection?.(index);
    const bytes = await section.load();
    // The section's own resolver rides along so extraction shows an <img> the
    // way the frame will: rendered (no text) or substituted by its alt.
    const rawText = extractSectionText(bytes, section.resolve?.bind(section));
    for (const hit of matchText(rawText, query, section.id, index, options)) {
      yield hit;
    }
  }
}
