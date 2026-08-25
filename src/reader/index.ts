/**
 * The public reader facade: opens a decoded {@link Book} into a container element
 * and returns a {@link Reader} that turns pages and sections, navigates to any
 * target, follows internal links with a back-stack, reports position, emits
 * events, and switches paginated↔scrolled without losing the reader's place.
 *
 * This module lives *outside* `src/core` on purpose. Core is headless by rule —
 * nothing reachable from `src/core/index.ts` may import `src/view` or `src/layout`
 * (`npm run check:core`). The PLAN §4 sketch shows `book.render(...)`; that method
 * cannot exist on the core `Book`, so the shape is relocated here as a free
 * function `render(book, element, options)` keeping the sketched object surface
 * (`next/prev`, `nextSection/prevSection`, `goTo`, `back`, `position`, `on`,
 * `setMode`, `destroy`).
 *
 * The facade owns no format vocabulary and never fetches or persists: bytes came
 * in as a `Book`, page geometry comes from the {@link Paginator}, and reading
 * positions are the headless `Position` model from core. It drives the paginator
 * and reads the book; it never reaches past the paginator into frame geometry.
 */
import type { Book, Position, ReadingDirection, Section, SentenceRange, TocItem } from '../core/index.ts';
import { parsePosition, segmentSentences } from '../core/index.ts';
import { Paginator, type BookProgress, type LayoutMode } from '../layout/index.ts';
import { searchBook, type SearchHit, type SearchOptions } from '../search/index.ts';
import {
  isReflowingUpdate,
  mergeAppearance,
  themeStyleSheet,
  type Appearance,
  type TextAlign,
  type ThemeName,
} from '../view/appearance.ts';
import {
  keyIntent,
  swipeIntent,
  tapIntent,
  type InputConfig,
  type NavIntent,
  type TapZones,
} from './input.ts';

export type { InputConfig, TapZones } from './input.ts';
export type { Appearance, TextAlign, ThemeName } from '../view/appearance.ts';
export type { SearchHit, SearchOptions } from '../search/index.ts';

/**
 * Appearance and layout options for {@link render}. All optional. `mode` selects
 * paginated (default) or scrolled layout. The theme and typography fields drive
 * the appearance system and are applied at the first render; change any of them
 * live afterward with {@link Reader.setAppearance}.
 */
export interface ReaderOptions {
  /** 'paginated' (default) or 'scrolled'. */
  readonly mode?: LayoutMode;
  /**
   * The theme applied to content: `'light' | 'dark' | 'sepia' | 'custom'`. Omit
   * to follow the OS (`prefers-color-scheme`); a named theme overrides it. Change
   * it live with {@link Reader.setAppearance}.
   */
  readonly theme?: ThemeName;
  /**
   * Bespoke `--wr-*` CSS custom properties, merged over the resolved theme. The
   * escape hatch for a custom theme; keys may omit the leading `--`.
   */
  readonly customProperties?: Readonly<Record<string, string>>;
  /** Body font size in CSS px. Applied at the first render; change it live with {@link Reader.setAppearance}. */
  readonly fontSize?: number;
  /** Body font family. Applied at the first render. */
  readonly fontFamily?: string;
  /** Body line height (unitless multiplier). Applied at the first render. */
  readonly lineHeight?: number;
  /** Column gap in CSS px, passed through to the paginator as the page margin. */
  readonly margin?: number;
  /** Body text alignment: `'start'` (publisher default) or `'justify'`. */
  readonly textAlign?: TextAlign;
  /** Shorthand for `textAlign: 'justify'`. */
  readonly justify?: boolean;
  /** Whether the content root hyphenates. */
  readonly hyphenate?: boolean;
  /** Text columns per page: 1 (default) or 2. Applied at the first render. */
  readonly columns?: 1 | 2;
  /** Where to open. Any {@link GoToTarget}; defaults to the book's start. */
  readonly start?: GoToTarget;
  /**
   * Human-input configuration: keyboard, swipe, tap zones. Additive and optional
   * — omitting it enables all three with defaults. See {@link InputConfig}. Input
   * is direction-aware: `Book.direction === 'rtl'` flips the horizontal axis.
   */
  readonly input?: InputConfig;
}

/**
 * A navigation target for {@link Reader.goTo}. Six forms:
 * - {@link TocItem} — its `sectionId` (+ optional `fragment`)
 * - internal `href` string — resolved to a section (+ fragment), best-effort
 * - {@link Position} — restored by content anchor
 * - a number in `0..1` — a fraction through the whole book
 * - `'start'` — the first section, first page
 * - `'end'` — the last section, last page
 */
export type GoToTarget = TocItem | Position | string | number | 'start' | 'end';

/** The reader's place in the book, assembled from the paginator and the book. */
export interface ReaderPosition {
  /** 0-based index of the active section in reading order. */
  readonly section: number;
  /** Fraction through the whole book, 0..1 — approximate across unlaid sections. */
  readonly progress: number;
  /** Fraction through the current chapter, 0..1. */
  readonly chapterProgress: number;
  /** 0-based current page within the section. */
  readonly page: number;
  /** Total pages in the section — an estimate until the layout is firm. */
  readonly totalPages: number;
}

