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

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  X, Sun, Moon, Monitor, Type, List, Loader2,
  Clock, Download, CloudOff, Check,
} from 'lucide-react';
import { api } from '@/api/client';
import { useBooksStore } from '@/stores/books';
import { useSettingsStore } from '@/stores/settings';
import type { EpubReaderTheme } from '@/stores/settings';
import { getEpubReaderTheme } from '@/lib/epub-reader-themes';
import type { Book } from '@/types/api';
import ePub, { EpubCFI } from 'epubjs';
import type { Book as EpubBook, Rendition, Contents } from 'epubjs';
import { applyEpubjsPatches } from '@/lib/epubjs-patches';
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
import {
  SWIPE_FOLLOW_EDGE_DAMPING,
  SWIPE_SETTLE_MS,
  WHEEL_GESTURE_END_MS,
  isHorizontalSwipe,
  shouldCommitFollowSwipe,
  shouldCommitSwipe,
} from '@/components/reader/swipe-follow';
import { useRemoteProgressSync } from '@/hooks/useRemoteProgressSync';
import { TypographyPanel, DEFAULT_TYPOGRAPHY } from '@/components/reader/TypographyPanel';
import { ReaderColorSchemePicker } from '@/components/reader/ReaderColorSchemePicker';
import type { TypographySettings } from '@/components/reader/TypographyPanel';
import { getCachedBlob, getOfflineItem, removeOfflineItem, saveBookOffline, saveBookOfflineData, setOfflineItemRetention } from '@/lib/offline/blob-cache';
import { useOfflineRegistry } from '@/stores/offline';
import { useConnectivityStore } from '@/stores/connectivity';
import { EPUB_FONT_FACE_CSS, getEpubFontStack, normalizeEpubFontValue } from '@/lib/epub-fonts';
import { deleteCachedEpubLocations, readCachedEpubLocations, writeCachedEpubLocations } from '@/lib/epub-locations-cache';
import { useIsLandscapeViewport } from '@/hooks/useIsLandscapeViewport';
import { useOverlayCloseInteraction } from '@/hooks/useOverlayCloseInteraction';
import { einkPower } from '@/services/eink-power';

applyEpubjsPatches();

type ReaderTheme = EpubReaderTheme;
type PageNumberMode = 'source' | 'synthetic' | 'percent';
// A released drag carries the page the rest of the way off, then the new page
// slides in behind it. Kept brisk — this plays after the finger has already
// left the screen.
const PAGE_DRAG_EXIT_MS = 170;
// Floor for the shortened exit, so the swap never reads as a hard cut.
const PAGE_DRAG_EXIT_MIN_MS = 80;
const PAGE_DRAG_ENTER_MS = 170;
// Longest wait for the rendition to report the new page before the reader
// gives up and puts the page back, rather than leaving it parked off-screen.
const PAGE_DRAG_TURN_TIMEOUT_MS = 700;

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
const EPUB_RESTORE_GUARD_SCHEDULED_MS = 2000;
const EPUB_RESTORE_GUARD_DISPLAYING_MS = 1000;
const EPUB_LOCATION_BREAK_CHARS = 1600;
// A relocation within this window after a user navigation (page turn, TOC,
// seek, link) is attributed to that navigation and may move the anchor.
const EPUB_USER_NAV_WINDOW_MS = 3000;
// Debounce for re-checking the anchor after late reflows (fonts, images).
const EPUB_ANCHOR_CHECK_DELAY_MS = 250;

interface DerivedPagePosition {
  mode: PageNumberMode;
  current: number;
  total: number;
  min: number;
  percentage: number | null;
}

function getDerivedPagePosition(
  epub: EpubBook | null,
  cfi: string,
  locationsReady: boolean,
): DerivedPagePosition {
  const pageList = (epub as any)?.pageList;
  const pageLocations = pageList?.locations;

  if (pageList && Array.isArray(pageLocations) && pageLocations.length > 0 && cfi) {
    const page = pageList.pageFromCfi(cfi);
    const firstPage = Number.isFinite(pageList.firstPage) ? pageList.firstPage : 1;
    const lastPage = Number.isFinite(pageList.lastPage)
      ? pageList.lastPage
      : (Number.isFinite(pageList.totalPages) ? firstPage + pageList.totalPages : 0);

    if (Number.isFinite(page) && page >= 0 && Number.isFinite(lastPage) && lastPage > 0) {
      const safePage = Math.min(Math.max(page, firstPage), lastPage);
      const pagePercentage = pageList.percentageFromPage(safePage);
      return {
        mode: 'source',
        current: safePage,
        total: lastPage,
        min: firstPage,
        percentage: Number.isFinite(pagePercentage) ? pagePercentage : null,
      };
    }
  }

  const locationModel = (epub as any)?.locations;
  if (locationsReady && locationModel && cfi) {
    const locIndex = locationModel.locationFromCfi(cfi);
    const totalLocs = locationModel.total || 0;

    if (Number.isFinite(locIndex) && totalLocs > 0) {
      const safeIndex = Math.max(0, locIndex);
      const percentage = locationModel.percentageFromLocation(safeIndex);
      return {
        mode: 'synthetic',
        current: safeIndex + 1,
        total: totalLocs + 1,
        min: 1,
        percentage: Number.isFinite(percentage) ? percentage : null,
      };
    }
  }

  return {
    mode: 'percent',
    current: 0,
    total: 0,
    min: 1,
    percentage: null,
  };
}

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

