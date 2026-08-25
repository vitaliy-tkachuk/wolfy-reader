/**
 * Shared text helpers, internal to the library: nothing here is re-exported from
 * `src/core/index.ts` (same status as `graphemes.ts` and `reading-text.ts`), so
 * this is shared implementation, not public surface. It lives in core because its
 * consumers span domains that may not import each other — `src/formats` and
 * `src/layout` escape markup, `src/search` and `src/view` decode section bytes —
 * and everything may import core while core imports nothing back (the headless
 * boundary `npm run check:core` enforces).
 */

/** Decodes text bytes, honouring the byte order marks EPUB allows. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  return new TextDecoder().decode(bytes);
}

/** Collapses every whitespace run to one space and trims the ends. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Escapes the markup-significant characters (`& < >`) for text content. */
export function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes for a double-quoted attribute value: the text escape plus `"`. */
export function escapeXmlAttribute(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}
