import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const scriptsDir = join(repoRoot, 'scripts');
const distBuilt = existsSync(join(repoRoot, 'dist'));

// The guards are `.mjs` and the tsconfig has no `allowJs`, so a static import
// would want a declaration file. A computed specifier is not resolved by tsc and
// loads the real module at runtime, which is what this needs — the corpus
// manifest must come from the script that downloads it, never a second copy.
const corpusManifest = (await import(
  new URL('../scripts/fetch-corpus.mjs', import.meta.url).href
)) as { downloads: readonly { file: string }[] };

// Assembled from fragments so this file does not itself carry a term the guard
// scans `test/` for. `scripts/check-guards.mjs` is the only place in the repo
// where the consuming application's vocabulary is written out.
const consumerTerm = ['vau', 'lt'].join('');

interface GuardRun {
  status: number;
  output: string;
}

function runGuard(script: string, args: readonly string[]): GuardRun {
  const result = spawnSync(process.execPath, [join(scriptsDir, script), ...args], {
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'wolfy-reader-guards-'));
  try {
    await run(workspace);
  } catch (error) {
    console.error(`fixture workspace kept for inspection: ${workspace}`);
    throw error;
  }
  await rm(workspace, { recursive: true, force: true });
}

async function writeManifest(root: string, dependencies: Record<string, string>): Promise<void> {
  const manifest = { name: 'guard-fixture', version: '0.0.0', private: true, dependencies };
  await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeSource(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function subpathSpecifiers(): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  return Object.entries(manifest.exports)
    .filter(([, target]) => typeof target === 'object' && target !== null)
    .map(([specifier]) => specifier);
}

test('the dependency guard fails on a non-empty dependencies map', async () => {
  await withWorkspace(async (root) => {
    await writeManifest(root, { 'left-pad': '^1.3.0' });

    const { status, output } = runGuard('check-guards.mjs', [`--root=${root}`]);
    assert.equal(status, 1);
    assert.match(output, /dependencies must stay empty/);
    assert.match(output, /left-pad/);
  });
});

test('the vocabulary guard names the file, line and term', async () => {
  await withWorkspace(async (root) => {
    await writeManifest(root, {});
    await writeSource(root, 'src/store.ts', `export const label = 'open the ${consumerTerm}';\n`);

    const { status, output } = runGuard('check-guards.mjs', [`--root=${root}`]);
    assert.equal(status, 1);
    assert.match(output, /src\/store\.ts:1/);
    assert.ok(output.includes(consumerTerm), 'the offending term is quoted back');
  });
});

// The corpus is real books, and real books use the words. A guard that failed on
// the prose it exists to protect would be switched off within a week.
test('the vocabulary guard ignores the downloaded corpus', async () => {
  await withWorkspace(async (root) => {
    await writeManifest(root, {});
    await writeSource(
      root,
      'test/corpus/gutenberg-sherlock-holmes.txt',
      `He had sent a ${consumerTerm} that morning.\n`,
    );

    const { status, output } = runGuard('check-guards.mjs', [`--root=${root}`]);
    assert.equal(status, 0, output);
  });
});

test('every violation is reported in one run, not only the first', async () => {
  await withWorkspace(async (root) => {
    await writeManifest(root, { 'left-pad': '^1.3.0' });
    await writeSource(root, 'src/store.ts', `export const a = '${consumerTerm}';\n`);
    await writeSource(root, 'demo/panel.ts', `export const b = '${consumerTerm}';\n`);

    const { status, output } = runGuard('check-guards.mjs', [`--root=${root}`]);
    assert.equal(status, 1);
    assert.match(output, /src\/store\.ts:1/);
    assert.match(output, /demo\/panel\.ts:1/);
    assert.match(output, /3 violation\(s\)/);
  });
});

test('the corpus guard fails when the download is incomplete', async () => {
  await withWorkspace(async (root) => {
    await writeManifest(root, {});

    const absent = runGuard('check-guards.mjs', [`--root=${root}`, '--require-corpus']);
    assert.equal(absent.status, 1);
    assert.match(absent.output, /corpus incomplete/);

    // Without the flag a missing corpus is not a violation: a fresh clone runs the
    // guards green before downloading 31MB of third-party books.
    const optional = runGuard('check-guards.mjs', [`--root=${root}`]);
    assert.equal(optional.status, 0, optional.output);

    for (const { file } of corpusManifest.downloads) {
      await writeSource(root, join('test', 'corpus', file), '');
    }
    const complete = runGuard('check-guards.mjs', [`--root=${root}`, '--require-corpus']);
    assert.equal(complete.status, 0, complete.output);
    assert.match(complete.output, /corpus complete/);
  });
});

test('the headless-core guard fails on a core module reaching the view', async () => {
  await withWorkspace(async (root) => {
    await writeSource(root, 'src/core/index.ts', "export * from './book.ts';\n");
    await writeSource(root, 'src/core/book.ts', "import '../view/index.ts';\nexport const book = 1;\n");
    await writeSource(root, 'src/view/index.ts', 'export const view = 1;\n');

    const { status, output } = runGuard('check-core-purity.mjs', [`--root=${root}`]);
    assert.equal(status, 1);
    assert.match(output, /src\/view is not reachable from the headless core/);
    assert.match(output, /src\/core\/book\.ts/, 'the chain names the edge to cut');
  });
});

test('the headless-core guard passes on a core that reaches neither layer', async () => {
  await withWorkspace(async (root) => {
    await writeSource(root, 'src/core/index.ts', "export * from './book.ts';\n");
    await writeSource(root, 'src/core/book.ts', 'export const book = 1;\n');

    const { status, output } = runGuard('check-core-purity.mjs', [`--root=${root}`]);
    assert.equal(status, 0, output);
  });
});

test(
  'the size guard fails when a subpath exceeds its budget',
  { skip: distBuilt ? false : 'dist/ not built (npm run build)' },
  async () => {
    await withWorkspace(async (root) => {
      const budgets = Object.fromEntries((await subpathSpecifiers()).map((key) => [key, 1]));
      const budgetsPath = join(root, 'budgets.json');
      await writeFile(budgetsPath, `${JSON.stringify(budgets)}\n`);

      const { status, output } = runGuard('check-size.mjs', [`--budgets=${budgetsPath}`]);
      assert.equal(status, 1);
      assert.match(output, /over its 1 byte budget/);
    });
  },
);

test(
  'every published subpath is inside its budget today',
  { skip: distBuilt ? false : 'dist/ not built (npm run build)' },
  () => {
    const { status, output } = runGuard('check-size.mjs', []);
    assert.equal(status, 0, output);
    assert.match(output, /size budget ok/);
  },
);

test('the pack check refuses a registry version that does not exist', () => {
  // The post-publish smoke job asserts the *published* artifact is consumable.
  // If a bad `--from-registry` target quietly fell back to the local tarball, that
  // job would pass while proving nothing about what npm actually serves.
  const { status, output } = runGuard('check-pack.mjs', [
    '--from-registry=0.0.0-does-not-exist',
  ]);
  assert.equal(status, 1, output);
  assert.match(output, /0\.0\.0-does-not-exist/);
});
