export interface XmlElement {
  readonly name: string;
  readonly localName: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly XmlElement[];
  /** Child elements and text chunks in document order. */
  readonly content: readonly (XmlElement | string)[];
  /** Concatenated direct text content, entity-decoded, CDATA included. */
  readonly text: string;
}

interface MutableElement {
  name: string;
  localName: string;
  attributes: Map<string, string>;
  children: MutableElement[];
  content: (MutableElement | string)[];
  text: string;
}

export function decodeXml(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  }
  // A BOM decides outright; otherwise honor the XML declaration's encoding label
  // for non-Unicode codepages — real FB2 is frequently windows-1251, and assuming
  // UTF-8 would mojibake every Cyrillic character. The label is read from the
  // prolog as Latin-1 (one byte → one char) so it is legible before the true
  // encoding is known. An unknown label falls back to UTF-8.
  const label = encodingFromProlog(bytes);
  if (label !== undefined && !/^utf-?8$/i.test(label) && !/^utf-?16/i.test(label)) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unsupported label — fall through to UTF-8.
    }
  }
  return new TextDecoder().decode(bytes);
}

function encodingFromProlog(bytes: Uint8Array): string | undefined {
  const head = bytes.subarray(0, Math.min(bytes.length, 200));
  let prolog = '';
  for (let i = 0; i < head.length; i += 1) prolog += String.fromCharCode(head[i]!);
  if (!prolog.startsWith('<?xml')) return undefined;
  const end = prolog.indexOf('?>');
  if (end === -1) return undefined;
  const match = prolog.slice(0, end).match(/encoding\s*=\s*["']([^"']+)["']/i);
  return match?.[1];
}

export function localNameOf(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Attribute by exact name first, then by local name ignoring any prefix. */
export function attribute(element: XmlElement, name: string): string | undefined {
  const exact = element.attributes.get(name);
  if (exact !== undefined) return exact;
  for (const [key, value] of element.attributes) {
    if (localNameOf(key) === name) return value;
  }
  return undefined;
}

export function childrenNamed(element: XmlElement, localName: string): readonly XmlElement[] {
  return element.children.filter((child) => child.localName === localName);
}

export function firstChildNamed(element: XmlElement, localName: string): XmlElement | undefined {
  return element.children.find((child) => child.localName === localName);
}

/** All text within the element in document order, entity-decoded. */
export function deepText(element: XmlElement): string {
  let out = '';
  for (const node of element.content) {
    out += typeof node === 'string' ? node : deepText(node);
  }
  return out;
}

export function descendantsNamed(element: XmlElement, localName: string): readonly XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (parent: XmlElement): void => {
    for (const child of parent.children) {
      if (child.localName === localName) found.push(child);
      walk(child);
    }
  };
  walk(element);
  return found;
}

const NAME_END = new Set([' ', '\t', '\n', '\r', '>', '/', '=']);

export interface ParseXmlOptions {
  /**
   * Recover from light well-formedness slips instead of throwing: a valueless
   * (HTML-boolean-style) attribute becomes an empty-string attribute, an unquoted
   * attribute value reads to the next whitespace or tag end, a close tag that
   * mismatches the open stack closes the nearest matching ancestor (or is ignored
   * when nothing matches), and elements left open at end of input are auto-closed.
   * Strict is the default; tolerance is opt-in per caller so strict guarantees
   * (EPUB's container/OPF/nav parsing) are unchanged.
   */
  readonly tolerant?: boolean;
}

