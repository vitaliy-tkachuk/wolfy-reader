import { ZipFormatError } from './errors.ts';
import { toSafeNumber } from './eocd.ts';
import { view } from './source.ts';

const CEN_SIG = 0x02014b50;
const CEN_MIN = 46;
const ZIP64_EXTRA_ID = 0x0001;

export interface CentralRecord {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

export function parseCentralDirectory(bytes: Uint8Array, entryCount: number): CentralRecord[] {
  const dv = view(bytes);
  // Names without the UTF-8 flag (bit 11) are cp437 by spec; TextDecoder has no
  // cp437, so non-fatal UTF-8 covers the ASCII names real ebooks use.
  const utf8 = new TextDecoder('utf-8', { fatal: false });
  const records: CentralRecord[] = [];
  let pos = 0;
  for (let i = 0; i < entryCount; i++) {
    if (pos + CEN_MIN > bytes.byteLength || dv.getUint32(pos, true) !== CEN_SIG) {
      throw new ZipFormatError(`malformed central directory: bad record ${i} at offset ${pos}`);
    }
    const flags = dv.getUint16(pos + 8, true);
    const method = dv.getUint16(pos + 10, true);
    const crc32 = dv.getUint32(pos + 16, true);
    let compressedSize = dv.getUint32(pos + 20, true);
    let uncompressedSize = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    let localHeaderOffset = dv.getUint32(pos + 42, true);
    const recordEnd = pos + CEN_MIN + nameLen + extraLen + commentLen;
    if (recordEnd > bytes.byteLength) {
      throw new ZipFormatError(`malformed central directory: record ${i} overruns the directory`);
    }
    const name = utf8.decode(bytes.subarray(pos + CEN_MIN, pos + CEN_MIN + nameLen));

    const extraStart = pos + CEN_MIN + nameLen;
    let extraPos = extraStart;
    while (extraPos + 4 <= extraStart + extraLen) {
      const id = dv.getUint16(extraPos, true);
      const size = dv.getUint16(extraPos + 2, true);
      if (extraPos + 4 + size > extraStart + extraLen) break;
      if (id === ZIP64_EXTRA_ID) {
        // The zip64 extra holds values only for the fields masked with
        // 0xffffffff, in this fixed order.
        let fieldPos = extraPos + 4;
        if (uncompressedSize === 0xffffffff) {
          uncompressedSize = toSafeNumber(dv.getBigUint64(fieldPos, true), `entry ${name} uncompressed size`);
          fieldPos += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = toSafeNumber(dv.getBigUint64(fieldPos, true), `entry ${name} compressed size`);
          fieldPos += 8;
        }
        if (localHeaderOffset === 0xffffffff) {
          localHeaderOffset = toSafeNumber(dv.getBigUint64(fieldPos, true), `entry ${name} local header offset`);
          fieldPos += 8;
        }
      }
      extraPos += 4 + size;
    }

    records.push({
      name,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      encrypted: (flags & 0x0001) !== 0,
    });
    pos = recordEnd;
  }
  return records;
}
