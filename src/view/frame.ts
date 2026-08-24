export const CONTENT_ROOT_ID = 'wolfyreader-content';

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
var VERSION = 1;
var host = window.parent;
var target = ${JSON.stringify(hostOrigin)};
function send(message){ try { host.postMessage(message, target); } catch (error) {} }
window.addEventListener('message', function(event){
  if (event.source !== host) return;
  var data = event.data;
  if (data === null || typeof data !== 'object' || data.v !== VERSION) return;
  if (typeof data.id !== 'number') return;
  if (data.type === 'ping') { send({ v: VERSION, type: 'pong', id: data.id }); return; }
  if (data.type === 'measure') {
    var root = document.getElementById(${JSON.stringify(CONTENT_ROOT_ID)}) || document.documentElement;
    send({ v: VERSION, type: 'measured', id: data.id, width: root.scrollWidth, height: root.scrollHeight });
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
    if (node.localName === 'a' && node.hasAttribute('href')) { event.preventDefault(); return; }
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
