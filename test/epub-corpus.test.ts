import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { open } from '../src/core/index.ts';
import { epub } from '../src/formats/epub/index.ts';

const corpusDir = new URL('./corpus/', import.meta.url);

let corpusEpubs: string[] = [];
try {
  corpusEpubs = (await readdir(corpusDir)).filter((name) => name.endsWith('.epub')).sort();
} catch {
  // Corpus is gitignored; absent means "skip", never "fail".
}

test('corpus books decode to Books with metadata and a spine', { skip: corpusEpubs.length === 0 && 'corpus not downloaded (npm run fetch-corpus)' }, async () => {
  for (const name of corpusEpubs) {
    const bytes = await readFile(new URL(name, corpusDir));
    const book = await open(new Uint8Array(bytes).buffer, { formats: [epub] });
    assert.ok(book.metadata.title, `${name}: title is present and non-empty`);
    assert.ok(book.metadata.language, `${name}: language is present and non-empty`);
    assert.ok(book.sections.length > 0, `${name}: spine is non-empty`);
    for (const section of book.sections) {
      assert.ok(section.id, `${name}: every section has an id`);
    }
    console.log(
      `${fileURLToPath(new URL(name, corpusDir))}: "${book.metadata.title ?? ''}" — ${book.sections.length} sections, cover ${book.metadata.cover ? 'yes' : 'no'}`,
    );
  }
});