export function parseXml(input: string, options?: ParseXmlOptions): XmlElement {
  const tolerant = options?.tolerant === true;
  let pos = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  let root: MutableElement | undefined;
  const stack: MutableElement[] = [];

  const fail: (message: string) => never = (message) => {
    throw new Error(`malformed XML at offset ${pos}: ${message}`);
  };

  const skipWhitespace = (): void => {
    while (pos < input.length && isWhitespace(input[pos])) pos++;
  };

  const readName = (): string => {
    const start = pos;
    while (pos < input.length && !NAME_END.has(input[pos] as string)) pos++;
    if (pos === start) fail('expected a name');
    return input.slice(start, pos);
  };

  const skipPast = (terminator: string, what: string): void => {
    const end = input.indexOf(terminator, pos);
    if (end === -1) fail(`unterminated ${what}`);
    pos = end + terminator.length;
  };

  const skipMarkupDeclaration = (): void => {
    let depth = 0;
    for (; pos < input.length; pos++) {
      const ch = input[pos];
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
      else if (ch === '>' && depth <= 0) {
        pos++;
        return;
      }
    }
    fail('unterminated markup declaration');
  };

  const readAttributes = (element: MutableElement): boolean => {
    for (;;) {
      skipWhitespace();
      if (pos >= input.length) {
        if (!tolerant) fail(`unterminated <${element.name}> tag`);
        return false;
      }
      if (input[pos] === '>') {
        pos++;
        return false;
      }
      if (input[pos] === '/') {
        pos++;
        if (input[pos] !== '>') {
          if (!tolerant) fail(`expected "/>" in <${element.name}>`);
          continue; // stray slash inside the tag — drop it
        }
        pos++;
        return true;
      }
      const name = readName();
      skipWhitespace();
      if (input[pos] !== '=') {
        if (!tolerant) fail(`attribute ${name} has no value`);
        // Valueless (HTML-boolean-style) attribute — keep it as an empty string.
        element.attributes.set(name, '');
        continue;
      }
      pos++;
      skipWhitespace();
      const quote = input[pos];
      if (quote !== '"' && quote !== "'") {
        if (!tolerant) fail(`attribute ${name} value is not quoted`);
        // Unquoted value — read to the next whitespace or tag end.
        const start = pos;
        while (pos < input.length && !isWhitespace(input[pos]) && input[pos] !== '>') pos++;
        let raw = input.slice(start, pos);
        if (raw.endsWith('/') && input[pos] === '>') {
          raw = raw.slice(0, -1);
          pos -= 1; // leave "/>" for the self-closing check
        }
        element.attributes.set(name, decodeEntities(raw));
        continue;
      }
      pos++;
      const end = input.indexOf(quote, pos);
      if (end === -1) {
        if (!tolerant) fail(`unterminated value for attribute ${name}`);
        // Unterminated quote — take what is there up to the tag end.
        const gt = input.indexOf('>', pos);
        const stop = gt === -1 ? input.length : gt;
        element.attributes.set(name, decodeEntities(input.slice(pos, stop)));
        pos = stop;
        continue;
      }
      element.attributes.set(name, decodeEntities(input.slice(pos, end)));
      pos = end + 1;
    }
  };

  while (pos < input.length) {
    const lt = input.indexOf('<', pos);
    if (lt === -1) break;
    if (lt > pos) {
      const parent = stack[stack.length - 1];
      if (parent !== undefined) appendText(parent, decodeEntities(input.slice(pos, lt)));
    }
    pos = lt;
    if (input.startsWith('<?', pos)) {
      pos += 2;
      skipPast('?>', 'processing instruction');
    } else if (input.startsWith('<!--', pos)) {
      pos += 4;
      skipPast('-->', 'comment');
    } else if (input.startsWith('<![CDATA[', pos)) {
      pos += 9;
      const end = input.indexOf(']]>', pos);
      if (end === -1) fail('unterminated CDATA section');
      const parent = stack[stack.length - 1];
      if (parent !== undefined) appendText(parent, input.slice(pos, end));
      pos = end + 3;
    } else if (input.startsWith('<!', pos)) {
      pos += 2;
      skipMarkupDeclaration();
    } else if (input.startsWith('</', pos)) {
      pos += 2;
      const name = readName();
      skipWhitespace();
      if (input[pos] !== '>') {
        if (!tolerant) fail(`unterminated </${name}>`);
        const gt = input.indexOf('>', pos);
        pos = gt === -1 ? input.length : gt + 1;
      } else pos++;
      const open = stack.pop();
      if (open === undefined) {
        // Tolerant: a stray close with nothing open is ignored.
        if (!tolerant) fail(`</${name}> has no matching open tag`);
      } else if (open.name !== name) {
        if (!tolerant) fail(`</${name}> closes <${open.name}>`);
        if (stack.some((el) => el.name === name)) {
          // Close the nearest matching ancestor, auto-closing what it skipped
          // (children were attached at open time, so popping loses nothing).
          while (stack.length > 0 && stack[stack.length - 1]!.name !== name) stack.pop();
          stack.pop();
        } else {
          // No matching open tag anywhere above — ignore the stray close.
          stack.push(open);
        }
      }
    } else {
      pos++;
      const name = readName();
      const element: MutableElement = {
        name,
        localName: localNameOf(name),
        attributes: new Map(),
        children: [],
        content: [],
        text: '',
      };
      const selfClosing = readAttributes(element);
      const parent = stack[stack.length - 1];
      if (parent !== undefined) {
        parent.children.push(element);
        parent.content.push(element);
      } else if (root === undefined) root = element;
      else if (!tolerant) fail(`second root element <${name}>`);
      // Tolerant: trailing junk after the root parses but is discarded.
      if (!selfClosing) stack.push(element);
    }
  }

  const open = stack[stack.length - 1];
  // Tolerant: elements left open at end of input are auto-closed.
  if (open !== undefined && !tolerant) fail(`unclosed element <${open.name}>`);
  if (root === undefined) fail('no root element');
  return root;
}

function appendText(parent: MutableElement, text: string): void {
  parent.text += text;
  const last = parent.content[parent.content.length - 1];
  if (typeof last === 'string') parent.content[parent.content.length - 1] = last + text;
  else parent.content.push(text);
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

// nbsp is the one HTML entity that shows up in real nav-document labels.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}
