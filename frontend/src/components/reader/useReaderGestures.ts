/**
 * useReaderGestures — Shared gesture handling for page-based readers
 *
 * Supports:
 * - Single-finger swipe (scale=1): page navigation with velocity/distance threshold
 * - Single-finger pan (zoomed): translate content
 * - Live swipeOffset during drag for visual feedback
 * - Pinch-to-zoom (touch): two-finger distance tracking, focal-point zoom
 * - Two-finger swipe (scale=1): page turn when pinch distance stable
 * - Trackpad scroll: ctrlKey for pinch, accumulated horizontal for page turns
 * - Swipe cooldown to prevent duplicate page turns from inertia
 * - Click zones: left 30% prev, right 30% next
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ReaderGestureCallbacks {
  nextPage: () => void;
  prevPage: () => void;
  canGoNext: boolean;
  canGoPrev: boolean;
}

export interface ReaderGestureOptions {
  /** Current zoom scale (1 = 100%) */
  scale: number;
  setScale: (updater: (prev: number) => number) => void;
  /** Max zoom scale */
  maxScale?: number;
  /** Enable click zones for navigation (left/right 30%) */
  enableClickZones?: boolean;
  /** Enable pinch-to-zoom */
  enableZoom?: boolean;
  /** Enable live horizontal drag preview before a page turn commits */
  enableSwipePreview?: boolean;
}

export interface ReaderGestureState {
  /** Live horizontal offset during swipe drag (px) */
  swipeOffset: number;
  /** Pan offset when zoomed (px) */
  panOffset: { x: number; y: number };
  /** React touch event handlers for the content area */
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
  /** Click handler for click-zone navigation */
  handleContentClick: (e: React.MouseEvent) => void;
  /** Ref to attach to the container for wheel/pinch events */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Reset pan offset (e.g. when scale changes) */
  resetPan: () => void;
  /**
   * Ref to the element that should receive the live CSS zoom transform.
   * Attach this to the canvas wrapper div. During pinch/wheel zoom gestures,
   * the hook applies CSS `transform: scale()` directly for GPU-accelerated
   * feedback, deferring the expensive re-render until the gesture ends.
   */
  zoomTargetRef: React.RefObject<HTMLDivElement>;
}

