import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  openZip,
  ZipEncryptedEntryError,
  ZipEntryNotFoundError,
  ZipFormatError,
  ZipUnsupportedMethodError,
} from '../src/zip/index.ts';

const fixturesDir = new URL('./fixtures/zip/', import.meta.url);

function toBytes(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function fixture(name: string): Promise<Uint8Array> {
  return toBytes(await readFile(new URL(name, fixturesDir)));
}

async function content(name: string): Promise<Uint8Array> {
  return toBytes(await readFile(new URL(`content/${name}`, fixturesDir)));
}

async function assertRoundTrip(zipName: string, entryNames: string[]): Promise<void> {
  const zip = await openZip(await fixture(zipName));
  assert.deepEqual([...zip.entries.map((e) => e.name)].sort(), [...entryNames].sort());
  for (const entryName of entryNames) {
    assert.deepEqual(await zip.read(entryName), await content(entryName), `${zipName}:${entryName}`);
  }
}

test('Compress-Archive deflate fixture round-trips byte-for-byte', async () => {
  await assertRoundTrip('psh-deflate.zip', ['alpha.txt', 'lorem.txt', 'data.bin']);
});

test('bsdtar deflate fixture with data descriptors round-trips byte-for-byte', async () => {
  const raw = await fixture('tar-deflate-dd.zip');
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  assert.equal(dv.getUint16(6, true) & 0x0008, 0x0008, 'fixture must set the data-descriptor flag');
  assert.equal(dv.getUint32(18, true), 0, 'fixture must zero the local-header compressed size');
  assert.equal(dv.getUint32(22, true), 0, 'fixture must zero the local-header uncompressed size');
  await assertRoundTrip('tar-deflate-dd.zip', ['alpha.txt', 'lorem.txt', 'data.bin']);
});

test('bsdtar stored fixture with data descriptors round-trips byte-for-byte', async () => {
  const zip = await openZip(await fixture('tar-stored-dd.zip'));
  for (const entry of zip.entries) assert.equal(entry.method, 0);
  await assertRoundTrip('tar-stored-dd.zip', ['alpha.txt', 'lorem.txt', 'data.bin']);
});

test('stored entries are read without invoking inflate', async () => {
  const bytes = await fixture('node-stored.zip');
  const original = globalThis.DecompressionStream;
  Reflect.set(globalThis, 'DecompressionStream', function () {
    throw new Error('DecompressionStream must not be constructed for stored entries');
  });
  try {
    const zip = await openZip(bytes);
    for (const entry of zip.entries) assert.equal(entry.method, 0);
    assert.deepEqual(await zip.read('alpha.txt'), await content('alpha.txt'));
    assert.deepEqual(await zip.read('data.bin'), await content('data.bin'));
  } finally {
    Reflect.set(globalThis, 'DecompressionStream', original);
  }
});

test('zip64 fixture with masked fields and extended-information extras reads correctly', async () => {
  const raw = await fixture('node-zip64.zip');
  const sig = [0x50, 0x4b, 0x06, 0x06];
  assert.ok(
    Buffer.from(raw).includes(Buffer.from(sig)),
    'fixture must contain a zip64 EOCD record',
  );
  await assertRoundTrip('node-zip64.zip', ['alpha.txt', 'lorem.txt']);
});

test('bsdtar zip64 fixture (locator with unmasked classic EOCD) reads correctly', async () => {
  const raw = await fixture('tar-zip64.zip');
  assert.ok(Buffer.from(raw).includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])));
  await assertRoundTrip('tar-zip64.zip', ['alpha.txt', 'lorem.txt']);
});

test('encrypted entries list but reject with the typed error', async () => {
  const zip = await openZip(await fixture('tar-encrypted.zip'));
  assert.deepEqual(
    zip.entries.map((e) => e.name),
    ['alpha.txt'],
  );
  assert.equal(zip.entry('alpha.txt')?.encrypted, true);
  await assert.rejects(zip.read('alpha.txt'), ZipEncryptedEntryError);
});

