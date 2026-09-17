import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BookError,
  CorruptContainerError,
  EncryptedContentError,
  UnrecognizedFormatError,
  open,
} from '../src/core/index.ts';
import type {
  Book,
  BookFormat,
  BookInput,
  StorageAdapter,
  TocItem,
} from '../src/core/index.ts';

const MAGIC = 'stub1:';

interface StubTocItem {
  label: string;
  sectionId: string;
  fragment?: string;
  children: StubTocItem[];
}

interface StubPayload {
  title: string;
  author: string;
  language: string;
  cover: { mediaType: string; data: number[] };
  toc: StubTocItem[];
  sections: { id: string; mediaType: string; text: string }[];
  resources: Record<string, { mediaType: string; data: number[] }>;
}

const stubFormat: BookFormat = {
  name: 'stub',
  async sniff(source) {
    const head = await source.read(0, MAGIC.length);
    return new TextDecoder().decode(head) === MAGIC;
  },
  async decode(source) {
    const text = new TextDecoder().decode(await source.bytes());
    const payload = JSON.parse(text.slice(MAGIC.length)) as StubPayload;
    return makeBook(payload);
  },
};

function makeBook(payload: StubPayload): Book {
  const sections = payload.sections.map((s) => ({
    id: s.id,
    mediaType: s.mediaType,
    load: async () => new TextEncoder().encode(s.text),
  }));
  const resources = new Map(
    Object.entries(payload.resources).map(([id, r]) => [
      id,
      { mediaType: r.mediaType, load: async () => Uint8Array.from(r.data) },
    ]),
  );
  return {
    metadata: {
      title: payload.title,
      author: payload.author,
      language: payload.language,
      cover: {
        mediaType: payload.cover.mediaType,
        load: async () => Uint8Array.from(payload.cover.data),
      },
    },
    toc: payload.toc.map(toTocItem),
    sections,
    section: (id) => sections.find((s) => s.id === id),
    resources,
  };
}

function toTocItem(item: StubTocItem): TocItem {
  return {
    label: item.label,
    sectionId: item.sectionId,
    ...(item.fragment === undefined ? {} : { fragment: item.fragment }),
    children: item.children.map(toTocItem),
  };
}

const payload: StubPayload = {
  title: 'The Stub Book',
  author: 'A. Stub',
  language: 'en',
  cover: { mediaType: 'image/png', data: [137, 80, 78, 71] },
  toc: [
    {
      label: 'One',
      sectionId: 's1',
      children: [{ label: 'One.a', sectionId: 's1', fragment: 'a', children: [] }],
    },
    { label: 'Two', sectionId: 's2', children: [] },
  ],
  sections: [
    { id: 's1', mediaType: 'text/plain', text: 'first section text' },
    { id: 's2', mediaType: 'text/plain', text: 'second section text' },
  ],
  resources: { 'img-1': { mediaType: 'image/png', data: [1, 2, 3, 4] } },
};

const stubBytes = new TextEncoder().encode(MAGIC + JSON.stringify(payload));

const inputShapes: Record<string, () => BookInput> = {
  ArrayBuffer: () => stubBytes.buffer,
  Blob: () => new Blob([stubBytes]),
  File: () => new File([stubBytes], 'stub.bin'),
  RangeReader: () => ({
    size: stubBytes.byteLength,
    read: async (offset, length) => stubBytes.subarray(offset, offset + length),
  }),
};

for (const [shape, makeInput] of Object.entries(inputShapes)) {
  test(`open round-trips the stub book from ${shape}`, async () => {
    const book = await open(makeInput(), { formats: [stubFormat] });

    assert.equal(book.metadata.title, 'The Stub Book');
    assert.equal(book.metadata.author, 'A. Stub');
    assert.equal(book.metadata.language, 'en');
    assert.ok(book.metadata.cover);
    assert.equal(book.metadata.cover.mediaType, 'image/png');
    assert.deepEqual(await book.metadata.cover.load(), Uint8Array.from([137, 80, 78, 71]));

    assert.deepEqual(book.toc, [
      {
        label: 'One',
        sectionId: 's1',
        children: [{ label: 'One.a', sectionId: 's1', fragment: 'a', children: [] }],
      },
      { label: 'Two', sectionId: 's2', children: [] },
    ]);

    assert.deepEqual(
      book.sections.map((s) => s.id),
      ['s1', 's2'],
    );
    const [first, second] = book.sections;
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.mediaType, 'text/plain');
    assert.equal(new TextDecoder().decode(await first.load()), 'first section text');
    assert.equal(new TextDecoder().decode(await second.load()), 'second section text');
    assert.equal(book.section('s2'), second);
    assert.equal(book.section('missing'), undefined);

    const image = book.resources.get('img-1');
    assert.ok(image);
    assert.equal(image.mediaType, 'image/png');
    assert.deepEqual(await image.load(), Uint8Array.from([1, 2, 3, 4]));
  });
}

