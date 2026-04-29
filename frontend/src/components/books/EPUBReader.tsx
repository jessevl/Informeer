/**
 * EPUBReader Component — Full-window EPUB reader
 *
 * Uses shared reader infrastructure for consistent UX with the PDF/magazine reader.
 *
 * Features:
 * - Full-window display with shared gesture handling (swipe, pinch, trackpad)
 * - Shared page transition animations (slide-left/right with enter animations)
 * - Shared navigation buttons (desktop chevrons) and keyboard shortcuts
 * - 1-page vs 2-page spread mode (matches magazine reader behavior)
 * - Advanced typography panel (font, size, line height, margins, etc.)
 * - CFI-based progress tracking with page numbers from epub locations
 * - Reading time estimates (chapter + book)
 * - Text selection highlights
 * - Dark/light mode
 * - Table of contents sidebar
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  X, Sun, Moon, Monitor, Type, List, Loader2,
  Clock, Download, CloudOff, Check,
} from 'lucide-react';
import { api } from '@/api/client';
import { useBooksStore } from '@/stores/books';
import { useSettingsStore } from '@/stores/settings';
import type { EpubReaderTheme } from '@/stores/settings';
import type { Book } from '@/types/api';
import ePub from 'epubjs';
import type { Book as EpubBook, Rendition, Contents } from 'epubjs';
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
import { getTapZoneAction } from '@/components/reader/tap-zones';
import { useRemoteProgressSync } from '@/hooks/useRemoteProgressSync';
import { TypographyPanel, DEFAULT_TYPOGRAPHY } from '@/components/reader/TypographyPanel';
import type { TypographySettings } from '@/components/reader/TypographyPanel';
import { getCachedBlob, getOfflineItem, removeOfflineItem, saveBookOffline, saveBookOfflineData, setOfflineItemRetention } from '@/lib/offline/blob-cache';
import { useOfflineRegistry } from '@/stores/offline';
import { useConnectivityStore } from '@/stores/connectivity';
import { EPUB_FONT_FACE_CSS, getEpubFontStack, normalizeEpubFontValue } from '@/lib/epub-fonts';
import { useIsLandscapeViewport } from '@/hooks/useIsLandscapeViewport';
import { einkPower } from '@/services/eink-power';

type ReaderTheme = 'light' | 'sepia' | 'dark' | 'eink' | 'eink-dark';
const APP_THEME_ORDER = ['light', 'system', 'dark'] as const;

interface EPUBReaderProps {
  book: Book;
  onClose: () => void;
}

// Persist typography settings in localStorage
const TYPOGRAPHY_KEY = 'informeer-epub-typography';
function loadTypographySettings(): TypographySettings {
  try {
    const stored = localStorage.getItem(TYPOGRAPHY_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<TypographySettings>;
      return {
        ...DEFAULT_TYPOGRAPHY,
        ...parsed,
        fontFamily: normalizeEpubFontValue(parsed.fontFamily ?? DEFAULT_TYPOGRAPHY.fontFamily),
      };
    }
  } catch { /* ignore */ }
  return DEFAULT_TYPOGRAPHY;
}
function saveTypographySettings(settings: TypographySettings) {
  localStorage.setItem(TYPOGRAPHY_KEY, JSON.stringify(settings));
}

// We pass minSpreadWidth:1 alongside spread:'always' because epubjs
// layout.js checks `width >= _minSpreadWidth` (default 800 px) even when
// spread policy is 'always'. Setting it to 1 removes that guard entirely.
const EPUB_PAGE_TURN_GUARD_RESET_MS = 1500;
const EPUB_CONTENT_TOP_CLEARANCE_PX = 24;
const EPUB_CONTENT_BOTTOM_CLEARANCE_PX = 40;

function getEpubVerticalPaddingCss(
  baseMarginPx: number,
  inset: 'top' | 'bottom',
  overlayClearancePx: number,
) {
  const safeAreaInset = `env(safe-area-inset-${inset}, 0px)`;
  return `max(${baseMarginPx + overlayClearancePx}px, calc(${safeAreaInset} + ${overlayClearancePx}px))`;
}

const SESSION_EPUB_CACHE_LIMIT = 4;
const RECONNECT_GRACE_MS = 2500;
const sessionEpubCache = new Map<string, Uint8Array>();

function readSessionEpub(cacheKey: string): Uint8Array | null {
  const cached = sessionEpubCache.get(cacheKey);
  if (!cached) return null;

  sessionEpubCache.delete(cacheKey);
  sessionEpubCache.set(cacheKey, cached);
  return cached.slice();
}

