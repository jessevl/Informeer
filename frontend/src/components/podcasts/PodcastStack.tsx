/**
 * PodcastStack Component
 * Displays a podcast show as a visual stack, similar to MagazineStack.
 * The show artwork is on top with stacked layers behind indicating episode count.
 * Clicking opens an inline episodes row beneath.
 */

import { useState, useCallback } from 'react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Headphones, MoreHorizontal, Trash2, CloudOff, Check } from 'lucide-react';
import { PodcastArtwork } from './PodcastArtwork';
import type { Entry, Feed } from '@/types/api';
import { useLongPress } from '@frameer/hooks';

export interface PodcastGroup {
  feedId: number;
  feed: Feed;
  episodes: Entry[];
  unlistenedCount: number;
}

interface PodcastStackProps {
  group: PodcastGroup;
  onOpen: (group: PodcastGroup) => void;
  isSelected?: boolean;
  savedCount?: number;
  onUnsubscribe?: (feedId: number) => void;
  onRemoveAllSaved?: (feedId: number) => void;
}

export function PodcastStack({ group, onOpen, isSelected = false, savedCount = 0, onUnsubscribe, onRemoveAllSaved }: PodcastStackProps) {
  const { feed, episodes, unlistenedCount } = group;
  const episodeCount = episodes.length;
  const latestEpisode = episodes[0]; // Already sorted newest-first
  const [showMenu, setShowMenu] = useState(false);

  const handleUnsubscribe = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (confirm(`Unsubscribe from "${feed.title}"? This will remove the feed and all its episodes.`)) {
      onUnsubscribe?.(group.feedId);
    }
  }, [feed.title, group.feedId, onUnsubscribe]);

  const handleRemoveAllSaved = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onRemoveAllSaved?.(group.feedId);
  }, [group.feedId, onRemoveAllSaved]);

  const { longPressHandlers } = useLongPress({
    enabled: Boolean(onUnsubscribe || onRemoveAllSaved),
    onLongPress: (event) => {
      event.preventDefault();
      event.stopPropagation();
      setShowMenu(true);
    },
    duration: 450,
  });

  return (
    <div className="group relative flex flex-col gap-2.5">
      {/* Stack of podcast artwork */}
      <button
        onClick={() => onOpen(group)}
        className={cn(
          'relative cursor-pointer focus:outline-none rounded-xl',
          'transition-all duration-300',
          isSelected
            ? 'ring-2 ring-offset-2 ring-[var(--color-accent-primary)] ring-offset-[var(--color-surface-base)] scale-[1.02]'
            : 'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent-primary)] focus-visible:ring-offset-[var(--color-surface-base)]'
        )}
        onTouchStart={longPressHandlers.onTouchStart}
        onTouchMove={longPressHandlers.onTouchMove}
        onTouchEnd={longPressHandlers.onTouchEnd}
        onTouchCancel={longPressHandlers.onTouchCancel}
        onContextMenu={longPressHandlers.onContextMenu}
      >
        {/* Background stack layers — only show if more than 1 episode */}
        {episodeCount >= 3 && (
          <div
            className={cn(
              'absolute aspect-square w-full rounded-xl',
              'bg-[var(--color-surface-tertiary)]',
              'top-2 left-1.5',
              'transition-all duration-300 ease-out',
              'group-hover:top-3 group-hover:left-2',
            )}
            style={{ zIndex: 1 }}
          />
        )}
        {episodeCount >= 2 && (
          <div
            className={cn(
              'absolute aspect-square w-full rounded-xl',
              'bg-[var(--color-surface-secondary)]',
              'top-1 left-[3px]',
              'transition-all duration-300 ease-out',
              'group-hover:top-1.5 group-hover:left-1',
            )}
            style={{ zIndex: 2 }}
          />
        )}

        {/* Top cover — podcast artwork */}
        <div
          className={cn(
            'relative aspect-square w-full overflow-hidden rounded-xl',
            'bg-[var(--color-surface-secondary)]',
            'shadow-md hover:shadow-xl',
            'transition-all duration-300 ease-out',
            'group-hover:scale-[1.02] group-hover:-translate-y-1',
          )}
          style={{ zIndex: 3 }}
        >
          <PodcastArtwork
            feedId={feed.id}
            feedTitle={feed.title}
            iconId={feed.icon?.icon_id}
            size={200}
            className="w-full h-full"
          />

          {/* Hover overlay */}
          <div className={cn(
            'absolute inset-0 flex items-center justify-center',
            'bg-black/0 group-hover:bg-black/30',
            'transition-all duration-300',
            'opacity-0 group-hover:opacity-100',
            'eink-media-overlay-hover'
          )}>
            <span className="text-white text-sm font-medium px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm eink-media-chip">
              {episodeCount} {episodeCount === 1 ? 'episode' : 'episodes'}
            </span>
          </div>

          {/* Unplayed badge */}
          {unlistenedCount > 0 && (
            <div
              className={cn(
                'absolute top-2 right-2 min-w-[22px] h-[22px]',
                'flex items-center justify-center',
                'px-1.5 rounded-full text-[11px] font-semibold',
                'bg-[var(--color-accent-primary)] text-white',
                'pointer-events-none'
              )}
              style={{ zIndex: 5 }}
            >
              {unlistenedCount}
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
        </div>
      </button>

      {/* Context menu button */}
      {(onUnsubscribe || onRemoveAllSaved) && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          className={cn(
            'absolute top-1.5 right-1.5 w-7 h-7 rounded-full',
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
                {savedCount > 0 && <div className="h-px bg-[var(--color-border-default)] mx-2" />}
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
              : 'text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]'
          )}
          onClick={() => onOpen(group)}
        >
          {feed.title}
        </h3>
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
          {latestEpisode && (
            <span className="truncate">{formatRelativeTime(latestEpisode.published_at)}</span>
          )}
          {episodeCount > 1 && (
            <span className="shrink-0 ml-auto">
              {episodeCount} eps
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
