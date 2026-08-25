import type { Section } from '../core/index.ts';
import { chunkElement } from '../layout/chunk.ts';
import { assembleChunkedBody, assembleFrameDocument, createNonce } from './frame.ts';
import {
  asFrameMessage,
  PROTOCOL_VERSION,
  type FrameMessage,
  type Measurement,
  type PaginateOptions,
  type PaginationState,
} from './protocol.ts';
import { applyResources, ResourceRegistry, type ResourceSummary } from './resources.ts';
import { sanitizeSection, type SanitizationSummary } from './sanitize.ts';
import { decodeText } from './text.ts';

/** Something went wrong hosting content; never a book decoding failure. */
export class ContentHostError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ContentHostError';
  }
}

export interface ViolationReport {
  readonly directive: string;
  readonly blockedUri: string;
}

export interface ContentHostOptions {
  readonly onViolation?: (report: ViolationReport) => void;
  readonly onError?: (message: string) => void;
  /** An internal link was clicked in the frame; carries the raw authored href. */
  readonly onLinkClick?: (href: string) => void;
  /**
   * A navigation-relevant keydown fired in the frame; carries the
   * `KeyboardEvent.key`, except Space, which arrives as the normalized tokens
   * `'Space'` / `'Shift+Space'` (the key is `' '` for both and the wire carries
   * no modifier field).
   */
  readonly onKey?: (key: string) => void;
  /** A completed horizontal swipe in the frame; carries the net delta in CSS px. */
  readonly onSwipe?: (dx: number, dy: number) => void;
  /** A tap in the frame that was not on a link; carries tap coords + frame viewport size. */
  readonly onTap?: (tap: { x: number; y: number; width: number; height: number }) => void;
  /**
   * A tap on a book image in the frame (not a link, not a page-turn). Carries the
   * image's already-substituted `data:` URL and its `alt`, so a host can open a
   * zoom overlay over the same full-resolution bytes. Never a `blob:` URL.
   */
  readonly onImageTap?: (image: { src: string; alt: string }) => void;
  /**
   * A completed text selection in the frame; carries the selected text and its
   * UTF-16 offset range over the section text (`sectionText`). Empty and collapsed
   * selections are dropped in the frame and never reach here.
   */
  readonly onSelection?: (selection: { start: number; end: number; text: string }) => void;
  /**
   * The appearance theme stylesheet injected at document assembly (see
   * {@link themeStyleSheet}). Applied to every render; update it live with
   * {@link ContentHost.setThemeCss} and re-render. Omit for an unthemed frame.
   */
  readonly themeCss?: string;
  /**
   * Whether the consumer acts on the nav keydowns the frame forwards (`onKey`).
   * Baked into the coordination script at document assembly — not a wire
   * message, so no protocol change. When `false` the frame still forwards nav
   * keys (the wire is unconditional) but stops `preventDefault`ing them, so a
   * key the host will ignore keeps its default action. Defaults to `true`.
   */
  readonly keyboardNav?: boolean;
  /** How long the frame has to answer, in milliseconds. Defaults to 10000. */
  readonly timeoutMs?: number;
}

export interface RenderReport {
  readonly sectionId: string;
  /**
   * The section's own `scripted` declaration. Diagnostic only: it is an author
   * declaration, not a detection, so nothing in the pipeline depends on it.
   */
  readonly declaredScripted: boolean;
  readonly sanitization: SanitizationSummary;
  readonly resources: ResourceSummary;
}

