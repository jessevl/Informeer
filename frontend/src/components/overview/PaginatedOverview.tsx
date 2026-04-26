import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { ReaderNavButtons } from '@/components/reader/ReaderNavButtons';
import { useReaderKeyboard } from '@/components/reader/useReaderKeyboard';
import { usePaginationWheel } from '@/components/reader/usePaginationWheel';
import { useAutoHideControls, useReaderWakeHandlers } from '@/components/reader/useEinkReaderLifecycle';
import { useSettingsStore } from '@/stores/settings';

export interface ViewportSize {
  width: number;
  height: number;
}

interface GridPageSizeOptions {
  columns: number;
  aspectRatio: number;
  metaHeight: number;
  containerSize?: ViewportSize | null;
  gap?: number;
  horizontalPadding?: number;
  verticalPadding?: number;
  chromeOffset?: number;
  minRows?: number;
}

interface ListPageSizeOptions {
  itemHeight: number;
  containerSize?: ViewportSize | null;
  gap?: number;
  verticalPadding?: number;
  chromeOffset?: number;
  minItems?: number;
}

interface PaginatedOverviewSurfaceProps {
  currentPage: number;
  pageCount: number;
  totalItems: number;
  rangeStart: number;
  rangeEnd: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  enabled?: boolean;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

export interface PaginatedItemsResult<T> {
  currentPage: number;
  pageCount: number;
  itemsPerPage: number;
  pageItems: T[];
  canGoPrev: boolean;
  canGoNext: boolean;
  rangeStart: number;
  rangeEnd: number;
  goToPrevPage: () => void;
  goToNextPage: () => void;
  setPage: (page: number) => void;
}

function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const updateSize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
    };
  }, []);

  return size;
}

export function useMeasuredContainerSize(containerRef: RefObject<HTMLElement | null>): ViewportSize | null {
  const [size, setSize] = useState<ViewportSize | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateSize();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => requestAnimationFrame(updateSize))
      : null;

    observer?.observe(element);
    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
    };
  }, [containerRef]);

  return size;
}

export function useResponsiveGridPageSize({
  columns,
  aspectRatio,
  metaHeight,
  containerSize,
  gap = 16,
  horizontalPadding = 24,
  verticalPadding = 24,
  chromeOffset = 220,
  minRows = 1,
}: GridPageSizeOptions): number {
  const viewport = useViewportSize();

  return useMemo(() => {
    const safeColumns = Math.max(1, columns);
    const safeAspectRatio = Math.max(0.1, aspectRatio);
    const baseWidth = containerSize?.width && containerSize.width > 0
      ? containerSize.width
      : viewport.width;
    const baseHeight = containerSize?.height && containerSize.height > 0
      ? containerSize.height
      : viewport.height - chromeOffset;
    const availableWidth = Math.max(240, baseWidth - horizontalPadding * 2);
    const cardWidth = Math.max(120, (availableWidth - gap * (safeColumns - 1)) / safeColumns);
    const mediaHeight = cardWidth / safeAspectRatio;
    const rowHeight = mediaHeight + metaHeight + gap;
    const availableHeight = Math.max(rowHeight, baseHeight - verticalPadding * 2);
    const rows = Math.max(minRows, Math.floor((availableHeight + gap) / rowHeight));
    return Math.max(safeColumns, rows * safeColumns);
  }, [viewport.width, viewport.height, containerSize, columns, aspectRatio, metaHeight, gap, horizontalPadding, verticalPadding, chromeOffset, minRows]);
}

export function useResponsiveListPageSize({
  itemHeight,
  containerSize,
  gap = 8,
  verticalPadding = 16,
  chromeOffset = 220,
  minItems = 1,
}: ListPageSizeOptions): number {
  const viewport = useViewportSize();

  return useMemo(() => {
    const safeItemHeight = Math.max(1, itemHeight);
    const baseHeight = containerSize?.height && containerSize.height > 0
      ? containerSize.height
      : viewport.height - chromeOffset;
    const availableHeight = Math.max(safeItemHeight, baseHeight - verticalPadding * 2);
    const visibleItems = Math.floor((availableHeight + gap) / (safeItemHeight + gap));
    return Math.max(minItems, visibleItems);
  }, [viewport.height, containerSize, itemHeight, gap, verticalPadding, chromeOffset, minItems]);
}

