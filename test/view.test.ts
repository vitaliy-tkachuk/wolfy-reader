import assert from 'node:assert/strict';
import test from 'node:test';

import type { Resource } from '../src/core/index.ts';
import { findCssReferences, rewriteCssReferences } from '../src/view/css.ts';
import { coordinationScript } from '../src/view/frame.ts';
import { asFrameMessage, asHostMessage, PROTOCOL_VERSION } from '../src/view/protocol.ts';
import { classifyReference, joinReference, normalizeReference } from '../src/view/reference.ts';
import { ResourceRegistry, UNRESOLVABLE_URL } from '../src/view/resources.ts';

function values(css: string): string[] {
  return findCssReferences(css).map((reference) => `${reference.kind}:${reference.value}`);
}

function replaceAll(css: string, replacement: string): Promise<string> {
  return rewriteCssReferences(css, async () => replacement);
}

test('css scan finds quoted and unquoted url() targets', () => {
  assert.deepEqual(values('a{background:url(a.png)}'), ['url:a.png']);
  assert.deepEqual(values('a{background:url("a.png")}'), ['url:a.png']);
  assert.deepEqual(values("a{background:url('a.png')}"), ['url:a.png']);
  assert.deepEqual(values('a{background:url(  a.png  )}'), ['url:a.png']);
  assert.deepEqual(values('a{background:url( "a.png" )}'), ['url:a.png']);
});

test('css scan ignores url in identifiers, comments and strings', () => {
  assert.deepEqual(values('a{content:"url(fake.png)"}'), []);
  assert.deepEqual(values('/* url(fake.png) */a{color:red}'), []);
  assert.deepEqual(values('a{-x-blurl(nope):1}'), []);
  assert.deepEqual(values('a{content:"/*"}b{background:url(real.png)}'), ['url:real.png']);
});

test('css scan finds every @import spelling', () => {
  assert.deepEqual(values('@import "a.css";'), ['import:a.css']);
  assert.deepEqual(values('@import url("a.css");'), ['import:a.css']);
  assert.deepEqual(values('@import url(a.css) screen;'), ['import:a.css']);
  assert.deepEqual(values('@import /* c */ "a.css" print;'), ['import:a.css']);
  // @imports is not @import.
  assert.deepEqual(values('@imports "a.css";'), []);
});

test('rewriting replaces the whole token and preserves the rest', async () => {
  assert.equal(await replaceAll('a{background:url(x.png) no-repeat}', 'data:1'), 'a{background:url("data:1") no-repeat}');
  assert.equal(await replaceAll('@import url(x.css) screen;', 'data:1'), '@import url("data:1") screen;');
  assert.equal(await replaceAll('@import "x.css";', 'data:1'), '@import url("data:1");');
});

test('a replacer returning undefined leaves the reference exactly as written', async () => {
  const css = 'a{background:url(data:image/png;base64,AAA)}';
  assert.equal(await rewriteCssReferences(css, async () => undefined), css);
});

test('reference classification sees through the whitespace tricks', () => {
  assert.equal(classifyReference('#anchor').kind, 'fragment');
  assert.equal(classifyReference('../images/x.png').kind, 'relative');
  assert.equal(classifyReference('  https://example.invalid/x ').scheme, 'https');
  assert.equal(classifyReference('java\nscript:alert(1)').scheme, 'javascript');
  assert.equal(classifyReference('JAVASCRIPT:alert(1)').scheme, 'javascript');
  assert.equal(classifyReference('\t\r\n ').kind, 'empty');
});

test('references join in the section reference space', () => {
  assert.equal(joinReference('../styles/main.css', 'second.css'), '../styles/second.css');
  assert.equal(joinReference('../styles/second.css', 'assets/plate.png'), '../styles/assets/plate.png');
  assert.equal(joinReference('css/main.css', '../images/x.png'), 'images/x.png');
  assert.equal(joinReference('main.css', 'x.png'), 'x.png');
  assert.equal(normalizeReference('a/./b/../c.png'), 'a/c.png');
  assert.equal(normalizeReference('../../a.png'), '../../a.png');
});

interface Entry {
  readonly mediaType: string;
  readonly body: string;
}

function library(entries: Record<string, Entry>): { resolve: (reference: string) => Resource | undefined; loads: string[] } {
  const loads: string[] = [];
  return {
    loads,
    // A fresh Resource object per call: the contract promises equal bytes for
    // equal references, never one shared object, so memoization must key on the
    // reference string.
    resolve(reference) {
      const entry = entries[reference];
      if (entry === undefined) return undefined;
      return {
        mediaType: entry.mediaType,
        load: async () => {
          loads.push(reference);
          return new TextEncoder().encode(entry.body);
        },
      };
    },
  };
}