/** The events a {@link Reader} emits, with their payload types. */
export interface ReaderEventMap {
  /** Fires once, after the first section paints. Payload: the initial position. */
  readonly ready: ReaderPosition;
  /** Fires after any navigation settles. Payload: the settled position. */
  readonly positionchange: ReaderPosition;
  /** Fires when the active section changes. Payload: the new section index + id. */
  readonly sectionchange: SectionChange;
  /** Fires when an in-frame link is clicked, before it is followed. Payload: the raw href. */
  readonly linkclick: LinkClick;
  /** Fires when the user selects text in the frame. Payload: the text + a resolvable Position. */
  readonly selection: SelectionEvent;
  /** Fires when a navigation or render fails. Payload: the error. */
  readonly error: Error;
}

export interface SectionChange {
  /** 0-based index of the now-active section. */
  readonly index: number;
  /** The now-active section's id. */
  readonly sectionId: string;
}

export interface LinkClick {
  /** The raw authored href from the frame, exactly as reported. */
  readonly href: string;
}

export interface SelectionEvent {
  /** The selected text, exactly as the frame read it. */
  readonly text: string;
  /**
   * A `Position` anchored at the selection's start. Resolves back against the
   * section via {@link Reader.goTo}/`resolvePosition`, so a host can persist it
   * (a bookmark or highlight anchor) and navigate to it later.
   */
  readonly position: Position;
}

export type ReaderEvent = keyof ReaderEventMap;
export type ReaderEventHandler<E extends ReaderEvent> = (payload: ReaderEventMap[E]) => void;
/** Removes a previously-registered handler. Idempotent. */
export type Unsubscribe = () => void;

/**
 * A live reader over one book. Navigation methods are async and settle once the
 * paginator has moved and the corresponding events have fired. Reads of
 * {@link position} are synchronous snapshots of the last settled state.
 */
export interface Reader {
  /** Turn one page forward, rolling to the next section's first page at the end. */
  next(): Promise<void>;
  /** Turn one page back, rolling to the previous section's last page at the start. */
  prev(): Promise<void>;
  /** Jump to the next section's first page. No-op at the last section. */
  nextSection(): Promise<void>;
  /** Jump to the previous section's first page. No-op at the first section. */
  prevSection(): Promise<void>;
  /** Navigate to any of the six {@link GoToTarget} forms. Soft-misses degrade quietly. */
  goTo(target: GoToTarget): Promise<void>;
  /** Pop the internal-link back-stack and restore the pushed position. No-op when empty. */
  back(): Promise<void>;
  /** Switch paginated↔scrolled without reload, preserving the reading position. */
  setMode(mode: LayoutMode): Promise<void>;
  /**
   * Update the live appearance without losing the reading place. Covers the theme
   * half (colours / background) and the typography half (font family/size, line
   * height, margin, text alignment, justification, hyphenation, 1-or-2 columns).
   * Partial: only the fields present in `appearance` change; `customProperties`
   * shallow-merges over the current set. A colour-only change repaints the current
   * page in place with no reflow; a reflowing typography knob (font, size, line
   * height, columns) re-lays out and restores the reading place by content anchor,
   * so the place survives even though the page number may shift.
   */
  setAppearance(appearance: Appearance): Promise<void>;
  /**
   * Full-text search over the whole book. Returns a **lazy async iterator** of
   * {@link SearchHit}s, streaming each as its section is scanned — the book is never
   * buffered whole, and stopping early (`break`) halts the scan (no later section is
   * loaded). Each hit's `position` is jumpable: `await reader.goTo(hit.position)`
   * lands on its page. Matching is normalized literal substring (case-insensitive,
   * NFC, smart-punctuation- and whitespace-folded); it does not route through the
   * frame — sections are decoded and scanned headlessly, independent of what is
   * painted.
   */
  search(query: string, options?: SearchOptions): AsyncIterableIterator<SearchHit>;
  /**
   * Draws a decoration — a styled overlay — over the range `position` resolves to,
   * keyed by `id`. Re-issuing the same `id` replaces that overlay; the `className`
   * on `opts` is applied to every overlay box so a host stylesheet can colour it.
   *
   * **Draw-only, never stored.** The reader holds the decoration *intent* (id →
   * position + class) in memory only, so it can re-anchor the overlay across a
   * re-layout (font-size, mode, appearance) — it never persists, serializes, or
   * fetches annotation data. A host owns all annotation storage: to make a highlight
   * durable, persist the `position` (or its serialized string) yourself and re-call
   * `decorate` on the next open. The overlay is pointer-transparent and layout-
   * neutral: it never eats a selection or a click and never changes page geometry.
   *
   * A soft-miss — the anchor no longer resolves, or it belongs to a section other
   * than the one on screen — draws nothing and throws nothing; the intent is kept, so
   * navigating to that section (or re-laying out) redraws it.
   */
  decorate(id: string, position: Position, opts: { className: string }): Promise<void>;
  /** Removes the decoration drawn for `id` and drops its intent. No-op for an unknown id. */
  undecorate(id: string): Promise<void>;
  /**
   * Sentence ranges for the current section, each with a `Position` anchored over
   * the whole sentence. The **TTS enabler**: pair a sentence's `position` with
   * {@link goTo} to jump and {@link decorate} to highlight it, and a host can step
   * a speech engine sentence-by-sentence over the reading view. The library speaks
   * nothing and stores nothing — it exposes ranges only. Returns `[]` before the
   * first paint or for an empty section.
   */
  sentences(): Promise<readonly SentenceRange[]>;
  /** A synchronous snapshot of the current place in the book. */
  readonly position: ReaderPosition;
  /** The layout mode currently in effect. */
  readonly mode: LayoutMode;
  /** Subscribe to an event; returns an unsubscribe function. */
  on<E extends ReaderEvent>(event: E, handler: ReaderEventHandler<E>): Unsubscribe;
  /** Tear everything down: paginator, frame, data: URLs, listeners, back-stack. Idempotent. */
  destroy(): void;
}