export function useReaderGestures(
  callbacks: ReaderGestureCallbacks,
  options: ReaderGestureOptions,
): ReaderGestureState {
  const {
    scale,
    setScale,
    maxScale = 3,
    enableClickZones = true,
    enableZoom = true,
    enableSwipePreview = true,
  } = options;

  const [swipeOffset, setSwipeOffset] = useState(0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null!);
  const zoomTargetRef = useRef<HTMLDivElement>(null!);

  // Mutable refs to avoid stale closures in event handlers
  const scaleRef = useRef(scale);
  const panOffsetRef = useRef(panOffset);
  const callbacksRef = useRef(callbacks);

  // Live CSS zoom: during pinch/wheel zoom gestures we apply a CSS
  // transform:scale() to zoomTargetRef for instant visual feedback and
  // only commit the new scale via setScale() when the gesture ends.
  // `committedScaleRef` is the last scale actually rendered by the consumer.
  const committedScaleRef = useRef(scale);
  const liveScaleRef = useRef(scale);
  const zoomRafRef = useRef<number | null>(null);
  const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Apply CSS zoom instantly (GPU-accelerated, no React re-render). */
  const applyLiveZoom = useCallback(() => {
    const el = zoomTargetRef.current;
    if (!el) return;
    const cssRatio = liveScaleRef.current / committedScaleRef.current;
    if (Math.abs(cssRatio - 1) < 0.001) {
      el.style.transform = '';
    } else {
      el.style.transform = `scale(${cssRatio})`;
    }
  }, []);

  /** Schedule a RAF-batched CSS zoom update. */
  const scheduleZoomUpdate = useCallback(() => {
    if (zoomRafRef.current !== null) return; // already scheduled
    zoomRafRef.current = requestAnimationFrame(() => {
      zoomRafRef.current = null;
      applyLiveZoom();
    });
  }, [applyLiveZoom]);

  /** Commit the live scale → React state (triggers PDF re-render).
   *  Keep the CSS transform in place — it will be cleared by a useEffect
   *  after the consumer has actually re-rendered at the new scale. */
  const commitScale = useCallback(() => {
    const finalScale = liveScaleRef.current;
    scaleRef.current = finalScale;
    setScale(() => finalScale);
    // Don't clear CSS transform here — the element still shows at the OLD
    // committed scale. The CSS transform keeps the visual correct until the
    // consumer re-renders at finalScale.
  }, [setScale]);

  // Keep simple refs in sync
  scaleRef.current = scale;
  panOffsetRef.current = panOffset;
  callbacksRef.current = callbacks;

  // After the consumer re-renders at the committed scale, wait one frame
  // for the canvas to actually paint, then clear the CSS transform.
  useEffect(() => {
    // scale changed via setScale in commitScale — check if it matches live
    if (Math.abs(scale - liveScaleRef.current) < 0.001 &&
        Math.abs(scale - committedScaleRef.current) > 0.001) {
      // Scale state caught up. Wait one rAF for the canvas to repaint,
      // then update committedScaleRef and remove the CSS transform.
      const raf = requestAnimationFrame(() => {
        committedScaleRef.current = scale;
        const el = zoomTargetRef.current;
        if (el) el.style.transform = '';
      });
      return () => cancelAnimationFrame(raf);
    }
    // External scale change (e.g. reset to 1) — sync immediately
    if (Math.abs(scale - committedScaleRef.current) > 0.001 &&
        Math.abs(scale - liveScaleRef.current) > 0.001) {
      committedScaleRef.current = scale;
      liveScaleRef.current = scale;
      const el = zoomTargetRef.current;
      if (el) el.style.transform = '';
    }
  }, [scale]);

  // Touch tracking
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Double-tap tracking
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Two-finger swipe tracking
  const twoFingerSwipeRef = useRef<{
    startMidX: number;
    startMidY: number;
    startTime: number;
    lastMidX: number;
    lastMidY: number;
    active: boolean;
  } | null>(null);

  // Trackpad scroll accumulator
  const scrollAccumRef = useRef({ x: 0, timer: null as ReturnType<typeof setTimeout> | null });

  // Swipe cooldown
  const swipeCooldownRef = useRef(false);

  // Pinch-to-zoom refs
  const pinchDistRef = useRef<number | null>(null);
  const pinchScaleRef = useRef(1);

  const resetPan = useCallback(() => {
    setPanOffset({ x: 0, y: 0 });
    panOffsetRef.current = { x: 0, y: 0 };
  }, []);

  // Auto-reset pan when scale returns to 1
  useEffect(() => {
    if (scale <= 1 && (panOffset.x !== 0 || panOffset.y !== 0)) {
      resetPan();
    }
  }, [scale]);

  // ---------- Double-tap to zoom ----------

  /**
   * Double-tap zoom levels (cycles through):
   * - From scale=1: zoom to 2.5× (comfortable reading zoom for text)
   * - From scale≈2.5: zoom to 4× (close-up for fine detail)
   * - From scale>2.5 or scale≈4: reset to 1× (fit page)
   *
   * Centers the zoom on the tap point so the tapped content stays
   * under the finger after zooming.
   */
  const handleDoubleTap = useCallback((clientX: number, clientY: number) => {
    if (!enableZoom) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    // Tap position relative to container center (normalized -0.5..0.5)
    const relX = (clientX - rect.left) / rect.width - 0.5;
    const relY = (clientY - rect.top) / rect.height - 0.5;

    const current = scaleRef.current;
    let newScale: number;

    if (current < 1.5) {
      // At ~1×: zoom to 2.5× for comfortable text reading
      newScale = 2.5;
    } else if (current < 3.5) {
      // At ~2.5×: zoom to 4× for fine detail
      newScale = Math.min(4, maxScale);
    } else {
      // At 4× or above: reset to 1×
      newScale = 1;
    }

    if (newScale <= 1) {
      // Reset: go to 1× with no pan
      scaleRef.current = 1;
      liveScaleRef.current = 1;
      panOffsetRef.current = { x: 0, y: 0 };
      setPanOffset({ x: 0, y: 0 });
      commitScale();
    } else {
      // Zoom in: center on tap point
      // The pan offset should place the tapped point at the same screen position
      const scaleRatio = newScale / current;
      const prevPan = panOffsetRef.current;
      const newPan = {
        x: prevPan.x * scaleRatio - relX * rect.width * (scaleRatio - 1),
        y: prevPan.y * scaleRatio - relY * rect.height * (scaleRatio - 1),
      };

      scaleRef.current = newScale;
      liveScaleRef.current = newScale;
      panOffsetRef.current = newPan;
      setPanOffset(newPan);
      commitScale();
    }
  }, [enableZoom, maxScale, commitScale]);

  // ---------- React touch handlers (single-finger) ----------

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      if (scaleRef.current <= 1) {
        setSwipeOffset(0);
      } else {
        panStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          panX: panOffsetRef.current.x,
          panY: panOffsetRef.current.y,
        };
      }
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1 || !touchStartRef.current) return;

    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;

    if (scaleRef.current > 1 && panStartRef.current) {
      const newPan = {
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      };
      panOffsetRef.current = newPan;
      setPanOffset(newPan);
    } else if (scaleRef.current <= 1) {
      if (enableSwipePreview && Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 10) {
        const { canGoNext, canGoPrev } = callbacksRef.current;
        const atEdge = (dx > 0 && !canGoPrev) || (dx < 0 && !canGoNext);
        setSwipeOffset(atEdge ? dx * 0.2 : dx * 0.4);
      } else if (!enableSwipePreview && swipeOffset !== 0) {
        setSwipeOffset(0);
      }
    }
  }, [enableSwipePreview, swipeOffset]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartRef.current && e.touches.length === 0) {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      const dt = Date.now() - touchStartRef.current.time;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Determine if this was a tap (small movement, short duration)
      const isTap = absDx < 15 && absDy < 15 && dt < 300;

      if (isTap) {
        // Check for double-tap
        const last = lastTapRef.current;
        const now = Date.now();
        if (
          last &&
          now - last.time < 350 &&
          Math.abs(touch.clientX - last.x) < 40 &&
          Math.abs(touch.clientY - last.y) < 40
        ) {
          // Double-tap detected — zoom
          lastTapRef.current = null;
          handleDoubleTap(touch.clientX, touch.clientY);
          touchStartRef.current = null;
          panStartRef.current = null;
          setSwipeOffset(0);
          return;
        }
        lastTapRef.current = { x: touch.clientX, y: touch.clientY, time: now };
      } else {
        lastTapRef.current = null;
      }

      if (scaleRef.current <= 1) {
        const isHorizontal = absDx > absDy * 1.5;
        const velocity = absDx / Math.max(dt, 1);
        const isFlick = velocity > 0.5 && absDx > 60;
        const isDrag = absDx > 100 && dt < 600;

        if (isHorizontal && (isFlick || isDrag)) {
          if (dx < 0) callbacksRef.current.nextPage();
          else callbacksRef.current.prevPage();
        }
      }
    }

    touchStartRef.current = null;
    panStartRef.current = null;
    setSwipeOffset(0);
  }, [handleDoubleTap]);

  // ---------- Native listeners: wheel, pinch-to-zoom ----------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheel(e: WheelEvent) {
      const isPinch = e.ctrlKey || e.metaKey;
      const currentScale = scaleRef.current;

      if (isPinch && enableZoom) {
        e.preventDefault();
        const delta = -e.deltaY * 0.01;
        const oldLive = liveScaleRef.current;
        const newLive = Math.min(Math.max(oldLive + delta, 1), maxScale);
        liveScaleRef.current = newLive;
        scaleRef.current = newLive;

        // Update pan proportionally
        if (newLive <= 1) {
          panOffsetRef.current = { x: 0, y: 0 };
          setPanOffset({ x: 0, y: 0 });
        } else if (oldLive > 1) {
          const ratio = newLive / oldLive;
          const prev = panOffsetRef.current;
          const newPan = { x: prev.x * ratio, y: prev.y * ratio };
          panOffsetRef.current = newPan;
          setPanOffset(newPan);
        }

        // Instant CSS zoom (no React re-render)
        scheduleZoomUpdate();

        // Debounce the expensive commit (PDF re-render) until gesture settles
        if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = setTimeout(() => {
          wheelCommitTimerRef.current = null;
          commitScale();
        }, 180);
      } else if (currentScale > 1) {
        e.preventDefault();
        const prev = panOffsetRef.current;
        const newPan = { x: prev.x - e.deltaX, y: prev.y - e.deltaY };
        panOffsetRef.current = newPan;
        setPanOffset(newPan);
      } else {
        // At scale=1: horizontal trackpad swipe → page turn
        const acc = scrollAccumRef.current;
        if (swipeCooldownRef.current) {
          acc.x = 0;
          return;
        }

        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.8 && Math.abs(e.deltaX) > 2) {
          e.preventDefault();
          acc.x += e.deltaX;

          if (acc.timer) clearTimeout(acc.timer);
          acc.timer = setTimeout(() => { acc.x = 0; }, 400);

          const threshold = 150;
          if (acc.x > threshold) {
            acc.x = 0;
            swipeCooldownRef.current = true;
            callbacksRef.current.nextPage();
            setTimeout(() => { swipeCooldownRef.current = false; acc.x = 0; }, 1000);
          } else if (acc.x < -threshold) {
            acc.x = 0;
            swipeCooldownRef.current = true;
            callbacksRef.current.prevPage();
            setTimeout(() => { swipeCooldownRef.current = false; acc.x = 0; }, 1000);
          }
        }
      }
    }

    function handleTouchStartPinch(e: TouchEvent) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDistRef.current = Math.hypot(dx, dy);
        pinchScaleRef.current = scaleRef.current;

        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        panStartRef.current = {
          x: midX, y: midY,
          panX: panOffsetRef.current.x,
          panY: panOffsetRef.current.y,
        };

        twoFingerSwipeRef.current = {
          startMidX: midX, startMidY: midY,
          startTime: Date.now(),
          lastMidX: midX, lastMidY: midY,
          active: true,
        };
        touchStartRef.current = null;
      }
    }

    function handleTouchMovePinch(e: TouchEvent) {
      if (e.touches.length === 2 && pinchDistRef.current !== null) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / pinchDistRef.current;

        if (enableZoom) {
          const newScale = Math.min(Math.max(pinchScaleRef.current * ratio, 1), maxScale);

          const sw = twoFingerSwipeRef.current;
          if (sw) {
            if (Math.abs(ratio - 1) > 0.12) sw.active = false;
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            sw.lastMidX = midX;
            sw.lastMidY = midY;
          }

          // Live CSS zoom — no React state update during gesture
          liveScaleRef.current = newScale;
          scaleRef.current = newScale;
          scheduleZoomUpdate();

          if (panStartRef.current) {
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

            if (newScale > 1) {
              const scaleRatio = newScale / pinchScaleRef.current;
              const translateX = midX - panStartRef.current.x;
              const translateY = midY - panStartRef.current.y;
              const newPan = {
                x: panStartRef.current.panX * scaleRatio + translateX,
                y: panStartRef.current.panY * scaleRatio + translateY,
              };
              panOffsetRef.current = newPan;
              setPanOffset(newPan);
            } else {
              panOffsetRef.current = { x: 0, y: 0 };
              setPanOffset({ x: 0, y: 0 });
            }
          }
        } else {
          // Zoom disabled: only track swipe
          const sw = twoFingerSwipeRef.current;
          if (sw) {
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            sw.lastMidX = midX;
            sw.lastMidY = midY;
          }
        }
      }
    }

    function handleTouchEndPinch(e: TouchEvent) {
      const sw = twoFingerSwipeRef.current;
      if (sw && sw.active && scaleRef.current <= 1 && e.touches.length < 2) {
        const dx = sw.lastMidX - sw.startMidX;
        const dy = sw.lastMidY - sw.startMidY;
        const dt = Date.now() - sw.startTime;
        const absDx = Math.abs(dx);
        const isHorizontal = absDx > Math.abs(dy) * 1.5;
        const velocity = absDx / Math.max(dt, 1);

        if (isHorizontal && (absDx > 80 || (velocity > 0.4 && absDx > 40)) && dt < 600) {
          if (dx < 0) callbacksRef.current.nextPage();
          else callbacksRef.current.prevPage();
        }
      }

      if (scaleRef.current <= 1) {
        panOffsetRef.current = { x: 0, y: 0 };
        setPanOffset({ x: 0, y: 0 });
      }

      // Commit the live CSS zoom → actual PDF re-render
      commitScale();

      pinchDistRef.current = null;
      panStartRef.current = null;
      twoFingerSwipeRef.current = null;
    }

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStartPinch, { passive: true });
    container.addEventListener('touchmove', handleTouchMovePinch, { passive: false });
    container.addEventListener('touchend', handleTouchEndPinch);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStartPinch);
      container.removeEventListener('touchmove', handleTouchMovePinch);
      container.removeEventListener('touchend', handleTouchEndPinch);
      if (scrollAccumRef.current.timer) clearTimeout(scrollAccumRef.current.timer);
      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current);
      if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
    };
  }, [enableZoom, maxScale, setScale, scheduleZoomUpdate, commitScale]);

  // ---------- Click zones ----------

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    if (!enableClickZones) return;
    // Don't navigate if clicking on a button or interactive element (prevents double-fire)
    if ((e.target as HTMLElement).closest('button, a, [role="button"]')) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    if (x < width * 0.2) {
      callbacksRef.current.prevPage();
    } else if (x > width * 0.8) {
      callbacksRef.current.nextPage();
    }
  }, [enableClickZones]);

  return {
    swipeOffset,
    panOffset,
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    handleContentClick,
    containerRef,
    zoomTargetRef,
    resetPan,
  };
}
