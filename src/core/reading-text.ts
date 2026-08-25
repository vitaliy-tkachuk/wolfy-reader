/**
 * The canonical "reading text" policy — the single definition of which parts of a
 * section's markup become the text a reader actually sees in the frame.
 *
 * Two independent consumers must agree on it, and this module is how they stay one
 * model rather than two:
 *
 * - `src/view` sanitizes and applies resources before rendering: discarded elements
 *   vanish with their children (`sanitize.ts`), and an `<img>` that cannot be served
 *   is replaced by its `alt` text (`resources.ts`). The frame's measured section
 *   text — what a `Position` resolves against — is the `textContent` of that output.
 * - `src/search` captures hit anchors headlessly, without a DOM, over the same text.
 *   Its extractor (`src/search/extract.ts`) mirrors the pipeline using the tables
 *   and predicates here, so a captured quote/context window exists verbatim in the
 *   text the frame resolves against.
 *
 * Internal to the library: nothing here is re-exported from `src/core/index.ts`
 * (same status as `graphemes.ts`), so it is shared implementation, not public
 * surface. It is headless by rule — string tables and string predicates only —
 * because `src/search` may import only `src/core` and platform primitives.
 */

function set(...names: string[]): ReadonlySet<string> {
  return new Set(names);
}

/**
 * HTML elements the sanitizer removes with everything inside them, because their
 * children are not prose: raw-text elements whose content is source rather than
 * text, form controls, and void elements with no children to keep. Everything
 * else absent from the allowlist is unwrapped instead — the element goes, its
 * text stays. The unwrap-vs-discard rationale lives with the allowlist
 * (`src/view/allowlist.ts`), which re-exports these under their frozen names.
 */
export const DISCARDED_HTML_ELEMENTS = set(
  'area',
  'base',
  'button',
  'embed',
  'frame',
  'frameset',
  'iframe',
  'input',
  'keygen',
  'listing',
  'meta',
  'noembed',
  'noframes',
  'option',
  'optgroup',
  'param',
  'plaintext',
  'script',
  'select',
  'source',
  'template',
  'textarea',
  'title',
  'track',
  'xmp',
);

/**
 * SVG elements discarded whole. SMIL animation is on this list, not merely absent
 * from the allowlist, because `<animate attributeName="href" to="javascript:...">`
 * turns an inert element into a live one after sanitization has already run.
 */
export const DISCARDED_SVG_ELEMENTS = set(
  'animate',
  'animateMotion',
  'animateTransform',
  'audio',
  'canvas',
  'discard',
  'foreignObject',
  'handler',
  'iframe',
  'listener',
  'script',
  'set',
  'video',
);

export type ReferenceKind = 'empty' | 'fragment' | 'relative' | 'scheme';

export interface ClassifiedReference {
  readonly kind: ReferenceKind;
  /** The reference with URL-insignificant whitespace removed. */
  readonly value: string;
  /** Lowercased scheme name, present only when kind is 'scheme'. */
  readonly scheme?: string;
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const SPACE = 0x20;
const TAB = 0x09;
const NEWLINE = 0x0a;
const RETURN = 0x0d;

// The URL parser trims leading and trailing C0 controls and spaces, then drops
// tab, LF and CR from anywhere in the string. Doing the same here is what makes
// a reference written as `java&#10;script:alert(1)` classify as a scheme.
function stripUrlWhitespace(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && raw.charCodeAt(start) <= SPACE) start += 1;
  while (end > start && raw.charCodeAt(end - 1) <= SPACE) end -= 1;
  let value = '';
  for (let i = start; i < end; i += 1) {
    const code = raw.charCodeAt(i);
    if (code === TAB || code === NEWLINE || code === RETURN) continue;
    value += raw.charAt(i);
  }
  return value;
}

export function classifyReference(raw: string): ClassifiedReference {
  const value = stripUrlWhitespace(raw);
  if (value === '') return { kind: 'empty', value };
  if (value.startsWith('#')) return { kind: 'fragment', value };
  const match = SCHEME.exec(value);
  if (match !== null) return { kind: 'scheme', value, scheme: (match[1] ?? '').toLowerCase() };
  return { kind: 'relative', value };
}

/** Collapses `.` and `..` segments, keeping leading `..` that cannot be resolved. */
export function normalizeReference(reference: string): string {
  const out: string[] = [];
  for (const segment of reference.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      out.push(segment);
      continue;
    }
    const last = out[out.length - 1];
    if (last === undefined || last === '..') out.push('..');
    else out.pop();
  }
  return (reference.startsWith('/') ? '/' : '') + out.join('/');
}

const FONT_TYPES = new Set([
  'application/font-woff',
  'application/font-woff2',
  'application/vnd.ms-fontobject',
  'application/vnd.ms-opentype',
  'application/x-font-opentype',
  'application/x-font-otf',
  'application/x-font-truetype',
  'application/x-font-ttf',
  'application/x-font-woff',
]);

/** The bare media type: parameters trimmed, lowercased. */
export function baseMediaType(mediaType: string): string {
  return (mediaType.split(';')[0] ?? '').trim().toLowerCase();
}

/**
 * Only these media types are minted a `data:` URL by the resource layer. A
 * reference resolving is not evidence it should be served: the seam answers for
 * the whole manifest, so a `text/javascript` entry resolves as readily as an
 * image — and a URL is a capability, not a convenience.
 */
export function isServableResource(mediaType: string): boolean {
  const type = baseMediaType(mediaType);
  return type.startsWith('image/') || type.startsWith('font/') || FONT_TYPES.has(type);
}

/** The synchronous face of `Section.resolve` — all the image policy needs. */
export type ReadingResolver = (reference: string) => { readonly mediaType: string } | undefined;

/**
 * The text an `<img>` contributes to the reading text: `''` when the element
 * survives as an image (a served resource, or a remote/`data:` reference left for
 * the CSP to refuse), or its `alt` when the resource layer substitutes the alt
 * text for an image it cannot serve (`applyResources` in `src/view/resources.ts`
 * — Gutenberg drop caps are the motivating case). An empty/absent `alt` on an
 * unservable image means decorative: the element is removed and contributes
 * nothing, which `''` also expresses.
 *
 * This is the headless mirror of the frame-side decision; the one edge it cannot
 * see is a resource whose bytes fail to *load* after resolving servable — the
 * frame substitutes alt there too, and a search anchor over that rare case
 * degrades to the ordinary soft miss. Change this and the `applyResources` image
 * branch together.
 */
export function imageReadingText(
  src: string | null,
  alt: string | null,
  resolve: ReadingResolver | undefined,
): string {
  const classified = src === null ? undefined : classifyReference(src);
  if (classified !== undefined && classified.kind !== 'relative') return '';
  if (classified !== undefined) {
    const resource = resolve?.(normalizeReference(classified.value));
    if (resource !== undefined && isServableResource(resource.mediaType)) return '';
  }
  return alt ?? '';
}
