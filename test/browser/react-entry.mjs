// The browser-side half of react.browser.mjs. esbuild bundles this file together
// with React (CJS-only on npm) and the bindings into one ESM module that the test
// injects into react-harness.html; it exists only to be bundled.
import { createElement, StrictMode, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { open } from '../../src/core/index.ts';
import { epub, fb2, text } from '../../src/formats/index.ts';
import { Reader, useReader } from '../../src/react/index.ts';

const stage = document.querySelector('#stage');
let root = null;
let book = null;
let props = {};
let strict = false;
// Callback-prop invocations in order, and facade calls the bindings made.
let events = [];
let calls = [];
let handle = null;
let frameTokens = 0;

function tokenOf(frame) {
  if (frame.dataset.token === undefined) frame.dataset.token = String((frameTokens += 1));
  return frame.dataset.token;
}

/** Wraps the live facade's setters so the test can see what the bindings asked for. */
function observe(reader) {
  if (reader === null || reader.__observed === true) return;
  reader.__observed = true;
  for (const method of ['setAppearance', 'setMode']) {
    const original = reader[method].bind(reader);
    reader[method] = (argument) => {
      const promise = original(argument);
      calls.push({ method, argument, promise });
      return promise;
    };
  }
}

function element(refCapture) {
  const callbacks = {
    onReady: (at) => events.push({ type: 'ready', payload: at }),
    onPositionChange: (at) => events.push({ type: 'positionchange', payload: at }),
    onSectionChange: (change) => events.push({ type: 'sectionchange', payload: change }),
    onLinkClick: (click) => events.push({ type: 'linkclick', payload: click }),
    onSelection: (selection) => events.push({ type: 'selection', payload: selection }),
    onError: (error) => events.push({ type: 'error', payload: String(error) }),
  };
  const node = createElement(Reader, {
    book,
    ref: (reader) => {
      handle = reader;
      observe(reader);
      refCapture?.(reader);
    },
    style: { width: '100%', height: '100%' },
    ...callbacks,
    ...props,
  });
  return strict ? createElement(StrictMode, null, node) : node;
}

function whenReady() {
  return new Promise((resolve) => {
    const tick = () => {
      const ready = events.find((entry) => entry.type === 'ready');
      if (ready !== undefined) resolve(ready.payload);
      else setTimeout(tick, 10);
    };
    tick();
  });
}

/** A hook consumer: renders the mount div plus the position as text. */
function HookConsumer(hookProps) {
  const { ref, reader, position } = useReader(book, hookProps);
  const seen = useRef(null);
  if (reader !== null && seen.current !== reader) {
    seen.current = reader;
    observe(reader);
    handle = reader;
  }
  return createElement(
    'div',
    { style: { width: '100%', height: '100%' } },
    createElement('div', { ref, id: 'hook-mount', style: { width: '100%', height: '90%' } }),
    createElement('output', { id: 'hook-position' }, position === null ? 'none' : `${position.section}:${position.page}`),
  );
}

window.reactHarness = {
  async openBook(url) {
    const response = await fetch(url);
    if (!response.ok) return null;
    book = await open(await response.arrayBuffer(), { formats: [epub, fb2, text] });
    return book.sections.length;
  },

  /** Mounts <Reader> with `initialProps`; resolves with the ready position. */
  async mount(initialProps = {}, options = {}) {
    events = [];
    calls = [];
    handle = null;
    props = initialProps;
    strict = options.strict === true;
    root = createRoot(stage);
    root.render(element());
    return whenReady();
  },

  /** Mounts a useReader consumer; resolves once its position output is set. */
  async mountHook(initialProps = {}) {
    events = [];
    calls = [];
    handle = null;
    props = initialProps;
    root = createRoot(stage);
    root.render(createElement(HookConsumer, props));
    await new Promise((resolve) => {
      const tick = () => {
        const output = document.querySelector('#hook-position');
        if (output !== null && output.textContent !== 'none') resolve();
        else setTimeout(tick, 10);
      };
      tick();
    });
    return document.querySelector('#hook-position').textContent;
  },

  /** Re-renders with `next` merged over the current props; awaits any facade call the bindings made. */
  async update(next, { hook = false } = {}) {
    const before = calls.length;
    props = { ...props, ...next };
    // Commit synchronously so the effects that diff the options have run by the
    // time the call log is read; a scheduled render lands after this returns.
    flushSync(() => root.render(hook ? createElement(HookConsumer, props) : element()));
    await Promise.all(calls.slice(before).map((call) => call.promise));
    return calls.slice(before).map(({ method, argument }) => ({ method, argument }));
  },

  /** Swaps `book` for a freshly decoded copy of the same bytes and re-renders. */
  async swapBook(url) {
    const response = await fetch(url);
    book = await open(await response.arrayBuffer(), { formats: [epub, fb2, text] });
    events = [];
    root.render(element());
    return whenReady();
  },

  unmount() {
    root?.unmount();
    root = null;
  },

  frames() {
    return [...document.querySelectorAll('iframe')].map(tokenOf);
  },
  events: () => events.map(({ type, payload }) => ({ type, payload })),
  calls: () => calls.map(({ method, argument }) => ({ method, argument })),
  handle: () => (handle === null ? null : { methods: ['next', 'goTo', 'search', 'decorate', 'sentences', 'destroy'].filter((m) => typeof handle[m] === 'function') }),
  hookPosition: () => document.querySelector('#hook-position')?.textContent ?? null,
  async next() {
    await handle.next();
    return handle.position;
  },
};
window.reactHarnessReady = true;
