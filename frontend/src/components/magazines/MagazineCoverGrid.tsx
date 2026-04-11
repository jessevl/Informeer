/**
 * MagazineCoverGrid Component
 * Displays magazine issues in a beautiful cover art grid
 * Similar to how Apple News or Zinio shows magazines
 */

import { cn, formatRelativeTime } from '@/lib/utils';
import { Download, Eye, Loader2, Check, BookOpen, CloudOff } from 'lucide-react';
import { useState, useCallback } from 'react';
import type { MagazineIssue } from '@/stores/magazines';
import { api } from '@/api/client';
import { saveMagazineOffline, removeOfflineItem } from '@/lib/offline/blob-cache';
import { useIsOffline } from '@/stores/offline';

interface ReadingProgress {
  maxPage: number;
  totalPages: number;
}

interface MagazineCoverGridProps {
  issues: MagazineIssue[];
  onOpenIssue: (issue: MagazineIssue) => void;
  onDownloadIssue?: (issue: MagazineIssue) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Reading progress keyed by entry ID (issue.id) */
  progressMap?: Record<string, ReadingProgress>;
}

export function MagazineCoverGrid({
  issues,
  onOpenIssue,
  onDownloadIssue,
  isLoading = false,
  emptyMessage = 'No magazines found',
  progressMap = {},
}: MagazineCoverGridProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-[var(--color-text-tertiary)]" />
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-tertiary)]">
        <BookOpen size={48} className="mb-4 opacity-40" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn(
      'grid gap-6 p-6',
      'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
    )}>
      {issues.map((issue) => (
        <MagazineCoverCard
          key={issue.id}
          issue={issue}
          onOpen={() => onOpenIssue(issue)}
          onDownload={onDownloadIssue ? () => onDownloadIssue(issue) : undefined}
          progress={progressMap[issue.id]}
        />
      ))}
    </div>
  );
}

// ==================== Cover Card ====================

interface MagazineCoverCardProps {
  issue: MagazineIssue;
  onOpen: () => void;
  onDownload?: () => void;
  progress?: ReadingProgress;
}

function MagazineCoverCard({ issue, onOpen, onDownload, progress }: MagazineCoverCardProps) {
  const hasProgress = progress && progress.maxPage > 0 && progress.totalPages > 0;
  const progressPercent = hasProgress ? (progress.maxPage / progress.totalPages) * 100 : 0;

  // Offline state
  const isSavedOffline = useIsOffline('magazine', issue.id);
  const [isSavingOffline, setIsSavingOffline] = useState(false);

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

  return (
    <div className="group relative flex flex-col gap-2">
      {/* Cover Image */}
      <button
        onClick={onOpen}
        className={cn(
          'relative aspect-[3/4] w-full overflow-hidden rounded-lg',
          'bg-[var(--color-surface-secondary)]',
          'border border-[var(--color-border-default)]',
          'shadow-md hover:shadow-xl',
          'transition-all duration-300 ease-out',
          'group-hover:scale-[1.02] group-hover:-translate-y-1',
          'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]',
          'cursor-pointer'
        )}
      >
        {issue.coverUrl ? (
          <img
            src={issue.coverUrl}
            alt={issue.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen size={40} className="text-[var(--color-text-tertiary)] opacity-40" />
          </div>
        )}

        {/* Hover Overlay */}
        <div className={cn(
          'absolute inset-0 flex items-center justify-center',
          'bg-black/0 group-hover:bg-black/40',
          'transition-all duration-300',
            'opacity-0 group-hover:opacity-100',
            'eink-media-overlay-hover'
        )}>
          <div className="flex items-center gap-2">
            <div className={cn(
              'p-3 rounded-full',
              'bg-white/90 text-black',
              'shadow-lg',
              'transform scale-75 group-hover:scale-100',
              'transition-transform duration-300'
            )}>
              <Eye size={22} />
            </div>
          </div>
        </div>

        {/* Magazine spine effect (left edge gradient) */}
        <div className={cn(
          'absolute inset-y-0 left-0 w-2',
          'bg-gradient-to-r from-black/20 to-transparent',
          'pointer-events-none'
        )} />

        {/* Progress bar at bottom of cover */}
        {hasProgress && (
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
            <div className="h-1 bg-black/30">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Offline badge */}
        {isSavedOffline && !isSavingOffline && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/80 text-white text-[9px] font-medium pointer-events-none backdrop-blur-sm z-10 eink-media-badge">
            <Check size={8} />
            Saved
          </div>
        )}
        {isSavingOffline && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/50 text-white text-[9px] font-medium pointer-events-none backdrop-blur-sm z-10 eink-media-badge">
            <Loader2 size={8} className="animate-spin" />
            Saving…
          </div>
        )}

        {/* Save offline button (on hover) */}
        <button
          onClick={handleToggleOffline}
          disabled={isSavingOffline}
          className={cn(
            'absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center',
            'backdrop-blur-sm transition-all z-10',
            'eink-media-action',
            isSavedOffline
              ? 'bg-emerald-500/80 text-white opacity-100 hover:bg-emerald-600/90'
              : 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-black/60',
          )}
          title={isSavedOffline ? 'Remove offline copy' : 'Save for offline'}
        >
          {isSavingOffline ? (
            <Loader2 size={12} className="animate-spin" />
          ) : isSavedOffline ? (
            <Check size={12} />
          ) : (
            <CloudOff size={12} />
          )}
        </button>
      </button>

      {/* Title & Meta */}
      <div className="flex flex-col gap-0.5 px-0.5">
        <h3
          className={cn(
            'text-sm font-medium leading-tight',
            'text-[var(--color-text-primary)]',
            'line-clamp-2',
            'group-hover:text-[var(--color-accent)]',
            'transition-colors cursor-pointer'
          )}
          onClick={onOpen}
        >
          {issue.title}
        </h3>
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-[var(--color-text-tertiary)] flex-1 truncate">
            {issue.seriesName !== issue.title ? issue.seriesName : ''}
            {issue.pubDate && (
              <span className="ml-1">{formatRelativeTime(issue.pubDate)}</span>
            )}
          </p>
          {hasProgress && (
            <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">
              p.{progress.maxPage}/{progress.totalPages}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
