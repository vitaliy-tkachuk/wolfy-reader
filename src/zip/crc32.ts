// From-scratch CRC-32 as defined by PKWARE APPNOTE 4.4.7: the "magic number"
// 0xDEBB20E3 form — equivalently the reflected polynomial 0xEDB88320 —
// pre-conditioned and post-conditioned with all ones. Table-driven: each table
// slot holds the CRC of that single byte value, so the loop is one XOR, one
// table lookup, and one shift per input byte. No code from any existing
// implementation; the algorithm comes from the spec (and ISO 3309 / ITU-T
// V.42, which APPNOTE cites).

const POLY = 0xedb88320;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? POLY ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of `bytes` (zip polynomial), as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (TABLE[(c ^ bytes[i]!) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