export function usePaginatedItems<T>(items: T[], itemsPerPage: number): PaginatedItemsResult<T> {
  const safeItemsPerPage = Math.max(1, itemsPerPage || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / safeItemsPerPage));
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    setCurrentPage((previousPage) => Math.min(previousPage, pageCount - 1));
  }, [pageCount]);

  const setPage = useCallback((page: number) => {
    setCurrentPage(Math.max(0, Math.min(page, pageCount - 1)));
  }, [pageCount]);

  const goToPrevPage = useCallback(() => {
    setCurrentPage((previousPage) => Math.max(0, previousPage - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setCurrentPage((previousPage) => Math.min(pageCount - 1, previousPage + 1));
  }, [pageCount]);

  const pageItems = useMemo(() => {
    const startIndex = currentPage * safeItemsPerPage;
    return items.slice(startIndex, startIndex + safeItemsPerPage);
  }, [items, currentPage, safeItemsPerPage]);

  const rangeStart = items.length === 0 ? 0 : currentPage * safeItemsPerPage + 1;
  const rangeEnd = items.length === 0 ? 0 : Math.min(items.length, (currentPage + 1) * safeItemsPerPage);

  return {
    currentPage,
    pageCount,
    itemsPerPage: safeItemsPerPage,
    pageItems,
    canGoPrev: currentPage > 0,
    canGoNext: currentPage < pageCount - 1,
    rangeStart,
    rangeEnd,
    goToPrevPage,
    goToNextPage,
    setPage,
  };
}

export function PaginatedOverviewSurface({
  currentPage,
  pageCount,
  totalItems,
  rangeStart,
  rangeEnd,
  onPrevPage,
  onNextPage,
  enabled = true,
  className,
  contentClassName,
  children,
}: PaginatedOverviewSurfaceProps) {
  const einkMode = useSettingsStore((state) => state.einkMode);
  const readerToolbarHideDelay = useSettingsStore((state) => state.readerToolbarHideDelay);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeOffsetRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [showControls, setShowControls] = useState(true);

  swipeOffsetRef.current = swipeOffset;

  const canGoPrev = currentPage > 0;
  const canGoNext = currentPage < pageCount - 1;
  const navigationEnabled = enabled && pageCount > 1;

  useAutoHideControls(showControls, setShowControls, !navigationEnabled, readerToolbarHideDelay * 1000);

  useEffect(() => {
    setShowControls(navigationEnabled);
  }, [navigationEnabled, currentPage, pageCount]);

  const revealControls = useCallback(() => {
    if (!navigationEnabled) return;
    setShowControls(true);
  }, [navigationEnabled]);

  useReaderKeyboard({
    prevPage: onPrevPage,
    nextPage: onNextPage,
    onClose: () => {},
  }, navigationEnabled);
  useReaderWakeHandlers(onNextPage, onPrevPage, navigationEnabled);

  usePaginationWheel(surfaceRef, onNextPage, onPrevPage, navigationEnabled, {
    threshold: 110,
    cooldownMs: 350,
    resetMs: 260,
  });

  const resetSwipe = useCallback(() => {
    swipeStartRef.current = null;
    setSwipeOffset(0);
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    revealControls();
    if (!navigationEnabled || event.touches.length !== 1) return;
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
    setSwipeOffset(0);
  }, [navigationEnabled, revealControls]);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const swipeStart = swipeStartRef.current;
    if (!swipeStart || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - swipeStart.x;
    const deltaY = touch.clientY - swipeStart.y;

    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
      setSwipeOffset(deltaX);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const currentOffset = swipeOffsetRef.current;
    if (currentOffset <= -72 && canGoNext) {
      onNextPage();
    } else if (currentOffset >= 72 && canGoPrev) {
      onPrevPage();
    }
    resetSwipe();
  }, [canGoNext, canGoPrev, onNextPage, onPrevPage, resetSwipe]);

  return (
    <div
      ref={surfaceRef}
      className={cn('relative h-full min-h-0 flex-1 overflow-hidden', className)}
      onPointerDown={revealControls}
      onMouseMove={revealControls}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={resetSwipe}
    >
      {pageCount > 1 && (
        <>
          <ReaderNavButtons
            onPrev={onPrevPage}
            onNext={onNextPage}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            visible={enabled && showControls}
            einkMode={einkMode}
            className="z-20"
          />
          <div
            role="status"
            aria-live="polite"
            aria-label={`Page ${currentPage + 1} of ${pageCount}`}
            className={cn(
              'absolute bottom-0 left-1/2 z-20 -translate-x-1/2',
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full',
              'bg-[var(--color-surface-primary)]/70 backdrop-blur-sm',
              'border border-[var(--color-border-subtle)]',
              'text-[10px] text-[var(--color-text-tertiary)]',
              'pointer-events-none select-none',
              'reader-overlay-surface',
            )}
          >
            {currentPage + 1} / {pageCount}
            {totalItems > 0 && (
              <>
                <span>·</span>
                <span>{rangeStart}-{rangeEnd} of {totalItems}</span>
              </>
            )}
          </div>
        </>
      )}

      <div
        className={cn('h-full', contentClassName)}
        style={{
          transform: swipeOffset === 0 ? undefined : `translate3d(${swipeOffset}px, 0, 0)`,
          transition: swipeOffset === 0 ? 'transform 180ms ease-out' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}