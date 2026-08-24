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
  load(): Promise<Uint8Array>;
}

export interface Book {
  readonly metadata: BookMetadata;
  readonly toc: readonly TocItem[];
  /** Reading order. */
  readonly sections: readonly Section[];
  section(id: string): Section | undefined;
  /** Non-section payloads (images, stylesheets) keyed by format-defined id. */
  readonly resources: ReadonlyMap<string, Resource>;
}
