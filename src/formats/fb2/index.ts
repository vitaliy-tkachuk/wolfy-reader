import type { Book, BookFormat, BookMetadata, ByteSource, Resource, Section, TocItem } from '../../core/index.ts';
import { CorruptContainerError } from '../../core/index.ts';
import { sectionLookup } from '../../core/lookup.ts';
import { collapseWhitespace, escapeXmlAttribute, escapeXmlText } from '../../core/text.ts';
import {
  attribute,
  childrenNamed,
  decodeXml,
  deepText,
  firstChildNamed,
  parseXml,
  type XmlElement,
} from '../xml.ts';

/**
 * FictionBook 2 (FB2) format. A single XML file with the whole book inside:
 * `description` metadata, one or more `body` elements of nested `<section>`s, and
 * inline base64 `<binary>` images. The seam probe's second format (PLAN M4-2):
 * it proves the `Book` model fits a container-less, single-file, cross-referencing
 * format without bending — sections come from `<section>`s, images from `<binary>`
 * via `Section.resolve`, and footnotes ride the reader's existing internal-link
 * back-stack because every in-book link is rewritten to a `sectionId#elementId`
 * href the reader already knows how to follow.
 */
export const fb2: BookFormat = {
  name: 'fb2',
  async sniff(source) {
    const head = await source.read(0, Math.min(source.size, 1024));
    // A UTF-16 BOM must be honored first: read as Latin-1, every other byte of a
    // UTF-16 head is NUL and `<FictionBook` never matches, so a BOM'd UTF-16 FB2
    // would fall through to the text format's catch-all sniff. Without a BOM,
    // read as Latin-1 so the root element name is legible whatever the real
    // encoding is; the FB2 root is always near the top.
    let text: string;
    if (head[0] === 0xff && head[1] === 0xfe) text = new TextDecoder('utf-16le').decode(head);
    else if (head[0] === 0xfe && head[1] === 0xff) text = new TextDecoder('utf-16be').decode(head);
    else {
      text = '';
      for (let i = 0; i < head.length; i += 1) text += String.fromCharCode(head[i]!);
    }
    return /<\s*FictionBook[\s>]/.test(text);
  },
  async decode(source) {
    const bytes = await source.read(0, source.size);
    let root: XmlElement;
    try {
      // Tolerant parse: real-world FB2 is frequently sloppy (valueless attributes,
      // a mismatched close tag), and one such slip must not discard an otherwise
      // readable book. Grossly malformed input still fails and is wrapped below.
      root = parseXml(decodeXml(bytes), { tolerant: true });
    } catch (error) {
      throw new CorruptContainerError('the FB2 document is not well-formed XML', { cause: error });
    }
    if (root.localName !== 'FictionBook') {
      throw new CorruptContainerError('the root element is not <FictionBook>');
    }
    return buildBook(root);
  },
};

// --- binaries ---------------------------------------------------------------

