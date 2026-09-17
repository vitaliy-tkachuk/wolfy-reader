/**
 * React 19 bindings over the reader facade. `useReader` is the primitive: a
 * callback ref to mount into, the live facade handle, and the current position
 * as state. `Reader` is the component for the common case — options as props,
 * one callback prop per facade event, the facade handle through `ref`.
 *
 * Option changes after mount go through `setAppearance` / `setMode`, never a
 * re-render of the facade, so the reading place survives a React re-render the
 * same way it survives a direct facade call. Only a new `book` or a new element
 * tears the reader down.
 *
 * Written without JSX: Node's type stripping (which runs the tests, the demo
 * server and the pack check) cannot strip it, and a wrapper this thin has no use
 * for it.
 */
import { createElement, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, Ref } from 'react';

import type { Book } from '../core/index.ts';
import { render } from '../reader/index.ts';
import type {
  Appearance,
  LinkClick,
  Reader as ReaderHandle,
  ReaderOptions,
  ReaderPosition,
  SectionChange,
  SelectionEvent,
} from '../reader/index.ts';

export type { ReaderHandle };

/** One optional callback per facade event. Read at dispatch time, so swapping a handler never re-subscribes. */
export interface ReaderCallbacks {
  /** The first section painted. */
  readonly onReady?: (position: ReaderPosition) => void;
  /** Any navigation settled. */
  readonly onPositionChange?: (position: ReaderPosition) => void;
  /** The active section changed. */
  readonly onSectionChange?: (change: SectionChange) => void;
  /** An in-frame link was clicked, before it is followed. */
  readonly onLinkClick?: (click: LinkClick) => void;
  /** The user selected text in the frame. */
  readonly onSelection?: (selection: SelectionEvent) => void;
  /** A selection reported by `onSelection` is gone (collapsed, or its document was replaced). */
  readonly onSelectionClear?: () => void;
  /** A navigation or render failed. */
  readonly onError?: (error: Error) => void;
}

/**
 * Options for {@link useReader}: the facade's {@link ReaderOptions} plus the
 * callbacks. Appearance fields and `mode` are live — a changed value is applied
 * to the running reader in place. `start` and `input` are read once at mount;
 * the facade has no live setter for them. An `undefined` field means "leave as
 * is", never "reset".
 */
export interface UseReaderOptions extends ReaderOptions, ReaderCallbacks {}

export interface UseReaderResult {
  /** Attach to the element the book renders into. */
  readonly ref: (element: HTMLElement | null) => void;
  /** The live facade, or `null` before mount and after unmount. */
  readonly reader: ReaderHandle | null;
  /** The last settled position, or `null` until `ready`. */
  readonly position: ReaderPosition | null;
}

const APPEARANCE_KEYS = [
  'theme',
  'customProperties',
  'fontFamily',
  'fontSize',
  'lineHeight',
  'margin',
  'textAlign',
  'justify',
  'hyphenate',
  'columns',
] as const satisfies readonly (keyof Appearance & keyof ReaderOptions)[];

type MutableAppearance = { -readonly [K in keyof Appearance]?: Appearance[K] };

function sameRecord(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/** The appearance fields whose value changed between `previous` and `next`; `null` when none did. */
function appearanceDiff(previous: ReaderOptions, next: ReaderOptions): Appearance | null {
  const diff: MutableAppearance = {};
  let changed = false;
  for (const key of APPEARANCE_KEYS) {
    const value = next[key];
    if (value === undefined) continue;
    const before = previous[key];
    const same =
      key === 'customProperties'
        ? before !== undefined && sameRecord(before as Readonly<Record<string, string>>, value as Readonly<Record<string, string>>)
        : before === value;
    if (same) continue;
    (diff as Record<string, unknown>)[key] = value;
    changed = true;
  }
  return changed ? diff : null;
}

/**
 * Renders `book` into whatever element `ref` is attached to and keeps the reader
 * alive for as long as both stay the same. Re-running with different appearance
 * or `mode` values updates the live reader in place.
 */
export function useReader(book: Book, options: UseReaderOptions = {}): UseReaderResult {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [reader, setReader] = useState<ReaderHandle | null>(null);
  const [position, setPosition] = useState<ReaderPosition | null>(null);
  // The latest options, read at mount and at every dispatch, so neither the
  // mount effect nor the subscriptions depend on the options object's identity.
  const latest = useRef(options);
  // The options the live reader currently reflects; the baseline for diffs.
  const applied = useRef<ReaderOptions | null>(null);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (element === null) return undefined;
    const mountOptions = latest.current;
    const live = render(book, element, mountOptions);
    applied.current = mountOptions;
    const unsubscribe = [
      live.on('ready', (at) => {
        setPosition(at);
        latest.current.onReady?.(at);
      }),
      live.on('positionchange', (at) => {
        setPosition(at);
        latest.current.onPositionChange?.(at);
      }),
      live.on('sectionchange', (change) => latest.current.onSectionChange?.(change)),
      live.on('linkclick', (click) => latest.current.onLinkClick?.(click)),
      live.on('selection', (selection) => latest.current.onSelection?.(selection)),
      live.on('selectionclear', () => latest.current.onSelectionClear?.()),
      live.on('error', (error) => latest.current.onError?.(error)),
    ];
    setReader(live);
    return () => {
      for (const off of unsubscribe) off();
      live.destroy();
      applied.current = null;
      setReader(null);
      setPosition(null);
    };
  }, [book, element]);

  useEffect(() => {
    const previous = applied.current;
    if (reader === null || previous === null) return;
    applied.current = options;
    if (options.mode !== undefined && options.mode !== previous.mode) void reader.setMode(options.mode);
    const diff = appearanceDiff(previous, options);
    if (diff !== null) void reader.setAppearance(diff);
  });

  return { ref: setElement, reader, position };
}

/** Props for {@link Reader}: the book, the live options and callbacks, and the mount element's own attributes. */
export interface ReaderProps extends UseReaderOptions {
  readonly book: Book;
  /** Receives the facade handle after mount, `null` after unmount. */
  readonly ref?: Ref<ReaderHandle | null>;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** The book in a `div`. Everything else is {@link useReader}. */
export function Reader(props: ReaderProps): ReactElement {
  const { book, ref, className, style, ...options } = props;
  const { ref: mount, reader } = useReader(book, options);
  useImperativeHandle<ReaderHandle | null, ReaderHandle | null>(ref, () => reader, [reader]);
  return createElement('div', { ref: mount, className, style });
}
