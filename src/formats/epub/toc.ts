import type { TocItem } from '../../core/index.ts';
import { directoryOf, resolveHref, type HrefTarget } from './href.ts';
import {
  attribute,
  childrenNamed,
  deepText,
  descendantsNamed,
  firstChildNamed,
  parseXml,
  type XmlElement,
} from '../xml.ts';

/** Resolved zip entry name → section id, for turning TOC targets into section references. */
export type SectionByPath = ReadonlyMap<string, string>;

export function parseNavToc(xml: string, navPath: string, sectionByPath: SectionByPath): TocItem[] {
  const root = parseXml(xml);
  const navs = descendantsNamed(root, 'nav');
  const tocNav =
    navs.find((nav) => (attribute(nav, 'type') ?? '').split(/\s+/).includes('toc')) ??
    navs.find((nav) => descendantsNamed(nav, 'ol').length > 0);
  const list = tocNav === undefined ? undefined : (firstChildNamed(tocNav, 'ol') ?? descendantsNamed(tocNav, 'ol')[0]);
  if (list === undefined) return [];
  const baseDir = directoryOf(navPath);
  const items: TocItem[] = [];
  for (const li of childrenNamed(list, 'li')) {
    const item = navListEntry(li, baseDir, navPath, sectionByPath);
    if (item !== undefined) items.push(item);
  }
  return items;
}

function navListEntry(
  li: XmlElement,
  baseDir: string,
  navPath: string,
  sectionByPath: SectionByPath,
): TocItem | undefined {
  const anchor = firstChildNamed(li, 'a');
  const labelSource = anchor ?? firstChildNamed(li, 'span');
  const label = collapse(labelSource === undefined ? li.text : deepText(labelSource));

  const children: TocItem[] = [];
  const childList = firstChildNamed(li, 'ol');
  if (childList !== undefined) {
    for (const child of childrenNamed(childList, 'li')) {
      const item = navListEntry(child, baseDir, navPath, sectionByPath);
      if (item !== undefined) children.push(item);
    }
  }

  const href = anchor === undefined ? undefined : attribute(anchor, 'href');
  return tocEntry(label, resolveTarget(href, baseDir, navPath), children, sectionByPath);
}

export function parseNcxToc(xml: string, ncxPath: string, sectionByPath: SectionByPath): TocItem[] {
  const root = parseXml(xml);
  const navMap = descendantsNamed(root, 'navMap')[0];
  if (navMap === undefined) return [];
  const baseDir = directoryOf(ncxPath);
  const items: TocItem[] = [];
  for (const navPoint of childrenNamed(navMap, 'navPoint')) {
    const item = navPointEntry(navPoint, baseDir, ncxPath, sectionByPath);
    if (item !== undefined) items.push(item);
  }
  return items;
}

function navPointEntry(
  navPoint: XmlElement,
  baseDir: string,
  ncxPath: string,
  sectionByPath: SectionByPath,
): TocItem | undefined {
  const navLabel = firstChildNamed(navPoint, 'navLabel');
  const text = navLabel === undefined ? undefined : firstChildNamed(navLabel, 'text');
  const label = collapse(text === undefined ? '' : deepText(text));

  const children: TocItem[] = [];
  for (const child of childrenNamed(navPoint, 'navPoint')) {
    const item = navPointEntry(child, baseDir, ncxPath, sectionByPath);
    if (item !== undefined) children.push(item);
  }

  const src = firstChildNamed(navPoint, 'content');
  const href = src === undefined ? undefined : attribute(src, 'src');
  return tocEntry(label, resolveTarget(href, baseDir, ncxPath), children, sectionByPath);
}

function resolveTarget(
  href: string | undefined,
  baseDir: string,
  documentPath: string,
): HrefTarget | undefined {
  if (href === undefined || href === '') return undefined;
  if (href.startsWith('#')) return { path: documentPath, fragment: href.slice(1) };
  return resolveHref(baseDir, href);
}

/**
 * An entry with no resolvable target of its own borrows its first child's
 * section (a heading-only li / a navPoint pointing outside the spine);
 * with no children either, it is dropped.
 */
function tocEntry(
  label: string,
  target: HrefTarget | undefined,
  children: TocItem[],
  sectionByPath: SectionByPath,
): TocItem | undefined {
  const sectionId = target === undefined ? undefined : sectionByPath.get(target.path);
  if (sectionId !== undefined) {
    const fragment = target?.fragment;
    return { label, sectionId, ...(fragment === undefined ? {} : { fragment }), children };
  }
  const first = children[0];
  if (first === undefined) return undefined;
  return { label, sectionId: first.sectionId, children };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
