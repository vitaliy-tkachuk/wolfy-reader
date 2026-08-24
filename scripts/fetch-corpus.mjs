import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'corpus')

// Gutenberg ships the same title as EPUB and TXT — pairs feed differential decoder tests.
function gutenberg(id, slug) {
  return [
    { url: `https://www.gutenberg.org/ebooks/${id}.epub3.images`, file: `gutenberg-${slug}.epub` },
    { url: `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`, file: `gutenberg-${slug}.txt` },
  ]
}

const downloads = [
  ...gutenberg(84, 'frankenstein'),
  ...gutenberg(1342, 'pride-and-prejudice'),
  ...gutenberg(2701, 'moby-dick'),
  {
    // Without ?source=download Standard Ebooks serves an HTML interstitial instead of the file.
    url: 'https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub?source=download',
    file: 'standardebooks-frankenstein.epub',
  },
]

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

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
      headers: { 'user-agent': 'wolfyReader-corpus-fetch (https://github.com/vitaliy-tkachuk/wolfyReader)' },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    await writeFile(dest, bytes)
    console.log(`fetched ${file} (${bytes.length} bytes)`)
  } catch (err) {
    failures += 1
    console.error(`failed  ${file}: ${err.message}`)
  }
}

if (failures > 0) process.exitCode = 1
