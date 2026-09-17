/** A lazily loaded binary payload with its media type. */
export interface Resource {
  readonly mediaType: string;
  load(): Promise<Uint8Array>;
}

/** Fields the format could not determine are omitted, never set to undefined. */
export interface BookMetadata {
  readonly title?: string;
  readonly author?: string;
  /** BCP 47 language tag. */
  readonly language?: string;
  readonly cover?: Resource;
  /** The identifier the book declares for itself; a stable key for persisted positions. */
  readonly identifier?: string;
}

/** A table-of-contents entry; targets a section by id, never by file path. */
export interface TocItem {
  readonly label: string;
  readonly sectionId: string;
  /** Anchor within the section, when the format provides one. */
  readonly fragment?: string;
  readonly children: readonly TocItem[];
}

/** One unit of the book's reading order. */
export interface Section {
  /** Unique within the book. */
  readonly id: string;
  readonly mediaType: string;
  /** True when the content declares executable script; omitted when unknown. */
  readonly scripted?: boolean;
  /** False when the book places this section outside its primary reading flow; omitted otherwise. */
  readonly linear?: boolean;
  load(): Promise<Uint8Array>;
  /**
   * Resolves a reference appearing inside this section's content — in whatever
   * form the format uses — to the resource it names. Returns undefined when the
   * reference names nothing this book can supply. Omitted by formats that
   * cannot resolve references.
   */
  resolve?(reference: string): Resource | undefined;
  /**
   * Resolves a reference appearing inside this section's content to the *section*
   * it targets (plus any fragment), or undefined when it names no section in this
   * book. The counterpart to {@link resolve}: `resolve` hands back a `Resource`'s
   * bytes for a reference (an image, a stylesheet), this hands back a navigation
   * target for a reference to another reading unit — a "next chapter" link, a
   * table-of-contents entry rendered in-content. Section-relative (a bare
   * `chapter-2.xhtml` resolves against this section's own location) and path-free
   * on return, so container paths never enter the model. Omitted by formats whose
   * references cannot name a section (plain text has none).
   */
  resolveHref?(reference: string): SectionRef | undefined;
}

/**
 * A resolved in-content reference: the section it targets, plus any fragment the
 * reference carried. Path-free by design — the return names a section by id, never
 * by container path, so paths never enter the model.
 */
export interface SectionRef {
  readonly sectionId: string;
  /** Anchor within the target section, when the reference carried one. */
  readonly fragment?: string;
}

/** Reading order of the pages: left-to-right or right-to-left. */
export type ReadingDirection = 'ltr' | 'rtl';

export interface Book {
  readonly metadata: BookMetadata;
  readonly toc: readonly TocItem[];
  /** Reading order. */
  readonly sections: readonly Section[];
  section(id: string): Section | undefined;
  /** Non-section payloads (images, stylesheets) keyed by format-defined id. */
  readonly resources: ReadonlyMap<string, Resource>;
  /** Declared reading direction; omitted when the book does not declare one. */
  readonly direction?: ReadingDirection;
  /** True when the book declares fixed-size pages. Detection only — rendering stays reflowable. */
  readonly fixedLayout?: boolean;
}
