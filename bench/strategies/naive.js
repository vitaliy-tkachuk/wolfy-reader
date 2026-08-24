import { offsetAtColumn } from './position.js';

/**
 * The control: the whole fragment handed to one CSS multi-column container.
 * No chunking, no virtualization. Paging translates the column track.
 */
export function create(container, html, options) {
  const { pageWidth, pageHeight, columnGap } = options;
  const advance = pageWidth + columnGap;

  const track = document.createElement('div');
  track.style.width = `${pageWidth}px`;
  track.style.height = `${pageHeight}px`;
  track.style.columnWidth = `${pageWidth}px`;
  track.style.columnGap = `${columnGap}px`;
  track.style.columnFill = 'auto';
  container.append(track);
  track.innerHTML = html;

  let pageCount = 1;
  let currentPage = 0;

  const measure = () => {
    pageCount = Math.max(1, Math.round((track.scrollWidth + columnGap) / advance));
  };

  const apply = () => {
    track.style.transform = `translateX(${-currentPage * advance}px)`;
  };

  measure();
  apply();

  return {
    pageCount: () => pageCount,
    pagesExact: () => true,
    goToPage(n) {
      currentPage = Math.max(0, Math.min(pageCount - 1, n));
      apply();
    },
    relayout() {
      measure();
      currentPage = Math.min(currentPage, pageCount - 1);
      apply();
    },
    realizeAll() {
      measure();
      return pageCount;
    },
    positionOfPage(n) {
      // The track is translated, so its own box left already is column 0.
      return offsetAtColumn([track], n, track.getBoundingClientRect().left, advance);
    },
    stats: () => ({ chunks: 1, realized: 1, domNodes: track.getElementsByTagName('*').length }),
    destroy() {
      track.remove();
    },
  };
}