interface Pending {
  readonly settle: (message: FrameMessage) => void;
  readonly fail: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Section-invariant render inputs, cached so a re-pagination of the *same*
 * section (a font-size tick, a mode switch — the theme rides the srcdoc, so
 * every appearance change re-assembles the document) reuses them instead of
 * re-running decode → sanitize → resource minting. No image is re-base64'd on
 * a reflow.
 *
 * This must not — and does not — weaken any of the three defences: everything
 * cached sits strictly *downstream* of the sanitizer (the same sanitized
 * output, byte for byte), resources stay the `data:` URLs the registry minted
 * (never `blob:`), and the CSP nonce is still created fresh for every
 * document assembly. Only the inputs are reused; the assembly is not.
 *
 * Invalidated when a different section renders and on {@link ContentHost.destroy}.
 */
interface SectionRenderCache {
  readonly section: Section;
  /** The sanitized, resource-applied document. Never mutated after creation. */
  readonly document: Document;
  readonly headHtml: string;
  readonly sanitization: SanitizationSummary;
  readonly resources: ResourceSummary;
  readonly registry: ResourceRegistry;
  /** Assembled body markup, memoized per body-assembly key (plain / chunked@N). */
  readonly bodyHtml: Map<string, string>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Renders decoded sections as live markup inside a hardened sandboxed frame.
 *
 * Three independent defences, none of them redundant. The sandbox denies reach:
 * without `allow-same-origin` the document has an opaque origin and cannot see
 * the host page, its cookies or its storage. Sanitization denies execution:
 * `allow-scripts` is granted to the document, not to a party, so book script
 * would run under the same grant as the coordination script — and could then
 * impersonate it on this very message channel, which no sandbox can prevent.
 * CSP denies egress: nothing may be fetched at all except the `data:` resources
 * this host minted, which reach nothing.
 */
export class ContentHost {
  readonly frame: HTMLIFrameElement;
  readonly #window: Window;
  readonly #options: ContentHostOptions;
  readonly #pending = new Map<number, Pending>();
  #cache: SectionRenderCache | null = null;
  #ready: (() => void) | null = null;
  #nextId = 1;
  #generation = 0;
  #destroyed = false;
  /** The theme stylesheet injected at document assembly; updated live by the facade. */
  #themeCss: string | undefined;

  readonly #receive = (event: MessageEvent): void => {
    // The frame's origin is 'null' under an opaque origin, so origin checking
    // authenticates nothing. Identity comes from the source window; meaning
    // comes from validation. Anything else is ignored, never dispatched.
    if (event.source === null || event.source !== this.frame.contentWindow) return;
    const message = asFrameMessage(event.data);
    if (message === null) return;
    switch (message.type) {
      case 'ready':
        this.#ready?.();
        return;
      case 'violation':
        this.#options.onViolation?.({ directive: message.directive, blockedUri: message.blockedUri });
        return;
      case 'error':
        this.#options.onError?.(message.message);
        return;
      case 'linkclick':
        this.#options.onLinkClick?.(message.href);
        return;
      case 'key':
        this.#options.onKey?.(message.key);
        return;
      case 'swipe':
        this.#options.onSwipe?.(message.dx, message.dy);
        return;
      case 'tap':
        this.#options.onTap?.({ x: message.x, y: message.y, width: message.width, height: message.height });
        return;
      case 'imagetap':
        this.#options.onImageTap?.({ src: message.src, alt: message.alt });
        return;
      case 'selection':
        this.#options.onSelection?.({ start: message.start, end: message.end, text: message.text });
        return;
      case 'pong':
      case 'measured':
      case 'paginated':
      case 'movedToPage':
      case 'offset':
      case 'page':
      case 'text':
      case 'decorated':
      case 'diagnosticsReport': {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        pending.settle(message);
        return;
      }
    }
  };

