/**
 * The host↔frame message protocol.
 *
 * Every message is validated on receipt on both sides. Origin checking cannot
 * do that job here: the frame has an opaque origin, so its messages arrive with
 * an origin of `'null'`, which authenticates nothing. What the host trusts is
 * the message *source* (it must be this frame's window) plus the shape below.
 *
 * The frame's copy of the host-message validator lives inside a template string
 * in `frame.ts` (it cannot import), so the two must be kept in step by hand. Any
 * change here — including this version bump — changes both.
 */
export const PROTOCOL_VERSION = 10;

export interface Measurement {
  readonly width: number;
  readonly height: number;
}

/** The paginator's flow mode. */
export type LayoutMode = 'paginated' | 'scrolled';

export interface PaginateOptions {
  readonly mode: LayoutMode;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly columnGap: number;
  readonly chunkChars: number;
  /** How many chunks either side of the active one stay realized. */
  readonly windowChunks: number;
  /**
   * Text columns per page (a reflowing typography knob): 1 or 2. A page is split
   * into this many intra-page columns, each `columnGap` apart, so a page of
   * two-column layout paints twice the text before a turn. The other typography
   * knobs ride the appearance stylesheet in the srcdoc, but column geometry is the
   * paginator's, so it travels on the wire alongside `columnGap`.
   */
  readonly columnCount: number;
}

/** What the frame reports after (re-)paginating. Page count may be an estimate. */
export interface PaginationState {
  readonly pageCount: number;
  /** True once every chunk has been measured; false while the count is an estimate. */
  readonly firm: boolean;
  readonly realizedChunks: number;
  readonly totalChunks: number;
  /** Content scroll size in scrolled mode; page geometry otherwise. */
  readonly contentWidth: number;
  readonly contentHeight: number;
}

/** A character offset within the section's concatenated chunk text. */
export interface PageAnchor {
  /** Character offset of the first glyph painted on the page, or -1 if none. */
  readonly offset: number;
}

export type HostMessage =
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'ping'; readonly id: number }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'measure'; readonly id: number }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'paginate';
      readonly id: number;
      readonly options: PaginateOptions;
    }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'relayout'; readonly id: number }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'goToPage'; readonly id: number; readonly page: number }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'offsetOfPage'; readonly id: number; readonly page: number }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'pageOfOffset';
      readonly id: number;
      readonly offset: number;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'offsetOfElementId';
      readonly id: number;
      readonly elementId: string;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      /**
       * Scrolled-mode seek: scroll the glyph at a section-text offset to the top
       * of the viewport. Speaks the same tiled-text offset space as `pageOfOffset`,
       * so the restore leg is "resolve the anchor to an offset, hand it to the
       * frame" in both modes. A no-op in paginated mode (the document never scrolls).
       */
      readonly type: 'scrollToOffset';
      readonly id: number;
      readonly offset: number;
    }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'sectionText'; readonly id: number }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'diagnostics'; readonly id: number }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'decorate';
      readonly id: number;
      /** Caller-chosen id: re-issuing the same id replaces that overlay. */
      readonly decorationId: string;
      /** UTF-16 code-unit offset of the range start in the section text. */
      readonly start: number;
      /** UTF-16 code-unit offset of the range end in the section text. */
      readonly end: number;
      /** The class name each painted overlay box carries. */
      readonly className: string;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'undecorate';
      readonly id: number;
      readonly decorationId: string;
    };

