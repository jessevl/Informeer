/**
 * ArticleReader Component
 * Full article view with reading experience
 * Uses shared ArticleContent for the actual article rendering
 * Supports split-view with comments panel for HN and Reddit discussions
 * 
 * Mobile: Full-screen overlay with fixed header and back button
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn, stripHtml } from '@/lib/utils';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useIsMobile, useIsLandscapeOrientation } from '@frameer/hooks/useMobileDetection';
import type { Entry } from '@/types/api';
import { ArticleContent } from './ArticleContent';
import { CommentsPanel } from './CommentsPanel';
import { ArticleHeaderActions } from './ArticleHeaderActions';
import { useArticlePagination } from './useArticlePagination';
import { api } from '@/api/client';
import { useTTSStore, prepareTextForTTS } from '@/stores/tts';
import { hasCommentsAvailable } from '@/api/comments';
import { useArticleScrollProgress } from '@/hooks/useArticleScrollProgress';
import { useSettingsStore } from '@/stores/settings';
import { TypographyPanel } from '@/components/reader/TypographyPanel';
import { ReaderNavButtons } from '@/components/reader/ReaderNavButtons';
import { useReaderKeyboard } from '@/components/reader';
import { useReaderWakeHandlers, useAutoHideControls } from '@/components/reader/useEinkReaderLifecycle';
import { usePaginationWheel } from '@/components/reader/usePaginationWheel';
import { ARTICLE_FONT_OPTIONS, DEFAULT_ARTICLE_TYPOGRAPHY } from '@/lib/typography';
import { useResolvedIsDark } from '@/hooks/useResolvedIsDark';
import { einkPower } from '@/services/eink-power';
import { getTapZoneAction } from '@/components/reader/tap-zones';

const EINK_INTERACTION_SETTLE_MS = 180;
const PAGINATION_TOUCH_COMMIT_THRESHOLD_PX = 96;
const PAGINATION_FLICK_MIN_DISTANCE_PX = 60;
const PAGINATION_FLICK_MIN_VELOCITY = 0.5;
const PAGINATION_SWIPE_MAX_DURATION_MS = 600;
const PAGINATION_TAP_MAX_DISTANCE_PX = 10;
const EINK_PAGINATED_TOUCH_RECOVERY_MS = 700;
const PAGINATION_TAP_MAX_DURATION_MS = 250;
const PAGINATION_DIRECTION_LOCK_DISTANCE_PX = 8;
const SYNTHETIC_CLICK_SUPPRESS_MS = 350;

interface ArticleReaderProps {
  entry: Entry;
  onClose: () => void;
  onToggleBookmark: (entryId: number) => void;
  onMarkAsRead: (entryId: number) => void;
  onMarkAsUnread: (entryId: number) => void;
  onPreviousEntry?: () => void;
  onNextEntry?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  fullscreen?: boolean;
  modal?: boolean;
}

// In-memory cache of scroll positions per article is now in useArticleScrollProgress hook

export function ArticleReader({
  entry,
  onClose,
  onToggleBookmark,
  onMarkAsRead,
  onMarkAsUnread,
  onPreviousEntry,
  onNextEntry,
  hasPrevious = false,
  hasNext = false,
  fullscreen = false,
  modal = false,
}: ArticleReaderProps) {
  const isUnread = entry.status === 'unread';
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscapeOrientation();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const einkMode = useSettingsStore((s) => s.einkMode);
  const articleTypography = useSettingsStore((s) => s.articleTypography);
  const setArticleTypography = useSettingsStore((s) => s.setArticleTypography);
  const readerToolbarHideDelay = useSettingsStore((s) => s.readerToolbarHideDelay);
  const isPaginated = articleTypography.readingMode === 'paginated';
  // Paginated mode needs full-viewport width for accurate column measurement and
  // layout, so always use the overlay (fixed inset-0) path regardless of device
  // type or eink mode.  Non-paginated scroll mode respects the normal heuristic.
  const isOverlayReaderLayout = isMobile || fullscreen || isPaginated;
  const isDarkMode = useResolvedIsDark();
  const entryWorkPrefix = `article:${entry.id}`;
  
  // Per-feed content fetch policy (replaces global autoReaderView)
  const feedPolicy = entry.feed?.content_fetch_policy || 'rss_only';
  
  // Reader view state
  const [isReaderView, setIsReaderView] = useState(false);
  const [readerContent, setReaderContent] = useState<string | null>(null);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showTypography, setShowTypography] = useState(false);

  // Auto-hide the prev/next entry navigation buttons after inactivity
  // (useAutoHideControls call is below, after showComments is declared)
  const [showNavButtons, setShowNavButtons] = useState(() => !useSettingsStore.getState().einkMode);

  const startEinkWork = useCallback((reason: string) => {
    const tag = `${entryWorkPrefix}:${reason}:${Date.now()}`;
    einkPower.beginCriticalWork(tag);
    return tag;
  }, [entryWorkPrefix]);

  const finishEinkWork = useCallback((tag: string | null) => {
    if (!tag) return;
    einkPower.endCriticalWork(tag);
  }, []);
  
  // Comments panel state - auto-open on desktop only (mobile requires manual open)
  const hasComments = hasCommentsAvailable(entry);
  const [showComments, setShowComments] = useState(!isOverlayReaderLayout && hasComments);

  // Auto-hide the prev/next entry navigation buttons after inactivity.
  // Suppressed while panels are open so buttons don't vanish mid-interaction.
  useAutoHideControls(showNavButtons, setShowNavButtons, !isPaginated || showTypography || showComments, readerToolbarHideDelay * 1000);

  useEffect(() => {
    setShowNavButtons(!(useSettingsStore.getState().einkMode && isPaginated));
  }, [entry.id, isPaginated]);
  
  // Update showComments when entry changes (keep closed on mobile)
  useEffect(() => {
    setShowComments(!isOverlayReaderLayout && hasCommentsAvailable(entry));
  }, [entry.id, isOverlayReaderLayout]);

  useEffect(() => {
    setShowTypography(false);
  }, [entry.id]);
  
  // Reset reader view when entry changes
  const [prevEntryId, setPrevEntryId] = useState(entry.id);
  if (entry.id !== prevEntryId) {
    setPrevEntryId(entry.id);
    setIsReaderView(false);
    setReaderContent(null);
    setIsLoadingReader(false);
  }
  
  // Auto-fetch based on per-feed content_fetch_policy:
  //  - 'always': content was pre-fetched during sync, already full in entry.content → no fetch needed
  //  - 'on_demand': fetch full article when the user opens it
  //  - 'rss_only': show RSS content as-is, manual toggle still available
  // Fallback: if content is too short (< 100 chars) and policy isn't rss_only, fetch anyway
  //
  // Never crawl non-RSS sources (NRC, MagazineLib) or media entries (YouTube, podcasts, videos).
  const feedSourceType = entry.feed?.source_type || 'rss';
  const isYouTube = /youtube\.com|youtu\.be/.test(entry.url);
  const isAudio = !!entry.enclosures?.some(e => e.mime_type?.startsWith('audio/'));
  const isVideo = !!entry.enclosures?.some(e => e.mime_type?.startsWith('video/'));
  const canUseReaderView = feedSourceType === 'rss' && !isYouTube && !isAudio && !isVideo;
  const [autoFetched, setAutoFetched] = useState<number | null>(null);
  const isContentTooShort = stripHtml(entry.content || '').trim().length < 100;
  const shouldAutoFetch = canUseReaderView && (feedPolicy === 'on_demand' || (isContentTooShort && feedPolicy !== 'rss_only'));

  useEffect(() => {
    if (!shouldAutoFetch || entry.id === autoFetched || readerContent || isLoadingReader) return;

    let cancelled = false;
    const workTag = startEinkWork('auto-fetch');

    setAutoFetched(entry.id);
    setIsLoadingReader(true);
    setFetchError(null);

    api.fetchOriginalContent(entry.id)
      .then((fullEntry) => {
        if (cancelled) return;
        setReaderContent(fullEntry.content);
        setIsReaderView(true);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to fetch reader view:', error);
          setFetchError('Could not load full article content');
        }
      })
      .finally(() => {
        finishEinkWork(workTag);
        if (!cancelled) {
          setIsLoadingReader(false);
        }
      });

    return () => {
      cancelled = true;
      finishEinkWork(workTag);
    };
  }, [shouldAutoFetch, entry.id, autoFetched, readerContent, isLoadingReader, startEinkWork, finishEinkWork]);
  
  // Toggle reader view.
  // – Not in reader view, no cached content → fetch fresh
  // – Not in reader view, cached content → show cached
  // – Already in reader view → force re-fetch from server (runs extraction again)
  //   This lets users manually refresh stale or poorly-extracted content.
  const handleToggleReaderView = useCallback(async () => {
    if (isLoadingReader) return;

    if (isReaderView) {
      // Re-fetch with force=true to re-run readability / extraction pipeline
      const workTag = startEinkWork('reader-view-refresh');
      setIsLoadingReader(true);
      setFetchError(null);
      try {
        const fullEntry = await api.fetchOriginalContent(entry.id, true);
        setReaderContent(fullEntry.content);
        // Stay in reader view – just update the content
      } catch (e) {
        console.error('Failed to refresh reader view:', e);
        setFetchError('Could not refresh article content');
      } finally {
        finishEinkWork(workTag);
        setIsLoadingReader(false);
      }
      return;
    }

    if (readerContent) { setIsReaderView(true); return; }

    const workTag = startEinkWork('reader-view-fetch');
    setIsLoadingReader(true);
    setFetchError(null);
    try {
      const fullEntry = await api.fetchOriginalContent(entry.id);
      setReaderContent(fullEntry.content);
      setIsReaderView(true);
    } catch (e) {
      console.error('Failed to fetch reader view:', e);
      setFetchError('Could not load full article content');
    }
    finally {
      finishEinkWork(workTag);
      setIsLoadingReader(false);
    }
  }, [isLoadingReader, isReaderView, readerContent, entry.id, startEinkWork, finishEinkWork]);

  const handleRetryFetch = useCallback(async () => {
    if (isLoadingReader) return;
    setFetchError(null);
    const workTag = startEinkWork('reader-view-retry');
    setIsLoadingReader(true);
    try {
      const fullEntry = await api.fetchOriginalContent(entry.id);
      setReaderContent(fullEntry.content);
      setIsReaderView(true);
    } catch (e) {
      console.error('Failed to fetch reader view:', e);
      setFetchError('Could not load full article content');
    } finally {
      finishEinkWork(workTag);
      setIsLoadingReader(false);
    }
  }, [isLoadingReader, entry.id, startEinkWork, finishEinkWork]);

  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: entry.title, url: entry.url }); } catch {}
    } else {
      await navigator.clipboard.writeText(entry.url);
    }
  };

  // TTS handler
  const handleListenToArticle = useCallback(() => {
    const { modelStatus, initModel, generate, currentEntry: ttsEntry, isPlaying: ttsPlaying, setPlaying, generationStatus } = useTTSStore.getState();
    
    if (ttsEntry?.id === entry.id) {
      // Toggle playback for current article
      if (ttsPlaying) {
        setPlaying(false);
      } else if (generationStatus === 'done' || generationStatus === 'generating') {
        setPlaying(true);
      } else {
        const text = prepareTextForTTS(entry.content || '');
        if (text.length > 0) {
          if (modelStatus === 'idle') initModel();
          generate(text, entry);
        }
      }
    } else {
      const text = prepareTextForTTS(entry.content || '');
      if (text.length > 0) {
        if (modelStatus === 'idle') initModel();
        generate(text, entry);
      }
    }
  }, [entry]);

  const ttsState = useTTSStore();
  const isTTSCurrentArticle = ttsState.currentEntry?.id === entry.id;
  const isTTSPlaying = isTTSCurrentArticle && ttsState.isPlaying;
  const isEinkSurfaceEligible = !isLoadingReader && !showTypography;

  useEffect(() => {
    einkPower.setSurface({
      mode: 'article-reader',
      eligible: isEinkSurfaceEligible,
      reason: isLoadingReader
        ? 'article-loading'
        : showTypography
          ? 'article-typography-visible'
          : undefined,
      gestureModel: isPaginated ? 'paginated' : 'scroll',
    });

    return () => {
      // Only reset if we're still the registered surface — avoids a race where
      // the feed list (or next article) has already taken over before this cleanup runs.
      if (einkPower.getSurfaceMode() === 'article-reader') {
        einkPower.setSurface({
          mode: 'none',
          eligible: false,
          reason: 'article-reader-closed',
          gestureModel: 'none',
        });
      }
    };
  }, [isEinkSurfaceEligible, isLoadingReader, showTypography, isPaginated]);

  // Common button class for header (shared between mobile and desktop)
  const btnClass = "flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 transition-colors";

  // ─── Swipe-down-to-close (mobile) ────────────────────────────────
  const { scrollRef, progressRef } = useArticleScrollProgress(entry.id, isPaginated ? 'horizontal' : 'vertical');
  const [pullDismiss, setPullDismiss] = useState(0); // 0..1 progress
  const pullRef = useRef({ startY: 0, active: false, pulling: false });
  const paginatedTouchRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    active: false,
    handled: false,
    axisLocked: null as 'horizontal' | 'vertical' | null,
  });
  const suppressSyntheticClickUntilRef = useRef(0);

  // ─── Pagination ─────────────────────────────────────────────────
  const {
    pageNavState,
    canUseTwoColumnLayout,
    effectiveColumnCount,
    cancelPaginatedReady,
    handlePrevPage,
    handleNextPage,
    paginatedArticleStyle,
    schedulePaginatedReady,
    trailingBlankColumns,
  } = useArticlePagination({
    entryId: entry.id,
    isPaginated,
    einkMode,
    scrollRef,
    columnCount: articleTypography.columnCount,
    startEinkWork,
    finishEinkWork,
    measureDeps: [isLoadingReader, isReaderView, readerContent, showComments, showTypography, modal, isOverlayReaderLayout, isLandscape],
  });

  usePaginationWheel(scrollRef, handleNextPage, handlePrevPage, isPaginated);
  useReaderWakeHandlers(handleNextPage, handlePrevPage, isPaginated);

  useReaderKeyboard({
    nextPage: () => { if (isPaginated) handleNextPage(); },
    prevPage: () => { if (isPaginated) handlePrevPage(); },
    onClose,
  });

  useEffect(() => {
    if (!isEinkSurfaceEligible) return;

    const surfaceEl = surfaceRef.current;
    if (!surfaceEl) return;

    let cancelled = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let readyToken = 0;

    const cancelReady = () => {
      readyToken += 1;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
    };

    const scheduleReady = () => {
      cancelReady();
      const token = ++readyToken;
      readyTimer = setTimeout(() => {
        readyTimer = null;
        void (async () => {
          await einkPower.waitForPaintCommit();
          if (cancelled || token !== readyToken) return;
          await einkPower.markVisualStable();
          if (cancelled || token !== readyToken) return;
          await einkPower.notifyInteractiveReady();
        })();
      }, EINK_INTERACTION_SETTLE_MS);
    };

    if (isPaginated) {
      // Paginated mode: no interaction work tags here — the page-turn lifecycle
      // (scrollByPage / schedulePaginatedReady) owns its own critical work.
      // This effect only signals readiness:
      //  - On mount / surface becoming eligible (initial hibernation)
      //  - On pointerup/touchend after wake with no page turn
      // Touching the screen cancels the pending ready; releasing re-arms it.
      let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

      const clearRecovery = () => {
        if (recoveryTimer) {
          clearTimeout(recoveryTimer);
          recoveryTimer = null;
        }
      };

      const armRecovery = () => {
        clearRecovery();
        recoveryTimer = setTimeout(() => {
          recoveryTimer = null;
          schedulePaginatedReady(EINK_INTERACTION_SETTLE_MS);
        }, EINK_PAGINATED_TOUCH_RECOVERY_MS);
      };

      const handleTouchHold = () => {
        cancelPaginatedReady();
        armRecovery();
      };

      const handleTouchRelease = () => {
        clearRecovery();
        schedulePaginatedReady(EINK_INTERACTION_SETTLE_MS);
      };

      surfaceEl.addEventListener('pointerdown', handleTouchHold, true);
      surfaceEl.addEventListener('touchstart', handleTouchHold, true);
      surfaceEl.addEventListener('pointerup', handleTouchRelease, true);
      surfaceEl.addEventListener('touchend', handleTouchRelease, true);
      surfaceEl.addEventListener('touchcancel', handleTouchRelease, true);

      schedulePaginatedReady(EINK_INTERACTION_SETTLE_MS);

      return () => {
        cancelled = true;
        clearRecovery();
        cancelPaginatedReady();
        surfaceEl.removeEventListener('pointerdown', handleTouchHold, true);
        surfaceEl.removeEventListener('touchstart', handleTouchHold, true);
        surfaceEl.removeEventListener('pointerup', handleTouchRelease, true);
        surfaceEl.removeEventListener('touchend', handleTouchRelease, true);
        surfaceEl.removeEventListener('touchcancel', handleTouchRelease, true);
      };
    }

    // Scroll mode: uses interaction work tags to prevent hibernation while
    // actively scrolling, re-arms the settle timer on scroll/wheel activity.
    let interactionWorkActive = false;
    const interactionWorkTag = `${entryWorkPrefix}:interaction`;

    const beginInteractionWork = () => {
      if (interactionWorkActive) return;
      interactionWorkActive = true;
      einkPower.beginCriticalWork(interactionWorkTag);
    };

    const endInteractionWork = () => {
      if (!interactionWorkActive) return;
      interactionWorkActive = false;
      einkPower.endCriticalWork(interactionWorkTag);
    };

    const scheduleScrollReady = () => {
      cancelReady();
      const token = ++readyToken;
      readyTimer = setTimeout(() => {
        readyTimer = null;
        void (async () => {
          await einkPower.waitForPaintCommit();
          if (cancelled || token !== readyToken) return;
          endInteractionWork();
          await einkPower.markVisualStable();
          if (cancelled || token !== readyToken) return;
          await einkPower.notifyInteractiveReady();
        })();
      }, EINK_INTERACTION_SETTLE_MS);
    };

    const handleInteractionStart = () => {
      beginInteractionWork();
      cancelReady();
    };

    const handleInteractionSettle = () => {
      scheduleScrollReady();
    };

    const handleInteractionProgress = () => {
      beginInteractionWork();
      scheduleScrollReady();
    };

    surfaceEl.addEventListener('pointerdown', handleInteractionStart, true);
    surfaceEl.addEventListener('touchstart', handleInteractionStart, true);
    surfaceEl.addEventListener('pointerup', handleInteractionSettle, true);
    surfaceEl.addEventListener('touchend', handleInteractionSettle, true);
    surfaceEl.addEventListener('touchcancel', handleInteractionSettle, true);
    surfaceEl.addEventListener('wheel', handleInteractionProgress, true);
    surfaceEl.addEventListener('scroll', handleInteractionProgress, true);

    scheduleScrollReady();

    return () => {
      cancelled = true;
      cancelReady();
      endInteractionWork();
      surfaceEl.removeEventListener('pointerdown', handleInteractionStart, true);
      surfaceEl.removeEventListener('touchstart', handleInteractionStart, true);
      surfaceEl.removeEventListener('pointerup', handleInteractionSettle, true);
      surfaceEl.removeEventListener('touchend', handleInteractionSettle, true);
      surfaceEl.removeEventListener('touchcancel', handleInteractionSettle, true);
      surfaceEl.removeEventListener('wheel', handleInteractionProgress, true);
      surfaceEl.removeEventListener('scroll', handleInteractionProgress, true);
    };
  }, [cancelPaginatedReady, entry.id, isPaginated, isReaderView, readerContent, schedulePaginatedReady, showComments, isEinkSurfaceEligible]);

  // Focus the reader on mount for keyboard navigation
  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
  }, [scrollRef]);

  const shouldIgnorePaginatedTap = useCallback((target: EventTarget | null) => {
    const element = target instanceof HTMLElement ? target : null;
    return Boolean(element?.closest('a, button, input, textarea, select, summary, details, [role="button"], [data-ignore-reader-tap]'));
  }, []);

  const handlePaginatedTap = useCallback((clientX: number, currentTarget: HTMLElement, target: EventTarget | null) => {
    if (!isPaginated || shouldIgnorePaginatedTap(target)) return false;
    if (window.getSelection?.()?.toString()) return false;

    const rect = currentTarget.getBoundingClientRect();
    const action = getTapZoneAction(clientX, rect);

    if (action === 'prev') { handlePrevPage(); return true; }
    if (action === 'next') { handleNextPage(); return true; }
    if (action === 'toggle') { setShowNavButtons(prev => !prev); return true; }
    return false;
  }, [handleNextPage, handlePrevPage, isPaginated, setShowNavButtons, shouldIgnorePaginatedTap]);

  const compactVisibleActionIds = ['bookmark', 'reader-view', 'typography', 'comments'] as const;
  const compactOverflowActionIds = ['listen', 'read-status', 'share', 'open-original'] as const;

  const handleArticleTouchStart = useCallback((e: React.TouchEvent<HTMLElement>) => {
    if (isPaginated) {
      const touch = e.touches[0];
      if (!touch) return;

      paginatedTouchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        active: true,
        handled: false,
        axisLocked: null,
      };
      return;
    }

    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    pullRef.current = { startY: e.touches[0].clientY, active: true, pulling: false };
  }, [isPaginated, scrollRef]);

  const handleArticleTouchMove = useCallback((e: React.TouchEvent<HTMLElement>) => {
    if (isPaginated) {
      const touchState = paginatedTouchRef.current;
      if (!touchState.active || touchState.handled) return;

      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - touchState.startX;
      const dy = touch.clientY - touchState.startY;

      if (touchState.axisLocked === null) {
        if (Math.abs(dx) < PAGINATION_DIRECTION_LOCK_DISTANCE_PX && Math.abs(dy) < PAGINATION_DIRECTION_LOCK_DISTANCE_PX) {
          return;
        }

        touchState.axisLocked = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical';
      }

      if (touchState.axisLocked !== 'horizontal') return;

      e.preventDefault();

      if (Math.abs(dx) < PAGINATION_TOUCH_COMMIT_THRESHOLD_PX) {
        return;
      }

      touchState.handled = true;
      touchState.active = false;
      suppressSyntheticClickUntilRef.current = Date.now() + SYNTHETIC_CLICK_SUPPRESS_MS;

      if (dx < 0) {
        handleNextPage();
      } else {
        handlePrevPage();
      }
      return;
    }

    const p = pullRef.current;
    if (!p.active) return;
    const el = scrollRef.current;
    if (!el) return;

    const dy = e.touches[0].clientY - p.startY;

    // Only start pulling after a clear downward movement while at scroll top
    if (!p.pulling) {
      if (dy > 10 && el.scrollTop <= 0) {
        p.pulling = true;
      } else {
        return;
      }
    }

    if (dy > 0 && el.scrollTop <= 0) {
      const distance = Math.min(dy, 200);
      setPullDismiss(distance / 150); // 150px = full threshold
    }
  }, [handleNextPage, handlePrevPage, isPaginated, scrollRef]);

  const handleArticleTouchEnd = useCallback((e: React.TouchEvent<HTMLElement>) => {
    if (isPaginated) {
      const touchState = paginatedTouchRef.current;
      if (!touchState.active && !touchState.handled) return;

      const wasHandled = touchState.handled;

      touchState.active = false;
      touchState.handled = false;
      touchState.axisLocked = null;

      if (wasHandled) {
        return;
      }

      const touch = e.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - touchState.startX;
      const dy = touch.clientY - touchState.startY;
      const duration = Date.now() - touchState.startTime;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const isHorizontal = absDx > absDy * 1.5;
      const velocity = absDx / Math.max(duration, 1);
      const isFlick = velocity > PAGINATION_FLICK_MIN_VELOCITY && absDx > PAGINATION_FLICK_MIN_DISTANCE_PX;
      const isDrag = absDx > PAGINATION_TOUCH_COMMIT_THRESHOLD_PX && duration < PAGINATION_SWIPE_MAX_DURATION_MS;

      if (isHorizontal && (isFlick || isDrag)) {
        suppressSyntheticClickUntilRef.current = Date.now() + SYNTHETIC_CLICK_SUPPRESS_MS;
        if (dx < 0) {
          handleNextPage();
        } else {
          handlePrevPage();
        }
        return;
      }

      if (
        absDx <= PAGINATION_TAP_MAX_DISTANCE_PX
        && absDy <= PAGINATION_TAP_MAX_DISTANCE_PX
        && duration <= PAGINATION_TAP_MAX_DURATION_MS
      ) {
        const handled = handlePaginatedTap(touch.clientX, e.currentTarget, e.target);
        if (handled) {
          suppressSyntheticClickUntilRef.current = Date.now() + SYNTHETIC_CLICK_SUPPRESS_MS;
        }
      }

      return;
    }

    const p = pullRef.current;
    p.active = false;
    p.pulling = false;
    if (pullDismiss >= 1) {
      onClose();
    }
    setPullDismiss(0);
}, [handleNextPage, handlePaginatedTap, handlePrevPage, isPaginated, onClose, pullDismiss]);

  const handleArticleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isPaginated) return;

    if (Date.now() < suppressSyntheticClickUntilRef.current) {
      e.preventDefault();
      suppressSyntheticClickUntilRef.current = 0;
      return;
    }

    if (handlePaginatedTap(e.clientX, e.currentTarget, e.target)) {
      e.preventDefault();
    }
  }, [handlePaginatedTap, isPaginated]);

  // =========================================================================
  // MOBILE LAYOUT
  // =========================================================================
  if (isOverlayReaderLayout) {
    const pullOffset = Math.min(pullDismiss * 100, 100);
    const pullScale = 1 - Math.min(pullDismiss, 1) * 0.02;
    const pullOpacity = 1 - Math.min(pullDismiss, 1) * 0.08;

    return (
      <div
        ref={surfaceRef}
        className={cn(
          'fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-[var(--color-background)]',
          !einkMode && 'animate-slide-in-right'
        )}
        style={pullDismiss > 0 ? {
          transform: `translateY(${pullOffset}px) scale(${pullScale})`,
          opacity: pullOpacity,
          borderRadius: '12px',
          transition: 'none',
          overflow: 'hidden',
        } : undefined}
      >
        {/* Reader scroll progress bar */}
        <div className="absolute top-0 left-0 right-0 z-[70] h-0.5 pointer-events-none">
          <div 
            ref={progressRef}
            className="h-full bg-[var(--color-accent-fg)] transition-[width] duration-150"
            style={{ width: '0%' }}
          />
        </div>
        
        {/* Mobile Floating Header - glass panels like desktop */}
        <div className={cn(
          "absolute top-0 left-0 right-0 z-50 h-0 overflow-visible pointer-events-none",
          "pt-[env(safe-area-inset-top)]"
        )}>
          <div className="flex items-center gap-2 px-3 py-3 pointer-events-auto">
            {/* LEFT: Back button */}
            <div className="glass-panel-nav flex items-center px-1 py-1">
              <button
                onClick={onClose}
                className={btnClass}
                aria-label="Back"
              >
                <ArrowLeft size={18} strokeWidth={1.75} />
              </button>
            </div>
            
            {/* CENTER: Title breadcrumb */}
            <div className="glass-panel-nav flex items-center gap-1.5 px-2.5 py-1.5 min-w-0 flex-1">
              <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[80px]">
                {entry.feed?.title}
              </span>
              <span className="text-[var(--color-text-tertiary)]">›</span>
              <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {entry.title}
              </span>
            </div>
            
            {/* RIGHT: Actions */}
            <ArticleHeaderActions
              entry={entry}
              isUnread={isUnread}
              isReaderView={isReaderView}
              isLoadingReader={isLoadingReader}
              hasComments={hasComments}
              showComments={showComments}
              showTypography={showTypography}
              isTTSPlaying={isTTSPlaying}
              onListenToArticle={handleListenToArticle}
              onToggleReaderView={handleToggleReaderView}
              onToggleTypography={() => setShowTypography((value) => !value)}
              onToggleComments={() => { setShowComments(!showComments); setShowTypography(false); }}
              onToggleBookmark={() => onToggleBookmark(entry.id)}
              onToggleReadStatus={() => isUnread ? onMarkAsRead(entry.id) : onMarkAsUnread(entry.id)}
              onShare={handleShare}
              onClose={onClose}
              condensed
              alwaysVisibleIds={compactVisibleActionIds}
              overflowIds={compactOverflowActionIds}
            />
          </div>
        </div>
        
        {/* Pull-down dismiss indicator */}
        {pullDismiss > 0 && (
          <div className="absolute top-[env(safe-area-inset-top)] left-1/2 -translate-x-1/2 z-[60] pt-2 pointer-events-none">
            <div
              className="w-10 h-1 rounded-full bg-[var(--color-text-tertiary)]"
              style={{ opacity: Math.min(pullDismiss, 1), transform: `scaleX(${0.5 + pullDismiss * 0.5})` }}
            />
          </div>
        )}
        
        {/* Content - article header clearance is handled inside ArticleContent */}
        <div className="relative flex-1 min-h-0">
          <article
            ref={scrollRef}
            tabIndex={-1}
            className={cn(
              'h-full min-h-0 overscroll-y-contain outline-none relative',
              isPaginated
                ? 'overflow-x-hidden overflow-y-hidden overscroll-x-contain'
                : 'overflow-y-auto'
            )}
            onTouchStart={handleArticleTouchStart}
            onTouchMove={handleArticleTouchMove}
            onTouchEnd={handleArticleTouchEnd}
            onTouchCancel={handleArticleTouchEnd}
            onClick={handleArticleClick}
            style={isPaginated
              ? paginatedArticleStyle
              : { WebkitOverflowScrolling: 'touch' }}
          >
            <ArticleContent 
              entry={entry} 
              effectiveColumnCount={effectiveColumnCount}
                paginatedTrailingBlankColumns={trailingBlankColumns}
              className={cn(isPaginated && 'h-full')}
              isReaderViewControlled={isReaderView}
              isLoadingReaderControlled={isLoadingReader}
              readerContentControlled={readerContent}
              onToggleReaderViewControlled={handleToggleReaderView}
              fetchError={fetchError}
              onRetryFetch={handleRetryFetch}
            />
            {isPaginated && (
              <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, width: 'var(--article-scroll-width, 100%)', height: '1px', pointerEvents: 'none' }} />
            )}
          </article>

          {isPaginated && (
            <ReaderNavButtons
              onPrev={handlePrevPage}
              onNext={handleNextPage}
              canGoPrev={pageNavState.canPrev}
              canGoNext={pageNavState.canNext}
              className="z-[55]"
              visible={showNavButtons}
              einkMode={einkMode}
            />
          )}

          {isPaginated && pageNavState.totalPages > 1 && (
            <div
              role="status"
              aria-live="polite"
              aria-label={`Page ${pageNavState.currentPage + 1} of ${pageNavState.totalPages}`}
              className={cn(
                'absolute left-1/2 -translate-x-1/2 z-[55]',
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full',
                'bg-[var(--color-surface-primary)]/70 backdrop-blur-sm',
                'border border-[var(--color-border-subtle)]',
                'text-[10px] text-[var(--color-text-tertiary)]',
                'pointer-events-none select-none',
              )}
              style={{
                bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
              }}
            >
              {pageNavState.currentPage + 1} / {pageNavState.totalPages}
            </div>
          )}
        </div>

        {showTypography && (
          <>
            <div
              className="absolute inset-0 z-[65] bg-black/20"
              onClick={() => setShowTypography(false)}
            />
            <TypographyPanel
              settings={articleTypography}
              onChange={setArticleTypography}
              onClose={() => setShowTypography(false)}
              isDarkMode={isDarkMode}
              className="z-[75]"
              topOffset="calc(env(safe-area-inset-top, 0px) + 3.75rem)"
              fontOptions={ARTICLE_FONT_OPTIONS}
              originalFormattingTitle="Use the article's default formatting"
              defaultSettings={DEFAULT_ARTICLE_TYPOGRAPHY}
              showMarginControls={false}
              showMaxWidthControl={true}
              maxPaginatedColumns={canUseTwoColumnLayout ? 2 : 1}
              paginatedColumnHint={canUseTwoColumnLayout ? undefined : 'Two columns need more horizontal space.'}
            />
          </>
        )}
        
        {/* Mobile Comments Overlay */}
        {showComments && hasComments && (
          <div className={cn(
            "fixed inset-0 z-[60]",
            "bg-[var(--color-surface-primary)]",
            !einkMode && 'animate-slide-in-right',
            'flex flex-col'
          )}>
            {/* Comments Floating Header */}
            <div className={cn(
              "absolute top-0 left-0 right-0 z-10 h-0 overflow-visible pointer-events-none",
              "pt-[env(safe-area-inset-top)]"
            )}>
              <div className="flex items-center gap-2 px-3 py-3 pointer-events-auto">
                <div className="glass-panel-nav flex items-center px-1 py-1">
                  <button
                    onClick={() => setShowComments(false)}
                    className={btnClass}
                    aria-label="Back to article"
                  >
                    <ArrowLeft size={18} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="glass-panel-nav flex items-center px-2.5 py-1.5">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Discussion
                  </span>
                </div>
              </div>
            </div>
            
            {/* Comments Content — top padding must clear safe-area + floating header */}
            <div className="flex-1 overflow-y-auto" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)' }}>
              <CommentsPanel entry={entry} className="h-full" />
            </div>
          </div>
        )}
        
      </div>
    );
  }

  if (modal) {
    const modalArticleWidth = articleTypography.readingMode === 'paginated'
      ? articleTypography.maxWidth + 160
      : articleTypography.maxWidth + 96;
    const modalCommentsWidth = showComments && hasComments ? 400 : 0;
    const modalMaxWidth = `${modalArticleWidth + modalCommentsWidth}px`;

    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 eink-modal-container">
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm eink-modal-backdrop"
          onClick={onClose}
        />

        <div
          ref={surfaceRef}
          className="relative w-full max-h-[90vh] overflow-hidden rounded-2xl bg-[var(--color-surface-base)] shadow-2xl flex flex-col eink-shell-surface eink-modal-surface"
          style={{ maxWidth: `min(calc(100vw - 2rem), ${modalMaxWidth})` }}
        >
          <div className="absolute top-0 left-0 right-0 z-30 h-0 overflow-visible pointer-events-none">
            <div className="flex min-w-0 items-center gap-2 px-3 py-3 pointer-events-auto">
              <div className="glass-panel-nav eink-shell-surface flex min-w-0 shrink items-center gap-1.5 overflow-hidden px-3 py-1.5 max-w-[min(100%,34rem)]">
                <span className="text-xs text-[var(--color-text-secondary)] truncate flex-shrink-0">
                  {entry.feed?.title}
                </span>
                <span className="text-[var(--color-text-tertiary)] flex-shrink-0">›</span>
                <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {entry.title}
                </span>
              </div>

              <div className="ml-auto">
                <ArticleHeaderActions
                  entry={entry}
                  isUnread={isUnread}
                  isReaderView={isReaderView}
                  isLoadingReader={isLoadingReader}
                  hasComments={hasComments}
                  showComments={showComments}
                  showTypography={showTypography}
                  isTTSPlaying={isTTSPlaying}
                  onListenToArticle={handleListenToArticle}
                  onToggleReaderView={handleToggleReaderView}
                  onToggleTypography={() => setShowTypography((value) => !value)}
                  onToggleComments={() => { setShowComments(!showComments); setShowTypography(false); }}
                  onToggleBookmark={() => onToggleBookmark(entry.id)}
                  onToggleReadStatus={() => isUnread ? onMarkAsRead(entry.id) : onMarkAsUnread(entry.id)}
                  onShare={handleShare}
                  onClose={onClose}
                />
              </div>
            </div>
          </div>

          {showTypography && (
            <>
              <div className="absolute inset-0 z-[35]" onClick={() => setShowTypography(false)} />
              <TypographyPanel
                settings={articleTypography}
                onChange={setArticleTypography}
                onClose={() => setShowTypography(false)}
                isDarkMode={isDarkMode}
                topOffset="3.75rem"
                fontOptions={ARTICLE_FONT_OPTIONS}
                originalFormattingTitle="Use the article's default formatting"
                defaultSettings={DEFAULT_ARTICLE_TYPOGRAPHY}
                showMarginControls={false}
                showMaxWidthControl={true}
                maxPaginatedColumns={canUseTwoColumnLayout ? 2 : 1}
                paginatedColumnHint={canUseTwoColumnLayout ? undefined : 'Two columns need more horizontal space.'}
              />
            </>
          )}

          <div className={cn('flex-1 flex overflow-hidden', showComments && 'gap-0')}>
            <div className={cn('relative flex-1 min-w-0 overflow-hidden', showComments && 'border-r border-[var(--color-border-subtle)]')}>
              <div className="sticky top-0 left-0 right-0 z-[40] h-0.5 pointer-events-none">
                <div
                  ref={progressRef}
                  className="h-full bg-[var(--color-accent-fg)] transition-[width] duration-150"
                  style={{ width: '0%' }}
                />
              </div>

              <article
                ref={scrollRef}
                tabIndex={-1}
                className={cn(
                  'h-full min-h-0 outline-none relative',
                  isPaginated
                    ? 'overflow-x-hidden overflow-y-hidden overscroll-x-contain'
                    : 'overflow-y-auto'
                )}
                style={paginatedArticleStyle}
                onTouchStart={handleArticleTouchStart}
                onTouchMove={handleArticleTouchMove}
                onTouchEnd={handleArticleTouchEnd}
                onTouchCancel={handleArticleTouchEnd}
                onClick={handleArticleClick}
              >
                <ArticleContent
                  entry={entry}
                  effectiveColumnCount={effectiveColumnCount}
                paginatedTrailingBlankColumns={trailingBlankColumns}
                  className={cn(isPaginated && 'h-full')}
                  isReaderViewControlled={isReaderView}
                  isLoadingReaderControlled={isLoadingReader}
                  readerContentControlled={readerContent}
                  onToggleReaderViewControlled={handleToggleReaderView}
                  fetchError={fetchError}
                  onRetryFetch={handleRetryFetch}
                />
                {isPaginated && (
                  <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, width: 'var(--article-scroll-width, 100%)', height: '1px', pointerEvents: 'none' }} />
                )}
              </article>

              {isPaginated && (
                <ReaderNavButtons
                  onPrev={handlePrevPage}
                  onNext={handleNextPage}
                  canGoPrev={pageNavState.canPrev}
                  canGoNext={pageNavState.canNext}
                  className="z-[45]"
                  visible={showNavButtons}
                  einkMode={einkMode}
                />
              )}

              {isPaginated && pageNavState.totalPages > 1 && (
                <div
                  role="status"
                  aria-live="polite"
                  aria-label={`Page ${pageNavState.currentPage + 1} of ${pageNavState.totalPages}`}
                  className={cn(
                    'absolute left-1/2 -translate-x-1/2 z-[45]',
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full',
                    'bg-[var(--color-surface-primary)]/70 backdrop-blur-sm',
                    'border border-[var(--color-border-subtle)]',
                    'text-[10px] text-[var(--color-text-tertiary)]',
                    'pointer-events-none select-none',
                  )}
                  style={{ bottom: '0.75rem' }}
                >
                  {pageNavState.currentPage + 1} / {pageNavState.totalPages}
                </div>
              )}
            </div>

            {showComments && hasComments && (
              <div className="w-[400px] flex-shrink-0 overflow-hidden">
                <CommentsPanel entry={entry} className="h-full" />
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // =========================================================================
  // DESKTOP LAYOUT
  // =========================================================================
  return (
    <div ref={surfaceRef} className={cn('relative flex flex-col h-full', fullscreen && 'min-h-0')}>
      {/* Reader scroll progress bar */}
      <div className="absolute top-0 left-0 right-0 z-[40] h-0.5 pointer-events-none">
        <div 
          ref={progressRef}
          className="h-full bg-[var(--color-accent-fg)] transition-[width] duration-150"
          style={{ width: '0%' }}
        />
      </div>
      
      {/* Floating Glass Header */}
      <div className="absolute top-0 left-0 right-0 z-30 h-0 overflow-visible pointer-events-none">
        <div className="flex min-w-0 items-center gap-2 px-3 py-3 pointer-events-auto">
          {/* Navigation arrows */}
          <div className="glass-panel-nav flex flex-shrink-0 items-center gap-0.5 px-1.5 py-1 whitespace-nowrap">
            <button onClick={onPreviousEntry} disabled={!hasPrevious}
              className={cn(btnClass, !hasPrevious && 'text-[var(--color-text-disabled)] cursor-not-allowed')} title="Previous (K)">
              <ChevronUp size={18} />
            </button>
            <button onClick={onNextEntry} disabled={!hasNext}
              className={cn(btnClass, !hasNext && 'text-[var(--color-text-disabled)] cursor-not-allowed')} title="Next (J)">
              <ChevronDown size={18} />
            </button>
          </div>

          {/* Breadcrumb */}
          <div className="glass-panel-nav flex min-w-0 shrink items-center gap-1.5 overflow-hidden px-3 py-1.5 max-w-[min(100%,34rem)]">
            <span className="text-xs text-[var(--color-text-secondary)] truncate">{entry.feed?.title}</span>
            <span className="text-[var(--color-text-tertiary)]">›</span>
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{entry.title}</span>
          </div>

          {/* Actions */}
          <div className="ml-auto">
            <ArticleHeaderActions
              entry={entry}
              isUnread={isUnread}
              isReaderView={isReaderView}
              isLoadingReader={isLoadingReader}
              hasComments={hasComments}
              showComments={showComments}
              showTypography={showTypography}
              isTTSPlaying={isTTSPlaying}
              onListenToArticle={handleListenToArticle}
              onToggleReaderView={handleToggleReaderView}
              onToggleTypography={() => setShowTypography((value) => !value)}
              onToggleComments={() => { setShowComments(!showComments); setShowTypography(false); }}
              onToggleBookmark={() => onToggleBookmark(entry.id)}
              onToggleReadStatus={() => isUnread ? onMarkAsRead(entry.id) : onMarkAsUnread(entry.id)}
              onShare={handleShare}
              onClose={onClose}
            />
          </div>
        </div>
      </div>

      {showTypography && (
        <>
          <div
            className="absolute inset-0 z-[35]"
            onClick={() => setShowTypography(false)}
          />
          <TypographyPanel
            settings={articleTypography}
            onChange={setArticleTypography}
            onClose={() => setShowTypography(false)}
            isDarkMode={isDarkMode}
            topOffset="3.75rem"
            fontOptions={ARTICLE_FONT_OPTIONS}
            originalFormattingTitle="Use the article's default formatting"
            defaultSettings={DEFAULT_ARTICLE_TYPOGRAPHY}
            showMarginControls={false}
            showMaxWidthControl={true}
            maxPaginatedColumns={canUseTwoColumnLayout ? 2 : 1}
            paginatedColumnHint={canUseTwoColumnLayout ? undefined : 'Two columns need more horizontal space.'}
          />
        </>
      )}

      {/* Content Area - Split view when comments visible */}
      <div className={cn("flex-1 flex overflow-hidden", showComments && "gap-0")}>
        <div className={cn("relative flex-1 min-w-0 overflow-hidden", showComments && "border-r border-[var(--color-border-subtle)]")}>
          <article
            ref={scrollRef}
            tabIndex={-1}
            className={cn(
              'h-full min-w-0 outline-none relative',
              isPaginated
                ? 'overflow-x-hidden overflow-y-hidden overscroll-x-contain'
                : 'overflow-y-auto'
            )}
            style={paginatedArticleStyle}
            onTouchStart={handleArticleTouchStart}
            onTouchMove={handleArticleTouchMove}
            onTouchEnd={handleArticleTouchEnd}
            onTouchCancel={handleArticleTouchEnd}
            onClick={handleArticleClick}
          >
            <ArticleContent 
              entry={entry} 
              effectiveColumnCount={effectiveColumnCount}
                paginatedTrailingBlankColumns={trailingBlankColumns}
              className={cn(isPaginated && 'h-full')}
              isReaderViewControlled={isReaderView}
              isLoadingReaderControlled={isLoadingReader}
              readerContentControlled={readerContent}
              onToggleReaderViewControlled={handleToggleReaderView}
              fetchError={fetchError}
              onRetryFetch={handleRetryFetch}
            />
            {isPaginated && (
              <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, width: 'var(--article-scroll-width, 100%)', height: '1px', pointerEvents: 'none' }} />
            )}
          </article>

          {isPaginated && (
            <ReaderNavButtons
              onPrev={handlePrevPage}
              onNext={handleNextPage}
              canGoPrev={pageNavState.canPrev}
              canGoNext={pageNavState.canNext}
              className="z-[35]"
              visible={showNavButtons}
              einkMode={einkMode}
            />
          )}

          {isPaginated && pageNavState.totalPages > 1 && (
            <div
              role="status"
              aria-live="polite"
              aria-label={`Page ${pageNavState.currentPage + 1} of ${pageNavState.totalPages}`}
              className={cn(
                'absolute left-1/2 -translate-x-1/2 z-[35]',
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full',
                'bg-[var(--color-surface-primary)]/70 backdrop-blur-sm',
                'border border-[var(--color-border-subtle)]',
                'text-[10px] text-[var(--color-text-tertiary)]',
                'pointer-events-none select-none',
              )}
              style={{ bottom: '0.75rem' }}
            >
              {pageNavState.currentPage + 1} / {pageNavState.totalPages}
            </div>
          )}
        </div>
        
        {showComments && hasComments && (
          <div className={cn(
            'w-[400px] flex-shrink-0 overflow-hidden',
            !einkMode && 'animate-slide-in-right'
          )}>
            <CommentsPanel entry={entry} className="h-full" />
          </div>
        )}
      </div>
    </div>
  );
}

export default ArticleReader;
