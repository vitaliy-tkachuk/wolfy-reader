import { escapeXmlAttribute } from '../core/text.ts';

export const CONTENT_ROOT_ID = 'wolfy-reader-content';

/** Class marking each per-chunk container the host emits into the frame body. */
export const CHUNK_CLASS = 'wolfy-reader-chunk';
/** Cumulative character offset of a chunk's first glyph into the section text. */
export const CHUNK_START_ATTR = 'data-chunk-start';
/** Cumulative character offset just past a chunk's last glyph. */
export const CHUNK_END_ATTR = 'data-chunk-end';
/** Zero-based index of a chunk in section order. */
export const CHUNK_INDEX_ATTR = 'data-chunk-index';

/** Class every draw-only decoration overlay box carries, alongside the caller's class. */
export const DECORATION_CLASS = 'wolfy-reader-decoration';

/**
 * A minimal reset and nothing else. Column geometry belongs to the paginator
 * and typography to the appearance controls; the host's job is to stay out of
 * the way of both, so it must not put the body in a column context.
 */
const RESET_CSS = [
  'html{box-sizing:border-box}',
  '*,*::before,*::after{box-sizing:inherit}',
  'body{margin:0}',
  // Both axes: a column is a page, so a replaced element taller than the page (a
  // portrait cover at column width) would overflow it and be clipped by the root —
  // monolithic boxes do not fragment across columns. relayout publishes the page
  // height as --wr-page-height; the viewport is the fallback before first layout.
  'img,svg{max-width:100%;max-height:var(--wr-page-height,100vh);height:auto}',
  // A draw-only decoration overlay: pointer-transparent and given a visible default
  // so a bare `decorate` shows without host CSS. It carries the caller's class too, so
  // an appearance stylesheet can restyle it; a host that wants a different look targets
  // its own class. The default is deliberately mild (translucent), below the text.
  `.${DECORATION_CLASS}{pointer-events:none;background:rgba(255,214,0,0.4);border-radius:2px;mix-blend-mode:multiply}`,
].join('');

