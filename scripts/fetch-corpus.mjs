import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'corpus')

// Gutenberg ships the same title as EPUB and TXT — pairs feed differential decoder tests.
function gutenberg(id, slug) {
  return [
    { url: `https://www.gutenberg.org/ebooks/${id}.epub3.images`, file: `gutenberg-${slug}.epub` },
    { url: `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`, file: `gutenberg-${slug}.txt` },
  ]
}

// W3C EPUB 3.3 test suite (w3c/epub-tests) — built books published on the test
// site. A decoder-relevant, deliberately hostile subset: container/URL edge
// cases, foreign media with fallbacks, hostile XML, direction and layout flags.
const W3C_TESTS = [
  'cnt-svg-support',
  'cnt-xhtml-support',
  'lay-fxl-layout-pre-paginated',
  'lay-pp-layout-default',
  'nav-non-text_img',
  'nav-spine_in-spine',
  'nav-spine_not-in-spine',
  'ocf-font_obfuscation',
  'ocf-metainf-inc',
  'ocf-package_arbitrary',
  'ocf-package_multiple',
  'ocf-url_manifest',
  'ocf-url_parse-path-absolute',
  'ocf-url_relative',
  'ocf-zip-comp',
  'ocf-zip-mult',
  'pkg-manifest-unlisted-resource',
  'pkg-meta-whitespace',
  'pkg-spine-duplicate-item-rendering',
  'pkg-spine-order',
  'pkg-spine-progression-default',
  'pkg-spine-progression_ltr',
  'pkg-spine-progression_rtl',
  'pkg-title-order',
  'pkg-unique-id_duplicate',
  'pkg-version-backward',
  'pub-foreign_bad-fallback',
  'pub-foreign_image',
  'pub-foreign_xml-spine',
  'pub-xml-external-id',
  'pub-xml-non-validating_comment',
  'pub-xml-non-validating_unclosed',
  'scr-support-fallback',
]

export const downloads = [
  ...gutenberg(84, 'frankenstein'),
  ...gutenberg(1342, 'pride-and-prejudice'),
  ...gutenberg(2701, 'moby-dick'),
  ...gutenberg(11, 'alice-in-wonderland'),
  ...gutenberg(1661, 'sherlock-holmes'),
  {
    // Without ?source=download Standard Ebooks serves an HTML interstitial instead of the file.
    url: 'https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub?source=download',
    file: 'standardebooks-frankenstein.epub',
  },
  ...W3C_TESTS.map((id) => ({
    url: `https://w3c.github.io/epub-tests/tests/${id}.epub`,
    file: join('epub-testsuite', `${id}.epub`),
  })),
]

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  await mkdir(corpusDir, { recursive: true })

  let failures = 0
  for (const { url, file } of downloads) {
    const dest = join(corpusDir, file)
    if (await exists(dest)) {
      console.log(`skip    ${file} (already present)`)
      continue
    }
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'wolfy-reader-corpus-fetch (https://github.com/vitaliy-tkachuk/wolfy-reader)' },
        redirect: 'follow',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, bytes)
      console.log(`fetched ${file} (${bytes.length} bytes)`)
    } catch (err) {
      failures += 1
      console.error(`failed  ${file}: ${err.message}`)
    }
  }

  if (failures > 0) process.exitCode = 1
}

// `check-guards.mjs` imports this manifest to assert the corpus is complete, so
// downloading must not fire on import — the same reason `banner.mjs` guards its
// prepend pass.
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
