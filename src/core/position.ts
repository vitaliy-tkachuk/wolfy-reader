import { CorruptContainerError } from './errors.ts';

/**
 * A content-addressed anchor into a section's text, Hypothesis-style. A match is
 * found by content (the exact quote plus surrounding context), never by offset:
 * `offset` exists only to break ties between identical quotes and is never
 * load-bearing on its own.
 */
export interface TextAnchor {
  /** The verbatim run of text the position points at. */
  readonly exact: string;
  /** Text immediately before `exact`, bounded length; boundary-snapped. */
  readonly prefix: string;
  /** Text immediately after `exact`, bounded length; boundary-snapped. */
  readonly suffix: string;
  /**
   * Grapheme-cluster offset of `exact` within the section text. A tiebreak only —
   * used to pick among duplicate quotes, never to locate a match alone.
   */
  readonly offset: number;
}

/**
 * A reading position within a book. Its `serialized` form is an opaque string a
 * host persists verbatim and never parses; `progress` rides alongside for host
 * UI (scrollbars, "42%") without decoding the string. Backed by a content anchor
 * so it survives reflow, font-size, and layout changes.
 */
export interface Position {
  /** The section this position falls in. */
  readonly sectionId: string;
  /** Fraction through the section, 0..1. For host progress UI only. */
  readonly progress: number;
  /** Opaque, versioned, round-trippable interchange string. Hosts store it as-is. */
  readonly serialized: string;
  /** The content anchor. Resolution matches on this, not on `progress`. */
  readonly anchor: TextAnchor;
}

/**
 * Where a `Position` resolved to in a piece of target text. Offsets are grapheme
 * indices into that text, matching `TextAnchor.offset`. A resolution *miss* is not
 * this type — it is `undefined`, returned by `resolvePosition`.
 */
export interface ResolvedPosition {
  readonly sectionId: string;
  /** Grapheme index where the matched quote starts in the target text. */
  readonly offset: number;
  /** Length of the matched quote in graphemes. */
  readonly length: number;
}

export interface CapturePositionOptions {
  /**
   * Locale for `Intl.Segmenter` word snapping. Defaults to the runtime default
   * locale. Grapheme snapping is locale-independent.
   */
  readonly locale?: string;
  /** Maximum length (in graphemes) of the captured quote. */
  readonly quoteLength?: number;
  /** Maximum length (in graphemes) of each context window. */
  readonly contextLength?: number;
}

const DEFAULT_QUOTE_LENGTH = 32;
const DEFAULT_CONTEXT_LENGTH = 32;

/** Version tag that leads every serialized position. Version-first, non-negotiable. */
const SERIAL_PREFIX = 'wr1:';
const SERIAL_VERSION = 1;

interface SerialPayload {
  readonly v: number;
  readonly s: string;
  readonly p: number;
  readonly e: string;
  readonly pre: string;
  readonly suf: string;
  readonly o: number;
}

/**
 * Captures a `Position` at `offset` in a section's plain text. Core is headless:
 * the caller supplies already-extracted text and a UTF-16 code-unit offset into
 * it; no DOM, HTML, or Range is touched here. The offset is snapped to grapheme
 * and word boundaries with `Intl.Segmenter` so an anchor never splits a surrogate
 * pair, combining sequence, or emoji cluster.
 */
export function capturePosition(
  text: string,
  offset: number,
  sectionId: string,
  options: CapturePositionOptions = {},
): Position {
  const graphemes = segmentGraphemes(text);
  const total = graphemes.length;

  const rawIndex = codeUnitOffsetToGraphemeIndex(graphemes, offset);
  const start = snapToWordStart(text, graphemes, rawIndex, options.locale);

  const quoteLength = options.quoteLength ?? DEFAULT_QUOTE_LENGTH;
  const contextLength = options.contextLength ?? DEFAULT_CONTEXT_LENGTH;

  const quoteEnd = Math.min(start + quoteLength, total);
  const prefixStart = Math.max(start - contextLength, 0);
  const suffixEnd = Math.min(quoteEnd + contextLength, total);

  const anchor: TextAnchor = {
    exact: join(graphemes, start, quoteEnd),
    prefix: join(graphemes, prefixStart, start),
    suffix: join(graphemes, quoteEnd, suffixEnd),
    offset: start,
  };

  const progress = total === 0 ? 0 : start / total;

  return {
    sectionId,
    progress,
    anchor,
    serialized: serializeParts(sectionId, progress, anchor),
  };
}

/** Serializes a position to its opaque, versioned interchange string. */
export function serializePosition(position: Position): string {
  return serializeParts(position.sectionId, position.progress, position.anchor);
}

