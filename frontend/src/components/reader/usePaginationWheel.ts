/**
 * Hook for handling trackpad/mouse wheel gestures in paginated readers.
 *
 * Two behaviours, picked per gesture:
 *
 * - With `follow`, the page tracks the trackpad live and settles onto a page
 *   once the gesture goes quiet. A trackpad has no touch-end, so the quiet
 *   period stands in for the release.
 * - Without it — or when the reader declines to drag, as E-ink does — the
 *   accumulated delta triggers a discrete page turn once it crosses a
 *   threshold, with a cooldown so a momentum tail cannot turn twice.
 */

import { useEffect, useRef } from 'react';
import { WHEEL_GESTURE_END_MS } from './swipe-follow';

export interface PaginationWheelFollow {
  /** Take over for a live drag. Return false to fall back to threshold turns. */
  begin: () => boolean;
  /** Total horizontal travel of the gesture so far, as finger-style travel. */
  move: (dx: number) => void;
  /** The gesture went quiet: settle onto a page. */
  end: (dx: number, durationMs: number) => void;
}

interface PaginationWheelOptions {
  /** Accumulated deltaX required to trigger a page turn (default: 150px) */
  threshold?: number;
  /** Time before accumulated delta resets to 0 (default: 400ms) */
  resetMs?: number;
  /** Cooldown after a page turn before another can trigger (default: 1000ms) */
  cooldownMs?: number;
  /** Quiet period that ends a follow gesture (default: WHEEL_GESTURE_END_MS) */
  gestureEndMs?: number;
  /** Enables follow-the-gesture dragging. */
  follow?: PaginationWheelFollow;
}

const DEFAULTS = {
  threshold: 150,
  resetMs: 400,
  cooldownMs: 1000,
} as const;

export function usePaginationWheel(
  scrollerRef: React.RefObject<HTMLElement | null>,
  onNextPage: () => void,
  onPrevPage: () => void,
  enabled: boolean,
  options?: PaginationWheelOptions,
) {
  const onNextRef = useRef(onNextPage);
  const onPrevRef = useRef(onPrevPage);
  onNextRef.current = onNextPage;
  onPrevRef.current = onPrevPage;

  // Held in a ref so changing callbacks never tears down a gesture in progress.
  const followRef = useRef(options?.follow);
  followRef.current = options?.follow;

  const threshold = options?.threshold ?? DEFAULTS.threshold;
  const resetMs = options?.resetMs ?? DEFAULTS.resetMs;
  const cooldownMs = options?.cooldownMs ?? DEFAULTS.cooldownMs;
  const gestureEndMs = options?.gestureEndMs ?? WHEEL_GESTURE_END_MS;

  useEffect(() => {
    if (!enabled) return;

    const scroller = scrollerRef.current;
    if (!scroller) return;

    let deltaX = 0;
    let cooldown = false;
    let resetTimer: number | null = null;
    let cooldownTimer: number | null = null;

    let following = false;
    let followDx = 0;
    let followStart = 0;
    let holding = false;
    let gestureEndTimer: number | null = null;

    /** (Re)arm the quiet period that stands in for a trackpad release. */
    const armGestureEnd = (onEnd: () => void) => {
      if (gestureEndTimer !== null) clearTimeout(gestureEndTimer);
      gestureEndTimer = window.setTimeout(() => {
        gestureEndTimer = null;
        onEnd();
      }, gestureEndMs);
    };

    /**
     * Ignore the rest of this gesture. Re-armed on every event, so a momentum
     * tail is swallowed however long it runs rather than being read as a
     * fresh gesture that turns a second page.
     */
    const holdUntilQuiet = () => {
      holding = true;
      followDx = 0;
      armGestureEnd(() => { holding = false; });
    };

    const endFollowGesture = () => {
      gestureEndTimer = null;
      if (!following) return;
      following = false;
      const dx = followDx;
      followDx = 0;
      followRef.current?.end(dx, performance.now() - followStart);
      holdUntilQuiet();
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 0.8 || Math.abs(e.deltaX) <= 2) return;

      e.preventDefault();

      // Still swallowing the tail of a gesture that already settled.
      if (holding) {
        holdUntilQuiet();
        return;
      }

      const follow = followRef.current;

      if (follow) {
        if (!following) {
          // The threshold rule below is only for readers that cannot show a
          // live drag at all. Reaching it because a drag is merely busy — a
          // previous settle still animating — would let one gesture commit
          // twice: once on release and again on crossing the threshold.
          if (!follow.begin()) {
            holdUntilQuiet();
            return;
          }
          following = true;
          followDx = 0;
          followStart = performance.now();
        }

        // deltaX is positive scrolling right, which advances the page. Negate it
        // so it reads as finger travel, matching the touch path.
        followDx -= e.deltaX;
        follow.move(followDx);
        armGestureEnd(endFollowGesture);
        return;
      }

      if (cooldown) {
        deltaX = 0;
        return;
      }

      deltaX += e.deltaX;

      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        deltaX = 0;
        resetTimer = null;
      }, resetMs);

      if (deltaX > threshold) {
        deltaX = 0;
        cooldown = true;
        onNextRef.current();
        cooldownTimer = window.setTimeout(() => {
          deltaX = 0;
          cooldown = false;
          cooldownTimer = null;
        }, cooldownMs);
      } else if (deltaX < -threshold) {
        deltaX = 0;
        cooldown = true;
        onPrevRef.current();
        cooldownTimer = window.setTimeout(() => {
          deltaX = 0;
          cooldown = false;
          cooldownTimer = null;
        }, cooldownMs);
      }
    };

    scroller.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      scroller.removeEventListener('wheel', handleWheel);
      deltaX = 0;
      cooldown = false;
      if (resetTimer !== null) clearTimeout(resetTimer);
      if (cooldownTimer !== null) clearTimeout(cooldownTimer);
      // Settle rather than strand the page mid-drag if the reader unmounts or
      // the scroller is swapped while a gesture is still in flight.
      if (gestureEndTimer !== null) clearTimeout(gestureEndTimer);
      endFollowGesture();
      // endFollowGesture arms a hold timer of its own, which has nothing left
      // to guard once the listener is gone.
      if (gestureEndTimer !== null) {
        clearTimeout(gestureEndTimer);
        gestureEndTimer = null;
      }
      holding = false;
    };
  }, [enabled, scrollerRef, threshold, resetMs, cooldownMs, gestureEndMs]);
}
