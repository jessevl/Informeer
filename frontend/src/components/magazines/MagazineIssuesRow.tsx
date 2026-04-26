/**
 * MagazineIssuesRow Component
 * A horizontally scrollable row of issue covers that expands inline
 * beneath the selected magazine stack in the grid.
 * Animates open/closed with a smooth height + opacity transition.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { BookOpen, Eye, ChevronLeft, ChevronRight, X, RefreshCw, CloudOff, Check, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import type { MagazineIssue } from '@/stores/magazines';
import type { MagazineGroup } from './MagazineStack';
import { saveMagazineOffline, removeOfflineItem } from '@/lib/offline/blob-cache';
import { useOfflineItem } from '@/stores/offline';
import { useCachedImageUrl } from '@/hooks/useCachedImageUrl';

interface ReadingProgress {
  maxPage: number;
  totalPages: number;
}

interface MagazineIssuesRowProps {
  group: MagazineGroup;
  isOpen: boolean;
  onClose: () => void;
  /** Called after the close animation finishes — parent should unmount */
  onClosed?: () => void;
  onOpenIssue: (issue: MagazineIssue) => void;
  onRetryIssue?: (issue: MagazineIssue) => void;
  progressMap?: Record<string, ReadingProgress>;
}

export function MagazineIssuesRow({
  group,
  isOpen,
  onClose,
  onClosed,
  onOpenIssue,
  onRetryIssue,
  progressMap = {},
}: MagazineIssuesRowProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Measure the content height for the animation
  useEffect(() => {
    if (isOpen && contentRef.current) {
      // Slight delay to allow DOM to settle
      requestAnimationFrame(() => {
        if (contentRef.current) {
          setMeasuredHeight(contentRef.current.scrollHeight);
        }
      });
      // Trigger the visible state after a tick for the CSS transition
      setIsAnimating(true);
      const timer = setTimeout(() => setIsVisible(true), 20);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
      // Wait for the close animation to finish before signalling unmount
      const timer = setTimeout(() => {
        setIsAnimating(false);
        onClosed?.();
      }, 380);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Re-measure on window resize or when content changes size
  // (e.g. new issues loaded after refresh, images finishing layout)
  useEffect(() => {
    if (!isOpen || !contentRef.current) return;

    const el = contentRef.current;
    const handleResize = () => {
      if (el) {
        setMeasuredHeight(el.scrollHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    // Use ResizeObserver to detect content size changes
    const ro = new ResizeObserver(handleResize);
    ro.observe(el);

    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
    };
  }, [isOpen]);

  // Scroll with arrow buttons
  const scroll = useCallback((direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.6;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  }, []);

  if (!isOpen && !isAnimating) return null;

  return (
    <div
      className="col-span-full overflow-hidden"
      style={{
        maxHeight: isVisible ? `${measuredHeight}px` : '0px',
        opacity: isVisible ? 1 : 0,
        transition: 'max-height 350ms cubic-bezier(0.4, 0, 0.2, 1), opacity 300ms ease',
      }}
    >
      <div ref={contentRef}>
        {/* Decorative top edge — a subtle accent line */}
        <div className="mx-6 mb-0 mt-1">
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-default)] to-transparent" />
        </div>

        {/* Header row */}
        <div className="flex items-center justify-between px-6 pt-3 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {group.feedTitle}
            </h3>
            <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">
              {group.issues.length} {group.issues.length === 1 ? 'issue' : 'issues'}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Scroll arrows — hidden on mobile where swipe is natural */}
            <button
              onClick={() => scroll('left')}
              className={cn(
                'hidden sm:flex w-7 h-7 items-center justify-center rounded-full',
                'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                'hover:bg-[var(--color-surface-hover)] transition-colors'
              )}
              aria-label="Scroll left"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => scroll('right')}
              className={cn(
                'hidden sm:flex w-7 h-7 items-center justify-center rounded-full',
                'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                'hover:bg-[var(--color-surface-hover)] transition-colors'
              )}
              aria-label="Scroll right"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={onClose}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded-full',
                'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                'hover:bg-[var(--color-surface-hover)] transition-colors'
              )}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Scrollable issue covers */}
        <div
          ref={scrollRef}
          className={cn(
            'flex gap-4 px-6 pb-5 pt-1',
            'overflow-x-auto scrollbar-none',
            // Smooth momentum scrolling on iOS
            'snap-x snap-mandatory',
            '[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]'
          )}
        >
          {group.issues.map((issue, i) => (
            <IssueThumb
              key={issue.id}
              issue={issue}
              feedTitle={group.feedTitle}
              index={i}
              isVisible={isVisible}
              onOpen={() => onOpenIssue(issue)}
              onRetry={onRetryIssue ? () => onRetryIssue(issue) : undefined}
              progress={progressMap[issue.id]}
            />
          ))}
        </div>

        {/* Bottom decorative edge */}
        <div className="mx-6 mt-0 mb-1">
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-default)] to-transparent" />
        </div>
      </div>
    </div>
  );
}

