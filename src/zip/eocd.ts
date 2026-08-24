import { ZipFormatError } from './errors.ts';
import { readExact, view, type ByteSource } from './source.ts';

const EOCD_SIG = 0x06054b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const LOCATOR_SIG = 0x07064b50;
const LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_EOCD_MIN = 56;
const INITIAL_PROBE = 1024;

export interface CentralDirectoryLocation {
  offset: number;
  size: number;
  entryCount: number;
}

export async function locateCentralDirectory(src: ByteSource): Promise<CentralDirectoryLocation> {
  if (src.size < EOCD_MIN) throw new ZipFormatError('too small to be a zip archive');

  let probe = Math.min(src.size, INITIAL_PROBE);
  let tail = await readExact(src, src.size - probe, probe);
  let idx = findEocd(tail);
  const maxProbe = Math.min(src.size, EOCD_MIN + MAX_COMMENT);
  if (idx < 0 && probe < maxProbe) {
    probe = maxProbe;
    tail = await readExact(src, src.size - probe, probe);
    idx = findEocd(tail);
  }
  if (idx < 0) throw new ZipFormatError('end of central directory record not found');

  const eocdFileOffset = src.size - probe + idx;
  const zip64 = await readZip64(src, tail, idx, eocdFileOffset);
  if (zip64) return zip64;

  const dv = view(tail);
  const diskNumber = dv.getUint16(idx + 4, true);
  const cdDisk = dv.getUint16(idx + 6, true);
  if (diskNumber !== 0 || cdDisk !== 0) {
    throw new ZipFormatError('multi-disk archives are not supported');
  }
  const entryCount = dv.getUint16(idx + 10, true);
  const size = dv.getUint32(idx + 12, true);
  const offset = dv.getUint32(idx + 16, true);
  if (entryCount === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipFormatError('zip64 markers present but the zip64 locator is missing');
  }
  return { offset, size, entryCount };
}

function findEocd(tail: Uint8Array): number {
  const dv = view(tail);
  for (let i = tail.byteLength - EOCD_MIN; i >= 0; i--) {
    if (dv.getUint32(i, true) !== EOCD_SIG) continue;
    const commentLen = dv.getUint16(i + 20, true);
    if (i + EOCD_MIN + commentLen === tail.byteLength) return i;
  }
  return -1;
}

async function readZip64(
  src: ByteSource,
  tail: Uint8Array,
  eocdIdx: number,
  eocdFileOffset: number,
): Promise<CentralDirectoryLocation | null> {
  if (eocdFileOffset < LOCATOR_SIZE) return null;
  const locator =
    eocdIdx >= LOCATOR_SIZE
      ? tail.subarray(eocdIdx - LOCATOR_SIZE, eocdIdx)
      : await readExact(src, eocdFileOffset - LOCATOR_SIZE, LOCATOR_SIZE);
  const ldv = view(locator);
  if (ldv.getUint32(0, true) !== LOCATOR_SIG) return null;
  if (ldv.getUint32(16, true) > 1) {
    throw new ZipFormatError('multi-disk archives are not supported');
  }
  const recordOffset = toSafeNumber(ldv.getBigUint64(8, true), 'zip64 EOCD offset');

  const record = await readExact(src, recordOffset, ZIP64_EOCD_MIN);
  const rdv = view(record);
  if (rdv.getUint32(0, true) !== ZIP64_EOCD_SIG) {
    throw new ZipFormatError('zip64 locator points at a missing zip64 EOCD record');
  }
  return {
    entryCount: toSafeNumber(rdv.getBigUint64(32, true), 'zip64 entry count'),
    size: toSafeNumber(rdv.getBigUint64(40, true), 'zip64 central directory size'),
    offset: toSafeNumber(rdv.getBigUint64(48, true), 'zip64 central directory offset'),
  };
}

export function toSafeNumber(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipFormatError(`${what} exceeds the safe integer range`);
  }
  return Number(value);
}
