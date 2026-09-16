import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { open } from '../src/core/index.ts';
import { text } from '../src/formats/text/index.ts';
import { Reader, useReader } from '../src/react/index.ts';

/**
 * The headless half of the React bindings' proof: importing and server-rendering
 * them touches no DOM. Lifecycle — mount, live option updates, unmount — is only
 * observable against a real frame and lives in test/browser/react.browser.mjs.
 */
describe('react bindings — SSR safety', () => {
  test('the module imports without a DOM and exports the hook and the component', () => {
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(typeof useReader, 'function');
    assert.equal(typeof Reader, 'function');
  });

  test('renderToString(<Reader book />) yields the mount div and runs no effect', async () => {
    const book = await open(new TextEncoder().encode('Once upon a time.').buffer, { formats: [text] });
    const html = renderToString(createElement(Reader, { book, className: 'wr', style: { height: '100%' } }));
    assert.match(html, /^<div class="wr" style="height:100%"><\/div>$/);
  });
});
