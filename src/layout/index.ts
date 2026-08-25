/**
 * The paginator engine: wraps a {@link ContentHost} over a container element and
 * exposes page-oriented navigation, page↔`Position` mapping, and progress on top
 * of the frame's chunked layout. This is the engine the reader facade (M2-4)
 * consumes; it owns no host vocabulary and never fetches or persists.
 *
 * Layout, measurement, chunking, and eviction all live in the frame (Slice 1 —
 * `ContentHost`); this module orchestrates them and bridges page geometry to the
 * headless `Position` model in `src/core`. Core is *called*, never changed: a page
 * maps to a `Position` through `offsetOfPage` → `capturePosition`, and a
 * `Position` maps back through `resolvePosition` → `pageOfOffset`.
 */
import { capturePosition, resolvePosition, type Position, type Section } from '../core/index.ts';
import { DEFAULT_CHUNK_CHARS } from './chunk.ts';
import { ContentHost, type ContentHostOptions } from '../view/host.ts';
import type { LayoutMode, PaginateOptions, PaginationState } from '../view/protocol.ts';

export type { LayoutMode, PaginateOptions, PaginationState } from '../view/protocol.ts';

/** How many chunks either side of the active one stay realized (eviction window). */
const DEFAULT_WINDOW_CHUNKS = 2;
/** Gap between text columns, in CSS px. */
const DEFAULT_COLUMN_GAP = 40;
/** Text columns per page. */
const DEFAULT_COLUMN_COUNT = 1;

/**
 * The parts of {@link PaginateOptions} a caller may set without also supplying
 * the viewport geometry, which the paginator measures from its container. Every
 * field is optional; unset fields fall back to the paginator defaults.
 */
export interface PaginateRequest {
  readonly mode?: LayoutMode;
  /** Page box width in CSS px. Defaults to the container's client width. */
  readonly pageWidth?: number;
  /** Page box height in CSS px. Defaults to the container's client height. */
  readonly pageHeight?: number;
  readonly columnGap?: number;
  readonly chunkChars?: number;
  readonly windowChunks?: number;
  /** Text columns per page (1 or 2). Defaults to 1. */
  readonly columnCount?: number;
}

/**
 * Chapter-local layout state: the current page, the total (estimate or firm),
 * and whether the total has been measured across every chunk yet.
 */
export interface ChapterProgress {
  readonly mode: LayoutMode;
  /** 0-based page currently shown. */
  readonly page: number;
  /** Total pages — an estimate until {@link firm}. */
  readonly totalPages: number;
  /** True once every chunk is measured; false while {@link totalPages} churns. */
  readonly firm: boolean;
  /** Fraction through the chapter, 0..1. */
  readonly fraction: number;
  readonly realizedChunks: number;
  readonly totalChunks: number;
}

/**
 * Where the reader is in the whole book. Section counts come from the facade;
 * only the current section is laid out, so any span across other sections is an
 * even-weight approximation — {@link approximate} says so.
 */
export interface BookProgress extends ChapterProgress {
  /** 0-based index of the current section in reading order. */
  readonly sectionIndex: number;
  /** Total sections in the book. */
  readonly sectionCount: number;
  /** Fraction through the book, 0..1 — even-weight across sections. */
  readonly bookFraction: number;
  /** Always true: sibling sections are unlaid, so the book span is an estimate. */
  readonly approximate: true;
}

export interface PaginatorDiagnostics {
  readonly domNodes: number;
  readonly realizedChunks: number;
  readonly totalChunks: number;
}

/** Something went wrong driving the paginator; never a book decoding failure. */
export class PaginatorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PaginatorError';
  }
}

/**
 * Drives chunked pagination of one section at a time inside a sandboxed frame.
 *
 * Lifecycle: construct over a container, {@link paginate} a section, navigate
 * with {@link goToPage}/{@link nextPage}/{@link previousPage}, map pages to
 * `Position`s, and {@link destroy} to tear the frame down. A single instance
 * paginates successive sections in turn; re-paginating replaces the active one.
 */
