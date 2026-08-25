import type { Book, BookFormat, BookMetadata, ByteSource, Section, TocItem } from '../../core/index.ts';
import { sectionLookup } from '../../core/lookup.ts';
import { collapseWhitespace, escapeXmlText } from '../../core/text.ts';

/**
 * Plain-text format. The seam probe (PLAN M4-1): TXT synthesizes everything the
 * `Book` model needs — id-addressed sections, a coarse TOC, minimal metadata —
 * from a byte stream that has no container, no manifest and no markup, proving the
 * decoder seam is not EPUB-shaped. Sections are emitted as XHTML (paragraphs and
 * chapter headings) so the existing view renders them untouched; the format holds
 * no `resolve` (plain text references nothing) and no resources.
 */
export const text: BookFormat = {
  name: 'text',
  async sniff(source) {
    // A conservative last-resort claim: reject anything that is plainly another
    // format (zip/EPUB, PDF, an XML/HTML document like FB2/XHTML) or binary
    // (an unmarked NUL byte), and otherwise accept. Registered after richer
    // formats, so this only sees bytes nothing else claimed.
    const head = await source.read(0, Math.min(source.size, 512));
    if (head.length === 0) return false;
    if (hasBom(head)) return true; // a Unicode BOM is a positive text signal
    // Zip (PK\x03\x04) and PDF (%PDF) are not text.
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return false;
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return false;
    // An XML/HTML document (FB2, XHTML) opens with '<' after optional whitespace.
    const firstGlyph = head.find((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0xef && b !== 0xbb && b !== 0xbf);
    if (firstGlyph === 0x3c) return false;
    // An unmarked NUL byte means binary (or UTF-16 without a BOM we do not guess).
    if (head.includes(0x00)) return false;
    return true;
  },
  async decode(source) {
    const bytes = await source.read(0, source.size);
    const raw = decodeText(bytes);
    const normalized = raw.replace(/\r\n?/g, '\n');
    const metadata = readGutenbergMetadata(normalized);
    const built = buildSections(normalized);
    const toc = buildToc(built);
    const sections = built.map((s) => s.section);
    return {
      metadata,
      toc,
      sections,
      section: sectionLookup(sections),
      resources: new Map(),
    } satisfies Book;
  },
};

// --- encoding ---------------------------------------------------------------

function hasBom(head: Uint8Array): boolean {
  return (
    (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) || // UTF-8
    (head[0] === 0xff && head[1] === 0xfe) || // UTF-16LE
    (head[0] === 0xfe && head[1] === 0xff) // UTF-16BE
  );
}

/**
 * Decodes text bytes: a BOM picks the encoding outright; otherwise UTF-8 is tried
 * strictly and windows-1252 is the legacy fallback (the codepage most non-UTF-8
 * English/Western TXT actually uses). The BOM bytes are stripped with the decoder's
 * default BOM handling for UTF-8/16.
 */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// --- structure --------------------------------------------------------------

interface BuiltSection {
  readonly section: Section;
  readonly heading?: string;
}

const HEADING_KEYWORD = /^(chapter|book|part|canto|letter|volume|section|prologue|epilogue|introduction|preface|foreword|afterword)\b/i;

/**
 * Coarse Gutenberg-style split: blocks are separated by blank lines; a short block
 * that reads as a chapter heading (a keyword line like "CHAPTER I", or a short
 * all-caps/titley line) starts a new section. When no heading is ever found the
 * whole text becomes one synthetic section, so a headingless file still reads.
 */
function buildSections(normalized: string): BuiltSection[] {
  const blocks = normalized
    .split(/\n[ \t]*\n+/)
    .map((b) => b.replace(/^\n+|\n+$/g, '').trim())
    .filter((b) => b.length > 0);

  const sections: BuiltSection[] = [];
  let heading: string | undefined;
  let paragraphs: string[] = [];
  let index = 0;

  const flush = (): void => {
    if (heading === undefined && paragraphs.length === 0) return;
    const id = `s${index}`;
    index += 1;
    const html = renderXhtml(heading, paragraphs);
    const captured = heading;
    sections.push({
      section: {
        id,
        mediaType: 'application/xhtml+xml',
        load: () => Promise.resolve(new TextEncoder().encode(html)),
      },
      ...(captured === undefined ? {} : { heading: captured }),
    });
    heading = undefined;
    paragraphs = [];
  };

  for (const block of blocks) {
    if (isHeading(block)) {
      flush();
      heading = collapseWhitespace(block);
    } else {
      paragraphs.push(block);
    }
  }
  flush();

  if (sections.length === 0) {
    // Empty or whitespace-only input still yields one (empty) readable section.
    sections.push({
      section: {
        id: 's0',
        mediaType: 'application/xhtml+xml',
        load: () => Promise.resolve(new TextEncoder().encode(renderXhtml(undefined, []))),
      },
    });
  }
  return sections;
}

function isHeading(block: string): boolean {
  if (block.includes('\n')) return false; // a heading is a single short line
  const line = block.trim();
  if (line.length === 0 || line.length > 60) return false;
  if (HEADING_KEYWORD.test(line)) return true;
  // A short line in all caps (letters present, no lowercase) reads as a heading.
  return /[A-Z]/.test(line) && !/[a-z]/.test(line) && line.length <= 48;
}

function buildToc(sections: BuiltSection[]): TocItem[] {
  const toc: TocItem[] = [];
  for (const s of sections) {
    if (s.heading === undefined) continue;
    toc.push({ label: s.heading, sectionId: s.section.id, children: [] });
  }
  return toc;
}

// --- metadata ---------------------------------------------------------------

/**
 * Best-effort metadata from Project Gutenberg's plain-text header conventions:
 * either the "Title: X / Author: Y" block or the "The Project Gutenberg eBook of
 * TITLE, by AUTHOR" line. Anything not found is omitted, never set to undefined.
 */
function readGutenbergMetadata(normalized: string): BookMetadata {
  const head = normalized.slice(0, 4000);
  let title: string | undefined;
  let author: string | undefined;

  const titleField = head.match(/^Title:\s*(.+)$/im);
  if (titleField?.[1] !== undefined) title = collapseWhitespace(titleField[1]);
  const authorField = head.match(/^Author:\s*(.+)$/im);
  if (authorField?.[1] !== undefined) author = collapseWhitespace(authorField[1]);

  if (title === undefined) {
    const banner = head.match(/Project Gutenberg eBook of\s+(.+?)(?:,\s*by\s+(.+?))?[\r\n]/i);
    if (banner?.[1] !== undefined) title = collapseWhitespace(banner[1]);
    if (author === undefined && banner?.[2] !== undefined) author = collapseWhitespace(banner[2]);
  }

  return {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
  };
}

// --- rendering --------------------------------------------------------------

function renderXhtml(heading: string | undefined, paragraphs: readonly string[]): string {
  const body: string[] = [];
  if (heading !== undefined) body.push(`<h2>${escapeXmlText(heading)}</h2>`);
  for (const p of paragraphs) {
    // A block's internal newlines are soft line breaks within one paragraph.
    body.push(`<p>${escapeXmlText(collapseParagraph(p))}</p>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"/></head><body>${body.join('')}</body></html>`;
}

function collapseParagraph(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();
}
