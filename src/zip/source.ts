import { ZipFormatError } from './errors.ts';

export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

/** Streaming input: `size` is required because locating a zip's central directory starts from the file tail. */
export interface RangeReaderSource {
  read: RangeReader;
  size: number;
}

export type ZipSource = ArrayBuffer | Uint8Array | Blob | RangeReaderSource;

export interface ByteSource {
  size: number;
  read: RangeReader;
}

export function toByteSource(source: ZipSource): ByteSource {
  if (source instanceof Uint8Array) return bufferSource(source);
  if (source instanceof ArrayBuffer) return bufferSource(new Uint8Array(source));
  if (source instanceof Blob) {
    return {
      size: source.size,
      read: async (offset, length) =>
        new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()),
    };
  }
  return { size: source.size, read: (offset, length) => source.read(offset, length) };
}

function bufferSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
  };
}

export async function readExact(src: ByteSource, offset: number, length: number): Promise<Uint8Array> {
  if (offset < 0 || length < 0 || offset + length > src.size) {
    throw new ZipFormatError(`range ${offset}..${offset + length} is outside the ${src.size}-byte source`);
  }
  const bytes = await src.read(offset, length);
  if (bytes.byteLength !== length) {
    throw new ZipFormatError(`short read at ${offset}: wanted ${length} bytes, got ${bytes.byteLength}`);
  }
  return bytes;
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