/** Something went wrong driving the reader; never a book decoding failure. */
export class ReaderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReaderError';
  }
}

/**
 * Renders `book` into `element` and returns a live {@link Reader}. The reader is
 * usable immediately; the first section paints asynchronously and a `ready` event
 * fires once it does. Options are applied where they map today and otherwise
 * retained for M3. Pass `options.start` to open somewhere other than the book's
 * beginning.
 */
export function render(book: Book, element: HTMLElement, options: ReaderOptions = {}): Reader {
  return new ReaderImpl(book, element, options);
}

/** Split a raw href into its path (fragment removed) and optional fragment. */
function splitFragment(href: string): { path: string; fragment?: string } {
  const hash = href.indexOf('#');
  if (hash === -1) return { path: href };
  return { path: href.slice(0, hash), fragment: decodeFragment(href.slice(hash + 1)) };
}

function decodeFragment(fragment: string): string {
  if (!fragment.includes('%')) return fragment;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** The last path segment of a reference, e.g. '../text/c3.xhtml' → 'c3.xhtml'. */
function lastSegment(path: string): string {
  const clean = path.replace(/[?].*$/, '');
  const slash = clean.lastIndexOf('/');
  return slash === -1 ? clean : clean.slice(slash + 1);
}

/** Strip a single trailing file extension: 'c3.xhtml' → 'c3'. */
function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

class ReaderImpl implements Reader {
  readonly #book: Book;
  readonly #paginator: Paginator;
  readonly #element: HTMLElement;
  readonly #sections: readonly Section[];
  readonly #options: ReaderOptions;
  readonly #listeners: { [E in ReaderEvent]: Set<ReaderEventHandler<E>> } = {
    ready: new Set(),
    positionchange: new Set(),
    sectionchange: new Set(),
    linkclick: new Set(),
    selection: new Set(),
    error: new Set(),
  };
  /** Internal-link back-stack: positions to return to via {@link back}. */
  #backStack: Position[] = [];
  #sectionIndex = 0;
  #mode: LayoutMode;
  #destroyed = false;
  #ready = false;
  /** Live appearance state (theme half). Merged by {@link setAppearance}. */
  #appearance: Appearance;
  /** Reading direction; drives the RTL flip in every input mode. */
  readonly #direction: ReadingDirection;
  /** Resolved input config: which modes are on and the tap-zone geometry. */
  readonly #keyboard: boolean;
  readonly #swipe: boolean;
  readonly #tapZones: TapZones | null;
  /** Serializes navigation so overlapping calls settle in order. */
  #queue: Promise<unknown> = Promise.resolve();
  /** The host-side image-zoom overlay, mounted lazily on the first image tap. */
  #zoom: ImageZoom | null = null;

  constructor(book: Book, element: HTMLElement, options: ReaderOptions) {
    this.#book = book;
    this.#element = element;
    this.#sections = book.sections;
    this.#options = options;
    this.#mode = options.mode ?? 'paginated';
    this.#direction = book.direction ?? 'ltr';
    const input = options.input ?? {};
    this.#keyboard = input.keyboard ?? true;
    this.#swipe = input.swipe ?? true;
    this.#tapZones = input.tapZones === false ? null : (input.tapZones ?? {});
    // Seed the live appearance from the options. Only keys that were supplied are
    // carried — `exactOptionalPropertyTypes` keeps "follow the OS" (theme absent)
    // distinct from a forced theme, and an unset typography knob from a forced one.
    // The typography half is applied at the first render (below), not merely
    // retained: the seeded stylesheet rides the opening srcdoc and `columns` drives
    // the opening paginate.
    this.#appearance = {};
    if (options.theme !== undefined) this.#appearance = { ...this.#appearance, theme: options.theme };
    if (options.customProperties !== undefined) {
      this.#appearance = { ...this.#appearance, customProperties: options.customProperties };
    }
    if (options.fontFamily !== undefined) this.#appearance = { ...this.#appearance, fontFamily: options.fontFamily };
    if (options.fontSize !== undefined) this.#appearance = { ...this.#appearance, fontSize: options.fontSize };
    if (options.lineHeight !== undefined) this.#appearance = { ...this.#appearance, lineHeight: options.lineHeight };
    if (options.margin !== undefined) this.#appearance = { ...this.#appearance, margin: options.margin };
    if (options.textAlign !== undefined) this.#appearance = { ...this.#appearance, textAlign: options.textAlign };
    if (options.justify !== undefined) this.#appearance = { ...this.#appearance, justify: options.justify };
    if (options.hyphenate !== undefined) this.#appearance = { ...this.#appearance, hyphenate: options.hyphenate };
    if (options.columns !== undefined) this.#appearance = { ...this.#appearance, columns: options.columns };
    this.#paginator = new Paginator(element, {
      themeCss: themeStyleSheet(this.#appearance),
      onLinkClick: (href) => {
        void this.#onLinkClick(href);
      },
      onError: (message) => {
        this.#emit('error', new ReaderError(message));
      },
      onKey: (key) => {
        if (this.#keyboard) this.#dispatchIntent(keyIntent(key, this.#direction));
      },
      onSwipe: (dx, dy) => {
        if (this.#swipe) this.#dispatchIntent(swipeIntent(dx, dy, this.#direction));
      },
      onTap: (tap) => {
        if (this.#tapZones !== null) {
          this.#dispatchIntent(tapIntent(tap, this.#tapZones, this.#direction));
        }
      },
      onImageTap: (image) => {
        this.#openZoom(image);
      },
      onSelection: (selection) => {
        void this.#onSelection(selection);
      },
    });
    // Kick off the initial render; `ready` fires when it settles.
    void this.#run(() => this.#open());
  }

  get position(): ReaderPosition {
    return this.#snapshot();
  }

  get mode(): LayoutMode {
    return this.#mode;
  }

  on<E extends ReaderEvent>(event: E, handler: ReaderEventHandler<E>): Unsubscribe {
    const set = this.#listeners[event];
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  next(): Promise<void> {
    return this.#run(() => this.#next());
  }

  prev(): Promise<void> {
    return this.#run(() => this.#prev());
  }

  nextSection(): Promise<void> {
    return this.#run(() => this.#gotoSection(this.#sectionIndex + 1, 'first'));
  }

  prevSection(): Promise<void> {
    return this.#run(() => this.#gotoSection(this.#sectionIndex - 1, 'first'));
  }

  goTo(target: GoToTarget): Promise<void> {
    return this.#run(() => this.#goTo(target));
  }

  back(): Promise<void> {
    return this.#run(() => this.#back());
  }

  setMode(mode: LayoutMode): Promise<void> {
    return this.#run(() => this.#setMode(mode));
  }

  setAppearance(appearance: Appearance): Promise<void> {
    return this.#run(() => this.#setAppearance(appearance));
  }

  /**
   * Streams whole-book search hits. Not enqueued behind navigation — it reads the
   * book's section bytes headlessly (decode → strip markup → match) and never drives
   * the paginator or the frame, so it composes with reading rather than blocking it.
   * Delegates to the headless `searchBook` generator; `goTo(hit.position)` jumps.
   */
  search(query: string, options: SearchOptions = {}): AsyncIterableIterator<SearchHit> {
    return searchBook(this.#book, query, options);
  }

  /**
   * Draws (or replaces) a decoration over the range `position` resolves to. Enqueued
   * behind navigation so it settles in issue order against a concurrent re-layout;
   * the paginator holds the intent and re-anchors it across every later re-layout, so
   * a highlight survives a font-size or mode change. Draw-only — no annotation data is
   * ever stored, serialized, or fetched. A soft-miss draws nothing (no throw).
   */
  decorate(id: string, position: Position, opts: { className: string }): Promise<void> {
    return this.#run(() => this.#decorate(id, position, opts.className));
  }

  /** Removes the decoration for `id`. Enqueued so it orders against navigation. */
  undecorate(id: string): Promise<void> {
    return this.#run(() => this.#undecorate(id));
  }

  sentences(): Promise<readonly SentenceRange[]> {
    return this.#runResult<readonly SentenceRange[]>([], async () => {
      const section = this.#paginator.section;
      if (section === null) return [];
      // Segment the same frame-measured section text decorations resolve against, so
      // every sentence Position both jumps (goTo) and highlights (decorate) cleanly.
      const text = await this.#paginator.sectionText();
      return segmentSentences(text, section.id);
    });
  }

  async #decorate(id: string, position: Position, className: string): Promise<void> {
    if (this.#destroyed || this.#paginator.section === null) return;
    await this.#paginator.decorate(id, position, className);
  }

  async #undecorate(id: string): Promise<void> {
    if (this.#destroyed) return;
    await this.#paginator.undecorate(id);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#zoom?.destroy();
    this.#zoom = null;
    this.#paginator.destroy();
    for (const event of Object.keys(this.#listeners) as ReaderEvent[]) {
      this.#listeners[event].clear();
    }
    this.#backStack = [];
  }

  // --- Input dispatch -------------------------------------------------------

  /**
   * Route a resolved {@link NavIntent} (from keyboard/swipe/tap, already made
   * direction-aware in `input.ts`) to the matching public navigation method. Each
   * goes through the same serialized queue as programmatic navigation, so hand
   * input interleaves in issue order. `none` is a no-op. Input is never gated on
   * `prefers-reduced-motion`: pages must always turn. The only motion in the reader
   * is the zoom overlay's open/close transition, which the overlay gates itself.
   */
  #dispatchIntent(intent: NavIntent): void {
    switch (intent) {
      case 'next':
        void this.next();
        return;
      case 'prev':
        void this.prev();
        return;
      case 'nextSection':
        void this.nextSection();
        return;
      case 'prevSection':
        void this.prevSection();
        return;
      case 'start':
        void this.goTo('start');
        return;
      case 'end':
        void this.goTo('end');
        return;
      case 'none':
        return;
    }
  }

  // --- Image zoom overlay ---------------------------------------------------

  /**
   * Opens the host-side zoom overlay over the tapped image's already-served
   * `data:` bytes. The overlay is a DOM element in the *host* document, outside the
   * sandboxed frame — it mints no new frame resource and never a `blob:` URL. A
   * non-`data:` src (a remote image the CSP already refuses in-frame) is ignored.
   */
  #openZoom(image: { src: string; alt: string }): void {
    if (this.#destroyed || !image.src.startsWith('data:')) return;
    if (this.#zoom === null) this.#zoom = new ImageZoom(this.#element);
    this.#zoom.open(image.src, image.alt);
  }

  // --- Navigation queue -----------------------------------------------------

  /**
   * Runs `task` after all previously-queued navigation, so overlapping calls
   * settle in the order they were issued. A task failure is reported through the
   * `error` event and swallowed so it never breaks the chain; `destroy` short-
   * circuits everything.
   */
  #run(task: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(async () => {
      if (this.#destroyed) return;
      try {
        await task();
      } catch (error) {
        if (!this.#destroyed) {
          this.#emit('error', error instanceof Error ? error : new ReaderError(String(error)));
        }
      }
    });
    this.#queue = next;
    return next;
  }

  /**
   * Like {@link #run} but returns the task's value, resolving to `fallback` when the
   * reader is destroyed or the task throws (the error is reported through `error`).
   * For read-only queries that must settle in order with navigation.
   */
  #runResult<T>(fallback: T, task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(async () => {
      if (this.#destroyed) return fallback;
      try {
        return await task();
      } catch (error) {
        if (!this.#destroyed) {
          this.#emit('error', error instanceof Error ? error : new ReaderError(String(error)));
        }
        return fallback;
      }
    });
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // --- Lifecycle ------------------------------------------------------------

  async #open(): Promise<void> {
    const start = this.#options.start;
    if (start === undefined) {
      await this.#gotoSection(0, 'first');
    } else {
      await this.#goTo(start);
    }
    if (this.#destroyed) return;
    this.#ready = true;
    this.#emit('ready', this.#snapshot());
  }

  // --- Section / page paint -------------------------------------------------

  /**
   * Paginates the section at `index` and lands on its first or last page. Fires
   * `sectionchange` when the active section actually changes, then always fires
   * `positionchange` once the page settles. Out-of-range indices are no-ops.
   */
  async #gotoSection(index: number, land: 'first' | 'last'): Promise<void> {
    if (index < 0 || index >= this.#sections.length) return;
    const section = this.#sections[index]!;
    const changed = this.#paginator.section === null || this.#sectionIndex !== index;
    // Re-paginating is the expensive step (sanitize + chunk + measure). Skip it
    // when we are already on this section — back(), a same-section fragment jump,
    // or a Position within the current chapter — and just seek within the layout
    // already in place.
    if (changed) {
      await this.#paginator.paginate(section, { mode: this.#mode, ...this.#requestExtras() });
      this.#sectionIndex = index;
    }
    // Always establish the landing page explicitly. A multi-chunk section paints
    // its chunks stacked until a page is selected, so entering on 'first' must
    // seek page 0, not assume paginate left it there.
    if (land === 'last') {
      await this.#paginator.refine();
      const state = this.#paginator.state;
      await this.#paginator.goToPage(state === null ? 0 : Math.max(0, state.pageCount - 1));
    } else {
      await this.#paginator.goToPage(0);
    }
    if (changed) this.#emit('sectionchange', { index, sectionId: section.id });
    this.#emit('positionchange', this.#snapshot());
  }

  /**
   * The layout knobs the facade threads into every `paginate`: the page margin
   * (`columnGap`) and the column count. Both are appearance-owned, so a section
   * re-paginated after a mode switch or roll keeps the live typography rather than
   * snapping back to the paginator defaults.
   */
  #requestExtras(): { columnGap?: number; columnCount?: number } {
    const extras: { columnGap?: number; columnCount?: number } = {};
    if (this.#appearance.margin !== undefined) extras.columnGap = this.#appearance.margin;
    if (this.#appearance.columns !== undefined) extras.columnCount = this.#appearance.columns;
    return extras;
  }

  // --- next / prev ----------------------------------------------------------

  async #next(): Promise<void> {
    if (this.#paginator.section === null) return;
    const before = this.#paginator.page;
    const after = await this.#paginator.nextPage();
    if (after !== before) {
      this.#emit('positionchange', this.#snapshot());
      return;
    }
    // At the section's last page: roll to the next section's first page.
    await this.#gotoSection(this.#sectionIndex + 1, 'first');
  }

  async #prev(): Promise<void> {
    if (this.#paginator.section === null) return;
    const before = this.#paginator.page;
    const after = await this.#paginator.previousPage();
    if (after !== before) {
      this.#emit('positionchange', this.#snapshot());
      return;
    }
    // At the section's first page: roll to the previous section's last page.
    await this.#gotoSection(this.#sectionIndex - 1, 'last');
  }

  // --- goTo -----------------------------------------------------------------

  async #goTo(target: GoToTarget): Promise<void> {
    if (target === 'start') {
      await this.#gotoSection(0, 'first');
      return;
    }
    if (target === 'end') {
      await this.#gotoSection(this.#sections.length - 1, 'last');
      return;
    }
    if (typeof target === 'number') {
      await this.#gotoFraction(target);
      return;
    }
    if (typeof target === 'string') {
      await this.#gotoHref(target);
      return;
    }
    if (isPosition(target)) {
      await this.#gotoPosition(target);
      return;
    }
    // TocItem.
    await this.#gotoTocItem(target);
  }

  async #gotoFraction(fraction: number): Promise<void> {
    const count = this.#sections.length;
    if (count === 0) return;
    const clamped = Math.min(1, Math.max(0, fraction));
    // Even-weight the book across sections (matching BookProgress.bookFraction),
    // then land on the page nearest the residual fraction within that section.
    const scaled = clamped * count;
    const index = Math.min(count - 1, Math.floor(scaled));
    const within = scaled - index;
    await this.#gotoSection(index, 'first');
    if (this.#destroyed) return;
    await this.#paginator.refine();
    const state = this.#paginator.state;
    if (state !== null && state.pageCount > 1) {
      const page = Math.round(within * (state.pageCount - 1));
      await this.#paginator.goToPage(page);
    }
    this.#emit('positionchange', this.#snapshot());
  }

  async #gotoPosition(position: Position): Promise<void> {
    const index = this.#indexOfSection(position.sectionId);
    if (index === -1) return; // soft miss: unknown section
    await this.#gotoSection(index, 'first');
    if (this.#destroyed) return;
    const page = await this.#paginator.pageOfPosition(position);
    if (page >= 0) await this.#paginator.goToPage(page);
    this.#emit('positionchange', this.#snapshot());
  }

  async #gotoTocItem(item: TocItem): Promise<void> {
    const index = this.#indexOfSection(item.sectionId);
    if (index === -1) return; // soft miss
    await this.#gotoSection(index, 'first');
    if (this.#destroyed) return;
    if (item.fragment !== undefined) await this.#seekFragment(item.fragment);
    this.#emit('positionchange', this.#snapshot());
  }

  /**
   * Resolves a content-internal href to a section (+ fragment) using ONLY public
   * Book data, then navigates. The core exposes no href→section seam (sections are
   * id-addressed; `Section.resolve` yields a `Resource`, not a section target), so
   * this is a best-effort, format-neutral heuristic that degrades quietly on a
   * miss — consistent with the Position soft-miss philosophy. In order:
   *   1. the path (or its last segment) equals a `section.id`;
   *   2. the last segment, or that segment minus its extension, matches a
   *      `section.id` or a section id's own last segment / extension-less form;
   *   3. the href carries a fragment that a `TocItem` also carries — borrow that
   *      item's `sectionId`.
   * A pure-fragment href (`#note`) seeks within the current section.
   */
  async #gotoHref(href: string): Promise<void> {
    const { path, fragment } = splitFragment(href);
    if (path === '') {
      // Pure fragment: within the current section.
      if (fragment !== undefined) await this.#seekFragment(fragment);
      this.#emit('positionchange', this.#snapshot());
      return;
    }
    const index = this.#resolveHrefToSection(path, fragment);
    if (index === -1) return; // soft miss
    await this.#gotoSection(index, 'first');
    if (this.#destroyed) return;
    if (fragment !== undefined) await this.#seekFragment(fragment);
    this.#emit('positionchange', this.#snapshot());
  }

  /** Heuristic href-path → section index; -1 when nothing matches (soft miss). */
  #resolveHrefToSection(path: string, fragment: string | undefined): number {
    // 1. Direct id match on the full path or its last segment.
    const segment = lastSegment(path);
    for (const candidate of [path, segment]) {
      const direct = this.#indexOfSection(candidate);
      if (direct !== -1) return direct;
    }
    // 2. Filename / extension-less match against section ids and their tails.
    const stem = stripExtension(segment);
    for (let index = 0; index < this.#sections.length; index += 1) {
      const id = this.#sections[index]!.id;
      const idSegment = lastSegment(id);
      if (
        id === segment ||
        id === stem ||
        idSegment === segment ||
        idSegment === stem ||
        stripExtension(idSegment) === stem
      ) {
        return index;
      }
    }
    // 3. TOC fragment fallback: a toc item carrying this fragment names a section.
    if (fragment !== undefined) {
      const byFragment = this.#findTocByFragment(this.#book.toc, fragment);
      if (byFragment !== undefined) return this.#indexOfSection(byFragment);
    }
    return -1;
  }

  #findTocByFragment(items: readonly TocItem[], fragment: string): string | undefined {
    for (const item of items) {
      if (item.fragment === fragment) return item.sectionId;
      const nested = this.#findTocByFragment(item.children, fragment);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  /**
   * Best-effort seek to a fragment within the already-paginated section. The frame
   * maps an element id to its character offset (`offsetOfElementId`), which the
   * paginator turns into a page via `pageOfElementId`. A resolved id lands on that
   * page; an unresolvable id (no such element) is a soft miss that lands on the
   * section's first page — never a throw. Kept as a seam so callers need not
   * special-case fragment presence.
   */
  async #seekFragment(fragment: string): Promise<void> {
    const page = await this.#paginator.pageOfElementId(fragment);
    // Soft miss (-1): the id is absent, so stay at the section's first page.
    await this.#paginator.goToPage(page >= 0 ? page : 0);
  }

  // --- selection ------------------------------------------------------------

  /**
   * Turns a frame-forwarded selection (UTF-16 offset range + text over the section
   * text) into a `Position` anchored at the range start and emits `selection`. The
   * frame already dropped collapsed and empty-rect selections, so a callback here
   * always carries real text. Position capture reads the section text but moves
   * nothing, so it is not enqueued behind navigation.
   */
  async #onSelection(selection: { start: number; end: number; text: string }): Promise<void> {
    if (this.#destroyed || this.#paginator.section === null) return;
    const position = await this.#paginator.positionOfOffsetRange(selection.start, selection.end);
    if (this.#destroyed) return;
    this.#emit('selection', { text: selection.text, position });
  }

  // --- back-stack -----------------------------------------------------------

  async #onLinkClick(href: string): Promise<void> {
    if (this.#destroyed) return;
    this.#emit('linkclick', { href });
    // Push the pre-jump position, then follow the link. Queued so it settles in
    // order with any concurrent navigation.
    await this.#run(async () => {
      const here = await this.#currentPosition();
      if (here !== null) this.#backStack.push(here);
      await this.#gotoHref(href);
    });
  }

  async #back(): Promise<void> {
    const position = this.#backStack.pop();
    if (position === undefined) return;
    await this.#gotoPosition(position);
  }

  // --- mode switch ----------------------------------------------------------

  async #setMode(mode: LayoutMode): Promise<void> {
    if (mode === this.#mode) return;
    if (this.#paginator.section === null) {
      this.#mode = mode;
      return;
    }
    // The paginator itself captures a Position, re-paginates, and seeks back,
    // so position is preserved across the switch (M1-2 machinery).
    await this.#paginator.switchMode(mode);
    this.#mode = mode;
    this.#emit('positionchange', this.#snapshot());
  }

  // --- appearance -----------------------------------------------------------

  /**
   * Merges `appearance` over the live state, rebuilds the appearance stylesheet,
   * and applies it to the current section preserving the reading place. Two paths,
   * chosen by whether the *update* touches a reflowing typography knob:
   *
   * - **Non-reflowing** (theme colours / background only): `setThemeCss` re-assembles
   *   the srcdoc, captures a `Position`, and seeks back. Geometry is invariant, so
   *   the exact page is restored and the text does not reflow.
   * - **Reflowing** (font family/size, line height, alignment, hyphenation, columns):
   *   `applyAppearance` reuses the same capture → re-layout → resolve → restore
   *   machinery as `setMode`, but geometry changes, so the anchor's *nearest* page is
   *   restored (the reading place survives the reflow, page number may shift).
   *
   * A no-op change short-circuits inside the paginator. Before the first paint it
   * records the appearance for the opening render.
   */
  async #setAppearance(appearance: Appearance): Promise<void> {
    const reflows = isReflowingUpdate(appearance);
    this.#appearance = mergeAppearance(this.#appearance, appearance);
    const css = themeStyleSheet(this.#appearance);
    if (reflows) {
      const geometry: { columnCount?: number; columnGap?: number } = {};
      if (this.#appearance.columns !== undefined) geometry.columnCount = this.#appearance.columns;
      if (this.#appearance.margin !== undefined) geometry.columnGap = this.#appearance.margin;
      await this.#paginator.applyAppearance(css, geometry);
    } else {
      await this.#paginator.setThemeCss(css);
    }
    if (this.#destroyed) return;
    // Emitted after the change settles so a host can refresh anything keyed on the
    // settled state (parity with setMode). A reflowing knob may have moved the page
    // number even though the reading place is held.
    this.#emit('positionchange', this.#snapshot());
  }

  // --- helpers --------------------------------------------------------------

  #indexOfSection(sectionId: string): number {
    return this.#sections.findIndex((section) => section.id === sectionId);
  }

  /** The current reading position as a `Position`, or null before the first paint. */
  async #currentPosition(): Promise<Position | null> {
    if (this.#paginator.section === null) return null;
    return this.#paginator.positionOfPage(this.#paginator.page);
  }

  #snapshot(): ReaderPosition {
    if (this.#paginator.section === null || this.#paginator.state === null) {
      return { section: this.#sectionIndex, progress: 0, chapterProgress: 0, page: 0, totalPages: 0 };
    }
    const progress: BookProgress = this.#paginator.bookProgress(
      this.#sectionIndex,
      this.#sections.length,
    );
    return {
      section: this.#sectionIndex,
      progress: progress.bookFraction,
      chapterProgress: progress.fraction,
      page: progress.page,
      totalPages: progress.totalPages,
    };
  }

  #emit<E extends ReaderEvent>(event: E, payload: ReaderEventMap[E]): void {
    // Copy so a handler unsubscribing mid-dispatch cannot skip a sibling.
    for (const handler of [...this.#listeners[event]]) {
      try {
        handler(payload);
      } catch {
        // A listener throwing must not derail the emit or the navigation.
      }
    }
  }
}

