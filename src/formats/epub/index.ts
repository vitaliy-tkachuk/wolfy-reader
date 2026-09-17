import type {
  Book,
  BookFormat,
  BookMetadata,
  ByteSource,
  Resource,
  Section,
  TocItem,
} from '../../core/index.ts';
import { CorruptContainerError, EncryptedContentError } from '../../core/index.ts';
import { sectionLookup } from '../../core/lookup.ts';
import { openZip, ZipEncryptedEntryError, ZipError, type ZipArchive } from '../../zip/index.ts';
import { directoryOf, resolveHref } from './href.ts';
import { deobfuscate, obfuscationKey, parseEncryption, type Encryption } from './obfuscation.ts';
import { opfPathFromContainer, parseOpf, type ManifestItem, type OpfPackage } from './opf.ts';
import { parseNavToc, parseNcxToc, type SectionByPath } from './toc.ts';
import { decodeXml } from '../xml.ts';

const EPUB_MIMETYPE = 'application/epub+zip';
const CONTAINER_PATH = 'META-INF/container.xml';
const ENCRYPTION_PATH = 'META-INF/encryption.xml';

export const epub: BookFormat = {
  name: 'epub',
  async sniff(source) {
    if (!(await hasZipSignature(source))) return false;
    try {
      const zip = await openZip(asZipSource(source));
      if (zip.entry('mimetype') === undefined) return false;
      const mimetype = new TextDecoder().decode(await zip.read('mimetype'));
      // The OCF spec forbids padding, but a trailing newline is a common
      // real-world authoring deviation; tolerate trailing whitespace only.
      return mimetype.trimEnd() === EPUB_MIMETYPE;
    } catch {
      return false;
    }
  },
  async decode(source) {
    const zip = await openContainer(source);
    const containerXml = decodeXml(await readEntry(zip, CONTAINER_PATH));
    let opfPath: string;
    try {
      opfPath = opfPathFromContainer(containerXml);
    } catch (error) {
      throw new CorruptContainerError(`${CONTAINER_PATH} is not a valid OCF container document`, {
        cause: error,
      });
    }
    const opfXml = decodeXml(await readEntry(zip, opfPath));
    let pkg: OpfPackage;
    try {
      pkg = parseOpf(opfXml, opfPath);
    } catch (error) {
      throw new CorruptContainerError(`${opfPath} is not a valid OPF package document`, {
        cause: error,
      });
    }
    return buildBook(zip, pkg, await readEncryption(zip));
  },
};

// Absence or damage of encryption.xml degrades to "nothing is declared": the
// book still opens and every load() stays plain, matching the TOC's rule that
// a broken auxiliary document never fails an otherwise readable book.
async function readEncryption(zip: ZipArchive): Promise<Encryption | undefined> {
  if (zip.entry(ENCRYPTION_PATH) === undefined) return undefined;
  try {
    return parseEncryption(decodeXml(await readEntry(zip, ENCRYPTION_PATH)));
  } catch {
    return undefined;
  }
}

