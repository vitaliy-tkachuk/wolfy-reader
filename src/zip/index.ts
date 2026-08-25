import { parseCentralDirectory, type CentralRecord } from './central.ts';
import { crc32 } from './crc32.ts';
import { locateCentralDirectory } from './eocd.ts';
import {
  ZipCrcMismatchError,
  ZipEncryptedEntryError,
  ZipEntryNotFoundError,
  ZipError,
  ZipFormatError,
  ZipUnsupportedMethodError,
} from './errors.ts';
import { decompress } from './inflate.ts';
import { readExact, toByteSource, view, type ByteSource, type ZipSource } from './source.ts';

export {
  ZipCrcMismatchError,
  ZipEncryptedEntryError,
  ZipEntryNotFoundError,
  ZipError,
  ZipFormatError,
  ZipUnsupportedMethodError,
};
export type { RangeReader, RangeReaderSource, ZipSource } from './source.ts';

const LOCAL_SIG = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;

function hex32(value: number): string {
  return `0x${value.toString(16).padStart(8, '0')}`;
}

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
  // First entry wins on a duplicate name, preserving the Array.find semantics
  // this Map lookup replaced.
  const entryByName = new Map<string, ZipEntry>();
  for (const entry of entries) {
    if (!entryByName.has(entry.name)) entryByName.set(entry.name, entry);
  }

  return {
    entries,
    entry: (name) => entryByName.get(name),
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
  // Verify against the central directory's CRC-32, unconditionally. The
  // data-descriptor exemption (APPNOTE 4.4.7) zeroes the CRC only in the
  // *local* header of a flag-bit-3 entry — "the correct value is put in the
  // data descriptor and in the central directory" — so the central copy is
  // always the real checksum and there is no CRC==0 skip: 0 is simply the
  // legitimate CRC of an empty payload, which trivially matches.
  const actual = crc32(out);
  if (actual !== record.crc32) {
    throw new ZipCrcMismatchError(
      `entry ${record.name}: CRC-32 mismatch (expected ${hex32(record.crc32)}, computed ${hex32(actual)})`,
    );
  }
  return out;
}
