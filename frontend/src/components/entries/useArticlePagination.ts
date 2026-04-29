/**
 * useArticlePagination — encapsulates all horizontal-scroll pagination logic
 * for the ArticleReader: page measurement, navigation, animation, snap
 * correction, nav-state tracking, and e-ink page-turn lifecycle.
 */

import { useState, useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { einkPower } from '@/services/eink-power';

const ARTICLE_PAGE_GAP_PX = 40;
const RECOMMENDED_TWO_COLUMN_PAGE_WIDTH_PX = 200;
const PAGINATION_SCROLL_ANIMATION_MS = 220;
const PAGINATION_READY_FALLBACK_MS = 900;

export interface PageNavState {
  canPrev: boolean;
  canNext: boolean;
  currentPage: number;
  totalPages: number;
}

interface UseArticlePaginationOptions {
  entryId: number;
  isPaginated: boolean;
  einkMode: boolean;
  scrollRef: React.RefObject<HTMLElement | null>;
  columnCount: number;
  startEinkWork: (reason: string) => string;
  finishEinkWork: (tag: string | null) => void;
  /** Extra deps that should re-trigger page measurement (e.g. content changes) */
  measureDeps: unknown[];
}

const EMPTY_NAV: PageNavState = { canPrev: false, canNext: false, currentPage: 0, totalPages: 0 };

export function useArticlePagination({
  entryId,
  isPaginated,
  einkMode,
  scrollRef,
  columnCount,
  startEinkWork,
  finishEinkWork,
  measureDeps,
}: UseArticlePaginationOptions) {
  // ─── Page width measurement ────────────────────────────────────
  const [pageWidth, setPageWidth] = useState(0);
  const [trailingBlankColumns, setTrailingBlankColumns] = useState(0);
  const [targetScrollWidth, setTargetScrollWidth] = useState(0);

  // ─── Synchronous initial measurement before first paint ───────
  // Using useLayoutEffect for the initial measure means the column count is
  // correct on the very first render, avoiding the single-column flash that
  // happens when pageWidth starts at 0.
  useLayoutEffect(() => {
    if (!isPaginated) {
      setPageWidth(0);
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller) return;
    const layout = scroller.querySelector('[data-article-layout]') as HTMLElement | null;
    if (!layout) return;
    const styles = window.getComputedStyle(layout);
    const paddingX = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');
    const width = Math.max(0, layout.clientWidth - paddingX);
    if (width > 0) setPageWidth(width);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, isPaginated, scrollRef, ...measureDeps]);

  // ─── Ongoing resize observer ───────────────────────────────────
  useEffect(() => {
    if (!isPaginated) return;

    const scroller = scrollRef.current;
    if (!scroller) return;

    const measure = () => {
      // Don't resize-remeasure the page width during a page turn — it can
      // cause a mid-transition column reflow / blink.
      if (isPaginatedTransitioningRef.current) return;
      const layout = scroller.querySelector('[data-article-layout]') as HTMLElement | null;
      if (!layout) return;

      const styles = window.getComputedStyle(layout);
      const paddingX = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');
      const width = Math.max(0, layout.clientWidth - paddingX);
      if (width > 0) {
        setPageWidth(width);
      }
    };

    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    ro.observe(scroller);

    const layout = scroller.querySelector('[data-article-layout]') as HTMLElement | null;
    if (layout) ro.observe(layout);

    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, isPaginated, scrollRef, ...measureDeps]);

  // ─── Derived layout ────────────────────────────────────────────
  const getPageStep = useCallback((scroller: HTMLElement) => {
    const effectivePageWidth = pageWidth > 0 ? pageWidth : scroller.clientWidth;
    return effectivePageWidth + ARTICLE_PAGE_GAP_PX;
  }, [pageWidth]);

  const canUseTwoColumnLayout = pageWidth >= RECOMMENDED_TWO_COLUMN_PAGE_WIDTH_PX * 2 + ARTICLE_PAGE_GAP_PX;
  const effectiveColumnCount: 1 | 2 = isPaginated && columnCount === 2 ? 2 : 1;

  const getPageMetrics = useCallback((scroller: HTMLElement) => {
    const step = getPageStep(scroller);
    const flow = scroller.querySelector('[data-article-flow]') as HTMLElement | null;
    
    // Calculate effective column stride
    const flowStyle = flow ? window.getComputedStyle(flow) : null;
    const columnGap = flowStyle ? Number.parseFloat(flowStyle.columnGap || `${ARTICLE_PAGE_GAP_PX}`) : ARTICLE_PAGE_GAP_PX;
    const fallbackColumnWidth = pageWidth > 0
      ? effectiveColumnCount === 2
        ? (pageWidth - ARTICLE_PAGE_GAP_PX) / 2
        : pageWidth
      : 0;
    const measuredColumnWidth = flowStyle ? Number.parseFloat(flowStyle.columnWidth || '0') : fallbackColumnWidth;
    const columnWidth = Number.isFinite(measuredColumnWidth) && measuredColumnWidth > 0
      ? measuredColumnWidth
      : fallbackColumnWidth;
    const columnStride = columnWidth > 0 ? columnWidth + columnGap : step;
    
    const renderedTrailingBlankColumns = flow?.querySelectorAll('[data-article-trailing-spacer]').length ?? 0;
    
    // WebKit often truncates scrollWidth for short columns. We append &nbsp; blocks to
    // force accurate widths, making naturalFlowScrollWidth a perfect multiple of columns.
    const currentScrollWidth = flow ? flow.scrollWidth : 0;
    const naturalFlowScrollWidth = Math.max(0, currentScrollWidth - renderedTrailingBlankColumns * columnStride);
    
    const naturalColumnCount = columnStride > 0
      ? Math.max(1, Math.round((naturalFlowScrollWidth + columnGap) / columnStride))
      : 1;

    const nextTrailingBlankColumns = effectiveColumnCount > 1
      ? (effectiveColumnCount - (naturalColumnCount % effectiveColumnCount || effectiveColumnCount)) % effectiveColumnCount
      : 0;

    const totalPages = Math.max(1, Math.ceil((naturalColumnCount + nextTrailingBlankColumns) / effectiveColumnCount));

    const nextTargetScrollWidth = Math.round((totalPages - 1) * step) + scroller.clientWidth;

    const getPageLeft = (pageIndex: number) => {
      const clampedPage = Math.max(0, Math.min(totalPages - 1, pageIndex));
      return Math.round(clampedPage * step);
    };

    return {
      step,
      totalPages,
      getPageLeft,
      lastPageLeft: Math.round((totalPages - 1) * step),
      trailingBlankColumns: nextTrailingBlankColumns,
      targetScrollWidth: nextTargetScrollWidth,
    };
  }, [effectiveColumnCount, getPageStep, pageWidth]);

  const syncTrailingSpace = useCallback((nextBlankColumns: number, nextWidth: number) => {
    setTrailingBlankColumns((prev) => prev === nextBlankColumns ? prev : nextBlankColumns);
    setTargetScrollWidth((prev) => prev === nextWidth ? prev : nextWidth);
  }, []);

  // ─── Navigation state ─────────────────────────────────────────
  const [pageNavState, setPageNavState] = useState<PageNavState>(EMPTY_NAV);

  const updatePageNavState = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const {
      step,
      totalPages,
      lastPageLeft,
      trailingBlankColumns: nextBlankColumns,
      targetScrollWidth: nextWidth
    } = getPageMetrics(scroller);
    syncTrailingSpace(nextBlankColumns, nextWidth);
    const currentPage = totalPages <= 1
      ? 0
      : scroller.scrollLeft >= lastPageLeft - 4
        ? totalPages - 1
        : Math.round(scroller.scrollLeft / step);
    const next: PageNavState = {
      canPrev: currentPage > 0,
      canNext: currentPage < totalPages - 1,
      currentPage,
      totalPages,
    };
    setPageNavState((prev) => (
      prev.canPrev === next.canPrev
      && prev.canNext === next.canNext
      && prev.currentPage === next.currentPage
      && prev.totalPages === next.totalPages
    ) ? prev : next);
  }, [getPageMetrics, scrollRef, syncTrailingSpace]);

  // Kick off initial nav-state computation + resize listener
  useEffect(() => {
    if (!isPaginated) {
      setPageNavState(EMPTY_NAV);
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller) {
      setPageNavState(EMPTY_NAV);
      return;
    }

    const update = () => updatePageNavState();
    const scheduleUpdate = () => requestAnimationFrame(() => requestAnimationFrame(update));

    scheduleUpdate();
    const timerIds = [
      window.setTimeout(update, 50),
      window.setTimeout(update, 200),
      window.setTimeout(update, 500),
    ];
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      timerIds.forEach((id) => window.clearTimeout(id));
      window.removeEventListener('resize', scheduleUpdate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, isPaginated, pageWidth, scrollRef, updatePageNavState, ...measureDeps]);

  // ─── Trailing-space re-snap (useLayoutEffect) ────────────────────────────
  // syncTrailingSpace queues a React state update → React commits → CSS var
  // --article-page-trailing-px-spacer changes → browser reflows column layout.
  // If scrollLeft is left uncorrected, the user briefly sees the wrong page
  // (flash + progress bar jump) before any async snap can fix it.
  // useLayoutEffect runs synchronously after React's DOM mutation, before the
  // browser paints, so we can re-snap scrollLeft with zero visible flash.
  useLayoutEffect(() => {
    if (!isPaginated || isPaginatedTransitioningRef.current) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const { step, totalPages, getPageLeft } = getPageMetrics(scroller);
    const currentPage = Math.max(0, Math.min(totalPages - 1, Math.round(scroller.scrollLeft / step)));
    const snapLeft = getPageLeft(currentPage);
    if (Math.abs(snapLeft - scroller.scrollLeft) > 2) {
      scroller.scrollLeft = snapLeft;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailingBlankColumns, targetScrollWidth]);

  // ─── Image-load nav-state refresh ────────────────────────────────────────
  // Inline images load asynchronously and expand scrollWidth, shifting the
  // page count. We call updatePageNavState (which includes syncTrailingSpace)
  // after each image loads so the page count and trailing space stay correct.
  // The trailing-space useLayoutEffect above handles the scroll re-snap after
  // the state commits, so we do NOT manually set scrollLeft here.
  //
  // Deps intentionally exclude pageWidth / trailing-space state so this effect
  // only re-attaches when the article content changes, not on every page turn.
  const imageLoadUpdateNavRef = useRef(updatePageNavState);
  imageLoadUpdateNavRef.current = updatePageNavState;

  useEffect(() => {
    if (!isPaginated) return;
    const scroller = scrollRef.current;
    if (!scroller) return;

    const onImageLoad = () => {
      if (isPaginatedTransitioningRef.current) return;
      // Two rAFs: let the browser reflow columns around the newly-sized image.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (isPaginatedTransitioningRef.current) return;
        imageLoadUpdateNavRef.current();
        // scrollLeft correction is handled by the trailing-space useLayoutEffect.
      }));
    };

    // Attach to all images that haven't finished loading yet.
    const imgs = Array.from(scroller.querySelectorAll<HTMLImageElement>('img'));
    const unloaded = imgs.filter((img) => !img.complete);
    unloaded.forEach((img) => img.addEventListener('load', onImageLoad, { once: true }));

    // Also watch for images injected later (e.g. lazy-loaded or reader-view switch).
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLImageElement && !node.complete) {
            node.addEventListener('load', onImageLoad, { once: true });
          } else if (node instanceof Element) {
            node.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
              if (!img.complete) img.addEventListener('load', onImageLoad, { once: true });
            });
          }
        }
      }
    });
    mo.observe(scroller, { childList: true, subtree: true });

    return () => {
      unloaded.forEach((img) => img.removeEventListener('load', onImageLoad));
      mo.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, isPaginated, scrollRef, ...measureDeps]);

  // ─── Snap correction ──────────────────────────────────────────
  const isPaginatedTransitioningRef = useRef(false);

  useEffect(() => {
    if (!isPaginated || pageWidth <= 0) return;
    if (isPaginatedTransitioningRef.current) return;

    const scroller = scrollRef.current;
    if (!scroller) return;

    const {
      step,
      totalPages,
      getPageLeft,
      trailingBlankColumns: nextBlankColumns,
      targetScrollWidth: nextWidth
    } = getPageMetrics(scroller);
    syncTrailingSpace(nextBlankColumns, nextWidth);
    const currentPage = Math.max(0, Math.min(totalPages - 1, Math.round(scroller.scrollLeft / step)));
    const snapLeft = getPageLeft(currentPage);

    if (Math.abs(snapLeft - scroller.scrollLeft) > 2) {
      scroller.scrollLeft = snapLeft;
    }

    requestAnimationFrame(updatePageNavState);
  }, [entryId, getPageMetrics, isPaginated, pageWidth, scrollRef, syncTrailingSpace, updatePageNavState]);

  // ─── Page turn animation & lifecycle ──────────────────────────
  const pageTurnReadyTimerRef = useRef<number | null>(null);
  const pageTurnFallbackTimerRef = useRef<number | null>(null);
  const pageTurnAnimationFrameRef = useRef<number | null>(null);
  const paginatedWorkTagRef = useRef<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pageTurnReadyTimerRef.current) clearTimeout(pageTurnReadyTimerRef.current);
      if (pageTurnFallbackTimerRef.current) clearTimeout(pageTurnFallbackTimerRef.current);
      if (pageTurnAnimationFrameRef.current !== null) cancelAnimationFrame(pageTurnAnimationFrameRef.current);
      if (paginatedWorkTagRef.current) finishEinkWork(paginatedWorkTagRef.current);
      isPaginatedTransitioningRef.current = false;
    };
  }, [finishEinkWork]);

  const clearPaginatedWorkFallback = useCallback(() => {
    if (pageTurnFallbackTimerRef.current) {
      clearTimeout(pageTurnFallbackTimerRef.current);
      pageTurnFallbackTimerRef.current = null;
    }
  }, []);

  const cancelPaginatedReady = useCallback(() => {
    if (pageTurnReadyTimerRef.current) {
      clearTimeout(pageTurnReadyTimerRef.current);
      pageTurnReadyTimerRef.current = null;
    }
    clearPaginatedWorkFallback();
  }, [clearPaginatedWorkFallback]);

  const schedulePaginatedReady = useCallback((delayMs = einkMode ? 180 : 260) => {
    cancelPaginatedReady();

    pageTurnReadyTimerRef.current = window.setTimeout(() => {
      pageTurnReadyTimerRef.current = null;
      clearPaginatedWorkFallback();
      const workTag = paginatedWorkTagRef.current;
      paginatedWorkTagRef.current = null;
      void (async () => {
        await einkPower.waitForPaintCommit();
        finishEinkWork(workTag);
        await einkPower.markVisualStable();
        await einkPower.notifyInteractiveReady();
      })();
    }, delayMs);
  }, [cancelPaginatedReady, clearPaginatedWorkFallback, einkMode, finishEinkWork]);

  const animatePaginatedScrollTo = useCallback((scroller: HTMLElement, targetLeft: number, onComplete: () => void) => {
    if (pageTurnAnimationFrameRef.current !== null) {
      cancelAnimationFrame(pageTurnAnimationFrameRef.current);
      pageTurnAnimationFrameRef.current = null;
    }

    const startLeft = scroller.scrollLeft;
    const distance = targetLeft - startLeft;
    if (Math.abs(distance) < 2) {
      scroller.scrollLeft = targetLeft;
      onComplete();
      return;
    }

    const startTime = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startTime) / PAGINATION_SCROLL_ANIMATION_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      scroller.scrollLeft = startLeft + distance * eased;

      if (progress < 1) {
        pageTurnAnimationFrameRef.current = requestAnimationFrame(step);
        return;
      }
      scroller.scrollLeft = targetLeft;
      pageTurnAnimationFrameRef.current = null;
      onComplete();
    };
    pageTurnAnimationFrameRef.current = requestAnimationFrame(step);
  }, []);

  const scrollByPage = useCallback((direction: 1 | -1) => {
    const scroller = scrollRef.current;
    if (!scroller || isPaginatedTransitioningRef.current) return;

    const {
      step,
      totalPages,
      getPageLeft,
      trailingBlankColumns: nextBlankColumns,
      targetScrollWidth: nextWidth
    } = getPageMetrics(scroller);
    syncTrailingSpace(nextBlankColumns, nextWidth);
    const currentPage = Math.max(0, Math.min(totalPages - 1, Math.round(scroller.scrollLeft / step)));
    const targetPage = Math.max(0, Math.min(totalPages - 1, currentPage + direction));
    const targetLeft = getPageLeft(targetPage);

    if (Math.abs(targetLeft - scroller.scrollLeft) < 2) {
      requestAnimationFrame(updatePageNavState);
      if (einkMode) {
        // Re-signal hibernation: Java's handleKeyEvent active path dispatches the wake command
        // but does NOT call maybeHibernate. Nothing else signals readiness on a boundary no-op,
        // so we do it directly — no waitForPaintCommit (no paint occurred; rAF on E-ink is
        // ~200ms and would create a wake loop by firing after the settle effect).
        void einkPower.markVisualStable().then(() => einkPower.notifyInteractiveReady());
      }
      return;
    }

    cancelPaginatedReady();
    if (pageTurnAnimationFrameRef.current !== null) {
      cancelAnimationFrame(pageTurnAnimationFrameRef.current);
      pageTurnAnimationFrameRef.current = null;
    }
    if (paginatedWorkTagRef.current) {
      finishEinkWork(paginatedWorkTagRef.current);
      paginatedWorkTagRef.current = null;
    }

    paginatedWorkTagRef.current = startEinkWork('page-turn');
    clearPaginatedWorkFallback();
    pageTurnFallbackTimerRef.current = window.setTimeout(() => {
      if (isPaginatedTransitioningRef.current || !paginatedWorkTagRef.current) return;
      schedulePaginatedReady(einkMode ? 180 : 260);
    }, PAGINATION_READY_FALLBACK_MS);
    isPaginatedTransitioningRef.current = true;

    const finalizeTurn = () => {
      isPaginatedTransitioningRef.current = false;
      requestAnimationFrame(updatePageNavState);
      window.setTimeout(updatePageNavState, einkMode ? 60 : PAGINATION_SCROLL_ANIMATION_MS + 32);
      schedulePaginatedReady();
    };

    if (einkMode) {
      scroller.scrollLeft = targetLeft;
      requestAnimationFrame(finalizeTurn);
      return;
    }
    animatePaginatedScrollTo(scroller, targetLeft, finalizeTurn);
  }, [animatePaginatedScrollTo, cancelPaginatedReady, clearPaginatedWorkFallback, einkMode, finishEinkWork, getPageMetrics, schedulePaginatedReady, scrollRef, startEinkWork, syncTrailingSpace, updatePageNavState]);

  const handlePrevPage = useCallback(() => scrollByPage(-1), [scrollByPage]);
  const handleNextPage = useCallback(() => scrollByPage(1), [scrollByPage]);

  // ─── Paginated article style ──────────────────────────────────
  const paginatedArticleStyle: CSSProperties | undefined = isPaginated
    ? {
        '--article-page-width': pageWidth > 0 ? `${pageWidth}px` : 'calc(100vw - 3rem)',
        '--article-page-height': '100%',
        '--article-scroll-width': targetScrollWidth > 0 ? `${targetScrollWidth}px` : '100%',
         
        scrollBehavior: 'auto',
        touchAction: 'none',
      } as CSSProperties
    : undefined;

  return {
    pageWidth,
    pageNavState,
    canUseTwoColumnLayout,
    effectiveColumnCount,
    cancelPaginatedReady,
    handlePrevPage,
    handleNextPage,
    paginatedArticleStyle,
    schedulePaginatedReady,
    trailingBlankColumns,
  };
}