function chooseInitialProgress(
  local: { cfi?: string; percentage?: number; chapter?: string; updated_at?: string | null } | null,
  remote: { cfi?: string; percentage?: number; chapter?: string; updated_at?: string | null } | null,
) {
  const localHasPosition = Boolean(local?.cfi);
  const remoteHasPosition = Boolean(remote?.cfi);

  if (!localHasPosition) return remoteHasPosition ? remote : local;
  if (!remoteHasPosition) return local;

  // Prefer whichever position is further ahead. Timestamp comparison is
  // unreliable: the server timestamp is written 1500ms+ after the client
  // timestamp (sync debounce + latency), so a stale server page can appear
  // "newer" than a fresh local page, causing a position regression on reopen.
  // The 2% gap threshold avoids jitter from percentage rounding differences.
  const localPct = local?.percentage ?? 0;
  const remotePct = remote?.percentage ?? 0;
  return (remotePct - localPct > 0.02) ? remote : local;
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
  const userNavAtRef = useRef(0);
  const anchorCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreGuardRef = useRef<{
    phase: 'idle' | 'scheduled' | 'displaying';
    sequence: number;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }>({ phase: 'idle', sequence: 0, timeoutId: null });

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
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!showControls || !el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showControls]);

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
  const setEpubLightTheme = useSettingsStore(s => s.setEpubLightTheme);
  const setEpubDarkTheme = useSettingsStore(s => s.setEpubDarkTheme);
  const recentOfflineBooksLimit = useSettingsStore(s => s.recentOfflineBooksLimit);
  const readerToolbarHideDelay = useSettingsStore(s => s.readerToolbarHideDelay);
  const offlineRegistry = useOfflineRegistry();
  const isWindowLandscapeViewport = useIsLandscapeViewport();

  // Use window orientation (not the viewer div) for spread eligibility.
  // The viewer div shrinks by ~52px when the toolbar is visible; on near-square
  // screens that flips isSpreadEligible, which triggers spread/theme effects that
  // activate the restore guard every time the toolbar auto-hides — silently
  // discarding page-turn progress for the duration of every guard window.
  const isLandscapeViewport = isWindowLandscapeViewport;
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
  const isReaderDark = getEpubReaderTheme(readerTheme).isDark;
  // The panel edits the scheme for whichever app mode is active right now.
  const handleColorSchemeChange = useCallback((theme: EpubReaderTheme) => {
    if (resolvedAppIsDark) setEpubDarkTheme(theme);
    else setEpubLightTheme(theme);
  }, [resolvedAppIsDark, setEpubDarkTheme, setEpubLightTheme]);

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
  const progressPercentageRef = useRef(initialProgress.percentage);
  const [maxPercentage, setMaxPercentage] = useState(initialProgress.percentage);
  const [locationsReady, setLocationsReady] = useState(false);
  const [pageRangeStartOverall, setPageRangeStartOverall] = useState(1);
  const [pageNumberMode, setPageNumberMode] = useState<PageNumberMode>('percent');

  const clearRestoreGuard = useCallback((sequence?: number) => {
    const guard = restoreGuardRef.current;
    if (sequence != null && guard.sequence !== sequence) return;

    if (guard.timeoutId != null) {
      clearTimeout(guard.timeoutId);
    }

    restoreGuardRef.current = {
      phase: 'idle',
      sequence: guard.sequence,
      timeoutId: null,
    };
  }, []);

  const setRestoreGuardPhase = useCallback((sequence: number, phase: 'scheduled' | 'displaying', timeoutMs: number) => {
    const guard = restoreGuardRef.current;
    if (guard.timeoutId != null) {
      clearTimeout(guard.timeoutId);
    }

    restoreGuardRef.current = {
      phase,
      sequence,
      timeoutId: setTimeout(() => {
        clearRestoreGuard(sequence);
      }, timeoutMs),
    };
  }, [clearRestoreGuard]);

  const queueRestoreToCfi = useCallback((cfi?: string | null, reason = 'unspecified') => {
    const rendition = renditionRef.current;
    const targetCfi = cfi ?? lastKnownCfiRef.current;
    if (!rendition || !targetCfi) return;

    const restoreSequence = restoreGuardRef.current.sequence + 1;
    setRestoreGuardPhase(restoreSequence, 'scheduled', EPUB_RESTORE_GUARD_SCHEDULED_MS);

    if (restoreFrameRef.current != null) {
      cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }

    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        if (renditionRef.current !== rendition) {
          clearRestoreGuard(restoreSequence);
          return;
        }

        setRestoreGuardPhase(restoreSequence, 'displaying', EPUB_RESTORE_GUARD_DISPLAYING_MS);
        rendition.display(targetCfi).catch(() => {
          clearRestoreGuard(restoreSequence);
        });
      });
    });
  }, [clearRestoreGuard, setRestoreGuardPhase]);

  // lastKnownCfiRef is the reading-position anchor. Only relocations caused by
  // user navigation may move it; relocations caused by layout (initial display,
  // window resize, font/image reflow, spread/typography changes) must not,
  // otherwise every re-layout re-saves the start of a *different* page and the
  // position ratchets backwards (a page start is always <= the anchor).
  const markUserNavigation = useCallback(() => {
    userNavAtRef.current = performance.now();
  }, []);

  const isUserNavigationPending = useCallback(() => (
    userNavAtRef.current > 0 && performance.now() - userNavAtRef.current < EPUB_USER_NAV_WINDOW_MS
  ), []);

  // Re-display the anchor if a late reflow (web fonts swapping in, images
  // loading, resize) moved it off-screen. epubjs positions the view once and
  // never re-seeks, so without this the reader silently shows an earlier page.
  const ensureAnchorVisible = useCallback(() => {
    const rendition = renditionRef.current;
    const anchor = lastKnownCfiRef.current;
    if (!rendition || !anchor) return;
    if (restoreGuardRef.current.phase !== 'idle' || isUserNavigationPending()) return;

    try {
      const location = (rendition as any).currentLocation?.();
      const start = location?.start?.cfi;
      const end = location?.end?.cfi;
      if (!start || !end) return;

      const cfi = new EpubCFI();
      const anchorVisible = cfi.compare(anchor, start) >= 0 && cfi.compare(anchor, end) <= 0;
      if (!anchorVisible) {
        queueRestoreToCfi(anchor, 'anchor-off-screen');
      }
    } catch {
      // Unparseable CFI — leave the view alone.
    }
  }, [isUserNavigationPending, queueRestoreToCfi]);

  const scheduleAnchorCheck = useCallback(() => {
    if (anchorCheckTimerRef.current) clearTimeout(anchorCheckTimerRef.current);
    anchorCheckTimerRef.current = setTimeout(() => {
      anchorCheckTimerRef.current = null;
      ensureAnchorVisible();
    }, EPUB_ANCHOR_CHECK_DELAY_MS);
  }, [ensureAnchorVisible]);
  const scheduleAnchorCheckRef = useRef(scheduleAnchorCheck);
  scheduleAnchorCheckRef.current = scheduleAnchorCheck;
  const markUserNavigationRef = useRef(markUserNavigation);
  markUserNavigationRef.current = markUserNavigation;

  const handleCloseInteraction = useOverlayCloseInteraction(onClose);

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
      // Only create a new object when columnCount actually changes — a new reference
      // with the same value would trigger the theme effect and fire queueRestoreToCfi.
      setTypography(prev => prev.columnCount === cols ? prev : { ...prev, columnCount: cols });
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
      markUserNavigation();
      renditionRef.current.display(remoteSync.remotePosition.cfi).catch(() => {});
    }
    remoteSync.acceptRemotePosition();
  }, [markUserNavigation, remoteSync]);

  // --- Page info ---
  const [currentPageOverall, setCurrentPageOverall] = useState(0);
  const [totalPagesOverall, setTotalPagesOverall] = useState(0);

  // --- Reading time estimates ---
  const [minutesLeftChapter, setMinutesLeftChapter] = useState(0);
  const [minutesLeftBook, setMinutesLeftBook] = useState(0);
  const WORDS_PER_LOCATION = 260;
  const WORDS_PER_MINUTE = 250;

  const applyDerivedPagePosition = useCallback((pagePosition: DerivedPagePosition) => {
    setPageNumberMode(pagePosition.mode);
    setPageRangeStartOverall(pagePosition.min);

    if (pagePosition.current > 0 && pagePosition.total > 0) {
      setCurrentPageOverall(pagePosition.current);
      setTotalPagesOverall(pagePosition.total);

      const pagesLeft = Math.max(0, pagePosition.total - pagePosition.current);
      const wordsLeft = pagesLeft * WORDS_PER_LOCATION;
      setMinutesLeftBook(Math.ceil(wordsLeft / WORDS_PER_MINUTE));
      return;
    }

    setCurrentPageOverall(0);
    setTotalPagesOverall(0);
    setMinutesLeftBook(0);
  }, [WORDS_PER_LOCATION]);

  // --- Zoom (1x for EPUB — shared gestures need this) ---
  const [scale, setScale] = useState(1);

  // --- Navigation state for shared hooks ---
  const canGoNext = totalPagesOverall > 0
    ? currentPageOverall + 1 < totalPagesOverall
    : percentage < 1;
  const canGoPrev = totalPagesOverall > 0
    ? currentPageOverall > pageRangeStartOverall
    : percentage > 0;

  const pageNumberModeLabel = useMemo(() => {
    switch (pageNumberMode) {
      case 'source':
        return 'Source page numbers';
      case 'synthetic':
        return 'Estimated page numbers';
      default:
        return 'Percentage only';
    }
  }, [pageNumberMode]);

  const pageNumberModeDescription = useMemo(() => {
    switch (pageNumberMode) {
      case 'source':
        return 'Using EPUB page-list data from the book file.';
      case 'synthetic':
        return 'Using generated reading positions because this EPUB has no usable page list.';
      default:
        return 'This book does not expose page markers yet; restore falls back to percentage/CFI.';
    }
  }, [pageNumberMode]);

  // === Shared Hooks ===

  const { animatePageTurn, triggerPageEnter, getPageStyle } = useReaderAnimation({ disabled: einkMode });
  const triggerPageEnterRef = useRef(triggerPageEnter);
  triggerPageEnterRef.current = triggerPageEnter;

  const runRenditionPageTurn = useCallback(
    (attemptRef: { current: boolean }, action: (() => Promise<unknown>) | null) => {
      if (!action || attemptRef.current) return false;

      attemptRef.current = true;
      markUserNavigation();
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
    [markUserNavigation],
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
  }, [canGoNext, animatePageTurn, finishEinkWork, runRenditionPageTurn, startEinkWork]);

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
  }, [canGoPrev, animatePageTurn, finishEinkWork, runRenditionPageTurn, startEinkWork]);

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
  const einkModeRef = useRef(einkMode);
  einkModeRef.current = einkMode;
  const canGoNextRef = useRef(canGoNext);
  canGoNextRef.current = canGoNext;
  const canGoPrevRef = useRef(canGoPrev);
  canGoPrevRef.current = canGoPrev;

  // ─── Follow-the-finger page drag ───────────────────────────────
  // Two ways to move the page, picked per gesture:
  //
  // - 'scroll' drags epubjs's own pagination container, which reveals the
  //   real neighbouring page. Preferred, and used for almost every turn.
  // - 'translate' slides the whole page surface over the page colour. Used
  //   where there is no neighbour to reveal — the first/last page of a
  //   chapter, single-page chapters, and RTL books.
  //
  // Either way the writes go straight to the DOM rather than through state:
  // a swipe produces a touchmove per frame, and this component is far too
  // heavy to re-render at that rate.
  type PageDragMode = 'none' | 'scroll' | 'translate';
  const pageDragModeRef = useRef<PageDragMode>('none');
  const scrollDragRef = useRef<{
    container: HTMLElement;
    startLeft: number;
    maxLeft: number;
    delta: number;
  } | null>(null);
  const scrollDragRafRef = useRef<number | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement>(null);
  const pageDragSettleTimerRef = useRef<number | null>(null);
  const pageDragExitTimerRef = useRef<number | null>(null);
  const pageDragEnterTimerRef = useRef<number | null>(null);
  const pageDragTurnTimeoutRef = useRef<number | null>(null);
  /** Set while the page is held off-screen waiting for the new content. */
  const pageDragEnterPendingRef = useRef(false);
  /**
   * How far the content has moved from where this gesture started.
   *
   * Touch coordinates arrive from inside the epub iframe, so they are measured
   * against the iframe's own viewport — which both drag modes move. Holding a
   * finger still therefore makes `clientX` drift by exactly `-offset`, and
   * feeding that back in oscillated the page every frame. Handlers add this
   * back to recover the finger's true travel. See `stableTouchX`.
   */
  const pageDragAppliedRef = useRef(0);

  /**
   * Move the page surface. Written synchronously from the touch handler, not
   * batched into a frame callback: a transform-only change is composited, so
   * deferring buys nothing and costs a frame of lag behind the finger. The
   * article reader writes its scrollLeft the same way, which is why the two
   * now track identically.
   */
  const writePageDrag = useCallback((offset: number) => {
    const el = pageSurfaceRef.current;
    if (!el) return;
    pageDragAppliedRef.current = offset;
    el.style.transition = 'none';
    el.style.transform = `translateX(${offset}px)`;
  }, []);

  /**
   * epubjs's pagination container, when it can serve a peek.
   *
   * With `flow: 'paginated'` the whole chapter is laid out as CSS columns
   * inside one iframe, and a page turn is just
   * `container.scrollLeft += layout.delta` — so the neighbouring pages are
   * already rendered, merely scrolled out of view. Scrolling the container
   * ourselves reveals them. epubjs listens to that same container's scroll
   * event and reports the new location 20ms after the motion stops, so it
   * keeps its own position without being told anything.
   */
  const getScrollPeekTarget = useCallback(() => {
    const manager = (renditionRef.current as any)?.manager;
    const container = manager?.container as HTMLElement | undefined;
    const delta = manager?.layout?.delta as number | undefined;
    if (!manager || !container || !delta || delta <= 0) return null;
    // epubjs scrolls RTL books with negative offsets; leave those to the
    // translate path rather than reimplementing its sign handling.
    if (manager.settings?.direction === 'rtl') return null;
    const maxLeft = container.scrollWidth - container.clientWidth;
    // A chapter that fits on one page has no neighbour to reveal.
    if (maxLeft <= 1) return null;
    return { container, startLeft: container.scrollLeft, maxLeft, delta };
  }, []);

  /** Ease the pagination container to an exact offset. */
  const animateContainerScroll = useCallback((
    container: HTMLElement,
    target: number,
    durationMs: number,
    onDone: () => void,
  ) => {
    if (scrollDragRafRef.current !== null) {
      cancelAnimationFrame(scrollDragRafRef.current);
      scrollDragRafRef.current = null;
    }
    const from = container.scrollLeft;
    const distance = target - from;
    if (Math.abs(distance) < 1) {
      container.scrollLeft = target;
      onDone();
      return;
    }
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      container.scrollLeft = from + distance * eased;
      if (progress < 1) {
        scrollDragRafRef.current = requestAnimationFrame(step);
        return;
      }
      container.scrollLeft = target;
      scrollDragRafRef.current = null;
      onDone();
    };
    scrollDragRafRef.current = requestAnimationFrame(step);
  }, []);

  /**
   * Claim the page for a drag, choosing how it will move. Returns false when
   * the reader will not drag at all — on E-ink, which cannot repaint fast
   * enough to follow a finger, or while a previous turn is still playing out.
   */
  const beginPageDrag = useCallback(() => {
    if (einkModeRef.current || isAnimatingRef.current) return false;
    // A previously released drag is still playing out its turn. Let it finish
    // rather than measure a new gesture against a surface that is mid-animation
    // — the offset would move under the gesture, exactly the feedback the
    // iframe coordinates already have to be corrected for.
    if (
      pageDragExitTimerRef.current !== null
      || pageDragEnterTimerRef.current !== null
      || pageDragEnterPendingRef.current
    ) return false;

    const peek = getScrollPeekTarget();
    if (peek) {
      scrollDragRef.current = peek;
      pageDragModeRef.current = 'scroll';
      return true;
    }
    if (!pageSurfaceRef.current) return false;
    pageDragModeRef.current = 'translate';
    return true;
  }, [getScrollPeekTarget]);

  /**
   * Track the pointer. Returns false when the reader will not drag, so callers
   * can fall back to a discrete turn.
   */
  const setPageDrag = useCallback((dx: number) => {
    if (pageDragModeRef.current === 'none' && !beginPageDrag()) return false;

    if (pageDragModeRef.current === 'scroll') {
      const drag = scrollDragRef.current;
      if (!drag) return false;
      // epubjs reports a location 20ms after scrolling stops, so pausing
      // mid-drag lands one at a half-turned position. Keep the user-navigation
      // window alive for the whole gesture so the anchor-restore watchdog reads
      // that as deliberate rather than drift and pulls the reader back a page.
      markUserNavigationRef.current();
      // The real neighbouring page comes with it. The ends stop hard: there
      // is nothing beyond this chapter in the container to scroll into.
      const next = Math.max(0, Math.min(drag.maxLeft, drag.startLeft - dx));
      drag.container.scrollLeft = next;
      // Scrolling right by N moves the content left by N, which is what the
      // touch coordinates have to be corrected by.
      pageDragAppliedRef.current = drag.startLeft - next;
      return true;
    }

    const el = pageSurfaceRef.current;
    if (!el) return false;
    // 1:1 with the pointer, so the page stays stuck to the finger exactly as it
    // does in the article reader. What trails in behind it is the page colour
    // rather than the next page's text — epubjs renders one page per iframe and
    // gives us no way to paint the neighbour alongside it — but tracking the
    // finger matters more than what fills the gutter.
    // Past the first/last page there is nothing to turn to, so the page resists.
    const atEdge = (dx > 0 && !canGoPrevRef.current) || (dx < 0 && !canGoNextRef.current);
    const offset = atEdge ? dx * SWIPE_FOLLOW_EDGE_DAMPING : dx;
    // Never travel more than one page away. A finger rarely gets that far, but a
    // trackpad flick's momentum tail keeps accumulating after the fingers lift
    // and would otherwise sling the page off into blank space before committing.
    const limit = window.innerWidth;
    writePageDrag(Math.max(-limit, Math.min(limit, offset)));
    return true;
  }, [beginPageDrag, writePageDrag]);

  /** Strip the live transform, handing the element back to React. */
  const clearPageDrag = useCallback(() => {
    if (pageDragSettleTimerRef.current !== null) {
      clearTimeout(pageDragSettleTimerRef.current);
      pageDragSettleTimerRef.current = null;
    }
    pageDragEnterPendingRef.current = false;
    pageDragAppliedRef.current = 0;
    const el = pageSurfaceRef.current;
    if (!el) return;
    el.style.transform = '';
    el.style.transition = '';
  }, []);

  /** Ease the page back to rest after a drag that did not turn it. */
  const settlePageDrag = useCallback(() => {
    if (pageDragModeRef.current === 'scroll') {
      const drag = scrollDragRef.current;
      pageDragModeRef.current = 'none';
      scrollDragRef.current = null;
      if (!drag) return;
      animateContainerScroll(drag.container, drag.startLeft, SWIPE_SETTLE_MS, () => {
        pageDragAppliedRef.current = 0;
      });
      return;
    }
    pageDragModeRef.current = 'none';
    const el = pageSurfaceRef.current;
    if (!el) { clearPageDrag(); return; }
    pageDragAppliedRef.current = 0;
    el.style.transition = `transform ${SWIPE_SETTLE_MS}ms ease-out`;
    el.style.transform = 'translateX(0px)';
    if (pageDragSettleTimerRef.current !== null) clearTimeout(pageDragSettleTimerRef.current);
    // Hand the element back to React only once it is at rest — stripping the
    // inline styles any earlier would cut the animation short.
    pageDragSettleTimerRef.current = window.setTimeout(() => {
      pageDragSettleTimerRef.current = null;
      const current = pageSurfaceRef.current;
      if (!current) return;
      current.style.transform = '';
      current.style.transition = '';
    }, SWIPE_SETTLE_MS);
  }, [animateContainerScroll, clearPageDrag]);

  const clearPageDragTimers = useCallback(() => {
    if (scrollDragRafRef.current !== null) {
      cancelAnimationFrame(scrollDragRafRef.current);
      scrollDragRafRef.current = null;
    }
    for (const ref of [pageDragSettleTimerRef, pageDragExitTimerRef, pageDragEnterTimerRef, pageDragTurnTimeoutRef]) {
      if (ref.current !== null) {
        clearTimeout(ref.current);
        ref.current = null;
      }
    }
  }, []);

  /**
   * Reveal the page once the rendition has painted the content a released
   * drag turned to, sliding it in from the edge the old page left towards.
   * Driven from the rendition's own relocated hook, so the page is only
   * un-parked when there is something new to show.
   */
  const enterPageAfterDragTurn = useCallback(() => {
    if (!pageDragEnterPendingRef.current) return;
    pageDragEnterPendingRef.current = false;
    if (pageDragTurnTimeoutRef.current !== null) {
      clearTimeout(pageDragTurnTimeoutRef.current);
      pageDragTurnTimeoutRef.current = null;
    }
    const el = pageSurfaceRef.current;
    if (!el) return;

    // The outgoing page left towards one edge, so the new one comes from the
    // other: start it there with no transition, then animate it home.
    const from = -pageDragAppliedRef.current;
    el.style.transition = 'none';
    el.style.transform = `translateX(${from}px)`;
    pageDragAppliedRef.current = from;

    requestAnimationFrame(() => {
      const sliding = pageSurfaceRef.current;
      if (!sliding) return;
      sliding.style.transition = `transform ${PAGE_DRAG_ENTER_MS}ms ease-out`;
      sliding.style.transform = 'translateX(0px)';
      pageDragAppliedRef.current = 0;
      pageDragEnterTimerRef.current = window.setTimeout(() => {
        pageDragEnterTimerRef.current = null;
        const done = pageSurfaceRef.current;
        if (!done) return;
        done.style.transform = '';
        done.style.transition = '';
      }, PAGE_DRAG_ENTER_MS);
    });
  }, []);

  const enterPageAfterDragTurnRef = useRef(enterPageAfterDragTurn);
  enterPageAfterDragTurnRef.current = enterPageAfterDragTurn;

  /**
   * Release a drag that turns the page: carry the page the rest of the way
   * off from wherever the finger left it, then swap the content and slide the
   * new page in behind it.
   *
   * This runs its own animation and uses the *instant* page turn rather than
   * animatePageTurn. That animation slides from a fixed -25%, so React would
   * write that transform over the live one and haul the page backwards to
   * reach it — and because React applies style properties in key order it
   * writes the transform before the transition, making even that jump cut
   * rather than animate.
   */
  const releasePageDragWithTurn = useCallback((direction: 1 | -1) => {
    if (pageDragModeRef.current === 'scroll') {
      const drag = scrollDragRef.current;
      pageDragModeRef.current = 'none';
      scrollDragRef.current = null;
      if (!drag) return;

      // Is the page being turned to inside this chapter's own columns?
      const hasNeighbour = direction === 1
        ? drag.startLeft + drag.delta <= drag.maxLeft + 1
        : drag.startLeft >= drag.delta - 1;

      if (!hasNeighbour) {
        // Next chapter: not in the container, so epubjs has to load it. The
        // drag could not have moved in this direction, so there is nothing to
        // unwind first.
        pageDragAppliedRef.current = 0;
        (direction === 1 ? nextPageRef.current : prevPageRef.current)();
        return;
      }

      // Claim the coming relocation as user navigation, or the anchor-restore
      // watchdog treats it as drift and pulls the reader back a page.
      markUserNavigationRef.current();

      const target = drag.startLeft + direction * drag.delta;
      const remaining = Math.abs(target - drag.container.scrollLeft);
      const scrollMs = Math.max(
        PAGE_DRAG_EXIT_MIN_MS,
        Math.round(PAGE_DRAG_EXIT_MS * Math.min(1, remaining / Math.max(drag.delta, 1))),
      );
      animateContainerScroll(drag.container, target, scrollMs, () => {
        pageDragAppliedRef.current = 0;
      });
      return;
    }

    pageDragModeRef.current = 'none';
    const el = pageSurfaceRef.current;
    const canTurn = direction === 1 ? canGoNextRef.current : canGoPrevRef.current;
    const turn = direction === 1 ? nextPageInstantRef.current : prevPageInstantRef.current;

    // Nothing to turn to, or no surface to animate: just rest the page.
    if (!el || !canTurn || einkModeRef.current) {
      if (canTurn) turn();
      settlePageDrag();
      return;
    }

    clearPageDragTimers();

    const width = el.clientWidth || window.innerWidth;
    const exitTo = direction === 1 ? -width : width;
    // Time the exit to the distance still to cover, so a page already dragged
    // most of the way off finishes at once instead of crawling the last few
    // pixels for as long as a full-width slide.
    const remaining = Math.abs(exitTo - pageDragAppliedRef.current);
    const exitMs = Math.max(
      PAGE_DRAG_EXIT_MIN_MS,
      Math.round(PAGE_DRAG_EXIT_MS * Math.min(1, remaining / Math.max(width, 1))),
    );

    el.style.transition = `transform ${exitMs}ms ease-out`;
    el.style.transform = `translateX(${exitTo}px)`;
    pageDragAppliedRef.current = exitTo;

    pageDragExitTimerRef.current = window.setTimeout(() => {
      pageDragExitTimerRef.current = null;
      // Hold the page off-screen across the swap so the outgoing content
      // never flashes back through the middle.
      pageDragEnterPendingRef.current = true;
      turn();
      pageDragTurnTimeoutRef.current = window.setTimeout(() => {
        pageDragTurnTimeoutRef.current = null;
        if (!pageDragEnterPendingRef.current) return;
        pageDragEnterPendingRef.current = false;
        settlePageDrag();
      }, PAGE_DRAG_TURN_TIMEOUT_MS);
    }, exitMs);
  }, [animateContainerScroll, clearPageDragTimers, settlePageDrag]);

  useEffect(() => () => {
    if (scrollDragRafRef.current !== null) cancelAnimationFrame(scrollDragRafRef.current);
    for (const ref of [pageDragSettleTimerRef, pageDragExitTimerRef, pageDragEnterTimerRef, pageDragTurnTimeoutRef]) {
      if (ref.current !== null) clearTimeout(ref.current);
    }
  }, []);

  const setPageDragRef = useRef(setPageDrag);
  setPageDragRef.current = setPageDrag;
  const releasePageDragWithTurnRef = useRef(releasePageDragWithTurn);
  releasePageDragWithTurnRef.current = releasePageDragWithTurn;
  const settlePageDragRef = useRef(settlePageDrag);
  settlePageDragRef.current = settlePageDrag;

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
        const remoteProgress = await remoteProgressPromise;
        const bestProgress = chooseInitialProgress(localProg, remoteProgress);
        const initialCfi = bestProgress?.cfi || '';
        const initialPercentage = bestProgress?.percentage || 0;
        const initialChapter = bestProgress?.chapter || '';

        lastKnownCfiRef.current = initialCfi;
        progressPercentageRef.current = initialPercentage;
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
          // Side margin is implemented as the column gap: epubjs pads every
          // page by gap/2 on both sides (body padding can't do per-page margins).
          gap: getEpubColumnGap(typography),
        } as any);
        renditionRef.current = rendition;

        // Apply theme & typography
        applyThemeAndTypography(rendition, readerTheme, typography);

        // Display at saved CFI or start
        if (initialCfi) {
          rendition.display(initialCfi).catch(() => {
            // Saved CFI is unusable — drop it as the anchor so the first
            // relocation from the fallback display becomes the new anchor.
            lastKnownCfiRef.current = '';
            return rendition.display();
          });
        } else {
          rendition.display();
        }

        // Track location changes
        rendition.on('relocated', (location: any) => {
          if (cancelled) return;
          setIsLoading(false);

          // Run the enter-phase fade-in only after the new page has been painted,
          // mirroring the PDFViewer pattern. Without this the page stays parked at
          // `enter-right`/`enter-left` (opacity 0), leaving the reader blank after
          // each animated page turn.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              triggerPageEnterRef.current();
              // A released drag parks the page off-screen until this point,
              // then slides the freshly painted page in.
              enterPageAfterDragTurnRef.current();
            });
          });

          const isUserNavigation = isUserNavigationPending();
          if (isUserNavigation) userNavAtRef.current = 0;

          // A user page turn that lands while a layout restore is scheduled or
          // in flight wins over the restore — otherwise the turn is dropped and
          // the pending restore jumps back to the old anchor.
          if (isUserNavigation && restoreGuardRef.current.phase !== 'idle') {
            if (restoreFrameRef.current != null) {
              cancelAnimationFrame(restoreFrameRef.current);
              restoreFrameRef.current = null;
            }
            clearRestoreGuard();
          }

          const restoreGuard = restoreGuardRef.current;
          const shouldSkipProgressPersistence = restoreGuard.phase !== 'idle';
          const visibleStartCfi = location?.start?.cfi || '';
          if (
            !shouldSkipProgressPersistence
            && visibleStartCfi
            && (isUserNavigation || !lastKnownCfiRef.current)
          ) {
            lastKnownCfiRef.current = visibleStartCfi;
          }

          const effectiveCfi = lastKnownCfiRef.current || visibleStartCfi;
          const pagePosition = getDerivedPagePosition(epub, effectiveCfi, locationsReadyRef.current);
          applyDerivedPagePosition(pagePosition);

          const pct = pagePosition.percentage;
          if (locationsReadyRef.current && pct != null) {
            progressPercentageRef.current = pct;
            setPercentage(pct);
            setMaxPercentage(prev => Math.max(prev, pct));
          }

          if (location.start?.displayed?.total) {
            const pagesLeftInChapter = location.start.displayed.total - location.start.displayed.page;
            const chapterWordsLeft = pagesLeftInChapter * WORDS_PER_LOCATION * 0.5;
            setMinutesLeftChapter(Math.ceil(chapterWordsLeft / WORDS_PER_MINUTE));
          } else {
            setMinutesLeftChapter(0);
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

          if (restoreGuard.phase === 'displaying') {
            clearRestoreGuard(restoreGuard.sequence);
          }

          // Layout-driven relocation (initial display, epubjs' own re-display
          // on window resize): make sure the anchor is actually on screen.
          if (!shouldSkipProgressPersistence && !isUserNavigation) {
            scheduleAnchorCheckRef.current();
          }

          // Persist the CFI immediately so reopen/sleep restore the exact spot
          // even before location generation finishes. Percentage sync still waits
          // for locations so we don't regress it to zero during startup.
          if (!shouldSkipProgressPersistence && effectiveCfi) {
            updateProgress(
              book.id,
              effectiveCfi,
              locationsReadyRef.current && pct != null ? pct : progressPercentageRef.current,
              resolvedChapter,
            );
          }

          // Server sync stays gated on locations because remote comparisons are
          // percentage-based and would be noisy until locations are generated.
          if (!shouldSkipProgressPersistence && locationsReadyRef.current) {
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
        // Accumulated in finger-travel units (negative = towards the next page),
        // so the touch and trackpad paths share the same commit thresholds.
        let sharedWheelAccX = 0;
        let sharedWheelStart = 0;
        let sharedWheelTimer: any = null;
        let sharedWheelCooldown = false;

        const resetSharedWheel = () => {
          sharedWheelAccX = 0;
          sharedWheelStart = 0;
        };

        /** (Re)arm the quiet period that stands in for a trackpad release. */
        const armSharedWheelEnd = (onEnd: () => void) => {
          if (sharedWheelTimer) clearTimeout(sharedWheelTimer);
          sharedWheelTimer = setTimeout(() => {
            sharedWheelTimer = null;
            onEnd();
          }, WHEEL_GESTURE_END_MS);
        };

        /**
         * Ignore the rest of this gesture. Re-armed on every event, so a
         * momentum tail is swallowed however long it runs — a fixed cooldown
         * gets outlasted and lets one flick turn a second page.
         */
        const holdSharedWheelUntilQuiet = () => {
          sharedWheelCooldown = true;
          resetSharedWheel();
          armSharedWheelEnd(() => {
            sharedWheelCooldown = false;
            resetSharedWheel();
          });
        };

        rendition.hooks.content.register((contents: Contents) => {
          const doc = (contents as any).document as Document;
          if (!doc) return;

          applyThemeAndTypographyToDocument(doc, readerThemeRef.current, typographyRef.current);

          // Late reflows (web fonts swapping in, images decoding) shift text
          // after epubjs has positioned the page. Re-check the anchor once they
          // settle. 'resize' comes from epubjs' ResizeObserver, 'expand' from
          // its image-load listener; fonts.ready covers same-size font swaps.
          const scheduleCheck = () => scheduleAnchorCheckRef.current();
          (contents as any).on?.('resize', scheduleCheck);
          (contents as any).on?.('expand', scheduleCheck);
          doc.fonts?.ready.then(scheduleCheck).catch(() => {});
          // In-book links navigate via epubjs' own handler; treat as user navigation.
          (contents as any).on?.('linkClicked', () => markUserNavigationRef.current());

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
          let dragFollowing = false;

          /**
           * Horizontal position of a touch, with the drag transform cancelled out.
           *
           * `clientX` is relative to the iframe viewport, which the drag
           * transform moves, so a motionless finger appears to slide back by
           * exactly the offset we just applied — feeding that straight back in
           * oscillated the page every frame. Adding the offset back returns a
           * position that does not depend on it. Both the gesture start and
           * every sample go through here, so a touch landing while the page is
           * still off-centre measures from the same frame as the rest.
           */
          const stableTouchX = (touch: Touch) => touch.clientX + pageDragAppliedRef.current;

          doc.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length === 1) {
              startX = stableTouchX(e.touches[0]);
              startY = e.touches[0].clientY;
              startTime = Date.now();
              touchMoved = false;
              dragFollowing = false;
              // Releases clear this themselves; resetting here keeps a gesture
              // that never got a touchend from handing stale scroll bounds to
              // the next one.
              pageDragModeRef.current = 'none';
            }
          }, { passive: true });

          // Prevent default on horizontal moves to stop Safari from
          // hijacking swipes for its own back/forward navigation
          doc.addEventListener('touchmove', (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const dx = stableTouchX(e.touches[0]) - startX;
            const dy = e.touches[0].clientY - startY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            if (absDx > 5 || absDy > 5) touchMoved = true;
            if (absDx > absDy && absDx > 10) {
              e.preventDefault();
              // The page follows the finger; nothing commits until release.
              if (setPageDragRef.current(dx)) dragFollowing = true;
            }
          }, { passive: false });

          doc.addEventListener('touchend', (e: TouchEvent) => {
            const touch = e.changedTouches[0];
            if (!touch) {
              // No touch to judge the gesture by, so don't leave the page held
              // off-centre waiting for a release that already happened.
              if (dragFollowing) {
                dragFollowing = false;
                settlePageDragRef.current();
              }
              return;
            }
            const dx = stableTouchX(touch) - startX;
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

            // Swipe detection. A drag the page actually followed is judged
            // without the duration cap — it was visibly tracked the whole way.
            const wasFollowing = dragFollowing;
            dragFollowing = false;
            const commit = isHorizontalSwipe(dx, dy) && (wasFollowing
              ? shouldCommitFollowSwipe(dx, dt)
              : shouldCommitSwipe(dx, dt));

            if (!commit) {
              if (wasFollowing) settlePageDragRef.current();
              return;
            }

            if (wasFollowing) {
              releasePageDragWithTurnRef.current(dx < 0 ? 1 : -1);
            } else if (dx < 0) {
              nextPageRef.current();
            } else {
              prevPageRef.current();
            }
          });

          // The OS taking over (e.g. a system edge gesture) is not a release,
          // so the page falls back rather than turning.
          doc.addEventListener('touchcancel', () => {
            if (!dragFollowing) return;
            dragFollowing = false;
            settlePageDragRef.current();
          });

          // Forward trackpad/mouse wheel events for gesture handling (page turns).
          // Uses shared state (sharedWheelAccX/Cooldown) so spread mode's two
          // iframes cannot each independently trigger a page turn on one gesture.
          doc.addEventListener('wheel', (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) return;
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 0.8 || Math.abs(e.deltaX) <= 2) return;
            e.preventDefault();

            // Still swallowing the tail of a gesture that already turned.
            if (sharedWheelCooldown) {
              holdSharedWheelUntilQuiet();
              return;
            }

            if (sharedWheelStart === 0) sharedWheelStart = performance.now();
            // deltaX is positive scrolling right, which advances the page.
            // Negate it so it reads as finger travel, like the touch path.
            sharedWheelAccX -= e.deltaX;

            // The accumulated-distance rule below is only for readers that
            // cannot show a live drag at all. Reaching it because a drag is
            // merely busy would let one gesture commit twice: once on release
            // and again the moment the accumulator crossed the threshold.
            if (!einkModeRef.current) {
              if (!setPageDragRef.current(sharedWheelAccX)) {
                // The previous turn is still playing out.
                holdSharedWheelUntilQuiet();
                return;
              }

              // A trackpad has no touch-end, so the page settles once events
              // stop arriving — that quiet period is the release.
              armSharedWheelEnd(() => {
                const dx = sharedWheelAccX;
                const duration = performance.now() - sharedWheelStart;
                resetSharedWheel();
                if (!shouldCommitFollowSwipe(dx, duration)) {
                  settlePageDragRef.current();
                  return;
                }
                releasePageDragWithTurnRef.current(dx < 0 ? 1 : -1);
                holdSharedWheelUntilQuiet();
              });
              return;
            }

            // E-ink: no live preview, so turn on accumulated distance instead.
            armSharedWheelEnd(resetSharedWheel);
            const threshold = 150;
            if (sharedWheelAccX < -threshold) {
              nextPageRef.current();
              holdSharedWheelUntilQuiet();
            } else if (sharedWheelAccX > threshold) {
              prevPageRef.current();
              holdSharedWheelUntilQuiet();
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

        // Generate locations for page numbers & percentages, but reuse a
        // persisted map when the same EPUB revision has already been indexed.
        epub.ready.then(async () => {
          let usedCachedLocations = false;
          const cachedLocations = await readCachedEpubLocations(book, EPUB_LOCATION_BREAK_CHARS);

          if (cachedLocations) {
            try {
              epub.locations.load(cachedLocations);
              usedCachedLocations = true;
            } catch {
              await deleteCachedEpubLocations(book.id);
            }
          }

          if (!usedCachedLocations) {
            await epub.locations.generate(EPUB_LOCATION_BREAK_CHARS);
            await writeCachedEpubLocations(book, EPUB_LOCATION_BREAK_CHARS, epub.locations.save());
          }

          if (cancelled) return;

          locationsReadyRef.current = true;
          setLocationsReady(true);

          const currentCfi = lastKnownCfiRef.current;
          const pagePosition = getDerivedPagePosition(epub, currentCfi, true);
          applyDerivedPagePosition(pagePosition);

          if (currentCfi && pagePosition.percentage != null) {
            progressPercentageRef.current = pagePosition.percentage;
            setPercentage(pagePosition.percentage);
            setMaxPercentage(prev => Math.max(prev, pagePosition.percentage ?? prev));
            updateProgress(book.id, currentCfi, pagePosition.percentage, chapterRef.current);
          } else if (!currentCfi) {
            setPageNumberMode('percent');
          }
        }).catch((error) => {
          if (cancelled) return;
          console.error('[epub] Failed to prepare locations:', error);
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
      if (anchorCheckTimerRef.current) clearTimeout(anchorCheckTimerRef.current);
      userNavAtRef.current = 0;
      if (restoreFrameRef.current != null) cancelAnimationFrame(restoreFrameRef.current);
      clearRestoreGuard();
      syncProgress(book.id).catch(() => {});
      void finishEinkWork(false);
      if (epubRef.current) epubRef.current.destroy();
      epubRef.current = null;
      renditionRef.current = null;
      locationsReadyRef.current = false;
      setLocationsReady(false);
      setPageNumberMode('percent');
      setPageRangeStartOverall(1);
      currentBookDataRef.current = null;
    };
  }, [applyDerivedPagePosition, book.id, finishEinkWork, startEinkWork]); // eslint-disable-line react-hooks/exhaustive-deps

  // === Update spread mode ===
  useEffect(() => {
    if (renditionRef.current) {
      startEinkWork('spread');
      // Second arg overrides minSpreadWidth so the 800 px guard is bypassed.
      (renditionRef.current as any).spread(isSpreadView ? 'always' : 'none', isSpreadView ? 1 : 800);
      queueRestoreToCfi(undefined, 'spread-change');
    }
  }, [isSpreadView, queueRestoreToCfi, startEinkWork]);

  // === Update theme/typography when settings change ===
  useEffect(() => {
    if (renditionRef.current) {
      startEinkWork('theme');
      const rendition = renditionRef.current;
      applyThemeAndTypography(rendition, readerTheme, typography);
      queueRestoreToCfi(undefined, 'theme-or-typography-change');
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
  const scrollCurrentTocItemIntoView = useCallback((el: HTMLButtonElement | null) => {
    el?.scrollIntoView({ block: 'center' });
  }, []);
  const goToTocItem = useCallback((href: string) => {
    startEinkWork('toc');
    markUserNavigation();
    renditionRef.current?.display(href);
    setShowToc(false);
  }, [markUserNavigation, startEinkWork]);

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
    if (!epubRef.current) return;

    const pagePosition = getDerivedPagePosition(epubRef.current, lastKnownCfiRef.current, locationsReadyRef.current);
    const pageList = (epubRef.current as any).pageList;
    const sourcePageCfi = pagePosition.mode === 'source' && pageList
      ? pageList.cfiFromPage(pos)
      : null;
    const locations = epubRef.current.locations as any;
    const cfi = typeof sourcePageCfi === 'string' && sourcePageCfi !== '-1'
      ? sourcePageCfi
      : (locationsReadyRef.current ? locations.cfiFromLocation(Math.max(0, pos - 1)) : null);

    if (cfi) {
      startEinkWork('seek');
      markUserNavigation();
      renditionRef.current?.display(cfi);
    }
  }, [markUserNavigation, startEinkWork]);

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

  // === Theme-aware background for the wrapper around the epub iframes ===
  const themeColors = useMemo(() => ({ bg: getEpubReaderTheme(readerTheme).bg }), [readerTheme]);

  // === Animation styles for the epub container ===
  const pageStyle = getPageStyle({
    scale: 1,
    panOffset: { x: 0, y: 0 },
    swipeOffset: gestures.swipeOffset,
  });
  // Popovers float just below the toolbar. Measure the toolbar instead of
  // estimating its height — the estimate drifted with safe-area insets.
  const popoverTop = headerHeight != null
    ? `${headerHeight + 8}px`
    : 'calc(max(env(safe-area-inset-top, 0px), 8px) + 60px)';

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
          ref={headerRef}
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

      {/* ─── TOC popover ─── */}
      {showToc && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowToc(false)} />
          <div
            className={cn(
              'absolute left-3 z-40 w-80 max-w-[calc(100vw-1.5rem)]',
              'rounded-2xl border border-[var(--color-border-default)]',
              'bg-[var(--color-surface-primary)]/95 backdrop-blur-xl shadow-2xl',
              'flex flex-col overflow-hidden origin-top-left animate-popover-in',
              'reader-overlay-surface',
            )}
            style={{ top: popoverTop, maxHeight: `calc(100dvh - ${popoverTop} - 1rem)` }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)] shrink-0">
              <div className="flex items-center gap-2">
                <List size={16} className="text-[var(--color-text-secondary)]" />
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Contents</h3>
              </div>
              <button
                onClick={() => setShowToc(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
                title="Close contents"
              >
                <X size={16} className="text-[var(--color-text-tertiary)]" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain p-1.5">
              {tocItems.length === 0 && (
                <p className="px-3 py-4 text-sm text-[var(--color-text-tertiary)]">No table of contents.</p>
              )}
              {tocItems.map((item, i) => {
                const isCurrent = !!chapter && item.label === chapter;
                return (
                  <button
                    key={i}
                    ref={isCurrent ? scrollCurrentTocItemIntoView : undefined}
                    onClick={() => goToTocItem(item.href)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm rounded-lg transition-colors',
                      isCurrent
                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-medium'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
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
            variant="popover"
            className="reader-overlay-surface"
            topOffset={popoverTop}
            leadingContent={(
              <ReaderColorSchemePicker
                value={readerTheme}
                onChange={handleColorSchemeChange}
                appIsDark={resolvedAppIsDark}
                einkMode={einkMode}
              />
            )}
            showReadingModeControl={false}
            alwaysShowColumns={true}
            maxPaginatedColumns={2}
            footerContent={(
              <div className="p-3 rounded-lg bg-[var(--color-surface-tertiary)]/55 border border-[var(--color-border-subtle)] text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
                <div className="font-medium text-[var(--color-text-secondary)]">Page Number Source</div>
                <div className="mt-1">{pageNumberModeLabel}</div>
                <div className="mt-1 opacity-75">{pageNumberModeDescription}</div>
              </div>
            )}
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
        <div ref={pageSurfaceRef} className="w-full h-full" style={pageStyle}>
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
          minPosition={totalPagesOverall > 0 ? pageRangeStartOverall : 1}
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

/**
 * Column gap for the configured side margin. In paginated mode epubjs pads
 * each page by gap/2 on both sides (inline, !important on body), so the gap
 * is the only thing that produces a per-page side margin. `undefined` lets
 * epubjs pick its automatic gap for the "Original" preset.
 */
function getEpubColumnGap(typo: TypographySettings): number | undefined {
  if (typo.preset === 'original') return undefined;
  return Math.max(0, Math.round(typo.margin)) * 2;
}

function applyEpubColumnGap(rendition: Rendition, typo: TypographySettings) {
  const gap = getEpubColumnGap(typo);
  const renditionAny = rendition as any;
  const manager = renditionAny.manager;
  if (renditionAny.settings) renditionAny.settings.gap = gap;
  if (!manager?.settings || manager.settings.gap === gap) return;

  manager.settings.gap = gap;
  // Re-lay out existing views; the caller restores the reading anchor after.
  if (manager.isRendered?.()) manager.updateLayout();
}

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

  // Apply line-height and text-align to content elements too, so they
  // override element-level styles from the epub's own CSS
  const contentStyle: Record<string, string> = {};
  if (lineHeight) contentStyle['line-height'] = `${lineHeight} !important`;
  if (textAlign) contentStyle['text-align'] = `${textAlign} !important`;

  const pStyle: Record<string, string> = {};
  if (!isOriginal) {
    pStyle['margin-bottom'] = `${typo.paragraphSpacing}em !important`;
  }

  const { bg, fg, link } = getEpubReaderTheme(theme);

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

  applyEpubColumnGap(rendition, typo);

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
  const verticalMargin = isOriginal ? 0 : typo.verticalMargin ?? 0;
  const paddingTop = getEpubVerticalPaddingCss(verticalMargin, 'top', EPUB_CONTENT_TOP_CLEARANCE_PX);
  const paddingBottom = getEpubVerticalPaddingCss(verticalMargin, 'bottom', EPUB_CONTENT_BOTTOM_CLEARANCE_PX);
  const paragraphSpacing = isOriginal ? undefined : `${typo.paragraphSpacing}em`;

  const { bg, fg, link } = getEpubReaderTheme(theme);

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
      padding-bottom: ${paddingBottom} !important;
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
