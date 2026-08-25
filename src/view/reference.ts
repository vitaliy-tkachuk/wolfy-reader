/**
 * Reference classification and relative-space joining.
 *
 * Classification and normalization live in `src/core/reading-text.ts` and are
 * re-exported here under their established names: the headless search extractor
 * must classify an `<img src>` exactly the way the resource layer does (the
 * alt-substitution decision is part of the canonical reading text), and search
 * may not import `src/view`. One definition, two consumers.
 */
export {
  classifyReference,
  normalizeReference,
  type ClassifiedReference,
  type ReferenceKind,
} from '../core/reading-text.ts';

import { normalizeReference } from '../core/reading-text.ts';

/**
 * Joins a reference found inside a document that was itself reached by `base`.
 * Both are expressed in the section's reference space: `Section.resolve()`
 * resolves only relative to the section, so a stylesheet's own imports have to
 * be re-expressed relative to the section before they can be resolved at all.
 */
export function joinReference(base: string, reference: string): string {
  if (reference.startsWith('/')) return reference;
  const slash = base.lastIndexOf('/');
  const directory = slash === -1 ? '' : base.slice(0, slash + 1);
  return normalizeReference(directory + reference);
}