export class Paginator {
  readonly #host: ContentHost;
  readonly #container: HTMLElement;
  #section: Section | null = null;
  #options: PaginateOptions | null = null;
  #state: PaginationState | null = null;
  #page = 0;
  /** Cached section text, invalidated on each {@link paginate}. */
  #text: string | null = null;
  /**
   * Live decoration intent, held for the paginator lifetime so a decoration can be
   * re-anchored and re-drawn after a re-layout (font-size, mode switch, appearance).
   * Draw-only: this is the sole decoration state the engine keeps, and it never
   * leaves memory — nothing is persisted, serialized, or fetched. Keyed by the
   * caller's id; the `className` rides through to the overlay boxes.
   */
  readonly #decorations = new Map<string, { position: Position; className: string }>();

  constructor(container: HTMLElement, options: ContentHostOptions = {}) {
    this.#container = container;
    this.#host = new ContentHost(container, options);
  }

  /** The underlying host, for callers that need the raw frame surface. */
  get host(): ContentHost {
    return this.#host;
  }

  /** The section currently laid out, or `null` before the first {@link paginate}. */
  get section(): Section | null {
    return this.#section;
  }

  /** The effective options of the current layout, or `null` before {@link paginate}. */
  get options(): PaginateOptions | null {
    return this.#options;
  }

  /** The last pagination state, or `null` before {@link paginate}. */
  get state(): PaginationState | null {
    return this.#state;
  }

  /** The current 0-based page. */
  get page(): number {
    return this.#page;
  }

  /**
   * Chunks and lays out `section` under `request` (merged with the paginator
   * defaults and the container's measured viewport), resets to page 0, and
   * returns the resulting state. The page count starts as an estimate; call
   * {@link refine} to firm it up. Pass `mode: 'scrolled'` for scrolled layout.
   */
  async paginate(section: Section, request: PaginateRequest = {}): Promise<PaginationState> {
    const options = this.#resolveOptions(request);
    const state = await this.#host.paginate(section, options);
    this.#section = section;
    this.#options = options;
    this.#state = state;
    this.#page = 0;
    this.#text = null;
    await this.#redrawDecorations();
    return state;
  }

  /**
   * Re-lays the current section (after a viewport or typography change) and
   * returns the fresh state. The caller preserving position across the relayout
   * should {@link positionOfPage} before and {@link pageOfPosition} after. Text
   * is unchanged, so its cache survives.
   */
  async relayout(): Promise<PaginationState> {
    this.#requireActive();
    const state = await this.#host.relayout();
    this.#state = state;
    this.#page = clamp(this.#page, 0, Math.max(0, state.pageCount - 1));
    return state;
  }