/** One sentence of a section, with a `Position` anchored over its whole span. */
export interface SentenceRange {
  /** The sentence text, trailing whitespace trimmed. */
  readonly text: string;
  /**
   * A `Position` whose anchored quote is the whole sentence, so `resolvePosition`
   * returns its full span — a host can `goTo` it (jump) and `decorate` it
   * (highlight the entire sentence, not just its start).
   */
  readonly position: Position;
}

/**
 * Segments a section's plain text into sentences with `Intl.Segmenter`, each
 * carrying a `Position` anchored over the whole sentence. This is the TTS *enabler*
 * (PLAN M3-6): the library exposes sentence ranges and reuses `decorate` as the
 * highlight primitive so a host can build text-to-speech on top — it speaks nothing
 * and stores nothing. Whitespace-only segments are dropped. Headless: the caller
 * supplies already-extracted text, exactly like `capturePosition`.
 */
export function segmentSentences(
  text: string,
  sectionId: string,
  options: CapturePositionOptions = {},
): SentenceRange[] {
  const out: SentenceRange[] = [];
  for (const segment of sentenceSegmenter(options.locale).segment(text)) {
    const trimmed = segment.segment.replace(/\s+$/u, '');
    if (trimmed.trim().length === 0) continue;
    const quoteLength = countGraphemes(trimmed);
    // Anchor the quote over the whole sentence so decorate highlights all of it.
    const position = capturePosition(text, segment.index, sectionId, { ...options, quoteLength });
    out.push({ text: trimmed, position });
  }
  return out;
}

/**
 * Parses a serialized position back into a `Position`. Round-trips losslessly
 * with `serializePosition`. Throws `CorruptContainerError` when the string is
 * malformed or carries an unknown version — a version this reader cannot honor is
 * a structural failure the host catches by class, distinct from a resolution miss
 * (which the resolver returns as a value, never an error).
 */
