import type { Book } from './book.ts';
import type { BookFormat, FormatContext } from './format.ts';
import type { BookInput } from './source.ts';
import type { StorageAdapter } from './storage.ts';
import { BookError, CorruptContainerError, UnrecognizedFormatError } from './errors.ts';
import { toByteSource } from './source.ts';

export interface OpenOptions {
  /** Tried in order; the first format whose sniff claims the input decodes it. */
  readonly formats: readonly BookFormat[];
  readonly storage?: StorageAdapter;
}

/** Bytes in, Book out: runs the registered sniffers in order and decodes with the first claimant. */
export async function open(input: BookInput, options: OpenOptions): Promise<Book> {
  const source = toByteSource(input);
  const context: FormatContext =
    options.storage === undefined ? {} : { storage: options.storage };
  for (const format of options.formats) {
    // A sniffer reads the input too, so it can fail for the same untyped
    // reasons a decoder can — a host range reader that rejects, most of all.
    let stage = 'sniff';
    try {
      if (!(await format.sniff(source))) continue;
      stage = 'decode';
      return await format.decode(source, context);
    } catch (error) {
      if (error instanceof BookError) throw error;
      throw new CorruptContainerError(`${format.name} failed to ${stage} the input`, {
        cause: error,
      });
    }
  }
  throw new UnrecognizedFormatError('no registered format recognizes this input');
}
