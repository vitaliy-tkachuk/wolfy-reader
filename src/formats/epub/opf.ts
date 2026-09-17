import {
  attribute,
  childrenNamed,
  descendantsNamed,
  firstChildNamed,
  parseXml,
  type XmlElement,
} from '../xml.ts';

export interface ManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties: readonly string[];
  /** Manifest id of the item to use when this one's media type is unsupported. */
  readonly fallback?: string;
}

export interface OpfPackage {
  /** Zip entry name of the OPF; hrefs resolve relative to its directory. */
  readonly path: string;
  readonly title?: string;
  readonly author?: string;
  readonly language?: string;
  readonly coverItem?: ManifestItem;
  readonly manifest: readonly ManifestItem[];
  readonly itemById: ReadonlyMap<string, ManifestItem>;
  /** Spine itemref idrefs in reading order. */
  readonly spine: readonly string[];
  /** Manifest id of the NCX named by the spine's toc attribute. */
  readonly ncxId?: string;
  readonly direction?: 'ltr' | 'rtl';
  readonly fixedLayout?: boolean;
  /** The dc:identifier named by package[unique-identifier], verbatim (whitespace included). */
  readonly uniqueIdentifier?: string;
}

const PACKAGE_MEDIA_TYPE = 'application/oebps-package+xml';

export function opfPathFromContainer(xml: string): string {
  const root = parseXml(xml);
  const rootfiles = descendantsNamed(root, 'rootfile');
  const chosen = rootfiles.find((r) => attribute(r, 'media-type') === PACKAGE_MEDIA_TYPE) ?? rootfiles[0];
  const fullPath = chosen === undefined ? undefined : attribute(chosen, 'full-path');
  if (fullPath === undefined || fullPath === '') {
    throw new Error('the container document names no package rootfile');
  }
  return fullPath;
}

export function parseOpf(xml: string, path: string): OpfPackage {
  const root = parseXml(xml);
  if (root.localName !== 'package') {
    throw new Error(`root element is <${root.name}>, expected <package>`);
  }
  const manifestElement = firstChildNamed(root, 'manifest');
  if (manifestElement === undefined) throw new Error('the package has no <manifest>');
  const spineElement = firstChildNamed(root, 'spine');
  if (spineElement === undefined) throw new Error('the package has no <spine>');

  const manifest: ManifestItem[] = [];
  for (const item of childrenNamed(manifestElement, 'item')) {
    const id = attribute(item, 'id');
    const href = attribute(item, 'href');
    if (id === undefined || href === undefined) continue;
    const mediaType = attribute(item, 'media-type') ?? 'application/octet-stream';
    const properties = (attribute(item, 'properties') ?? '').split(/\s+/).filter((p) => p !== '');
    const fallback = attribute(item, 'fallback');
    manifest.push({
      id,
      href,
      mediaType,
      properties,
      ...(fallback === undefined || fallback === '' ? {} : { fallback }),
    });
  }
  const itemById = new Map(manifest.map((item) => [item.id, item]));

  const spine: string[] = [];
  for (const itemref of childrenNamed(spineElement, 'itemref')) {
    const idref = attribute(itemref, 'idref');
    if (idref !== undefined) spine.push(idref);
  }
  const ncxId = attribute(spineElement, 'toc');
  const progression = attribute(spineElement, 'page-progression-direction');
  const direction = progression === 'ltr' || progression === 'rtl' ? progression : undefined;

  const metadataElement = firstChildNamed(root, 'metadata');
  const title = metadataElement === undefined ? undefined : dcText(metadataElement, 'title');
  const author = metadataElement === undefined ? undefined : dcText(metadataElement, 'creator');
  const language = metadataElement === undefined ? undefined : dcText(metadataElement, 'language');
  const coverItem = findCoverItem(metadataElement, manifest, itemById);
  const fixedLayout = metadataElement === undefined ? undefined : renditionLayout(metadataElement);
  const uniqueIdentifier =
    metadataElement === undefined
      ? undefined
      : uniqueIdentifierOf(metadataElement, attribute(root, 'unique-identifier'));

  return {
    path,
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(language === undefined ? {} : { language }),
    ...(coverItem === undefined ? {} : { coverItem }),
    manifest,
    itemById,
    spine,
    ...(ncxId === undefined || ncxId === '' ? {} : { ncxId }),
    ...(direction === undefined ? {} : { direction }),
    ...(fixedLayout === undefined ? {} : { fixedLayout }),
    ...(uniqueIdentifier === undefined ? {} : { uniqueIdentifier }),
  };
}

// The identifier is kept verbatim: the font-obfuscation key strips XML
// whitespace itself, and trimming here would hide that rule from its test.
function uniqueIdentifierOf(metadata: XmlElement, id: string | undefined): string | undefined {
  const identifiers = descendantsNamed(metadata, 'identifier');
  const named = id === undefined ? undefined : identifiers.find((element) => attribute(element, 'id') === id);
  const chosen = named ?? identifiers.find((element) => element.text.trim() !== '');
  if (chosen === undefined || chosen.text.trim() === '') return undefined;
  return chosen.text;
}

function renditionLayout(metadata: XmlElement): boolean | undefined {
  for (const meta of descendantsNamed(metadata, 'meta')) {
    if (attribute(meta, 'property') !== 'rendition:layout') continue;
    const value = meta.text.trim();
    if (value === 'pre-paginated') return true;
    if (value === 'reflowable') return false;
  }
  return undefined;
}

function dcText(metadata: XmlElement, localName: string): string | undefined {
  for (const element of descendantsNamed(metadata, localName)) {
    const text = element.text.trim();
    if (text !== '') return text;
  }
  return undefined;
}

function findCoverItem(
  metadata: XmlElement | undefined,
  manifest: readonly ManifestItem[],
  itemById: ReadonlyMap<string, ManifestItem>,
): ManifestItem | undefined {
  const flagged = manifest.find((item) => item.properties.includes('cover-image'));
  if (flagged !== undefined) return flagged;
  if (metadata === undefined) return undefined;
  for (const meta of descendantsNamed(metadata, 'meta')) {
    if (attribute(meta, 'name') !== 'cover') continue;
    const content = attribute(meta, 'content');
    if (content === undefined || content === '') continue;
    // Some publishers put the image href in content instead of the item id.
    const item = itemById.get(content) ?? manifest.find((candidate) => candidate.href === content);
    if (item !== undefined) return item;
  }
  return undefined;
}