// ==================== Issue Thumbnail ====================

interface IssueThumbProps {
  issue: MagazineIssue;
  feedTitle: string;
  index: number;
  isVisible: boolean;
  onOpen: () => void;
  onRetry?: () => void;
  progress?: ReadingProgress;
}

function IssueThumb({ issue, feedTitle, index, isVisible, onOpen, onRetry, progress }: IssueThumbProps) {
  const [retrying, setRetrying] = useState(false);
  const [localFailed, setLocalFailed] = useState(issue.downloadFailed || false);
  const hasProgress = progress && progress.maxPage > 0 && progress.totalPages > 0;
  const progressPercent = hasProgress ? (progress.maxPage / progress.totalPages) * 100 : 0;
  const isRead = progressPercent >= 90;

  // Offline state
  const offlineItem = useOfflineItem('magazine', issue.id);
  const isSavedOffline = offlineItem != null;
  const [isSavingOffline, setIsSavingOffline] = useState(false);
  const coverImageUrl = useCachedImageUrl({
    cacheKey: offlineItem?.coverCacheKey,
    imageUrl: issue.coverUrl,
  });

  const handleToggleOffline = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isSavedOffline) {
      await removeOfflineItem(`/offline/magazines/${issue.id}`);
      return;
    }
    setIsSavingOffline(true);
    try {
      const authHeader = api.isAuthenticated() ? api.getAuthHeader() || '' : '';
      await saveMagazineOffline(issue.id, issue.title, issue.pdfUrl, authHeader, issue.coverUrl, issue.seriesName);
    } catch (err) {
      console.error('[magazines] Offline save failed:', err);
    } finally {
      setIsSavingOffline(false);
    }
  }, [issue, isSavedOffline]);

  const displayLabel = extractIssueLabel(issue.title, feedTitle);

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await api.retryMagazineDownload(parseInt(issue.id, 10));
      setLocalFailed(false);
      onRetry?.();
    } catch {
      // still failed
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className="group/thumb shrink-0 snap-start flex flex-col gap-1.5 w-[120px] sm:w-[140px]"
      style={{
        // Staggered entrance animation
        transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
        opacity: isVisible ? 1 : 0,
        transition: `transform 350ms cubic-bezier(0.4, 0, 0.2, 1) ${index * 40}ms, opacity 300ms ease ${index * 40}ms`,
      }}
    >
      {/* Cover */}
      <button
        onClick={localFailed ? handleRetry : onOpen}
        className={cn(
          'relative aspect-[3/4] w-full overflow-hidden rounded-lg',
          'bg-[var(--color-surface-secondary)]',
          'border border-[var(--color-border-default)]',
          'shadow-sm hover:shadow-lg',
          'transition-all duration-250 ease-out',
          'group-hover/thumb:scale-[1.03] group-hover/thumb:-translate-y-0.5',
          'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]',
          'cursor-pointer',
          isRead && !localFailed && 'opacity-70 [filter:saturate(0.62)_contrast(0.88)_brightness(1.03)]'
        )}
      >
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={issue.title}
            className={cn(
              'w-full h-full object-cover',
              localFailed && 'blur-sm brightness-50'
            )}
            loading="lazy"
          />
        ) : (
          <div className={cn(
            'w-full h-full flex items-center justify-center',
            localFailed && 'blur-sm brightness-50'
          )}>
            <BookOpen size={24} className="text-[var(--color-text-tertiary)] opacity-40" />
          </div>
        )}

        {/* Failed overlay with retry */}
        {localFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className={cn(
              'p-2 rounded-full bg-white/90 text-red-500 shadow-lg',
              retrying && 'animate-spin'
            )}>
              <RefreshCw size={16} />
            </div>
            <span className="text-[10px] font-medium text-white/90 drop-shadow">Retry</span>
          </div>
        )}

        {/* Hover overlay (only for non-failed) */}
        {!localFailed && (
        <div className={cn(
          'absolute inset-0 flex items-center justify-center',
          'bg-black/0 group-hover/thumb:bg-black/40',
          'transition-all duration-250',
          'opacity-0 group-hover/thumb:opacity-100'
        )}>
          <div className={cn(
            'p-2 rounded-full',
            'bg-white/90 text-black',
            'shadow-lg',
            'transform scale-75 group-hover/thumb:scale-100',
            'transition-transform duration-250'
          )}>
            <Eye size={16} />
          </div>
        </div>
        )}

        {/* Spine */}
        <div className={cn(
          'absolute inset-y-0 left-0 w-1',
          'bg-gradient-to-r from-black/15 to-transparent',
          'pointer-events-none'
        )} />

        {/* Progress bar */}
        {hasProgress && (
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
            <div className="h-0.5 bg-black/30">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Offline badge */}
        {isSavedOffline && !isSavingOffline && (
          <div className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 px-1 py-px rounded bg-emerald-500/80 text-white text-[8px] font-medium pointer-events-none backdrop-blur-sm z-10 eink-media-badge">
            <Check size={7} />
            Saved
          </div>
        )}
        {isRead && !localFailed && (
          <div className="absolute top-1 left-1 flex items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-surface-base)_88%,transparent)] px-1.5 py-0.5 text-[8px] font-medium text-[var(--color-text-secondary)] backdrop-blur-sm z-10">
            <Check size={7} />
            Read
          </div>
        )}

        {/* Save offline button (on hover) */}
        {!localFailed && (
          <button
            onClick={handleToggleOffline}
            disabled={isSavingOffline}
            className={cn(
              'absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center',
              'backdrop-blur-sm transition-all z-10',
              'eink-media-action',
              isSavedOffline
                ? 'bg-emerald-500/80 text-white opacity-100 hover:bg-emerald-600/90'
                : 'bg-black/40 text-white opacity-0 group-hover/thumb:opacity-100 hover:bg-black/60',
            )}
            title={isSavedOffline ? 'Remove offline copy' : 'Save for offline'}
          >
            {isSavingOffline ? (
              <Loader2 size={9} className="animate-spin" />
            ) : isSavedOffline ? (
              <Check size={9} />
            ) : (
              <CloudOff size={9} />
            )}
          </button>
        )}
      </button>

      {/* Label */}
      <div className="flex flex-col gap-0 px-0.5">
        <p
          className={cn(
            'text-[11px] font-medium leading-tight',
            isRead ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]',
            'line-clamp-2',
            'group-hover/thumb:text-[var(--color-accent)]',
            'transition-colors cursor-pointer'
          )}
          onClick={onOpen}
        >
          {displayLabel || issue.title}
        </p>
        {hasProgress && (
          <span className="text-[9px] text-[var(--color-text-tertiary)]">
            p.{progress.maxPage}/{progress.totalPages}
          </span>
        )}
      </div>
    </div>
  );
}

function extractIssueLabel(title: string, feedTitle: string): string {
  const separators = [' – ', ' — ', ' - ', ': '];
  for (const sep of separators) {
    const idx = title.indexOf(sep);
    if (idx !== -1) {
      return title.slice(idx + sep.length).trim();
    }
  }
  return title;
}
