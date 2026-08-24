import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../src/core/index.ts';
import { epub } from '../src/formats/epub/index.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corpusDir = join(repoRoot, 'test', 'corpus');
const outputDir = join(repoRoot, 'bench', 'fixtures');

const syntheticTargetBytes = 500 * 1024;
const syntheticSeed = 0x5eed1e;

const requiredCorpus = [
  'gutenberg-moby-dick.txt',
  'gutenberg-pride-and-prejudice.txt',
  'gutenberg-pride-and-prejudice.epub',
];

const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// The benchmark measures text layout; anything that can reach the network or
// restyle the container would poison the numbers, so it goes rather than
// staying as inert markup.
const droppedElements = new Set([
  'audio',
  'base',
  'canvas',
  'embed',
  'iframe',
  'img',
  'input',
  'link',
  'meta',
  'object',
  'script',
  'source',
  'style',
  'svg',
  'track',
  'video',
]);

const allowedAttributes = new Set(['class', 'dir', 'id', 'lang']);

const forbiddenPatterns = [
  /<\s*(script|style|link|img|svg|iframe|object|embed|video|audio)\b/i,
  /\son[a-z]+\s*=/i,
  /\s(src|srcset|href|background|poster|data)\s*=/i,
  /url\s*\(/i,
];

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeText(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function gutenbergProse(text) {
  const start = text.indexOf('*** START OF THE PROJECT GUTENBERG EBOOK');
  const end = text.indexOf('*** END OF THE PROJECT GUTENBERG EBOOK');
  const from = start === -1 ? 0 : text.indexOf('\n', start) + 1;
  return text.slice(from, end === -1 ? undefined : end);
}

// Gutenberg plain text marks emphasis with underscores, sets headings and
// transitions as very short all-caps blocks, and renders its table of contents
// as ordinary paragraphs. None of that is body prose.
function paragraphsOf(text) {
  return gutenbergProse(text)
    .split(/\r?\n[ \t]*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').replaceAll('_', '').trim())
    .filter(
      (paragraph) =>
        paragraph.length >= 120 &&
        paragraph !== paragraph.toUpperCase() &&
        !/^(chapter|contents|illustrations|list of|produced by|transcriber)/i.test(paragraph) &&
        !/project gutenberg|etext|proofread/i.test(paragraph),
    );
}

function cursorOver(items) {
  let index = 0;
  return () => {
    const item = items[index % items.length];
    index += 1;
    return item;
  };
}

function sentencesOf(paragraph) {
  return paragraph.split(/(?<=[.!?][”"’']?)\s+/).filter((sentence) => sentence.length > 0);
}

function withEmphasis(paragraph, random) {
  const tags = ['em', 'strong', 'i'];
  const words = escapeText(paragraph).split(' ');
  for (let index = 0; index < words.length; index += 1) {
    if (random() >= 0.025) continue;
    const last = Math.min(words.length, index + 1 + Math.floor(random() * 3)) - 1;
    const tag = tags[Math.floor(random() * tags.length)];
    words[index] = `<${tag}>${words[index]}`;
    words[last] = `${words[last]}</${tag}>`;
    index = last + 1;
  }
  return words.join(' ');
}

function proseBlock(nextProse, random) {
  let paragraph = nextProse();
  const shape = random();
  if (shape < 0.2) {
    const sentences = sentencesOf(paragraph);
    paragraph = sentences.slice(0, 1 + Math.floor(random() * 2)).join(' ');
  } else if (shape > 0.75) {
    paragraph = `${paragraph} ${nextProse()}`;
    if (shape > 0.94) paragraph = `${paragraph} ${nextProse()}`;
  }
  return paragraph;
}

function headingText(nextProse, random) {
  const words = sentencesOf(nextProse())[0].split(' ');
  const start = Math.floor(random() * Math.max(1, words.length - 6));
  const phrase = words.slice(start, start + 3 + Math.floor(random() * 4)).join(' ');
  return escapeText(phrase.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, ''));
}

function listBlock(nextProse, random) {
  const tag = random() < 0.5 ? 'ul' : 'ol';
  const items = [];
  for (let index = 0; index < 3 + Math.floor(random() * 4); index += 1) {
    items.push(`  <li>${withEmphasis(sentencesOf(nextProse())[0], random)}</li>`);
  }
  return `<${tag}>\n${items.join('\n')}\n</${tag}>`;
}

function buildSynthetic(prosePools, targetBytes) {
  const random = mulberry32(syntheticSeed);
  const pools = prosePools.map((paragraphs) => cursorOver(paragraphs));
  const nextProse = () => pools[Math.floor(random() * pools.length)]();
  const parts = [];
  let bytes = 0;
  const append = (markup) => {
    parts.push(markup);
    bytes += Buffer.byteLength(markup, 'utf8') + 1;
  };

  for (let chapter = 1; bytes < targetBytes; chapter += 1) {
    append(`<h2>Chapter ${chapter}. ${headingText(nextProse, random)}</h2>`);
    const blocks = 12 + Math.floor(random() * 24);
    for (let block = 0; block < blocks && bytes < targetBytes; block += 1) {
      const roll = random();
      if (roll < 0.04) {
        append(`<blockquote>\n  <p>${withEmphasis(proseBlock(nextProse, random), random)}</p>\n</blockquote>`);
      } else if (roll < 0.07) {
        append(listBlock(nextProse, random));
      } else if (roll < 0.11) {
        append(`<h3>${headingText(nextProse, random)}</h3>`);
      } else if (roll < 0.13) {
        append('<hr />');
      } else {
        append(`<p>${withEmphasis(proseBlock(nextProse, random), random)}</p>`);
      }
    }
  }

  return `${parts.join('\n')}\n`;
}

function bodyFragment(markup) {
  const opening = /<body\b[^>]*>/i.exec(markup);
  if (opening === null) return markup;
  const from = opening.index + opening[0].length;
  const to = markup.toLowerCase().lastIndexOf('</body>');
  return markup.slice(from, to === -1 ? undefined : to);
}

function rebuildOpenTag(name, tag) {
  const attributes = [];
  const pattern = /([A-Za-z_:][-\w:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    const attribute = match[1].toLowerCase();
    if (!allowedAttributes.has(attribute)) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    attributes.push(` ${attribute}="${value.replaceAll('<', '&lt;').replaceAll('"', '&quot;')}"`);
  }
  const opening = `<${name}${attributes.join('')}`;
  if (voidElements.has(name)) return `${opening} />`;
  // An HTML parser ignores the slash on a self-closed non-void tag, so XHTML's
  // `<a id="x"/>` would swallow the rest of the section into the anchor.
  return tag.endsWith('/>') ? `${opening}></${name}>` : `${opening}>`;
}

function altTextOf(tag) {
  const match = /\balt\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i.exec(tag);
  return match === null ? '' : match[1].replace(/^["']|["']$/g, '');
}

function sanitizeFragment(markup) {
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<\/?[A-Za-z][^>]*?>/g;
  const out = [];
  let dropping = null;
  let depth = 0;
  let cursor = 0;
  let match;
  while ((match = tags.exec(markup)) !== null) {
    if (dropping === null) out.push(markup.slice(cursor, match.index));
    cursor = tags.lastIndex;
    const tag = match[0];
    if (tag.startsWith('<!') || tag.startsWith('<?')) continue;
    const closing = tag[1] === '/';
    const name = /^<\/?([A-Za-z][A-Za-z0-9]*)/.exec(tag)[1].toLowerCase();
    if (dropping !== null) {
      if (name !== dropping) continue;
      if (closing) {
        depth -= 1;
        if (depth === 0) dropping = null;
      } else if (!tag.endsWith('/>')) {
        depth += 1;
      }
      continue;
    }
    if (droppedElements.has(name)) {
      // Ebookmaker sets drop caps as an image whose alt is the letter itself;
      // dropping it silently would eat the first letter of every chapter.
      if (name === 'img') out.push(altTextOf(tag));
      if (closing || voidElements.has(name) || tag.endsWith('/>')) continue;
      dropping = name;
      depth = 1;
      continue;
    }
    out.push(closing ? `</${name}>` : rebuildOpenTag(name, tag));
  }
  if (dropping === null) out.push(markup.slice(cursor));
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function assertClean(name, fragment) {
  for (const pattern of forbiddenPatterns) {
    const match = pattern.exec(fragment);
    if (match !== null) throw new Error(`${name} still contains ${match[0].trim()}`);
  }
}

async function largestSection(book) {
  let largest = null;
  for (const section of book.sections) {
    const content = await section.load();
    if (largest === null || content.length > largest.content.length) {
      largest = { id: section.id, content };
    }
  }
  return largest;
}

const missing = [];
for (const name of requiredCorpus) {
  if (!(await exists(join(corpusDir, name)))) missing.push(name);
}
if (missing.length > 0) {
  console.log(`skip: benchmark corpus is absent (${missing.join(', ')})`);
  console.log('      run `npm run fetch-corpus` to download it, then re-run this script');
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });

const syntheticSources = ['gutenberg-moby-dick.txt', 'gutenberg-pride-and-prejudice.txt'];
const prosePools = [];
for (const name of syntheticSources) {
  prosePools.push(paragraphsOf(await readFile(join(corpusDir, name), 'utf8')));
}

const synthetic = buildSynthetic(prosePools, syntheticTargetBytes);
assertClean('synthetic-500k.html', synthetic);
await writeFile(join(outputDir, 'synthetic-500k.html'), synthetic, 'utf8');

const epubName = 'gutenberg-pride-and-prejudice.epub';
const epubBytes = await readFile(join(corpusDir, epubName));
const book = await open(new Uint8Array(epubBytes).buffer, { formats: [epub] });
const largest = await largestSection(book);
const real = `${sanitizeFragment(bodyFragment(new TextDecoder().decode(largest.content)))}\n`;
assertClean('real-largest.html', real);
await writeFile(join(outputDir, 'real-largest.html'), real, 'utf8');

const manifest = {
  fixtures: [
    {
      id: 'synthetic-500k',
      label: 'Synthetic single section, 500KB+ (real Gutenberg prose)',
      file: 'synthetic-500k.html',
      bytes: Buffer.byteLength(synthetic, 'utf8'),
      source: syntheticSources.join(', '),
    },
    {
      id: 'real-largest',
      label: 'Pride and Prejudice, largest real corpus section',
      file: 'real-largest.html',
      bytes: Buffer.byteLength(real, 'utf8'),
      source: `${epubName}#${largest.id}`,
    },
  ],
};
await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

for (const fixture of manifest.fixtures) {
  console.log(`wrote   bench/fixtures/${fixture.file} (${fixture.bytes} bytes) from ${fixture.source}`);
}
console.log('wrote   bench/fixtures/manifest.json');