  constructor(container: HTMLElement, options: ContentHostOptions = {}) {
    this.#options = options;
    this.#themeCss = options.themeCss;
    const view = container.ownerDocument.defaultView;
    if (view === null) throw new ContentHostError('the container is not in a rendered document');
    this.#window = view;
    const frame = container.ownerDocument.createElement('iframe');
    // Set before insertion. A frame that reaches the document without its
    // sandbox attribute has already had one unsandboxed document.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', 'book content');
    frame.style.display = 'block';
    frame.style.border = '0';
    frame.style.width = '100%';
    frame.style.height = '100%';
    container.append(frame);
    this.frame = frame;
    view.addEventListener('message', this.#receive);
  }

  async render(section: Section): Promise<RenderReport> {
    return this.#renderSection(section, 'plain', (document) => document.body.innerHTML);
  }

  /**
   * Sets the theme stylesheet injected at the next document assembly. Does not
   * re-render on its own — the caller re-renders (or re-paginates) to apply it.
   * The theme lands in the srcdoc, not over the wire, so this changes no protocol.
   */
  setThemeCss(themeCss: string | undefined): void {
    this.#themeCss = themeCss;
  }

  /** The theme stylesheet currently applied to renders, or `undefined`. */
  get themeCss(): string | undefined {
    return this.#themeCss;
  }

  /**
   * Renders a section chunked for pagination: each top-level chunk becomes its
   * own container element carrying the character range it covers, so the frame
   * can build a per-chunk multi-column context and map pages to offsets. The
   * sanitize + resources pipeline is identical to {@link render}; only the body
   * assembly differs. Call {@link paginate} afterward to lay it out.
   */
  async renderChunked(section: Section, chunkChars?: number): Promise<RenderReport> {
    return this.#renderSection(section, `chunked@${chunkChars ?? 'default'}`, (document) => {
      const { chunks } = chunkElement(document.body, chunkChars);
      return assembleChunkedBody(chunks.map((chunk) => ({ html: chunk.html, chars: chunk.chars })));
    });
  }

