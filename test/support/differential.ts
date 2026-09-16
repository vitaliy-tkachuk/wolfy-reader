import type { Book } from '../../src/core/index.ts';

/**
 * Differential-testing support: extract a book's prose independent of its format,
 * strip Project Gutenberg boilerplate (content selection — kept separate from
 * normalization so a further format reuses the normalizer untouched),
 * normalize to a comparable word stream, and score how much of one edition's prose
 * appears verbatim in another's.
 *
 * The comparison is deliberately window-based, not exact-equality: two editions of
 * the same title genuinely differ in front matter, transcriber notes, and
 * punctuation, so exact equality would either be impossible or force
 * over-normalization that can no longer fail. Instead, contiguous windows sampled
 * from the body of one edition must appear verbatim in the other — high enough a
 * bar that a corrupt or divergent decode fails it, low enough that edition drift in
 * the margins does not.
 */

/** Concatenates every section's text, format-neutrally: strips markup from the
 * XHTML/HTML the decoders emit. Works for any `Book` — every decoder
 * renders sections as markup, so the extractor never grows a per-format
 * branch. */
export async function extractBookText(book: Book): Promise<string> {
  const parts: string[] = [];
  for (const section of book.sections) {
    const bytes = await section.load();
    parts.push(stripMarkup(new TextDecoder().decode(bytes)));
  }
  return parts.join('\n');
}

function stripMarkup(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&#x[0-9a-f]+;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

/**
 * Cuts Project Gutenberg's license header/footer, keeping only the body between the
 * START/END markers. Both the EPUB and TXT editions carry these markers, so this is
 * what aligns the two before comparison. Returns the input unchanged when no marker
 * is present (Standard Ebooks, hand fixtures).
 */
export function stripGutenbergBoilerplate(text: string): string {
  let body = text;
  const start = body.match(/\*\*\*\s*start of (?:the|this) project gutenberg[^*]*\*\*\*/i);
  if (start !== null && start.index !== undefined) body = body.slice(start.index + start[0].length);
  const end = body.match(/\*\*\*\s*end of (?:the|this) project gutenberg/i);
  if (end !== null && end.index !== undefined) body = body.slice(0, end.index);
  return body;
}

/**
 * Normalizes prose to a comparable word stream: Unicode-fold, lowercase, drop soft
 * hyphens, unify quotes/dashes to spaces, and keep only letter/digit/apostrophe
 * runs. Tuned to compare prose, not to erase all difference — punctuation and case
 * go, but word identity and order stay.
 */
export function normalizeWords(text: string): string[] {
  const folded = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/­/g, '') // soft hyphen
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, ' ');
  const words: string[] = [];
  for (const match of folded.matchAll(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu)) {
    words.push(match[0]);
  }
  return words;
}

/**
 * The fraction of sampled windows from `a` that appear verbatim in `b`. Windows are
 * taken from the middle of `a` (skipping the first/last 10%, where front/back matter
 * and edition drift live) so the score reflects the shared body, not the margins.
 * A high score means the two decodes agree on the prose; a corrupt or divergent
 * decode drives it toward zero.
 */
export function differentialScore(
  a: readonly string[],
  b: readonly string[],
  { windows = 20, size = 25 }: { windows?: number; size?: number } = {},
): number {
  if (a.length < size * 4 || b.length < size) return 0;
  const haystack = ` ${b.join(' ')} `;
  const from = Math.floor(a.length * 0.1);
  const to = Math.floor(a.length * 0.9) - size;
  if (to <= from) return 0;
  const step = Math.max(1, Math.floor((to - from) / windows));
  let hits = 0;
  let tried = 0;
  for (let i = from; i <= to && tried < windows; i += step) {
    tried += 1;
    const needle = ` ${a.slice(i, i + size).join(' ')} `;
    if (haystack.includes(needle)) hits += 1;
  }
  return tried === 0 ? 0 : hits / tried;
}
