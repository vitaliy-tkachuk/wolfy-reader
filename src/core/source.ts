/** Reads `length` bytes starting at `offset`; may return fewer at end of data. */
export type RangeRead = (offset: number, length: number) => Promise<Uint8Array>;

/** Streaming input form: total size plus a host-implemented range-read callback. */
export interface RangeReader {
  readonly size: number;
  readonly read: RangeRead;
}

export type BookInput = ArrayBuffer | Blob | RangeReader;

/** Normalized byte access that every sniffer and decoder consumes. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  /** The whole input as one buffer, fetched once and cached. */
  bytes(): Promise<Uint8Array>;
}

export function toByteSource(input: BookInput): ByteSource {
  if (input instanceof ArrayBuffer) return fromBytes(new Uint8Array(input));
  if (input instanceof Blob) return fromBlob(input);
  if (isRangeReader(input)) return fromRangeReader(input);
  throw new TypeError('input must be an ArrayBuffer, Blob, File, or RangeReader');
}

function isRangeReader(value: unknown): value is RangeReader {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RangeReader).read === 'function' &&
    typeof (value as RangeReader).size === 'number'
  );
}

function fromBytes(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
    bytes: () => Promise.resolve(bytes),
  };
}

function fromBlob(blob: Blob): ByteSource {
  let all: Promise<Uint8Array> | undefined;
  return {
    size: blob.size,
    read: async (offset, length) =>
      new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
    bytes: () => (all ??= blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))),
  };
}

function fromRangeReader(reader: RangeReader): ByteSource {
  let all: Promise<Uint8Array> | undefined;
  return {
    size: reader.size,
    read: (offset, length) => reader.read(offset, length),
    bytes: () => (all ??= reader.read(0, reader.size)),
  };
}