  /**
   * The shared render path: bump the generation, obtain the section-invariant
   * render inputs (from the cache when the same section renders again — a
   * reflow — or by running the sanitize + resources pipeline), then hand the
   * sanitized document's body to `buildBody` to produce the frame body markup.
   * `render` passes it through verbatim; `renderChunked` re-wraps it in chunk
   * containers; both memoize their output under `bodyKey`. The CSP nonce is
   * minted fresh for every assembly regardless of cache hits.
   */
  async #renderSection(
    section: Section,
    bodyKey: string,
    buildBody: (document: Document) => string,
  ): Promise<RenderReport> {
    if (this.#destroyed) throw new ContentHostError('the host has been destroyed');
    const generation = (this.#generation += 1);

    let cache = this.#cache;
    if (cache === null || cache.section !== section) {
      // A different section: the outgoing section's inputs are invalidated and
      // its registry released before anything new is built.
      this.#cache?.registry.release();
      this.#cache = null;

      const source = decodeText(await section.load());
      this.#checkGeneration(generation);
      // Sanitization is unconditional. Section.scripted is an author declaration
      // that a hostile book simply omits, so gating on it would skip exactly the
      // files that need it most.
      const sanitized = sanitizeSection(source, section.mediaType);
      const registry = new ResourceRegistry(section.resolve?.bind(section));
      let resources: ResourceSummary;
      try {
        resources = await applyResources(sanitized.document, registry);
        // Checked before the cache is written, so a superseded render can never
        // clobber the cache a later render installed.
        this.#checkGeneration(generation);
      } catch (error) {
        registry.release();
        throw error;
      }
      cache = {
        section,
        document: sanitized.document,
        headHtml: sanitized.document.head.innerHTML,
        sanitization: sanitized.summary,
        resources,
        registry,
        bodyHtml: new Map(),
      };
      this.#cache = cache;
    }

    let bodyHtml = cache.bodyHtml.get(bodyKey);
    if (bodyHtml === undefined) {
      bodyHtml = buildBody(cache.document);
      cache.bodyHtml.set(bodyKey, bodyHtml);
    }

    await this.#load(
      assembleFrameDocument({
        headHtml: cache.headHtml,
        bodyHtml,
        nonce: createNonce(),
        hostOrigin: this.#targetOrigin(),
        ...(this.#themeCss !== undefined ? { themeCss: this.#themeCss } : {}),
        ...(this.#options.keyboardNav !== undefined ? { keyboardNav: this.#options.keyboardNav } : {}),
      }),
    );
    this.#checkGeneration(generation);

    return {
      sectionId: section.id,
      declaredScripted: section.scripted === true,
      sanitization: cache.sanitization,
      resources: cache.resources,
    };
  }

  /**
   * Lays the currently-rendered chunked section out under `options` and returns
   * the resulting pagination state. In paginated mode each chunk becomes an
   * absolutely-positioned multi-column context and the page count is the sum of
   * per-chunk page counts; in scrolled mode chunks stack with no paging. Requires
   * a prior {@link renderChunked}.
   */
  async paginate(section: Section, options: PaginateOptions): Promise<PaginationState> {
    await this.renderChunked(section, options.chunkChars);
    const reply = await this.#request('paginate', { options });
    if (reply.type !== 'paginated') {
      throw new ContentHostError('the frame answered paginate with the wrong message');
    }
    return reply.state;
  }

  /** Re-measures the current layout (e.g. after a viewport or typography change). */
  async relayout(): Promise<PaginationState> {
    const reply = await this.#request('relayout');
    if (reply.type !== 'paginated') {
      throw new ContentHostError('the frame answered relayout with the wrong message');
    }
    return reply.state;
  }

  /** Scrolls to a page (0-based). Returns the page actually shown after clamping. */
  async goToPage(page: number): Promise<number> {
    const reply = await this.#request('goToPage', { page });
    if (reply.type !== 'movedToPage') {
      throw new ContentHostError('the frame answered goToPage with the wrong message');
    }
    return reply.page;
  }

  /** Character offset of the first glyph painted on a page, or -1 if none. */
  async offsetOfPage(page: number): Promise<number> {
    const reply = await this.#request('offsetOfPage', { page });
    if (reply.type !== 'offset') {
      throw new ContentHostError('the frame answered offsetOfPage with the wrong message');
    }
    return reply.offset;
  }

  /**
   * Character offset of the element carrying `elementId` into the section text,
   * or -1 if no element carries the id. The seam behind fragment anchoring.
   */
  async offsetOfElementId(elementId: string): Promise<number> {
    const reply = await this.#request('offsetOfElementId', { elementId });
    if (reply.type !== 'offset') {
      throw new ContentHostError('the frame answered offsetOfElementId with the wrong message');
    }
    return reply.offset;
  }

  /** The page (0-based) painting the glyph at a section-text character offset. */
  async pageOfOffset(offset: number): Promise<number> {
    const reply = await this.#request('pageOfOffset', { offset });
    if (reply.type !== 'page') {
      throw new ContentHostError('the frame answered pageOfOffset with the wrong message');
    }
    return reply.page;
  }

  /** The section's concatenated chunk text, as the frame measures it. */
  async sectionText(): Promise<string> {
    const reply = await this.#request('sectionText');
    if (reply.type !== 'text') {
      throw new ContentHostError('the frame answered sectionText with the wrong message');
    }
    return reply.text;
  }

  /** Frame-side counts for eviction/memory checks. */
  async diagnostics(): Promise<{ domNodes: number; realizedChunks: number; totalChunks: number }> {
    const reply = await this.#request('diagnostics');
    if (reply.type !== 'diagnosticsReport') {
      throw new ContentHostError('the frame answered diagnostics with the wrong message');
    }
    return {
      domNodes: reply.domNodes,
      realizedChunks: reply.realizedChunks,
      totalChunks: reply.totalChunks,
    };
  }

  /**
   * Draws a decoration over the section-text UTF-16 offset range `[start, end)`:
   * the frame maps the range to client rects and paints pointer-transparent,
   * layout-neutral overlay boxes carrying `className`. Re-issuing the same
   * `decorationId` replaces that overlay. Returns the number of boxes painted — 0
   * on a soft-miss (the range is not in the realized section text, or its rects are
   * empty); a soft-miss draws nothing and is not an error.
   */
  async decorate(decorationId: string, start: number, end: number, className: string): Promise<number> {
    const reply = await this.#request('decorate', { decorationId, start, end, className });
    if (reply.type !== 'decorated') {
      throw new ContentHostError('the frame answered decorate with the wrong message');
    }
    return reply.boxes;
  }

  /** Removes the decoration painted for `decorationId`, leaving nothing behind. */
  async undecorate(decorationId: string): Promise<void> {
    const reply = await this.#request('undecorate', { decorationId });
    if (reply.type !== 'decorated') {
      throw new ContentHostError('the frame answered undecorate with the wrong message');
    }
  }

  /** Content size as the frame measures it. */
  async measure(): Promise<Measurement> {
    const reply = await this.#request('measure');
    if (reply.type !== 'measured') throw new ContentHostError('the frame answered measure with the wrong message');
    return { width: reply.width, height: reply.height };
  }

  /** Round-trips the protocol; the cheapest proof the channel is live. */
  async ping(): Promise<void> {
    await this.#request('ping');
  }

  /** Releases this render's resources and removes the frame. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#generation += 1;
    this.#window.removeEventListener('message', this.#receive);
    for (const [id, pending] of [...this.#pending]) {
      clearTimeout(pending.timer);
      this.#pending.delete(id);
      pending.fail(new ContentHostError('the host has been destroyed'));
    }
    this.#ready = null;
    this.#cache?.registry.release();
    this.#cache = null;
    this.frame.remove();
  }

  #timeout(): number {
    return this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  #targetOrigin(): string {
    const origin = this.#window.origin;
    return origin === '' || origin === 'null' ? '*' : origin;
  }

  #checkGeneration(generation: number): void {
    if (generation !== this.#generation) throw new ContentHostError('the render was superseded by a later one');
  }

  #load(html: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#ready = null;
        reject(new ContentHostError('the frame did not report ready'));
      }, this.#timeout());
      this.#ready = (): void => {
        clearTimeout(timer);
        this.#ready = null;
        resolve();
      };
      this.frame.srcdoc = html;
    });
  }

  #request(
    type: 'measure' | 'ping' | 'relayout' | 'sectionText' | 'diagnostics',
  ): Promise<FrameMessage>;
  #request(type: 'paginate', extras: { options: PaginateOptions }): Promise<FrameMessage>;
  #request(type: 'goToPage' | 'offsetOfPage', extras: { page: number }): Promise<FrameMessage>;
  #request(type: 'pageOfOffset', extras: { offset: number }): Promise<FrameMessage>;
  #request(type: 'offsetOfElementId', extras: { elementId: string }): Promise<FrameMessage>;
  #request(
    type: 'decorate',
    extras: { decorationId: string; start: number; end: number; className: string },
  ): Promise<FrameMessage>;
  #request(type: 'undecorate', extras: { decorationId: string }): Promise<FrameMessage>;
  #request(type: string, extras: Record<string, unknown> = {}): Promise<FrameMessage> {
    if (this.#destroyed) return Promise.reject(new ContentHostError('the host has been destroyed'));
    const target = this.frame.contentWindow;
    if (target === null) return Promise.reject(new ContentHostError('the frame has no document yet'));
    const id = (this.#nextId += 1);
    return new Promise<FrameMessage>((settle, fail) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        fail(new ContentHostError(`the frame did not answer ${type}`));
      }, this.#timeout());
      this.#pending.set(id, { settle, fail, timer });
      // The frame's origin is opaque, so '*' is the only targetOrigin that can
      // reach it. The payload carries nothing confidential for that reason.
      target.postMessage({ v: PROTOCOL_VERSION, type, id, ...extras }, '*');
    });
  }
}
