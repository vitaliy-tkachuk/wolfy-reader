import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');
const corpusDir = resolve(repoRoot, 'test', 'corpus');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('view.browser: playwright is not installed — skipping. Run `npm install` first.');
}

let manifest = null;
try {
  manifest = JSON.parse(await readFile(resolve(fixtureDir, 'hostile-vectors.json'), 'utf8'));
} catch {
  console.log('view.browser: test/fixtures/epub/hostile-vectors.json is absent — hostile vectors skipped.');
}

const skipAll = playwright === null ? { skip: 'playwright is not installed' } : {};
const skipVectors = manifest === null ? { skip: 'the hostile fixture manifest is absent' } : {};

const vectors = manifest?.vectors ?? [];
const probes = [...new Set(vectors.map((vector) => vector.probe).filter(Boolean))];
const sections = manifest?.sections ?? [];

function vectorsFor(sectionId, expectation) {
  return vectors.filter((vector) => vector.sectionId === sectionId && vector.expectation === expectation);
}

let server = null;
let browser = null;
let page = null;

before(async () => {
  if (playwright === null) return;
  server = await startServer({
    port: 0,
    mounts: [
      { prefix: '/src', dir: resolve(repoRoot, 'src') },
      { prefix: '/fixtures', dir: fixtureDir },
      { prefix: '/corpus', dir: corpusDir },
      { prefix: '/', dir: browserDir },
    ],
  });
  // Full Chromium, not the headless shell: the shell is a stripped build, and
  // sandbox, CSP and opaque-origin semantics are exactly what is under test.
  browser = await playwright.chromium.launch({ channel: 'chromium' });
  page = await browser.newPage();
  await page.goto(`${server.origin}/harness.html`);
  await page.waitForFunction(() => window.harnessReady === true);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

function contentFrame() {
  const frames = page.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame — the content frame');
  return frames[0];
}

async function openHostileBook() {
  const opened = await page.evaluate(() => window.harness.openBook('/fixtures/hostile.epub'));
  assert.ok(opened !== null, 'hostile.epub could not be fetched');
  return opened;
}

async function renderSection(sectionId) {
  await page.evaluate(() => window.harness.createHost());
  const report = await page.evaluate((id) => window.harness.render(id), sectionId);
  return { report, frame: contentFrame() };
}

const PLAIN_SECTION =
  '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Isolated</h1><p>A paragraph with enough text to occupy some height.</p></body></html>';

async function renderSynthetic(source = PLAIN_SECTION) {
  await page.evaluate(() => window.harness.createHost());
  const report = await page.evaluate((text) => window.harness.renderSource({ source: text }), source);
  return { report, frame: contentFrame() };
}

/** Fires the events a surviving handler would need, so inertness is proven, not assumed. */
async function exercise(frame) {
  await frame.evaluate(() => {
    for (const element of document.querySelectorAll('*')) {
      for (const type of ['click', 'mouseover', 'mousedown', 'mouseup']) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
      element.dispatchEvent(new Event('focus', { bubbles: true }));
    }
    window.dispatchEvent(new Event('load'));
  });
  await new Promise((done) => setTimeout(done, 250));
}

function firedProbes(frame) {
  return frame.evaluate(
    (names) => names.filter((name) => window[name] !== undefined),
    probes,
  );
}

describe('isolation', { ...skipAll }, () => {
  test('the sandbox grants allow-scripts and nothing else', async () => {
    const isolation = await page.evaluate(() => window.harness.createHost());
    assert.deepEqual(isolation.tokens, ['allow-scripts']);
    for (const withheld of [
      'allow-same-origin',
      'allow-top-navigation',
      'allow-top-navigation-by-user-activation',
      'allow-popups',
      'allow-forms',
      'allow-modals',
      'allow-downloads',
      'allow-pointer-lock',
      'allow-presentation',
    ]) {
      assert.ok(!isolation.tokens.includes(withheld), `sandbox must not grant ${withheld}`);
    }
  });

  test('the host page cannot reach into the frame', async () => {
    await renderSynthetic();
    const isolation = await page.evaluate(() => window.harness.isolation());
    assert.equal(isolation.contentDocument, 'null');
    assert.equal(isolation.contentWindowDocument, 'throws:SecurityError');
  });

  test('the frame runs in an opaque origin with no storage and no cookies', async () => {
    const { frame } = await renderSynthetic();
    const probe = await frame.evaluate(() => {
      const out = { origin: String(window.origin), cookie: null, storage: null, parentDocument: null };
      try {
        out.cookie = document.cookie;
      } catch (error) {
        out.cookie = `throws:${error.name}`;
      }
      try {
        void localStorage.length;
        out.storage = 'readable';
      } catch (error) {
        out.storage = `throws:${error.name}`;
      }
      try {
        void window.parent.document.title;
        out.parentDocument = 'readable';
      } catch (error) {
        out.parentDocument = `throws:${error.name}`;
      }
      return out;
    });
    assert.equal(probe.origin, 'null');
    // An opaque origin has no cookie jar at all: Chromium throws where the
    // criterion only asked for empty, which is the stronger outcome.
    assert.ok(probe.cookie === '' || probe.cookie === 'throws:SecurityError', probe.cookie);
    assert.equal(probe.storage, 'throws:SecurityError');
    assert.equal(probe.parentDocument, 'throws:SecurityError');
  });
});

describe('inert content', { ...skipAll, ...skipVectors }, () => {
  before(openHostileBook);

  for (const section of sections) {
    test(`no vector executes in section "${section.id}"`, async () => {
      const { frame } = await renderSection(section.id);
      await exercise(frame);
      assert.deepEqual(await firedProbes(frame), []);
    });
  }

  test('script, embedding, form and navigation elements do not survive', async () => {
    for (const section of sections) {
      const { frame } = await renderSection(section.id);
      const survivors = await frame.evaluate(() => {
        const found = [];
        for (const selector of ['base', 'iframe', 'object', 'embed', 'form', 'template']) {
          if (document.querySelector(selector) !== null) found.push(selector);
        }
        // The host's own CSP tag is the only http-equiv allowed to exist.
        for (const meta of document.querySelectorAll('meta[http-equiv]')) {
          const equiv = meta.getAttribute('http-equiv');
          if (equiv !== 'Content-Security-Policy') found.push(`meta[http-equiv=${equiv}]`);
        }
        const scripts = [...document.querySelectorAll('script')];
        // Exactly one script may exist: the host's own nonced coordination
        // script, identified by the content root it addresses.
        for (const script of scripts) {
          if (!script.textContent.includes('wolfyreader-content')) found.push('script');
        }
        if (scripts.length !== 1) found.push(`script-count:${scripts.length}`);
        return found;
      });
      assert.deepEqual(survivors, [], `in section ${section.id}`);
    }
  });

  test('no event-handler attribute survives anywhere', async () => {
    for (const section of sections) {
      const { frame } = await renderSection(section.id);
      const handlers = await frame.evaluate(() => {
        const found = [];
        for (const element of document.querySelectorAll('*')) {
          for (const attribute of element.attributes) {
            if (attribute.name.toLowerCase().startsWith('on')) found.push(`${element.localName}[${attribute.name}]`);
          }
        }
        return found;
      });
      assert.deepEqual(handlers, [], `in section ${section.id}`);
    }
  });

  test('no javascript: reference survives on any attribute', async () => {
    for (const section of sections) {
      const { frame } = await renderSection(section.id);
      const live = await frame.evaluate(() => {
        const found = [];
        for (const element of document.querySelectorAll('*')) {
          for (const attribute of element.attributes) {
            if (/^\s*[a-z\s]*javascript\s*:/i.test(attribute.value.replace(/[\t\n\r]/g, ''))) {
              found.push(`${element.localName}[${attribute.name}]`);
            }
          }
        }
        return found;
      });
      assert.deepEqual(live, [], `in section ${section.id}`);
    }
  });

  test('sanitization does not branch on the scripted declaration', async () => {
    // The identical inline script sits either side of the declaration. A frame
    // handle does not survive the next render, so each is asserted as rendered.
    const results = [];
    for (const sectionId of ['attacks', 'scripted-declared']) {
      const { report, frame } = await renderSection(sectionId);
      const bookScripts = await frame.evaluate(
        () =>
          [...document.querySelectorAll('script')].filter(
            (script) => !script.textContent.includes('wolfyreader-content'),
          ).length,
      );
      results.push({ declared: report.declaredScripted, bookScripts, fired: await firedProbes(frame) });
    }
    assert.deepEqual(
      results.map((result) => result.declared),
      [false, true],
    );
    assert.deepEqual(
      results.map((result) => result.bookScripts),
      [0, 0],
    );
    assert.deepEqual(
      results.map((result) => result.fired),
      [[], []],
    );
  });

  test('everything marked preserved is still there', async () => {
    for (const section of sections) {
      const expected = vectorsFor(section.id, 'preserved').filter(
        // The two unresolvable images are preserved *as their alt text*, so the
        // element they name is deliberately gone. The alt test asserts them.
        (vector) =>
          vector.selector !== undefined &&
          !['declared-missing-image', 'undeclared-present-image'].includes(vector.id),
      );
      if (expected.length === 0) continue;
      const { frame } = await renderSection(section.id);
      const missing = await frame.evaluate(
        (selectors) => selectors.filter((selector) => document.querySelector(selector) === null),
        expected.map((vector) => vector.selector),
      );
      assert.deepEqual(missing, [], `in section ${section.id}`);
    }
  });
});

describe('resources', { ...skipAll, ...skipVectors }, () => {
  before(openHostileBook);

  test('every in-book reference resolves to a data: URL and loads', async () => {
    const { report, frame } = await renderSection('resources');
    await new Promise((done) => setTimeout(done, 400));
    const state = await frame.evaluate(() => {
      const image = document.querySelector('#local-image');
      const stylesheet = document.querySelector('#local-stylesheet');
      const inline = document.querySelector('#inline-style-url');
      const cssUrlImage = document.querySelector('#css-url-image');
      return {
        imageSrc: image?.getAttribute('src')?.slice(0, 24) ?? null,
        imageLoaded: image?.complete === true && image.naturalWidth > 0,
        stylesheetHref: stylesheet?.getAttribute('href')?.slice(0, 24) ?? null,
        // Proves the linked sheet actually applied: main.css styles this rule.
        importedStyleApplied: getComputedStyle(cssUrlImage).backgroundImage.startsWith('url("data:'),
        inlineStyle: inline?.getAttribute('style') ?? '',
        fontFamily: getComputedStyle(document.querySelector('#font-face-text')).fontFamily,
      };
    });
    assert.match(state.imageSrc, /^data:image\/png;base64,/);
    assert.ok(state.imageLoaded, 'the local image did not decode');
    assert.match(state.stylesheetHref, /^data:text\/css;base64,/);
    assert.ok(state.importedStyleApplied, 'the @import chain did not reach the image inside second.css');
    assert.match(state.inlineStyle, /url\("data:image\/png;base64,/);
    assert.match(state.fontFamily, /Hostile Stub/);
    assert.ok(report.resources.dataUrls >= 5, `expected several data URLs, got ${report.resources.dataUrls}`);
  });

  test('the @font-face target is fetched and rewritten', async () => {
    const { frame } = await renderSection('resources');
    const fontRule = await frame.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (rule.constructor.name === 'CSSFontFaceRule') return rule.style.getPropertyValue('src').slice(0, 40);
        }
      }
      return null;
    });
    assert.ok(fontRule !== null, '@font-face did not survive into a stylesheet');
    assert.match(fontRule, /url\("?data:font\/woff/);
  });

  test('a cyclic @import terminates and both sheets still apply', async () => {
    const { report, frame } = await renderSection('resources');
    const applied = await frame.evaluate(() => document.querySelector('#cycle-stylesheet') !== null);
    assert.ok(applied);
    assert.deepEqual(report.resources.unresolved.filter((reference) => reference.includes('cycle')), []);
  });

  test('a reference that cannot be resolved degrades to its alt text', async () => {
    const preserve = await renderSection('preserve');
    const preserveText = await preserve.frame.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
    assert.match(preserveText, /The lamplighter/);

    const resources = await renderSection('resources');
    const resourceText = await resources.frame.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
    assert.match(resourceText, /Declared in the manifest/);
    assert.match(resourceText, /Undeclared in the manifest/);
    assert.ok(resources.report.resources.altSubstituted >= 2);
  });

  test('a resource that resolves as script is never given a URL', async () => {
    const { report } = await renderSection('attacks');
    assert.ok(
      report.resources.resolved.every((reference) => !reference.endsWith('.js')),
      `a script resource was served: ${report.resources.resolved.join(', ')}`,
    );
  });

  test('remote references are refused by the CSP, observably', async () => {
    await renderSection('resources');
    await new Promise((done) => setTimeout(done, 600));
    const observed = await page.evaluate(() => window.harness.observed());
    assert.ok(observed.violations.length > 0, 'no CSP violation was reported');
    const blocked = observed.violations.map((violation) => violation.blockedUri).join(' ');
    assert.match(blocked, /example\.invalid/);
  });

  test('the host mints no object URLs, so a render cycle can orphan none', async () => {
    await renderSection('resources');
    await renderSection('preserve');
    await page.evaluate(() => window.harness.destroy());
    const observed = await page.evaluate(() => window.harness.observed());
    assert.equal(observed.objectUrlsCreated, 0);
  });
});

describe('markup normalization', { ...skipAll, ...skipVectors }, () => {
  before(openHostileBook);

  test('a self-closing non-void tag does not swallow the rest of the section', async () => {
    const { frame } = await renderSection('preserve');
    const state = await frame.evaluate(() => {
      const anchor = document.querySelector('#chapter-mark');
      return {
        exists: anchor !== null,
        childNodes: anchor === null ? -1 : anchor.childNodes.length,
        text: document.body.textContent.replace(/\s+/g, ' '),
      };
    });
    assert.ok(state.exists, 'the self-closing anchor did not survive');
    assert.equal(state.childNodes, 0, 'the anchor swallowed the markup after it');
    assert.match(state.text, /SENTINEL_AFTER_SELF_CLOSING_ANCHOR/);
    assert.match(state.text, /TAIL_SENTINEL_PRESERVE/);
  });

  test('zero-width page anchors survive sanitization', async () => {
    const { frame } = await renderSection('preserve');
    const anchors = await frame.evaluate(() =>
      [...document.querySelectorAll('span.x-ebookmaker-pageno > a[id^="page_"]')].map((a) => a.id),
    );
    assert.deepEqual(anchors, ['page_357', 'page_358']);
  });

  test('malformed markup falls back to the HTML parser and keeps its text', async () => {
    const { report, frame } = await renderSection('malformed');
    assert.equal(report.sanitization.parseFallback, true);
    assert.equal(report.sanitization.parsedAs, 'text/html');
    const state = await frame.evaluate(() => ({
      text: document.body.textContent.replace(/\s+/g, ' '),
      listItems: document.querySelectorAll('li').length,
    }));
    assert.match(state.text, /Smith & Sons/);
    assert.match(state.text, /MALFORMED_TAIL_SENTINEL/);
    assert.equal(state.listItems, 2);
  });

  test('a spine item that is itself SVG renders as SVG', async () => {
    const { frame } = await renderSection('svg-document');
    const shape = await frame.evaluate(() => {
      const svg = document.querySelector('svg');
      return { present: svg !== null, namespace: svg?.namespaceURI ?? null };
    });
    assert.ok(shape.present, 'the SVG document did not render');
    assert.equal(shape.namespace, 'http://www.w3.org/2000/svg');
  });
});

describe('protocol', { ...skipAll, ...skipVectors }, () => {
  before(openHostileBook);

  test('the ready handshake and a measure round-trip complete', async () => {
    await renderSection('preserve');
    const measurement = await page.evaluate(() => window.harness.measure());
    assert.ok(measurement.width > 0 && measurement.height > 0, JSON.stringify(measurement));
    assert.equal(await page.evaluate(() => window.harness.ping()), true);
  });

  test('a well-formed message from the wrong source is ignored', async () => {
    await renderSection('preserve');
    // A spoofed 'measured' posted by the top window itself, carrying the id the
    // next request will use. If the host dispatched it, measure() would settle
    // with 1x1 instead of the frame's real size.
    await page.evaluate(() => window.harness.spoofFromTopWindow(2));
    const measurement = await page.evaluate(() => window.harness.measure());
    assert.notDeepEqual(measurement, { width: 1, height: 1 });
    assert.ok(measurement.height > 1);
  });

  test('the frame ignores protocol messages from a sibling frame', async () => {
    await renderSection('preserve');
    await page.evaluate(() => window.harness.spoofFromSibling(9001));
    await new Promise((done) => setTimeout(done, 200));
    const observed = await page.evaluate(() => window.harness.observed());
    const answered = observed.fromFrame.filter((message) => message !== null && message.id === 9001);
    assert.deepEqual(answered, [], 'the frame answered a sibling frame');
  });

  test('unknown message shapes are ignored rather than dispatched', async () => {
    await renderSection('preserve');
    const before = (await page.evaluate(() => window.harness.observed())).fromFrame.length;
    await page.evaluate(() => {
      const frame = document.querySelector('iframe');
      for (const payload of [
        'measure',
        { type: 'measure', id: 1 },
        { v: 2, type: 'measure', id: 1 },
        { v: 1, type: 'evaluate', id: 1, code: 'window.__x = 1' },
        { v: 1, type: 'measure' },
      ]) {
        frame.contentWindow.postMessage(payload, '*');
      }
    });
    await new Promise((done) => setTimeout(done, 300));
    const observed = await page.evaluate(() => window.harness.observed());
    assert.equal(observed.fromFrame.length, before, 'the frame replied to an unknown message');
    // The channel is still live afterwards.
    const measurement = await page.evaluate(() => window.harness.measure());
    assert.ok(measurement.height > 0);
  });
});

describe('corpus normalization', { ...skipAll }, () => {
  test('Pride and Prejudice item8 keeps every anchor and its tail', async () => {
    const opened = await page.evaluate(() =>
      window.harness.openBook('/corpus/gutenberg-pride-and-prejudice.epub'),
    );
    if (opened === null) {
      console.log('  corpus absent — skipped (run `npm run fetch-corpus`)');
      return;
    }
    const source = await page.evaluate(() => window.harness.sectionSource('item8'));
    const selfClosing = [...source.matchAll(/<a\s+id="([^"]+)"\s*\/>/g)].map((match) => match[1]);
    const pageAnchors = [...source.matchAll(/<a\s[^>]*id="(page_[^"]+)"/g)].map((match) => match[1]);
    assert.ok(selfClosing.length > 0, 'the corpus section no longer carries self-closing anchors');
    assert.ok(pageAnchors.length > 0, 'the corpus section no longer carries page anchors');

    const { frame } = await renderSection('item8');
    const state = await frame.evaluate(
      ({ selfClosing: ids, pageAnchors: anchors }) => ({
        swallowed: ids.filter((id) => (document.getElementById(id)?.childNodes.length ?? -1) !== 0),
        missing: ids.filter((id) => document.getElementById(id) === null),
        pageAnchorsPresent: anchors.filter((id) => document.getElementById(id) !== null).length,
      }),
      { selfClosing, pageAnchors },
    );
    assert.deepEqual(state.missing, [], 'a self-closing anchor was dropped');
    assert.deepEqual(state.swallowed, [], 'a self-closing anchor swallowed the markup after it');
    assert.equal(state.pageAnchorsPresent, pageAnchors.length);
  });
});
