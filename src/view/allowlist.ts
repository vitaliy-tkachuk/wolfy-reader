/**
 * What is allowed to survive sanitization, stated as allowlists.
 *
 * A blocklist loses to the next vector the platform invents; an allowlist only
 * ever loses formatting. Anything absent from these tables is either unwrapped
 * (the element goes, its text stays — a book is text before it is markup) or,
 * when its children are not readable content, discarded whole.
 */

function set(...names: string[]): ReadonlySet<string> {
  return new Set(names);
}

const NONE: ReadonlySet<string> = new Set<string>();

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

export const HTML_GLOBAL_ATTRIBUTES = set(
  'class',
  'dir',
  'epub:type',
  'hidden',
  'id',
  'lang',
  'role',
  'style',
  'title',
  'translate',
  'xml:lang',
);

const CELL = set('abbr', 'align', 'colspan', 'headers', 'rowspan', 'scope', 'valign', 'width');

export const HTML_ELEMENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['a', set('href')],
  ['abbr', NONE],
  ['address', NONE],
  ['article', NONE],
  ['aside', NONE],
  ['b', NONE],
  ['bdi', NONE],
  ['bdo', NONE],
  ['big', NONE],
  ['blockquote', set('cite')],
  ['br', NONE],
  ['caption', set('align')],
  ['center', NONE],
  ['cite', NONE],
  ['code', NONE],
  ['col', set('align', 'span', 'valign', 'width')],
  ['colgroup', set('align', 'span', 'valign', 'width')],
  ['dd', NONE],
  ['del', set('cite', 'datetime')],
  ['details', set('open')],
  ['dfn', NONE],
  ['div', NONE],
  ['dl', NONE],
  ['dt', NONE],
  ['em', NONE],
  ['figcaption', NONE],
  ['figure', NONE],
  ['footer', NONE],
  ['h1', NONE],
  ['h2', NONE],
  ['h3', NONE],
  ['h4', NONE],
  ['h5', NONE],
  ['h6', NONE],
  ['header', NONE],
  ['hgroup', NONE],
  ['hr', NONE],
  ['i', NONE],
  ['img', set('alt', 'height', 'src', 'width')],
  ['ins', set('cite', 'datetime')],
  ['kbd', NONE],
  ['li', set('value')],
  ['link', set('href', 'media', 'rel', 'type')],
  ['main', NONE],
  ['mark', NONE],
  ['nav', NONE],
  ['ol', set('reversed', 'start', 'type')],
  ['p', NONE],
  ['pre', NONE],
  ['q', set('cite')],
  ['rp', NONE],
  ['rt', NONE],
  ['ruby', NONE],
  ['s', NONE],
  ['samp', NONE],
  ['section', NONE],
  ['small', NONE],
  ['span', NONE],
  ['strike', NONE],
  ['strong', NONE],
  ['style', set('media', 'type')],
  ['sub', NONE],
  ['summary', NONE],
  ['sup', NONE],
  ['table', set('align', 'border', 'cellpadding', 'cellspacing', 'summary', 'width')],
  ['tbody', set('align', 'valign')],
  ['td', CELL],
  ['tfoot', set('align', 'valign')],
  ['th', CELL],
  ['thead', set('align', 'valign')],
  ['time', set('datetime')],
  ['tr', set('align', 'valign')],
  ['tt', NONE],
  ['u', NONE],
  ['ul', NONE],
  ['var', NONE],
  ['wbr', NONE],
]);

/**
 * Elements that go with everything inside them, because their children are not
 * prose: raw-text elements whose content is source rather than text, form
 * controls, and void elements with no children to keep.
 *
 * Everything else absent from the allowlist is *unwrapped* instead — the
 * element goes, its text stays. That distinction is load-bearing twice over. A
 * book is text before it is markup, and a malformed one nests half a chapter
 * inside a stray element: an </noscript> end tag after an open <p> is ignored
 * by the HTML parser, so an unclosed <noscript> swallows everything after it,
 * and discarding that element would delete the rest of the chapter.
 *
 * <noscript> is also why unwrapping is the safer option and not merely the
 * kinder one. Its content is markup when a document is parsed with scripting
 * off and raw text when it is parsed with scripting on, so an element that
 * survives into the frame is re-read in the other mode and attribute
 * boundaries move under it — the mutation-XSS shape this pipeline exists to
 * defeat. Removing the element removes the reinterpretation.
 *
 * The table itself lives in `src/core/reading-text.ts` (re-exported here under
 * its frozen name): discarding decides not only what renders but what the
 * frame's *text* is, and the headless search extractor must mirror it exactly
 * so a hit's anchor exists in the text the frame resolves against. One table,
 * two consumers — never fork it.
 */
