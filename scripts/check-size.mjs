import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';

import { entryFiles } from './banner.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));

// Gzipped bytes of each subpath bundled and minified — what a consumer's build
// actually ships, not what sits in dist. The budgets are measured values rounded
// up for headroom: loose enough that honest growth does not redden main, tight
// enough that an accidental import across a layer boundary does. Raising one is a
// decision with a reason, which is why they live in source and not in a lockfile.
const BUDGETS = {
  '.': 38_000,
  './core': 3_000,
  './epub': 8_250,
  './fb2': 4_750,
  './text': 1_750,
};

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found === undefined ? undefined : found.slice(prefix.length);
}

let failures = 0;

function fail(message) {
  console.error(`✗ ${message}`);
  failures += 1;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// esbuild's default target drifts with its version, which would move every number
// here for reasons that have nothing to do with the library. Pinning it to the
// tsconfig target keeps a budget comparable across upgrades.
async function measure(entry) {
  const bundled = await build({
    entryPoints: [join(repoRoot, entry)],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const minified = Buffer.from(bundled.outputFiles[0].contents);
  return { minified: minified.byteLength, gzip: gzipSync(minified).byteLength };
}

function pad(value, width) {
  return String(value).padStart(width);
}

async function main() {
  if (!(await exists(join(repoRoot, 'dist')))) {
    console.log('check:size skipped — dist/ is absent (npm run build first)');
    return;
  }

  const budgetsPath = argValue('budgets');
  const budgets =
    budgetsPath === undefined
      ? BUDGETS
      : JSON.parse(await readFile(resolve(budgetsPath), 'utf8'));

  // `banner.mjs` owns what counts as a subpath entry; the specifier is recovered
  // from the same map so a new subpath cannot appear without a budget.
  const entries = entryFiles(manifest.exports);
  const specifierOf = new Map(
    Object.entries(manifest.exports)
      .filter(([, target]) => typeof target === 'object' && target !== null)
      .map(([specifier, target]) => [target.default, specifier]),
  );

  console.log('subpath      minified      gzip    budget   used');
  for (const entry of entries) {
    const specifier = specifierOf.get(entry);
    const { minified, gzip } = await measure(entry);
    const budget = budgets[specifier];

    if (budget === undefined) {
      fail(`no budget for ${specifier} — measured ${gzip} gzipped bytes, add it to check-size.mjs`);
      continue;
    }

    const used = Math.round((gzip / budget) * 100);
    console.log(
      `${specifier.padEnd(10)} ${pad(minified, 9)} ${pad(gzip, 9)} ${pad(budget, 9)} ${pad(`${used}%`, 6)}`,
    );
    if (gzip > budget) {
      fail(`${specifier} is ${gzip - budget} gzipped bytes over its ${budget} byte budget`);
    }
  }

  if (failures > 0) {
    console.error(`\nsize budget exceeded — ${failures} subpath(s) over`);
    process.exitCode = 1;
    return;
  }
  console.log('\nsize budget ok');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