test('mixed archive: plain entries read, encrypted and unsupported methods reject typed', async () => {
  const zip = await openZip(await fixture('node-mixed.zip'));
  assert.deepEqual(await zip.read('alpha.txt'), await content('alpha.txt'));
  assert.deepEqual(await zip.read('data.bin'), await content('data.bin'));
  await assert.rejects(zip.read('secret.txt'), (err: unknown) => {
    assert.ok(err instanceof ZipEncryptedEntryError);
    assert.equal((err as Error).name, 'ZipEncryptedEntryError');
    return true;
  });
  await assert.rejects(zip.read('weird.bin'), ZipUnsupportedMethodError);
  await assert.rejects(zip.read('missing.txt'), ZipEntryNotFoundError);
});

test('non-zip and truncated inputs reject with the typed format error', async () => {
  await assert.rejects(openZip(new Uint8Array(100).fill(0x41)), ZipFormatError);
  await assert.rejects(openZip(new Uint8Array(4)), ZipFormatError);
});

test('ArrayBuffer and Blob inputs normalize to the same result', async () => {
  const bytes = await fixture('psh-deflate.zip');
  const arrayBuffer = bytes.slice().buffer;
  const expected = await content('alpha.txt');

  const fromArrayBuffer = await openZip(arrayBuffer);
  assert.deepEqual(await fromArrayBuffer.read('alpha.txt'), expected);

  const fromBlob = await openZip(new Blob([bytes.slice()]));
  assert.deepEqual(await fromBlob.read('alpha.txt'), expected);
});

interface RangeManifest {
  entries: Record<string, { start: number; end: number }>;
  cdOffset: number;
  cdSize: number;
  size: number;
}

test('range reader touches only the byte ranges it needs', async () => {
  const bytes = await fixture('node-range.zip');
  const manifest = JSON.parse(
    await readFile(new URL('node-range.manifest.json', fixturesDir), 'utf-8'),
  ) as RangeManifest;
  assert.equal(manifest.size, bytes.byteLength);

  const calls: Array<{ offset: number; length: number }> = [];
  const zip = await openZip({
    size: bytes.byteLength,
    read: (offset, length) => {
      calls.push({ offset, length });
      return Promise.resolve(bytes.subarray(offset, offset + length));
    },
  });

  const tailStart = manifest.size - 1024;
  const inCd = (c: { offset: number; length: number }) =>
    c.offset >= manifest.cdOffset && c.offset + c.length <= manifest.cdOffset + manifest.cdSize;
  for (const call of calls) {
    assert.ok(call.offset >= tailStart || inCd(call), `open read outside tail/central directory: ${JSON.stringify(call)}`);
  }

  const openCallCount = calls.length;
  const alpha = manifest.entries['alpha.txt'];
  const pad = manifest.entries['pad.bin'];
  assert.ok(alpha && pad);

  const result = await zip.read('alpha.txt');
  assert.deepEqual(result, await content('alpha.txt'));

  const entryCalls = calls.slice(openCallCount);
  assert.ok(entryCalls.length > 0);
  for (const call of entryCalls) {
    assert.ok(
      call.offset >= alpha.start && call.offset + call.length <= alpha.end,
      `entry read outside its local header + data: ${JSON.stringify(call)}`,
    );
  }

  for (const call of calls) {
    assert.notEqual(call.length, manifest.size, 'whole-file read');
  }
  for (const call of entryCalls) {
    const overlapsPad: boolean = call.offset < pad.end && call.offset + call.length > pad.start;
    assert.ok(!overlapsPad, `entry read overlaps an unrequested entry: ${JSON.stringify(call)}`);
  }

  const touched = new Set<number>();
  for (const call of calls) {
    for (let i = call.offset; i < call.offset + call.length; i++) touched.add(i);
  }
  assert.ok(touched.size < manifest.size, 'reads covered the whole file');
});
