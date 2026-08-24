export type ReferenceKind = 'empty' | 'fragment' | 'relative' | 'scheme';

export interface ClassifiedReference {
  readonly kind: ReferenceKind;
  /** The reference with URL-insignificant whitespace removed. */
  readonly value: string;
  /** Lowercased scheme name, present only when kind is 'scheme'. */
  readonly scheme?: string;
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const SPACE = 0x20;
const TAB = 0x09;
const NEWLINE = 0x0a;
const RETURN = 0x0d;

// The URL parser trims leading and trailing C0 controls and spaces, then drops
// tab, LF and CR from anywhere in the string. Doing the same here is what makes
// a reference written as `java&#10;script:alert(1)` classify as a scheme.
function stripUrlWhitespace(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && raw.charCodeAt(start) <= SPACE) start += 1;
  while (end > start && raw.charCodeAt(end - 1) <= SPACE) end -= 1;
  let value = '';
  for (let i = start; i < end; i += 1) {
    const code = raw.charCodeAt(i);
    if (code === TAB || code === NEWLINE || code === RETURN) continue;
    value += raw.charAt(i);
  }
  return value;
}

export function classifyReference(raw: string): ClassifiedReference {
  const value = stripUrlWhitespace(raw);
  if (value === '') return { kind: 'empty', value };
  if (value.startsWith('#')) return { kind: 'fragment', value };
  const match = SCHEME.exec(value);
  if (match !== null) return { kind: 'scheme', value, scheme: (match[1] ?? '').toLowerCase() };
  return { kind: 'relative', value };
}

/** Collapses `.` and `..` segments, keeping leading `..` that cannot be resolved. */
export function normalizeReference(reference: string): string {
  const out: string[] = [];
  for (const segment of reference.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      out.push(segment);
      continue;
    }
    const last = out[out.length - 1];
    if (last === undefined || last === '..') out.push('..');
    else out.pop();
  }
  return (reference.startsWith('/') ? '/' : '') + out.join('/');
}

/**
 * Joins a reference found inside a document that was itself reached by `base`.
 * Both are expressed in the section's reference space: `Section.resolve()`
 * resolves only relative to the section, so a stylesheet's own imports have to
 * be re-expressed relative to the section before they can be resolved at all.
 */
export function joinReference(base: string, reference: string): string {
  if (reference.startsWith('/')) return reference;
  const slash = base.lastIndexOf('/');
  const directory = slash === -1 ? '' : base.slice(0, slash + 1);
  return normalizeReference(directory + reference);
}
