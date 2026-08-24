import type { Section } from '../core/index.ts';
import { assembleFrameDocument, createNonce } from './frame.ts';
import { asFrameMessage, PROTOCOL_VERSION, type FrameMessage, type Measurement } from './protocol.ts';
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
  #registry: ResourceRegistry | null = null;
  #ready: (() => void) | null = null;
  #nextId = 1;
  #generation = 0;
  #destroyed = false;

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
      case 'pong':
      case 'measured': {
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
    if (this.#destroyed) throw new ContentHostError('the host has been destroyed');
    const generation = (this.#generation += 1);
    this.#registry?.release();
    this.#registry = null;

    const source = decodeText(await section.load());
    this.#checkGeneration(generation);
    // Sanitization is unconditional. Section.scripted is an author declaration
    // that a hostile book simply omits, so gating on it would skip exactly the
    // files that need it most.
    const sanitized = sanitizeSection(source, section.mediaType);
    const registry = new ResourceRegistry(section.resolve?.bind(section));
    this.#registry = registry;
    const resources = await applyResources(sanitized.document, registry);
    this.#checkGeneration(generation);

    await this.#load(
      assembleFrameDocument({
        headHtml: sanitized.document.head.innerHTML,
        bodyHtml: sanitized.document.body.innerHTML,
        nonce: createNonce(),
        hostOrigin: this.#targetOrigin(),
      }),
    );
    this.#checkGeneration(generation);

    return {
      sectionId: section.id,
      declaredScripted: section.scripted === true,
      sanitization: sanitized.summary,
      resources,
    };
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
    this.#registry?.release();
    this.#registry = null;
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

  #request(type: 'measure' | 'ping'): Promise<FrameMessage> {
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
      target.postMessage({ v: PROTOCOL_VERSION, type, id }, '*');
    });
  }
}
