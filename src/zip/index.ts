import { parseCentralDirectory, type CentralRecord } from './central.ts';
import { locateCentralDirectory } from './eocd.ts';
import {
  ZipEncryptedEntryError,
  ZipEntryNotFoundError,
  ZipError,
  ZipFormatError,
  ZipUnsupportedMethodError,
} from './errors.ts';
import { decompress } from './inflate.ts';
import { readExact, toByteSource, view, type ByteSource, type ZipSource } from './source.ts';

export { ZipEncryptedEntryError, ZipEntryNotFoundError, ZipError, ZipFormatError, ZipUnsupportedMethodError };
export type { RangeReader, RangeReaderSource, ZipSource } from './source.ts';

const LOCAL_SIG = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly encrypted: boolean;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  entry(name: string): ZipEntry | undefined;
  read(name: string): Promise<Uint8Array>;
}

export async function openZip(source: ZipSource): Promise<ZipArchive> {
  const src = toByteSource(source);
  const location = await locateCentralDirectory(src);
  const directory = await readExact(src, location.offset, location.size);
  const records = parseCentralDirectory(directory, location.entryCount);
  const byName = new Map<string, CentralRecord>();
  for (const record of records) byName.set(record.name, record);

  const entries: readonly ZipEntry[] = records.map((record) => ({
    name: record.name,
    method: record.method,
    compressedSize: record.compressedSize,
    uncompressedSize: record.uncompressedSize,
    encrypted: record.encrypted,
  }));

  return {
    entries,
    entry: (name) => entries.find((e) => e.name === name),
    read: async (name) => {
      const record = byName.get(name);
      if (!record) throw new ZipEntryNotFoundError(`no entry named ${name}`);
      return readEntry(src, record);
    },
  };
}

async function readEntry(src: ByteSource, record: CentralRecord): Promise<Uint8Array> {
  if (record.encrypted) {
    throw new ZipEncryptedEntryError(`entry ${record.name} is encrypted; encrypted archives are not supported`);
  }
  const header = await readExact(src, record.localHeaderOffset, LOCAL_HEADER_SIZE);
  const dv = view(header);
  if (dv.getUint32(0, true) !== LOCAL_SIG) {
    throw new ZipFormatError(`entry ${record.name}: no local file header at offset ${record.localHeaderOffset}`);
  }
  // The local header's own name/extra lengths can differ from the central
  // directory's (bsdtar pads local extras); sizes with data descriptors (flag
  // bit 3) are zero here — the central directory values are authoritative.
  const nameLen = dv.getUint16(26, true);
  const extraLen = dv.getUint16(28, true);
  const dataOffset = record.localHeaderOffset + LOCAL_HEADER_SIZE + nameLen + extraLen;
  const data = await readExact(src, dataOffset, record.compressedSize);
  const out = await decompress(data, record.method, record.name);
  if (out.byteLength !== record.uncompressedSize) {
    throw new ZipFormatError(
      `entry ${record.name}: expected ${record.uncompressedSize} bytes, decompressed to ${out.byteLength}`,
    );
  }
  return out;
}
