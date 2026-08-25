/**
 * Shared grapheme-boundary helper for the position layer (`src/core/position.ts`)
 * and the paginator (`src/layout/index.ts`). Internal: nothing here is re-exported
 * from `src/core/index.ts`, so it is not part of the frozen public surface.
 *
 * A segmented text is represented as a `Grapheme[]` whose `.index` values form a
 * sorted array of UTF-16 code-unit boundaries; both offset↔index conversions are
 * binary searches over that array. Segment once per text, convert O(log n) per
 * call — never re-segment per lookup (the batch-capture invariant).
 *
 * Headless and pure `Intl.Segmenter`: grapheme segmentation is locale-independent,
 * so one shared segmenter instance serves every caller.
 */

/** A grapheme cluster together with its UTF-16 code-unit offset in the text. */
export interface Grapheme {
  readonly segment: string;
  readonly index: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Segments `text` into grapheme clusters, each keeping its code-unit index. */
export function segmentGraphemes(text: string): Grapheme[] {
  const out: Grapheme[] = [];
  for (const segment of graphemeSegmenter.segment(text)) {
    out.push({ segment: segment.segment, index: segment.index });
  }
  return out;
}

/** Number of grapheme clusters in `text`. */
export function countGraphemes(text: string): number {
  let count = 0;
  for (const _ of graphemeSegmenter.segment(text)) count += 1;
  return count;
}

/**
 * Maps a UTF-16 offset to the grapheme index at or after it: the first index
 * whose boundary is >= `offset`, or the grapheme count when `offset` is past
 * every boundary. Binary search over the sorted `.index` boundaries.
 */
export function codeUnitOffsetToGraphemeIndex(
  graphemes: readonly Grapheme[],
  offset: number,
): number {
  if (offset <= 0) return 0;
  let low = 0;
  let high = graphemes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (graphemes[mid]!.index >= offset) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Maps a grapheme index to its UTF-16 code-unit offset. An index at or past the
 * end maps to `textLength` (the caller supplies it because a boundary array does
 * not know where the final cluster ends). Exact for surrogate pairs, combining
 * sequences, and emoji clusters, because each grapheme carries its real index.
 */
export function graphemeIndexToCodeUnitOffset(
  graphemes: readonly Grapheme[],
  textLength: number,
  graphemeIndex: number,
): number {
  if (graphemeIndex <= 0) return 0;
  if (graphemeIndex >= graphemes.length) return textLength;
  return graphemes[graphemeIndex]!.index;
}
