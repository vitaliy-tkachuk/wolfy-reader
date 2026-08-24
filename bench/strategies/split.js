// Chunk-boundary rules, derived from running this against real EPUB markup
// (item8 of gutenberg-pride-and-prejudice.epub, 571 top-level blocks).
//
// A chunk boundary becomes a hard page break in the chunked strategy, because
// each chunk is its own multi-column formatting context. So the boundary rules
// are really "where is a forced page break acceptable", not "where is the DOM
// splittable".
//
// What the real section showed:
// - Nesting is shallow (max depth 5) and 552 of 571 top-level nodes are <p>, so
//   splitting at depth 1 covers essentially everything. Descending is not worth
//   the complexity.
// - The oversized case is not hypothetical: Lydia's letter is one <p> of 10,142
//   characters inside a <div class="blockquot">, against a median <p> of 209.
//   At an 8,000-character budget it produces exactly one oversized chunk.
// - Empty inline elements have no geometry. The section carries 114 zero-width
//   page-anchor spans; a Range over one returns no client rects. Anything that
//   reads geometry back must tolerate that (see position.js).

// Splitting *between* these is fine; splitting *inside* one is not, because the
// element carries structure (row alignment, list numbering, preformatted
// whitespace) that a second formatting context would restate from scratch.
const ATOMIC = new Set(['TABLE', 'PRE', 'OL', 'UL', 'DL', 'FIGURE', 'BLOCKQUOTE', 'SVG', 'MATH']);

// A chunk must not end on one of these: the boundary is a page break, and a
// heading alone at the foot of a page is the classic orphan.
const NEVER_LAST = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR']);

function serialize(node) {
  if (node.nodeType === Node.ELEMENT_NODE) return node.outerHTML;
  const box = document.createElement('div');
  box.append(node.cloneNode(true));
  return box.innerHTML;
}

/**
 * Split a body fragment into chunks at top-level flow boundaries, accumulating
 * children until `targetChars` of text is reached.
 */
export function splitFragment(html, targetChars) {
  const host = document.createElement('div');
  host.innerHTML = html;

  const nodes = [...host.childNodes].filter(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE ||
      (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0),
  );

  const stats = {
    topLevelNodes: nodes.length,
    topLevelTags: {},
    oversizedElements: 0,
    largestElementChars: 0,
    headingsDeferred: 0,
    atomicOversized: 0,
    bareTextNodes: 0,
  };

  const chunks = [];
  let current = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      html: current.map(serialize).join(''),
      chars: currentChars,
      nodes: current.length,
    });
    current = [];
    currentChars = 0;
  };

  for (const node of nodes) {
    const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName : '#text';
    stats.topLevelTags[tag] = (stats.topLevelTags[tag] ?? 0) + 1;
    if (tag === '#text') stats.bareTextNodes += 1;

    const chars = node.textContent.length;
    if (chars > stats.largestElementChars) stats.largestElementChars = chars;

    // A single element bigger than the budget cannot be split further without
    // descending into it — which would put a page break inside a paragraph or
    // inside a table. It becomes an oversized chunk of its own instead, and the
    // budget is treated as advisory rather than a cap.
    if (chars >= targetChars) {
      flush();
      stats.oversizedElements += 1;
      if (ATOMIC.has(tag)) stats.atomicOversized += 1;
      current = [node];
      currentChars = chars;
      flush();
      continue;
    }

    if (currentChars > 0 && currentChars + chars > targetChars) {
      const deferred = [];
      while (current.length > 1 && NEVER_LAST.has(current[current.length - 1].tagName)) {
        const moved = current.pop();
        currentChars -= moved.textContent.length;
        deferred.unshift(moved);
        stats.headingsDeferred += 1;
      }
      flush();
      for (const moved of deferred) {
        current.push(moved);
        currentChars += moved.textContent.length;
      }
    }

    // A bare text node is glued to whatever chunk is open: on its own it has no
    // block box, and starting a chunk with it would strand it against a
    // formatting context it did not come from.
    current.push(node);
    currentChars += chars;
  }
  flush();

  return { chunks, stats };
}
