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
import type { Book, Position, ReadingDirection, Section, TocItem } from '../core/index.ts';
import { parsePosition } from '../core/index.ts';
import { Paginator, type BookProgress, type LayoutMode } from '../layout/index.ts';
import {
  mergeAppearance,
  themeStyleSheet,
  type Appearance,
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
export type { Appearance, ThemeName } from '../view/appearance.ts';

/**
 * Appearance and layout options for {@link render}. All optional. `mode` selects
 * paginated (default) or scrolled layout. The theme fields drive the appearance
 * system (applied at the first render); the typography fields are retained for
 * its typography half and not applied yet.
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
  /** Retained for the appearance system's typography half; not applied yet. */
  readonly fontSize?: number;
  /** Retained for the appearance system's typography half; not applied yet. */
  readonly fontFamily?: string;
  /** Retained for the appearance system's typography half; not applied yet. */
  readonly lineHeight?: number;
  /** Column gap in CSS px, passed through to the paginator. */
  readonly margin?: number;
  /** Number of text columns; retained for the appearance system's typography half. */
  readonly columns?: number;
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
   * Update the live appearance (theme colours / background) without losing the
   * reading place. Partial: only the fields present in `appearance` change;
   * `customProperties` shallow-merges over the current set. A colour/background
   * change repaints the current page in place — no text reflow.
   */
  setAppearance(appearance: Appearance): Promise<void>;
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
  readonly #sections: readonly Section[];
  readonly #options: ReaderOptions;
  readonly #listeners: { [E in ReaderEvent]: Set<ReaderEventHandler<E>> } = {
    ready: new Set(),
    positionchange: new Set(),
    sectionchange: new Set(),
    linkclick: new Set(),
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

  constructor(book: Book, element: HTMLElement, options: ReaderOptions) {
    this.#book = book;
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
    // distinct from a forced theme.
    this.#appearance = {};
    if (options.theme !== undefined) this.#appearance = { ...this.#appearance, theme: options.theme };
    if (options.customProperties !== undefined) {
      this.#appearance = { ...this.#appearance, customProperties: options.customProperties };
    }
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

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
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
   * input interleaves in issue order. `none` is a no-op.
   *
   * There is no page-turn animation in the reader yet, so nothing here animates
   * and there is nothing to gate on `prefers-reduced-motion`: pages simply turn.
   * When an animated turn lands (M3 appearance), gate it on
   * `matchMedia('(prefers-reduced-motion: reduce)')` — never against the setting.
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

  #requestExtras(): { columnGap?: number } {
    const margin = this.#options.margin;
    return margin === undefined ? {} : { columnGap: margin };
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
   * Merges `appearance` over the live state, rebuilds the theme stylesheet, and
   * applies it to the current section preserving the reading place. The paginator
   * captures a `Position`, re-assembles the srcdoc with the new theme, and seeks
   * back to the anchor page; a theme is colours + background only, so geometry is
   * invariant and the exact page is restored — the content repaints, the text does
   * not reflow. A no-op stylesheet change short-circuits inside the paginator.
   * Before the first paint it records the appearance for the opening render.
   */
  async #setAppearance(appearance: Appearance): Promise<void> {
    this.#appearance = mergeAppearance(this.#appearance, appearance);
    const css = themeStyleSheet(this.#appearance);
    await this.#paginator.setThemeCss(css);
    if (this.#destroyed) return;
    // The theme change does not move the reader; positionchange lets a host
    // refresh anything keyed on the settled state (parity with setMode).
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
