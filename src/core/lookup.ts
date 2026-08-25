import type { Section } from './book.ts';

/**
 * A `Map`-backed `Book.section(id)` implementation shared by the decoders, so an
 * id lookup is O(1) instead of a linear scan per call. First match wins on a
 * duplicate id, matching the `Array.find` semantics it replaced (section ids are
 * unique by the model's rules; this only pins the behavior if a decoder ever
 * slips). Internal to the library — not re-exported from `src/core/index.ts`.
 */
export function sectionLookup(sections: readonly Section[]): (id: string) => Section | undefined {
  const byId = new Map<string, Section>();
  for (const section of sections) {
    if (!byId.has(section.id)) byId.set(section.id, section);
  }
  return (id) => byId.get(id);
}