export { DISCARDED_HTML_ELEMENTS as HTML_DISCARDED } from '../core/reading-text.ts';

export const SVG_GLOBAL_ATTRIBUTES = set(
  'class',
  'clip-path',
  'clip-rule',
  'color',
  'display',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'id',
  'lang',
  'letter-spacing',
  'mask',
  'opacity',
  'overflow',
  'paint-order',
  'role',
  'shape-rendering',
  'space',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'style',
  'text-anchor',
  'transform',
  'vector-effect',
  'visibility',
  'word-spacing',
);

const GRADIENT = set(
  'cx',
  'cy',
  'fr',
  'fx',
  'fy',
  'gradientTransform',
  'gradientUnits',
  'r',
  'spreadMethod',
  'x1',
  'x2',
  'y1',
  'y2',
);

const TEXT_POSITION = set('dx', 'dy', 'rotate', 'textLength', 'x', 'y');

export const SVG_ELEMENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['a', set('href')],
  ['circle', set('cx', 'cy', 'r')],
  ['clipPath', set('clipPathUnits')],
  ['defs', NONE],
  ['desc', NONE],
  ['ellipse', set('cx', 'cy', 'rx', 'ry')],
  ['g', NONE],
  ['image', set('height', 'href', 'preserveAspectRatio', 'width', 'x', 'y')],
  ['line', set('x1', 'x2', 'y1', 'y2')],
  ['linearGradient', GRADIENT],
  ['marker', set('markerHeight', 'markerUnits', 'markerWidth', 'orient', 'refX', 'refY', 'viewBox')],
  ['mask', set('height', 'maskContentUnits', 'maskUnits', 'width', 'x', 'y')],
  ['path', set('d', 'pathLength')],
  ['pattern', set('height', 'patternContentUnits', 'patternTransform', 'patternUnits', 'viewBox', 'width', 'x', 'y')],
  ['polygon', set('points')],
  ['polyline', set('points')],
  ['radialGradient', GRADIENT],
  ['rect', set('height', 'rx', 'ry', 'width', 'x', 'y')],
  ['stop', set('offset')],
  ['style', set('media', 'type')],
  ['svg', set('height', 'preserveAspectRatio', 'version', 'viewBox', 'width', 'x', 'y')],
  ['symbol', set('preserveAspectRatio', 'viewBox')],
  ['text', TEXT_POSITION],
  ['title', NONE],
  ['tspan', TEXT_POSITION],
  ['use', set('height', 'href', 'width', 'x', 'y')],
]);

/**
 * SMIL animation is on this list, not merely absent from the allowlist, because
 * `<animate attributeName="href" to="javascript:...">` turns an inert element
 * into a live one after sanitization has already run.
 *
 * Shared from `src/core/reading-text.ts` for the same reason as HTML_DISCARDED:
 * the search extractor mirrors what discarding removes from the frame's text.
 */
export { DISCARDED_SVG_ELEMENTS as SVG_DISCARDED } from '../core/reading-text.ts';

/** Attributes carrying a reference, by element local name. */
export const URL_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['a', set('href')],
  ['blockquote', set('cite')],
  ['del', set('cite')],
  ['image', set('href')],
  ['img', set('src')],
  ['ins', set('cite')],
  ['link', set('href')],
  ['q', set('cite')],
  ['use', set('href')],
]);

const LINK_SCHEMES = set('http', 'https', 'mailto', 'tel');
const MEDIA_SCHEMES = set('data', 'http', 'https');

/**
 * Whether a reference may stay on the attribute at all. Relative references are
 * kept so they can be resolved to blob URLs; remote ones are kept so CSP is the
 * layer that refuses them, and refuses them observably.
 */
export function isAllowedReference(element: string, attribute: string, kind: string, scheme: string | undefined): boolean {
  // <use href> reaches into the same document and nowhere else: a data: URI
  // there is a document-injection vector, not an image reference.
  if (element === 'use') return kind === 'fragment';
  if (kind === 'fragment') return element === 'a';
  if (kind === 'relative') return true;
  if (kind !== 'scheme' || scheme === undefined) return false;
  if (attribute === 'src' || (element === 'image' && attribute === 'href') || element === 'link') {
    return MEDIA_SCHEMES.has(scheme);
  }
  return LINK_SCHEMES.has(scheme);
}