export type FrameMessage =
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'ready' }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'pong'; readonly id: number }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'measured';
      readonly id: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'paginated';
      readonly id: number;
      readonly state: PaginationState;
    }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'movedToPage'; readonly id: number; readonly page: number }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'offset'; readonly id: number; readonly offset: number }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'page'; readonly id: number; readonly page: number }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'scrolledTo';
      readonly id: number;
      /** The frame's vertical scroll offset after the seek, in CSS px. */
      readonly top: number;
    }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'text'; readonly id: number; readonly text: string }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'decorated';
      readonly id: number;
      /** Number of overlay boxes painted for the range (0 on a soft-miss). */
      readonly boxes: number;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'diagnosticsReport';
      readonly id: number;
      readonly domNodes: number;
      readonly realizedChunks: number;
      readonly totalChunks: number;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'violation';
      readonly directive: string;
      readonly blockedUri: string;
    }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'error'; readonly message: string }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'linkclick'; readonly href: string }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'key'; readonly key: string }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'swipe'; readonly dx: number; readonly dy: number }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'tap';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'selection';
      /** UTF-16 code-unit offset of the selection's start in the section text. */
      readonly start: number;
      /** UTF-16 code-unit offset of the selection's end in the section text. */
      readonly end: number;
      /** The selected text, exactly as the frame reads it. */
      readonly text: string;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'imagetap';
      /**
       * The image's already-substituted `data:` URL — the full-resolution bytes
       * `applyResources` served into the frame's `<img src>`. Never a `blob:` URL:
       * the opaque-origin frame cannot mint one the host could load, and the host
       * overlay renders these bytes directly. The host verifies the `data:` scheme.
       */
      readonly src: string;
      /** The image's `alt` text, for the overlay's accessible name. */
      readonly alt: string;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asPaginationState(value: unknown): PaginationState | null {
  const state = asRecord(value);
  if (state === null) return null;
  const pageCount = state['pageCount'];
  const firm = state['firm'];
  const realizedChunks = state['realizedChunks'];
  const totalChunks = state['totalChunks'];
  const contentWidth = state['contentWidth'];
  const contentHeight = state['contentHeight'];
  if (
    typeof pageCount !== 'number' ||
    typeof firm !== 'boolean' ||
    typeof realizedChunks !== 'number' ||
    typeof totalChunks !== 'number' ||
    typeof contentWidth !== 'number' ||
    typeof contentHeight !== 'number'
  ) {
    return null;
  }
  return { pageCount, firm, realizedChunks, totalChunks, contentWidth, contentHeight };
}

export function asFrameMessage(data: unknown): FrameMessage | null {
  const message = asRecord(data);
  if (message === null || message['v'] !== PROTOCOL_VERSION) return null;
  const id = message['id'];
  switch (message['type']) {
    case 'ready':
      return { v: PROTOCOL_VERSION, type: 'ready' };
    case 'pong':
      return typeof id === 'number' ? { v: PROTOCOL_VERSION, type: 'pong', id } : null;
    case 'measured': {
      const width = message['width'];
      const height = message['height'];
      if (typeof id !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null;
      return { v: PROTOCOL_VERSION, type: 'measured', id, width, height };
    }
    case 'paginated': {
      if (typeof id !== 'number') return null;
      const state = asPaginationState(message['state']);
      return state === null ? null : { v: PROTOCOL_VERSION, type: 'paginated', id, state };
    }
    case 'movedToPage': {
      const page = message['page'];
      if (typeof id !== 'number' || typeof page !== 'number') return null;
      return { v: PROTOCOL_VERSION, type: 'movedToPage', id, page };
    }
    case 'offset': {
      const offset = message['offset'];
      if (typeof id !== 'number' || typeof offset !== 'number') return null;
      return { v: PROTOCOL_VERSION, type: 'offset', id, offset };
    }
    case 'page': {
      const page = message['page'];
      if (typeof id !== 'number' || typeof page !== 'number') return null;
      return { v: PROTOCOL_VERSION, type: 'page', id, page };
    }
    case 'scrolledTo': {
      const top = message['top'];
      if (typeof id !== 'number' || typeof top !== 'number') return null;
      return { v: PROTOCOL_VERSION, type: 'scrolledTo', id, top };
    }
    case 'text': {
      const text = message['text'];
      if (typeof id !== 'number' || typeof text !== 'string') return null;
      return { v: PROTOCOL_VERSION, type: 'text', id, text };
    }
    case 'decorated': {
      const boxes = message['boxes'];
      if (typeof id !== 'number' || typeof boxes !== 'number') return null;
      return { v: PROTOCOL_VERSION, type: 'decorated', id, boxes };
    }
    case 'diagnosticsReport': {
      const domNodes = message['domNodes'];
      const realizedChunks = message['realizedChunks'];
      const totalChunks = message['totalChunks'];
      if (
        typeof id !== 'number' ||
        typeof domNodes !== 'number' ||
        typeof realizedChunks !== 'number' ||
        typeof totalChunks !== 'number'
      ) {
        return null;
      }
      return { v: PROTOCOL_VERSION, type: 'diagnosticsReport', id, domNodes, realizedChunks, totalChunks };
    }
    case 'violation': {
      const directive = message['directive'];
      const blockedUri = message['blockedUri'];
      if (typeof directive !== 'string' || typeof blockedUri !== 'string') return null;
      return { v: PROTOCOL_VERSION, type: 'violation', directive, blockedUri };
    }
    case 'error': {
      const text = message['message'];
      return typeof text === 'string' ? { v: PROTOCOL_VERSION, type: 'error', message: text } : null;
    }
    case 'linkclick': {
      const href = message['href'];
      return typeof href === 'string' ? { v: PROTOCOL_VERSION, type: 'linkclick', href } : null;
    }
    case 'key': {
      const key = message['key'];
      return typeof key === 'string' ? { v: PROTOCOL_VERSION, type: 'key', key } : null;
    }
    case 'swipe': {
      const dx = message['dx'];
      const dy = message['dy'];
      if (typeof dx !== 'number' || typeof dy !== 'number') return null;
      return { v: PROTOCOL_VERSION, type: 'swipe', dx, dy };
    }
    case 'tap': {
      const x = message['x'];
      const y = message['y'];
      const width = message['width'];
      const height = message['height'];
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof width !== 'number' ||
        typeof height !== 'number'
      ) {
        return null;
      }
      return { v: PROTOCOL_VERSION, type: 'tap', x, y, width, height };
    }
    case 'selection': {
      const start = message['start'];
      const end = message['end'];
      const text = message['text'];
      if (typeof start !== 'number' || typeof end !== 'number' || typeof text !== 'string') {
        return null;
      }
      return { v: PROTOCOL_VERSION, type: 'selection', start, end, text };
    }
    case 'imagetap': {
      const src = message['src'];
      const alt = message['alt'];
      if (typeof src !== 'string' || typeof alt !== 'string') return null;
      return { v: PROTOCOL_VERSION, type: 'imagetap', src, alt };
    }
    default:
      return null;
  }
}