/**
 * Delivered as a meta element because a library with no server cannot set a
 * header. That costs the three header-only directives — `frame-ancestors`,
 * `sandbox` and `report-uri` — and means the element must be the first thing in
 * the document, since nothing before it is covered.
 *
 * `script-src` names a per-render nonce rather than allowing inline script, so
 * a script that somehow survived sanitization still cannot run: the nonce is
 * unguessable and unreadable by anything that is not already executing. That
 * also blocks `javascript:` URLs, which need `'unsafe-inline'` to run.
 *
 * `data:` is the only source of content because the frame's opaque origin is
 * refused the host's `blob:` URLs. It grants no reach — a data URL carries its
 * own bytes and fetches nothing — so egress stays closed.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline' data:",
    'img-src data:',
    'font-src data:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function coordinationScript(hostOrigin: string, keyboardNav: boolean = true): string {
  return `(function(){
'use strict';
var VERSION = 13;
var host = window.parent;
var target = ${JSON.stringify(hostOrigin)};
// Whether the host acts on forwarded nav keys. Baked in at document assembly
// (like the theme stylesheet), never sent over the wire, so it is not a
// protocol field and needs no version bump. It gates only preventDefault —
// forwarding stays unconditional and the host ignores what it has disabled.
var KEYBOARD_NAV = ${JSON.stringify(keyboardNav)};
var ROOT_ID = ${JSON.stringify(CONTENT_ROOT_ID)};
var CHUNK_CLASS = ${JSON.stringify(CHUNK_CLASS)};
var START_ATTR = ${JSON.stringify(CHUNK_START_ATTR)};
var END_ATTR = ${JSON.stringify(CHUNK_END_ATTR)};
function send(message){ try { host.postMessage(message, target); } catch (error) {} }

// Hand-maintained copy of asHostMessage from protocol.ts. Kept in step by hand
// because this script is a string template and cannot import. See protocol.ts.
function validateHost(data){
  if (data === null || typeof data !== 'object' || data.v !== VERSION) return null;
  if (typeof data.id !== 'number') return null;
  var t = data.type;
  if (t === 'ping' || t === 'measure' || t === 'relayout' || t === 'sectionText' || t === 'diagnostics') return data;
  if (t === 'paginate') {
    var o = data.options;
    if (o === null || typeof o !== 'object') return null;
    if (o.mode !== 'paginated' && o.mode !== 'scrolled') return null;
    if (typeof o.pageWidth !== 'number' || typeof o.pageHeight !== 'number') return null;
    if (typeof o.columnGap !== 'number' || typeof o.chunkChars !== 'number') return null;
    if (typeof o.windowChunks !== 'number' || typeof o.columnCount !== 'number') return null;
    return data;
  }
  if (t === 'goToPage' || t === 'offsetOfPage') return typeof data.page === 'number' ? data : null;
  if (t === 'pageOfOffset' || t === 'scrollToOffset') return typeof data.offset === 'number' ? data : null;
  if (t === 'offsetOfElementId') return typeof data.elementId === 'string' ? data : null;
  if (t === 'decorate') {
    if (typeof data.decorationId !== 'string' || typeof data.className !== 'string') return null;
    if (typeof data.start !== 'number' || typeof data.end !== 'number') return null;
    return data;
  }
  if (t === 'undecorate') return typeof data.decorationId === 'string' ? data : null;
  return null;
}

// Live pagination state, rebuilt on paginate and re-measured on relayout.
var layout = {
  mode: 'paginated',
  pageWidth: 0,
  pageHeight: 0,
  columnGap: 0,
  columnCount: 1,
  windowChunks: 2,
  chunks: [],       // { el, index, start, end, top, height, pages, firstPage }
  pageCount: 0,
  contentWidth: 0,
  contentHeight: 0,
  firm: false
};

function chunkContainers(){
  var root = document.getElementById(ROOT_ID) || document.body;
  var found = root.getElementsByClassName(CHUNK_CLASS);
  var list = [];
  for (var i = 0; i < found.length; i++) list.push(found[i]);
  return list;
}

function numAttr(el, name){
  var v = parseInt(el.getAttribute(name) || '', 10);
  return isNaN(v) ? 0 : v;
}

// Measure one chunk's laid-out content extent. Each chunk is its own
// multi-column formatting context, so its horizontal content width (scrollWidth)
// divided by the page stride yields its page count. Range rects length-checked.
function measureChunkWidth(el){
  // scrollWidth of a multi-column box grows with the number of columns, so it is
  // the total painted width. Guard against a zero-width container.
  var w = el.scrollWidth;
  if (w > 0) return w;
  var range = document.createRange();
  try {
    range.selectNodeContents(el);
    var rects = range.getClientRects();
    if (rects.length === 0) return 0;
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < rects.length; i++){
      if (rects[i].left < min) min = rects[i].left;
      if (rects[i].right > max) max = rects[i].right;
    }
    return max > min ? (max - min) : 0;
  } finally {
    range.detach && range.detach();
  }
}

// The width of a single CSS column. columnGap is the reader's one spacing unit:
// it is the page-edge margin AND the gutter between columns, so a page reads
// margin, col, margin, col, ..., margin. The text area is the page minus its two
// edge margins; N columns and (N-1) inter-column gaps then share that inner width.
function colWidth(){
  var n = layout.columnCount > 0 ? layout.columnCount : 1;
  var inner = layout.pageWidth - 2 * layout.columnGap;
  if (n <= 1) return inner;
  return (inner - (n - 1) * layout.columnGap) / n;
}
// The horizontal distance one page-turn translates the active chunk: N column
// strides. Each column stride is its width plus the gap that follows it, so N
// columns advance by N * (colWidth + columnGap). With the edge-margin geometry this
// equals pageWidth - columnGap, which lands every page's columns inside the same
// left/right margins — the mapping math (offsetOfPage/pageOfOffset) reads live box
// positions and this stride, so it needs no edge-margin term of its own.
function stride(){
  var n = layout.columnCount > 0 ? layout.columnCount : 1;
  return n * (colWidth() + layout.columnGap);
}

// The chunk (and its local page) that paints a given global page, or null. Shared
// by every page→chunk seam so the [firstPage, firstPage+pages) test lives once.
function chunkAtPage(page){
  for (var i = 0; i < layout.chunks.length; i++){
    var ch = layout.chunks[i];
    if (page >= ch.firstPage && page < ch.firstPage + ch.pages) return ch;
  }
  return null;
}

// The chunk covering a section-text character offset, or null.
function chunkAtOffset(offset){
  for (var i = 0; i < layout.chunks.length; i++){
    var ch = layout.chunks[i];
    if (offset >= ch.start && offset < ch.end) return ch;
  }
  return null;
}

// Realize a chunk so a Range can measure its real text even if it was evicted
// (content-visibility:auto skips layout for off-screen chunks). Every measuring
// seam calls this rather than poking the style ad hoc.
function realize(el){ el.style.contentVisibility = 'visible'; }

// (Re)apply geometry to every chunk container and recompute the page map. In
// paginated mode each chunk is an absolutely-positioned multi-column context and
// contributes ceil(contentWidth / pageStride) pages; boundaries are forced page
// breaks so per-chunk page counts simply sum. In scrolled mode chunks stack
// vertically in normal flow with no paging.
// The page geometry below assumes html, body and the content root are plain
// zero-inset boxes: a publisher stylesheet that gives the body a margin, padding,
// border or width (Gutenberg: body{margin-left:10%;margin-right:10%}) shifts and
// narrows the box the chunks are positioned in, so every page paints offset and
// clipped on one edge. The reset stylesheet cannot hold against it (a later or
// more specific publisher rule wins), so the box model is pinned inline and
// important — the one thing no stylesheet outranks. Edge margins are the
// paginator's own (columnGap), applied to the chunks; nothing is lost.
function pinBoxModel(el, sizing){
  var props = [['margin','0'],['padding','0'],['border','0'],['min-width','0'],['max-width','none']];
  // The root's width/height are the page viewport and are set below; only the
  // viewport boxes above it get their width pinned.
  if (sizing) props.push(['width','auto'],['height','auto']);
  for (var i = 0; i < props.length; i++) el.style.setProperty(props[i][0], props[i][1], 'important');
}
function relayout(){
  var els = chunkContainers();
  layout.chunks = [];
  var root = document.getElementById(ROOT_ID) || document.body;
  pinBoxModel(document.documentElement, true);
  pinBoxModel(document.body, true);
  if (root !== document.body) pinBoxModel(root, false);
  document.documentElement.style.setProperty('--wr-page-height', layout.pageHeight ? (layout.pageHeight + 'px') : '100vh');
  if (layout.mode === 'scrolled'){
    // The document scrolls vertically to read, so restore that; but clip the
    // horizontal axis so an over-wide element (a broad table, a long pre) cannot add
    // a stray sideways scrollbar to what is a vertical reading surface.
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';
    root.style.position = '';
    root.style.width = layout.pageWidth ? (layout.pageWidth + 'px') : '';
    root.style.height = '';
    var top = 0;
    for (var i = 0; i < els.length; i++){
      var el = els[i];
      el.style.position = 'static';
      el.style.columnWidth = 'auto';
      el.style.width = layout.pageWidth ? (layout.pageWidth + 'px') : 'auto';
      // Scrolled text gets the same left/right edge margins as a page (box-sizing is
      // border-box, so the padding eats into pageWidth rather than overflowing it).
      el.style.paddingLeft = layout.columnGap + 'px';
      el.style.paddingRight = layout.columnGap + 'px';
      el.style.height = 'auto';
      el.style.contentVisibility = '';
      var h = el.offsetHeight;
      layout.chunks.push({
        el: el, index: numAttr(el, ${JSON.stringify(CHUNK_INDEX_ATTR)}),
        start: numAttr(el, START_ATTR), end: numAttr(el, END_ATTR),
        top: top, height: h, pages: 0, firstPage: 0
      });
      top += h;
    }
    layout.pageCount = 0;
    layout.contentWidth = layout.pageWidth;
    layout.contentHeight = top;
    layout.firm = true;
    return;
  }
  // Paginated. The root box is the page viewport (overflow:hidden). The document
  // must never scroll: each chunk is a multi-column context whose later columns lay
  // out far to the right and a page turn translates them into view, so without this
  // the off-page columns give html/body a wide scrollWidth and a stray scrollbar.
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  root.style.position = 'relative';
  root.style.width = layout.pageWidth + 'px';
  root.style.height = layout.pageHeight + 'px';
  root.style.overflow = 'hidden';
  var pageStride = stride();
  var pageAcc = 0;
  var maxWidth = 0;
  for (var j = 0; j < els.length; j++){
    var c = els[j];
    c.style.position = 'absolute';
    c.style.top = '0';
    // Inset the chunk by one margin so every page shows a left edge margin; the
    // width is the page minus both edge margins, so a right margin falls out too.
    // The edge margin here is positional (left/width), not padding — a chunk that
    // was scrolled carries padding, which must be cleared so it is not inset twice.
    c.style.left = layout.columnGap + 'px';
    c.style.paddingLeft = '0';
    c.style.paddingRight = '0';
    c.style.height = layout.pageHeight + 'px';
    // Each chunk is its own multi-column context. The CSS column width is one
    // reader column (a fraction of the inner width for a 2-column layout); the page
    // turn translates by stride() (N columns), so a page paints N columns at once.
    c.style.columnWidth = colWidth() + 'px';
    c.style.columnGap = layout.columnGap + 'px';
    c.style.columnFill = 'auto';
    c.style.width = (layout.pageWidth - 2 * layout.columnGap) + 'px';
    // The chunk must NOT clip: its multi-column overflow (columns 2, 3, …) lays
    // out to the right, and a page turn reveals a later column by translating the
    // whole chunk left. A clip here would travel with the box and paint only the
    // first column — every page after the first would be blank. The root box owns
    // the viewport clip; the chunk stays visible so its columns can scroll in.
    c.style.overflow = 'visible';
    c.style.contentVisibility = 'visible';
    var cw = measureChunkWidth(c);
    var pages = cw <= 0 ? 1 : Math.max(1, Math.ceil((cw + layout.columnGap) / pageStride));
    if (cw > maxWidth) maxWidth = cw;
    layout.chunks.push({
      el: c, index: numAttr(c, ${JSON.stringify(CHUNK_INDEX_ATTR)}),
      start: numAttr(c, START_ATTR), end: numAttr(c, END_ATTR),
      top: 0, height: layout.pageHeight, pages: pages, firstPage: pageAcc
    });
    pageAcc += pages;
  }
  layout.pageCount = pageAcc;
  layout.contentWidth = maxWidth;
  layout.contentHeight = layout.pageHeight;
  layout.firm = true;
  applyWindow(currentPage());
}

// content-visibility:auto on chunks outside the retained window. Geometry stays
// recorded in layout.chunks, so page numbers do not shift when a chunk is
// un-realized; it re-lays-out on return.
var activeChunk = 0;
function currentPage(){ return activeChunk; }
function applyWindow(centerPage){
  var center = 0;
  for (var i = 0; i < layout.chunks.length; i++){
    var ch = layout.chunks[i];
    if (centerPage >= ch.firstPage && centerPage < ch.firstPage + ch.pages){ center = i; break; }
  }
  activeChunk = center;
  for (var k = 0; k < layout.chunks.length; k++){
    var chunk = layout.chunks[k];
    var near = Math.abs(k - center) <= layout.windowChunks;
    chunk.el.style.contentVisibility = near ? 'visible' : 'auto';
    chunk.el.style.containIntrinsicSize = near ? '' :
      (layout.pageWidth + 'px ' + layout.pageHeight + 'px');
  }
}

function realizedCount(){
  var n = 0;
  for (var i = 0; i < layout.chunks.length; i++){
    if (layout.chunks[i].el.style.contentVisibility !== 'auto') n++;
  }
  return n;
}

function paginationState(){
  return {
    pageCount: layout.pageCount,
    firm: layout.firm,
    realizedChunks: realizedCount(),
    totalChunks: layout.chunks.length,
    contentWidth: layout.contentWidth,
    contentHeight: layout.contentHeight
  };
}

// Position the visible window so that page number \`page\` (0-based) is shown. Each
// chunk paints its own columns from its own left origin, so scrolling a page
// means translating the active chunk left by the intra-chunk column stride and
// hiding the others.
function goToPage(page){
  if (layout.pageCount <= 0) return 0;
  if (page < 0) page = 0;
  if (page >= layout.pageCount) page = layout.pageCount - 1;
  var target = chunkAtPage(page);
  var localPage = target === null ? 0 : page - target.firstPage;
  applyWindow(page);
  for (var j = 0; j < layout.chunks.length; j++){
    var c = layout.chunks[j];
    if (c === target){
      c.el.style.visibility = 'visible';
      c.el.style.transform = 'translateX(' + (-(localPage * stride())) + 'px)';
    } else {
      c.el.style.visibility = 'hidden';
      c.el.style.transform = '';
    }
  }
  return page;
}

// A chunk's text nodes collected once with cumulative start offsets, so a probe
// maps a chunk-local character index to (node, intra-node offset) by binary
// search rather than re-walking the tree. rectAt(i) is the first client rect of
// the character at chunk-local index i, or null when it has none (zero-width
// anchors, collapsed whitespace — the empty-rect gotcha).
function textProbe(chunk){
  var walker = document.createTreeWalker(chunk.el, NodeFilter.SHOW_TEXT, null);
  var nodes = [], starts = [], total = 0, node;
  while ((node = walker.nextNode())){
    nodes.push(node); starts.push(total); total += node.data.length;
  }
  var range = document.createRange();
  function rectAt(i){
    if (i < 0 || i >= total) return null;
    var lo = 0, hi = nodes.length - 1;
    while (lo < hi){
      var mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= i) lo = mid; else hi = mid - 1;
    }
    range.setStart(nodes[lo], i - starts[lo]);
    range.setEnd(nodes[lo], i - starts[lo] + 1);
    var rects = range.getClientRects();
    return rects.length === 0 ? null : rects[0];
  }
  return { total: total, rectAt: rectAt };
}

// The smallest measurable chunk-local index whose rect satisfies \`reached\`, as
// { index, rect }, or null when no measurable character does. \`reached\` must be
// monotonic in text order, which is what makes the halving sound (~log n rect
// probes over a <= ~8000-char chunk, never one probe per character). Unmeasurable
// characters are skipped by scanning forward to the next measurable one inside
// each probe.
function firstReaching(probe, reached){
  var low = 0, high = probe.total, best = null;
  while (low < high){
    var midpoint = (low + high) >> 1;
    var found = null;
    for (var j = midpoint; j < high; j++){
      var rect = probe.rectAt(j);
      if (rect !== null){ found = { index: j, rect: rect }; break; }
    }
    if (found === null){
      high = midpoint;
    } else if (reached(found.rect)){
      best = found;
      high = found.index;
    } else {
      low = found.index + 1;
    }
  }
  return best;
}

// Scrolled mode has no page bands: the reading place is the first glyph at or
// below the viewport top, at the live scroll offset. Vertical flow is monotonic
// in document y for normal-flow block content, so the same binary search applies
// with the viewport top in place of a column band (floats are the known
// exception; a mis-probe degrades to a nearby glyph, never a throw). The chunk is
// the first whose box still reaches below the viewport top; the -1 tolerates
// sub-pixel rounding of the scroll offset. A chunk with no measurable glyph at or
// below the top falls back to its start offset.
function offsetAtScrollTop(){
  if (layout.chunks.length === 0) return -1;
  var chunk = layout.chunks[layout.chunks.length - 1];
  for (var i = 0; i < layout.chunks.length; i++){
    if (layout.chunks[i].el.getBoundingClientRect().bottom > 1){ chunk = layout.chunks[i]; break; }
  }
  realize(chunk.el);
  var best = firstReaching(textProbe(chunk), function(rect){ return rect.top >= -1; });
  return best === null ? chunk.start : chunk.start + best.index;
}

// Map a page (0-based) to the character offset of its first painted glyph.
// Column flow lays text out monotonically: the column — and therefore the page
// band — a character paints in never decreases as its text offset grows, so the
// first character of a page is the first whose band is >= the page's. In scrolled
// mode the page is ignored and the live scroll offset is read instead.
function offsetOfPage(page){
  if (layout.mode === 'scrolled') return offsetAtScrollTop();
  if (page < 0 || page >= layout.pageCount) return -1;
  var chunk = chunkAtPage(page);
  if (chunk === null) return -1;
  realize(chunk.el);
  var localPage = page - chunk.firstPage;
  var boxLeft = chunk.el.getBoundingClientRect().left;
  var pageStride = stride();
  var probe = textProbe(chunk);
  if (probe.total === 0) return chunk.start;
  // The local page band painting a rect. The +1 tolerates sub-pixel rounding.
  function bandOf(rect){ return Math.floor((rect.left - boxLeft + 1) / pageStride); }
  var best = firstReaching(probe, function(rect){ return bandOf(rect) >= localPage; });
  // A page whose band holds no measurable character keeps the old fallback: the
  // chunk's own start offset.
  if (best !== null && bandOf(best.rect) === localPage) return chunk.start + best.index;
  return chunk.start;
}

// Scrolled-mode seek: put the glyph at \`offset\` at the top of the viewport and
// return the resulting scroll offset. Offsets past the end scroll to the bottom,
// before the start to 0; an unmeasurable glyph is skipped forward to the next
// measurable one in its chunk, and a chunk with none lands on its own top. The
// section's first glyph is the one exception: it lands at 0, so the section top
// (a heading's margin above its first line) is shown rather than cut, exactly as
// page 0 shows it. In paginated mode the document never scrolls, so this is a
// no-op reporting the (always 0) offset.
function scrollToOffset(offset){
  var scroller = document.scrollingElement || document.documentElement;
  if (layout.mode !== 'scrolled') return scroller.scrollTop;
  var max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  var chunk = chunkAtOffset(offset);
  var y;
  if (chunk === null){
    y = (layout.chunks.length === 0 || offset < layout.chunks[0].start) ? 0 : max;
  } else {
    realize(chunk.el);
    var probe = textProbe(chunk);
    var glyph = null;
    for (var i = offset - chunk.start; i < probe.total && glyph === null; i++){
      var rect = probe.rectAt(i);
      if (rect !== null) glyph = { index: i, rect: rect };
    }
    if (glyph === null){
      y = scroller.scrollTop + chunk.el.getBoundingClientRect().top;
    } else {
      var first = chunk === layout.chunks[0] ? firstReaching(probe, function(){ return true; }) : null;
      y = first !== null && first.index === glyph.index ? 0 : scroller.scrollTop + glyph.rect.top;
    }
  }
  window.scrollTo(0, Math.min(max, Math.max(0, y)));
  return scroller.scrollTop;
}

// Inverse: which page paints the glyph at this section-text offset. Scrolled mode
// is a single logical page, so every offset is on page 0; the seek itself goes
// through scrollToOffset.
function pageOfOffset(offset){
  if (layout.mode === 'scrolled') return 0;
  var chunk = chunkAtOffset(offset);
  if (chunk === null){
    // Past the end: last page. Before the start: first page.
    if (layout.chunks.length === 0) return 0;
    return offset < layout.chunks[0].start ? 0 : layout.pageCount - 1;
  }
  realize(chunk.el);
  var local = offset - chunk.start;
  var walker = document.createTreeWalker(chunk.el, NodeFilter.SHOW_TEXT, null);
  var acc = 0, node;
  var boxLeft = chunk.el.getBoundingClientRect().left;
  while ((node = walker.nextNode())){
    var len = node.data.length;
    if (local < acc + len){
      var p = local - acc;
      var range = document.createRange();
      range.setStart(node, p);
      range.setEnd(node, Math.min(p + 1, len));
      var rects = range.getClientRects();
      if (rects.length > 0){
        var left = rects[0].left - boxLeft;
        var localPage = Math.max(0, Math.floor(left / stride()));
        return chunk.firstPage + Math.min(localPage, chunk.pages - 1);
      }
      return chunk.firstPage;
    }
    acc += len;
  }
  return chunk.firstPage;
}

// Map an element id to its character offset into the section's concatenated text.
// Find the element, walk up to its enclosing chunk container, then measure the
// text length from the chunk container's start to just before the element with a
// Range: range.toString().length added to the chunk's cumulative start offset is
// the offset. Returns -1 when no element carries the id.
function offsetOfElementId(elementId){
  var el = document.getElementById(elementId);
  if (el === null) return -1;
  // Walk up to the enclosing chunk container.
  var chunkEl = el;
  while (chunkEl && !(chunkEl.nodeType === 1 && chunkEl.className &&
      (' ' + chunkEl.className + ' ').indexOf(' ' + CHUNK_CLASS + ' ') !== -1)){
    chunkEl = chunkEl.parentNode;
  }
  if (!chunkEl || chunkEl.nodeType !== 1) return -1;
  // The element (or its chunk) may be un-realized; force it visible so the Range
  // measures real text, mirroring offsetOfPage/pageOfOffset.
  realize(chunkEl);
  var chunkStart = numAttr(chunkEl, START_ATTR);
  var range = document.createRange();
  try {
    range.setStart(chunkEl, 0);
    range.setEndBefore(el);
    // Touch the rects (length-checked) so the layout is up to date, matching the
    // other seams; the offset itself comes from the range's text length.
    var rects = range.getClientRects();
    void (rects.length > 0);
    return chunkStart + range.toString().length;
  } finally {
    range.detach && range.detach();
  }
}

function sectionText(){
  var text = '';
  if (layout.chunks.length > 0){
    for (var i = 0; i < layout.chunks.length; i++) text += layout.chunks[i].el.textContent || '';
  } else {
    // Before the first paginate the layout is empty; read the containers directly.
    var els = chunkContainers();
    for (var j = 0; j < els.length; j++) text += els[j].textContent || '';
  }
  return text;
}

function applyOptions(o){
  layout.mode = o.mode;
  layout.pageWidth = o.pageWidth;
  layout.pageHeight = o.pageHeight;
  layout.columnGap = o.columnGap;
  layout.columnCount = o.columnCount > 0 ? o.columnCount : 1;
  layout.windowChunks = o.windowChunks;
}

// Draw-only decorations. The host resolves a Position to a UTF-16 offset range over
// the tiled section text and sends it here; the frame maps that range to a DOM Range,
// reads its client rects, and paints one absolutely-positioned overlay box per rect.
// The library only DRAWS — it holds no annotation data beyond the live intent needed
// to re-paint across a re-layout, and never persists or fetches. Overlays are
// pointer-transparent (must not eat a selection or a link click) and layout-neutral
// (appended inside the chunk container, absolutely positioned, so they change no page
// geometry and translate with the chunk on a page turn).
var decorations = {};       // decorationId -> { start, end, className, order }
var decorationBoxes = {};   // decorationId -> [box elements]
var DECORATION_CLASS = ${JSON.stringify(DECORATION_CLASS)};
// Monotonic draw counter: the only order the frame can know between overlapping
// decorations is recency, so a tap reports the most recently decorated first.
var decorationOrder = 0;

// Find the (node, offset) DOM point for a global UTF-16 offset into the concatenated
// chunk-container text — the inverse of offsetOfPoint used by selection. Walks the
// chunk containers, accumulating live textContent length, and stops at the node that
// spans the offset. textContent is DOM, not layout, so the accumulation walk must not
// realize the chunks it merely passes over — only the chunk that owns the offset is
// realized (the caller needs its client rects), so a decoration in a late chunk
// leaves the content-visibility eviction window intact. Returns null when the offset
// is past the realized text (a soft-miss the caller draws nothing for).
function pointAtOffset(target){
  var chunks = chunkContainers();
  var acc = 0;
  for (var i = 0; i < chunks.length; i++){
    var el = chunks[i];
    var len = (el.textContent || '').length;
    if (target <= acc + len){
      realize(el);
      var local = target - acc;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var nodeAcc = 0, node;
      while ((node = walker.nextNode())){
        var nlen = node.data.length;
        if (local <= nodeAcc + nlen){
          return { chunk: el, node: node, offset: local - nodeAcc };
        }
        nodeAcc += nlen;
      }
      // Offset lands exactly at the chunk's end with no trailing text node.
      return { chunk: el, node: el, offset: el.childNodes.length };
    }
    acc += len;
  }
  return null;
}

// Erase every overlay box painted for a decoration id.
function removeDecorationBoxes(decorationId){
  var boxes = decorationBoxes[decorationId];
  if (boxes){
    for (var i = 0; i < boxes.length; i++){
      if (boxes[i].parentNode) boxes[i].parentNode.removeChild(boxes[i]);
    }
  }
  decorationBoxes[decorationId] = [];
}

// Paint one overlay box per client rect of the decoration's offset range. Boxes are
// appended inside the range's start chunk container (the positioned, page-turn-
// translated element) and positioned relative to it, so they ride the same transform
// as the text they cover. Guards an empty getClientRects() (the zero-width-anchor /
// empty-inline gotcha) — an empty rect list draws nothing, never a malformed box.
// Returns the number of boxes painted (0 on a soft-miss).
function paintDecoration(decorationId, start, end, className){
  removeDecorationBoxes(decorationId);
  if (end < start){ var swap = start; start = end; end = swap; }
  var from = pointAtOffset(start);
  var to = pointAtOffset(end);
  if (from === null || to === null) return 0;
  var range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch (error) {
    return 0;
  }
  var rects = range.getClientRects();
  if (rects.length === 0) return 0;
  // The overlay boxes live inside the chunk that owns the range start, positioned in
  // that chunk's coordinate space so a page-turn transform carries them along. Each
  // box's absolute offset is the rect's viewport position minus the chunk's padding-
  // box origin; both are measured post-transform, so the offset is transform-invariant
  // and the box rides the same translateX the text does on a page turn.
  var container = from.chunk;
  var origin = container.getBoundingClientRect();
  var boxes = [];
  for (var i = 0; i < rects.length; i++){
    var rect = rects[i];
    if (rect.width <= 0 || rect.height <= 0) continue;
    var box = document.createElement('div');
    box.className = DECORATION_CLASS + (className ? ' ' + className : '');
    box.setAttribute('data-decoration', decorationId);
    box.style.position = 'absolute';
    box.style.pointerEvents = 'none';
    box.style.left = (rect.left - origin.left) + 'px';
    box.style.top = (rect.top - origin.top) + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    container.appendChild(box);
    boxes.push(box);
  }
  decorationBoxes[decorationId] = boxes;
  return boxes.length;
}

// The decorations whose painted boxes contain the frame-viewport point, most recently
// decorated first. Overlays are pointer-transparent by design (a tap must reach the
// text beneath so selection keeps working), so this is a rect walk over the painted
// boxes, not elementFromPoint. Every chunk container sits at the same origin and the
// inactive ones are merely visibility:hidden, so a box in a hidden chunk can share
// viewport coordinates with the visible page — visibility inherits, so the computed
// style of the box itself says whether it is actually on screen.
function decorationsAt(x, y){
  var hits = [];
  for (var decorationId in decorationBoxes){
    if (!Object.prototype.hasOwnProperty.call(decorationBoxes, decorationId)) continue;
    var d = decorations[decorationId];
    if (!d) continue;
    var boxes = decorationBoxes[decorationId];
    for (var i = 0; i < boxes.length; i++){
      var box = boxes[i];
      if (!box.parentNode) continue;
      var r = box.getBoundingClientRect();
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue;
      if (getComputedStyle(box).visibility === 'hidden') continue;
      hits.push({ id: decorationId, order: d.order, className: d.className, boxes: boxes });
      break;
    }
  }
  hits.sort(function(a, b){ return b.order - a.order; });
  return hits;
}
// The entries a decorationtap carries: each hit's visible geometry over its painted
// boxes, in the same space and clipping as a selection's rects.
function tappedDecorations(hits){
  var entries = [];
  for (var i = 0; i < hits.length; i++){
    var rects = [];
    for (var j = 0; j < hits[i].boxes.length; j++) rects.push(hits[i].boxes[j].getBoundingClientRect());
    var geometry = visibleGeometry(rects);
    entries.push({ id: hits[i].id, className: hits[i].className, rect: geometry.rect, rects: geometry.rects });
  }
  return entries;
}

// Re-paint every live decoration. Called after a relayout / window shift so overlays
// track the text their offset ranges cover across a re-flow.
function repaintDecorations(){
  for (var decorationId in decorations){
    if (!Object.prototype.hasOwnProperty.call(decorations, decorationId)) continue;
    var d = decorations[decorationId];
    paintDecoration(decorationId, d.start, d.end, d.className);
  }
}

window.addEventListener('message', function(event){
  if (event.source !== host) return;
  var data = validateHost(event.data);
  if (data === null) return;
  var id = data.id;
  if (data.type === 'ping') { send({ v: VERSION, type: 'pong', id: id }); return; }
  if (data.type === 'measure') {
    var root = document.getElementById(ROOT_ID) || document.documentElement;
    send({ v: VERSION, type: 'measured', id: id, width: root.scrollWidth, height: root.scrollHeight });
    return;
  }
  if (data.type === 'paginate') { applyOptions(data.options); relayout(); repaintDecorations(); send({ v: VERSION, type: 'paginated', id: id, state: paginationState() }); return; }
  if (data.type === 'relayout') { relayout(); repaintDecorations(); send({ v: VERSION, type: 'paginated', id: id, state: paginationState() }); return; }
  if (data.type === 'goToPage') { var moved = goToPage(data.page); repaintDecorations(); send({ v: VERSION, type: 'movedToPage', id: id, page: moved }); return; }
  if (data.type === 'offsetOfPage') { send({ v: VERSION, type: 'offset', id: id, offset: offsetOfPage(data.page) }); return; }
  if (data.type === 'pageOfOffset') { send({ v: VERSION, type: 'page', id: id, page: pageOfOffset(data.offset) }); return; }
  if (data.type === 'scrollToOffset') { send({ v: VERSION, type: 'scrolledTo', id: id, top: scrollToOffset(data.offset) }); return; }
  if (data.type === 'offsetOfElementId') { send({ v: VERSION, type: 'offset', id: id, offset: offsetOfElementId(data.elementId) }); return; }
  if (data.type === 'sectionText') { send({ v: VERSION, type: 'text', id: id, text: sectionText() }); return; }
  if (data.type === 'diagnostics') {
    send({ v: VERSION, type: 'diagnosticsReport', id: id,
      domNodes: document.getElementsByTagName('*').length,
      realizedChunks: realizedCount(), totalChunks: layout.chunks.length });
    return;
  }
  if (data.type === 'decorate') {
    decorationOrder += 1;
    decorations[data.decorationId] = { start: data.start, end: data.end, className: data.className, order: decorationOrder };
    var boxes = paintDecoration(data.decorationId, data.start, data.end, data.className);
    send({ v: VERSION, type: 'decorated', id: id, boxes: boxes });
    return;
  }
  if (data.type === 'undecorate') {
    removeDecorationBoxes(data.decorationId);
    delete decorationBoxes[data.decorationId];
    delete decorations[data.decorationId];
    send({ v: VERSION, type: 'decorated', id: id, boxes: 0 });
    return;
  }
});
document.addEventListener('securitypolicyviolation', function(event){
  send({
    v: VERSION,
    type: 'violation',
    directive: String(event.effectiveDirective || event.violatedDirective || ''),
    blockedUri: String(event.blockedURI || '')
  });
});
window.addEventListener('error', function(event){
  send({ v: VERSION, type: 'error', message: String((event && event.message) || 'error') });
});
// Walk up from a node to an enclosing <a href>, or null if none. Shared by the
// click (link-click) path and the tap path so a link tap stays a link click.
function linkAncestor(node){
  while (node && node.nodeType === 1) {
    if (node.localName === 'a' && node.hasAttribute('href')) return node;
    node = node.parentNode;
  }
  return null;
}
// Walk up from a node to an enclosing <img src> (or SVG <image>), or null. Mirrors
// linkAncestor so a tap on a figure is distinguishable from a page-turn tap. The
// src is already a data: URL — applyResources substituted the full-resolution bytes
// into it — so forwarding it re-uses those bytes; no blob URL is ever minted.
function imageAncestor(node){
  while (node && node.nodeType === 1) {
    var name = node.localName;
    if (name === 'img' && node.getAttribute('src')) return node;
    if (name === 'image' && (node.getAttribute('href') || node.getAttribute('xlink:href'))) return node;
    node = node.parentNode;
  }
  return null;
}
document.addEventListener('click', function(event){
  var link = linkAncestor(event.target);
  if (link) {
    event.preventDefault();
    // Report the raw authored href, not node.href: the opaque origin resolves
    // the property against a null base and mangles it. The host/facade parses.
    send({ v: VERSION, type: 'linkclick', href: String(link.getAttribute('href') || '') });
  }
});

// Navigation-relevant keydowns are forwarded to the host, which owns the key
// map (direction-aware). Only the keys the reader acts on are forwarded. The
// forwarding is unconditional (the wire is not gated), but preventDefault is:
// KEYBOARD_NAV is the host's keyboard-input setting baked in at document
// assembly, and when the host has keyboard input disabled it will ignore the
// message, so suppressing the key's default action too would leave it dead.
// Space is Space/Shift+Space paging (a near-universal reader convention); it is
// forwarded as the normalized tokens 'Space' / 'Shift+Space' because event.key
// is ' ' for both and the wire carries no modifier field. Every other key is
// left untouched.
var NAV_KEYS = { ArrowLeft:1, ArrowRight:1, ArrowUp:1, ArrowDown:1, PageUp:1, PageDown:1, Home:1, End:1 };
document.addEventListener('keydown', function(event){
  var isSpace = event.key === ' ' || event.key === 'Spacebar';
  // Keyboard equivalent of a figure tap: Enter/Space on a focused image opens the
  // same host-side zoom overlay a pointer tap does, so zoom is reachable without a
  // pointer. Checked before paging so Space-to-activate wins on a focused image.
  // Images are made focusable below (markImages); imageAncestor also catches
  // Enter fired on a wrapper the image sits inside.
  if (event.key === 'Enter' || isSpace) {
    var img = imageAncestor(event.target);
    if (img) {
      event.preventDefault();
      var isrc = img.getAttribute('src') || img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      send({ v: VERSION, type: 'imagetap', src: String(isrc), alt: String(img.getAttribute('alt') || '') });
      return;
    }
  }
  if (NAV_KEYS[event.key] === 1 || isSpace) {
    if (KEYBOARD_NAV) event.preventDefault();
    send({ v: VERSION, type: 'key', key: isSpace ? (event.shiftKey ? 'Shift+Space' : 'Space') : event.key });
  }
});

// A figure is only tap-to-zoom by default; making each content image focusable and
// button-roled is what lets a keyboard user reach the zoom overlay. Marked as chunks
// realize (content is virtualized), idempotently, without touching the sandbox: these
// are ARIA/tabindex attributes only, no new capability.
function markImage(img){
  if (img.getAttribute('data-wr-activatable') === '1') return;
  img.setAttribute('data-wr-activatable', '1');
  if (!img.hasAttribute('tabindex')) img.setAttribute('tabindex', '0');
  if (!img.hasAttribute('role')) img.setAttribute('role', 'button');
  if (!img.getAttribute('aria-label')) {
    var label = img.getAttribute('alt') || 'Image';
    img.setAttribute('aria-label', label + ' — press Enter to zoom');
  }
}
function markImages(scope){
  if (!scope || !scope.getElementsByTagName) return;
  var imgs = scope.getElementsByTagName('img');
  for (var i = 0; i < imgs.length; i++) markImage(imgs[i]);
}
function setupImageActivation(){
  var root = document.getElementById(ROOT_ID) || document.body;
  if (!root) return;
  // Content ships in the initial srcdoc, so a one-shot pass marks everything present
  // at parse; the observer then catches images added by later chunk realization.
  markImages(root);
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function(records){
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1) continue;
          if (n.localName === 'img') markImage(n);
          else markImages(n);
        }
      }
    }).observe(root, { childList: true, subtree: true });
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupImageActivation);
} else {
  setupImageActivation();
}

// Pointer/touch: a drag that clears the threshold and is horizontal-dominant is
// a swipe; a small movement that is not on a link is a tap. The host maps both
// (direction-aware). A link tap is left to the click handler as a linkclick.
// Tap precedence is link > image > decoration > plain tap: an image inside a
// highlighted range should still zoom, and only a plain tap is a page-turn gesture.
var SWIPE_THRESHOLD = 30;
var TAP_SLOP = 10;
var gesture = null; // { x, y, target }
function beginGesture(x, y, target){ gesture = { x: x, y: y, target: target }; }
function endGesture(x, y){
  if (gesture === null) return;
  var dx = x - gesture.x;
  var dy = y - gesture.y;
  var start = gesture;
  gesture = null;
  if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
    // A horizontal drag that left a live text selection is the reader selecting
    // text, not turning a page. Suppress the swipe so selection wins; the same
    // pointerup already flushed the selection to the host.
    var sel = document.getSelection();
    if (sel !== null && !sel.isCollapsed && sel.toString().length !== 0) return;
    send({ v: VERSION, type: 'swipe', dx: dx, dy: dy });
    return;
  }
  if (Math.abs(dx) <= TAP_SLOP && Math.abs(dy) <= TAP_SLOP && !linkAncestor(start.target)) {
    // A tap on an image (and not a link) opens the host-side zoom overlay: forward
    // the image's resolved data: URL + alt. Every other tap is a page-turn gesture
    // the host maps to a zone — unchanged, so tapIntent never regresses.
    var image = imageAncestor(start.target);
    if (image) {
      var src = image.getAttribute('src') || image.getAttribute('href') || image.getAttribute('xlink:href') || '';
      send({ v: VERSION, type: 'imagetap', src: String(src), alt: String(image.getAttribute('alt') || '') });
      return;
    }
    // A tap on a decoration is a report for the host's own UI (a highlight menu),
    // not a page-turn: it replaces the plain tap the zone mapping would act on.
    var hits = decorationsAt(x, y);
    if (hits.length > 0) {
      send({ v: VERSION, type: 'decorationtap', x: x, y: y, decorations: tappedDecorations(hits) });
      return;
    }
    send({ v: VERSION, type: 'tap', x: x, y: y, width: window.innerWidth, height: window.innerHeight });
  }
}
if (typeof window.PointerEvent === 'function') {
  document.addEventListener('pointerdown', function(event){
    if (event.isPrimary === false) return;
    beginGesture(event.clientX, event.clientY, event.target);
  });
  // Listener order is load-bearing: the selection flush runs before the gesture
  // ends, so a release that both collapses a reported selection and lands a tap
  // reports selectioncleared before tap/decorationtap — a host dismisses what it
  // anchored on the selection before it opens what it anchors on the decoration.
  // The flush only reads the selection, so the swipe check below still sees it live.
  document.addEventListener('pointerup', flushSelection);
  document.addEventListener('pointerup', function(event){
    endGesture(event.clientX, event.clientY);
  });
  document.addEventListener('pointercancel', function(){ gesture = null; });
} else {
  document.addEventListener('touchstart', function(event){
    var t = event.changedTouches[0];
    if (t) beginGesture(t.clientX, t.clientY, event.target);
  });
  document.addEventListener('touchend', function(event){
    var t = event.changedTouches[0];
    if (t) endGesture(t.clientX, t.clientY);
  });
  document.addEventListener('touchcancel', function(){ gesture = null; });
}
// Text selection is forwarded as a semantic offset range, not caught on the host:
// the selection lives inside this opaque-origin frame's document and never reaches
// the parent. The host cannot read the frame's Selection, so the frame computes
// the UTF-16 offset range over the same tiled section text sectionText() reports
// and forwards { start, end, text }. Same forwarding reasoning as link/key/tap.
function enclosingChunk(node){
  var el = node && node.nodeType === 1 ? node : (node ? node.parentNode : null);
  while (el && el.nodeType === 1){
    if (el.className && (' ' + el.className + ' ').indexOf(' ' + CHUNK_CLASS + ' ') !== -1) return el;
    el = el.parentNode;
  }
  return null;
}
// UTF-16 offset of (node, offset) into the concatenated section text: sum every
// prior chunk container's text length, then add the text length from this chunk's
// start up to the boundary via a Range. Returns -1 if the point is not inside a
// realized chunk container (a selection anchored outside the tiled text).
function offsetOfPoint(node, offset){
  var chunk = enclosingChunk(node);
  if (chunk === null) return -1;
  var chunks = chunkContainers();
  var base = 0;
  for (var i = 0; i < chunks.length; i++){
    if (chunks[i] === chunk) break;
    base += (chunks[i].textContent || '').length;
  }
  var range = document.createRange();
  try {
    range.setStart(chunk, 0);
    range.setEnd(node, offset);
    return base + range.toString().length;
  } catch (error) {
    return -1;
  } finally {
    range.detach && range.detach();
  }
}
// Forwards the live selection when it is real; returns whether it was sent.
function forwardSelection(){
  var selection = document.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return false;
  var text = selection.toString();
  if (text.length === 0) return false;
  var range = selection.getRangeAt(0);
  // Guard the zero-width-anchor / empty-inline gotcha: a selection whose rects are
  // empty carries no painted geometry, so forwarding it would be a malformed range.
  var lineBoxes = range.getClientRects();
  if (lineBoxes.length === 0) return false;
  var start = offsetOfPoint(range.startContainer, range.startOffset);
  var end = offsetOfPoint(range.endContainer, range.endOffset);
  if (start < 0 || end < 0) return false;
  if (start > end){ var swap = start; start = end; end = swap; }
  var geometry = visibleGeometry(lineBoxes);
  send({ v: VERSION, type: 'selection', start: start, end: end, text: text, rect: geometry.rect, rects: geometry.rects });
  return true;
}
function round2(n){ return Math.round(n * 100) / 100; }
// The line boxes a host can anchor a popover on: each client rect clipped to the
// visible page, plus their union. Frame viewport px are the container's padding-box
// px (the frame fills it with no border), so no translation happens here. The
// visible page is the root box in paginated mode — a keyboard-extended selection
// runs into off-page columns whose rects lie outside it, and a box anchored there
// would float in nowhere — and the frame viewport in scrolled mode, where the root
// is the whole document; the intersection of the two covers both.
function visibleGeometry(lineBoxes){
  var root = document.getElementById(ROOT_ID) || document.body;
  var rb = root.getBoundingClientRect();
  var viewport = document.documentElement;
  var clipLeft = Math.max(0, rb.left);
  var clipTop = Math.max(0, rb.top);
  var clipRight = Math.min(viewport.clientWidth, rb.right);
  var clipBottom = Math.min(viewport.clientHeight, rb.bottom);
  var rects = [];
  var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (var i = 0; i < lineBoxes.length; i++){
    var box = lineBoxes[i];
    var l = round2(Math.max(box.left, clipLeft));
    var t = round2(Math.max(box.top, clipTop));
    var r = round2(Math.min(box.right, clipRight));
    var b = round2(Math.min(box.bottom, clipBottom));
    if (r - l <= 0 || b - t <= 0) continue;
    rects.push({ x: l, y: t, width: round2(r - l), height: round2(b - t) });
    if (l < left) left = l;
    if (t < top) top = t;
    if (r > right) right = r;
    if (b > bottom) bottom = b;
  }
  var rect = rects.length === 0
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: left, y: top, width: round2(right - left), height: round2(bottom - top) };
  return { rect: rect, rects: rects };
}
// A completed selection is a selectionchange settled by a pointer/key release, so
// forward on release rather than on every intermediate selectionchange (which
// fires per character during a drag). A bare click collapses the selection and is
// dropped by the guards above — but when a selection stood reported, that same
// release is the host's only signal the selection is gone, so it is forwarded as
// selectioncleared, once. A replacement selection re-forwards and is not a clear.
// The flag lives with the document: a rebuilt srcdoc starts unreported, and the
// host owns the clear for that case.
var selectionDirty = false;
var selectionReported = false;
document.addEventListener('selectionchange', function(){
  selectionDirty = true;
  // A press that lands inside the selected text collapses it only after the click
  // has been dispatched — no pointerup, mouseup or click listener can see it — so
  // this queued selectionchange is the only signal that the reported selection is
  // gone. With no gesture in progress it is a settled collapse; a drag's transient
  // collapse arrives while the gesture is live and is left to the release flush.
  if (selectionReported && gesture === null && !selectionIsLive()) {
    selectionReported = false;
    send({ v: VERSION, type: 'selectioncleared' });
  }
});
function selectionIsLive(){
  var selection = document.getSelection();
  return selection !== null && selection.rangeCount > 0 && !selection.isCollapsed && selection.toString().length !== 0;
}
function flushSelection(){
  var dirty = selectionDirty;
  selectionDirty = false;
  if (dirty && forwardSelection()){ selectionReported = true; return; }
  if (!selectionReported) return;
  // selectionchange is delivered as a queued task, so a fast click's release can
  // arrive before the collapse it caused has been marked dirty. A reported
  // selection that is no longer live is gone either way; one that is still live
  // and untouched (a nav key's keyup) has nothing to say.
  if (!dirty && selectionIsLive()) return;
  selectionReported = false;
  send({ v: VERSION, type: 'selectioncleared' });
}
// The pointerup flush is registered above, ahead of the gesture end.
document.addEventListener('keyup', flushSelection);
document.addEventListener('mouseup', flushSelection);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function(){ send({ v: VERSION, type: 'ready' }); });
} else {
  send({ v: VERSION, type: 'ready' });
}
})();`;
}

/** One chunk's markup plus its character count, as `chunkElement` reports it. */
export interface ChunkPart {
  readonly html: string;
  readonly chars: number;
}

