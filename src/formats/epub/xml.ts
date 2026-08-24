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
  return new TextDecoder().decode(bytes);
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

export function parseXml(input: string): XmlElement {
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
      if (pos >= input.length) fail(`unterminated <${element.name}> tag`);
      if (input[pos] === '>') {
        pos++;
        return false;
      }
      if (input[pos] === '/') {
        pos++;
        if (input[pos] !== '>') fail(`expected "/>" in <${element.name}>`);
        pos++;
        return true;
      }
      const name = readName();
      skipWhitespace();
      if (input[pos] !== '=') fail(`attribute ${name} has no value`);
      pos++;
      skipWhitespace();
      const quote = input[pos];
      if (quote !== '"' && quote !== "'") fail(`attribute ${name} value is not quoted`);
      pos++;
      const end = input.indexOf(quote, pos);
      if (end === -1) fail(`unterminated value for attribute ${name}`);
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
      if (input[pos] !== '>') fail(`unterminated </${name}>`);
      pos++;
      const open = stack.pop();
      if (open === undefined) fail(`</${name}> has no matching open tag`);
      else if (open.name !== name) fail(`</${name}> closes <${open.name}>`);
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
      else fail(`second root element <${name}>`);
      if (!selfClosing) stack.push(element);
    }
  }

  const open = stack[stack.length - 1];
  if (open !== undefined) fail(`unclosed element <${open.name}>`);
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
