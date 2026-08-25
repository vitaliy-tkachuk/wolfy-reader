/**
 * Input intent mapping for the reader facade.
 *
 * The sandboxed frame forwards *semantic* gestures — a nav-relevant keydown, a
 * completed horizontal swipe, a non-link tap with its coords + the frame's
 * viewport size (see `src/view/frame.ts`, `PROTOCOL_VERSION` 5). This module
 * turns those into direction-aware navigation intents. It owns no DOM and no
 * host vocabulary; it is pure geometry + a key table, so it is unit-checkable
 * and the facade stays thin.
 *
 * Reading direction (`Book.direction`) flips the *horizontal* axis only:
 * in RTL the visual right edge is the earlier page, so a rightward gesture goes
 * *back* and a leftward gesture goes *forward*. Vertical arrows, PageUp/PageDown
 * and Home/End are direction-neutral — PageDown always advances reading order,
 * Home/End are always book start/end.
 */
import type { ReadingDirection } from '../core/index.ts';

/** What an input event resolves to. `none` means the event maps to nothing. */
export type NavIntent = 'next' | 'prev' | 'nextSection' | 'prevSection' | 'start' | 'end' | 'none';

/**
 * Tap-zone configuration. Each field is the fraction of the frame width [0..1]
 * marking where a zone ends. `left` is the leftmost fraction that turns to the
 * left-edge page; `right` is the fraction from which the right-edge page turns;
 * the band between is inert. Directions are *visual* (left/right of the frame);
 * RTL mapping is applied afterward. Defaults: left third / right third.
 */
export interface TapZones {
  /** Fraction [0..1]: taps with x < left*width hit the left zone. Default 1/3. */
  readonly left?: number;
  /** Fraction [0..1]: taps with x >= right*width hit the right zone. Default 2/3. */
  readonly right?: number;
}

/** Per-reader input configuration. All optional; input is enabled by default. */
export interface InputConfig {
  /** Keyboard navigation. Default true. */
  readonly keyboard?: boolean;
  /** Touch/pointer swipe navigation. Default true. */
  readonly swipe?: boolean;
  /** Tap-zone navigation, or its zone geometry. `false` disables tap zones. Default enabled. */
  readonly tapZones?: TapZones | false;
}

const DEFAULT_LEFT = 1 / 3;
const DEFAULT_RIGHT = 2 / 3;
/** Below this |dx| a swipe is ignored (the frame already thresholds, this guards direction). */
const SWIPE_MIN = 1;

/** Turn a visual direction ('left'|'right') into a nav intent under `direction`. */
function edgeIntent(edge: 'left' | 'right', direction: ReadingDirection): NavIntent {
  // LTR: right edge advances (next), left edge goes back (prev). RTL swaps.
  const rtl = direction === 'rtl';
  if (edge === 'right') return rtl ? 'prev' : 'next';
  return rtl ? 'next' : 'prev';
}

/**
 * Map a `KeyboardEvent.key` to a nav intent, direction-aware. Horizontal arrows
 * flip under RTL; PageUp/PageDown and vertical arrows are reading-order neutral;
 * Home/End are always book start/end.
 */
export function keyIntent(key: string, direction: ReadingDirection): NavIntent {
  switch (key) {
    case 'ArrowRight':
      return edgeIntent('right', direction);
    case 'ArrowLeft':
      return edgeIntent('left', direction);
    case 'ArrowDown':
    case 'PageDown':
      return 'next';
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'start';
    case 'End':
      return 'end';
    default:
      return 'none';
  }
}

/**
 * Map a completed swipe's net delta to a nav intent. A leftward swipe (dx < 0)
 * moves the page contents left → the next visual page; a rightward swipe (dx > 0)
 * reveals the previous. RTL flips both. dy is accepted for symmetry with the
 * wire shape but unused: the frame only forwards horizontal-dominant swipes.
 */
export function swipeIntent(dx: number, _dy: number, direction: ReadingDirection): NavIntent {
  if (Math.abs(dx) < SWIPE_MIN) return 'none';
  return dx < 0 ? edgeIntent('right', direction) : edgeIntent('left', direction);
}

/**
 * Map a tap to a nav intent using the zone fractions, direction-aware. The tap's
 * x is normalized by the frame width; a tap in the left zone turns to the
 * left-edge page and the right zone to the right-edge page (both flipped under
 * RTL); the center band is inert.
 */
export function tapIntent(
  tap: { x: number; width: number },
  zones: TapZones,
  direction: ReadingDirection,
): NavIntent {
  if (tap.width <= 0) return 'none';
  const fraction = tap.x / tap.width;
  const left = zones.left ?? DEFAULT_LEFT;
  const right = zones.right ?? DEFAULT_RIGHT;
  if (fraction < left) return edgeIntent('left', direction);
  if (fraction >= right) return edgeIntent('right', direction);
  return 'none';
}