function decodeDataUrl(url: string): string {
  const marker = ';base64,';
  const at = url.indexOf(marker);
  assert.notEqual(at, -1, `not a base64 data url: ${url.slice(0, 40)}`);
  return Buffer.from(url.slice(at + marker.length), 'base64').toString('utf8');
}

test('a stylesheet resolves its own imports relative to itself', async () => {
  const { resolve } = library({
    '../styles/main.css': { mediaType: 'text/css', body: '@import url("second.css");' },
    '../styles/second.css': { mediaType: 'text/css', body: 'p{background:url("assets/plate.png")}' },
    '../styles/assets/plate.png': { mediaType: 'image/png', body: 'PNGBYTES' },
  });
  const registry = new ResourceRegistry(resolve);
  const url = await registry.urlForStylesheet('../styles/main.css');
  assert.ok(url !== undefined);
  const main = decodeDataUrl(url);
  const second = decodeDataUrl(/url\("([^"]+)"\)/.exec(main)?.[1] ?? '');
  const plate = decodeDataUrl(/url\("([^"]+)"\)/.exec(second)?.[1] ?? '');
  assert.equal(plate, 'PNGBYTES');
});

test('a cyclic @import terminates instead of hanging', async () => {
  const { resolve } = library({
    'cycle-a.css': { mediaType: 'text/css', body: '@import url("cycle-b.css");a{color:red}' },
    'cycle-b.css': { mediaType: 'text/css', body: '@import url("cycle-a.css");b{color:blue}' },
  });
  const registry = new ResourceRegistry(resolve);
  const url = await registry.urlForStylesheet('cycle-a.css');
  assert.ok(url !== undefined);
  const a = decodeDataUrl(url);
  const b = decodeDataUrl(/url\("([^"]+)"\)/.exec(a)?.[1] ?? '');
  assert.match(b, /@import url\("about:invalid"\)/);
  assert.match(b, /b\{color:blue\}/);
});

test('one resource referenced twice is loaded once', async () => {
  const { resolve, loads } = library({
    'images/x.png': { mediaType: 'image/png', body: 'X' },
  });
  const registry = new ResourceRegistry(resolve);
  const first = await registry.urlForResource('images/x.png');
  const second = await registry.urlForResource('./images/x.png');
  assert.equal(first, second);
  assert.deepEqual(loads, ['images/x.png']);
});

test('an unresolvable reference becomes about:invalid, never a throw', async () => {
  const registry = new ResourceRegistry(library({}).resolve);
  const css = await registry.rewriteStylesheet('a{background:url(gone.png)}', '');
  assert.equal(css, `a{background:url("${UNRESOLVABLE_URL}")}`);
  assert.deepEqual(registry.summary.unresolved, ['gone.png']);
});

test('remote and data references are left for the CSP to judge', async () => {
  const registry = new ResourceRegistry(library({}).resolve);
  const css = await registry.rewriteStylesheet(
    'a{background:url(https://example.invalid/p.png)}b{background:url(data:image/gif;base64,AA)}',
    '',
  );
  assert.match(css, /url\(https:\/\/example\.invalid\/p\.png\)/);
  assert.match(css, /url\(data:image\/gif;base64,AA\)/);
  assert.deepEqual(registry.summary.remote, ['https://example.invalid/p.png']);
});

test('a resource that resolves is still refused when its media type is executable', async () => {
  const { resolve, loads } = library({
    'js/pwn.js': { mediaType: 'text/javascript', body: 'alert(1)' },
    'styles/pwn.js': { mediaType: 'text/javascript', body: 'alert(1)' },
  });
  const registry = new ResourceRegistry(resolve);
  assert.equal(await registry.urlForResource('js/pwn.js'), undefined);
  assert.equal(await registry.urlForStylesheet('styles/pwn.js'), undefined);
  assert.deepEqual(loads, []);
  assert.deepEqual([...registry.summary.refused].sort(), ['js/pwn.js', 'styles/pwn.js']);
});

