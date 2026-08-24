import * as chunked from './strategies/chunked.js';
import * as naive from './strategies/naive.js';

const strategies = { chunked, naive };

const viewport = document.getElementById('viewport');

let fixtureHtml = '';
let strategy = null;
let options = null;

// "Painted" is defined once, here, and both strategies go through it: the frame
// after the one that committed the mutation. A single rAF callback still runs
// before that frame is painted.
function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function forceLayout() {
  return viewport.getBoundingClientRect().width + viewport.scrollWidth;
}

function setViewport({ pageWidth, pageHeight, fontSize }) {
  viewport.style.width = `${pageWidth}px`;
  viewport.style.height = `${pageHeight}px`;
  document.documentElement.style.setProperty('--bench-font-size', `${fontSize}px`);
}

function quantiles(values) {
  if (values.length === 0) return { p50: null, p95: null, min: null, max: null, mean: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    p50: at(0.5),
    p95: at(0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

window.bench = {
  async loadFixture(url) {
    // Fetched before the timed window so network and decode never land inside
    // an "initial render" number.
    const response = await fetch(url);
    fixtureHtml = await response.text();
    return fixtureHtml.length;
  },

  async setup(config) {
    if (strategy !== null) {
      strategy.destroy();
      strategy = null;
    }
    viewport.replaceChildren();
    options = config.options;
    setViewport(options);
    document.documentElement.style.setProperty('--bench-font-size', `${options.fontSize}px`);
    forceLayout();

    const factory = strategies[config.strategy];
    const t0 = performance.now();
    strategy = factory.create(viewport, fixtureHtml, options);
    forceLayout();
    const tLayout = performance.now();
    await nextPaint();
    const tPaint = performance.now();

    return {
      layoutMs: tLayout - t0,
      paintMs: tPaint - t0,
      pageCount: strategy.pageCount(),
      pagesExact: strategy.pagesExact(),
      stats: strategy.stats(),
    };
  },

  async turns(count) {
    const layout = [];
    const paint = [];
    const pages = strategy.pageCount();
    for (let i = 0; i < count; i += 1) {
      const target = pages > 1 ? (i + 1) % pages : 0;
      const t0 = performance.now();
      strategy.goToPage(target);
      forceLayout();
      const t1 = performance.now();
      await nextPaint();
      const t2 = performance.now();
      layout.push(t1 - t0);
      paint.push(t2 - t0);
    }
    return {
      layout: quantiles(layout),
      paint: quantiles(paint),
      samples: layout.length,
      pageCountAfter: strategy.pageCount(),
      pagesExact: strategy.pagesExact(),
      realized: strategy.stats().realized,
    };
  },

  // Sequential turns never leave the front of a long chapter, which flatters a
  // strategy that only materializes what has been visited. Seeks jump across
  // the whole document instead — chunked's worst case, naive's best.
  async seeks(count) {
    const layout = [];
    const paint = [];
    const pages = strategy.pageCount();
    let seed = 0x2f6e2b1;
    for (let i = 0; i < count; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const target = pages > 1 ? seed % pages : 0;
      const t0 = performance.now();
      strategy.goToPage(target);
      forceLayout();
      const t1 = performance.now();
      await nextPaint();
      const t2 = performance.now();
      layout.push(t1 - t0);
      paint.push(t2 - t0);
    }
    return {
      layout: quantiles(layout),
      paint: quantiles(paint),
      samples: layout.length,
      realized: strategy.stats().realized,
      chunks: strategy.stats().chunks,
    };
  },

  async relayout(fontSize) {
    strategy.goToPage(0);
    forceLayout();
    await nextPaint();
    const t0 = performance.now();
    document.documentElement.style.setProperty('--bench-font-size', `${fontSize}px`);
    strategy.relayout();
    forceLayout();
    const tLayout = performance.now();
    await nextPaint();
    const tPaint = performance.now();
    return {
      layoutMs: tLayout - t0,
      paintMs: tPaint - t0,
      pageCount: strategy.pageCount(),
      pagesExact: strategy.pagesExact(),
    };
  },

  async positions(count) {
    const samples = [];
    const pages = strategy.pageCount();
    for (let i = 0; i < count; i += 1) {
      const target = pages > 1 ? Math.floor((i * pages) / count) : 0;
      strategy.goToPage(target);
      forceLayout();
      const t0 = performance.now();
      const offset = strategy.positionOfPage(target);
      const t1 = performance.now();
      if (offset !== null) samples.push(t1 - t0);
    }
    return { ...quantiles(samples), samples: samples.length, attempted: count };
  },

  async exactPageCount(fontSize) {
    // Restore the base font first, untimed, so the exact page count is directly
    // comparable to the one reported at setup.
    document.documentElement.style.setProperty('--bench-font-size', `${fontSize}px`);
    strategy.relayout();
    forceLayout();
    await nextPaint();
    const t0 = performance.now();
    const pages = strategy.realizeAll();
    forceLayout();
    const tLayout = performance.now();
    await nextPaint();
    return { ms: tLayout - t0, paintMs: performance.now() - t0, pageCount: pages };
  },

  memory() {
    const memory = performance.memory;
    return {
      usedJSHeapSize: memory ? memory.usedJSHeapSize : null,
      totalJSHeapSize: memory ? memory.totalJSHeapSize : null,
      domNodes: document.getElementsByTagName('*').length,
    };
  },

  teardown() {
    if (strategy !== null) strategy.destroy();
    strategy = null;
    viewport.replaceChildren();
  },
};

window.__benchReady = true;
