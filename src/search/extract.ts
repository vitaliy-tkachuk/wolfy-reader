/**
 * Per-section text extraction for search. Decodes a section's bytes and strips its
 * markup to a single plain string — the **canonical reading text**, the same text
 * the frame ultimately shows and measures, so a match's captured anchor (quote +
 * context) exists verbatim in the text `goTo` resolves against.
 *
 * Headless by rule: this imports only `src/core` (the shared reading-text policy)
 * and platform primitives (`TextDecoder`) and never touches `document`/`window`, so
 * the whole search stack runs under `node:test`. It deliberately does **not** route
 * through the frame's `Paginator.sectionText()` — that returns only the
 * currently-paginated section and needs a browser. Search scans every section
 * without painting it.
 *
 * Extraction is a small tag-stripping tokenizer rather than `DOMParser`: `DOMParser`
 * is a browser primitive with no headless Node global, and search only needs text
 * content. To line up with the frame it mirrors what the sanitize + resource
 * pipeline does to a section's text, via the one shared policy in
 * `src/core/reading-text.ts`:
 *
 * - Inline markup contributes no characters (`wo<em>rd</em>` is found as `word`) —
 *   `textContent` semantics, and unwrapped elements keep their text.
 * - Elements the sanitizer **discards whole** (form controls, `template`, raw-text
 *   containers — `DISCARDED_HTML_ELEMENTS` / `DISCARDED_SVG_ELEMENTS`) contribute
 *   nothing, exactly as their text never reaches the frame.
 * - An `<img>` contributes what the resource layer will show: nothing when it can
 *   be served (or is left for the CSP), its `alt` when the frame substitutes alt
 *   text (`imageReadingText`) — which is why extraction takes the section's
 *   `resolve` seam.
 * - Whitespace-only text runs at the top level of the body are dropped, because
 *   the chunker drops those text nodes before the frame tiles the section text
 *   (`chunkElement` in `src/layout/chunk.ts`).
 * - `head`, `script` and `style` content is never reading text (`<style>` survives
 *   sanitization, but its CSS is source, not prose — searching it would be noise;
 *   see the known-edges note in docs/domains/search.md).
 */
import {
  DISCARDED_HTML_ELEMENTS,
  DISCARDED_SVG_ELEMENTS_LOWER,
  imageReadingText,
  type ReadingResolver,
} from '../core/reading-text.ts';
import { decodeText } from '../core/text.ts';
import { decodeEntities } from './entities.ts';

export type { ReadingResolver } from '../core/reading-text.ts';

/** Decodes section bytes honouring the byte-order marks EPUB allows. */
export { decodeText as decodeSectionBytes } from '../core/text.ts';

/**
 * Elements whose content the HTML parser reads as raw text (a `<` in `1<2` inside
 * `<script>` is not a tag): skipping jumps to the first matching end tag rather
 * than tracking nesting. All but `style` are also discarded by the sanitizer;
 * `style` survives into the frame but its text is source, not prose.
 */
const RAW_TEXT = new Set([
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
]);

/** HTML void elements: no content, no end tag, never on the open-element stack. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Block-level tags whose start tag implies `</p>` in HTML parsing. Without this,
 * the unclosed `<p>` real books ship would keep the stack forever nested and the
 * top-level whitespace rule would never apply again.
 */
const P_CLOSERS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

/**
 * Extracts a section's reading text from its decoded markup — the headless mirror
 * of what the sanitize + resource pipeline leaves for the frame to show (see the
 * module comment for the exact rules). `resolve` is the section's own resolver
 * seam (`Section.resolve`), consulted only to decide whether an `<img>` renders
 * or falls back to its alt text; omit it and every in-book image degrades to alt,
 * matching a section that carries no resolver.
 */
