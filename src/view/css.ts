export type CssReferenceKind = 'import' | 'url';

export interface CssReference {
  readonly kind: CssReferenceKind;
  /** The reference as written, with quotes and escapes removed. */
  readonly value: string;
  /** Index of the first character of the replaceable token. */
  readonly start: number;
  /** Index one past the last character of the replaceable token. */
  readonly end: number;
}

interface Token {
  readonly value: string;
  readonly end: number;
}

const IDENT_CHAR = /[A-Za-z0-9_\-\\\u0080-\uFFFF]/;

function isIdentChar(character: string): boolean {
  return character !== '' && IDENT_CHAR.test(character);
}

function matchesAt(css: string, index: number, literal: string): boolean {
  return css.slice(index, index + literal.length).toLowerCase() === literal;
}

function skipComment(css: string, index: number): number {
  const close = css.indexOf('*/', index + 2);
  return close === -1 ? css.length : close + 2;
}

function skipSpace(css: string, index: number): number {
  let i = index;
  while (i < css.length) {
    const character = css.charAt(i);
    if (character === '/' && css.charAt(i + 1) === '*') {
      i = skipComment(css, i);
      continue;
    }
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f') {
      i += 1;
      continue;
    }
    return i;
  }
  return i;
}

function readString(css: string, index: number): Token | null {
  const quote = css.charAt(index);
  let i = index + 1;
  let value = '';
  while (i < css.length) {
    const character = css.charAt(i);
    if (character === '\\') {
      if (css.charAt(i + 1) !== '\n') value += css.charAt(i + 1);
      i += 2;
      continue;
    }
    if (character === quote) return { value, end: i + 1 };
    if (character === '\n') return null;
    value += character;
    i += 1;
  }
  return null;
}

function readUrl(css: string, index: number): Token | null {
  let i = skipSpace(css, index + 4);
  let value: string;
  const quote = css.charAt(i);
  if (quote === '"' || quote === "'") {
    const string = readString(css, i);
    if (string === null) return null;
    value = string.value;
    i = skipSpace(css, string.end);
  } else {
    let raw = '';
    while (i < css.length && css.charAt(i) !== ')') {
      if (css.charAt(i) === '\\') {
        raw += css.charAt(i + 1);
        i += 2;
        continue;
      }
      raw += css.charAt(i);
      i += 1;
    }
    value = raw.trim();
  }
  if (css.charAt(i) !== ')') return null;
  return { value, end: i + 1 };
}

function readReference(css: string, index: number): Token | null {
  const character = css.charAt(index);
  if (character === '"' || character === "'") return readString(css, index);
  if (matchesAt(css, index, 'url(')) return readUrl(css, index);
  return null;
}

/**
 * Finds every `url(...)` and `@import` target in a stylesheet.
 *
 * This is a token-level scan that understands strings and comments, not a CSS
 * parser: those two constructs are the only ones a renderer has to rewrite, and
 * a conforming parser is orders of magnitude more code for no extra coverage.
 */
export function findCssReferences(css: string): CssReference[] {
  const references: CssReference[] = [];
  let i = 0;
  while (i < css.length) {
    const character = css.charAt(i);
    if (character === '/' && css.charAt(i + 1) === '*') {
      i = skipComment(css, i);
      continue;
    }
    if (character === '"' || character === "'") {
      const string = readString(css, i);
      i = string === null ? i + 1 : string.end;
      continue;
    }
    if (character === '@' && matchesAt(css, i, '@import') && !isIdentChar(css.charAt(i + 7))) {
      const start = skipSpace(css, i + 7);
      const token = readReference(css, start);
      if (token === null) {
        i += 7;
        continue;
      }
      references.push({ kind: 'import', value: token.value, start, end: token.end });
      i = token.end;
      continue;
    }
    if (matchesAt(css, i, 'url(') && !isIdentChar(css.charAt(i - 1))) {
      const token = readUrl(css, i);
      if (token === null) {
        i += 1;
        continue;
      }
      references.push({ kind: 'url', value: token.value, start: i, end: token.end });
      i = token.end;
      continue;
    }
    i += 1;
  }
  return references;
}

function escapeCssUrl(url: string): string {
  return url.replace(/[\\"]/g, '\\$&').replace(/[\n\r]/g, '');
}

/**
 * Rewrites every reference the scan finds. A replacer returning undefined
 * leaves the reference exactly as written.
 */
export async function rewriteCssReferences(
  css: string,
  replace: (reference: CssReference) => Promise<string | undefined>,
): Promise<string> {
  const references = findCssReferences(css);
  if (references.length === 0) return css;
  let out = '';
  let cursor = 0;
  for (const reference of references) {
    const replacement = await replace(reference);
    if (replacement === undefined) continue;
    out += `${css.slice(cursor, reference.start)}url("${escapeCssUrl(replacement)}")`;
    cursor = reference.end;
  }
  return out + css.slice(cursor);
}
