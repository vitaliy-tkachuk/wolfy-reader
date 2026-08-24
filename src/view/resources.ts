import type { Resource } from '../core/index.ts';
import { XLINK_NAMESPACE } from './allowlist.ts';
import { rewriteCssReferences } from './css.ts';
import { classifyReference, joinReference, normalizeReference } from './reference.ts';
import { decodeText } from './text.ts';

/** What a reference that names nothing loadable is rewritten to. */
export const UNRESOLVABLE_URL = 'about:invalid';

export type ReferenceResolver = (reference: string) => Resource | undefined;

export interface ResourceSummary {
  /** Data URLs minted for this render. */
  readonly dataUrls: number;
  readonly resolved: readonly string[];
  readonly unresolved: readonly string[];
  /** References that resolved but whose media type this host will not serve. */
  readonly refused: readonly string[];
  /** References left as written for the CSP to refuse. */
  readonly remote: readonly string[];
  /** Images replaced by their alt text because they could not be resolved. */
  readonly altSubstituted: number;
}

const NO_ANCESTORS: ReadonlySet<string> = new Set<string>();

const STYLESHEET_TYPE = 'text/css';
const FONT_TYPES = new Set([
  'application/font-woff',
  'application/font-woff2',
  'application/vnd.ms-fontobject',
  'application/vnd.ms-opentype',
  'application/x-font-opentype',
  'application/x-font-otf',
  'application/x-font-truetype',
  'application/x-font-ttf',
  'application/x-font-woff',
]);

const BASE64_CHUNK = 0x8000;
const SAFE_MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

function baseType(mediaType: string): string {
  return (mediaType.split(';')[0] ?? '').trim().toLowerCase();
}

/**
 * Only these media types are minted a blob URL. A reference resolving is not
 * evidence it should be served: the seam answers for the whole manifest, so a
 * `text/javascript` entry resolves as readily as an image — and a blob URL is a
 * capability, not a convenience.
 */
function isServable(mediaType: string): boolean {
  const type = baseType(mediaType);
  return type.startsWith('image/') || type.startsWith('font/') || FONT_TYPES.has(type);
}

/**
 * Turns references found in book content into `data:` URLs.
 *
 * `blob:` is what the plan asked for and it cannot work here: a blob URL
 * belongs to the origin that created it, and the frame's origin is opaque, so
 * the frame is refused the host's blob URLs outright — measured in Chromium as
 * "Not allowed to load local resource", below CSP, with no violation event to
 * observe. A `data:` URL carries its own bytes and has no origin to check, so
 * it crosses the boundary the sandbox deliberately makes uncrossable. The cost
 * is base64's 33% and no revocation handle; both are bounded by one section.
 */
export class ResourceRegistry {
  readonly #resolve: ReferenceResolver | undefined;
  readonly #resources = new Map<string, Promise<string | undefined>>();
  readonly #stylesheets = new Map<string, Promise<string | undefined>>();
  readonly #resolved = new Set<string>();
  readonly #unresolved = new Set<string>();
  readonly #refused = new Set<string>();
  readonly #remote = new Set<string>();
  #minted = 0;
  #released = false;

  constructor(resolve?: ReferenceResolver) {
    this.#resolve = resolve;
  }

