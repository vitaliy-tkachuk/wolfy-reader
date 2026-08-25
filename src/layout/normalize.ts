/**
 * Pure string transforms the paginator applies to a section's markup before it
 * is chunked. They are deliberately headless — no DOM — so the boundary rules
 * they feed can be unit-tested under `node:test` without a browser.
 *
 * Both defend the same invariant: the DOM the chunker splits must be the DOM the
 * author wrote. When the host renders through `ContentHost`, its sanitizer
 * already re-imports XHTML into an HTML document (retiring self-closing tags) and
 * already substitutes drop-cap `alt` text; these run when the paginator is handed
 * raw markup instead — the demo's synthetic path, and the headless fixtures.
 */

const VOID_ELEMENTS = new Set([
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

const SELF_CLOSING = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g;

/**
 * Rewrites XHTML self-closing *non-void* tags (`<a id="x"/>`) to an explicit
 * open+close pair (`<a id="x"></a>`). An HTML parser ignores the trailing slash,
 * so `<a id="x"/>` left as-is swallows the entire rest of the section into the
 * anchor. Void elements (`<br/>`, `<img .../>`) are left untouched — they have no
 * end tag and closing them would be wrong.
 */
export function normalizeSelfClosing(markup: string): string {
  return markup.replace(SELF_CLOSING, (whole, name: string, attributes: string) => {
    if (VOID_ELEMENTS.has(name.toLowerCase())) return whole;
    return `<${name}${attributes}></${name}>`;
  });
}

const DROP_CAP_IMG = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/gi;
const ALT_ATTRIBUTE = /\balt\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Replaces an `<img>` that carries non-empty `alt` text with that text as a
 * literal text node. Gutenberg's ebookmaker sets each chapter's drop cap as
 * `<img alt="T">`; stripping the image without keeping its `alt` silently deletes
 * the first letter of every chapter. An empty or absent `alt` means decorative,
 * and the element is dropped entirely. This mirrors the host resource layer's
 * policy for the raw-markup path that never reaches it.
 */
export function substituteDropCapAlt(markup: string): string {
  return markup.replace(DROP_CAP_IMG, (_whole, attributes: string) => {
    const match = ALT_ATTRIBUTE.exec(attributes);
    if (match === null) return '';
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const decoded = value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return decoded.length === 0 ? '' : escapeText(decoded);
  });
}

/** Both transforms, in the order the paginator applies them. */
export function normalizeSectionMarkup(markup: string): string {
  return substituteDropCapAlt(normalizeSelfClosing(markup));
}
