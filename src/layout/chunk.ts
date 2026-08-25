/**
 * Chunk-boundary rules for the paginator, derived from real EPUB markup (item8
 * of gutenberg-pride-and-prejudice.epub: 571 top-level blocks, 552 `<p>`, max
 * nesting depth 5), not from theory.
 *
 * A chunk boundary becomes a *forced page break*, because each chunk is laid out
 * as its own multi-column formatting context (layout containment forbids a
 * `content-visibility` box fragmenting across columns). So these rules answer
 * "where is a forced page break acceptable", not merely "where is the DOM
 * splittable".
 *
 * The rules run over a structural view of a top-level node list — `ChunkNode` —
 * rather than the DOM directly, so they are pure and unit-testable under
 * `node:test`. `chunkElement` adapts a real DOM element to that view.
 */

/** The minimal shape the boundary rules read from each top-level node. */
export interface ChunkNode {
  /** Uppercase tag name for elements, `'#text'` for text nodes. */
  readonly tag: string;
  /** `textContent.length` of this node. */
  readonly chars: number;
  /** Serialized markup — `outerHTML` for elements, escaped text for text nodes. */
  readonly html: string;
}

export interface Chunk {
  readonly html: string;
  /** Total characters of text this chunk holds. */
  readonly chars: number;
  /** Number of top-level nodes in this chunk. */
  readonly nodes: number;
}

export interface ChunkStats {
  readonly topLevelNodes: number;
  readonly oversizedElements: number;
  readonly largestElementChars: number;
  readonly headingsDeferred: number;
  readonly atomicOversized: number;
  readonly bareTextNodes: number;
}

export interface ChunkResult {
  readonly chunks: readonly Chunk[];
  readonly stats: ChunkStats;
}

/** Default chunk budget in characters. The whole tradeoff dial; see layout.md. */
export const DEFAULT_CHUNK_CHARS = 8000;

// Splitting *between* these is fine; splitting *inside* one is not — each carries
// structure (row alignment, list numbering, preformatted whitespace) a second
// formatting context would restate from scratch.
const ATOMIC = new Set(['TABLE', 'PRE', 'OL', 'UL', 'DL', 'FIGURE', 'BLOCKQUOTE', 'SVG', 'MATH']);

// A chunk must never end on one of these: the boundary is a page break, and a
// heading (or rule) stranded at the foot of a page is the classic orphan.
const NEVER_LAST = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR']);

/**
 * Splits a top-level node list into chunks at flow boundaries, accumulating
 * children until `targetChars` of text is reached.
 *
 * - Split only between top-level (depth-1) children; never descend.
 * - An element larger than the budget is emitted whole as its own chunk (the
 *   budget is advisory, not a cap) — descending would put a page break
 *   mid-paragraph.
 * - Never end a chunk on a heading or `<hr>`; defer it to the next chunk.
 * - Bare text nodes are glued to the open chunk; whitespace-only ones are
 *   dropped by `chunkElement` before this runs.
 */
export function chunkNodes(nodes: readonly ChunkNode[], targetChars = DEFAULT_CHUNK_CHARS): ChunkResult {
  let oversizedElements = 0;
  let largestElementChars = 0;
  let headingsDeferred = 0;
  let atomicOversized = 0;
  let bareTextNodes = 0;

  const chunks: Chunk[] = [];
  let current: ChunkNode[] = [];
  let currentChars = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    chunks.push({
      html: current.map((node) => node.html).join(''),
      chars: currentChars,
      nodes: current.length,
    });
    current = [];
    currentChars = 0;
  };

  for (const node of nodes) {
    if (node.tag === '#text') bareTextNodes += 1;
    if (node.chars > largestElementChars) largestElementChars = node.chars;

    if (node.chars >= targetChars) {
      flush();
      oversizedElements += 1;
      if (ATOMIC.has(node.tag)) atomicOversized += 1;
      current = [node];
      currentChars = node.chars;
      flush();
      continue;
    }

    if (currentChars > 0 && currentChars + node.chars > targetChars) {
      const deferred: ChunkNode[] = [];
      while (current.length > 1 && NEVER_LAST.has(current[current.length - 1]!.tag)) {
        const moved = current.pop()!;
        currentChars -= moved.chars;
        deferred.unshift(moved);
        headingsDeferred += 1;
      }
      flush();
      for (const moved of deferred) {
        current.push(moved);
        currentChars += moved.chars;
      }
    }

    current.push(node);
    currentChars += node.chars;
  }
  flush();

  return {
    chunks,
    stats: {
      topLevelNodes: nodes.length,
      oversizedElements,
      largestElementChars,
      headingsDeferred,
      atomicOversized,
      bareTextNodes,
    },
  };
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Adapts a live DOM element (a section body) into the `ChunkNode` list the
 * boundary rules read, then chunks it. Whitespace-only bare text nodes are
 * dropped here — they carry no block box and would strand against a formatting
 * context they did not come from.
 */
export function chunkElement(body: Element, targetChars = DEFAULT_CHUNK_CHARS): ChunkResult {
  const nodes: ChunkNode[] = [];
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === ELEMENT_NODE) {
      const element = node as Element;
      nodes.push({
        tag: element.tagName.toUpperCase(),
        chars: element.textContent?.length ?? 0,
        html: element.outerHTML,
      });
    } else if (node.nodeType === TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.trim().length === 0) continue;
      nodes.push({ tag: '#text', chars: text.length, html: escapeHtmlText(text) });
    }
  }
  return chunkNodes(nodes, targetChars);
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
