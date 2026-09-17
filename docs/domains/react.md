# React domain

## Overview

React 19 bindings over the reader facade, in `src/react/index.ts`. `useReader(book,
options)` is the primitive: a callback ref to mount into, the live facade handle
(`ReaderHandle`, the facade's `Reader` type under a name that does not collide with
the component), and the last settled `ReaderPosition` as state. `Reader` is the
component: the book in a `div`, options and one callback per facade event as props,
the facade handle through `ref`. Tests: `test/react.test.ts` (headless, SSR safety)
and `test/browser/react.browser.mjs` (lifecycle against a real frame).

The subpath is not yet in `exports`; the module is importable by path only until
the packaging work publishes it.

## Key decisions

- **The hook is the primitive; the component is a few lines on top.** A host that
  owns its layout wants the ref and the handle, not a wrapper element with a fixed
  shape; a host that wants the common case wants one element. Both are served from
  one lifecycle, so there is one set of semantics to keep.

- **Option changes update the live reader in place; only `book` or the element
  remounts.** The facade's whole value is that `setAppearance` and `setMode` keep
  the reading place. A binding that tore the reader down on any prop change would
  throw that away, so the mount effect keys on `[book, element]` only, and a second
  effect diffs the appearance fields and `mode` against what the live reader
  currently reflects and calls the matching setter with just the changed fields.
  `start` and `input` are read once at mount because the facade has no live setter
  for them. An `undefined` field means "leave as is", never "reset" — the facade's
  partial-update contract has no way to unset, and the bindings do not invent one.

- **Callbacks are read at dispatch time.** The nine facade events are subscribed
  once when the reader is created; each handler reads the latest `onX` prop from a
  ref. Swapping a handler prop therefore never re-subscribes and never remounts,
  and subscribing at creation (not in a later effect) means `ready` cannot fire
  before anyone is listening.

- **React 19 only.** `ref` is an ordinary prop, so there is no `forwardRef`; the
  facade handle is exposed with `useImperativeHandle`. The peer range is set when
  the subpath is published.

- **No JSX under `src/`.** Node's `stripTypeScriptTypes` — which runs `node --test`,
  the demo server and the pack check's runtime probe — rejects JSX, so the bindings
  are `.ts` using `createElement`. A wrapper this thin has no use for JSX anyway.
  The rule is recorded in `docs/coding-conventions.md`.

## Implementation notes

- One callback per facade event, on both `useReader` options and `Reader` props,
  each receiving the event's payload (none for `selectionclear`, whose payload is
  empty):

  | facade event | callback |
  |---|---|
  | `ready` | `onReady(position)` |
  | `positionchange` | `onPositionChange(position)` |
  | `sectionchange` | `onSectionChange(change)` |
  | `linkclick` | `onLinkClick(click)` |
  | `selection` | `onSelection(selection)` |
  | `selectionclear` | `onSelectionClear()` |
  | `tap` | `onTap(tap)` |
  | `decorationtap` | `onDecorationTap(tap)` |
  | `error` | `onError(error)` |

- `useReader` holds three pieces of state (`element`, `reader`, `position`) and two
  refs: `latest` (the options as of the last render — read at mount and by every
  event handler) and `applied` (the options the live reader currently reflects —
  the baseline the diff effect compares against and then advances).

- The diff effect has no dependency array on purpose: it runs after every commit
  and compares ten appearance fields plus `mode` by value (`customProperties` by
  shallow entry equality), which is cheaper than maintaining a dependency list that
  must name every field. It returns early until `reader` is set, so on the mount
  commit it does nothing and on the next commit it finds no diff.

- Facade setters are called fire-and-forget (`void reader.setAppearance(diff)`).
  Their failures are reported by the facade's own `error` event, which the bindings
  forward to `onError`; the promise is not otherwise observed.

- `Reader` spreads its remaining props into `useReader`, so any future facade
  option becomes a component prop without a change here, and the diff decides what
  is live.

- The browser suite bundles `test/browser/react-entry.mjs` with esbuild (`format:
  'esm'`, `process.env.NODE_ENV` defined as `development`) because npm's `react` is
  CJS only. The development build is deliberate: it is what makes `StrictMode`
  double-invoke effects, which is the case the suite must prove leaves one frame.
  The harness wraps the live handle's `setAppearance`/`setMode` to log what the
  bindings asked for, and uses `flushSync` around re-renders so the effects have run
  by the time the log is read.

## Gotchas

- **`StrictMode` mounts twice in development.** The mount effect runs, its cleanup
  destroys the reader, and it runs again. `destroy()` is idempotent, so the cost is
  one extra first paint in dev builds and never a leaked frame. The suite asserts
  exactly one frame afterwards.

- **A new `book` object is a remount, even for the same bytes.** The effect keys
  on identity. A host that re-decodes on every render will re-render the reader on
  every render; decode once and keep the `Book` in state or a ref.

- **A new `customProperties` object with the same entries is not a change.** The
  diff compares entries, not identity, so an inline object literal per render is
  harmless.

- **`useImperativeHandle` needs explicit type arguments** (`<ReaderHandle | null,
  ReaderHandle | null>`): with a `Ref<ReaderHandle | null>` prop, inference picks
  the non-null `T` from `RefObject<T | null>` and rejects the `null` the handle
  returns before mount.

- **`react-dom/server` needs `@types/react-dom`** even though the bindings import
  only `react`; it is a devDependency for the SSR test alone.
