/**
 * Per-section text extraction for search. Decodes a section's bytes and strips its
 * markup to a single plain string — the same text space the paginator and
 * `capturePosition` speak, so a match's offset anchors cleanly.
 *
 * Headless by rule: this imports only platform primitives (`TextDecoder`) and never
 * touches `document`/`window`, so the whole search stack runs under `node:test`. It
 * deliberately does **not** route through the frame's `Paginator.sectionText()` —
 * that returns only the currently-paginated section and needs a browser. Search
 * scans every section without painting it.
 *
 * Extraction is a small tag-stripping tokenizer rather than `DOMParser`: `DOMParser`
 * is a browser primitive with no headless Node global, and search only needs text
 * content (concatenate text nodes, drop non-prose containers, decode entities). A
 * focused tokenizer keeps the module zero-dependency and testable without a browser.
 * The output mirrors `textContent`: every tag contributes no characters, so a match
 * split across inline markup (`wo<em>rd</em>`) is found as `word`, and the offsets
 * line up with the frame-measured text a `Position` resolves against (both are the
 * `textContent` of the same tree).
 */

/** Decodes section bytes honouring the byte-order marks EPUB allows. */
export function decodeSectionBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  return new TextDecoder().decode(bytes);
}

/** Elements whose text is source, not reading content — their content is skipped. */
const SKIP = new Set(['script', 'style', 'head', 'title', 'template']);

/**
 * Extracts a section's readable text from its decoded markup by stripping tags and
 * decoding entities, skipping the content of non-prose containers. Block boundaries
 * carry whatever source whitespace (newlines, indentation) sits between the tags —
 * real books have it — which search normalization collapses to a single space, so
 * words do not run together across paragraphs.
 */
export function extractText(markup: string): string {
  let out = '';
  let index = 0;

  const length = markup.length;
  while (index < length) {
    const lt = markup.indexOf('<', index);
    if (lt === -1) {
      out += decodeEntities(markup.slice(index));
      break;
    }
    if (lt > index) out += decodeEntities(markup.slice(index, lt));

    // Comment / CDATA / processing instruction / doctype: skip to its close.
    if (markup.startsWith('<!--', lt)) {
      const close = markup.indexOf('-->', lt + 4);
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (markup.startsWith('<![CDATA[', lt)) {
      const close = markup.indexOf(']]>', lt + 9);
      const inner = markup.slice(lt + 9, close === -1 ? length : close);
      out += inner; // CDATA content is literal text, no entities
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (markup[lt + 1] === '!' || markup[lt + 1] === '?') {
      const close = markup.indexOf('>', lt + 1);
      index = close === -1 ? length : close + 1;
      continue;
    }

    const gt = markup.indexOf('>', lt);
    if (gt === -1) {
      // A stray '<' with no closing '>': treat the rest as text.
      out += decodeEntities(markup.slice(lt));
      break;
    }

    const rawTag = markup.slice(lt + 1, gt);
    index = gt + 1;
    const isClose = rawTag[0] === '/';
    const name = tagName(isClose ? rawTag.slice(1) : rawTag);

    // A skipped container holds raw text (a '<' in `1<2` inside <script> is not a
    // tag). Jump straight to its matching end tag, treating everything between as
    // dropped source — the same as an HTML parser's raw-text handling.
    if (!isClose && SKIP.has(name) && !rawTag.endsWith('/')) {
      const closeAt = findEndTag(markup, name, index);
      index = closeAt === -1 ? length : closeAt;
    }
  }

  return out;
}

/** Decode + extract a section from its raw bytes. */
export function extractSectionText(bytes: Uint8Array): string {
  return extractText(decodeSectionBytes(bytes));
}

/**
 * Index just past the matching `</name>` end tag at or after `from`, or -1 when the
 * container is never closed. Case-insensitive on the tag name.
 */
function findEndTag(markup: string, name: string, from: number): number {
  const lower = markup.toLowerCase();
  const needle = `</${name}`;
  let at = from;
  for (;;) {
    const found = lower.indexOf(needle, at);
    if (found === -1) return -1;
    const after = markup[found + needle.length];
    // The next char must end the tag name (whitespace or '>'), so </scripting> does
    // not close <script>.
    if (after === undefined || after === '>' || /\s/.test(after)) {
      const gt = markup.indexOf('>', found);
      return gt === -1 ? -1 : gt + 1;
    }
    at = found + needle.length;
  }
}

/** The lowercased element name from a raw tag body ('em class="x"' → 'em'). */
function tagName(body: string): string {
  let end = 0;
  while (end < body.length && !/[\s/>]/.test(body[end]!)) end += 1;
  return body.slice(0, end).toLowerCase();
}

const NAMED: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['mdash', '—'],
  ['ndash', '–'],
  ['hellip', '…'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['copy', '©'],
  ['reg', '®'],
  ['trade', '™'],
  ['deg', '°'],
  ['times', '×'],
  ['eacute', 'é'],
  ['egrave', 'è'],
  ['agrave', 'à'],
  ['ccedil', 'ç'],
  ['uuml', 'ü'],
  [' ', ' '],
]);

/**
 * Decodes numeric (`&#233;`, `&#xe9;`) and the common named HTML entities. An
 * unknown entity is left verbatim — a book's literal `&` in prose stays `&`.
 */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED.get(body.toLowerCase()) ?? whole;
  });
}
