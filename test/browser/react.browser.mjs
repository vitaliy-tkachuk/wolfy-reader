import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for the React bindings. The bindings exist to run the facade's
 * mount / live-update / unmount lifecycle from React effects, and that lifecycle
 * is only observable against a real frame — hence Chromium. React ships CJS
 * only, so react-entry.mjs is bundled with esbuild into one ESM module and
 * injected into react-harness.html; the development build is used on purpose so
 * StrictMode double-invokes effects the way a consumer's dev server would.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');

let playwright = null;
let esbuild = null;
try {
  playwright = await import('playwright');
  esbuild = await import('esbuild');
} catch {
  console.log('react.browser: playwright or esbuild is not installed — skipping. Run `npm install` first.');
}

const skipAll = playwright === null ? { skip: 'playwright is not installed' } : {};

let server = null;
let browser = null;
let page = null;
let bundle = '';

before(async () => {
  if (playwright === null) return;
  const built = await esbuild.build({
    entryPoints: [resolve(browserDir, 'react-entry.mjs')],
    bundle: true,
    format: 'esm',
    write: false,
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  bundle = built.outputFiles[0].text;
  server = await startServer({
    port: 0,
    mounts: [
      { prefix: '/fixtures', dir: fixtureDir },
      { prefix: '/', dir: browserDir },
    ],
  });
  browser = await playwright.chromium.launch({ channel: 'chromium' });
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const HOSTILE = '/fixtures/hostile.epub';

beforeEach(async () => {
  if (playwright === null) return;
  await page.goto(`${server.origin}/react-harness.html`);
  await page.addScriptTag({ content: bundle, type: 'module' });
  await page.waitForFunction(() => window.reactHarnessReady === true);
  const sections = await page.evaluate((u) => window.reactHarness.openBook(u), HOSTILE);
  assert.ok(sections > 0, `${HOSTILE} could not be fetched`);
});

const h = (fn, ...args) => page.evaluate(([f, a]) => window.reactHarness[f](...a), [fn, args]);

describe('<Reader> mount', { ...skipAll }, () => {
  test('renders once, fires onSectionChange → onPositionChange → onReady, and mounts one frame', async () => {
    const ready = await h('mount', { fontSize: 18 });
    assert.equal(ready.section, 0);
    const order = (await h('events')).map((e) => e.type);
    assert.deepEqual(order.slice(0, 3), ['sectionchange', 'positionchange', 'ready']);
    assert.equal((await h('frames')).length, 1);
    assert.deepEqual(await h('calls'), [], 'mount must not call setAppearance/setMode');
  });

  test('ref receives the facade handle', async () => {
    await h('mount');
    const handle = await h('handle');
    assert.deepEqual(handle.methods, ['next', 'goTo', 'search', 'decorate', 'sentences', 'destroy']);
  });

  test('StrictMode double-invoked effects leave exactly one frame', async () => {
    await h('mount', {}, { strict: true });
    assert.equal((await h('frames')).length, 1);
  });
});

describe('<Reader> live updates', { ...skipAll }, () => {
  test('a changed appearance prop calls setAppearance with only that field and keeps the frame', async () => {
    await h('mount', { fontSize: 16, theme: 'sepia' });
    const [frameBefore] = await h('frames');
    const calls = await h('update', { fontSize: 22 });
    assert.deepEqual(calls, [{ method: 'setAppearance', argument: { fontSize: 22 } }]);
    assert.deepEqual(await h('frames'), [frameBefore], 'appearance change must not remount');
  });

  test('an unchanged re-render makes no facade call', async () => {
    await h('mount', { fontSize: 16, customProperties: { '--wr-color': 'red' } });
    const calls = await h('update', { fontSize: 16, customProperties: { '--wr-color': 'red' } });
    assert.deepEqual(calls, []);
  });

  test('a changed mode prop calls setMode and keeps the frame', async () => {
    await h('mount');
    const [frameBefore] = await h('frames');
    const calls = await h('update', { mode: 'scrolled' });
    assert.deepEqual(calls, [{ method: 'setMode', argument: 'scrolled' }]);
    assert.deepEqual(await h('frames'), [frameBefore]);
  });

  test('a changed appearance prop keeps the reading place', async () => {
    await h('mount', { fontSize: 14 });
    await h('next');
    const before = await h('next');
    assert.ok(before.page >= 1 || before.section >= 1, JSON.stringify(before));
    await h('update', { fontSize: 24 });
    const after = (await h('events')).filter((e) => e.type === 'positionchange').at(-1).payload;
    assert.equal(after.section, before.section, 'section drifted across a font-size change');
  });

  test('a swapped handler prop is the one called, without a remount', async () => {
    await h('mount');
    const [frameBefore] = await h('frames');
    await page.evaluate(() => {
      window.__swapped = 0;
      return window.reactHarness.update({ onPositionChange: () => { window.__swapped += 1; } });
    });
    await h('next');
    assert.equal(await page.evaluate(() => window.__swapped), 1);
    assert.deepEqual(await h('frames'), [frameBefore]);
  });

  test('a new book remounts: new frame, ready fires again', async () => {
    await h('mount');
    const [frameBefore] = await h('frames');
    const ready = await h('swapBook', HOSTILE);
    assert.equal(ready.section, 0);
    const frames = await h('frames');
    assert.equal(frames.length, 1);
    assert.notEqual(frames[0], frameBefore, 'a new book must render into a new frame');
  });
});

describe('<Reader> unmount', { ...skipAll }, () => {
  test('destroys the reader: no frame remains, ref is null', async () => {
    await h('mount');
    assert.equal((await h('frames')).length, 1);
    await h('unmount');
    assert.equal((await h('frames')).length, 0);
    assert.equal(await h('handle'), null);
  });
});

describe('useReader', { ...skipAll }, () => {
  test('exposes reader and position as state and applies option changes live', async () => {
    const initial = await h('mountHook', { fontSize: 16 });
    assert.equal(initial, '0:0');
    assert.equal((await h('frames')).length, 1);
    await h('next');
    assert.notEqual(await h('hookPosition'), '0:0');
    const calls = await h('update', { fontSize: 20 }, { hook: true });
    assert.deepEqual(calls, [{ method: 'setAppearance', argument: { fontSize: 20 } }]);
    await h('unmount');
    assert.equal((await h('frames')).length, 0);
  });
});
