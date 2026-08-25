/**
 * Search normalization — the folding policy that decides when two strings "match"
 * for the purpose of full-text search. Applied to both the query and the extracted
 * section text before literal substring matching.
 *
 * Policy (see docs/domains/search.md ## Key decisions):
 * - **Case-insensitive.** Folded with `toLowerCase()`.
 * - **Unicode NFC.** Each grapheme is canonically composed, so a pre-composed `é`
 *   and a decomposed `e`+combining-acute match.
 * - **Diacritics are preserved.** `café` does not match `cafe`. Stripping marks is a
 *   locale-sensitive judgement (German ä, Turkish dotless ı) better left to a later,
 *   opt-in dimension than baked into the default.
 * - **Smart punctuation folded to ASCII.** Curly quotes → straight, en/em dashes and
 *   the minus sign → hyphen-minus, non-breaking and other Unicode spaces → a normal
 *   space. A reader types `don't`, the book prints `don’t`.
 * - **Whitespace collapsed.** Every run of whitespace (including the newlines that
 *   land between block elements during extraction) becomes a single space, and
 *   leading/trailing space folds off, so a query never fails on invisible layout
 *   whitespace.
 *
 * The fold must stay anchorable: the matcher works on the normalized string but each
 * hit's text and `Position` anchor into the **raw extracted** text. So the fold is
 * built grapheme by grapheme alongside an offset map from every normalized index
 * back to the raw UTF-16 offset it came from. The raw text handed to
 * `capturePosition` is never NFC-rewritten (it must stay byte-identical to what the
 * paginator measures against), so composition happens only inside the folded copy.
 */

/** A normalized string plus the map from its indices back to raw UTF-16 offsets. */
export interface NormalizedText {
  /** The folded, whitespace-collapsed text the matcher searches. */
  readonly text: string;
  /**
   * `map[i]` is the raw UTF-16 offset of the character that produced normalized
   * code unit `i`; `map[text.length]` is the raw text length. Monotonic
   * non-decreasing, so a normalized span `[a, b)` maps to the raw span
   * `[map[a], map[b])`.
   */
  readonly map: readonly number[];
}

const SMART: ReadonlyMap<string, string> = new Map([
  ['‘', "'"], // ‘ left single quote
  ['’', "'"], // ’ right single quote / apostrophe
  ['‚', "'"], // ‚ single low-9 quote
  ['‛', "'"], // ‛ single high-reversed-9 quote
  ['“', '"'], // “ left double quote
  ['”', '"'], // ” right double quote
  ['„', '"'], // „ double low-9 quote
  ['‟', '"'], // ‟ double high-reversed-9 quote
  ['′', "'"], // ′ prime
  ['″', '"'], // ″ double prime
  ['‐', '-'], // ‐ hyphen
  ['‑', '-'], // ‑ non-breaking hyphen
  ['‒', '-'], // ‒ figure dash
  ['–', '-'], // – en dash
  ['—', '-'], // — em dash
  ['―', '-'], // ― horizontal bar
  ['−', '-'], // − minus sign
]);

const WHITESPACE = /^\s$/;

let graphemeSegmenter: Intl.Segmenter | undefined;

function segmenter(): Intl.Segmenter {
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return graphemeSegmenter;
}

/** True when every code point in a grapheme is whitespace. */
function isWhitespace(grapheme: string): boolean {
  for (const ch of grapheme) {
    if (!WHITESPACE.test(ch) && ch !== '​' && ch !== '﻿') return false;
  }
  return true;
}

/** Folds a single grapheme under the punctuation/NFC/case policy. */
function foldGrapheme(grapheme: string): string {
  const mapped = grapheme.length === 1 ? (SMART.get(grapheme) ?? grapheme) : grapheme;
  return mapped.normalize('NFC').toLowerCase();
}

/**
 * Folds `raw` under the search policy and returns the normalized text plus the
 * index map back to raw UTF-16 offsets. A match found in `text` maps cleanly onto a
 * raw span for `capturePosition`.
 */
export function normalizeText(raw: string): NormalizedText {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  let sawNonSpace = false;
  let rawOffset = 0;

  for (const { segment } of segmenter().segment(raw)) {
    if (isWhitespace(segment)) {
      if (sawNonSpace) pendingSpace = true;
      rawOffset += segment.length;
      continue;
    }
    if (pendingSpace) {
      map.push(rawOffset); // the collapsed space anchors at the start of the text it precedes
      text += ' ';
      pendingSpace = false;
    }
    const folded = foldGrapheme(segment);
    for (let unit = 0; unit < folded.length; unit += 1) map.push(rawOffset);
    text += folded;
    sawNonSpace = true;
    rawOffset += segment.length;
  }

  map.push(raw.length); // trailing whitespace folds off; the terminal maps to raw end
  return { text, map };
}

/** The query folded to the same space as {@link normalizeText}'s `text`. */
export function normalizeQuery(query: string): string {
  return normalizeText(query).text;
}