async function hasZipSignature(source: ByteSource): Promise<boolean> {
  const head = await source.read(0, 4);
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

function asZipSource(source: ByteSource): { size: number; read: (offset: number, length: number) => Promise<Uint8Array> } {
  return { size: source.size, read: (offset, length) => source.read(offset, length) };
}

async function openContainer(source: ByteSource): Promise<ZipArchive> {
  try {
    return await openZip(asZipSource(source));
  } catch (error) {
    throw bridged(error, 'the EPUB zip container');
  }
}

async function readEntry(zip: ZipArchive, name: string): Promise<Uint8Array> {
  try {
    return await zip.read(name);
  } catch (error) {
    throw bridged(error, name);
  }
}

function bridged(error: unknown, what: string): unknown {
  if (error instanceof ZipEncryptedEntryError) {
    return new EncryptedContentError(`${what} is encrypted`, { cause: error });
  }
  if (error instanceof ZipError) {
    return new CorruptContainerError(`cannot read ${what}`, { cause: error });
  }
  return error;
}

const SPINE_MEDIA_TYPES = new Set(['application/xhtml+xml', 'image/svg+xml', 'text/html']);
const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml';

async function buildBook(zip: ZipArchive, pkg: OpfPackage, encryption: Encryption | undefined): Promise<Book> {
  const baseDir = directoryOf(pkg.path);
  const entryPath = (item: ManifestItem): string => resolveHref(baseDir, item.href)?.path ?? item.href;
  const loaderFor = loaderFactory(zip, pkg, encryption);

  // Content references resolve against the document that carries them, and the
  // manifest is the only statement of a media type — so a reference is
  // resolvable only when it names a manifest item that is really in the
  // archive. Absent entries are rejected here rather than deferred to load(),
  // because a consumer building a URL must know before it builds one.
  const present = new Set(zip.entries.map((entry) => entry.name));
  const resourceByPath = new Map<string, Resource>();
  for (const item of pkg.manifest) {
    const path = entryPath(item);
    if (!present.has(path) || resourceByPath.has(path)) continue;
    resourceByPath.set(path, { mediaType: item.mediaType, load: loaderFor(path) });
  }
  const resolveFrom = (fromDir: string, reference: string): Resource | undefined => {
    const target = resolveHref(fromDir, reference);
    return target === undefined ? undefined : resourceByPath.get(target.path);
  };

  const sections: Section[] = [];
  const sectionByPath = new Map<string, string>();
  const spineIds = new Set<string>();
  for (const entry of pkg.spine) {
    const item = pkg.itemById.get(entry.idref);
    if (item === undefined || spineIds.has(item.id)) continue;
    spineIds.add(item.id);
    const content = resolveFallback(item, pkg.itemById);
    const path = entryPath(content);
    const scripted = item.properties.includes('scripted') || content.properties.includes('scripted');
    // The section's own directory, not the OPF's: a chapter in OEBPS/text/
    // reaches its images through ../images/, which the OPF's base would
    // resolve one level too high.
    const contentDir = directoryOf(path);
    sections.push({
      id: item.id,
      mediaType: content.mediaType,
      ...(scripted ? { scripted } : {}),
      ...(entry.linear === false ? { linear: false } : {}),
      load: loaderFor(path),
      resolve: (reference) => resolveFrom(contentDir, reference),
      // Resolve a section-relative href to the section it names, reusing the same
      // resolved-entry-name → section-id table the TOC is built from. `sectionByPath`
      // is fully populated by the time any click fires, so the closure reads it live.
      resolveHref: (reference) => {
        const target = resolveHref(contentDir, reference);
        if (target === undefined) return undefined;
        const sectionId = sectionByPath.get(target.path);
        if (sectionId === undefined) return undefined;
        return target.fragment === undefined ? { sectionId } : { sectionId, fragment: target.fragment };
      },
    });
    // TOCs point at the spine item's own href even when a fallback supplies
    // the content, so both paths map to the section.
    for (const target of [entryPath(item), path]) {
      if (!sectionByPath.has(target)) sectionByPath.set(target, item.id);
    }
  }

  const resources = new Map<string, Resource>();
  for (const item of pkg.manifest) {
    if (spineIds.has(item.id)) continue;
    const path = entryPath(item);
    resources.set(item.id, { mediaType: item.mediaType, load: loaderFor(path) });
  }

  const coverItem = pkg.coverItem;
  const coverPath = coverItem === undefined ? undefined : entryPath(coverItem);
  const cover: Resource | undefined =
    coverItem === undefined || coverPath === undefined
      ? undefined
      : { mediaType: coverItem.mediaType, load: loaderFor(coverPath) };

  // Trimmed, unlike OpfPackage.uniqueIdentifier: the obfuscation key strips XML
  // whitespace itself and needs the identifier verbatim, while a host keying
  // persisted positions wants the same string every time it opens the book.
  const identifier = pkg.uniqueIdentifier?.trim();
  const metadata: BookMetadata = {
    ...(pkg.title === undefined ? {} : { title: pkg.title }),
    ...(pkg.author === undefined ? {} : { author: pkg.author }),
    ...(pkg.language === undefined ? {} : { language: pkg.language }),
    ...(identifier === undefined || identifier === '' ? {} : { identifier }),
    ...(cover === undefined ? {} : { cover }),
  };

  return {
    metadata,
    toc: await buildToc(zip, pkg, baseDir, sectionByPath),
    sections,
    section: sectionLookup(sections),
    resources,
    ...(pkg.direction === undefined ? {} : { direction: pkg.direction }),
    ...(pkg.fixedLayout === undefined ? {} : { fixedLayout: pkg.fixedLayout }),
  };
}

// One authority for every load() closure — sections, resources, cover. The
// refusal of foreign algorithms is lazy on purpose: like a zip-encrypted entry,
// a resource the decoder cannot serve never fails the book, only its own load().
function loaderFactory(
  zip: ZipArchive,
  pkg: OpfPackage,
  encryption: Encryption | undefined,
): (path: string) => () => Promise<Uint8Array> {
  let key: Promise<Uint8Array> | undefined;
  return (path) => {
    if (encryption?.encrypted.has(path)) {
      return async () => {
        throw new EncryptedContentError(`${path} is encrypted`);
      };
    }
    if (encryption?.obfuscated.has(path)) {
      const identifier = pkg.uniqueIdentifier;
      if (identifier === undefined) {
        return async () => {
          throw new EncryptedContentError(`${path} is obfuscated and the package has no unique identifier to key it`);
        };
      }
      return async () => deobfuscate(await readEntry(zip, path), await (key ??= obfuscationKey(identifier)));
    }
    return () => readEntry(zip, path);
  };
}

function resolveFallback(item: ManifestItem, itemById: ReadonlyMap<string, ManifestItem>): ManifestItem {
  if (SPINE_MEDIA_TYPES.has(item.mediaType)) return item;
  const seen = new Set([item.id]);
  let current = item;
  while (current.fallback !== undefined) {
    if (seen.has(current.fallback)) {
      throw new CorruptContainerError(`the manifest fallback chain for item ${item.id} is circular`);
    }
    const next = itemById.get(current.fallback);
    if (next === undefined) break;
    seen.add(next.id);
    if (SPINE_MEDIA_TYPES.has(next.mediaType)) return next;
    current = next;
  }
  return item;
}

// A broken or missing TOC degrades to [] — it never fails an otherwise
// readable book. The EPUB3 nav document wins over the EPUB2 NCX.
async function buildToc(
  zip: ZipArchive,
  pkg: OpfPackage,
  baseDir: string,
  sectionByPath: SectionByPath,
): Promise<readonly TocItem[]> {
  const navItem = pkg.manifest.find((item) => item.properties.includes('nav'));
  const navPath = navItem === undefined ? undefined : resolveHref(baseDir, navItem.href)?.path;
  if (navPath !== undefined) {
    try {
      const toc = parseNavToc(decodeXml(await readEntry(zip, navPath)), navPath, sectionByPath);
      if (toc.length > 0) return toc;
    } catch {}
  }
  const ncxItem =
    (pkg.ncxId === undefined ? undefined : pkg.itemById.get(pkg.ncxId)) ??
    pkg.manifest.find((item) => item.mediaType === NCX_MEDIA_TYPE);
  const ncxPath = ncxItem === undefined ? undefined : resolveHref(baseDir, ncxItem.href)?.path;
  if (ncxPath !== undefined) {
    try {
      return parseNcxToc(decodeXml(await readEntry(zip, ncxPath)), ncxPath, sectionByPath);
    } catch {}
  }
  return [];
}
