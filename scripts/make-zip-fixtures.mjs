// Regenerates the committed zip fixtures in test/fixtures/zip/.
// Tool-generated fixtures (PowerShell Compress-Archive, bsdtar) exercise
// real-world header variance; Node-generated ones force shapes no installed
// tool emits on demand (pure method 0, masked zip64 fields, encrypted entries,
// the range-test layout). Requires Windows for the tool half; the Node half
// runs anywhere.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'test', 'fixtures', 'zip');
const contentDir = join(outDir, 'content');
mkdirSync(contentDir, { recursive: true });

const alpha = Buffer.from(
  [
    'The lantern-keeper counts her stairs,',
    'one hundred four from tide to flame,',
    'and every night the harbour swears',
    'the light has never looked the same.',
    '',
  ].join('\n'),
  'utf-8',
);

const loremLines = [];
for (let i = 0; i < 40; i++) {
  loremLines.push(
    `Paragraph ${i}: the ferry crossed at dawn while the fog held its breath, ` +
      'and the crates of winter apples shifted once against the rail.',
  );
}
const lorem = Buffer.from(loremLines.join('\n') + '\n', 'utf-8');

const dataBin = Buffer.alloc(1024);
for (let i = 0; i < dataBin.length; i++) dataBin[i] = (i * 7 + (i >> 3)) & 0xff;

writeFileSync(join(contentDir, 'alpha.txt'), alpha);
writeFileSync(join(contentDir, 'lorem.txt'), lorem);
writeFileSync(join(contentDir, 'data.bin'), dataBin);

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: contentDir, stdio: 'inherit' });
  if (res.error || res.status !== 0) {
    console.warn(`warning: ${cmd} failed (${res.error ?? `exit ${res.status}`}) — fixture skipped`);
    return false;
  }
  return true;
}

const tar = 'C:\\Windows\\System32\\tar.exe';
run(tar, ['--format', 'zip', '-cf', join(outDir, 'tar-deflate-dd.zip'), 'alpha.txt', 'lorem.txt', 'data.bin']);
run(tar, [
  '--format', 'zip', '--options', 'zip:compression=store',
  '-cf', join(outDir, 'tar-stored-dd.zip'), 'alpha.txt', 'lorem.txt', 'data.bin',
]);
run(tar, ['--format', 'zip', '--options', 'zip:zip64', '-cf', join(outDir, 'tar-zip64.zip'), 'alpha.txt', 'lorem.txt']);
run(tar, [
  '--format', 'zip', '--options', 'zip:encryption=zipcrypt', '--passphrase', 'wolfy',
  '-cf', join(outDir, 'tar-encrypted.zip'), 'alpha.txt',
]);
run('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path alpha.txt,lorem.txt,data.bin -DestinationPath '${join(outDir, 'psh-deflate.zip')}' -Force`,
]);

// --- byte-level zip writer -------------------------------------------------

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}
function u64(v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}

// entries: { name, data, method: 0|8|other, encrypted?, payload? (overrides compressed bytes) }
// opts: { forceZip64 } masks CD sizes/offsets with 0xffffffff and emits the
// zip64 extra field, zip64 EOCD record, and locator.
function buildZip(entries, opts = {}) {
  const parts = [];
  const layout = { entries: {} };
  let offset = 0;
  const central = [];

  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, 'utf-8');
    const payload =
      e.payload ?? (e.method === 8 ? deflateRawSync(e.data) : Buffer.from(e.data));
    const crc = e.encrypted ? 0xdeadbeef : crc32(e.data) >>> 0;
    const flags = e.encrypted ? 0x0001 : 0;
    const localHeaderOffset = offset;

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(e.method), u32(0),
      u32(crc), u32(payload.length), u32(e.data.length),
      u16(nameBytes.length), u16(0), nameBytes,
    ]);
    parts.push(local, payload);
    offset += local.length + payload.length;

    layout.entries[e.name] = {
      start: localHeaderOffset,
      end: localHeaderOffset + local.length + payload.length,
    };

    const zip64 = opts.forceZip64 && !e.encrypted;
    const extra = zip64
      ? Buffer.concat([u16(0x0001), u16(24), u64(e.data.length), u64(payload.length), u64(localHeaderOffset)])
      : Buffer.alloc(0);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(zip64 ? 45 : 20), u16(flags), u16(e.method), u32(0),
        u32(crc),
        u32(zip64 ? 0xffffffff : payload.length),
        u32(zip64 ? 0xffffffff : e.data.length),
        u16(nameBytes.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0),
        u32(zip64 ? 0xffffffff : localHeaderOffset),
        nameBytes, extra,
      ]),
    );
  }

  const cdOffset = offset;
  const cd = Buffer.concat(central);
  parts.push(cd);
  offset += cd.length;
  layout.cdOffset = cdOffset;
  layout.cdSize = cd.length;

  if (opts.forceZip64) {
    const zip64Eocd = Buffer.concat([
      u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
      u64(entries.length), u64(entries.length), u64(cd.length), u64(cdOffset),
    ]);
    const locator = Buffer.concat([u32(0x07064b50), u32(0), u64(offset), u32(1)]);
    parts.push(zip64Eocd, locator);
    offset += zip64Eocd.length + locator.length;
    parts.push(
      Buffer.concat([
        u32(0x06054b50), u16(0), u16(0), u16(0xffff), u16(0xffff),
        u32(0xffffffff), u32(0xffffffff), u16(0),
      ]),
    );
    offset += 22;
  } else {
    parts.push(
      Buffer.concat([
        u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
        u32(cd.length), u32(cdOffset), u16(0),
      ]),
    );
    offset += 22;
  }

  layout.size = offset;
  return { bytes: Buffer.concat(parts), layout };
}

writeFileSync(
  join(outDir, 'node-stored.zip'),
  buildZip([
    { name: 'alpha.txt', data: alpha, method: 0 },
    { name: 'data.bin', data: dataBin, method: 0 },
  ]).bytes,
);

writeFileSync(
  join(outDir, 'node-zip64.zip'),
  buildZip(
    [
      { name: 'alpha.txt', data: alpha, method: 8 },
      { name: 'lorem.txt', data: lorem, method: 8 },
    ],
    { forceZip64: true },
  ).bytes,
);

const fakeEncryptedPayload = Buffer.alloc(44);
for (let i = 0; i < fakeEncryptedPayload.length; i++) fakeEncryptedPayload[i] = (i * 37 + 11) & 0xff;
writeFileSync(
  join(outDir, 'node-mixed.zip'),
  buildZip([
    { name: 'alpha.txt', data: alpha, method: 8 },
    { name: 'data.bin', data: dataBin, method: 0 },
    { name: 'secret.txt', data: Buffer.alloc(32), method: 8, encrypted: true, payload: fakeEncryptedPayload },
    { name: 'weird.bin', data: dataBin, method: 12, payload: Buffer.from(dataBin) },
  ]).bytes,
);

const pad = Buffer.alloc(4096);
for (let i = 0; i < pad.length; i++) pad[i] = (i * 131 + 17) & 0xff;
const range = buildZip([
  { name: 'alpha.txt', data: alpha, method: 8 },
  { name: 'pad.bin', data: pad, method: 0 },
  { name: 'lorem.txt', data: lorem, method: 8 },
]);
writeFileSync(join(outDir, 'node-range.zip'), range.bytes);
writeFileSync(join(outDir, 'node-range.manifest.json'), JSON.stringify(range.layout, null, 2) + '\n');

console.log('fixtures written to', outDir);
