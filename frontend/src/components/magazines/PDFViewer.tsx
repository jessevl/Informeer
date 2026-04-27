/**
 * PDFViewer — Full-screen PDF reader for magazines
 *
 * Uses shared reader hooks for gestures, animation, keyboard, and UI.
 * Adds PDF-specific: canvas rendering, spread computation, ad detection/skip.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  X, Maximize2, Minimize2, Download,
  ZoomIn, ZoomOut, Loader2, BookOpen, FileText,
  EyeOff, Eye, ShieldOff, ShieldCheck, CloudOff, Check,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { useSettingsStore } from '@/stores/settings';
import { useMagazinesStore } from '@/stores/magazines';
import { api } from '@/api/client';
import { detectAdPages } from '@/lib/adDetection';
import {
  useReaderGestures,
  useReaderAnimation,
  useReaderKeyboard,
  ReaderNavButtons,
  ReaderProgressBar,
  SyncPositionToast,
  useAutoHideControls,
} from '@/components/reader';
import { useEinkWorkTag, useReaderWakeHandlers } from '@/components/reader/useEinkReaderLifecycle';
import { useRemoteProgressSync } from '@/hooks/useRemoteProgressSync';
import { getCachedBlob, removeOfflineItem, saveMagazineOffline, saveMagazineOfflineData, setOfflineItemRetention } from '@/lib/offline/blob-cache';
import { useConnectivityStore } from '@/stores/connectivity';
import { useOfflineRegistry } from '@/stores/offline';
import { einkPower } from '@/services/eink-power';

// Set worker source - use local bundled worker (CDN may not have this version)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const SESSION_PDF_CACHE_LIMIT = 2;
const RECONNECT_GRACE_MS = 2500;
const sessionPdfCache = new Map<string, Uint8Array>();

function readSessionPdf(cacheKey: string): Uint8Array | null {
  const cached = sessionPdfCache.get(cacheKey);
  if (!cached) return null;

  sessionPdfCache.delete(cacheKey);
  sessionPdfCache.set(cacheKey, cached);
  return cached.slice();
}

function writeSessionPdf(cacheKey: string, data: Uint8Array) {
  if (data.byteLength === 0) return;

  sessionPdfCache.delete(cacheKey);
  sessionPdfCache.set(cacheKey, data.slice());

  while (sessionPdfCache.size > SESSION_PDF_CACHE_LIMIT) {
    const oldestKey = sessionPdfCache.keys().next().value;
    if (!oldestKey) break;
    sessionPdfCache.delete(oldestKey);
  }
}

function waitForReconnect(timeoutMs: number): Promise<boolean> {
  if (typeof window === 'undefined') {
    return Promise.resolve(true);
  }

  if (navigator.onLine || useConnectivityStore.getState().isOnline) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = 0;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('online', handleOnline);
      window.clearTimeout(timeoutId);
      resolve(value);
    };

    const handleOnline = () => finish(true);

    window.addEventListener('online', handleOnline, { once: true });
    timeoutId = window.setTimeout(() => {
      finish(navigator.onLine || useConnectivityStore.getState().isOnline);
    }, timeoutMs);
  });
}

interface PDFViewerProps {
  /** URL of the PDF to display */
  pdfUrl: string;
  /** Title for the header */
  title?: string;
  /** Layout hint for PDFs whose single page is itself a spread */
  pdfLayout?: 'standard' | 'single-page-spread';
  /** Entry ID for offline caching (optional) */
  entryId?: string;
  /** Cover URL for offline registry metadata */
  coverUrl?: string;
  /** Feed title for offline registry metadata */
  feedTitle?: string;
  /** Initial page number (1-based) */
  initialPage?: number;
  /** The furthest page previously reached (for "last viewed" marker) */
  maxReadPage?: number;
  /** Called when page changes */
  onPageChange?: (page: number, totalPages: number) => void;
  /** Called when viewer is closed */
  onClose: () => void;
}

