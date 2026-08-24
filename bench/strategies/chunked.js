import { offsetAtColumn } from './position.js';
import { splitFragment } from './split.js';

// Why each chunk is its own multi-column context rather than a block inside one
// shared flow (which is what PLAN.md §4 describes):
//
// `content-visibility: auto` applies layout containment, and a layout-contained
// box is monolithic — it cannot fragment across columns. Measured in Chromium
// 151: six 8-paragraph blocks in one 400x300 column flow occupy 36 columns
// plain, and 6 columns with `content-visibility: auto` on the blocks, one per
// block, with the rest of each block's text clipped away. The literal shared-
// flow form of the bet does not render correctly, so it cannot be benchmarked
// against a correct control.
//
// Nor can an off-screen chunk in a shared flow be replaced by a sized spacer:
// a fragmented element's getBoundingClientRect().height is the column height,
// not its extent through the flow, so there is no height to hand the spacer.
//
// Giving each chunk its own column context fixes both: the chunk box is not in
// a fragmentation context, so containment is harmless and its measured width is
// exactly its ink. The price is that every chunk boundary becomes a forced page
// break — the ragged last page per chunk shows up as a higher page count than
// the naive control on the same content, and that gap is reported.

export function create(container, html, options) {
  const {
    pageWidth,
    pageHeight,
    columnGap,
    chunkChars,
    windowChunks = 1,
    virtualization = 'content-visibility',
  } = options;
  const advance = pageWidth + columnGap;

  const track = document.createElement('div');
  track.style.position = 'relative';
  track.style.width = `${pageWidth}px`;
  track.style.height = `${pageHeight}px`;
  container.append(track);

  const { chunks, stats: splitStats } = splitFragment(html, chunkChars);

  const boxes = chunks.map((chunk) => {
    const box = document.createElement('div');
    box.style.position = 'absolute';
    box.style.top = '0';
    box.style.height = `${pageHeight}px`;
    box.style.columnWidth = `${pageWidth}px`;
    box.style.columnGap = `${columnGap}px`;
    box.style.columnFill = 'auto';
    track.append(box);
    return { box, chunk, columns: 1, left: 0, realized: false, measured: false };
  });

  let measuredChars = 0;
  let measuredColumns = 0;
  let currentPage = 0;
  let realizedCount = 0;

  const realize = (entry) => {
    if (entry.realized) return;
    entry.box.innerHTML = entry.chunk.html;
    entry.realized = true;
    realizedCount += 1;
  };

  // Measuring costs one extra layout: the box is first narrowed to a single
  // column so the content overflows, and scrollWidth then reports how many
  // columns it really needs. Sizing it to the estimate first would only ever
  // reveal an underestimate, never an overestimate.
  const measureColumns = (entry) => {
    entry.box.style.width = `${pageWidth}px`;
    const columns = Math.max(1, Math.round((entry.box.scrollWidth + columnGap) / advance));
    entry.columns = columns;
    entry.measured = true;
    measuredChars += entry.chunk.chars;
    measuredColumns += columns;
    return columns;
  };

  // Density is a running average over every chunk measured so far, not a
  // one-shot reading of chunk 0: a per-chunk average absorbs the ragged final
  // column that every chunk ends on, which a single sample does not.
  const estimateColumns = (entry) => {
    if (measuredColumns === 0) return 1;
    return Math.max(1, Math.round((entry.chunk.chars * measuredColumns) / measuredChars));
  };

  const reflowOffsets = () => {
    let left = 0;
    for (const entry of boxes) {
      const columns = entry.measured ? entry.columns : estimateColumns(entry);
      entry.columns = columns;
      entry.left = left;
      entry.box.style.left = `${left * advance}px`;
      entry.box.style.width = `${columns * advance - columnGap}px`;
      left += columns;
    }
    return left;
  };

  const chunkIndexOfPage = (page) => {
    for (let i = boxes.length - 1; i >= 0; i -= 1) {
      if (boxes[i].left <= page) return i;
    }
    return 0;
  };

  const applyVirtualization = (activeIndex) => {
    if (virtualization === 'none') return;
    for (let i = 0; i < boxes.length; i += 1) {
      const entry = boxes[i];
      const near = Math.abs(i - activeIndex) <= windowChunks;
      const skip = entry.realized && !near;
      entry.box.style.contentVisibility = skip ? 'auto' : 'visible';
      entry.box.style.containIntrinsicSize = skip
        ? `${entry.columns * advance - columnGap}px ${pageHeight}px`
        : '';
    }
  };

  let pageCount = 1;

  const ensurePage = (page) => {
    const index = chunkIndexOfPage(page);
    let changed = false;
    for (let i = Math.max(0, index - windowChunks); i <= Math.min(boxes.length - 1, index + windowChunks); i += 1) {
      const entry = boxes[i];
      if (!entry.realized || !entry.measured) {
        realize(entry);
        entry.box.style.contentVisibility = 'visible';
        measureColumns(entry);
        changed = true;
      }
    }
    if (changed) {
      pageCount = reflowOffsets();
    }
    applyVirtualization(index);
    return index;
  };

  const apply = () => {
    track.style.transform = `translateX(${-currentPage * advance}px)`;
  };

  realize(boxes[0]);
  measureColumns(boxes[0]);
  pageCount = reflowOffsets();
  ensurePage(0);
  apply();

  return {
    pageCount: () => pageCount,
    // Exact means every chunk has been measured, not merely materialized: a
    // re-layout invalidates measurements without dropping the DOM.
    pagesExact: () => boxes.every((entry) => entry.measured),
    goToPage(n) {
      currentPage = Math.max(0, Math.min(pageCount - 1, n));
      ensurePage(currentPage);
      currentPage = Math.max(0, Math.min(pageCount - 1, currentPage));
      apply();
    },
    relayout() {
      // Lazily, on the strategy's own terms: every measurement is invalidated,
      // but only the window around the current page is re-measured. Re-measuring
      // every realized chunk here would be the naive strategy wearing a chunked
      // costume, and would make this number meaningless.
      measuredChars = 0;
      measuredColumns = 0;
      for (const entry of boxes) entry.measured = false;

      const index = chunkIndexOfPage(currentPage);
      for (let i = Math.max(0, index - windowChunks); i <= Math.min(boxes.length - 1, index + windowChunks); i += 1) {
        const entry = boxes[i];
        realize(entry);
        entry.box.style.contentVisibility = 'visible';
        entry.box.style.containIntrinsicSize = '';
        measureColumns(entry);
      }
      pageCount = reflowOffsets();
      currentPage = Math.min(currentPage, pageCount - 1);
      ensurePage(currentPage);
      apply();
    },
    realizeAll() {
      for (const entry of boxes) {
        if (!entry.realized) {
          realize(entry);
        }
        if (!entry.measured) {
          entry.box.style.contentVisibility = 'visible';
          measureColumns(entry);
        }
      }
      pageCount = reflowOffsets();
      applyVirtualization(chunkIndexOfPage(currentPage));
      return pageCount;
    },
    positionOfPage(n) {
      const index = chunkIndexOfPage(n);
      const entry = boxes[index];
      if (!entry.realized) return null;
      const originLeft = entry.box.getBoundingClientRect().left;
      const offset = offsetAtColumn([entry.box], n - entry.left, originLeft, advance);
      if (offset === null) return null;
      let base = 0;
      for (let i = 0; i < index; i += 1) base += boxes[i].chunk.chars;
      return base + offset;
    },
    stats: () => ({
      chunks: boxes.length,
      realized: realizedCount,
      chunkChars,
      domNodes: track.getElementsByTagName('*').length,
      split: splitStats,
    }),
    destroy() {
      track.remove();
    },
  };
}
