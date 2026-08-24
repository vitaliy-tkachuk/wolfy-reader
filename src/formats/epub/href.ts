export interface HrefTarget {
  /** Normalized zip entry name. */
  readonly path: string;
  readonly fragment?: string;
}

/** Directory of a zip entry name: 'OEBPS/content.opf' → 'OEBPS/', 'content.opf' → ''. */
export function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash + 1);
}

/**
 * Resolves a package-document href against a base directory into a zip entry
 * name plus optional fragment. Returns undefined for non-relative references
 * (absolute URLs, scheme-carrying links) that cannot name a zip entry.
 */
export function resolveHref(baseDir: string, href: string): HrefTarget | undefined {
  const hash = href.indexOf('#');
  const fragment = hash === -1 ? undefined : decodeSegment(href.slice(hash + 1));
  let reference = hash === -1 ? href : href.slice(0, hash);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference)) return undefined;
  if (reference === '') {
    // A pure fragment link targets the referencing document; the caller
    // supplies that context, so there is no path to resolve here.
    return undefined;
  }
  if (reference.startsWith('/')) {
    baseDir = '';
    reference = reference.slice(1);
  }
  const segments: string[] = [];
  for (const raw of (baseDir + reference).split('/')) {
    const segment = decodeSegment(raw);
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) return undefined;
  const path = segments.join('/');
  return { path, ...(fragment === undefined ? {} : { fragment }) };
}

function decodeSegment(segment: string): string {
  if (!segment.includes('%')) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
