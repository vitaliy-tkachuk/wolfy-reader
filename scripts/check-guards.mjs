import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloads } from './fetch-corpus.mjs';

// The consuming application's vocabulary, and the only place in the repo where
// these words are written out. A doc that spelled them would be flagged by the
// guard it documents, so `docs/` refers to this list rather than repeating it.
const CONSUMER_TERMS = ['vault', 'secondbrain', 'telegram'];

// `bench/fixtures/` is generated from corpus prose and is gitignored, so it stays
// outside the scan the same way `test/corpus/` is carved out of it.
const SCANNED_DIRS = ['src', 'demo', 'test'];
const SKIPPED_DIRS = ['test/corpus'];

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.xhtml',
  '.xml',
  '.opf',
  '.ncx',
  '.css',
  '.svg',
  '.md',
  '.txt',
  '.fb2',
]);

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found === undefined ? undefined : found.slice(prefix.length);
}

const rootArg = argValue('root');
const repoRoot =
  rootArg === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(rootArg);

let failures = 0;

function fail(message) {
  console.error(`✗ ${message}`);
  failures += 1;
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function label(absolute) {
  return relative(repoRoot, absolute).split(sep).join('/');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function checkDependencies() {
  const manifestPath = join(repoRoot, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot read package.json: ${error.message}`);
    return;
  }

  const deps = Object.keys(manifest.dependencies ?? {});
  if (deps.length > 0) {
    fail(`dependencies must stay empty permanently, found: ${deps.join(', ')}`);
    return;
  }
  pass('dependencies is empty');
}

async function* textFilesIn(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (SKIPPED_DIRS.includes(label(path))) continue;
    if (entry.isDirectory()) {
      yield* textFilesIn(path);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    if (dot > 0 && TEXT_EXTENSIONS.has(entry.name.slice(dot))) yield path;
  }
}

// The library must carry no knowledge of any application that consumes it. This is
// a grep rather than a review step because the vocabulary leaks in through a
// convenience name months after anyone remembers the rule.
async function checkVocabulary() {
  let scanned = 0;
  const before = failures;

  for (const dir of SCANNED_DIRS) {
    for await (const path of textFilesIn(join(repoRoot, dir))) {
      scanned += 1;
      const lines = (await readFile(path, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        const lowered = line.toLowerCase();
        for (const term of CONSUMER_TERMS) {
          if (lowered.includes(term)) {
            fail(`consumer vocabulary "${term}" in ${label(path)}:${index + 1}`);
          }
        }
      });
    }
  }

  if (failures === before) {
    pass(`no consumer vocabulary in ${SCANNED_DIRS.join('/, ')}/ (${scanned} files scanned)`);
  }
}

// Every corpus test skips gracefully when the download is absent — right for a
// fresh clone, fatal in CI, where a failed fetch would leave the differential
// suite reporting green having compared nothing.
async function checkCorpus() {
  const corpusDir = join(repoRoot, 'test', 'corpus');
  const missing = [];
  for (const { file } of downloads) {
    if (!(await exists(join(corpusDir, file)))) missing.push(file);
  }

  if (missing.length > 0) {
    const sample = missing.slice(0, 3).join(', ');
    fail(
      `corpus incomplete — ${missing.length}/${downloads.length} file(s) missing ` +
        `(e.g. ${sample}). Run npm run fetch-corpus.`,
    );
    return;
  }
  pass(`corpus complete — all ${downloads.length} files present`);
}

async function main() {
  await checkDependencies();
  await checkVocabulary();
  if (process.argv.includes('--require-corpus')) await checkCorpus();

  if (failures > 0) {
    console.error(`\nguards failed — ${failures} violation(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('\nguards ok');
}

// Imported by nothing today, but the direct-execution guard is the house rule: a
// script in this folder never acts as a side effect of being loaded.
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
