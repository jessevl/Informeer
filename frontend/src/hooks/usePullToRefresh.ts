/**
 * usePullToRefresh Hook
 * Native-feeling pull-to-refresh gesture for touch devices.
 * Uses touch events with rubber-band physics for the pull distance.
 */

import { useRef, useState, useCallback, useEffect } from 'react';

interface UsePullToRefreshOptions {
  /** The scrollable element ref */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Async function to call when refresh is triggered */
  onRefresh: () => Promise<void>;
  /** Distance in px the user must pull to trigger refresh */
  threshold?: number;
  /** Maximum pull distance (visual cap) */
  maxPull?: number;
  /** Whether the hook is enabled */
  enabled?: boolean;
}

interface UsePullToRefreshReturn {
  /** Current pull distance (0 when not pulling) */
  pullDistance: number;
  /** Whether a refresh is currently in progress */
  isRefreshing: boolean;
  /** Whether the user is currently pulling */
  isPulling: boolean;
  /** Progress from 0-1 (capped at 1 when threshold is reached) */
  progress: number;
}

export function usePullToRefresh({
  scrollRef,
  onRefresh,
  threshold = 80,
  maxPull = 130,
  enabled = true,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || refreshingRef.current) return;

    const el = scrollRef.current;
    if (!el) return;

    // Only start pull if scrolled to top
    if (el.scrollTop > 0) return;

    startYRef.current = e.touches[0].clientY;
  }, [enabled, scrollRef]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || refreshingRef.current) return;
    if (startYRef.current === 0) return;

    const el = scrollRef.current;
    if (!el) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;

    // Only activate if pulling down AND at top of scroll
    if (diff <= 0 || el.scrollTop > 0) {
      if (pullingRef.current) {
        pullingRef.current = false;
        setIsPulling(false);
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
      return;
    }

    // Prevent default scrolling when pulling
    e.preventDefault();

    // Apply rubber-band resistance
    const resistance = Math.min(1, diff / (maxPull * 3));
    const dampedDistance = Math.min(maxPull, diff * (1 - resistance * 0.6));

    if (!pullingRef.current) {
      pullingRef.current = true;
      setIsPulling(true);
    }

    pullDistanceRef.current = dampedDistance;
    setPullDistance(dampedDistance);
  }, [enabled, scrollRef, maxPull]);

  const handleTouchEnd = useCallback(async () => {
    if (!enabled || !pullingRef.current) {
      startYRef.current = 0;
      return;
    }

    const finalDistance = pullDistanceRef.current;
    pullingRef.current = false;
    setIsPulling(false);
    startYRef.current = 0;

    if (finalDistance >= threshold) {
      // Trigger refresh
      setIsRefreshing(true);
      refreshingRef.current = true;
      pullDistanceRef.current = 60;
      setPullDistance(60); // Settle to a fixed position while refreshing

      try {
        await onRefresh();
      } finally {
        refreshingRef.current = false;
        setIsRefreshing(false);
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    } else {
      // Snap back
      pullDistanceRef.current = 0;
      setPullDistance(0);
    }
  }, [enabled, threshold, onRefresh]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [scrollRef, enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(1, pullDistance / threshold);

  return {
    pullDistance,
    isRefreshing,
    isPulling,
    progress,
  };
}
