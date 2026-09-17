import {
  HTML_DISCARDED,
  HTML_ELEMENTS,
  HTML_GLOBAL_ATTRIBUTES,
  HTML_NAMESPACE,
  isAllowedReference,
  SVG_DISCARDED_LOWER,
  SVG_ELEMENTS,
  SVG_GLOBAL_ATTRIBUTES,
  SVG_NAMESPACE,
  URL_ATTRIBUTES,
  XLINK_NAMESPACE,
} from './allowlist.ts';
import { classifyReference } from './reference.ts';

export interface RemovalCount {
  readonly name: string;
  readonly count: number;
}

export interface SanitizationSummary {
  /** The media type the markup was finally parsed as. */
  readonly parsedAs: string;
  /** True when XML parsing failed and the HTML parser took over. */
  readonly parseFallback: boolean;
  /** Elements removed with everything inside them. */
  readonly elementsRemoved: readonly RemovalCount[];
  /** Elements removed while keeping their children. */
  readonly elementsUnwrapped: readonly RemovalCount[];
  readonly attributesRemoved: readonly RemovalCount[];
}

export interface SanitizedSection {
  /** A fresh HTML document holding the sanitized head and body. */
  readonly document: Document;
  readonly summary: SanitizationSummary;
}

const XHTML_TYPE = 'application/xhtml+xml';
const HTML_TYPE = 'text/html';
const SVG_TYPE = 'image/svg+xml';
const PARSE_ERROR_NAMESPACE = 'http://www.mozilla.org/newlayout/xml/parseerror.xml';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

const SHOW_CDATA_SECTION = 8;
const SHOW_COMMENT = 128;
const SHOW_PROCESSING_INSTRUCTION = 64;
const CDATA_SECTION_NODE = 4;

// A <style> element is serialized as raw text, so text that closes the element
// escapes back into markup. XHTML lets an author write exactly that; HTML never
// could. Nothing legitimate needs it, so such a stylesheet is dropped whole.
const STYLE_BREAKOUT = /<\/style/i;

class Tally {
  readonly #counts = new Map<string, number>();

  add(name: string): void {
    this.#counts.set(name, (this.#counts.get(name) ?? 0) + 1);
  }

