/**
 * MagazineIssuesPanel Component
 * Displays all issues from a single magazine (feed) when a stack is tapped.
 * Shows issues in a grid sorted by parsed date, with the ability to open PDFs.
 * Slides in from the right with a transition.
 */

import { useCallback, useState } from 'react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { ArrowLeft, BookOpen, Eye, CloudOff, Check, Loader2 } from 'lucide-react';
import type { MagazineIssue } from '@/stores/magazines';
import type { MagazineGroup } from './MagazineStack';
import { api } from '@/api/client';
import { saveMagazineOffline, removeOfflineItem } from '@/lib/offline/blob-cache';
import { useIsOffline } from '@/stores/offline';

interface ReadingProgress {
  maxPage: number;
  totalPages: number;
}

interface MagazineIssuesPanelProps {
  group: MagazineGroup;
  onBack: () => void;
  onOpenIssue: (issue: MagazineIssue) => void;
  progressMap?: Record<string, ReadingProgress>;
}

export function MagazineIssuesPanel({
  group,
  onBack,
  onOpenIssue,
  progressMap = {},
}: MagazineIssuesPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 pt-14 md:pt-16 px-4 pb-3 border-b border-[var(--color-border-default)]">
        <button
          onClick={onBack}
          className={cn(
            'shrink-0 w-9 h-9 rounded-full flex items-center justify-center',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
            'transition-colors'
          )}
          aria-label="Back to all magazines"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex flex-col min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] truncate">
            {group.feedTitle}
          </h2>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {group.issues.length} {group.issues.length === 1 ? 'issue' : 'issues'}
          </p>
        </div>
      </div>

      {/* Issues grid */}
      <div className="flex-1 overflow-y-auto">
        <div className={cn(
          'grid gap-6 p-6',
          'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
        )}>
          {group.issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              feedTitle={group.feedTitle}
              onOpen={() => onOpenIssue(issue)}
              progress={progressMap[issue.id]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== Issue Card ====================

interface IssueCardProps {
  issue: MagazineIssue;
  feedTitle: string;
  onOpen: () => void;
  progress?: ReadingProgress;
}

function IssueCard({ issue, feedTitle, onOpen, progress }: IssueCardProps) {
  const hasProgress = progress && progress.maxPage > 0 && progress.totalPages > 0;
  const progressPercent = hasProgress ? (progress.maxPage / progress.totalPages) * 100 : 0;
  const isFinished = progressPercent > 90;

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

  // Extract just the date/issue part from the title
  const displayLabel = extractIssueLabel(issue.title, feedTitle);

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
            <BookOpen size={32} className="text-[var(--color-text-tertiary)] opacity-40" />
          </div>
        )}

        {/* Hover overlay */}
        <div className={cn(
          'absolute inset-0 flex items-center justify-center',
          'bg-black/0 group-hover:bg-black/40',
          'transition-all duration-300',
          'opacity-0 group-hover:opacity-100'
        )}>
          <div className={cn(
            'p-3 rounded-full',
            'bg-white/90 text-black',
            'shadow-lg',
            'transform scale-75 group-hover:scale-100',
            'transition-transform duration-300'
          )}>
            <Eye size={20} />
          </div>
        </div>

        {/* Magazine spine */}
        <div className={cn(
          'absolute inset-y-0 left-0 w-1.5',
          'bg-gradient-to-r from-black/20 to-transparent',
          'pointer-events-none'
        )} />

        {/* Progress bar */}
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
            'absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center',
            'backdrop-blur-sm transition-all z-10',
            'eink-media-action',
            isSavedOffline
              ? 'bg-emerald-500/80 text-white opacity-100 hover:bg-emerald-600/90'
              : 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-black/60',
          )}
          title={isSavedOffline ? 'Remove offline copy' : 'Save for offline'}
        >
          {isSavingOffline ? (
            <Loader2 size={10} className="animate-spin" />
          ) : isSavedOffline ? (
            <Check size={10} />
          ) : (
            <CloudOff size={10} />
          )}
        </button>
      </button>

      {/* Title & Meta */}
      <div className="flex flex-col gap-0.5 px-0.5">
        <h3
          className={cn(
            'text-xs font-medium leading-tight',
            'text-[var(--color-text-primary)]',
            'line-clamp-2',
            'group-hover:text-[var(--color-accent)]',
            'transition-colors cursor-pointer'
          )}
          onClick={onOpen}
        >
          {displayLabel || issue.title}
        </h3>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
          {issue.pubDate && (
            <span>{formatRelativeDate(issue.pubDate)}</span>
          )}
          {hasProgress && (
            <span className="shrink-0 ml-auto">
              p.{progress.maxPage}/{progress.totalPages}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Extract the issue-specific label from the full title.
 * E.g. "The Economist UK – 14-20 February 2026" → "14-20 February 2026"
 */
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

/**
 * Format a date string as DD/MM/YYYY.
 */
function formatRelativeDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}