export function extractText(markup: string, resolve?: ReadingResolver): string {
  let out = '';
  let index = 0;
  /** Open non-void elements. `head` and skipped containers never land here. */
  const stack: string[] = [];
  let svgDepth = 0;

  // The chunker drops whitespace-only text nodes at the top level of the body
  // (they carry no block box), so the frame's tiled text has no inter-paragraph
  // source whitespace. Mirror it: a whitespace-only run emitted while no element
  // (or only html/body) is open contributes nothing.
  const atTopLevel = (): boolean => {
    const top = stack[stack.length - 1];
    return top === undefined || top === 'html' || top === 'body';
  };
  const emit = (text: string): void => {
    if (text === '') return;
    if (atTopLevel() && text.trim().length === 0) return;
    out += text;
  };
  const popTo = (name: string): void => {
    const at = stack.lastIndexOf(name);
    if (at === -1) return;
    for (let i = stack.length - 1; i >= at; i -= 1) {
      if (stack[i] === 'svg') svgDepth -= 1;
    }
    stack.length = at;
  };

  const length = markup.length;
  while (index < length) {
    const lt = markup.indexOf('<', index);
    if (lt === -1) {
      emit(decodeEntities(markup.slice(index)));
      break;
    }
    if (lt > index) emit(decodeEntities(markup.slice(index, lt)));

    // Comment / CDATA / processing instruction / doctype: skip to its close.
    if (markup.startsWith('<!--', lt)) {
      const close = markup.indexOf('-->', lt + 4);
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (markup.startsWith('<![CDATA[', lt)) {
      const close = markup.indexOf(']]>', lt + 9);
      emit(markup.slice(lt + 9, close === -1 ? length : close)); // literal text, no entities
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
      emit(decodeEntities(markup.slice(lt)));
      break;
    }

    const rawTag = markup.slice(lt + 1, gt);
    index = gt + 1;
    const isClose = rawTag[0] === '/';
    const name = tagName(isClose ? rawTag.slice(1) : rawTag);
    if (name === '') continue;

    if (isClose) {
      popTo(name);
      continue;
    }

    const selfClosing = rawTag.endsWith('/');
    const inSvg = svgDepth > 0;

    if (!inSvg) {
      // HTML implied end tags, minimally: a block start tag closes an open <p>,
      // and a list/definition item closes its open sibling. Real books rely on
      // both, and the frame's HTML parse applies them before chunking.
      const top = stack[stack.length - 1];
      if (top === 'p' && P_CLOSERS.has(name)) stack.pop();
      else if (name === 'li' && top === 'li') stack.pop();
      else if ((name === 'dd' || name === 'dt') && (top === 'dd' || top === 'dt')) stack.pop();
    }

    // The head never reaches the frame body (only its <link>/<style> move, and
    // those carry no reading text), so its whole subtree is skipped.
    if (!inSvg && name === 'head' && !selfClosing) {
      index = skipBalanced(markup, name, index);
      continue;
    }

    // An <img> renders as an image (zero characters) or becomes its alt text —
    // the one place extraction *adds* text, mirroring the resource layer.
    if (!inSvg && name === 'img') {
      emit(imageReadingText(attributeOf(rawTag, 'src'), attributeOf(rawTag, 'alt'), resolve));
      continue;
    }

    // Discarded-whole elements contribute nothing, exactly like the sanitizer;
    // raw-text containers jump to their first matching end tag, everything else
    // to the end tag balancing same-name nesting.
    const discarded = inSvg ? DISCARDED_SVG_ELEMENTS_LOWER : DISCARDED_HTML_ELEMENTS;
    if (discarded.has(name) || name === 'style') {
      if (selfClosing || (!inSvg && VOID.has(name))) continue;
      index = RAW_TEXT.has(name) ? findEndTag(markup, name, index) : skipBalanced(markup, name, index);
      continue;
    }

    if (selfClosing || (!inSvg && VOID.has(name))) continue;
    if (name === 'svg') svgDepth += 1;
    stack.push(name);
  }

  return out;
}

/** Decode + extract a section from its raw bytes. */
export function extractSectionText(bytes: Uint8Array, resolve?: ReadingResolver): string {
  return extractText(decodeText(bytes), resolve);
}

/**
 * Index just past the matching `</name>` end tag at or after `from` (raw-text
 * containers: the first close wins, nothing inside is a tag), or the markup
 * length when the container is never closed. Case-insensitive on the tag name.
 */
function findEndTag(markup: string, name: string, from: number): number {
  const lower = markup.toLowerCase();
  const needle = `</${name}`;
  let at = from;
  for (;;) {
    const found = lower.indexOf(needle, at);
    if (found === -1) return markup.length;
    const after = markup[found + needle.length];
    // The next char must end the tag name (whitespace or '>'), so </scripting>
    // does not close <script>.
    if (after === undefined || after === '>' || /\s/.test(after)) {
      const gt = markup.indexOf('>', found);
      return gt === -1 ? markup.length : gt + 1;
    }
    at = found + needle.length;
  }
}

/**
 * Index just past the end tag that balances an already-open `name` element,
 * counting same-name nesting (a discarded `<select>` may hold another), or the
 * markup length when it never closes.
 */
function skipBalanced(markup: string, name: string, from: number): number {
  const lower = markup.toLowerCase();
  const open = `<${name}`;
  const close = `</${name}`;
  let depth = 1;
  let at = from;
  while (depth > 0) {
    const lt = lower.indexOf('<', at);
    if (lt === -1) return markup.length;
    const gt = markup.indexOf('>', lt);
    if (gt === -1) return markup.length;
    if (lower.startsWith(close, lt) && endsTagName(markup, lt + close.length)) {
      depth -= 1;
    } else if (lower.startsWith(open, lt) && endsTagName(markup, lt + open.length)) {
      if (markup[gt - 1] !== '/') depth += 1; // a self-closing one opens nothing
    }
    at = gt + 1;
  }
  return at;
}

/** True when the character at `i` terminates a tag name (`>`, `/`, whitespace, EOF). */
function endsTagName(markup: string, i: number): boolean {
  const char = markup[i];
  return char === undefined || char === '>' || char === '/' || /\s/.test(char);
}

/** The lowercased element name from a raw tag body ('em class="x"' → 'em'). */
function tagName(body: string): string {
  let end = 0;
  while (end < body.length && !/[\s/>]/.test(body[end]!)) end += 1;
  return body.slice(0, end).toLowerCase();
}

/**
 * The decoded value of `wanted` in a raw tag body, or `null` when absent.
 * Handles single/double-quoted and unquoted values and a bare attribute name
 * (which the DOM reads as the empty string). Entities in the value are decoded,
 * as an attribute parse would.
 */
function attributeOf(rawTag: string, wanted: string): string | null {
  let i = 0;
  while (i < rawTag.length && !/[\s/]/.test(rawTag[i]!)) i += 1; // skip the tag name
  while (i < rawTag.length) {
    while (i < rawTag.length && /[\s/]/.test(rawTag[i]!)) i += 1;
    if (i >= rawTag.length) break;
    let start = i;
    while (i < rawTag.length && !/[\s=/]/.test(rawTag[i]!)) i += 1;
    const attribute = rawTag.slice(start, i).toLowerCase();
    while (i < rawTag.length && /\s/.test(rawTag[i]!)) i += 1;
    let value = '';
    if (rawTag[i] === '=') {
      i += 1;
      while (i < rawTag.length && /\s/.test(rawTag[i]!)) i += 1;
      const quote = rawTag[i];
      if (quote === '"' || quote === "'") {
        i += 1;
        start = i;
        while (i < rawTag.length && rawTag[i] !== quote) i += 1;
        value = rawTag.slice(start, i);
        i += 1;
      } else {
        start = i;
        while (i < rawTag.length && !/\s/.test(rawTag[i]!)) i += 1;
        value = rawTag.slice(start, i);
      }
    }
    if (attribute === wanted) return decodeEntities(value);
  }
  return null;
}