/**
 * The host-side image-zoom overlay. It lives entirely in the *host* document,
 * outside the sandboxed frame: it renders the image's already-served `data:` bytes
 * in a host DOM element, so it mints no new frame resource and — crucially — never
 * a `blob:` URL (an opaque-origin frame cannot load a host blob URL; `data:` is the
 * boundary-crossing form the whole view stack already relies on).
 *
 * Accessibility: it is a modal dialog with a focus TRAP (Tab cycles the close
 * control and image), closes on Escape or a backdrop click, and restores focus to
 * whatever the reader element held before it opened. Its open/close transition —
 * the reader's only animation — is gated on `prefers-reduced-motion`; input and
 * page-turning are never gated on the preference.
 */
class ImageZoom {
  readonly #anchor: HTMLElement;
  readonly #doc: Document;
  #root: HTMLElement | null = null;
  #image: HTMLImageElement | null = null;
  #closeButton: HTMLButtonElement | null = null;
  #previouslyFocused: HTMLElement | null = null;
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'Tab') this.#trapTab(event);
  };

  constructor(anchor: HTMLElement) {
    this.#anchor = anchor;
    const doc = anchor.ownerDocument;
    if (doc === null) throw new ReaderError('the reader element is not in a document');
    this.#doc = doc;
  }

  open(src: string, alt: string): void {
    if (this.#root !== null) {
      // Re-target an already-open overlay rather than stacking a second one.
      this.#image!.src = src;
      this.#image!.alt = alt;
      return;
    }
    const active = this.#doc.activeElement;
    this.#previouslyFocused = active instanceof HTMLElement ? active : this.#anchor;

    const root = this.#doc.createElement('div');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', alt !== '' ? alt : 'Zoomed image');
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.85)',
      zIndex: '2147483647',
      padding: '4vmin',
      boxSizing: 'border-box',
      opacity: this.#reducedMotion() ? '1' : '0',
      transition: this.#reducedMotion() ? 'none' : 'opacity 150ms ease',
    } satisfies Partial<CSSStyleDeclaration>);
    root.addEventListener('pointerdown', (event) => {
      if (event.target === root) this.close();
    });

    const image = this.#doc.createElement('img');
    image.src = src;
    image.alt = alt;
    image.tabIndex = 0;
    Object.assign(image.style, {
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain',
      boxShadow: '0 4px 32px rgba(0, 0, 0, 0.5)',
    } satisfies Partial<CSSStyleDeclaration>);

    const close = this.#doc.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    Object.assign(close.style, {
      position: 'absolute',
      top: '2vmin',
      right: '2vmin',
      width: '2.5rem',
      height: '2.5rem',
      fontSize: '1.5rem',
      lineHeight: '1',
      cursor: 'pointer',
      border: '0',
      borderRadius: '50%',
      background: 'rgba(255, 255, 255, 0.9)',
      color: '#000',
    } satisfies Partial<CSSStyleDeclaration>);
    close.addEventListener('click', () => {
      this.close();
    });

    root.append(image, close);
    this.#doc.body.append(root);
    this.#root = root;
    this.#image = image;
    this.#closeButton = close;
    this.#doc.addEventListener('keydown', this.#onKeyDown, true);
    // Fade in on the next frame so the transition has a start value to animate from.
    if (!this.#reducedMotion()) {
      const view = this.#doc.defaultView;
      if (view !== null) view.requestAnimationFrame(() => (root.style.opacity = '1'));
    }
    close.focus();
  }

  close(): void {
    const root = this.#root;
    if (root === null) return;
    this.#doc.removeEventListener('keydown', this.#onKeyDown, true);
    this.#root = null;
    this.#image = null;
    this.#closeButton = null;
    const restore = this.#previouslyFocused;
    this.#previouslyFocused = null;
    root.remove();
    this.#restoreFocus(restore);
  }

  /**
   * Return focus to the reader region. The tap that opened the overlay came from
   * inside the sandboxed frame, so the host's active element is usually the frame's
   * body (not focusable from here) — fall back to the reader mount, made
   * programmatically focusable with a temporary `tabindex` so focus lands on the
   * reader rather than the document body.
   */
  #restoreFocus(saved: HTMLElement | null): void {
    if (saved !== null && saved.isConnected && saved !== this.#doc.body) {
      saved.focus();
      if (this.#doc.activeElement === saved) return;
    }
    const anchor = this.#anchor;
    // A bare div is not focusable; a -1 tabindex makes it programmatically
    // focusable without adding it to the tab order. Idempotent and benign.
    if (!anchor.hasAttribute('tabindex')) anchor.tabIndex = -1;
    anchor.focus();
  }

  destroy(): void {
    this.close();
  }

  /**
   * Keep Tab focus inside the overlay: the close control and image are the stops.
   * Tab is intercepted unconditionally and focus is moved explicitly so it can
   * never escape the overlay — the reader region behind it is inert while open.
   */
  #trapTab(event: KeyboardEvent): void {
    event.preventDefault();
    const stops = this.#focusStops();
    if (stops.length === 0) return;
    const active = this.#doc.activeElement as HTMLElement | null;
    const current = active === null ? -1 : stops.indexOf(active);
    const step = event.shiftKey ? -1 : 1;
    const nextIndex = current === -1 ? 0 : (current + step + stops.length) % stops.length;
    stops[nextIndex]!.focus();
  }

  #focusStops(): HTMLElement[] {
    const stops: HTMLElement[] = [];
    if (this.#closeButton !== null) stops.push(this.#closeButton);
    if (this.#image !== null) stops.push(this.#image);
    return stops;
  }

  #reducedMotion(): boolean {
    const view = this.#doc.defaultView;
    return view !== null && view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}

/** Structural check for a `Position` (vs a TocItem, both objects). */
function isPosition(value: TocItem | Position): value is Position {
  return (
    typeof (value as Position).serialized === 'string' &&
    typeof (value as Position).sectionId === 'string' &&
    (value as { anchor?: unknown }).anchor !== undefined &&
    (value as { children?: unknown }).children === undefined
  );
}

// Re-exported so a caller can rebuild a Position from its serialized form before
// handing it to goTo — the facade never persists, but goTo(Position) is a target.
export { parsePosition };