interface Binary {
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

function collectBinaries(root: XmlElement): Map<string, Binary> {
  const out = new Map<string, Binary>();
  for (const bin of childrenNamed(root, 'binary')) {
    const id = attribute(bin, 'id');
    if (id === undefined) continue;
    const mediaType = attribute(bin, 'content-type') ?? 'application/octet-stream';
    // One unreadable binary must not cost the whole book: it is dropped, so the
    // id simply resolves to nothing — the model's documented degrade for a
    // broken resource.
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(bin.text);
    } catch {
      continue;
    }
    out.set(id, { mediaType, bytes });
  }
  return out;
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// --- book assembly ----------------------------------------------------------

interface PlannedSection {
  readonly id: string;
  readonly source: XmlElement;
  /** Depth of the source <section> for heading levels; notes bodies start at 2. */
  readonly headingLevel: number;
  /** Body-level nodes rendered ahead of the section's own content. */
  readonly prefix?: readonly (XmlElement | string)[];
}

function buildBook(root: XmlElement): Book {
  const binaries = collectBinaries(root);
  const bodies = childrenNamed(root, 'body');
  const mainBody = bodies.find((b) => attribute(b, 'name') === undefined) ?? bodies[0];
  const noteBodies = bodies.filter((b) => b !== mainBody);

  // Plan the Book sections: each top-level <section> of the main body is one
  // section; each notes body is one section (so footnote targets resolve there).
  const planned: PlannedSection[] = [];
  const mainSections = mainBody === undefined ? [] : childrenNamed(mainBody, 'section');
  // A main body may open with a title, epigraphs and an image before its first
  // <section>. That content is prepended to the first section rather than given
  // one of its own, because section ids are index-synthesized and a new leading
  // section would renumber every later one, shifting persisted positions.
  const preamble = mainBody?.content.filter((node) => typeof node === 'string' || node.localName !== 'section') ?? [];
  const hasPreamble = preamble.some((node) => typeof node !== 'string');
  mainSections.forEach((section, i) => {
    const prefix = i === 0 && hasPreamble ? { prefix: preamble } : {};
    planned.push({ id: `s${i}`, source: section, headingLevel: 2, ...prefix });
  });
  // A main body may hold bare paragraphs with no <section> wrapper; keep them as a
  // single section so nothing is dropped.
  if (mainSections.length === 0 && mainBody !== undefined) {
    planned.push({ id: 's0', source: mainBody, headingLevel: 2 });
  }
  noteBodies.forEach((body, i) => planned.push({ id: `nb${i}`, source: body, headingLevel: 3 }));

  // Map every FB2 element id to the Book section that renders it, so an in-book
  // link `#id` can be rewritten to a `sectionId#id` href the reader can follow
  // across sections (a bare `#id` only seeks the current section).
  const idToSection = new Map<string, string>();
  for (const plan of planned) {
    const prefixElements = (plan.prefix ?? []).filter((node): node is XmlElement => typeof node !== 'string');
    for (const root of [plan.source, ...prefixElements]) {
      for (const el of elementsWithId(root)) {
        const id = attribute(el, 'id');
        if (id !== undefined && !idToSection.has(id)) idToSection.set(id, plan.id);
      }
    }
  }

  const sections: Section[] = planned.map((plan) => {
    const html = renderDocument(plan, idToSection);
    return {
      id: plan.id,
      mediaType: 'application/xhtml+xml',
      load: () => Promise.resolve(new TextEncoder().encode(html)),
      resolve: (reference) => resolveBinary(reference, binaries),
    };
  });

  return {
    metadata: readMetadata(root, binaries),
    toc: buildToc(mainSections, planned),
    sections,
    section: sectionLookup(sections),
    resources: resourceMap(binaries),
  };
}

function resolveBinary(reference: string, binaries: ReadonlyMap<string, Binary>): Resource | undefined {
  const id = reference.startsWith('#') ? reference.slice(1) : reference;
  const bin = binaries.get(id);
  if (bin === undefined) return undefined;
  return { mediaType: bin.mediaType, load: () => Promise.resolve(bin.bytes) };
}

function resourceMap(binaries: ReadonlyMap<string, Binary>): Map<string, Resource> {
  const out = new Map<string, Resource>();
  for (const [id, bin] of binaries) {
    out.set(id, { mediaType: bin.mediaType, load: () => Promise.resolve(bin.bytes) });
  }
  return out;
}

function elementsWithId(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (el: XmlElement): void => {
    if (attribute(el, 'id') !== undefined) out.push(el);
    for (const child of el.children) walk(child);
  };
  walk(root);
  return out;
}

// --- metadata ---------------------------------------------------------------

function readMetadata(root: XmlElement, binaries: ReadonlyMap<string, Binary>): BookMetadata {
  const description = firstChildNamed(root, 'description');
  const titleInfo = description === undefined ? undefined : firstChildNamed(description, 'title-info');
  if (titleInfo === undefined) return {};

  const title = textOf(firstChildNamed(titleInfo, 'book-title'));
  const language = textOf(firstChildNamed(titleInfo, 'lang'));
  const author = authorName(firstChildNamed(titleInfo, 'author'));
  const cover = coverResource(titleInfo, binaries);

  return {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(language === undefined ? {} : { language }),
    ...(cover === undefined ? {} : { cover }),
  };
}

function authorName(author: XmlElement | undefined): string | undefined {
  if (author === undefined) return undefined;
  const nick = textOf(firstChildNamed(author, 'nickname'));
  const parts = [
    textOf(firstChildNamed(author, 'first-name')),
    textOf(firstChildNamed(author, 'middle-name')),
    textOf(firstChildNamed(author, 'last-name')),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  if (parts.length > 0) return parts.join(' ');
  return nick;
}

function coverResource(titleInfo: XmlElement, binaries: ReadonlyMap<string, Binary>): Resource | undefined {
  const coverpage = firstChildNamed(titleInfo, 'coverpage');
  if (coverpage === undefined) return undefined;
  const image = firstChildNamed(coverpage, 'image');
  const href = image === undefined ? undefined : attribute(image, 'href');
  if (href === undefined) return undefined;
  return resolveBinary(href, binaries);
}

function textOf(element: XmlElement | undefined): string | undefined {
  if (element === undefined) return undefined;
  const text = collapseWhitespace(deepText(element));
  return text.length === 0 ? undefined : text;
}

// --- TOC --------------------------------------------------------------------

function buildToc(mainSections: readonly XmlElement[], planned: readonly PlannedSection[]): TocItem[] {
  const toc: TocItem[] = [];
  mainSections.forEach((section, i) => {
    const plan = planned[i];
    if (plan === undefined) return;
    const label = sectionTitle(section) ?? `Section ${i + 1}`;
    toc.push({ label, sectionId: plan.id, children: nestedToc(section, plan.id) });
  });
  return toc;
}

/**
 * Nested <section>s at any depth become nested TOC entries, all targeting the
 * owning top-level Book section with the nested element id as the fragment. An
 * untitled level has no entry of its own but still yields its titled
 * descendants, so a labelled depth is never lost behind an unlabelled parent.
 */
function nestedToc(section: XmlElement, sectionId: string): TocItem[] {
  const out: TocItem[] = [];
  for (const nested of childrenNamed(section, 'section')) {
    const children = nestedToc(nested, sectionId);
    const label = sectionTitle(nested);
    if (label === undefined) {
      out.push(...children);
      continue;
    }
    const id = attribute(nested, 'id');
    out.push({ label, sectionId, ...(id === undefined ? {} : { fragment: id }), children });
  }
  return out;
}

function sectionTitle(section: XmlElement): string | undefined {
  const title = firstChildNamed(section, 'title');
  return textOf(title);
}

// --- rendering FB2 → XHTML --------------------------------------------------

const INLINE_TAG: Record<string, string> = {
  emphasis: 'em',
  strong: 'strong',
  strikethrough: 's',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

function renderDocument(plan: PlannedSection, idToSection: ReadonlyMap<string, string>): string {
  // The body preamble sits a level above the chapters it introduces, so its
  // <title> becomes the document's <h1>.
  const prefix = plan.prefix === undefined ? '' : renderNodes(plan.prefix, 1, idToSection);
  const body = prefix + renderChildren(plan.source, plan.headingLevel, idToSection);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"/></head><body>${body}</body></html>`;
}

function renderChildren(el: XmlElement, headingLevel: number, idToSection: ReadonlyMap<string, string>): string {
  return renderNodes(el.content, headingLevel, idToSection);
}

function renderNodes(
  nodes: readonly (XmlElement | string)[],
  headingLevel: number,
  idToSection: ReadonlyMap<string, string>,
): string {
  let out = '';
  for (const node of nodes) {
    out += typeof node === 'string' ? escapeXmlText(node) : renderElement(node, headingLevel, idToSection);
  }
  return out;
}

function renderElement(el: XmlElement, headingLevel: number, idToSection: ReadonlyMap<string, string>): string {
  const id = attribute(el, 'id');
  const idAttr = id === undefined ? '' : ` id="${escapeXmlAttribute(id)}"`;

  switch (el.localName) {
    case 'section': {
      const inner = renderChildren(el, Math.min(headingLevel + 1, 6), idToSection);
      return `<div class="fb2-section"${idAttr}>${inner}</div>`;
    }
    case 'title': {
      const level = Math.min(headingLevel, 6);
      return `<h${level}${idAttr}>${renderInlineLines(el, idToSection)}</h${level}>`;
    }
    case 'subtitle':
      return `<h${Math.min(headingLevel + 1, 6)}${idAttr}>${renderChildren(el, headingLevel, idToSection)}</h${Math.min(headingLevel + 1, 6)}>`;
    case 'p':
      return `<p${idAttr}>${renderChildren(el, headingLevel, idToSection)}</p>`;
    case 'empty-line':
      return `<p class="fb2-empty-line"${idAttr}></p>`;
    case 'a': {
      const href = rewriteHref(attribute(el, 'href'), idToSection);
      const hrefAttr = href === undefined ? '' : ` href="${escapeXmlAttribute(href)}"`;
      return `<a${hrefAttr}${idAttr}>${renderChildren(el, headingLevel, idToSection)}</a>`;
    }
    case 'image': {
      const href = attribute(el, 'href');
      const src = href === undefined ? '' : href.startsWith('#') ? href.slice(1) : href;
      const alt = attribute(el, 'alt') ?? '';
      return `<img src="${escapeXmlAttribute(src)}" alt="${escapeXmlAttribute(alt)}"${idAttr}/>`;
    }
    case 'table':
    case 'tr':
    case 'th':
    case 'td': {
      const tag = el.localName;
      return `<${tag}${idAttr}${tableAttributes(el, tag)}>${renderChildren(el, headingLevel, idToSection)}</${tag}>`;
    }
    case 'epigraph':
      return `<div class="fb2-epigraph"${idAttr}>${renderChildren(el, headingLevel, idToSection)}</div>`;
    case 'cite':
      return `<blockquote${idAttr}>${renderChildren(el, headingLevel, idToSection)}</blockquote>`;
    case 'poem':
      return `<div class="fb2-poem"${idAttr}>${renderChildren(el, headingLevel, idToSection)}</div>`;
    case 'stanza':
      return `<div class="fb2-stanza"${idAttr}>${renderChildren(el, headingLevel, idToSection)}</div>`;
    case 'v':
      return `<p class="fb2-verse"${idAttr}>${renderChildren(el, headingLevel, idToSection)}</p>`;
    case 'text-author':
      return `<p class="fb2-text-author"${idAttr}>${renderChildren(el, headingLevel, idToSection)}</p>`;
    case 'annotation':
      return `<div class="fb2-annotation"${idAttr}>${renderChildren(el, headingLevel, idToSection)}</div>`;
    default: {
      const inline = INLINE_TAG[el.localName];
      if (inline !== undefined) {
        return `<${inline}${idAttr}>${renderChildren(el, headingLevel, idToSection)}</${inline}>`;
      }
      // Unknown element renders transparently (its children only), so no FB2
      // content is lost even for tags this map does not name.
      return renderChildren(el, headingLevel, idToSection);
    }
  }
}

/**
 * Presentation attributes an FB2 table cell may carry. Only the ones the view's
 * allowlist keeps are emitted — anything else would be stripped on the way into
 * the frame, so writing it is noise.
 */
const TABLE_ATTRIBUTES: Record<string, readonly string[]> = {
  table: ['align'],
  tr: ['align', 'valign'],
  th: ['align', 'colspan', 'rowspan', 'valign'],
  td: ['align', 'colspan', 'rowspan', 'valign'],
};

function tableAttributes(el: XmlElement, tag: string): string {
  let out = '';
  for (const name of TABLE_ATTRIBUTES[tag] ?? []) {
    const value = attribute(el, name);
    if (value !== undefined) out += ` ${name}="${escapeXmlAttribute(value)}"`;
  }
  return out;
}

/** A title/verse block whose <p> lines join with <br/> rather than nesting <p>. */
function renderInlineLines(el: XmlElement, idToSection: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  for (const child of el.children) {
    if (child.localName === 'p') lines.push(renderChildren(child, 0, idToSection));
  }
  if (lines.length > 0) return lines.join('<br/>');
  return renderChildren(el, 0, idToSection);
}

/**
 * Rewrites an in-book `#id` link to `sectionId#id` so the reader follows it across
 * sections (a bare `#id` only seeks the current section). A link to an unknown id,
 * or an external/scheme href, is left as authored.
 */
function rewriteHref(href: string | undefined, idToSection: ReadonlyMap<string, string>): string | undefined {
  if (href === undefined) return undefined;
  if (!href.startsWith('#')) return href;
  const id = href.slice(1);
  const sectionId = idToSection.get(id);
  return sectionId === undefined ? href : `${sectionId}#${id}`;
}