test('frame messages are accepted only in a known shape', () => {
  assert.deepEqual(asFrameMessage({ v: PROTOCOL_VERSION, type: 'ready' }), {
    v: PROTOCOL_VERSION,
    type: 'ready',
  });
  assert.deepEqual(asFrameMessage({ v: PROTOCOL_VERSION, type: 'measured', id: 3, width: 10, height: 20 }), {
    v: PROTOCOL_VERSION,
    type: 'measured',
    id: 3,
    width: 10,
    height: 20,
  });
  assert.deepEqual(asFrameMessage({ v: PROTOCOL_VERSION, type: 'key', key: 'ArrowRight' }), {
    v: PROTOCOL_VERSION,
    type: 'key',
    key: 'ArrowRight',
  });
  assert.deepEqual(asFrameMessage({ v: PROTOCOL_VERSION, type: 'swipe', dx: -50, dy: 3 }), {
    v: PROTOCOL_VERSION,
    type: 'swipe',
    dx: -50,
    dy: 3,
  });
  assert.deepEqual(
    asFrameMessage({ v: PROTOCOL_VERSION, type: 'tap', x: 10, y: 20, width: 300, height: 400 }),
    { v: PROTOCOL_VERSION, type: 'tap', x: 10, y: 20, width: 300, height: 400 },
  );
  assert.deepEqual(
    asFrameMessage({ v: PROTOCOL_VERSION, type: 'selection', start: 5, end: 17, text: 'a quote' }),
    { v: PROTOCOL_VERSION, type: 'selection', start: 5, end: 17, text: 'a quote' },
  );
  assert.deepEqual(
    asFrameMessage({ v: PROTOCOL_VERSION, type: 'imagetap', src: 'data:image/png;base64,AAAA', alt: 'a plate' }),
    { v: PROTOCOL_VERSION, type: 'imagetap', src: 'data:image/png;base64,AAAA', alt: 'a plate' },
  );
  assert.deepEqual(asFrameMessage({ v: PROTOCOL_VERSION, type: 'decorated', id: 4, boxes: 3 }), {
    v: PROTOCOL_VERSION,
    type: 'decorated',
    id: 4,
    boxes: 3,
  });
  assert.deepEqual(asFrameMessage({ v: PROTOCOL_VERSION, type: 'scrolledTo', id: 5, top: 812.5 }), {
    v: PROTOCOL_VERSION,
    type: 'scrolledTo',
    id: 5,
    top: 812.5,
  });
  for (const rejected of [
    null,
    'ready',
    { type: 'ready' },
    { v: 0, type: 'ready' },
    { v: PROTOCOL_VERSION, type: 'unknown' },
    { v: PROTOCOL_VERSION, type: 'measured', id: '3', width: 1, height: 1 },
    { v: PROTOCOL_VERSION, type: 'measured', id: 3, width: 1 },
    { v: PROTOCOL_VERSION, type: 'error' },
    { v: PROTOCOL_VERSION, type: 'key' },
    { v: PROTOCOL_VERSION, type: 'key', key: 5 },
    { v: PROTOCOL_VERSION, type: 'swipe', dx: 1 },
    { v: PROTOCOL_VERSION, type: 'swipe', dx: '1', dy: 2 },
    { v: PROTOCOL_VERSION, type: 'tap', x: 1, y: 2, width: 3 },
    { v: PROTOCOL_VERSION, type: 'tap', x: '1', y: 2, width: 3, height: 4 },
    { v: PROTOCOL_VERSION, type: 'selection', start: 1, end: 2 },
    { v: PROTOCOL_VERSION, type: 'selection', start: '1', end: 2, text: 'x' },
    { v: PROTOCOL_VERSION, type: 'selection', start: 1, end: 2, text: 5 },
    { v: 5, type: 'selection', start: 1, end: 2, text: 'x' },
    { v: PROTOCOL_VERSION, type: 'imagetap', src: 'data:x' },
    { v: PROTOCOL_VERSION, type: 'imagetap', src: 5, alt: 'x' },
    { v: PROTOCOL_VERSION, type: 'imagetap', alt: 'x' },
    { v: 6, type: 'imagetap', src: 'data:x', alt: 'x' },
    { v: PROTOCOL_VERSION, type: 'decorated', id: 4 },
    { v: PROTOCOL_VERSION, type: 'decorated', id: 4, boxes: 'x' },
    { v: PROTOCOL_VERSION, type: 'decorated', boxes: 3 },
  ]) {
    assert.equal(asFrameMessage(rejected), null, JSON.stringify(rejected));
  }
});

test('the frame validator copy carries the same protocol version as protocol.ts', () => {
  const versionInFrameScript = coordinationScript('https://example.test').match(/var VERSION = (\d+);/);
  assert.ok(versionInFrameScript !== null, 'the frame script must declare a VERSION');
  assert.equal(
    Number(versionInFrameScript[1]),
    PROTOCOL_VERSION,
    'the frame validator copy drifted from protocol.ts PROTOCOL_VERSION',
  );
});

