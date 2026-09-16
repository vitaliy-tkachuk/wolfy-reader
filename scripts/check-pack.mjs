import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { attribution, banner, entryFiles } from './banner.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
const tsc = resolve(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

// One table drives the runtime probe, the type probe and the banner check, so a new
// subpath cannot be added to `exports` and silently go untested.
const SUBPATHS = [
  { specifier: '.', values: ['open', 'render', 'parsePosition', 'BookError'] },
  { specifier: './core', values: ['open', 'parsePosition', 'segmentSentences', 'BookError'] },
  { specifier: './epub', values: ['epub'], format: 'epub' },
  { specifier: './fb2', values: ['fb2'], format: 'fb2' },
  { specifier: './text', values: ['text'], format: 'text' },
];

// Paths a consumer might reasonably reach for and must not get. The exports map is
// the only thing enforcing public-vs-internal at runtime, so its refusals are as
// load-bearing as its resolutions.
const REFUSED = [
  'wolfy-reader/dist/view/host.js',
  'wolfy-reader/dist/core/index.js',
  'wolfy-reader/src/core/index.ts',
  'wolfy-reader/formats',
];

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function checkManifest() {
  const deps = Object.keys(manifest.dependencies ?? {});
  if (deps.length > 0) fail(`dependencies must stay empty, found: ${deps.join(', ')}`);
  else pass('dependencies is empty');

  const declared = Object.keys(manifest.exports);
  const expected = [...SUBPATHS.map((entry) => entry.specifier), './package.json'];
  const undeclared = declared.filter((key) => !expected.includes(key));
  if (undeclared.length > 0) fail(`exports has untested subpaths: ${undeclared.join(', ')}`);

  const wildcards = declared.filter((key) => key.includes('*'));
  if (wildcards.length > 0) fail(`exports must not use wildcards, found: ${wildcards.join(', ')}`);
  else pass(`exports declares ${declared.length} keys, none wildcarded`);
}

function probeSource() {
  const imports = SUBPATHS.map(({ specifier, values, format }) => {
    const bare = specifier === '.' ? 'wolfy-reader' : `wolfy-reader/${specifier.slice(2)}`;
    return `  ['${bare}', ${JSON.stringify(values)}, ${JSON.stringify(format ?? null)}],`;
  }).join('\n');

  return `import assert from 'node:assert/strict';

// The library must import on a runtime with no DOM whatsoever; a probe that ran with
// a shim installed would prove nothing.
assert.equal(globalThis.document, undefined, 'probe precondition: no document');
assert.equal(globalThis.window, undefined, 'probe precondition: no window');

const subpaths = [
${imports}
];

const loaded = new Map();
for (const [specifier, values, format] of subpaths) {
  const module = await import(specifier);
  loaded.set(specifier, module);
  for (const value of values) {
    assert.notEqual(module[value], undefined, \`\${specifier} must export \${value}\`);
  }
  if (format === null) continue;
  const decoder = module[format];
  assert.equal(decoder.name, format, \`\${specifier} must expose the \${format} BookFormat\`);
  assert.equal(typeof decoder.sniff, 'function', \`\${format}.sniff must be callable\`);
  assert.equal(typeof decoder.decode, 'function', \`\${format}.decode must be callable\`);
}

assert.equal(globalThis.document, undefined, 'importing must not install a DOM shim');

// Two entries resolving to two module instances would break \`instanceof BookError\`,
// which is how every consumer is told to catch.
const root = loaded.get('wolfy-reader');
const core = loaded.get('wolfy-reader/core');
assert.equal(root.BookError, core.BookError, 'BookError must be one constructor across entries');
assert.equal(root.open, core.open, 'open must be one binding across entries');

for (const specifier of ${JSON.stringify(REFUSED)}) {
  await assert.rejects(
    () => import(specifier),
    /ERR_PACKAGE_PATH_NOT_EXPORTED/,
    \`\${specifier} must be refused by the exports map\`,
  );
}

await import.meta.resolve('wolfy-reader/package.json');

console.log('runtime probe ok');
`;
}

// A runtime import cannot catch a broken `.d.ts`: the emitted declarations keep their
// `.ts` specifiers (correct under `rewriteRelativeImportExtensions`) while the
// emitted JS gets `.js`, so only a real typecheck exercises that resolution.
const TYPE_PROBE = `import { open, render, BookError } from 'wolfy-reader';
import type { Book, Position, Reader, ReaderPosition, SentenceRange } from 'wolfy-reader';
import { open as coreOpen, parsePosition } from 'wolfy-reader/core';
import type { BookFormat, TocItem } from 'wolfy-reader/core';
import { epub } from 'wolfy-reader/epub';
import { fb2 } from 'wolfy-reader/fb2';
import { text } from 'wolfy-reader/text';

const formats: readonly BookFormat[] = [epub, fb2, text];

export async function probe(bytes: ArrayBuffer, element: HTMLElement): Promise<void> {
  const book: Book = await open(bytes, { formats });
  const viaCore: Book = await coreOpen(bytes, { formats });
  const toc: readonly TocItem[] = viaCore.toc;

  const reader: Reader = render(book, element, { mode: 'paginated' });
  const where: ReaderPosition = reader.position;
  const sentences: readonly SentenceRange[] = await reader.sentences();

  // A type named through the root must be the same type named through /core, or the
  // two entries have produced parallel declarations.
  const anchor: Position = parsePosition(sentences[0]?.position.toString() ?? '');
  await reader.goTo(anchor);
  await reader.decorate('probe', anchor, { className: 'probe' });

  if (toc.length === 0 && where.page < 0) throw new BookError('unreachable');
}
`;

const TYPE_PROBE_CONFIG = {
  compilerOptions: {
    target: 'es2022',
    module: 'nodenext',
    moduleResolution: 'nodenext',
    lib: ['es2022', 'dom'],
    strict: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    skipLibCheck: false,
  },
  files: ['probe.ts'],
};

// `tsc` does not inline sources, so every emitted map points out of `dist` and into
// `src`. Dropping `src` from `files` would leave a tarball that installs, imports and
// typechecks perfectly while every stack trace and go-to-definition lands nowhere —
// the exact class of bug that only shows up once the package is on the registry.
async function checkMapSources(installed) {
  const distRoot = join(installed, 'dist');
  const names = await readdir(distRoot, { recursive: true });
  const maps = names.filter((name) => name.endsWith('.map'));
  const dangling = new Set();

  for (const name of maps) {
    const mapPath = join(distRoot, name);
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    for (const source of map.sources) {
      const sourcePath = resolve(dirname(mapPath), map.sourceRoot ?? '', source);
      try {
        await stat(sourcePath);
      } catch {
        dangling.add(source);
      }
    }
  }

  if (dangling.size > 0) {
    fail(`${dangling.size} map source(s) missing from the tarball, e.g. ${[...dangling][0]}`);
  } else {
    pass(`all ${maps.length} source maps resolve to shipped sources`);
  }
}

/**
 * `--from-registry[=<version>]` installs the published package instead of a local
 * tarball. Same assertions, different source: after a release it answers "is what
 * landed on the registry actually consumable", which a local pack cannot — the
 * tarball npm serves is the one npm built, not the one this machine can rebuild.
 */
function registryTarget() {
  const flag = process.argv.slice(2).find((arg) => arg.startsWith('--from-registry'));
  if (flag === undefined) return null;
  const [, version] = flag.split('=');
  return version === undefined || version === '' ? manifest.version : version;
}

async function main() {
  checkManifest();

  const fromRegistry = registryTarget();
  const workspace = await mkdtemp(join(tmpdir(), 'wolfy-reader-pack-'));
  const consumer = join(workspace, 'consumer');
  await mkdir(consumer, { recursive: true });

  let source;
  if (fromRegistry === null) {
    // `npm pack` fires `prepack`, so this packs a freshly built tree — the same path
    // `npm publish` takes, rather than whatever happens to be sitting in dist. The
    // filename is derived rather than parsed out of npm's stdout: lifecycle scripts
    // print there too, so even `--json` output is not reliably JSON.
    const tarball = join(workspace, `${manifest.name}-${manifest.version}.tgz`);
    try {
      run('npm', ['pack', '--pack-destination', workspace], repoRoot);
    } catch (error) {
      // A broken build or a bad `exports` target dies here, inside `prepack`. Report it
      // as a finding: this script exists to diagnose packaging faults, so it must not
      // hand back a raw lifecycle stack for the commonest one.
      fail(`npm pack failed:\n${error.stderr || error.message}`);
      console.error(`\nscratch workspace kept for inspection: ${workspace}`);
      return;
    }
    const { size } = await stat(tarball);
    pass(`packed ${manifest.name}-${manifest.version}.tgz (${size} bytes)`);
    source = tarball;
  } else {
    source = `${manifest.name}@${fromRegistry}`;
    pass(`target is the published ${source}`);
  }

  await writeFile(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'pack-fidelity-consumer', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`,
  );
  try {
    run('npm', ['install', source, '--no-audit', '--no-fund', '--no-package-lock'], consumer);
  } catch (error) {
    fail(`installing ${fromRegistry === null ? 'the tarball' : source} failed:\n${error.stderr || error.message}`);
    console.error(`\nscratch workspace kept for inspection: ${workspace}`);
    return;
  }
  pass(`installed ${fromRegistry === null ? 'the tarball' : source} into a scratch consumer`);

  const installed = join(consumer, 'node_modules', 'wolfy-reader');

  await writeFile(join(consumer, 'probe.mjs'), probeSource());
  try {
    run(process.execPath, [join(consumer, 'probe.mjs')], consumer);
    pass(`every subpath imports under plain Node; ${REFUSED.length} internal paths refused`);
  } catch (error) {
    fail(`runtime probe failed:\n${error.stderr || error.message}`);
  }

  await writeFile(join(consumer, 'probe.ts'), TYPE_PROBE);
  await writeFile(join(consumer, 'tsconfig.json'), `${JSON.stringify(TYPE_PROBE_CONFIG, null, 2)}\n`);
  try {
    run(process.execPath, [tsc, '-p', join(consumer, 'tsconfig.json')], consumer);
    pass('a consumer .ts typechecks against the published .d.ts under nodenext');
  } catch (error) {
    fail(`type probe failed:\n${error.stdout || error.message}`);
  }

  await checkMapSources(installed);

  const entries = entryFiles(manifest.exports);
  const missing = [];
  for (const entry of entries) {
    const source = await readFile(join(installed, entry), 'utf8');
    if (!source.startsWith(banner)) missing.push(entry);
  }
  if (missing.length > 0) fail(`entries missing the @license banner: ${missing.join(', ')}`);
  else pass(`all ${entries.length} entries carry the @license banner`);

  // The banner exists to survive the consumer's build, not to sit in dist. Bundling
  // the packed tarball through a minifier is the only check that proves it.
  const unbannered = [];
  for (const entry of entries) {
    const bundled = await build({
      entryPoints: [join(installed, entry)],
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
      logLevel: 'silent',
    });
    // The attribution, not the literal banner: esbuild re-wraps legal comments from
    // `node_modules` into a trailing "Bundled license information" block, rewriting
    // `/*!` … `*/` as `(*!` … `*)`. What must survive is the credit, not the syntax.
    if (!bundled.outputFiles[0].text.includes(attribution)) unbannered.push(entry);
  }
  if (unbannered.length > 0) fail(`attribution lost under minification: ${unbannered.join(', ')}`);
  else pass('the banner survives a minified consumer build');

  if (process.exitCode === 1) {
    console.error(`\nscratch workspace kept for inspection: ${workspace}`);
    return;
  }
  await rm(workspace, { recursive: true, force: true });
  console.log('\npack fidelity ok');
}

await main();
