import { readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = resolve(repoRoot, 'src');
const entry = resolve(srcRoot, 'core', 'index.ts');
const forbiddenRoots = ['layout', 'view'].map((name) => resolve(srcRoot, name));

// Statements only ever start a line in this repo, and a specifier is always a
// literal, so a source scan is enough — a parser would be a dependency and tsc's
// API would be a build step, for a graph that is a few dozen files wide.
const staticSpecifier = /^[ \t]*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const sideEffectSpecifier = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
const dynamicSpecifier = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const anyDynamicImport = /\bimport\s*\(/g;

// Comments are blanked so a commented-out import is not walked and a `//` inside
// a string literal is not mistaken for one. Strings survive intact — they carry
// the specifiers. Regex literals are tracked only so a class like /['"]/ cannot
// flip the scanner into string state.
function blankComments(source) {
  const out = [...source];
  const regexPrefix = new Set([...'(,=:[!&|?{};+-*%~^<>', '\n', '\r', '\t', ' ']);
  let lastSignificant = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') out[index++] = ' ';
      continue;
    }
    if (char === '/' && next === '*') {
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] !== '\n') out[index] = ' ';
        index += 1;
      }
      out[index] = ' ';
      out[index + 1] = ' ';
      index += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      index += 1;
      while (index < source.length && source[index] !== char) {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
      lastSignificant = char;
      continue;
    }
    if (char === '/' && regexPrefix.has(lastSignificant)) {
      index += 1;
      while (index < source.length && source[index] !== '/' && source[index] !== '\n') {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
      lastSignificant = '/';
      continue;
    }
    if (!/\s/.test(char)) lastSignificant = char;
    index += 1;
  }
  return out.join('');
}

function specifiersIn(source) {
  const scanned = blankComments(source);
  const found = [];
  for (const pattern of [staticSpecifier, sideEffectSpecifier, dynamicSpecifier]) {
    pattern.lastIndex = 0;
    for (const match of scanned.matchAll(pattern)) found.push(match[1]);
  }
  const literalDynamic = [...scanned.matchAll(dynamicSpecifier)].length;
  const allDynamic = [...scanned.matchAll(anyDynamicImport)].length;
  return { specifiers: [...new Set(found)], opaqueDynamicImports: allDynamic - literalDynamic };
}

async function isFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function resolveSpecifier(specifier, importer) {
  const base = resolve(dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, resolve(base, 'index.ts')];
  if (base.endsWith('.js')) candidates.splice(1, 0, `${base.slice(0, -3)}.ts`);
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

function label(absolute) {
  return relative(repoRoot, absolute).split(sep).join('/');
}

function chainOf(path, parents) {
  const chain = [];
  for (let step = path; step !== undefined; step = parents.get(step)) chain.unshift(label(step));
  return chain;
}

function forbiddenRootOf(absolute) {
  return forbiddenRoots.find(
    (root) => absolute === root || absolute.startsWith(root + sep),
  );
}

const parents = new Map([[entry, undefined]]);
const visited = new Set();
const failures = [];
const queue = [entry];

while (queue.length > 0) {
  const current = queue.shift();
  if (visited.has(current)) continue;
  visited.add(current);

  const { specifiers, opaqueDynamicImports } = specifiersIn(await readFile(current, 'utf8'));
  if (opaqueDynamicImports > 0) {
    console.warn(
      `warning: ${label(current)} has ${opaqueDynamicImports} dynamic import(s) with a ` +
        'non-literal specifier — the source scan cannot follow them.',
    );
  }

  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) {
      failures.push({
        reason: `bare specifier '${specifier}' — dependencies stays {} permanently`,
        chain: [...chainOf(current, parents), specifier],
      });
      continue;
    }
    const resolved = await resolveSpecifier(specifier, current);
    if (resolved === null) {
      failures.push({
        reason: `unresolvable specifier '${specifier}'`,
        chain: [...chainOf(current, parents), specifier],
      });
      continue;
    }
    if (!parents.has(resolved)) parents.set(resolved, current);
    const forbidden = forbiddenRootOf(resolved);
    if (forbidden !== undefined) {
      failures.push({
        reason: `${label(forbidden)} is not reachable from the headless core`,
        chain: chainOf(resolved, parents),
      });
      continue;
    }
    if (resolved === srcRoot || !resolved.startsWith(srcRoot + sep)) continue;
    queue.push(resolved);
  }
}

if (failures.length > 0) {
  console.error(`${label(entry)} is not headless-pure — ${failures.length} violation(s):\n`);
  for (const failure of failures) {
    console.error(`  ${failure.reason}`);
    console.error(`    ${failure.chain.join('\n      -> ')}\n`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `check:core ok — ${label(entry)} reaches ${visited.size} modules, ` +
      'none under src/layout or src/view.',
  );
}