export function parsePosition(serialized: string): Position {
  if (!serialized.startsWith(SERIAL_PREFIX)) {
    throw new CorruptContainerError(
      `not a wolfyReader position: missing '${SERIAL_PREFIX}' version prefix`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(serialized.slice(SERIAL_PREFIX.length));
  } catch (cause) {
    throw new CorruptContainerError('position payload is not valid JSON', { cause });
  }

  if (!isSerialPayload(payload)) {
    throw new CorruptContainerError('position payload is missing required fields');
  }
  if (payload.v !== SERIAL_VERSION) {
    throw new CorruptContainerError(
      `unsupported position version ${payload.v}; this reader understands version ${SERIAL_VERSION}`,
    );
  }

  const anchor: TextAnchor = {
    exact: payload.e,
    prefix: payload.pre,
    suffix: payload.suf,
    offset: payload.o,
  };
  return { sectionId: payload.s, progress: payload.p, anchor, serialized };
}

/**
 * Resolves a `Position` against a piece of section text — which may have changed
 * since capture — returning where its anchor now lands, or `undefined` when the
 * quote is gone. A miss is a value, never a throw: matching live content is an
 * expected outcome the caller degrades on (skip the restore, drop the decoration),
 * mirroring `Section.resolve()` returning `undefined`.
 *
 * The match is by content. Every occurrence of the exact quote is found, then
 * scored by how much of the stored prefix/suffix context still surrounds it; the
 * best-scoring occurrence wins. The stored offset breaks a tie only when context
 * cannot — it never selects a location the content contradicts.
 */
export function resolvePosition(
  position: Position,
  text: string,
): ResolvedPosition | undefined {
  const { anchor, sectionId } = position;
  const graphemes = segmentGraphemes(text);

  if (anchor.exact === '') {
    const offset = Math.min(anchor.offset, graphemes.length);
    return { sectionId, offset, length: 0 };
  }

  const occurrences = findGraphemeOccurrences(graphemes, anchor.exact);
  if (occurrences.length === 0) return undefined;

  const quoteLength = segmentGraphemes(anchor.exact).length;
  let best: { offset: number; score: number } | undefined;
  for (const offset of occurrences) {
    const score = contextScore(graphemes, offset, quoteLength, anchor);
    if (
      best === undefined ||
      score > best.score ||
      (score === best.score &&
        Math.abs(offset - anchor.offset) < Math.abs(best.offset - anchor.offset))
    ) {
      best = { offset, score };
    }
  }

  return { sectionId, offset: best!.offset, length: quoteLength };
}

/** Grapheme start indices at which `quote` occurs in `graphemes`. */
function findGraphemeOccurrences(graphemes: Grapheme[], quote: string): number[] {
  const quoteGraphemes = segmentGraphemes(quote).map((g) => g.segment);
  const hits: number[] = [];
  if (quoteGraphemes.length === 0) return hits;
  const last = graphemes.length - quoteGraphemes.length;
  for (let start = 0; start <= last; start += 1) {
    let matched = true;
    for (let offset = 0; offset < quoteGraphemes.length; offset += 1) {
      if (graphemes[start + offset]!.segment !== quoteGraphemes[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) hits.push(start);
  }
  return hits;
}

/** Count of trailing prefix graphemes + leading suffix graphemes that still match. */
function contextScore(
  graphemes: Grapheme[],
  quoteStart: number,
  quoteLength: number,
  anchor: TextAnchor,
): number {
  const prefix = segmentGraphemes(anchor.prefix).map((g) => g.segment);
  const suffix = segmentGraphemes(anchor.suffix).map((g) => g.segment);

  let score = 0;
  for (let back = 1; back <= prefix.length; back += 1) {
    const here = graphemes[quoteStart - back];
    const want = prefix[prefix.length - back];
    if (here === undefined || here.segment !== want) break;
    score += 1;
  }
  const afterStart = quoteStart + quoteLength;
  for (let ahead = 0; ahead < suffix.length; ahead += 1) {
    const here = graphemes[afterStart + ahead];
    if (here === undefined || here.segment !== suffix[ahead]) break;
    score += 1;
  }
  return score;
}

function serializeParts(sectionId: string, progress: number, anchor: TextAnchor): string {
  const payload: SerialPayload = {
    v: SERIAL_VERSION,
    s: sectionId,
    p: progress,
    e: anchor.exact,
    pre: anchor.prefix,
    suf: anchor.suffix,
    o: anchor.offset,
  };
  return SERIAL_PREFIX + JSON.stringify(payload);
}

function isSerialPayload(value: unknown): value is SerialPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.v === 'number' &&
    typeof record.s === 'string' &&
    typeof record.p === 'number' &&
    typeof record.e === 'string' &&
    typeof record.pre === 'string' &&
    typeof record.suf === 'string' &&
    typeof record.o === 'number'
  );
}

/** A grapheme cluster together with its UTF-16 code-unit offset in the text. */
interface Grapheme {
  readonly segment: string;
  readonly index: number;
}

const graphemeSegmenters = new Map<string, Intl.Segmenter>();
const wordSegmenters = new Map<string, Intl.Segmenter>();
const sentenceSegmenters = new Map<string, Intl.Segmenter>();

function sentenceSegmenter(locale: string | undefined): Intl.Segmenter {
  const key = locale ?? '';
  let segmenter = sentenceSegmenters.get(key);
  if (segmenter === undefined) {
    segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
    sentenceSegmenters.set(key, segmenter);
  }
  return segmenter;
}

function countGraphemes(text: string): number {
  let count = 0;
  for (const _ of graphemeSegmenter().segment(text)) count += 1;
  return count;
}

function graphemeSegmenter(): Intl.Segmenter {
  let segmenter = graphemeSegmenters.get('');
  if (segmenter === undefined) {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    graphemeSegmenters.set('', segmenter);
  }
  return segmenter;
}

function wordSegmenter(locale: string | undefined): Intl.Segmenter {
  const key = locale ?? '';
  let segmenter = wordSegmenters.get(key);
  if (segmenter === undefined) {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    wordSegmenters.set(key, segmenter);
  }
  return segmenter;
}

function segmentGraphemes(text: string): Grapheme[] {
  const out: Grapheme[] = [];
  for (const segment of graphemeSegmenter().segment(text)) {
    out.push({ segment: segment.segment, index: segment.index });
  }
  return out;
}

function join(graphemes: Grapheme[], start: number, end: number): string {
  let out = '';
  for (let index = start; index < end; index += 1) out += graphemes[index]!.segment;
  return out;
}

/** Maps a UTF-16 offset to the grapheme index at or after it. */
function codeUnitOffsetToGraphemeIndex(graphemes: Grapheme[], offset: number): number {
  if (offset <= 0) return 0;
  for (let index = 0; index < graphemes.length; index += 1) {
    if (graphemes[index]!.index >= offset) return index;
  }
  return graphemes.length;
}

/**
 * Snaps a grapheme index to the start of the word segment it falls in, so a
 * captured quote begins on a word boundary rather than mid-token.
 */
function snapToWordStart(
  text: string,
  graphemes: Grapheme[],
  index: number,
  locale: string | undefined,
): number {
  if (index <= 0 || index >= graphemes.length) return index;

  const unitOffset = graphemes[index]!.index;
  let start = 0;
  for (const word of wordSegmenter(locale).segment(text)) {
    const wordEnd = word.index + word.segment.length;
    if (word.index <= unitOffset && unitOffset < wordEnd) {
      start = word.index;
      break;
    }
    if (word.index > unitOffset) break;
    start = word.index;
  }
  return codeUnitOffsetToGraphemeIndex(graphemes, start);
}
