export const CONTENT_ROOT_ID = 'wolfyreader-content';

/** Class marking each per-chunk container the host emits into the frame body. */
export const CHUNK_CLASS = 'wolfyreader-chunk';
/** Cumulative character offset of a chunk's first glyph into the section text. */
export const CHUNK_START_ATTR = 'data-chunk-start';
/** Cumulative character offset just past a chunk's last glyph. */
export const CHUNK_END_ATTR = 'data-chunk-end';
/** Zero-based index of a chunk in section order. */
export const CHUNK_INDEX_ATTR = 'data-chunk-index';

/**
 * A minimal reset and nothing else. Column geometry belongs to the paginator
 * and typography to the appearance controls; the host's job is to stay out of
 * the way of both, so it must not put the body in a column context.
 */
const RESET_CSS = [
  'html{box-sizing:border-box}',
  '*,*::before,*::after{box-sizing:inherit}',
  'body{margin:0}',
  'img,svg{max-width:100%;height:auto}',
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

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function coordinationScript(hostOrigin: string): string {
  return `(function(){
'use strict';
var VERSION = 4;
var host = window.parent;
var target = ${JSON.stringify(hostOrigin)};
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
    if (typeof o.windowChunks !== 'number') return null;
    return data;
  }
  if (t === 'goToPage' || t === 'offsetOfPage') return typeof data.page === 'number' ? data : null;
  if (t === 'pageOfOffset') return typeof data.offset === 'number' ? data : null;
  if (t === 'offsetOfElementId') return typeof data.elementId === 'string' ? data : null;
  return null;
}

// Live pagination state, rebuilt on paginate and re-measured on relayout.
var layout = {
  mode: 'paginated',
  pageWidth: 0,
  pageHeight: 0,
  columnGap: 0,
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

function stride(){
  return layout.pageWidth + layout.columnGap;
}

// (Re)apply geometry to every chunk container and recompute the page map. In
// paginated mode each chunk is an absolutely-positioned multi-column context and
// contributes ceil(contentWidth / pageStride) pages; boundaries are forced page
// breaks so per-chunk page counts simply sum. In scrolled mode chunks stack
// vertically in normal flow with no paging.
function relayout(){
  var els = chunkContainers();
  layout.chunks = [];
  var root = document.getElementById(ROOT_ID) || document.body;
  if (layout.mode === 'scrolled'){
    root.style.position = '';
    root.style.width = layout.pageWidth ? (layout.pageWidth + 'px') : '';
    root.style.height = '';
    var top = 0;
    for (var i = 0; i < els.length; i++){
      var el = els[i];
      el.style.position = 'static';
      el.style.columnWidth = 'auto';
      el.style.width = layout.pageWidth ? (layout.pageWidth + 'px') : 'auto';
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
  // Paginated.
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
    c.style.left = '0';
    c.style.height = layout.pageHeight + 'px';
    c.style.columnWidth = layout.pageWidth + 'px';
    c.style.columnGap = layout.columnGap + 'px';
    c.style.columnFill = 'auto';
    c.style.width = layout.pageWidth + 'px';
    c.style.overflow = 'hidden';
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
  var target = null, localPage = 0;
  for (var i = 0; i < layout.chunks.length; i++){
    var ch = layout.chunks[i];
    if (page >= ch.firstPage && page < ch.firstPage + ch.pages){ target = ch; localPage = page - ch.firstPage; break; }
  }
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

// Map a page (0-based) to the character offset of its first painted glyph. Walk
// the active chunk's text with a Range, find the first character whose rect falls
// on this page's column band, and add the chunk's cumulative start offset.
function offsetOfPage(page){
  if (page < 0 || page >= layout.pageCount) return -1;
  var chunk = null, localPage = 0;
  for (var i = 0; i < layout.chunks.length; i++){
    var ch = layout.chunks[i];
    if (page >= ch.firstPage && page < ch.firstPage + ch.pages){ chunk = ch; localPage = page - ch.firstPage; break; }
  }
  if (chunk === null) return -1;
  chunk.el.style.contentVisibility = 'visible';
  var bandLeft = localPage * stride();
  var bandRight = bandLeft + layout.pageWidth;
  var walker = document.createTreeWalker(chunk.el, NodeFilter.SHOW_TEXT, null);
  var textOffset = 0;
  var node;
  while ((node = walker.nextNode())){
    var len = node.data.length;
    for (var p = 0; p < len; p++){
      var range = document.createRange();
      range.setStart(node, p);
      range.setEnd(node, p + 1);
      var rects = range.getClientRects();
      if (rects.length > 0){
        var left = rects[0].left - chunk.el.getBoundingClientRect().left;
        if (left >= bandLeft - 1 && left < bandRight){
          return chunk.start + textOffset + p;
        }
      }
    }
    textOffset += len;
  }
  return chunk.start;
}

// Inverse: which page paints the glyph at this section-text offset.
function pageOfOffset(offset){
  var chunk = null;
  for (var i = 0; i < layout.chunks.length; i++){
    var ch = layout.chunks[i];
    if (offset >= ch.start && offset < ch.end){ chunk = ch; break; }
  }
  if (chunk === null){
    // Past the end: last page. Before the start: first page.
    if (layout.chunks.length === 0) return 0;
    return offset < layout.chunks[0].start ? 0 : layout.pageCount - 1;
  }
  chunk.el.style.contentVisibility = 'visible';
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
  chunkEl.style.contentVisibility = 'visible';
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
  for (var i = 0; i < layout.chunks.length; i++) text += layout.chunks[i].el.textContent || '';
  if (layout.chunks.length === 0){
    var root = document.getElementById(ROOT_ID);
    if (root){
      var found = root.getElementsByClassName(CHUNK_CLASS);
      for (var j = 0; j < found.length; j++) text += found[j].textContent || '';
    }
  }
  return text;
}

function applyOptions(o){
  layout.mode = o.mode;
  layout.pageWidth = o.pageWidth;
  layout.pageHeight = o.pageHeight;
  layout.columnGap = o.columnGap;
  layout.windowChunks = o.windowChunks;
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
  if (data.type === 'paginate') { applyOptions(data.options); relayout(); send({ v: VERSION, type: 'paginated', id: id, state: paginationState() }); return; }
  if (data.type === 'relayout') { relayout(); send({ v: VERSION, type: 'paginated', id: id, state: paginationState() }); return; }
  if (data.type === 'goToPage') { var moved = goToPage(data.page); send({ v: VERSION, type: 'movedToPage', id: id, page: moved }); return; }
  if (data.type === 'offsetOfPage') { send({ v: VERSION, type: 'offset', id: id, offset: offsetOfPage(data.page) }); return; }
  if (data.type === 'pageOfOffset') { send({ v: VERSION, type: 'page', id: id, page: pageOfOffset(data.offset) }); return; }
  if (data.type === 'offsetOfElementId') { send({ v: VERSION, type: 'offset', id: id, offset: offsetOfElementId(data.elementId) }); return; }
  if (data.type === 'sectionText') { send({ v: VERSION, type: 'text', id: id, text: sectionText() }); return; }
  if (data.type === 'diagnostics') {
    send({ v: VERSION, type: 'diagnosticsReport', id: id,
      domNodes: document.getElementsByTagName('*').length,
      realizedChunks: realizedCount(), totalChunks: layout.chunks.length });
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
document.addEventListener('click', function(event){
  var node = event.target;
  while (node && node.nodeType === 1) {
    if (node.localName === 'a' && node.hasAttribute('href')) {
      event.preventDefault();
      // Report the raw authored href, not node.href: the opaque origin resolves
      // the property against a null base and mangles it. The host/facade parses.
      send({ v: VERSION, type: 'linkclick', href: String(node.getAttribute('href') || '') });
      return;
    }
    node = node.parentNode;
  }
});
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
 * The container is a `<div class="wolfyreader-chunk">`; the char count comes from
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
}

export function assembleFrameDocument(parts: FrameDocumentParts): string {
  // The coordination script sits in the head, before any content, so violations
  // raised while the body is still parsing are already being listened for. It
  // announces readiness on DOMContentLoaded, not on evaluation.
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(contentSecurityPolicy(parts.nonce))}">`,
    '<meta charset="utf-8">',
    `<script nonce="${parts.nonce}">${coordinationScript(parts.hostOrigin)}</script>`,
    `<style>${RESET_CSS}</style>`,
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
