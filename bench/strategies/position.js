// Page -> text-position mapping via Range.getClientRects(). Both strategies
// call this with the same algorithm; the only difference is the scope they hand
// it. That difference is the architectural claim under test, not a handicap:
// naive can only scope to the whole chapter, chunked can scope to one chunk.

function columnIndexOfRect(rect, originLeft, advance) {
  return Math.round((rect.left - originLeft) / advance);
}

function firstRect(range) {
  const rects = range.getClientRects();
  return rects.length > 0 ? rects[0] : null;
}

/**
 * Character offset, within `roots`' combined text, of the first glyph painted
 * on column `columnIndex`. Returns null when the column holds no text.
 */
export function offsetAtColumn(roots, columnIndex, originLeft, advance) {
  let consumed = 0;
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    // Coarse pass: find the text node whose own box lands on the column, so the
    // per-character bisect below runs over one node and not the whole scope.
    let candidate = null;
    let candidateBase = consumed;
    let base = consumed;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const length = node.textContent.length;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = firstRect(range);
      if (rect !== null) {
        const column = columnIndexOfRect(rect, originLeft, advance);
        if (column > columnIndex) break;
        if (column === columnIndex) {
          candidate = node;
          candidateBase = base;
          break;
        }
        // The node starts before the column but may run into it.
        const rects = [...range.getClientRects()];
        const last = rects[rects.length - 1];
        if (last !== undefined && columnIndexOfRect(last, originLeft, advance) >= columnIndex) {
          candidate = node;
          candidateBase = base;
          break;
        }
      }
      base += length;
    }
    if (candidate === null) {
      consumed += root.textContent.length;
      continue;
    }
    const length = candidate.textContent.length;
    for (let i = 0; i < length; i += 1) {
      const range = document.createRange();
      range.setStart(candidate, i);
      range.setEnd(candidate, Math.min(i + 1, length));
      const rect = firstRect(range);
      if (rect !== null && columnIndexOfRect(rect, originLeft, advance) >= columnIndex) {
        return candidateBase + i;
      }
    }
    return candidateBase;
  }
  return null;
}
