import { CorruptContainerError } from './errors.ts';
import {
  codeUnitOffsetToGraphemeIndex,
  countGraphemes,
  segmentGraphemes,
  type Grapheme,
} from './graphemes.ts';

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
  return captureSegmented(segmentText(text), offset, sectionId, options);
}

/**
 * A text segmented once, shared across many captures — the batch-capture
 * invariant: graphemes and word starts are computed O(1) times per text, never
 * per sentence or per occurrence. `wordStarts` is built lazily on the first
 * word-snap (a capture at index 0 or end-of-text never needs it) and holds the
 * sorted code-unit start offset of every word segment.
 */
interface SegmentedText {
  readonly text: string;
  readonly graphemes: readonly Grapheme[];
  wordStarts: number[] | null;
}

function segmentText(text: string): SegmentedText {
  return { text, graphemes: segmentGraphemes(text), wordStarts: null };
}

/** `capturePosition` over an already-segmented text; behavior is identical. */
function captureSegmented(
  segmented: SegmentedText,
  offset: number,
  sectionId: string,
  options: CapturePositionOptions,
): Position {
  const { graphemes } = segmented;
  const total = graphemes.length;

  const rawIndex = codeUnitOffsetToGraphemeIndex(graphemes, offset);
  const start = snapToWordStart(segmented, rawIndex, options.locale);

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
 *
 * `Intl.Segmenter` follows UAX #29, which ends a "sentence" at every hard line
 * break — but the reading text is section `textContent`, whose source newlines the
 * rendered page collapses via `white-space:normal`. Segmenting it verbatim would
 * split one visual sentence at every wrapped source line (a heading or short line
 * becoming a two-word "sentence"). So adjacent Intl segments are merged until the
 * run actually ends on sentence-terminal punctuation; the anchor still spans the
 * raw text (newlines included) so it content-matches the frame's section text,
 * while the returned `text` collapses whitespace runs to single spaces for a clean
 * TTS string. Abbreviations (`J. R. R.`) still split — that break is Intl's, and a
 * period genuinely can end a sentence, so we do not second-guess it.
 */
export function segmentSentences(
  text: string,
  sectionId: string,
  options: CapturePositionOptions = {},
): SentenceRange[] {
  const out: SentenceRange[] = [];
  // Segment graphemes (and, lazily, words) once for the whole text; every
  // sentence capture reuses the same arrays instead of re-segmenting — this is
  // what keeps a long chapter linear instead of quadratic.
  const segmented = segmentText(text);

  // Accumulate a run of Intl segments and its code-unit start until the run ends on
  // sentence-terminal punctuation, then anchor over the raw span. A run start of -1
  // means no run is open (all leading/inter-sentence whitespace is skipped).
  let runStart = -1;
  let runText = '';
  const flush = (): void => {
    const trimmed = runText.replace(/\s+$/u, '');
    if (trimmed.trim().length !== 0) {
      const quoteLength = countGraphemes(trimmed);
      // Anchor over the whole (raw, newline-bearing) run so decorate highlights all
      // of it against the frame's section text.
      const position = captureSegmented(segmented, runStart, sectionId, {
        ...options,
        quoteLength,
      });
      out.push({ text: collapseWhitespace(trimmed), position });
    }
    runStart = -1;
    runText = '';
  };

  for (const segment of sentenceSegmenter(options.locale).segment(text)) {
    if (segment.segment.trim().length === 0) {
      // Whitespace-only Intl segment: part of an open run, else inter-sentence space.
      if (runStart >= 0) runText += segment.segment;
      continue;
    }
    if (runStart < 0) runStart = segment.index;
    runText += segment.segment;
    if (endsOnSentenceTerminal(runText)) flush();
  }
  if (runStart >= 0) flush();
  return out;
}

/** Sentence-final punctuation, incl. CJK and other-script terminators. */
const SENTENCE_TERMINAL = /[.!?…。！？؟।]/u;
/** Trailing closing punctuation a terminator may hide behind (quotes, brackets). */
const TRAILING_CLOSERS = /[)\]}"'”’»›]+$/u;

/**
 * Whether a run, ignoring trailing whitespace and closing punctuation, ends on a
 * sentence terminator — the seam that decides a real sentence break from a mere
 * line wrap. `"the lazy dog."` and `"he said 'go.'"` end a sentence; `"The quick
 * brown\n"` (a wrapped line) does not.
 */
function endsOnSentenceTerminal(run: string): boolean {
  const core = run.replace(/\s+$/u, '').replace(TRAILING_CLOSERS, '');
  const chars = [...core];
  const last = chars[chars.length - 1];
  return last !== undefined && SENTENCE_TERMINAL.test(last);
}

/** Collapses every run of whitespace to a single space and trims the ends. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
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
  // Segment the stored context once, outside the occurrence loop.
  const prefix = segmentGraphemes(anchor.prefix).map((g) => g.segment);
  const suffix = segmentGraphemes(anchor.suffix).map((g) => g.segment);
  let best: { offset: number; score: number } | undefined;
  for (const offset of occurrences) {
    const score = contextScore(graphemes, offset, quoteLength, prefix, suffix);
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

/**
 * Count of trailing prefix graphemes + leading suffix graphemes that still match.
 * `prefix`/`suffix` are the anchor's context pre-segmented into grapheme strings —
 * segmented once by the caller, never per occurrence.
 */
function contextScore(
  graphemes: readonly Grapheme[],
  quoteStart: number,
  quoteLength: number,
  prefix: readonly string[],
  suffix: readonly string[],
): number {
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

function wordSegmenter(locale: string | undefined): Intl.Segmenter {
  const key = locale ?? '';
  let segmenter = wordSegmenters.get(key);
  if (segmenter === undefined) {
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    wordSegmenters.set(key, segmenter);
  }
  return segmenter;
}

function join(graphemes: readonly Grapheme[], start: number, end: number): string {
  let out = '';
  for (let index = start; index < end; index += 1) out += graphemes[index]!.segment;
  return out;
}

/**
 * Snaps a grapheme index to the start of the word segment it falls in, so a
 * captured quote begins on a word boundary rather than mid-token. Word segments
 * tile the text, so the containing segment is the one with the greatest start
 * offset <= the grapheme's offset — a binary search over the word-start array,
 * which is built once per `SegmentedText` and reused by every capture.
 */
function snapToWordStart(
  segmented: SegmentedText,
  index: number,
  locale: string | undefined,
): number {
  const { graphemes } = segmented;
  if (index <= 0 || index >= graphemes.length) return index;

  if (segmented.wordStarts === null) {
    const starts: number[] = [];
    for (const word of wordSegmenter(locale).segment(segmented.text)) starts.push(word.index);
    segmented.wordStarts = starts;
  }
  const starts = segmented.wordStarts;

  const unitOffset = graphemes[index]!.index;
  // Greatest word start <= unitOffset. starts[0] is 0 and unitOffset > 0 here,
  // so the search never underflows.
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if (starts[mid]! <= unitOffset) low = mid;
    else high = mid - 1;
  }
  return codeUnitOffsetToGraphemeIndex(graphemes, starts[low]!);
}