/**
 * Wraps each chunk in its own container element, tagging it with the cumulative
 * character range it covers in the section's concatenated text. Offsets are
 * end-exclusive: chunk *i* covers `[start, end)`, and chunk *i+1* starts exactly
 * at the previous `end`, so the ranges tile the section text without gap or
 * overlap. The frame reads these attributes to build per-chunk multi-column
 * contexts and to map pages to character offsets.
 *
 * The container is a `<div class="wolfy-reader-chunk">`; the char count comes from
 * `chunkElement` (`textContent.length` of the chunk's nodes), so it matches what
 * the frame measures with `textContent` at runtime.
 */
export function assembleChunkedBody(chunks: readonly ChunkPart[]): string {
  const parts: string[] = [];
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const start = offset;
    const end = offset + chunk.chars;
    offset = end;
    parts.push(
      `<div class="${CHUNK_CLASS}" ${CHUNK_INDEX_ATTR}="${index}" ` +
        `${CHUNK_START_ATTR}="${start}" ${CHUNK_END_ATTR}="${end}">${chunk.html}</div>`,
    );
  }
  return parts.join('');
}

export interface FrameDocumentParts {
  readonly headHtml: string;
  readonly bodyHtml: string;
  readonly nonce: string;
  readonly hostOrigin: string;
  /**
   * The appearance theme stylesheet ({@link themeStyleSheet}). Injected before
   * the publisher's `headHtml` so its cascade layer loses specificity fights on
   * the properties the book sets, while the theme variables it declares stay
   * unreachable by publisher CSS. Omit for an unthemed document.
   */
  readonly themeCss?: string;
  /**
   * Whether the host acts on forwarded navigation keydowns. Baked into the
   * coordination script (not a wire message — no protocol change): when `false`
   * the frame still forwards nav keys but no longer `preventDefault`s them, so
   * a key the host will ignore keeps its default action instead of going dead.
   * Defaults to `true`.
   */
  readonly keyboardNav?: boolean;
}

export function assembleFrameDocument(parts: FrameDocumentParts): string {
  // The coordination script sits in the head, before any content, so violations
  // raised while the body is still parsing are already being listened for. It
  // announces readiness on DOMContentLoaded, not on evaluation.
  //
  // The theme stylesheet follows the minimal reset and precedes the publisher's
  // headHtml: its `@layer` is declared first so book styles outrank it on their
  // own properties, but the `--wr-*` variables it defines are names the book does
  // not know and cannot clobber.
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    `<meta http-equiv="Content-Security-Policy" content="${escapeXmlAttribute(contentSecurityPolicy(parts.nonce))}">`,
    '<meta charset="utf-8">',
    `<script nonce="${parts.nonce}">${coordinationScript(parts.hostOrigin, parts.keyboardNav !== false)}</script>`,
    `<style>${RESET_CSS}</style>`,
    ...(parts.themeCss !== undefined && parts.themeCss !== '' ? [`<style>${parts.themeCss}</style>`] : []),
    parts.headHtml,
    '</head>',
    '<body>',
    `<div id="${CONTENT_ROOT_ID}">`,
    parts.bodyHtml,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
}
