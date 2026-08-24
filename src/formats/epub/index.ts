import type {
  Book,
  BookFormat,
  BookMetadata,
  ByteSource,
  Resource,
  Section,
} from '../../core/index.ts';
import { CorruptContainerError, EncryptedContentError } from '../../core/index.ts';
import { openZip, ZipEncryptedEntryError, ZipError, type ZipArchive } from '../../zip/index.ts';
import { opfPathFromContainer, parseOpf, type OpfPackage } from './opf.ts';
import { decodeXml } from './xml.ts';

const EPUB_MIMETYPE = 'application/epub+zip';
const CONTAINER_PATH = 'META-INF/container.xml';

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
    return buildBook(zip, pkg);
  },
};

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

function buildBook(zip: ZipArchive, pkg: OpfPackage): Book {
  const sections: Section[] = [];
  const spineIds = new Set<string>();
  for (const idref of pkg.spine) {
    const item = pkg.itemById.get(idref);
    if (item === undefined || spineIds.has(item.id)) continue;
    spineIds.add(item.id);
    sections.push({
      id: item.id,
      mediaType: item.mediaType,
      load: () => readEntry(zip, item.href),
    });
  }

  const resources = new Map<string, Resource>();
  for (const item of pkg.manifest) {
    if (spineIds.has(item.id)) continue;
    resources.set(item.id, {
      mediaType: item.mediaType,
      load: () => readEntry(zip, item.href),
    });
  }

  const coverItem = pkg.coverItem;
  const cover: Resource | undefined =
    coverItem === undefined
      ? undefined
      : { mediaType: coverItem.mediaType, load: () => readEntry(zip, coverItem.href) };

  const metadata: BookMetadata = {
    ...(pkg.title === undefined ? {} : { title: pkg.title }),
    ...(pkg.author === undefined ? {} : { author: pkg.author }),
    ...(pkg.language === undefined ? {} : { language: pkg.language }),
    ...(cover === undefined ? {} : { cover }),
  };

  return {
    metadata,
    toc: [],
    sections,
    section: (id) => sections.find((section) => section.id === id),
    resources,
  };
}