function writeSessionEpub(cacheKey: string, data: Uint8Array) {
  if (data.byteLength === 0) return;

  sessionEpubCache.delete(cacheKey);
  sessionEpubCache.set(cacheKey, data.slice());

  while (sessionEpubCache.size > SESSION_EPUB_CACHE_LIMIT) {
    const oldestKey = sessionEpubCache.keys().next().value;
    if (!oldestKey) break;
    sessionEpubCache.delete(oldestKey);
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

function getProgressTimestamp(progress?: { updated_at?: string | null } | null): number {
  if (!progress?.updated_at) return 0;

  const timestamp = new Date(progress.updated_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function chooseInitialProgress(
  local: { cfi?: string; percentage?: number; chapter?: string; updated_at?: string | null } | null,
  remote: { cfi?: string; percentage?: number; chapter?: string; updated_at?: string | null } | null,
) {
  const localHasPosition = Boolean(local?.cfi);
  const remoteHasPosition = Boolean(remote?.cfi);

  if (!localHasPosition) return remoteHasPosition ? remote : local;
  if (!remoteHasPosition) return local;

  return getProgressTimestamp(remote) > getProgressTimestamp(local) ? remote : local;
}

export function EPUBReader({ book, onClose }: EPUBReaderProps) {
  const sessionCacheKey = `book:${book.id}`;
  const viewerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationsReadyRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const nextAttemptInProgressRef = useRef(false);
  const prevAttemptInProgressRef = useRef(false);
  const currentBookDataRef = useRef<Uint8Array | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const manualSpreadPreferenceRef = useRef(false);

  const { startEinkWork, finishEinkWork } = useEinkWorkTag({ prefix: `epub:${book.id}` });

  // Actions (stable references — won't cause re-renders)
  const updateProgress = useBooksStore(s => s.updateProgress);
  const syncProgress = useBooksStore(s => s.syncProgress);
  const highlights = useBooksStore(s => s.highlights);

  // Snapshot initial progress at mount — read once, not reactive,
  // so page-turn updateProgress() calls don't trigger component re-renders
  const [initialProgress] = useState(() => {
    const store = useBooksStore.getState();
    const cached = store.progressCache[book.id];
    return {
      cfi: cached?.cfi || store.currentCfi || '',
      percentage: cached?.percentage || store.currentPercentage || 0,
      chapter: cached?.chapter || store.currentChapter || '',
      updated_at: cached?.updated_at || null,
    };
  });
  const lastKnownCfiRef = useRef(initialProgress.cfi);

  // --- Core state ---
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chapter, setChapter] = useState(initialProgress.chapter);
  const [percentage, setPercentage] = useState(initialProgress.percentage);
  const [showControls, setShowControls] = useState(() => !useSettingsStore.getState().einkMode);
  const showControlsRef = useRef(showControls);
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);

  // --- Spread mode ---
  const [isSpreadView, setIsSpreadView] = useState(false);

  // --- TOC ---
  const [showToc, setShowToc] = useState(false);
  const [tocItems, setTocItems] = useState<Array<{ label: string; href: string }>>([]);

  // --- Theme: follows app-level theme setting ---
  const appTheme = useSettingsStore(s => s.theme);
  const setTheme = useSettingsStore(s => s.setTheme);
  const einkMode = useSettingsStore(s => s.einkMode);
  const epubLightTheme = useSettingsStore(s => s.epubLightTheme);
  const epubDarkTheme = useSettingsStore(s => s.epubDarkTheme);
  const recentOfflineBooksLimit = useSettingsStore(s => s.recentOfflineBooksLimit);
  const readerToolbarHideDelay = useSettingsStore(s => s.readerToolbarHideDelay);
  const offlineRegistry = useOfflineRegistry();
  const isWindowLandscapeViewport = useIsLandscapeViewport();
  const [viewerViewportSize, setViewerViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));

  useEffect(() => {
    const updateViewportSize = () => {
      const node = viewerRef.current ?? wrapperRef.current;
      if (!node) {
        setViewerViewportSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
        return;
      }

      setViewerViewportSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    updateViewportSize();

    const node = viewerRef.current ?? wrapperRef.current;
    const resizeObserver = typeof ResizeObserver !== 'undefined' && node
      ? new ResizeObserver(() => requestAnimationFrame(updateViewportSize))
      : null;

    if (node && resizeObserver) {
      resizeObserver.observe(node);
    }

    window.addEventListener('resize', updateViewportSize);
    window.addEventListener('orientationchange', updateViewportSize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateViewportSize);
      window.removeEventListener('orientationchange', updateViewportSize);
    };
  }, []);

  const isLandscapeViewport = viewerViewportSize.width > 0 && viewerViewportSize.height > 0
    ? viewerViewportSize.width > viewerViewportSize.height
    : isWindowLandscapeViewport;
  // Auto-spread should follow orientation so rotating between portrait and
  // landscape flips between single-page and spread layouts without needing the
  // typography panel.
  const isSpreadEligible = isLandscapeViewport;

  // Track OS preference so 'system' mode responds to changes
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const resolvedAppIsDark = appTheme === 'dark' || (appTheme === 'system' && systemIsDark);
  const readerTheme: ReaderTheme = einkMode
    ? (resolvedAppIsDark ? 'eink-dark' : 'eink')
    : (resolvedAppIsDark ? epubDarkTheme : epubLightTheme);
  const isReaderDark = readerTheme === 'dark' || readerTheme === 'eink-dark';

  // --- Typography ---
  const [showTypography, setShowTypography] = useState(false);
  const [typography, setTypography] = useState<TypographySettings>(loadTypographySettings);

  useEffect(() => {
    setShowControls(!useSettingsStore.getState().einkMode);
    setShowToc(false);
    setShowTypography(false);
  }, [book.id]);

  // --- Auto-hide toolbar ---
  const [controlsTick, setControlsTick] = useState(0);

  useAutoHideControls(showControls, setShowControls, showToc || showTypography || isLoading, readerToolbarHideDelay * 1000);

  // --- Progress tracking for remote sync ---
  const chapterRef = useRef(initialProgress.chapter);
  const [maxPercentage, setMaxPercentage] = useState(initialProgress.percentage);
  const [locationsReady, setLocationsReady] = useState(false);

  const queueRestoreToCfi = useCallback((cfi?: string | null) => {
    const rendition = renditionRef.current;
    const targetCfi = cfi ?? lastKnownCfiRef.current;
    if (!rendition || !targetCfi) return;

    if (restoreFrameRef.current != null) {
      cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }

    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        if (renditionRef.current !== rendition) return;
        rendition.display(targetCfi).catch(() => {});
      });
    });
  }, []);

  const handleCloseInteraction = useCallback((event?: { preventDefault?: () => void; stopPropagation?: () => void; nativeEvent?: Event }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const nativeEvent = event?.nativeEvent as (Event & { stopImmediatePropagation?: () => void }) | undefined;
    nativeEvent?.stopImmediatePropagation?.();
    window.setTimeout(() => onClose(), 0);
  }, [onClose]);

  // --- Offline save state ---
  const offlineItem = useMemo(
    () => offlineRegistry.find((item) => item.type === 'book' && item.id === String(book.id)) ?? null,
    [offlineRegistry, book.id],
  );
  const offlineRetention = offlineItem?.retention ?? (offlineItem ? 'manual' : null);
  const isSavedOffline = offlineItem != null;
  const isPinnedOffline = offlineRetention === 'manual';
  const isAutoCachedOffline = offlineRetention === 'recent';
  const [isSavingOffline, setIsSavingOffline] = useState(false);

  // --- Cross-device progress sync ---
  const fetchBookRemoteProgress = useCallback(async () => {
    try {
      const remote = await api.getBookProgress(book.id);
      if (!remote.cfi || remote.percentage <= 0) return null;
      // Same CFI = same position — skip to avoid false "another device" prompts
      // caused by percentage rounding differences across location generations
      if (remote.cfi === lastKnownCfiRef.current) return null;
      return {
        value: remote.percentage,
        label: `${Math.round(remote.percentage * 100)}%`,
        cfi: remote.cfi,
      };
    } catch {
      return null;
    }
  }, [book.id]);

  useEffect(() => {
    if (!manualSpreadPreferenceRef.current) {
      const cols: 1 | 2 = isSpreadEligible ? 2 : 1;
      setIsSpreadView(isSpreadEligible);
      setTypography(prev => ({ ...prev, columnCount: cols }));
    }
  }, [isSpreadEligible]);

  // On E-ink, wake the device briefly on orientation change so the screen
  // can reflow and repaint at the new orientation before re-hibernating.
  // finishEinkWork(true) is triggered automatically by the relocated handler
  // after epub.js re-renders; the safety timeout covers cases where a spread
  // change is not triggered (manual spread preference).
  useEffect(() => {
    if (!einkMode) return;
    startEinkWork('orientation');
    const safety = setTimeout(() => { void finishEinkWork(true); }, 3000);
    return () => clearTimeout(safety);
  }, [isSpreadEligible, einkMode, startEinkWork, finishEinkWork]);

  const remoteSync = useRemoteProgressSync({
    enabled: !isLoading && locationsReady,
    fetchRemoteProgress: fetchBookRemoteProgress,
    localMaxPosition: maxPercentage,
    threshold: 0.02,
    pollInterval: 10_000,
  });

  const handleAcceptRemotePosition = useCallback(() => {
    if (remoteSync.remotePosition?.cfi && renditionRef.current) {
      lastKnownCfiRef.current = remoteSync.remotePosition.cfi;
      renditionRef.current.display(remoteSync.remotePosition.cfi).catch(() => {});
    }
    remoteSync.acceptRemotePosition();
  }, [remoteSync]);

  // --- Page info ---
  const [currentPageOverall, setCurrentPageOverall] = useState(0);
  const [totalPagesOverall, setTotalPagesOverall] = useState(0);

  // --- Reading time estimates ---
  const [minutesLeftChapter, setMinutesLeftChapter] = useState(0);
  const [minutesLeftBook, setMinutesLeftBook] = useState(0);
  const WORDS_PER_LOCATION = 260;
  const WORDS_PER_MINUTE = 250;

  // --- Zoom (1x for EPUB — shared gestures need this) ---
  const [scale, setScale] = useState(1);

  // --- Navigation state for shared hooks ---
  const canGoNext = totalPagesOverall > 0
    ? currentPageOverall + 1 < totalPagesOverall
    : percentage < 1;
  const canGoPrev = totalPagesOverall > 0
    ? currentPageOverall > 0
    : percentage > 0;

  // === Shared Hooks ===

  const { animatePageTurn, getPageStyle } = useReaderAnimation({ disabled: einkMode });

  const runRenditionPageTurn = useCallback(
    (attemptRef: { current: boolean }, action: (() => Promise<unknown>) | null) => {
      if (!action || attemptRef.current) return false;

      attemptRef.current = true;
      let cleared = false;
      const clearAttempt = () => {
        if (cleared) return;
        cleared = true;
        attemptRef.current = false;
      };

      const resetTimer = window.setTimeout(clearAttempt, EPUB_PAGE_TURN_GUARD_RESET_MS);
      void Promise.resolve()
        .then(action)
        .catch(() => {})
        .finally(() => {
          window.clearTimeout(resetTimer);
          clearAttempt();
        });

      return true;
    },
    [],
  );

  // Navigation callbacks with animation guard to prevent double-fire
  const nextPage = useCallback(() => {
    if (!renditionRef.current || !canGoNext || isAnimatingRef.current) return;
    if (nextAttemptInProgressRef.current) return;

    // Do NOT pre-set nextAttemptInProgressRef here — runRenditionPageTurn is the
    // sole setter/clearer. Pre-setting it before the animation callback causes
    // runRenditionPageTurn's own guard to see the flag as already true and refuse
    // to start, leaving the flag permanently stuck and blocking all navigation.
    startEinkWork('page-turn');
    isAnimatingRef.current = true;
    animatePageTurn('slide-left', () => {
      const rendition = renditionRef.current;
      if (!runRenditionPageTurn(nextAttemptInProgressRef, rendition ? () => rendition.next() : null)) {
        isAnimatingRef.current = false;
        void finishEinkWork(false);
        return;
      }
      setTimeout(() => { isAnimatingRef.current = false; }, 150);
    });
  }, [canGoNext, animatePageTurn, runRenditionPageTurn, startEinkWork, finishEinkWork]);

  const prevPage = useCallback(() => {
    if (!renditionRef.current || !canGoPrev || isAnimatingRef.current) return;
    if (prevAttemptInProgressRef.current) return;

    // Do NOT pre-set prevAttemptInProgressRef here — same reason as nextPage above.
    startEinkWork('page-turn');
    isAnimatingRef.current = true;
    animatePageTurn('slide-right', () => {
      const rendition = renditionRef.current;
      if (!runRenditionPageTurn(prevAttemptInProgressRef, rendition ? () => rendition.prev() : null)) {
        isAnimatingRef.current = false;
        void finishEinkWork(false);
        return;
      }
      setTimeout(() => { isAnimatingRef.current = false; }, 150);
    });
  }, [canGoPrev, animatePageTurn, runRenditionPageTurn, startEinkWork, finishEinkWork]);

  // Instant variants for keyboard/hardware-button navigation — no animation delay.
  // Keyboard nav never has a visible slide (the user pressed a key, not swiped),
  // so waiting 200ms for the exit animation before calling next()/prev() is pure delay.
  const nextPageInstant = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || !canGoNext || nextAttemptInProgressRef.current) return;
    startEinkWork('page-turn');
    runRenditionPageTurn(nextAttemptInProgressRef, () => rendition.next());
  }, [canGoNext, runRenditionPageTurn, startEinkWork]);

  const prevPageInstant = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || !canGoPrev || prevAttemptInProgressRef.current) return;
    startEinkWork('page-turn');
    runRenditionPageTurn(prevAttemptInProgressRef, () => rendition.prev());
  }, [canGoPrev, runRenditionPageTurn, startEinkWork]);

  // Refs to keep callbacks fresh for iframe event handlers
  const nextPageRef = useRef(nextPage);
  nextPageRef.current = nextPage;
  const prevPageRef = useRef(prevPage);
  prevPageRef.current = prevPage;
  const nextPageInstantRef = useRef(nextPageInstant);
  nextPageInstantRef.current = nextPageInstant;
  const prevPageInstantRef = useRef(prevPageInstant);
  prevPageInstantRef.current = prevPageInstant;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const readerThemeRef = useRef(readerTheme);
  readerThemeRef.current = readerTheme;
  const typographyRef = useRef(typography);
  typographyRef.current = typography;

  // Guard to prevent double-toggle when touch tap fires followed by synthesized click
  const touchTapRef = useRef(false);

  // Shared controls toggle used by both the gesture hook and the iframe handlers
  const toggleControlsRef = useRef<() => void>(() => {});
  const toggleControls = useCallback(() => {
    const nextShowing = !showControlsRef.current;
    if (!nextShowing) {
      einkPower.setDeferHibernation(true);
      setShowControls(false);
      setShowToc(false);
      setShowTypography(false);
      setTimeout(() => { einkPower.setDeferHibernation(false); }, 500);
    } else {
      setShowControls(true);
      setShowToc(false);
      setShowTypography(false);
    }
  }, []);
  toggleControlsRef.current = toggleControls;

  const gestures = useReaderGestures(
    { nextPage, prevPage, canGoNext, canGoPrev, onToggleControls: toggleControls },
    {
      scale,
      setScale,
      enableZoom: false, // EPUB handles text scaling via typography panel
      enableClickZones: false, // tap zones are handled inside the iframe document
    },
  );

  const keyboardCallbacks = useMemo(() => ({
    nextPage: nextPageInstant,
    prevPage: prevPageInstant,
    onClose,
  }), [nextPageInstant, prevPageInstant, onClose]);

  useReaderKeyboard(keyboardCallbacks);

  useReaderWakeHandlers(nextPageInstant, prevPageInstant);

  useEffect(() => {
    einkPower.setSurface({
      mode: 'epub-reader',
      eligible: !isLoading && !loadError && !showControls && !showToc && !showTypography,
      reason: loadError
        ? 'epub-load-error'
        : isLoading
          ? 'epub-loading'
          : showToc
            ? 'epub-toc-visible'
            : showTypography
              ? 'epub-typography-visible'
              : showControls
                ? 'epub-controls-visible'
                : undefined,
      gestureModel: 'paginated',
    });

    return () => {
      einkPower.setSurface({
        mode: 'none',
        eligible: false,
        reason: 'epub-reader-closed',
        gestureModel: 'none',
      });
    };
  }, [isLoading, loadError, showControls, showToc, showTypography]);

  // === EPUB initialization ===

  useEffect(() => {
    if (!viewerRef.current) return;
    let cancelled = false;
    startEinkWork('init');

    const init = async () => {
      try {
        const remoteProgressPromise = navigator.onLine
          ? api.getBookProgress(book.id).catch(() => null)
          : Promise.resolve(null);

        const sessionBook = readSessionEpub(sessionCacheKey);
        const cacheKey = `/offline/books/${book.id}`;

        let arrayBuffer: ArrayBuffer;
        if (sessionBook) {
          arrayBuffer = sessionBook.slice().buffer;
        } else {
          const cached = await getCachedBlob(cacheKey);
          if (cached) {
            arrayBuffer = await cached.arrayBuffer();
          } else {
            const hasConnection = await waitForReconnect(RECONNECT_GRACE_MS);
            if (cancelled) return;

            if (!hasConnection) {
              setLoadError('This book is not available offline. Save it first from the library.');
              setIsLoading(false);
              return;
            }

          const bookUrl = api.getBookFileUrl(book.id);
          const authHeader = api.isAuthenticated() ? api.getAuthHeader() : undefined;
          const response = await fetch(bookUrl, {
            headers: authHeader ? { Authorization: authHeader } : {},
          });
          if (!response.ok) throw new Error(`Failed to load book: ${response.status}`);
          arrayBuffer = await response.arrayBuffer();
          }
        }
        if (cancelled) return;

        const bookData = new Uint8Array(arrayBuffer.slice(0));
        currentBookDataRef.current = bookData;
        writeSessionEpub(sessionCacheKey, bookData);

        if (recentOfflineBooksLimit > 0) {
          const authHeader = api.isAuthenticated() ? api.getAuthHeader() : undefined;
          saveBookOfflineData(
            book.id,
            book.title,
            bookData,
            api.getBookCoverUrl(book.id),
            book.author,
            { retention: 'recent', maxRecentItems: recentOfflineBooksLimit, coverAuthHeader: authHeader },
          ).catch((err) => {
            console.error('[epub-reader] Recent offline cache failed:', err);
          });
        }

        const epub = ePub(arrayBuffer);
        epubRef.current = epub;

        // Read latest store progress (may include server data fetched by openReader)
        const storeProgress = useBooksStore.getState().progressCache[book.id] ?? null;
        const localProg = storeProgress ?? initialProgress;
        const bestProgress = chooseInitialProgress(localProg, await remoteProgressPromise);
        const initialCfi = bestProgress?.cfi || '';
        const initialPercentage = bestProgress?.percentage || 0;
        const initialChapter = bestProgress?.chapter || '';

        lastKnownCfiRef.current = initialCfi;
        setPercentage(initialPercentage);
        setMaxPercentage(prev => Math.max(prev, initialPercentage));
        setChapter(initialChapter);
        chapterRef.current = initialChapter;

        // Determine initial spread based on viewport
        const viewerEl = viewerRef.current!;

        const wantSpread = manualSpreadPreferenceRef.current ? isSpreadView : isSpreadEligible;
        const rendition = epub.renderTo(viewerEl, {
          width: '100%',
          height: '100%',
          spread: wantSpread ? 'always' : 'none',
          // minSpreadWidth:1 overrides epubjs's default 800 px guard in layout.js
          // (`if (this._spread && width >= this._minSpreadWidth)`) so 'always'
          // actually produces two columns on any viewport width.
          minSpreadWidth: wantSpread ? 1 : 800,
          flow: 'paginated',
          allowScriptedContent: true,
        } as any);
        renditionRef.current = rendition;

        // Apply theme & typography
        applyThemeAndTypography(rendition, readerTheme, typography);

        // Display at saved CFI or start
        if (initialCfi) {
          rendition.display(initialCfi).catch(() => rendition.display());
        } else {
          rendition.display();
        }

        // Track location changes
        rendition.on('relocated', (location: any) => {
          if (cancelled) return;
          setIsLoading(false);

          const cfi = location.start?.cfi || '';
          if (cfi) {
            lastKnownCfiRef.current = cfi;
          }
          const pct = locationsReadyRef.current
            ? (location.start?.percentage || 0)
            : 0;
          // Only update percentage display once locations are ready,
          // to avoid resetting the stored percentage to 0 on initial load
          if (locationsReadyRef.current) {
            setPercentage(pct);
            setMaxPercentage(prev => Math.max(prev, pct));
          }

          // Overall page number from locations
          if (locationsReadyRef.current && epub.locations) {
            const locIndex = (epub.locations as any).locationFromCfi(cfi);
            const totalLocs = (epub.locations as any).total || 0;
            setCurrentPageOverall(Math.max(0, locIndex));
            setTotalPagesOverall(totalLocs);

            // Reading time estimates
            const locsLeft = Math.max(0, totalLocs - locIndex);
            const wordsLeft = locsLeft * WORDS_PER_LOCATION;
            setMinutesLeftBook(Math.ceil(wordsLeft / WORDS_PER_MINUTE));

            if (location.start?.displayed?.total) {
              const pagesLeftInChapter = location.start.displayed.total - location.start.displayed.page;
              const chapterWordsLeft = pagesLeftInChapter * WORDS_PER_LOCATION * 0.5;
              setMinutesLeftChapter(Math.ceil(chapterWordsLeft / WORDS_PER_MINUTE));
            }
          }

          // Chapter name — use href from current location for accurate matching
          let resolvedChapter = chapterRef.current;
          if (location.start?.href) {
            const locHref = location.start.href.split('#')[0];
            const navItem = epub.navigation?.toc?.find(
              (item: any) => {
                const itemHref = item.href?.split('#')[0];
                return itemHref === locHref || locHref?.endsWith(itemHref);
              },
            );
            if (navItem) {
              resolvedChapter = navItem.label?.trim() || '';
              chapterRef.current = resolvedChapter;
              setChapter(resolvedChapter);
            }
          }

          // Persist local position immediately so reopen/reflow restores exactly.
          // Server sync is still debounced to avoid chatty writes while paging.
          if (locationsReadyRef.current) {
            updateProgress(book.id, cfi, pct, resolvedChapter);
            if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
            progressTimerRef.current = setTimeout(() => {
              syncProgress(book.id).catch(() => {});
            }, 1500);
          }

          // Wait for all images in the current view to load before letting
          // the eink bridge hibernate.  This prevents partial-render freezes on
          // high-resolution eink panels where image decompression can lag behind
          // the layout-complete signal.  A 2-second cap avoids infinite waits
          // for missing or slow-loading images.
          const views: any[] = (renditionRef.current as any)?.views()?._views ?? [];
          const imgs: HTMLImageElement[] = [];
          for (const v of views) {
            const d = v?.document as Document | undefined;
            if (d) imgs.push(...Array.from(d.querySelectorAll('img')) as HTMLImageElement[]);
          }
          const pending = imgs.filter(img => !img.complete || img.naturalWidth === 0);
          const imagesReady = pending.length === 0
            ? Promise.resolve()
            : Promise.all(pending.map(img => new Promise<void>(resolve => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              })));
          void Promise.race([imagesReady, new Promise<void>(r => setTimeout(r, 2000))])
            .then(() => { void finishEinkWork(true); });
        });

        // document inside the content hook below. We don't use
        // rendition.on('click') / rendition.on('keydown') because
        // epubjs's event forwarding chain doesn't fire in Safari
        // (sandboxed iframes without allow-scripts suppress mouse events).

        // Attach swipe, tap, and wheel gesture handlers to epub iframe content.
        // Touch events inside the iframe don't propagate to the outer React
        // container, so we must handle them directly on the iframe document.
        // This is critical for iPad/touch devices where all interactions happen
        // inside the epub iframe.

        // Shared wheel state across all iframes (spread mode has two iframes;
        // separate cooldowns per-iframe would allow double page turns on one swipe).
        let sharedWheelAccX = 0;
        let sharedWheelTimer: any = null;
        let sharedWheelCooldown = false;

        rendition.hooks.content.register((contents: Contents) => {
          const doc = (contents as any).document as Document;
          if (!doc) return;

          applyThemeAndTypographyToDocument(doc, readerThemeRef.current, typographyRef.current);

          // Prevent default browser gestures on the iframe content.
          // Use 'manipulation' (not 'none') — Safari suppresses all touch
          // events inside iframes when touch-action is 'none', breaking
          // swipe and tap handling entirely. 'manipulation' disables
          // double-tap-zoom and pinch while preserving touch event delivery.
          // We rely on preventDefault() in our touchmove handler to block
          // Safari's back/forward navigation on horizontal swipes.
          const docEl = doc.documentElement;
          if (docEl) docEl.style.touchAction = 'manipulation';
          if (doc.body) doc.body.style.touchAction = 'manipulation';

          let startX = 0, startY = 0, startTime = 0;
          let touchMoved = false;

          doc.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length === 1) {
              startX = e.touches[0].clientX;
              startY = e.touches[0].clientY;
              startTime = Date.now();
              touchMoved = false;
            }
          }, { passive: true });

          // Prevent default on horizontal moves to stop Safari from
          // hijacking swipes for its own back/forward navigation
          doc.addEventListener('touchmove', (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const dx = Math.abs(e.touches[0].clientX - startX);
            const dy = Math.abs(e.touches[0].clientY - startY);
            if (dx > 5 || dy > 5) touchMoved = true;
            if (dx > dy && dx > 10) {
              e.preventDefault();
            }
          }, { passive: false });

          doc.addEventListener('touchend', (e: TouchEvent) => {
            const touch = e.changedTouches[0];
            if (!touch) return;
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            const dt = Date.now() - startTime;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            // Tap detection: minimal movement + short duration
            if (!touchMoved && absDx < 10 && absDy < 10 && dt < 500) {
              touchTapRef.current = true;
              setTimeout(() => { touchTapRef.current = false; }, 400);

              // Convert iframe-local clientX to outer-document X so that tap zones
              // are based on the FULL SCREEN position (critical in spread mode where
              // each iframe starts at a non-zero left offset in the outer document).
              const iframeEl = doc.defaultView?.frameElement as HTMLElement | null;
              const iframeLeft = iframeEl ? iframeEl.getBoundingClientRect().left : 0;
              const outerX = touch.clientX + iframeLeft;
              const action = getTapZoneAction(outerX, { left: 0, width: window.innerWidth });

              if (action === 'prev') prevPageRef.current();
              else if (action === 'next') nextPageRef.current();
              else toggleControlsRef.current();
              return;
            }

            // Swipe detection
            const isHorizontal = absDx > absDy * 1.5;
            const velocity = absDx / Math.max(dt, 1);
            const isFlick = velocity > 0.5 && absDx > 60;
            const isDrag = absDx > 100 && dt < 600;

            if (isHorizontal && (isFlick || isDrag)) {
              if (dx < 0) nextPageRef.current();
              else prevPageRef.current();
            }
          });

          // Forward trackpad/mouse wheel events for gesture handling (page turns).
          // Uses shared state (sharedWheelAccX/Cooldown) so spread mode's two
          // iframes cannot each independently trigger a page turn on one gesture.
          doc.addEventListener('wheel', (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) return;
            if (sharedWheelCooldown) { sharedWheelAccX = 0; return; }
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.8 && Math.abs(e.deltaX) > 2) {
              e.preventDefault();
              sharedWheelAccX += e.deltaX;
              if (sharedWheelTimer) clearTimeout(sharedWheelTimer);
              sharedWheelTimer = setTimeout(() => { sharedWheelAccX = 0; }, 400);
              const threshold = 150;
              if (sharedWheelAccX > threshold) {
                sharedWheelAccX = 0; sharedWheelCooldown = true;
                nextPageRef.current();
                setTimeout(() => { sharedWheelCooldown = false; sharedWheelAccX = 0; }, 1000);
              } else if (sharedWheelAccX < -threshold) {
                sharedWheelAccX = 0; sharedWheelCooldown = true;
                prevPageRef.current();
                setTimeout(() => { sharedWheelCooldown = false; sharedWheelAccX = 0; }, 1000);
              }
            }
          }, { passive: false });

          // Direct click handler on iframe document. Registered in capture
          // phase so it fires before epubjs's own listener. This replaces
          // rendition.on('click') which doesn't fire in Safari due to
          // sandboxed-iframe mouse-event suppression.
          doc.addEventListener('click', (e: MouseEvent) => {
            if (touchTapRef.current) return;

            // Convert iframe-local clientX to outer-document X so that tap zones
            // are based on the FULL SCREEN position (critical in spread mode).
            const iframeEl = doc.defaultView?.frameElement as HTMLElement | null;
            const iframeLeft = iframeEl ? iframeEl.getBoundingClientRect().left : 0;
            const outerX = e.clientX + iframeLeft;
            const action = getTapZoneAction(outerX, { left: 0, width: window.innerWidth });

            if (action === 'prev') prevPageRef.current();
            else if (action === 'next') nextPageRef.current();
            else toggleControlsRef.current();
          }, true);

          // Handle navigation keys directly inside the iframe so hardware
          // buttons do not depend on synthetic KeyboardEvent keyCode support.
          doc.addEventListener('keydown', (e: KeyboardEvent) => {
            const isPrevPageKey = e.key === 'ArrowLeft'
              || e.key === 'ArrowUp'
              || e.key === 'PageUp';
            const isNextPageKey = e.key === 'ArrowRight'
              || e.key === 'ArrowDown'
              || e.key === 'PageDown'
              || e.key === ' ';
            const isPrevVolumeKey = e.key === 'AudioVolumeDown'
              || e.code === 'VolumeDown'
              || e.keyCode === 25
              || e.keyCode === 174;
            const isNextVolumeKey = e.key === 'AudioVolumeUp'
              || e.code === 'VolumeUp'
              || e.keyCode === 24
              || e.keyCode === 175;
            const isCloseKey = e.key === 'Escape';

            if (isPrevPageKey || isNextPageKey || isPrevVolumeKey || isNextVolumeKey || isCloseKey) {
              e.preventDefault();
              e.stopPropagation();

              if (isPrevPageKey || isPrevVolumeKey) {
                prevPageInstantRef.current();
              } else if (isNextPageKey || isNextVolumeKey) {
                nextPageInstantRef.current();
              } else {
                onCloseRef.current();
              }

              return;
            }

            window.dispatchEvent(new KeyboardEvent('keydown', {
              key: e.key,
              code: e.code,
              bubbles: true,
              cancelable: true,
            }));
          }, true);
        });

        // Load TOC
        epub.loaded.navigation.then((nav) => {
          setTocItems(
            nav.toc.map((item: any) => ({
              label: item.label?.trim() || 'Untitled',
              href: item.href,
            })),
          );
        });

        // Generate locations for page numbers & percentages
        epub.ready.then(() => epub.locations.generate(1600)).then(() => {
          locationsReadyRef.current = true;
          setLocationsReady(true);
        });

        // Apply saved highlights
        epub.ready.then(() => {
          for (const hl of highlights) {
            try {
              rendition.annotations.add(
                'highlight', hl.cfi_range, {}, undefined, 'hl',
                { fill: hl.color || 'rgba(255, 223, 0, 0.3)', 'fill-opacity': '0.3', 'mix-blend-mode': 'multiply' },
              );
            } catch { /* ignore invalid CFI ranges */ }
          }
        });
      } catch (err: any) {
        if (!cancelled) {
          console.error('[epub] Failed to load book:', err);
          setLoadError(err?.message || 'Failed to load book');
          setIsLoading(false);
          void finishEinkWork(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      if (restoreFrameRef.current != null) cancelAnimationFrame(restoreFrameRef.current);
      syncProgress(book.id).catch(() => {});
      void finishEinkWork(false);
      if (epubRef.current) epubRef.current.destroy();
      epubRef.current = null;
      renditionRef.current = null;
      locationsReadyRef.current = false;
      setLocationsReady(false);
      currentBookDataRef.current = null;
    };
  }, [book.id, finishEinkWork, startEinkWork]); // eslint-disable-line react-hooks/exhaustive-deps

  // === Update spread mode ===
  useEffect(() => {
    if (renditionRef.current) {
      startEinkWork('spread');
      // Second arg overrides minSpreadWidth so the 800 px guard is bypassed.
      (renditionRef.current as any).spread(isSpreadView ? 'always' : 'none', isSpreadView ? 1 : 800);
      queueRestoreToCfi();
    }
  }, [isSpreadView, queueRestoreToCfi, startEinkWork]);

  // === Update theme/typography when settings change ===
  useEffect(() => {
    if (renditionRef.current) {
      startEinkWork('theme');
      const rendition = renditionRef.current;
      applyThemeAndTypography(rendition, readerTheme, typography);
      queueRestoreToCfi();
    }
  }, [readerTheme, typography, queueRestoreToCfi, startEinkWork]);

  // === Save typography to localStorage ===
  useEffect(() => {
    saveTypographySettings(typography);
  }, [typography]);

  // === Auto-hide toolbar (4s) ===
  useEffect(() => {
    if (!showControls || showToc || showTypography) return;
    const timer = setTimeout(() => {
      setShowControls(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [showControls, showToc, showTypography, controlsTick]);

  // === TOC navigation ===
  const goToTocItem = useCallback((href: string) => {
    startEinkWork('toc');
    renditionRef.current?.display(href);
    setShowToc(false);
  }, [startEinkWork]);

  // When the user changes columnCount in the typography panel, sync to spread view
  const handleTypographyChange = useCallback((newSettings: TypographySettings) => {
    if (newSettings.columnCount !== typography.columnCount) {
      manualSpreadPreferenceRef.current = true;
      setIsSpreadView(newSettings.columnCount === 2);
    }
    setTypography(newSettings);
  }, [typography.columnCount]);

  // === Handle slider position change ===
  const handlePositionChange = useCallback((pos: number) => {
    if (!epubRef.current || !locationsReadyRef.current) return;
    const locations = epubRef.current.locations as any;
    const cfi = locations.cfiFromLocation(pos);
    if (cfi) {
      startEinkWork('seek');
      renditionRef.current?.display(cfi);
    }
  }, [startEinkWork]);

  // === Download EPUB ===
  const handleDownload = useCallback(async () => {
    try {
      const bookUrl = api.getBookFileUrl(book.id);
      const authHeader = api.isAuthenticated() ? api.getAuthHeader() : undefined;
      const response = await fetch(bookUrl, {
        headers: authHeader ? { Authorization: authHeader } : {},
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${book.title.replace(/[^\w\s.-]/g, '-')}.epub`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[epub-reader] Download failed:', err);
    }
  }, [book.id, book.title]);

  // === Save / remove offline ===
  const handleToggleOffline = useCallback(async () => {
    if (isPinnedOffline) {
      await removeOfflineItem(`/offline/books/${book.id}`);
      return;
    }

    if (isAutoCachedOffline) {
      await setOfflineItemRetention(`/offline/books/${book.id}`, 'manual');
      return;
    }

    setIsSavingOffline(true);
    try {
      if (currentBookDataRef.current) {
        const authHeader = api.isAuthenticated() ? api.getAuthHeader() || '' : '';
        await saveBookOfflineData(
          book.id,
          book.title,
          currentBookDataRef.current,
          api.getBookCoverUrl(book.id),
          book.author,
          { retention: 'manual', coverAuthHeader: authHeader },
        );
      } else {
        const bookUrl = api.getBookFileUrl(book.id);
        const authHeader = api.isAuthenticated() ? api.getAuthHeader() || '' : '';
        await saveBookOffline(book.id, book.title, bookUrl, authHeader, api.getBookCoverUrl(book.id), book.author);
      }
    } catch (err) {
      console.error('[epub-reader] Offline save failed:', err);
    } finally {
      setIsSavingOffline(false);
    }
  }, [book.id, book.title, book.author, isPinnedOffline, isAutoCachedOffline]);

  // === Computed labels ===
  const pageLabel = useMemo(() => {
    if (totalPagesOverall > 0) {
      return `${currentPageOverall} / ${totalPagesOverall}`;
    }
    return `${Math.round(percentage * 100)}%`;
  }, [currentPageOverall, totalPagesOverall, percentage]);

  const progressSecondaryLabel = useMemo(() => {
    if (minutesLeftChapter > 0) return `${minutesLeftChapter} min left in chapter`;
    if (minutesLeftBook > 0) return `${minutesLeftBook} min left`;
    return undefined;
  }, [minutesLeftChapter, minutesLeftBook]);

  // === Theme-aware colors for wrapper and page margin indicators ===
  const themeColors = useMemo(() => {
    switch (readerTheme) {
      case 'sepia': return { bg: '#f4ecd8', fg: 'rgba(91,70,54,0.15)' };
      case 'dark': return { bg: '#1a1a1a', fg: 'rgba(232,232,232,0.15)' };
      case 'eink': return { bg: '#ffffff', fg: 'rgba(0,0,0,0.18)' };
      case 'eink-dark': return { bg: '#000000', fg: 'rgba(255,255,255,0.24)' };
      default: return { bg: '#ffffff', fg: 'rgba(26,26,26,0.12)' };
    }
  }, [readerTheme]);

  // === Animation styles for the epub container ===
  const pageStyle = getPageStyle({
    scale: 1,
    panOffset: { x: 0, y: 0 },
    swipeOffset: gestures.swipeOffset,
  });
  const overlayTopOffset = 'calc(max(env(safe-area-inset-top, 0px), 8px) + 52px)';

  return (
    <div
      ref={gestures.containerRef}
      className={cn(
        'fixed inset-0 z-[100] flex flex-col',
        'animate-fade-in',
      )}
      style={{ backgroundColor: themeColors.bg }}
      {...gestures.touchHandlers}
    >
      {/* ─── Header ─── */}
      {showControls && (
        <div
          className={cn(
            'absolute top-0 left-0 right-0 z-20',
            'flex items-center justify-between px-3 py-2',
            'bg-[var(--color-surface-primary)]/90 backdrop-blur-xl',
            'border-b border-[var(--color-border-subtle)]',
            'animate-fade-in',
            'reader-overlay-surface',
          )}
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 8px)' }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              onPointerDown={handleCloseInteraction}
              onClick={handleCloseInteraction}
              className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
              title="Close reader"
            >
              <X size={20} className="text-[var(--color-text-secondary)]" />
            </button>
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {book.title}
              </h2>
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                {chapter && <span className="truncate">{chapter}</span>}
                <span className="tabular-nums">{Math.round(percentage * 100)}%</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0" onPointerDown={() => setControlsTick(t => t + 1)}>
            {/* TOC */}
            <button
              onClick={() => { setShowToc((p) => !p); setShowTypography(false); }}
              className={cn(
                'p-2 rounded-lg transition-colors',
                showToc
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]',
              )}
              title="Table of Contents"
            >
              <List size={18} />
            </button>

            {/* Typography */}
            <button
              onClick={() => { setShowTypography((p) => !p); setShowToc(false); }}
              className={cn(
                'p-2 rounded-lg transition-colors',
                showTypography
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]',
              )}
              title="Typography settings"
            >
              <Type size={18} />
            </button>

            {/* Download EPUB */}
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
              title="Download EPUB"
            >
              <Download size={18} className="text-[var(--color-text-secondary)]" />
            </button>

            {/* Save offline */}
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

            <div className="w-px h-5 bg-[var(--color-border-default)] mx-0.5" />

            {/* Theme mode cycle — changes the app-wide theme (light / system / dark) */}
            <button
              onClick={() => {
                const idx = APP_THEME_ORDER.indexOf(appTheme);
                setTheme(APP_THEME_ORDER[(idx + 1) % APP_THEME_ORDER.length]);
              }}
              className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
              title={`App theme: ${appTheme}`}
            >
              {appTheme === 'dark'
                ? <Moon size={18} className="text-[var(--color-text-secondary)]" />
                : appTheme === 'system'
                  ? <Monitor size={18} className="text-[var(--color-text-secondary)]" />
                  : <Sun size={18} className="text-[var(--color-text-secondary)]" />}
            </button>
          </div>
        </div>
      )}

      {/* ─── TOC sidebar ─── */}
      {showToc && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowToc(false)} />
          <div className={cn(
            'absolute left-0 bottom-0 z-40 w-72',
            'bg-[var(--color-surface-primary)] border-r border-[var(--color-border-default)]',
            'shadow-lg overflow-y-auto animate-fade-in',
            'reader-overlay-surface',
          )}
            style={{ top: overlayTopOffset }}>
            <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Contents</h3>
            </div>
            {tocItems.map((item, i) => (
              <button
                key={i}
                onClick={() => goToTocItem(item.href)}
                className={cn(
                  'w-full text-left px-4 py-2.5 text-sm',
                  'hover:bg-[var(--color-surface-hover)] transition-colors',
                  'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                  'border-b border-[var(--color-border-subtle)]',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ─── Typography panel ─── */}
      {showTypography && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowTypography(false)} />
          <TypographyPanel
            settings={typography}
            onChange={handleTypographyChange}
            onClose={() => setShowTypography(false)}
            isDarkMode={isReaderDark}
            topOffset={overlayTopOffset}
            showReadingModeControl={false}
            alwaysShowColumns={true}
            maxPaginatedColumns={2}
          />
        </>
      )}

      {/* ─── EPUB content area ─── */}
      <div
        ref={wrapperRef}
        className="flex-1 min-h-0 relative overflow-hidden group"
        onClick={gestures.handleContentClick}
      >
        {/* Animated wrapper around the epub viewer */}
        <div className="w-full h-full" style={pageStyle}>
          <div
            ref={viewerRef}
            className="w-full h-full"
            style={{
              opacity: isLoading ? 0 : 1,
              transition: einkMode ? 'none' : 'opacity 0.3s',
              touchAction: 'manipulation',
            }}
          />
        </div>



        {/* Loading */}
        {isLoading && !loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 size={32} className="animate-spin text-[var(--color-text-secondary)]" />
            <p className="text-sm text-[var(--color-text-secondary)]">Loading book...</p>
          </div>
        )}

        {/* Error */}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8">
            <p className="text-sm text-red-500">{loadError}</p>
            <button
              onPointerDown={handleCloseInteraction}
              onClick={handleCloseInteraction}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              Close
            </button>
          </div>
        )}

        {/* Shared navigation buttons */}
        {showControls && !isLoading && !loadError && (
          <ReaderNavButtons
            onPrev={prevPage}
            onNext={nextPage}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
          />
        )}

        {/* Floating status pill — page position + reading time. Shows when controls are HIDDEN */}
        {!isLoading && (totalPagesOverall > 0 || minutesLeftBook > 0 || percentage > 0) && (
          <div
            className={cn(
              'absolute bottom-3 left-1/2 -translate-x-1/2 z-10',
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full',
              'bg-[var(--color-surface-primary)]/70 backdrop-blur-sm',
              'border border-[var(--color-border-subtle)]',
              'text-[10px] text-[var(--color-text-tertiary)]',
              'pointer-events-none',
              'reader-overlay-surface',
            )}
            style={{
              transition: einkMode ? 'none' : 'opacity 0.3s ease, transform 0.3s ease',
              opacity: showControls ? 0 : 1,
              transform: einkMode ? 'none' : (showControls ? 'translateY(8px)' : 'translateY(0)'),
            }}
          >
            {totalPagesOverall > 0 ? (
              <span className="tabular-nums">{currentPageOverall} / {totalPagesOverall}</span>
            ) : (
              <span className="tabular-nums">{Math.round(percentage * 100)}%</span>
            )}
            {totalPagesOverall > 0 && minutesLeftBook > 0 && (
              <span className="opacity-40">·</span>
            )}
            {minutesLeftBook > 0 && (
              <>
                <Clock size={10} />
                {minutesLeftChapter > 0 && (
                  <>
                    <span>{minutesLeftChapter} min left in ch.</span>
                    <span className="opacity-40">·</span>
                  </>
                )}
                <span>{minutesLeftBook} min left in book</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Cross-device sync toast ─── */}
      <SyncPositionToast
        visible={remoteSync.hasRemoteUpdate}
        position={remoteSync.remotePosition}
        onAccept={handleAcceptRemotePosition}
        onDismiss={remoteSync.dismissRemotePosition}
      />

      {/* ─── Bottom progress bar (overlay) ─── */}
      {/* Only visible when controls are shown (tap to reveal), just like the nav buttons */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20"
        style={{
          transition: einkMode ? 'none' : 'opacity 0.3s ease, transform 0.3s ease',
          opacity: showControls ? 1 : 0,
          transform: einkMode ? 'none' : (showControls ? 'translateY(0)' : 'translateY(100%)'),
          pointerEvents: showControls ? 'auto' : 'none',
        }}
      >
        <ReaderProgressBar
          currentPosition={totalPagesOverall > 0
            ? Math.min(Math.max(currentPageOverall, 1), totalPagesOverall)
            : Math.min(Math.max(Math.round(percentage * 100), 1), 100)}
          totalPositions={totalPagesOverall > 0 ? totalPagesOverall : 100}
          label={pageLabel}
          secondaryLabel={totalPagesOverall > 0 ? progressSecondaryLabel : undefined}
          rightLabel={totalPagesOverall > 0 && minutesLeftBook > 0 ? `${minutesLeftBook} min left` : undefined}
          onPositionChange={handlePositionChange}
          disabled={totalPagesOverall <= 0}
          className={totalPagesOverall > 0 ? undefined : 'bg-[var(--color-surface-primary)]/80 backdrop-blur-xl'}
        />
      </div>
    </div>
  );
}

// ==========================================================================
// Theme + Typography application
// ==========================================================================

function applyThemeAndTypography(
  rendition: Rendition,
  theme: ReaderTheme,
  typo: TypographySettings,
) {
  const isOriginal = typo.preset === 'original';
  const useOriginalFont = typo.fontFamily === 'original' || isOriginal;

  const fontFamily = useOriginalFont
    ? 'inherit'
    : getEpubFontStack(typo.fontFamily);

  const lineHeight = isOriginal ? undefined : String(typo.lineHeight);
  const textAlign = isOriginal || typo.textAlign === 'original' ? undefined : typo.textAlign;
  const hyphens = isOriginal ? undefined : typo.hyphenation ? 'auto' : 'manual';
  const vMargin = isOriginal ? 0 : typo.verticalMargin ?? 0;
  const safePaddingTop = getEpubVerticalPaddingCss(vMargin, 'top', EPUB_CONTENT_TOP_CLEARANCE_PX);
  const safePaddingBottom = getEpubVerticalPaddingCss(vMargin, 'bottom', EPUB_CONTENT_BOTTOM_CLEARANCE_PX);
  const sideMargin = isOriginal ? undefined : `${typo.margin}px`;

  const bodyStyle: Record<string, string> = {};
  if (!useOriginalFont) bodyStyle['font-family'] = `${fontFamily} !important`;
  if (lineHeight) bodyStyle['line-height'] = `${lineHeight} !important`;
  if (textAlign) bodyStyle['text-align'] = `${textAlign} !important`;
  if (hyphens) bodyStyle['hyphens'] = `${hyphens} !important`;
  // Keep fixed top/bottom clearance inside the iframe so reader overlays
  // never occlude the first or last lines, even at the minimum margin setting.
  bodyStyle['box-sizing'] = 'border-box !important';
  bodyStyle['padding-top'] = `${safePaddingTop} !important`;
  bodyStyle['padding-bottom'] = `${safePaddingBottom} !important`;
  if (sideMargin) {
    bodyStyle['padding-left'] = `${sideMargin} !important`;
    bodyStyle['padding-right'] = `${sideMargin} !important`;
  }

  // Apply line-height and text-align to content elements too, so they
  // override element-level styles from the epub's own CSS
  const contentStyle: Record<string, string> = {};
  if (lineHeight) contentStyle['line-height'] = `${lineHeight} !important`;
  if (textAlign) contentStyle['text-align'] = `${textAlign} !important`;

  const pStyle: Record<string, string> = {};
  if (!isOriginal) {
    pStyle['margin-bottom'] = `${typo.paragraphSpacing}em !important`;
  }

  // Color palettes per theme
  const colors = {
    light: { bg: '#ffffff', fg: '#1a1a1a', link: '#2563eb' },
    sepia: { bg: '#f4ecd8', fg: '#5b4636', link: '#8b5e34' },
    dark:  { bg: '#1a1a1a', fg: '#e8e8e8', link: '#60a5fa' },
    eink: { bg: '#ffffff', fg: '#000000', link: '#000000' },
    'eink-dark': { bg: '#000000', fg: '#ffffff', link: '#ffffff' },
  };
  const { bg, fg, link } = colors[theme];

  // Register under a single name so select() reliably replaces the active styles.
  // Apply line-height / text-align to common content elements so they override
  // element-level styles from the epub's own CSS (body-level styles only inherit
  // and don't override direct element rules).
  rendition.themes.register('reader', {
    body: {
      'background-color': `${bg} !important`,
      color: `${fg} !important`,
      ...bodyStyle,
    },
    p: { ...pStyle, ...contentStyle },
    'div, li, blockquote, dd, dt, figcaption, td, th, section, article': contentStyle,
    a: { color: link },
    img: { 'max-width': '100%' },
  });
  rendition.themes.select('reader');

  // Direct override as backup — ensures color switch even if cached stylesheet persists
  rendition.themes.override('color', fg);
  rendition.themes.override('background-color', bg);

  if (!isOriginal) {
    rendition.themes.fontSize(`${typo.fontSize}%`);
  } else {
    rendition.themes.fontSize('100%');
  }

  for (const content of rendition.getContents() as unknown as Contents[]) {
    const doc = (content as any).document as Document | undefined;
    if (doc) {
      applyThemeAndTypographyToDocument(doc, theme, typo);
    }
  }
}

function applyThemeAndTypographyToDocument(
  doc: Document,
  theme: ReaderTheme,
  typo: TypographySettings,
) {
  const styleId = 'informeer-epub-reader-style';
  const isOriginal = typo.preset === 'original';
  const useOriginalFont = typo.fontFamily === 'original' || isOriginal;
  const fontFamily = useOriginalFont ? 'inherit' : getEpubFontStack(typo.fontFamily);
  const lineHeight = isOriginal ? undefined : String(typo.lineHeight);
  const textAlign = isOriginal || typo.textAlign === 'original' ? undefined : typo.textAlign;
  const hyphens = isOriginal ? undefined : (typo.hyphenation ? 'auto' : 'manual');
  const sideMargin = isOriginal ? '0px' : `${typo.margin}px`;
  const verticalMargin = isOriginal ? 0 : typo.verticalMargin ?? 0;
  const paddingTop = getEpubVerticalPaddingCss(verticalMargin, 'top', EPUB_CONTENT_TOP_CLEARANCE_PX);
  const paddingBottom = getEpubVerticalPaddingCss(verticalMargin, 'bottom', EPUB_CONTENT_BOTTOM_CLEARANCE_PX);
  const paragraphSpacing = isOriginal ? undefined : `${typo.paragraphSpacing}em`;

  const colors = {
    light: { bg: '#ffffff', fg: '#1a1a1a', link: '#2563eb' },
    sepia: { bg: '#f4ecd8', fg: '#5b4636', link: '#8b5e34' },
    dark: { bg: '#1a1a1a', fg: '#e8e8e8', link: '#60a5fa' },
    eink: { bg: '#ffffff', fg: '#000000', link: '#000000' },
    'eink-dark': { bg: '#000000', fg: '#ffffff', link: '#ffffff' },
  } as const;
  const { bg, fg, link } = colors[theme];

  let style = doc.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = styleId;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  style.textContent = `
    ${EPUB_FONT_FACE_CSS}

    html {
      margin: 0 !important;
      padding: 0 !important;
      background: ${bg} !important;
    }

    body {
      margin: 0 !important;
      box-sizing: border-box !important;
      background: ${bg} !important;
      color: ${fg} !important;
      padding-top: ${paddingTop} !important;
      padding-right: ${sideMargin} !important;
      padding-bottom: ${paddingBottom} !important;
      padding-left: ${sideMargin} !important;
      ${!useOriginalFont ? `font-family: ${fontFamily} !important;` : ''}
      ${lineHeight ? `line-height: ${lineHeight} !important;` : ''}
      ${textAlign ? `text-align: ${textAlign} !important;` : ''}
      ${hyphens ? `hyphens: ${hyphens} !important;` : ''}
    }

    p {
      ${lineHeight ? `line-height: ${lineHeight} !important;` : ''}
      ${textAlign ? `text-align: ${textAlign} !important;` : ''}
      ${paragraphSpacing ? `margin-bottom: ${paragraphSpacing} !important;` : ''}
    }

    div, li, blockquote, dd, dt, figcaption, td, th, section, article {
      ${lineHeight ? `line-height: ${lineHeight} !important;` : ''}
      ${textAlign ? `text-align: ${textAlign} !important;` : ''}
    }

    a {
      color: ${link} !important;
    }

    img, svg, video, table, pre, code {
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
  `;

}