  /**
   * Re-lays the current section in a different mode, preserving the reading
   * position across the switch: it captures a `Position` for the current page,
   * re-paginates, then seeks back to the page that `Position` now resolves to.
   * Returns the new state. A resolution miss (rare — same text, same session)
   * degrades to page 0.
   */
  async switchMode(mode: LayoutMode): Promise<PaginationState> {
    this.#requireActive();
    if (this.#options!.mode === mode) return this.relayout();
    const anchor = await this.positionOfPage(this.#page);
    const state = await this.paginate(this.#section!, { ...this.#requestFromOptions(), mode });
    const page = await this.pageOfPosition(anchor);
    if (page >= 0) await this.goToPage(page);
    return state;
  }

  /**
   * Drives the estimate toward the true count by re-measuring. In paginated mode
   * the frame refines the count as chunks realize; a `relayout` forces that
   * measurement. Returns the (possibly firm) state. Idempotent once firm.
   */
  async refine(): Promise<PaginationState> {
    this.#requireActive();
    if (this.#state!.firm) return this.#state!;
    return this.relayout();
  }

  /** Seeks to a 0-based page, clamping to range. Returns the page actually shown. */
  async goToPage(page: number): Promise<number> {
    this.#requireActive();
    const shown = await this.#host.goToPage(page);
    this.#page = shown;
    return shown;
  }

  /** Turns one page forward, clamped at the last page. Returns the new page. */
  async nextPage(): Promise<number> {
    return this.goToPage(this.#page + 1);
  }

  /** Turns one page back, clamped at page 0. Returns the new page. */
  async previousPage(): Promise<number> {
    return this.goToPage(this.#page - 1);
  }

  /**
   * The `Position` anchored at the start of `page`: page → character offset via
   * `offsetOfPage`, then `capturePosition(text, offset, sectionId)` over the
   * section text. An empty page (offset -1) captures at offset 0.
   */
  async positionOfPage(page: number): Promise<Position> {
    this.#requireActive();
    const text = await this.#sectionText();
    const offset = await this.#host.offsetOfPage(page);
    return capturePosition(text, Math.max(0, offset), this.#section!.id);
  }

  /**
   * The `Position` anchored at a frame-supplied UTF-16 offset range over the
   * section text — the bridge behind selection reporting. The frame computes the
   * range against the same tiled section text this measures against, so the
   * `start` offset is captured directly with `capturePosition` (which takes a
   * UTF-16 offset). `end` is accepted for symmetry with the wire shape; only the
   * anchor at `start` is needed to resolve the range back to a page.
   */
  async positionOfOffsetRange(start: number, _end: number): Promise<Position> {
    this.#requireActive();
    const text = await this.#sectionText();
    return capturePosition(text, Math.max(0, start), this.#section!.id);
  }

  /**
   * The 0-based page painting `position`: `resolvePosition` against the section
   * text yields a character offset, then `pageOfOffset` maps it to a page.
   * Returns -1 when the anchor no longer resolves (the caller degrades softly).
   *
   * Note the offset spaces differ: `resolvePosition` returns a *grapheme* index,
   * while `pageOfOffset` speaks UTF-16 code units. They coincide for BMP text and
   * for a text whose graphemes are all single code units; the conversion below
   * maps grapheme index back to a code-unit offset so multi-unit clusters map
   * correctly.
   */
  async pageOfPosition(position: Position): Promise<number> {
    this.#requireActive();
    const text = await this.#sectionText();
    const resolved = resolvePosition(position, text);
    if (resolved === undefined) return -1;
    const offset = graphemeIndexToCodeUnitOffset(text, resolved.offset);
    return this.#host.pageOfOffset(offset);
  }

  /**
   * The 0-based page painting the element carrying `elementId`, or -1 when no
   * element in the section carries that id (the caller degrades softly). Bridges
   * fragment anchoring: `offsetOfElementId` in the frame yields the element's
   * character offset, then `pageOfOffset` maps it to a page.
   */
  async pageOfElementId(elementId: string): Promise<number> {
    this.#requireActive();
    const offset = await this.#host.offsetOfElementId(elementId);
    if (offset < 0) return -1;
    return this.#host.pageOfOffset(offset);
  }

  /**
   * Draws a decoration over the range `position` resolves to in the current section,
   * and holds the intent so it survives a re-layout. Draw-only: the paginator keeps
   * only the in-memory intent (id → position + class) and never persists it. The
   * `position` is resolved against the frame-measured section text; its resolved
   * grapheme span is converted to a UTF-16 offset range the frame paints over. A
   * soft-miss — the anchor no longer resolves, or belongs to a section other than the
   * one laid out — draws nothing and throws nothing; the intent is still retained so a
   * later re-layout that brings the anchor back into view redraws it.
   */
  async decorate(decorationId: string, position: Position, className: string): Promise<void> {
    this.#requireActive();
    this.#decorations.set(decorationId, { position, className });
    await this.#drawDecoration(decorationId, position, className);
  }

  /** Removes a decoration and drops its intent. A no-op for an unknown id. */
  async undecorate(decorationId: string): Promise<void> {
    const existed = this.#decorations.delete(decorationId);
    if (this.#section === null) return;
    if (existed) await this.#host.undecorate(decorationId);
  }

  /**
   * Resolves `position` to a UTF-16 offset range over the section text and sends the
   * frame the draw. A resolution miss (or a `Position` from another section) is a
   * soft-miss: the frame is told to draw nothing (an empty range), never an error.
   */
  async #drawDecoration(decorationId: string, position: Position, className: string): Promise<void> {
    const text = await this.#sectionText();
    if (position.sectionId !== this.#section!.id) {
      await this.#host.undecorate(decorationId);
      return;
    }
    const resolved = resolvePosition(position, text);
    if (resolved === undefined) {
      await this.#host.undecorate(decorationId);
      return;
    }
    const start = graphemeIndexToCodeUnitOffset(text, resolved.offset);
    const end = graphemeIndexToCodeUnitOffset(text, resolved.offset + resolved.length);
    await this.#host.decorate(decorationId, start, end, className);
  }

  /**
   * Re-resolves and redraws every live decoration against the current section text —
   * the M1-2 re-anchor pipeline, reused for decorations. Called after a re-layout so
   * a highlight tracks the same text through a font-size or mode change. A decoration
   * whose section is not the active one is simply not drawn (its intent is kept).
   */
  async #redrawDecorations(): Promise<void> {
    if (this.#decorations.size === 0) return;
    for (const [decorationId, { position, className }] of this.#decorations) {
      await this.#drawDecoration(decorationId, position, className);
    }
  }

  /** Within-chapter progress: current page, total (estimate/firm), and fraction. */
  chapterProgress(): ChapterProgress {
    this.#requireActive();
    const state = this.#state!;
    const totalPages = Math.max(1, state.pageCount);
    return {
      mode: this.#options!.mode,
      page: this.#page,
      totalPages: state.pageCount,
      firm: state.firm,
      fraction: totalPages <= 1 ? 0 : this.#page / (totalPages - 1),
      realizedChunks: state.realizedChunks,
      totalChunks: state.totalChunks,
    };
  }

  /**
   * Within-book progress. The facade supplies the current section's index and the
   * book's section count; only this section is laid out, so the book fraction is
   * an even-weight approximation across sections and {@link BookProgress.approximate}
   * is always true.
   */
  bookProgress(sectionIndex: number, sectionCount: number): BookProgress {
    const chapter = this.chapterProgress();
    const sections = Math.max(1, sectionCount);
    const bookFraction = clamp((sectionIndex + chapter.fraction) / sections, 0, 1);
    return { ...chapter, sectionIndex, sectionCount, bookFraction, approximate: true };
  }

  /**
   * Applies a new appearance theme stylesheet (see `themeStyleSheet`) to the
   * current section, preserving the reading position across the swap. A theme is
   * colours + background only, so chunk geometry is invariant under it: the same
   * markup re-lays out to the same page count and the captured `Position` resolves
   * back to the exact same page — the reader's place is held, not reset to 0 and
   * not drifted, and the text does not reflow. The theme lives in the srcdoc (not
   * over the wire), so it re-assembles the document; because geometry is invariant
   * the anchor page is restored precisely. Before the first `paginate` it only
   * records the theme for the next render.
   *
   * A no-op when the stylesheet is unchanged, so re-issuing the same appearance is
   * free.
   */
  async setThemeCss(themeCss: string | undefined): Promise<void> {
    if (this.#host.themeCss === themeCss) return;
    await this.#reapply(themeCss, this.#options?.columnCount, this.#options?.columnGap);
  }

  /**
   * Applies a live appearance change that may re-flow the layout — a new
   * appearance stylesheet (font/size/line-height/alignment/hyphenation) and/or a
   * new `columnCount` — preserving the reading position across it. Unlike
   * {@link setThemeCss} (colours only, geometry invariant), a reflowing knob
   * changes chunk geometry, so this reuses the same capture → re-layout → resolve →
   * restore machinery as {@link switchMode}: it captures a `Position` for the
   * current page, re-paginates with the new stylesheet and column count, and seeks
   * back to the page that `Position` now resolves to. A same-text resolution miss
   * degrades to page 0. Before the first `paginate` it only records the stylesheet
   * for the next render. A no-op (same stylesheet, same column count) short-
   * circuits, so re-issuing the same appearance is free.
   */
  async applyAppearance(
    themeCss: string | undefined,
    geometry: { columnCount?: number; columnGap?: number } = {},
  ): Promise<void> {
    const nextColumns = geometry.columnCount ?? this.#options?.columnCount;
    const nextGap = geometry.columnGap ?? this.#options?.columnGap;
    const sameCss = this.#host.themeCss === themeCss;
    const sameColumns = this.#options === null || this.#options.columnCount === nextColumns;
    const sameGap = this.#options === null || this.#options.columnGap === nextGap;
    if (sameCss && sameColumns && sameGap) return;
    await this.#reapply(themeCss, nextColumns, nextGap);
  }

  /**
   * Sets the stylesheet and column geometry, re-paginates the current section, and
   * restores the reading position by content anchor. Shared by {@link setThemeCss}
   * (geometry invariant, exact page restored) and {@link applyAppearance} (geometry
   * may change, nearest anchor page restored). Records the stylesheet and returns
   * before the first `paginate` when no section is laid out yet.
   */
  async #reapply(
    themeCss: string | undefined,
    columnCount: number | undefined,
    columnGap: number | undefined,
  ): Promise<void> {
    this.#host.setThemeCss(themeCss);
    if (this.#section === null || this.#options === null) return;
    const nextColumns = columnCount ?? this.#options.columnCount;
    const nextGap = columnGap ?? this.#options.columnGap;
    const options: PaginateOptions =
      nextColumns === this.#options.columnCount && nextGap === this.#options.columnGap
        ? this.#options
        : { ...this.#options, columnCount: nextColumns, columnGap: nextGap };
    const anchor = await this.positionOfPage(this.#page);
    const state = await this.#host.paginate(this.#section, options);
    this.#options = options;
    this.#state = state;
    this.#text = null;
    const page = await this.pageOfPosition(anchor);
    await this.goToPage(page >= 0 ? page : 0);
    await this.#redrawDecorations();
  }

  /** Frame-side counts, for eviction/memory checks. Eviction itself lives in-frame. */
  async diagnostics(): Promise<PaginatorDiagnostics> {
    this.#requireActive();
    return this.#host.diagnostics();
  }

  /** The section's concatenated chunk text, as the frame measures it (cached). */
  async sectionText(): Promise<string> {
    this.#requireActive();
    return this.#sectionText();
  }

  /** Tears down the underlying host and frame. Idempotent. */
  destroy(): void {
    this.#host.destroy();
    this.#section = null;
    this.#options = null;
    this.#state = null;
    this.#text = null;
    this.#decorations.clear();
  }

  async #sectionText(): Promise<string> {
    if (this.#text === null) this.#text = await this.#host.sectionText();
    return this.#text;
  }

  #resolveOptions(request: PaginateRequest): PaginateOptions {
    return {
      mode: request.mode ?? 'paginated',
      pageWidth: request.pageWidth ?? this.#container.clientWidth,
      pageHeight: request.pageHeight ?? this.#container.clientHeight,
      columnGap: request.columnGap ?? DEFAULT_COLUMN_GAP,
      chunkChars: request.chunkChars ?? DEFAULT_CHUNK_CHARS,
      windowChunks: request.windowChunks ?? DEFAULT_WINDOW_CHUNKS,
      columnCount: request.columnCount ?? DEFAULT_COLUMN_COUNT,
    };
  }

  #requestFromOptions(): PaginateRequest {
    const options = this.#options!;
    return {
      pageWidth: options.pageWidth,
      pageHeight: options.pageHeight,
      columnGap: options.columnGap,
      chunkChars: options.chunkChars,
      windowChunks: options.windowChunks,
      columnCount: options.columnCount,
    };
  }

  #requireActive(): void {
    if (this.#section === null || this.#options === null || this.#state === null) {
      throw new PaginatorError('no section is paginated; call paginate() first');
    }
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Maps a grapheme index (as `resolvePosition` returns) to a UTF-16 code-unit
 * offset (as `pageOfOffset` and `offsetOfPage` speak) in `text`. `Intl.Segmenter`
 * carries each grapheme's code-unit index, so the mapping is exact for surrogate
 * pairs, combining sequences, and emoji clusters. An index at or past the end
 * maps to the text length.
 */
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemeIndexToCodeUnitOffset(text: string, graphemeIndex: number): number {
  if (graphemeIndex <= 0) return 0;
  let index = 0;
  for (const segment of GRAPHEME_SEGMENTER.segment(text)) {
    if (index === graphemeIndex) return segment.index;
    index += 1;
  }
  return text.length;
}