export function PDFViewer({
  pdfUrl,
  title,
  pdfLayout = 'standard',
  entryId,
  coverUrl,
  feedTitle,
  initialPage = 1,
  maxReadPage = 0,
  onPageChange,
  onClose,
}: PDFViewerProps) {
  type SplitSpreadHalf = 'left' | 'right';
  const sessionCacheKey = entryId ? `magazine:${entryId}` : `url:${pdfUrl}`;

  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSpreadView, setIsSpreadView] = useState(false);
  const [spreadAutoDetected, setSpreadAutoDetected] = useState(false);
  const [landscapePages, setLandscapePages] = useState<Set<number>>(new Set());
  const [splitSpreadHalf, setSplitSpreadHalf] = useState<SplitSpreadHalf>('left');
  const [isPortraitViewport, setIsPortraitViewport] = useState(false);

  // Auto-hide toolbar
  const [showControls, setShowControls] = useState(() => !useSettingsStore.getState().einkMode);
  const [controlsTick, setControlsTick] = useState(0);

  const readerToolbarHideDelay = useSettingsStore(s => s.readerToolbarHideDelay);
  useAutoHideControls(showControls, setShowControls, isLoading, readerToolbarHideDelay * 1000);

  useEffect(() => {
    setShowControls(!useSettingsStore.getState().einkMode);
  }, [entryId, pdfUrl]);

  // Ad detection state
  const [adPages, setAdPagesState] = useState<Set<number>>(new Set());
  const [adDetectionProgress, setAdDetectionProgress] = useState<{ done: number; total: number } | null>(null);
  const [isAdSkipEnabled, setIsAdSkipEnabled] = useState(false);
  const adDetectionAbortRef = useRef<AbortController | null>(null);
  const currentPdfDataRef = useRef<Uint8Array | null>(null);

  // Settings & store
  const hideAdsInMagazines = useSettingsStore(s => s.hideAdsInMagazines);
  const adDetectionThreshold = useSettingsStore(s => s.adDetectionThreshold);
  const einkMode = useSettingsStore(s => s.einkMode);
  const recentOfflineMagazinesLimit = useSettingsStore(s => s.recentOfflineMagazinesLimit);
  const { setAdPages: storeSetAdPages, getEffectiveAdPages, adPageCache, toggleAdPageOverride } = useMagazinesStore();

  // Offline state
  const offlineRegistry = useOfflineRegistry();
  const offlineItem = useMemo(
    () => offlineRegistry.find((item) => item.type === 'magazine' && item.id === (entryId || '')) ?? null,
    [entryId, offlineRegistry],
  );
  const offlineRetention = offlineItem?.retention ?? (offlineItem ? 'manual' : null);
  const isSavedOffline = offlineItem != null;
  const isPinnedOffline = offlineRetention === 'manual';
  const isAutoCachedOffline = offlineRetention === 'recent';
  const [isSavingOffline, setIsSavingOffline] = useState(false);

  const handleCloseInteraction = useCallback((event?: { preventDefault?: () => void; stopPropagation?: () => void; nativeEvent?: Event }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const nativeEvent = event?.nativeEvent as (Event & { stopImmediatePropagation?: () => void }) | undefined;
    nativeEvent?.stopImmediatePropagation?.();
    window.setTimeout(() => onClose(), 0);
  }, [onClose]);

  // Cross-device progress sync
  const numEntryId = entryId ? parseInt(entryId, 10) : 0;
  const readingProgress = useMagazinesStore(s => s.readingProgress);
  const localMaxPage = readingProgress[numEntryId]?.maxPage || currentPage;

  const fetchMagazineRemoteProgress = useCallback(async () => {
    if (!numEntryId) return null;
    try {
      const entry = await api.getEntry(numEntryId);
      const pdfEnclosure = entry.enclosures?.find(e => e.mime_type === 'application/pdf');
      if (!pdfEnclosure || pdfEnclosure.media_progression <= 0) return null;
      return {
        value: pdfEnclosure.media_progression,
        label: `page ${pdfEnclosure.media_progression}`,
      };
    } catch {
      return null;
    }
  }, [numEntryId]);

  const remoteSync = useRemoteProgressSync({
    enabled: !isLoading && !!numEntryId,
    fetchRemoteProgress: fetchMagazineRemoteProgress,
    localMaxPosition: localMaxPage,
    threshold: 1, // must be at least 1 page ahead
    pollInterval: 10_000,
  });

  // Canvas refs
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const renderTasksRef = useRef<Array<{ cancel: () => void }>>([]);
  const renderCycleRef = useRef(0);

  const { startEinkWork, finishEinkWork } = useEinkWorkTag({ prefix: `pdf:${entryId || 'inline'}` });

  const waitForCanvasCommit = useCallback(async () => {
    // On Android E-ink, pdf.js can finish writing the canvas before the frame
    // has actually been presented. Give the browser one frame to commit the
    // rendered bitmap before we allow the WebView to hibernate again.
    if (!einkMode || !einkPower.isHardwareSupported()) return;

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }, [einkMode]);


  const supportsSinglePageSpreadSplit = pdfLayout === 'single-page-spread';
  const isCurrentPageLandscape = landscapePages.has(currentPage);
  const isSplitSpreadPortraitView = supportsSinglePageSpreadSplit
    && !isSpreadView
    && isPortraitViewport
    && isCurrentPageLandscape;
  const canGoNext = isSplitSpreadPortraitView ? splitSpreadHalf === 'left' || currentPage < totalPages : currentPage < totalPages;
  const canGoPrev = isSplitSpreadPortraitView ? splitSpreadHalf === 'right' || currentPage > 1 : currentPage > 1;

  // Shared reader hooks (animation replaces local pageTransition + animatePageTurn)
  const { animatePageTurn, getPageStyle } = useReaderAnimation({ disabled: einkMode });

  // Initialize ad skip toggle from setting
  useEffect(() => {
    setIsAdSkipEnabled(hideAdsInMagazines);
  }, [hideAdsInMagazines]);

  // Load effective ad pages from store cache + overrides
  useEffect(() => {
    if (hideAdsInMagazines && pdfUrl) {
      const effective = getEffectiveAdPages(pdfUrl);
      setAdPagesState(effective);
    }
  }, [hideAdsInMagazines, pdfUrl, adPageCache, getEffectiveAdPages]);

  // Build effective page list (all pages minus skipped ads)
  const effectivePages = useMemo(() => {
    if (!isAdSkipEnabled || adPages.size === 0 || totalPages === 0) {
      return null; // null = no filtering, use all pages
    }
    const pages: number[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (!adPages.has(i)) pages.push(i);
    }
    return pages;
  }, [isAdSkipEnabled, adPages, totalPages]);

  useEffect(() => {
    const area = contentAreaRef.current;
    if (!area) return;

    const updateViewportOrientation = () => {
      setIsPortraitViewport(area.clientHeight >= area.clientWidth);
    };

    updateViewportOrientation();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateViewportOrientation)
      : null;
    observer?.observe(area);
    window.addEventListener('orientationchange', updateViewportOrientation);

    return () => {
      observer?.disconnect();
      window.removeEventListener('orientationchange', updateViewportOrientation);
    };
  }, []);

  useEffect(() => {
    if (!isSplitSpreadPortraitView && splitSpreadHalf !== 'left') {
      setSplitSpreadHalf('left');
    }
  }, [isSplitSpreadPortraitView, splitSpreadHalf]);

  // Save / remove offline handler
  const handleToggleOffline = useCallback(async () => {
    if (!entryId) return;
    if (isPinnedOffline) {
      await removeOfflineItem(`/offline/magazines/${entryId}`);
      return;
    }

    if (isAutoCachedOffline) {
      await setOfflineItemRetention(`/offline/magazines/${entryId}`, 'manual');
      return;
    }
    setIsSavingOffline(true);
    try {
      const authHeader = api.isAuthenticated() ? api.getAuthHeader() || '' : '';
      if (currentPdfDataRef.current) {
        await saveMagazineOfflineData(entryId, title || 'Magazine', currentPdfDataRef.current, coverUrl, feedTitle, { retention: 'manual' });
      } else {
        const authHeader = api.isAuthenticated() ? api.getAuthHeader() || '' : '';
        await saveMagazineOffline(entryId, title || 'Magazine', pdfUrl, authHeader, coverUrl, feedTitle);
      }
    } catch (err) {
      console.error('[pdf-viewer] Offline save failed:', err);
    } finally {
      setIsSavingOffline(false);
    }
  }, [coverUrl, entryId, feedTitle, isAutoCachedOffline, isPinnedOffline, pdfUrl, title]);

  // Load PDF document — check offline cache first
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
    startEinkWork('init');

    async function loadPdf() {
      setIsLoading(true);
      setError(null);

      try {
        const sessionPdf = readSessionPdf(sessionCacheKey);

        if (sessionPdf) {
          currentPdfDataRef.current = sessionPdf;
          loadingTask = pdfjsLib.getDocument({ data: sessionPdf });
        }

        // Check offline cache first
        const cacheKey = entryId ? `/offline/magazines/${entryId}` : null;
        const cached = loadingTask || !cacheKey ? null : await getCachedBlob(cacheKey);

        if (cached) {
          const data = await cached.arrayBuffer();
          currentPdfDataRef.current = new Uint8Array(data);
          loadingTask = pdfjsLib.getDocument({ data });
        } else if (!loadingTask) {
          const hasConnection = await waitForReconnect(RECONNECT_GRACE_MS);
          if (cancelled) return;

          if (!hasConnection) {
            setError('This issue is not saved for offline reading.');
            setIsLoading(false);
            return;
          }

          loadingTask = pdfjsLib.getDocument({
            url: pdfUrl,
            httpHeaders: api.isAuthenticated()
              ? { Authorization: api.getAuthHeader() }
              : undefined,
          });
        }
        pdfDoc = await loadingTask.promise;

        if (cancelled) return;

        // Cache PDF data for session reuse and offline access.
        // Read values from stores/props at call time (not as effect deps).
        const currentCoverUrl = coverUrl;
        const currentFeedTitle = feedTitle;
        const currentTitle = title;
        const currentRecentLimit = useSettingsStore.getState().recentOfflineMagazinesLimit;
        pdfDoc.getData()
          .then((data) => {
            if (!cancelled) {
              const latestData = data instanceof Uint8Array ? data : new Uint8Array(data);
              currentPdfDataRef.current = latestData;
              writeSessionPdf(sessionCacheKey, latestData);

              if (entryId && currentRecentLimit > 0) {
                saveMagazineOfflineData(entryId, currentTitle || 'Magazine', latestData, currentCoverUrl, currentFeedTitle, {
                  retention: 'recent',
                  maxRecentItems: currentRecentLimit,
                }).catch((error) => {
                  console.error('[pdf-viewer] Recent offline cache failed:', error);
                });
              }
            }
          })
          .catch(() => {});

        setPdf(pdfDoc);
        setTotalPages(pdfDoc.numPages);

        // Detect page orientations (portrait vs landscape)
        const landscape = new Set<number>();
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          if (vp.width > vp.height) {
            landscape.add(i);
          }
        }
        setLandscapePages(landscape);
        setIsLoading(false);

        // Auto-enable spread view if viewport is landscape
        const area = contentAreaRef.current;
        if (area && !spreadAutoDetected) {
          const isLandscape = area.clientWidth > area.clientHeight;
          if (isLandscape && pdfDoc.numPages > 2) {
            setIsSpreadView(true);
          }
          setSpreadAutoDetected(true);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load PDF:', err);
        setError(err instanceof Error ? err.message : 'Failed to load PDF');
        setIsLoading(false);
        void finishEinkWork(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
      // Abort the in-flight download so StrictMode re-mounts don't fetch twice
      loadingTask?.destroy();
      // Free pdf.js internal resources (worker message ports, font/page caches)
      pdfDoc?.destroy();
      pdfDoc = null;
      currentPdfDataRef.current = null;
      void finishEinkWork(false);
    };
  }, [entryId, finishEinkWork, pdfUrl, sessionCacheKey, startEinkWork]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run ad detection after PDF loads
  useEffect(() => {
    if (!pdf || !hideAdsInMagazines) return;

    // Check if we already have cached results
    const cached = adPageCache[pdfUrl];
    if (cached) return; // already cached — loaded via the other effect

    // Run detection in the background
    const abortController = new AbortController();
    adDetectionAbortRef.current = abortController;

    setAdDetectionProgress({ done: 0, total: pdf.numPages });

    detectAdPages(pdf, {
      threshold: adDetectionThreshold,
      batchSize: 4,
      protectedPages: [1], // never flag the cover
      signal: abortController.signal,
      onProgress: (done, total) => setAdDetectionProgress({ done, total }),
    }).then(({ adPages: detected }) => {
      if (abortController.signal.aborted) return;
      const pages = Array.from(detected).sort((a, b) => a - b);
      storeSetAdPages(pdfUrl, pages);
      setAdDetectionProgress(null);
    }).catch(err => {
      if (abortController.signal.aborted) return;
      console.error('Ad detection failed:', err);
      setAdDetectionProgress(null);
    });

    return () => {
      abortController.abort();
      adDetectionAbortRef.current = null;
    };
  }, [pdf, pdfUrl, hideAdsInMagazines, adDetectionThreshold, adPageCache, storeSetAdPages]);

  /**
   * Pre-compute spread groups: an array of page groups based on orientation.
   * Page 1 is always solo (cover). Landscape pages are always solo.
   * Consecutive portrait pages are paired as spreads.
   */
  const spreadGroups = useMemo((): number[][] => {
    if (totalPages === 0) return [];
    const groups: number[][] = [];
    // Page 1 always solo (cover)
    groups.push([1]);
    let i = 2;
    while (i <= totalPages) {
      if (!isSpreadView) {
        groups.push([i]);
        i++;
      } else if (landscapePages.has(i)) {
        // Landscape page is already a spread → show solo
        groups.push([i]);
        i++;
      } else if (i + 1 <= totalPages && !landscapePages.has(i + 1)) {
        // Both this and next are portrait → pair as spread
        groups.push([i, i + 1]);
        i += 2;
      } else {
        // Portrait but next is landscape or last page → solo
        groups.push([i]);
        i++;
      }
    }
    return groups;
  }, [totalPages, isSpreadView, landscapePages]);

  /**
   * Get the spread page pair for a given page number.
   * Uses the precomputed spread groups to handle mixed portrait/landscape PDFs.
   * Returns [leftPage, rightPage | null].
   */
  const getSpreadPages = useCallback((page: number): [number, number | null] => {
    if (!isSpreadView) return [page, null];
    // Find the group containing this page
    const group = spreadGroups.find(g => g.includes(page));
    if (group) {
      return [group[0], group.length > 1 ? group[1] : null];
    }
    return [page, null];
  }, [isSpreadView, spreadGroups]);

  // Find next/prev content page (skipping ads)
  // In spread mode, must also account for the current spread pair
  const findNextContentPage = useCallback((from: number, direction: 1 | -1): number | null => {
    if (!effectivePages || effectivePages.length === 0) return null;

    if (isSpreadView && from > 1) {
      // In spread mode, 'from' is the left page of the current spread (even).
      // We need to find the next spread that contains at least one content page.
      const [leftPage, rightPage] = getSpreadPages(from);
      const currentRight = rightPage ?? leftPage;

      if (direction === 1) {
        // Find the first content page AFTER the current spread
        return effectivePages.find(p => p > currentRight) ?? null;
      } else {
        // Find the last content page BEFORE the current spread's left page
        for (let i = effectivePages.length - 1; i >= 0; i--) {
          if (effectivePages[i] < leftPage) return effectivePages[i];
        }
        return null;
      }
    }

    if (direction === 1) {
      return effectivePages.find(p => p > from) ?? null;
    } else {
      for (let i = effectivePages.length - 1; i >= 0; i--) {
        if (effectivePages[i] < from) return effectivePages[i];
      }
      return null;
    }
  }, [effectivePages, isSpreadView, getSpreadPages]);

  // Render a single page to a canvas
  const renderSinglePage = useCallback(async (
    pageNum: number,
    canvas: HTMLCanvasElement,
    availableWidth: number,
    availableHeight: number,
    segment: 'full' | 'left-half' | 'right-half' = 'full',
  ) => {
    if (!pdf) return;

    const page = await pdf.getPage(pageNum);
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: 1 });
    const widthFactor = segment === 'full' ? 1 : 0.5;
    const scaleX = availableWidth / (viewport.width * widthFactor);
    const scaleY = availableHeight / viewport.height;
    const fitScale = Math.min(scaleX, scaleY) * scale;

    // CSS dimensions (what the user sees)
    const cssViewport = page.getViewport({ scale: fitScale });
    const cssWidth = segment === 'full' ? cssViewport.width : cssViewport.width / 2;
    const cssHeight = cssViewport.height;

    // Cap canvas pixel budget to prevent OOM on high-DPR + high-zoom combos.
    // 16M pixels ≈ 64 MB RGBA — safe on most devices.
    const MAX_CANVAS_PIXELS = 16_777_216;
    const targetPixels = (cssWidth * dpr) * (cssHeight * dpr);
    const effectiveDpr = targetPixels > MAX_CANVAS_PIXELS
      ? dpr * Math.sqrt(MAX_CANVAS_PIXELS / targetPixels)
      : dpr;

    const renderScale = fitScale * effectiveDpr;
    const scaledViewport = page.getViewport({ scale: renderScale });
    const renderWidth = segment === 'full' ? scaledViewport.width : scaledViewport.width / 2;

    canvas.width = renderWidth;
    canvas.height = scaledViewport.height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    const offsetX = segment === 'right-half' ? -(scaledViewport.width / 2) : 0;

    const task = page.render({
      canvasContext: context,
      viewport: scaledViewport,
      transform: [1, 0, 0, 1, offsetX, 0],
    });
    renderTasksRef.current.push(task);
    await task.promise;

    // Free pdf.js decoded image data for this page (the canvas already has
    // the rendered bitmap). The page object stays cached for fast re-render.
    page.cleanup();
  }, [pdf, scale]);

  // Render current page(s)
  const renderPages = useCallback(async () => {
    if (!pdf || !canvasLeftRef.current) return;

    const renderCycle = ++renderCycleRef.current;
    startEinkWork('render');

    // Cancel any in-progress renders
    for (const task of renderTasksRef.current) {
      task.cancel();
    }
    renderTasksRef.current = [];

    const container = contentAreaRef.current;
    if (!container) return;

    // Render against the full content area and let the overlays sit on top.
    const padding = 0;
    const containerWidth = container.clientWidth - padding;
    const containerHeight = container.clientHeight - padding;

    try {
      const [leftPage, rightPage] = getSpreadPages(currentPage);

      if (rightPage && canvasRightRef.current) {
        // Spread view: split available width between two pages
        const gap = 4; // gap between pages
        const pageWidth = (containerWidth - gap) / 2;

        await Promise.all([
          renderSinglePage(leftPage, canvasLeftRef.current, pageWidth, containerHeight),
          renderSinglePage(rightPage, canvasRightRef.current, pageWidth, containerHeight),
        ]);
        canvasRightRef.current.style.display = 'block';
      } else if (isSplitSpreadPortraitView) {
        await renderSinglePage(
          leftPage,
          canvasLeftRef.current,
          containerWidth,
          containerHeight,
          splitSpreadHalf === 'left' ? 'left-half' : 'right-half',
        );
        if (canvasRightRef.current) {
          canvasRightRef.current.style.display = 'none';
        }
      } else {
        // Single page
        await renderSinglePage(leftPage, canvasLeftRef.current, containerWidth, containerHeight);
        if (canvasRightRef.current) {
          canvasRightRef.current.style.display = 'none';
        }
      }

      if (renderCycle !== renderCycleRef.current) return;
      await waitForCanvasCommit();
      if (renderCycle !== renderCycleRef.current) return;
      await finishEinkWork(true);
    } catch (err: any) {
      if (err?.name === 'RenderingCancelledException') return;
      console.error('Failed to render page:', err);
      void finishEinkWork(false);
    }
  }, [pdf, currentPage, scale, isSpreadView, getSpreadPages, renderSinglePage, isSplitSpreadPortraitView, splitSpreadHalf, startEinkWork, finishEinkWork, waitForCanvasCommit]);

  // Re-render when page, scale, or spread mode changes
  useEffect(() => {
    if (pdf && currentPage >= 1 && currentPage <= totalPages) {
      renderPages();
    }
  }, [pdf, currentPage, scale, isSpreadView, renderPages, totalPages]);

  // Release canvas GPU/RAM backing stores and cancel pending renders on unmount
  useEffect(() => {
    return () => {
      for (const task of renderTasksRef.current) {
        task.cancel();
      }
      renderTasksRef.current = [];
      for (const canvas of [canvasLeftRef.current, canvasRightRef.current]) {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    };
  }, []);

  // Web Safari can discard canvas contents while backgrounded, so re-render
  // on visibility restore there. Skip this on Android native because the
  // E-ink hibernation path uses WebView pause/resume and would otherwise
  // trigger an unnecessary PDF re-render on every wake tap.
  useEffect(() => {
    if (einkPower.isHardwareSupported()) return;

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && pdf) {
        // Force canvas re-render (iOS clears canvas buffers on suspend)
        renderPages();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [pdf, renderPages]);

  // Navigate pages with optional animation
  const goToPage = useCallback((page: number) => {
    const clamped = Math.max(1, Math.min(page, totalPages));
    startEinkWork('jump');
    setSplitSpreadHalf('left');
    setCurrentPage(clamped);
    onPageChange?.(clamped, totalPages);
  }, [totalPages, onPageChange, startEinkWork]);

  // Accept remote sync position (jump to page from another device)
  const handleAcceptRemotePosition = useCallback(() => {
    if (remoteSync.remotePosition) {
      const clamped = Math.max(1, Math.min(remoteSync.remotePosition.value, totalPages));
      setCurrentPage(clamped);
      onPageChange?.(clamped, totalPages);
    }
    remoteSync.acceptRemotePosition();
  }, [remoteSync, totalPages, onPageChange]);

  const nextPage = useCallback(() => {
    if (isSplitSpreadPortraitView && splitSpreadHalf === 'left') {
      startEinkWork('page-turn');
      animatePageTurn('slide-left', () => {
        setSplitSpreadHalf('right');
      });
      return;
    }
    if (currentPage >= totalPages) return;
    startEinkWork('page-turn');
    animatePageTurn('slide-left', () => {
      if (effectivePages) {
        const nextContentPage = findNextContentPage(currentPage, 1);
        if (nextContentPage) {
          const group = spreadGroups.find(g => g.includes(nextContentPage));
          goToPage(group ? group[0] : nextContentPage);
        }
        return;
      }
      const groupIdx = spreadGroups.findIndex(g => g.includes(currentPage));
      if (groupIdx >= 0 && groupIdx + 1 < spreadGroups.length) {
        goToPage(spreadGroups[groupIdx + 1][0]);
      } else {
        goToPage(currentPage + 1);
      }
    });
  }, [currentPage, totalPages, goToPage, animatePageTurn, effectivePages, findNextContentPage, spreadGroups, isSplitSpreadPortraitView, splitSpreadHalf, startEinkWork]);

  const prevPage = useCallback(() => {
    if (isSplitSpreadPortraitView && splitSpreadHalf === 'right') {
      startEinkWork('page-turn');
      animatePageTurn('slide-right', () => {
        setSplitSpreadHalf('left');
      });
      return;
    }
    if (currentPage <= 1) return;
    startEinkWork('page-turn');
    animatePageTurn('slide-right', () => {
      if (effectivePages) {
        const prevContentPage = findNextContentPage(currentPage, -1);
        if (prevContentPage) {
          const group = spreadGroups.find(g => g.includes(prevContentPage));
          goToPage(group ? group[0] : prevContentPage);
        }
        return;
      }
      const groupIdx = spreadGroups.findIndex(g => g.includes(currentPage));
      if (groupIdx > 0) {
        goToPage(spreadGroups[groupIdx - 1][0]);
      } else {
        goToPage(currentPage - 1);
      }
    });
  }, [currentPage, goToPage, animatePageTurn, effectivePages, findNextContentPage, spreadGroups, isSplitSpreadPortraitView, splitSpreadHalf, startEinkWork]);

  const toggleControls = useCallback(() => {
    const nextShowing = !showControls;
    if (!nextShowing) {
      einkPower.setDeferHibernation(true);
      setShowControls(false);
      setControlsTick((tick) => tick + 1);
      setTimeout(() => { einkPower.setDeferHibernation(false); }, 500);
    } else {
      setShowControls(true);
      setControlsTick((tick) => tick + 1);
    }
  }, [showControls]);

  // ─── Shared gesture & keyboard hooks ───────────────────────────────
  const gestures = useReaderGestures(
    { nextPage, prevPage, canGoNext, canGoPrev, onToggleControls: toggleControls },
    { scale, setScale, maxScale: 5, enableSwipePreview: !einkMode },
  );

  useReaderKeyboard({
    nextPage,
    prevPage,
    onClose,
    onZoomIn: () => setScale(s => Math.min(s + 0.25, 5)),
    onZoomOut: () => setScale(s => {
      const next = Math.max(s - 0.25, 1);
      if (next <= 1) gestures.resetPan();
      return next;
    }),
    onZoomReset: () => { setScale(1); gestures.resetPan(); },
  });

  useReaderWakeHandlers(nextPage, prevPage);

  useEffect(() => {
    einkPower.setSurface({
      mode: 'pdf-reader',
      eligible: !isLoading && !error && !showControls,
      reason: error
        ? 'pdf-load-error'
        : isLoading
          ? 'pdf-loading'
          : showControls
            ? 'pdf-controls-visible'
            : undefined,
      gestureModel: 'paginated',
    });

    return () => {
      einkPower.setSurface({
        mode: 'none',
        eligible: false,
        reason: 'pdf-reader-closed',
        gestureModel: 'none',
      });
    };
  }, [isLoading, error, showControls]);

  // ─── Spread & fullscreen toggles ──────────────────────────────────
  const toggleSpreadView = useCallback(() => {
    setSplitSpreadHalf('left');
    setIsSpreadView(prev => !prev);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = gestures.containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      el.requestFullscreen();
      setIsFullscreen(true);
    }
  }, [gestures.containerRef]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Auto-hide toolbar (4s) — only after loading completes successfully
  useEffect(() => {
    if (!showControls || isLoading || error) return;
    const timer = setTimeout(() => setShowControls(false), 4000);
    return () => clearTimeout(timer);
  }, [showControls, controlsTick, isLoading, error]);

  // Compute the display label for the page indicator
  const pageLabel = (() => {
    if (isSplitSpreadPortraitView) {
      return `Page ${currentPage} (${splitSpreadHalf === 'left' ? 'left half' : 'right half'})`;
    }
    if (isSpreadView && currentPage > 1) {
      const [left, right] = getSpreadPages(currentPage);
      return right ? `Pages ${left}–${right}` : `Page ${left}`;
    }
    return `Page ${currentPage}`;
  })();

  // Is the current page flagged as an ad?
  const currentPageIsAd = adPages.has(currentPage);

  // In spread mode, check if either page in the current spread is an ad
  const spreadAdInfo = useMemo(() => {
    if (!isSpreadView || !hideAdsInMagazines || adPages.size === 0) return null;
    const [left, right] = getSpreadPages(currentPage);
    const leftIsAd = adPages.has(left);
    const rightIsAd = right ? adPages.has(right) : false;
    if (!leftIsAd && !rightIsAd) return null;
    return { leftIsAd, rightIsAd, bothAds: leftIsAd && rightIsAd };
  }, [isSpreadView, hideAdsInMagazines, adPages, currentPage, getSpreadPages]);

  // Toggle ad flag for current page
  const handleToggleCurrentPageAd = useCallback(() => {
    toggleAdPageOverride(pdfUrl, currentPage);
  }, [pdfUrl, currentPage, toggleAdPageOverride]);

  // Canvas area click: delegates to shared gesture handler which uses
  // tap-zone logic (left 30% → prev, right 30% → next, center → toggle)
  const handleCanvasAreaClick = useCallback((e: React.MouseEvent) => {
    gestures.handleContentClick(e);
  }, [gestures.handleContentClick]);

  // Ad page markers for shared progress bar
  const adMarkers = useMemo(() => {
    if (!hideAdsInMagazines || adPages.size === 0 || totalPages <= 1) return undefined;
    return Array.from(adPages).map(p => ({
      position: (p - 1) / (totalPages - 1),
      color: '#f59e0b',
      key: `ad-${p}`,
    }));
  }, [hideAdsInMagazines, adPages, totalPages]);

  return (
    <div
      ref={gestures.containerRef}
      className={cn(
        'fixed inset-0 z-[100] flex flex-col',
        'bg-[var(--color-surface-app)]',
        'animate-fade-in'
      )}
      style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
    >
      {/* Header */}
      {showControls && (
      <div className={cn(
        'absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-4 py-3',
        'bg-[var(--color-surface-primary)]',
        'border-b border-[var(--color-border-default)]',
        'reader-overlay-surface'
      )}
        onPointerDown={() => setControlsTick(t => t + 1)}
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onPointerDown={handleCloseInteraction}
            onClick={handleCloseInteraction}
            className={cn(
              'p-2 rounded-lg transition-colors',
              'hover:bg-[var(--color-surface-hover)]',
              'text-[var(--color-text-secondary)]'
            )}
          >
            <X size={20} />
          </button>
          <div>
            {title && (
              <h2 className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-1">
                {title}
              </h2>
            )}
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {pageLabel} of {totalPages}
              {isAdSkipEnabled && adPages.size > 0 && (
                <span className="ml-1 text-[var(--color-text-tertiary)] opacity-70">
                  ({adPages.size} ads hidden)
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Spread view toggle */}
          <button
            onClick={toggleSpreadView}
            className={cn(
              'p-2 rounded-lg transition-colors',
              isSpreadView
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
            )}
            title={isSpreadView ? 'Single page' : 'Side-by-side spread'}
          >
            {isSpreadView ? <BookOpen size={18} /> : <FileText size={18} />}
          </button>

          {/* Ad skip toggle — only show when ads are detected */}
          {hideAdsInMagazines && adPages.size > 0 && (
            <button
              onClick={() => setIsAdSkipEnabled(prev => !prev)}
              className={cn(
                'p-2 rounded-lg transition-colors',
                isAdSkipEnabled
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
              )}
              title={isAdSkipEnabled ? `Skipping ${adPages.size} ad pages — click to show all` : `Show all pages (${adPages.size} ads detected)`}
            >
              {isAdSkipEnabled ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}

          {/* Ad detection in progress */}
          {adDetectionProgress && (
            <div className="flex items-center gap-1.5 px-2" title="Scanning for ads...">
              <Loader2 size={14} className="animate-spin text-[var(--color-text-tertiary)]" />
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {adDetectionProgress.done}/{adDetectionProgress.total}
              </span>
            </div>
          )}

          <div className="w-px h-5 bg-[var(--color-border-default)] mx-0.5" />
          <button
            onClick={() => setScale(s => {
              const next = Math.max(s - 0.25, 1);
              if (next <= 1) gestures.resetPan();
              return next;
            })}
            disabled={scale <= 1}
            className={cn(
              'p-2 rounded-lg transition-colors',
              scale <= 1
                ? 'text-[var(--color-text-tertiary)] opacity-50 cursor-not-allowed'
                : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
            )}
            title="Zoom out"
          >
            <ZoomOut size={18} />
          </button>
          <span className="text-xs text-[var(--color-text-tertiary)] min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale(s => Math.min(s + 0.25, 5))}
            className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={18} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors"
            title="Fullscreen"
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <a
            href={pdfUrl}
            download
            className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors"
            title="Download PDF"
          >
            <Download size={18} />
          </a>
          {/* Save offline */}
          {entryId && (
            <button
              onClick={handleToggleOffline}
              disabled={isSavingOffline}
              className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
              title={isPinnedOffline ? 'Remove offline copy' : isAutoCachedOffline ? 'Keep permanently offline' : 'Save for offline reading'}
            >
              {isSavingOffline ? (
                <Loader2 size={18} className="text-[var(--color-text-secondary)] animate-spin" />
              ) : isPinnedOffline ? (
                <Check size={18} className="text-emerald-500" />
              ) : (
                <CloudOff size={18} className={cn(isAutoCachedOffline ? 'text-amber-500' : 'text-[var(--color-text-secondary)]')} />
              )}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Floating close button — always visible when header is hidden during loading/error */}
      {!showControls && (isLoading || error) && (
        <button
          onPointerDown={handleCloseInteraction}
          onClick={handleCloseInteraction}
          className={cn(
            'absolute top-3 left-3 z-50 p-2 rounded-full',
            'bg-[var(--color-surface-primary)]',
            'border border-[var(--color-border-default)]',
            'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            'transition-colors shadow-lg',
            'reader-overlay-surface'
          )}
          style={{ top: 'max(env(safe-area-inset-top, 0px), 12px)' }}
        >
          <X size={20} />
        </button>
      )}

      {/* Content */}
      <div
        ref={contentAreaRef}
        className="flex-1 relative overflow-hidden flex items-center justify-center group"
        {...gestures.touchHandlers}
      >
        {isLoading && (
          <div
            className="flex flex-col items-center gap-3 text-[var(--color-text-secondary)] cursor-pointer"
            onClick={() => { setShowControls(prev => !prev); setControlsTick(t => t + 1); }}
          >
            <Loader2 size={32} className="animate-spin" />
            <p className="text-sm">Loading magazine...</p>
          </div>
        )}

        {error && (
          <div
            className="flex flex-col items-center gap-3 text-[var(--color-text-secondary)] p-8 text-center cursor-pointer"
            onClick={() => { setShowControls(prev => !prev); setControlsTick(t => t + 1); }}
          >
            <p className="text-sm text-red-500">Failed to load PDF</p>
            <p className="text-xs">{error}</p>
            <button
              onPointerDown={handleCloseInteraction}
              onClick={handleCloseInteraction}
              className="mt-2 px-4 py-2 rounded-lg bg-[var(--color-surface-hover)] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            >
              Close viewer
            </button>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--color-accent)] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Open in browser instead
            </a>
          </div>
        )}

        {!isLoading && !error && (
          <>
            <div
              className="flex items-center justify-center gap-1 cursor-pointer"
              onClick={handleCanvasAreaClick}
              onDragStart={(event) => event.preventDefault()}
              onContextMenu={(event) => event.preventDefault()}
              style={getPageStyle({
                scale,
                panOffset: gestures.panOffset,
                swipeOffset: gestures.swipeOffset,
              })}
            >
            <div
              ref={gestures.zoomTargetRef}
              className="flex items-center justify-center gap-1"
              style={{ willChange: 'transform' }}
            >
            <div className="relative">
              <canvas
                ref={canvasLeftRef}
                className="max-h-full shadow-2xl rounded-sm"
                style={{ imageRendering: 'auto', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
              />
              {/* Blur overlay for left ad page in spread */}
              {isAdSkipEnabled && spreadAdInfo?.leftIsAd && (
                <div className={cn(
                  'absolute inset-0 backdrop-blur-xl bg-[var(--color-surface-app)]/60',
                  'flex flex-col items-center justify-center gap-2 rounded-sm'
                )}>
                  <ShieldOff size={24} className="text-amber-400/70" />
                  <span className="text-xs text-amber-300/70 font-medium">Ad</span>
                  <button
                    onClick={() => { const [left] = getSpreadPages(currentPage); toggleAdPageOverride(pdfUrl, left); }}
                    className="mt-1 px-2 py-1 rounded text-[10px] text-amber-300/80 bg-amber-500/15 hover:bg-amber-500/30 transition-colors"
                  >
                    Not an ad
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <canvas
                ref={canvasRightRef}
                className="max-h-full shadow-2xl rounded-sm"
                style={{ imageRendering: 'auto', display: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
              />
              {/* Blur overlay for right ad page in spread */}
              {isAdSkipEnabled && spreadAdInfo?.rightIsAd && canvasRightRef.current?.style.display !== 'none' && (
                <div className={cn(
                  'absolute inset-0 backdrop-blur-xl bg-[var(--color-surface-app)]/60',
                  'flex flex-col items-center justify-center gap-2 rounded-sm'
                )}>
                  <ShieldOff size={24} className="text-amber-400/70" />
                  <span className="text-xs text-amber-300/70 font-medium">Ad</span>
                  <button
                    onClick={() => { const [, right] = getSpreadPages(currentPage); if (right) toggleAdPageOverride(pdfUrl, right); }}
                    className="mt-1 px-2 py-1 rounded text-[10px] text-amber-300/80 bg-amber-500/15 hover:bg-amber-500/30 transition-colors"
                  >
                    Not an ad
                  </button>
                </div>
              )}
            </div>
            </div>
            </div>

            {/* Navigation arrows (desktop) — shared component */}
            {showControls && (
              <ReaderNavButtons
                onPrev={prevPage}
                onNext={nextPage}
                canGoPrev={canGoPrev}
                canGoNext={canGoNext}
              />
            )}

            {/* Ad page badge and toggle (single page mode) */}
            {hideAdsInMagazines && !isSpreadView && currentPageIsAd && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
                <div className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-full',
                  'bg-amber-500/20 backdrop-blur-sm border border-amber-500/30',
                  'text-amber-200 text-xs font-medium'
                )}>
                  <ShieldOff size={14} />
                  Ad page
                  <button
                    onClick={handleToggleCurrentPageAd}
                    className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 hover:bg-amber-500/40 transition-colors"
                    title="This page was incorrectly flagged — click to unmark"
                  >
                    Not an ad
                  </button>
                </div>
              </div>
            )}

            {/* Mark-as-ad button for non-ad pages (show when detection is active) */}
            {hideAdsInMagazines && !currentPageIsAd && adPages.size > 0 && !isLoading && !error && (
              <button
                onClick={handleToggleCurrentPageAd}
                className={cn(
                  'absolute bottom-4 right-4',
                  'p-2 rounded-full transition-all',
                  'bg-[var(--color-surface-primary)]',
                  'border border-[var(--color-border-default)]',
                  'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                  'hover:bg-[var(--color-surface-hover)]',
                  'opacity-0 group-hover:opacity-100 focus:opacity-100',
                  'reader-overlay-surface'
                )}
                title="Mark this page as an ad"
              >
                <ShieldCheck size={16} />
              </button>
            )}
          </>
        )}
      </div>

      {/* ─── Cross-device sync toast ─── */}
      <SyncPositionToast
        visible={remoteSync.hasRemoteUpdate}
        position={remoteSync.remotePosition}
        onAccept={handleAcceptRemotePosition}
        onDismiss={remoteSync.dismissRemotePosition}
      />

      {/* Bottom Progress Bar — shared component */}
      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <ReaderProgressBar
            currentPosition={currentPage}
            totalPositions={totalPages}
            label={pageLabel}
            onPositionChange={goToPage}
            highlightPosition={maxReadPage}
            markers={adMarkers}
          />
        </div>
      )}
    </div>
  );
}
