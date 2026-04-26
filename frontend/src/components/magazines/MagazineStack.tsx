/**
 * MagazineStack Component
 * Displays a group of magazine issues from the same feed as a visual stack.
 * The latest issue's cover is on top, with "stacked" magazine edges visible below.
 * Clicking opens the issues panel for that feed.
 */

import { useState, useCallback } from 'react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { BookOpen, MoreHorizontal, Trash2, CloudOff, Check } from 'lucide-react';
import type { MagazineIssue } from '@/stores/magazines';
import { useOfflineItem } from '@/stores/offline';
import { useCachedImageUrl } from '@/hooks/useCachedImageUrl';

interface ReadingProgress {
  maxPage: number;
  totalPages: number;
}

export interface MagazineGroup {
  feedId: number;
  feedTitle: string;
  issues: MagazineIssue[];
  latestIssue: MagazineIssue;
}

interface MagazineStackProps {
  group: MagazineGroup;
  onOpen: (group: MagazineGroup) => void;
  progressMap?: Record<string, ReadingProgress>;
  isSelected?: boolean;
  savedCount?: number;
  onUnsubscribe?: (feedId: number) => void;
  onRemoveAllSaved?: (feedId: number) => void;
}

export function MagazineStack({ group, onOpen, progressMap = {}, isSelected = false, savedCount = 0, onUnsubscribe, onRemoveAllSaved }: MagazineStackProps) {
  const { latestIssue, issues, feedTitle } = group;
  const issueCount = issues.length;
  const [showMenu, setShowMenu] = useState(false);
  const offlineItem = useOfflineItem('magazine', latestIssue.id);
  const coverImageUrl = useCachedImageUrl({
    cacheKey: offlineItem?.coverCacheKey,
    imageUrl: latestIssue.coverUrl,
  });

  // Calculate aggregate reading progress for the latest issue
  const latestProgress = progressMap[latestIssue.id];
  const hasProgress = latestProgress && latestProgress.maxPage > 0 && latestProgress.totalPages > 0;
  const progressPercent = hasProgress ? (latestProgress.maxPage / latestProgress.totalPages) * 100 : 0;

  // Count of issues with any progress
  const readCount = issues.filter(i => {
    const p = progressMap[i.id];
    return p && p.maxPage > 0 && p.totalPages > 0 && (p.maxPage / p.totalPages) > 0.9;
  }).length;
  const isFullyRead = issueCount > 0 && readCount === issueCount;
  const shouldMuteReadState = !isSelected && (isFullyRead || progressPercent >= 90);

  // Extract the latest issue date info from the title
  const issueDateLabel = extractIssueDateLabel(latestIssue.title, feedTitle);

  const handleUnsubscribe = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (confirm(`Unsubscribe from "${feedTitle}"? This will remove the subscription and all its issues.`)) {
      onUnsubscribe?.(group.feedId);
    }
  }, [feedTitle, group.feedId, onUnsubscribe]);

  const handleRemoveAllSaved = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onRemoveAllSaved?.(group.feedId);
  }, [group.feedId, onRemoveAllSaved]);

  return (
    <div className="group relative flex flex-col gap-2.5">
      {/* Stack of magazines */}
      <button
        onClick={() => onOpen(group)}
        className={cn(
          'relative cursor-pointer focus:outline-none rounded-lg',
          'transition-all duration-300',
          shouldMuteReadState && 'opacity-70',
          isSelected
            ? 'ring-2 ring-offset-2 ring-[var(--color-accent-primary)] ring-offset-[var(--color-surface-base)] scale-[1.02]'
            : 'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent-primary)] focus-visible:ring-offset-[var(--color-surface-base)]'
        )}
      >
        {/* Background stack layers — only show if more than 1 issue */}
        {issueCount >= 3 && (
          <div
            className={cn(
              'absolute aspect-[3/4] w-full rounded-lg',
              'bg-[var(--color-surface-tertiary)]',
              'top-2 left-1.5',
              'transition-all duration-300 ease-out',
              'group-hover:top-3 group-hover:left-2',
            )}
            style={{ zIndex: 1 }}
          />
        )}
        {issueCount >= 2 && (
          <div
            className={cn(
              'absolute aspect-[3/4] w-full rounded-lg',
              'bg-[var(--color-surface-secondary)]',
              'top-1 left-[3px]',
              'transition-all duration-300 ease-out',
              'group-hover:top-1.5 group-hover:left-1',
            )}
            style={{ zIndex: 2 }}
          />
        )}

        {/* Top cover — the latest issue */}
        <div
          className={cn(
            'relative aspect-[3/4] w-full overflow-hidden rounded-lg',
            'bg-[var(--color-surface-secondary)]',
            'shadow-md hover:shadow-xl',
            'transition-all duration-300 ease-out',
            'group-hover:scale-[1.02] group-hover:-translate-y-1',
            shouldMuteReadState && '[filter:saturate(0.62)_contrast(0.88)_brightness(1.03)]',
          )}
          style={{ zIndex: 3 }}
        >
          {coverImageUrl ? (
            <img
              src={coverImageUrl}
              alt={latestIssue.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[var(--color-surface-secondary)] to-[var(--color-surface-tertiary)]">
              <BookOpen size={40} className="text-[var(--color-text-tertiary)] opacity-40" />
            </div>
          )}

          {/* Hover overlay */}
          <div className={cn(
            'absolute inset-0 flex items-center justify-center',
            'bg-black/0 group-hover:bg-black/30',
            'transition-all duration-300',
            'opacity-0 group-hover:opacity-100',
            'eink-media-overlay-hover'
          )}>
            <span className="text-white text-sm font-medium px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm eink-media-chip">
              {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
            </span>
          </div>

          {/* Magazine spine effect */}
          <div className={cn(
            'absolute inset-y-0 left-0 w-1.5',
            'bg-gradient-to-r from-black/8 to-transparent',
            'pointer-events-none'
          )} />

          {/* Progress bar at bottom */}
          {hasProgress && (
            <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ zIndex: 4 }}>
              <div className="h-1 bg-black/30">
                <div
                  className="h-full bg-[var(--color-accent)] transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Issue count badge */}
          {issueCount > 1 && (
            <div className={cn(
              'absolute top-2 right-2 min-w-[22px] h-[22px]',
              'flex items-center justify-center',
              'px-1.5 rounded-full text-[11px] font-semibold',
              'bg-black/60 text-white backdrop-blur-sm eink-media-badge',
              'pointer-events-none'
            )} style={{ zIndex: 5 }}>
              {issueCount}
            </div>
          )}

          {/* Saved offline badge */}
          {savedCount > 0 && (
            <div
              className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/80 text-white text-[9px] font-medium pointer-events-none backdrop-blur-sm eink-media-badge"
              style={{ zIndex: 5 }}
            >
              <Check size={8} />
              {savedCount} saved
            </div>
          )}
          {shouldMuteReadState && (
            <div
              className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-surface-base)_88%,transparent)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-secondary)] backdrop-blur-sm"
              style={{ zIndex: 5 }}
            >
              <Check size={10} />
              Read
            </div>
          )}
        </div>
      </button>

      {/* Context menu button */}
      {(onUnsubscribe || onRemoveAllSaved) && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          className={cn(
            'absolute top-1.5 right-1.5 w-7 h-7 rounded-lg',
            'flex items-center justify-center',
            'bg-black/40 text-white backdrop-blur-sm eink-media-action',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:bg-black/60'
          )}
          style={{ zIndex: 6 }}
        >
          <MoreHorizontal size={14} />
        </button>
      )}

      {/* Dropdown menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className={cn(
            'absolute top-9 right-1 z-50 min-w-[160px]',
            'bg-[var(--color-surface-primary)] border border-[var(--color-border-default)]',
            'rounded-lg shadow-lg py-1',
            'eink-media-menu'
          )}>
            {savedCount > 0 && onRemoveAllSaved && (
              <button
                onClick={handleRemoveAllSaved}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <CloudOff size={14} />
                Remove {savedCount} saved
              </button>
            )}
            {onUnsubscribe && (
              <>
                {savedCount > 0 && onRemoveAllSaved && <div className="h-px bg-[var(--color-border-default)] mx-2" />}
                <button
                  onClick={handleUnsubscribe}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <Trash2 size={14} />
                  Unsubscribe
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Title & Meta */}
      <div className="flex flex-col gap-0.5 px-0.5">
        <h3
          className={cn(
            'text-sm font-semibold leading-tight',
            'line-clamp-2',
            'transition-colors cursor-pointer',
            isSelected
              ? 'text-[var(--color-accent)]'
              : shouldMuteReadState
                ? 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent)]'
                : 'text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]'
          )}
          onClick={() => onOpen(group)}
        >
          {feedTitle}
        </h3>
        <div className={cn(
          'flex items-center gap-1.5 text-xs',
          shouldMuteReadState ? 'text-[color-mix(in_srgb,var(--color-text-tertiary)_88%,var(--color-surface-base))]' : 'text-[var(--color-text-tertiary)]'
        )}>
          {issueDateLabel && (
            <span className="truncate">{issueDateLabel}</span>
          )}
          {readCount > 0 && (
            <span className="shrink-0 ml-auto">
              {readCount}/{issueCount} read
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Extract a human-readable date label from the latest issue title.
 * E.g. "The Economist UK – 21-27 February 2026" → "21-27 February 2026"
 */
function extractIssueDateLabel(title: string, feedTitle: string): string {
  // Try to strip the feed/series name prefix and separators
  // Common patterns: "Title – Date", "Title - Date", "Title: Date"
  const separators = [' – ', ' — ', ' - ', ': '];
  for (const sep of separators) {
    const idx = title.indexOf(sep);
    if (idx !== -1) {
      return title.slice(idx + sep.length).trim();
    }
  }
  return '';
}