test('host messages are accepted only in a known shape', () => {
  assert.deepEqual(asHostMessage({ v: PROTOCOL_VERSION, type: 'ping', id: 1 }), {
    v: PROTOCOL_VERSION,
    type: 'ping',
    id: 1,
  });
  assert.equal(asHostMessage({ v: PROTOCOL_VERSION, type: 'ping' }), null);
  assert.equal(asHostMessage({ v: PROTOCOL_VERSION, type: 'evaluate', id: 1 }), null);
});

test('host scrollToOffset is accepted only in a known shape', () => {
  assert.deepEqual(asHostMessage({ v: PROTOCOL_VERSION, type: 'scrollToOffset', id: 9, offset: 4096 }), {
    v: PROTOCOL_VERSION,
    type: 'scrollToOffset',
    id: 9,
    offset: 4096,
  });
  for (const rejected of [
    { v: PROTOCOL_VERSION, type: 'scrollToOffset', id: 9 },
    { v: PROTOCOL_VERSION, type: 'scrollToOffset', id: 9, offset: '4096' },
    { v: PROTOCOL_VERSION, type: 'scrollToOffset', offset: 4096 },
    { v: 9, type: 'scrollToOffset', id: 9, offset: 4096 },
  ]) {
    assert.equal(asHostMessage(rejected), null, JSON.stringify(rejected));
  }
  for (const rejected of [
    { v: PROTOCOL_VERSION, type: 'scrolledTo', id: 9 },
    { v: PROTOCOL_VERSION, type: 'scrolledTo', id: 9, top: '12' },
    { v: PROTOCOL_VERSION, type: 'scrolledTo', top: 12 },
  ]) {
    assert.equal(asFrameMessage(rejected), null, JSON.stringify(rejected));
  }
});

test('host decorate/undecorate messages are accepted only in a known shape', () => {
  assert.deepEqual(
    asHostMessage({
      v: PROTOCOL_VERSION,
      type: 'decorate',
      id: 7,
      decorationId: 'h1',
      start: 5,
      end: 17,
      className: 'hl',
    }),
    { v: PROTOCOL_VERSION, type: 'decorate', id: 7, decorationId: 'h1', start: 5, end: 17, className: 'hl' },
  );
  assert.deepEqual(asHostMessage({ v: PROTOCOL_VERSION, type: 'undecorate', id: 8, decorationId: 'h1' }), {
    v: PROTOCOL_VERSION,
    type: 'undecorate',
    id: 8,
    decorationId: 'h1',
  });
  for (const rejected of [
    { v: PROTOCOL_VERSION, type: 'decorate', id: 7, decorationId: 'h1', start: 5, end: 17 },
    { v: PROTOCOL_VERSION, type: 'decorate', id: 7, decorationId: 5, start: 5, end: 17, className: 'hl' },
    { v: PROTOCOL_VERSION, type: 'decorate', id: 7, decorationId: 'h1', start: '5', end: 17, className: 'hl' },
    { v: PROTOCOL_VERSION, type: 'decorate', decorationId: 'h1', start: 5, end: 17, className: 'hl' },
    { v: 8, type: 'decorate', id: 7, decorationId: 'h1', start: 5, end: 17, className: 'hl' },
    { v: PROTOCOL_VERSION, type: 'undecorate', id: 8 },
    { v: PROTOCOL_VERSION, type: 'undecorate', id: 8, decorationId: 5 },
  ]) {
    assert.equal(asHostMessage(rejected), null, JSON.stringify(rejected));
  }
});

test('the frame validator copy carries the decorate/undecorate host cases in step', () => {
  // The frame's validateHost is a hand-written copy of asHostMessage in a template
  // string; it cannot import, so protocol.ts and the copy are kept in step by hand.
  // Assert the copy handles the same message names, guarding against drift.
  const script = coordinationScript('https://example.test');
  assert.match(script, /t === 'decorate'/, 'frame validator must handle decorate');
  assert.match(script, /t === 'undecorate'/, 'frame validator must handle undecorate');
  assert.match(script, /data\.decorationId !== 'string'/, 'frame validator must type-check decorationId');
  assert.match(script, /data\.className !== 'string'/, 'frame validator must type-check className');
  assert.match(
    script,
    /if \(data\.type === 'decorate'\)/,
    'frame message handler must dispatch decorate',
  );
  assert.match(
    script,
    /if \(data\.type === 'undecorate'\)/,
    'frame message handler must dispatch undecorate',
  );
});
