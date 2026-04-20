/**
 * Hook for handling trackpad/mouse wheel gestures in paginated readers.
 *
 * Accumulates horizontal deltaX from wheel events and triggers page
 * navigation when a threshold is crossed. Includes cooldown to prevent
 * rapid-fire page turns from momentum scrolling.
 */

import { useEffect, useRef } from 'react';

interface PaginationWheelOptions {
  /** Accumulated deltaX required to trigger a page turn (default: 150px) */
  threshold?: number;
  /** Time before accumulated delta resets to 0 (default: 400ms) */
  resetMs?: number;
  /** Cooldown after a page turn before another can trigger (default: 1000ms) */
  cooldownMs?: number;
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

  const threshold = options?.threshold ?? DEFAULTS.threshold;
  const resetMs = options?.resetMs ?? DEFAULTS.resetMs;
  const cooldownMs = options?.cooldownMs ?? DEFAULTS.cooldownMs;

  useEffect(() => {
    if (!enabled) return;

    const scroller = scrollerRef.current;
    if (!scroller) return;

    let deltaX = 0;
    let cooldown = false;
    let resetTimer: number | null = null;
    let cooldownTimer: number | null = null;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 0.8 || Math.abs(e.deltaX) <= 2) return;

      e.preventDefault();

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
    };
  }, [enabled, scrollerRef, threshold, resetMs, cooldownMs]);
}
