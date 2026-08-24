import type { Book } from './book.ts';
import type { ByteSource } from './source.ts';
import type { StorageAdapter } from './storage.ts';

export interface FormatContext {
  readonly storage?: StorageAdapter;
}

/** A registrable format: claims input via sniff, then decodes it to a Book. */
export interface BookFormat {
  readonly name: string;
  sniff(source: ByteSource): boolean | Promise<boolean>;
  decode(source: ByteSource, context: FormatContext): Promise<Book>;
}