function asPaginateOptions(value: unknown): PaginateOptions | null {
  const options = asRecord(value);
  if (options === null) return null;
  const mode = options['mode'];
  const pageWidth = options['pageWidth'];
  const pageHeight = options['pageHeight'];
  const columnGap = options['columnGap'];
  const chunkChars = options['chunkChars'];
  const windowChunks = options['windowChunks'];
  const columnCount = options['columnCount'];
  if (
    (mode !== 'paginated' && mode !== 'scrolled') ||
    typeof pageWidth !== 'number' ||
    typeof pageHeight !== 'number' ||
    typeof columnGap !== 'number' ||
    typeof chunkChars !== 'number' ||
    typeof windowChunks !== 'number' ||
    typeof columnCount !== 'number'
  ) {
    return null;
  }
  return { mode, pageWidth, pageHeight, columnGap, chunkChars, windowChunks, columnCount };
}

export function asHostMessage(data: unknown): HostMessage | null {
  const message = asRecord(data);
  if (message === null || message['v'] !== PROTOCOL_VERSION) return null;
  const id = message['id'];
  if (typeof id !== 'number') return null;
  switch (message['type']) {
    case 'ping':
      return { v: PROTOCOL_VERSION, type: 'ping', id };
    case 'measure':
      return { v: PROTOCOL_VERSION, type: 'measure', id };
    case 'paginate': {
      const options = asPaginateOptions(message['options']);
      return options === null ? null : { v: PROTOCOL_VERSION, type: 'paginate', id, options };
    }
    case 'relayout':
      return { v: PROTOCOL_VERSION, type: 'relayout', id };
    case 'goToPage': {
      const page = message['page'];
      return typeof page === 'number' ? { v: PROTOCOL_VERSION, type: 'goToPage', id, page } : null;
    }
    case 'offsetOfPage': {
      const page = message['page'];
      return typeof page === 'number' ? { v: PROTOCOL_VERSION, type: 'offsetOfPage', id, page } : null;
    }
    case 'pageOfOffset': {
      const offset = message['offset'];
      return typeof offset === 'number' ? { v: PROTOCOL_VERSION, type: 'pageOfOffset', id, offset } : null;
    }
    case 'scrollToOffset': {
      const offset = message['offset'];
      return typeof offset === 'number' ? { v: PROTOCOL_VERSION, type: 'scrollToOffset', id, offset } : null;
    }
    case 'offsetOfElementId': {
      const elementId = message['elementId'];
      return typeof elementId === 'string'
        ? { v: PROTOCOL_VERSION, type: 'offsetOfElementId', id, elementId }
        : null;
    }
    case 'sectionText':
      return { v: PROTOCOL_VERSION, type: 'sectionText', id };
    case 'diagnostics':
      return { v: PROTOCOL_VERSION, type: 'diagnostics', id };
    case 'decorate': {
      const decorationId = message['decorationId'];
      const start = message['start'];
      const end = message['end'];
      const className = message['className'];
      if (
        typeof decorationId !== 'string' ||
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        typeof className !== 'string'
      ) {
        return null;
      }
      return { v: PROTOCOL_VERSION, type: 'decorate', id, decorationId, start, end, className };
    }
    case 'undecorate': {
      const decorationId = message['decorationId'];
      return typeof decorationId === 'string'
        ? { v: PROTOCOL_VERSION, type: 'undecorate', id, decorationId }
        : null;
    }
    default:
      return null;
  }
}
