import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'package.json');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const repo = manifest.repository.url.replace(/^git\+https:\/\//, '').replace(/\.git$/, '');

// The attribution itself, without the comment delimiters. It is tracked separately
// because a bundler may re-wrap it: esbuild collects legal comments from
// `node_modules` into one "Bundled license information" block and rewrites the inner
// `/*!` … `*/` as `(*!` … `*)`, since `*/` cannot nest. So the delimiters are not
// what survives a consumer build — this text is.
export const attribution = `${manifest.name} v${manifest.version} | @license ${manifest.license} | (c) ${manifest.author} | ${repo}`;

export const banner = `/*! ${attribution} */`;

// The `/*!` form plus the `@license` marker is what esbuild, Terser and Rollup keep
// under minification by default; a plain `/*` comment is stripped and the MIT
// attribution dies in the consumer's build. Minifiers do not dedupe legal comments,
// so only the subpath entries carry one — banner every emitted module and a
// consumer bundle ends up with dozens of copies, while a tree-shaken-away module
// takes its banner with it.
export function entryFiles(exportsMap) {
  return Object.values(exportsMap)
    .filter((target) => typeof target === 'object' && target !== null)
    .map((target) => target.default)
    .filter((path) => path.endsWith('.js'));
}

async function prepend(entry) {
  const jsPath = resolve(repoRoot, entry);

  // An `exports` target that does not exist in `dist` is the commonest packaging
  // typo, and this is the first step that touches every entry by path — so it is
  // where the mistake should be named, rather than surfacing later as an ENOENT
  // stack from inside a `prepack` lifecycle.
  let source;
  try {
    source = await readFile(jsPath, 'utf8');
  } catch {
    throw new Error(`exports target "${entry}" is missing from the build — nothing at ${jsPath}`);
  }

  if (source.startsWith('/*!')) return false;
  await writeFile(jsPath, `${banner}\n${source}`);

  // The banner adds a line, so every mapping in the sibling source map now points
  // one line too high. `mappings` is semicolon-delimited per output line, so one
  // leading `;` per added line shifts the whole map back into register.
  const mapPath = `${jsPath}.map`;
  const map = JSON.parse(await readFile(mapPath, 'utf8'));
  map.mappings = `;${map.mappings}`;
  await writeFile(mapPath, JSON.stringify(map));
  return true;
}

// `check-pack.mjs` imports the banner text and the entry list from here, so the
// prepend pass must not fire on import — and its output goes to stderr, because
// `npm pack --json` would otherwise have this interleaved into its stdout.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = entryFiles(manifest.exports);
  try {
    const written = await Promise.all(entries.map(prepend));
    const count = written.filter(Boolean).length;
    process.stderr.write(`${banner}\nprepended to ${count}/${entries.length} entries\n`);
  } catch (error) {
    process.stderr.write(`banner: ${error.message}\n`);
    process.exitCode = 1;
  }
}