  toList(): readonly RemovalCount[] {
    return [...this.#counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
}

// Browsers disagree on where the error marker lands: Firefox makes it the root
// in its own namespace, Chromium makes it the first child of the root in the
// XHTML namespace. Miss it and a malformed book renders as a truncated tree
// with the browser's red error box wedged into the chapter.
function hasParseError(doc: Document): boolean {
  const root = doc.documentElement;
  if (root === null) return true;
  if (root.localName === 'parsererror') return true;
  if (doc.getElementsByTagNameNS(PARSE_ERROR_NAMESPACE, 'parsererror').length > 0) return true;
  for (const child of root.children) {
    if (child.localName === 'parsererror') return true;
  }
  return false;
}

function parseSource(source: string, mediaType: string): { document: Document; parsedAs: string; parseFallback: boolean } {
  const parser = new DOMParser();
  const requested: DOMParserSupportedType =
    mediaType === HTML_TYPE ? HTML_TYPE : mediaType === SVG_TYPE ? SVG_TYPE : XHTML_TYPE;
  if (requested !== HTML_TYPE) {
    const parsed = parser.parseFromString(source, requested);
    if (!hasParseError(parsed)) return { document: parsed, parsedAs: requested, parseFallback: false };
  }
  // Real books are malformed often enough that an XML parse failure is a
  // routine outcome, not a corrupt book: reparse as HTML and carry on.
  return {
    document: parser.parseFromString(source, HTML_TYPE),
    parsedAs: HTML_TYPE,
    parseFallback: requested !== HTML_TYPE,
  };
}

// Comments and processing instructions serialize raw and can break out of the
// markup on the way back into the frame; CDATA cannot exist in an HTML document
// at all, and EPUB wraps stylesheets in it constantly.
function flattenNonElementNodes(doc: Document, root: Node): void {
  const walker = doc.createTreeWalker(root, SHOW_CDATA_SECTION | SHOW_COMMENT | SHOW_PROCESSING_INSTRUCTION);
  const discarded: Node[] = [];
  const sections: Node[] = [];
  while (walker.nextNode() !== null) {
    const node = walker.currentNode;
    if (node.nodeType === CDATA_SECTION_NODE) sections.push(node);
    else discarded.push(node);
  }
  for (const node of sections) {
    node.parentNode?.replaceChild(doc.createTextNode(node.textContent ?? ''), node);
  }
  for (const node of discarded) node.parentNode?.removeChild(node);
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (parent === null) return;
  while (element.firstChild !== null) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

interface Tallies {
  readonly removed: Tally;
  readonly unwrapped: Tally;
  readonly attributes: Tally;
}

function scrubAttributes(element: Element, name: string, allowed: ReadonlySet<string>, svg: boolean, tallies: Tallies): void {
  const globals = svg ? SVG_GLOBAL_ATTRIBUTES : HTML_GLOBAL_ATTRIBUTES;
  const urlAttributes = URL_ATTRIBUTES.get(name);
  for (const attribute of [...element.attributes]) {
    // Namespace declarations are dropped silently: the HTML parser puts SVG
    // back in its own namespace by tag name when the frame document is read.
    if (attribute.namespaceURI === XMLNS_NAMESPACE || attribute.name === 'xmlns') {
      element.removeAttributeNode(attribute);
      continue;
    }
    // SVG attribute names are case-sensitive and the allowlist spells them as the
    // platform does (viewBox, preserveAspectRatio, gradientUnits): both parsers
    // deliver them in that case — XML verbatim, the HTML parser through its SVG
    // attribute adjustment table — so the lookup is exact. Lowercasing here
    // stripped every camelCase attribute a book's SVG relied on.
    const key = svg ? attribute.localName : attribute.name.toLowerCase();
    if (key.toLowerCase().startsWith('on')) {
      element.removeAttributeNode(attribute);
      tallies.attributes.add(attribute.name.toLowerCase());
      continue;
    }
    if (!globals.has(key) && !allowed.has(key) && !key.startsWith('aria-')) {
      element.removeAttributeNode(attribute);
      tallies.attributes.add(attribute.name.toLowerCase());
      continue;
    }
    if (urlAttributes === undefined || !urlAttributes.has(key)) continue;
    const reference = classifyReference(attribute.value);
    if (isAllowedReference(name, key, reference.kind, reference.scheme)) continue;
    element.removeAttributeNode(attribute);
    tallies.attributes.add(`${key} (${reference.scheme ?? reference.kind})`);
  }
}

function scrub(element: Element, tallies: Tallies): void {
  const namespace = element.namespaceURI;
  const svg = namespace === SVG_NAMESPACE;
  // Same case rule for element names: the SVG allowlist is matched exactly
  // (clipPath, linearGradient, radialGradient), HTML case-insensitively.
  const name = svg ? element.localName : element.localName.toLowerCase();

  // Foreign vocabularies (MathML and anything else a book invents) keep their
  // text and lose their elements: nothing in them is known to be safe, and
  // their text is still part of the book.
  if (!svg && namespace !== null && namespace !== HTML_NAMESPACE) {
    for (const child of [...element.children]) scrub(child, tallies);
    tallies.unwrapped.add(name);
    unwrap(element);
    return;
  }

  // Discarding is case-insensitive in both vocabularies: an SVG element the parser
  // did not case-adjust (`<FOREIGNOBJECT>` in XML) is inert, but the search
  // extractor mirrors this rule over raw markup and cannot tell, so both discard.
  const discarded = svg ? SVG_DISCARDED_LOWER : HTML_DISCARDED;
  if (discarded.has(name.toLowerCase())) {
    tallies.removed.add(name);
    element.remove();
    return;
  }
  if (name === 'link' && !/(^|\s)stylesheet(\s|$)/i.test(element.getAttribute('rel') ?? '')) {
    tallies.removed.add('link');
    element.remove();
    return;
  }
  if (name === 'style' && STYLE_BREAKOUT.test(element.textContent ?? '')) {
    tallies.removed.add('style');
    element.remove();
    return;
  }

  for (const child of [...element.children]) scrub(child, tallies);

  const allowed = (svg ? SVG_ELEMENTS : HTML_ELEMENTS).get(name);
  if (allowed === undefined) {
    tallies.unwrapped.add(name);
    unwrap(element);
    return;
  }
  scrubAttributes(element, name, allowed, svg, tallies);

  // A <use> whose reference was refused points at nothing and can only be a
  // leftover of the data:-document vector, so it goes rather than lingering.
  if (svg && name === 'use' && !element.hasAttribute('href') && !element.hasAttributeNS(XLINK_NAMESPACE, 'href')) {
    tallies.removed.add('use');
    element.remove();
  }
}

/**
 * Parses, normalizes and sanitizes a section in one pass, returning a fresh
 * HTML document that owns the result.
 *
 * The three are one pass on purpose. Normalization — an XHTML `<a id="x"/>`
 * becoming `<a id="x"></a>` rather than swallowing the rest of the chapter —
 * is a property of parsing as XML and re-serializing as HTML, and the sanitizer
 * is the only place the markup is parsed at all. Doing it twice would be both
 * wasteful and a chance for the two DOMs to disagree.
 */
export function sanitizeSection(source: string, mediaType: string): SanitizedSection {
  const parsed = parseSource(source, mediaType);
  const doc = parsed.document;
  const tallies: Tallies = { removed: new Tally(), unwrapped: new Tally(), attributes: new Tally() };

  const root = doc.documentElement;
  if (root !== null) flattenNonElementNodes(doc, root);

  const head: Element | null = doc.head ?? doc.querySelector('head');
  const body: Element | null = doc.body ?? doc.querySelector('body');

  const svgRoot = body === null && root !== null && root.namespaceURI === SVG_NAMESPACE;
  if (body === null) {
    // A spine item may be an SVG document in its own right; anything else
    // without a <body> contributes its root element's children.
    if (svgRoot && root !== null) scrub(root, tallies);
    else if (root !== null) for (const child of [...root.children]) scrub(child, tallies);
  } else {
    if (head !== null) for (const child of [...head.children]) scrub(child, tallies);
    for (const child of [...body.children]) scrub(child, tallies);
  }

  const out = document.implementation.createHTMLDocument('');
  if (head !== null) {
    for (const element of head.querySelectorAll('link, style')) {
      out.head.append(out.importNode(element, true));
    }
  }
  const content = body !== null ? body : svgRoot ? null : root;
  if (content !== null) {
    for (const node of [...content.childNodes]) out.body.append(out.importNode(node, true));
  } else if (root !== null) {
    out.body.append(out.importNode(root, true));
  }

  return {
    document: out,
    summary: {
      parsedAs: parsed.parsedAs,
      parseFallback: parsed.parseFallback,
      elementsRemoved: tallies.removed.toList(),
      elementsUnwrapped: tallies.unwrapped.toList(),
      attributesRemoved: tallies.attributes.toList(),
    },
  };
}