test('open rejects with UnrecognizedFormatError when no format claims the input', async () => {
  const input = new TextEncoder().encode('not a book').buffer;
  await assert.rejects(
    open(input, { formats: [stubFormat] }),
    (error: unknown) =>
      error instanceof UnrecognizedFormatError && error instanceof BookError,
  );
});

test('open rejects with UnrecognizedFormatError when no format is registered', async () => {
  await assert.rejects(open(stubBytes.buffer, { formats: [] }), UnrecognizedFormatError);
});

test('open surfaces CorruptContainerError thrown by a decoder', async () => {
  const corrupt: BookFormat = {
    name: 'corrupt',
    sniff: () => true,
    decode: async () => {
      throw new CorruptContainerError('central directory is damaged');
    },
  };
  await assert.rejects(
    open(stubBytes.buffer, { formats: [corrupt] }),
    (error: unknown) =>
      error instanceof CorruptContainerError &&
      error.message === 'central directory is damaged',
  );
});

test('open surfaces EncryptedContentError thrown by a decoder', async () => {
  const encrypted: BookFormat = {
    name: 'encrypted',
    sniff: () => true,
    decode: async () => {
      throw new EncryptedContentError('content is encrypted');
    },
  };
  await assert.rejects(
    open(stubBytes.buffer, { formats: [encrypted] }),
    (error: unknown) =>
      error instanceof EncryptedContentError && error instanceof BookError,
  );
});

test('open wraps a non-BookError decode failure in CorruptContainerError with cause', async () => {
  const failure = new Error('boom');
  const broken: BookFormat = {
    name: 'broken',
    sniff: () => true,
    decode: async () => {
      throw failure;
    },
  };
  await assert.rejects(
    open(stubBytes.buffer, { formats: [broken] }),
    (error: unknown) => error instanceof CorruptContainerError && error.cause === failure,
  );
});

test('open wraps a non-BookError sniff failure in CorruptContainerError with cause', async () => {
  const failure = new Error('network down');
  let decoded = false;
  const sniffing: BookFormat = {
    name: 'sniffing',
    sniff: async (source) => new TextDecoder().decode(await source.read(0, 4)) === 'stub',
    decode: async () => {
      throw new Error('must not decode');
    },
  };
  const later: BookFormat = {
    name: 'later',
    sniff: () => true,
    decode: async (source, context) => {
      decoded = true;
      return stubFormat.decode(source, context);
    },
  };
  const hostileReader: BookInput = {
    size: stubBytes.byteLength,
    read: () => Promise.reject(failure),
  };
  await assert.rejects(
    open(hostileReader, { formats: [sniffing, later] }),
    (error: unknown) => error instanceof CorruptContainerError && error.cause === failure,
  );
  assert.equal(decoded, false, 'a throwing sniffer must not fall through to the next format');
});

test('open surfaces a BookError thrown by a sniffer unchanged', async () => {
  const refusing: BookFormat = {
    name: 'refusing',
    sniff: () => {
      throw new EncryptedContentError('content is encrypted');
    },
    decode: async () => {
      throw new Error('must not decode');
    },
  };
  await assert.rejects(
    open(stubBytes.buffer, { formats: [refusing] }),
    (error: unknown) =>
      error instanceof EncryptedContentError && error.message === 'content is encrypted',
  );
});

test('the first format that claims the input wins', async () => {
  let secondDecoded = false;
  const second: BookFormat = {
    name: 'second',
    sniff: () => true,
    decode: async (source, context) => {
      secondDecoded = true;
      return stubFormat.decode(source, context);
    },
  };
  const book = await open(stubBytes.buffer, { formats: [stubFormat, second] });
  assert.equal(book.metadata.title, 'The Stub Book');
  assert.equal(secondDecoded, false);
});

test('a format that does not claim the input is skipped', async () => {
  const never: BookFormat = {
    name: 'never',
    sniff: () => false,
    decode: async () => {
      throw new Error('must not decode');
    },
  };
  const book = await open(stubBytes.buffer, { formats: [never, stubFormat] });
  assert.equal(book.metadata.title, 'The Stub Book');
});

test('open passes the host StorageAdapter through to the decoder context', async () => {
  const calls: string[] = [];
  const storage: StorageAdapter = {
    get: async (key) => {
      calls.push(`get ${key}`);
      return undefined;
    },
    set: async (key) => {
      calls.push(`set ${key}`);
    },
    delete: async (key) => {
      calls.push(`delete ${key}`);
    },
  };
  const caching: BookFormat = {
    name: 'caching',
    sniff: () => true,
    decode: async (source, context) => {
      await context.storage?.get('k');
      await context.storage?.set('k', Uint8Array.from([1]));
      return stubFormat.decode(source, context);
    },
  };
  await open(stubBytes.buffer, { formats: [caching], storage });
  assert.deepEqual(calls, ['get k', 'set k']);
});

test('open rejects a value that is none of the four input shapes', async () => {
  await assert.rejects(open(42 as never, { formats: [stubFormat] }), TypeError);
});