  get summary(): Omit<ResourceSummary, 'altSubstituted'> {
    return {
      dataUrls: this.#minted,
      resolved: [...this.#resolved],
      unresolved: [...this.#unresolved],
      refused: [...this.#refused],
      remote: [...this.#remote],
    };
  }

  /**
   * Memoized by reference string, not by the resource object: the contract
   * promises equal bytes for equal references, not one shared object.
   */
  urlForResource(reference: string): Promise<string | undefined> {
    const key = normalizeReference(reference);
    const existing = this.#resources.get(key);
    if (existing !== undefined) return existing;
    const created = this.#loadResource(key);
    this.#resources.set(key, created);
    return created;
  }

  urlForStylesheet(reference: string, ancestors: ReadonlySet<string> = NO_ANCESTORS): Promise<string | undefined> {
    const key = normalizeReference(reference);
    // A sheet that is already an ancestor of itself is an @import cycle. Refuse
    // it here and the recursion terminates rather than awaiting its own result.
    if (ancestors.has(key)) return Promise.resolve(undefined);
    const existing = this.#stylesheets.get(key);
    if (existing !== undefined) return existing;
    const created = this.#loadStylesheet(key, new Set([...ancestors, key]));
    this.#stylesheets.set(key, created);
    return created;
  }

  rewriteStylesheet(css: string, base: string, ancestors: ReadonlySet<string> = NO_ANCESTORS): Promise<string> {
    return rewriteCssReferences(css, async (reference) => {
      const classified = classifyReference(reference.value);
      if (classified.kind !== 'relative') {
        // data: URIs carry their own bytes and remote ones are the CSP's to
        // refuse — visibly. Neither is ours to rewrite.
        if (classified.kind === 'scheme' && classified.scheme !== 'data') this.#remote.add(classified.value);
        return undefined;
      }
      const target = joinReference(base, classified.value);
      const url =
        reference.kind === 'import'
          ? await this.urlForStylesheet(target, ancestors)
          : await this.urlForResource(target);
      return url ?? UNRESOLVABLE_URL;
    });
  }

  /**
   * Drops everything this render allocated. Data URLs hold no handle to
   * release, so this frees memoized strings and stops any in-flight load from
   * minting more — there is no orphan URL a render can leave behind.
   */
  release(): void {
    this.#released = true;
    this.#resources.clear();
    this.#stylesheets.clear();
  }

  async #loadResource(key: string): Promise<string | undefined> {
    const resource = this.#resolve?.(key);
    if (resource === undefined) {
      this.#unresolved.add(key);
      return undefined;
    }
    if (!isServable(resource.mediaType)) {
      this.#refused.add(key);
      return undefined;
    }
    let bytes: Uint8Array;
    try {
      bytes = await resource.load();
    } catch {
      this.#unresolved.add(key);
      return undefined;
    }
    return this.#dataUrl(bytes, resource.mediaType, key);
  }

  async #loadStylesheet(key: string, ancestors: ReadonlySet<string>): Promise<string | undefined> {
    const resource = this.#resolve?.(key);
    if (resource === undefined) {
      this.#unresolved.add(key);
      return undefined;
    }
    if (baseType(resource.mediaType) !== STYLESHEET_TYPE) {
      this.#refused.add(key);
      return undefined;
    }
    let css: string;
    try {
      css = decodeText(await resource.load());
    } catch {
      this.#unresolved.add(key);
      return undefined;
    }
    // Relative references inside the sheet are resolved against the sheet, then
    // re-expressed relative to the section, because that is the only space
    // Section.resolve() understands.
    const rewritten = await this.rewriteStylesheet(css, key, ancestors);
    return this.#dataUrl(new TextEncoder().encode(rewritten), STYLESHEET_TYPE, key);
  }

  #dataUrl(bytes: Uint8Array, mediaType: string, key: string): string | undefined {
    if (this.#released) return undefined;
    const type = baseType(mediaType);
    const declared = SAFE_MEDIA_TYPE.test(type) ? type : 'application/octet-stream';
    this.#minted += 1;
    this.#resolved.add(key);
    return `data:${declared};base64,${toBase64(bytes)}`;
  }
}

async function applySvgReference(element: Element, registry: ResourceRegistry): Promise<void> {
  const namespaced = element.getAttributeNS(XLINK_NAMESPACE, 'href');
  const plain = element.getAttribute('href');
  const raw = plain ?? namespaced;
  if (raw === null) return;
  const classified = classifyReference(raw);
  if (classified.kind !== 'relative') return;
  const url = await registry.urlForResource(classified.value);
  if (url === undefined) {
    element.remove();
    return;
  }
  if (namespaced !== null) element.setAttributeNS(XLINK_NAMESPACE, 'xlink:href', url);
  if (plain !== null || namespaced === null) element.setAttribute('href', url);
}

/**
 * Replaces every in-book reference in a sanitized document with a `blob:` URL.
 * Runs after sanitization, so it only ever sees attributes the allowlist kept.
 */
export async function applyResources(doc: Document, registry: ResourceRegistry): Promise<ResourceSummary> {
  let altSubstituted = 0;

  for (const link of [...doc.querySelectorAll('link')]) {
    const href = link.getAttribute('href');
    if (href === null) {
      link.remove();
      continue;
    }
    const classified = classifyReference(href);
    if (classified.kind !== 'relative') continue;
    const url = await registry.urlForStylesheet(classified.value);
    if (url === undefined) link.remove();
    else link.setAttribute('href', url);
  }

  for (const style of [...doc.querySelectorAll('style')]) {
    style.textContent = await registry.rewriteStylesheet(style.textContent ?? '', '');
  }

  for (const styled of [...doc.querySelectorAll('[style]')]) {
    const declarations = styled.getAttribute('style');
    if (declarations === null) continue;
    styled.setAttribute('style', await registry.rewriteStylesheet(declarations, ''));
  }

  for (const image of [...doc.querySelectorAll('img')]) {
    const src = image.getAttribute('src');
    const classified = src === null ? undefined : classifyReference(src);
    if (classified !== undefined && classified.kind !== 'relative') continue;
    const url = classified === undefined ? undefined : await registry.urlForResource(classified.value);
    if (url !== undefined) {
      image.setAttribute('src', url);
      continue;
    }
    // Gutenberg's ebookmaker sets each chapter's drop cap as <img alt="T">, so
    // silently dropping an image that cannot load deletes the first letter of
    // the chapter. The alt text comes back as a text node instead.
    const alt = image.getAttribute('alt') ?? '';
    if (alt === '') {
      image.remove();
    } else {
      image.replaceWith(doc.createTextNode(alt));
      altSubstituted += 1;
    }
  }

  for (const image of [...doc.querySelectorAll('image')]) {
    await applySvgReference(image, registry);
  }

  return { ...registry.summary, altSubstituted };
}
