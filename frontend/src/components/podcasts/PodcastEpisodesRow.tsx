/**
 * PodcastEpisodesRow Component
 * An animated expandable row that shows episodes for a selected podcast show.
 * Appears inline beneath the selected PodcastStack in the grid.
 * Similar to MagazineIssuesRow but displays episode list items.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils';
import { Clock, CheckCircle, X, ChevronUp, ChevronDown, Play, PlayCircle, ListPlus, CloudOff, Check, Loader2 } from 'lucide-react';
import { savePodcastOffline, removeOfflineItem } from '@/lib/offline/blob-cache';
import { useIsOffline } from '@/stores/offline';
import { api } from '@/api/client';
import { PodcastArtwork } from './PodcastArtwork';
import { PlayButton } from '@/components/player/PlayButton';
import { useAudioStore } from '@/stores/audio';
import { useMediaQueueStore } from '@/stores/mediaQueue';
import type { PodcastGroup } from './PodcastStack';
import type { Entry, Enclosure } from '@/types/api';

function getAudioEnclosure(entry: Entry): Enclosure | null {
  return entry.enclosures?.find(e => e.mime_type?.startsWith('audio/')) ?? null;
}

interface PodcastEpisodesRowProps {
  group: PodcastGroup;
  isOpen: boolean;
  onClose: () => void;
  /** Called after the close animation finishes — parent should unmount */
  onClosed?: () => void;
  onSelectEntry: (entry: Entry) => void;
  onPlayAll: () => void;
}

export function PodcastEpisodesRow({
  group,
  isOpen,
  onClose,
  onClosed,
  onSelectEntry,
  onPlayAll,
}: PodcastEpisodesRowProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const { isEntryListened, currentEnclosure } = useAudioStore();
  const { addAudioToQueue, isAudioQueued } = useMediaQueueStore();

  const PAGE_SIZE = 20;
  const INITIAL_COUNT = 5;
  const [loadedCount, setLoadedCount] = useState(INITIAL_COUNT);
  const hasMore = group.episodes.length > loadedCount;
  const visibleEpisodes = group.episodes.slice(0, loadedCount);

  // Measure the content height for the animation
  useEffect(() => {
    if (isOpen && contentRef.current) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          setMeasuredHeight(contentRef.current.scrollHeight);
        }
      });
      setIsAnimating(true);
      const timer = setTimeout(() => setIsVisible(true), 20);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => {
        setIsAnimating(false);
        setLoadedCount(INITIAL_COUNT);
        onClosed?.();
      }, 380);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Re-measure when loaded count changes or window resizes
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      if (contentRef.current) {
        setMeasuredHeight(contentRef.current.scrollHeight);
      }
    });
  }, [isOpen, loadedCount, visibleEpisodes.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handleResize = () => {
      if (contentRef.current) {
        setMeasuredHeight(contentRef.current.scrollHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

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
        {/* Decorative top edge */}
        <div className="mx-6 mb-0 mt-1">
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-default)] to-transparent" />
        </div>

        {/* Header row */}
        <div className="flex items-center justify-between px-6 pt-3 pb-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-[var(--color-surface-tertiary)]">
              <PodcastArtwork feedId={group.feed.id} feedTitle={group.feed.title} iconId={group.feed.icon?.icon_id} size={32} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                {group.feed.title}
              </h3>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {group.episodes.length} {group.episodes.length === 1 ? 'episode' : 'episodes'}
                {group.unlistenedCount > 0 && (
                  <span className="ml-1 text-[var(--color-accent-fg)]">
                    · {group.unlistenedCount} unplayed
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Play All button */}
            <button
              onClick={onPlayAll}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                'bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-hover)]',
                'shadow-sm hover:shadow-md'
              )}
            >
              <PlayCircle size={14} />
              Play All
            </button>
            <button
              onClick={onClose}
              className={cn(
                'p-1.5 rounded-full transition-colors',
                'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]'
              )}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Episode list */}
        <div className="px-4 pb-4">
          <div className="space-y-0.5">
            {visibleEpisodes.map((entry, index) => {
              const enclosure = getAudioEnclosure(entry);
              if (!enclosure) return null;

              const duration = enclosure.size ? Math.floor(enclosure.size / 16000) : 0;
              const progress = enclosure.media_progression || 0;
              const hasProgress = progress > 0;
              const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;
              const listened = isEntryListened(entry.id);
              const isPlaying = currentEnclosure?.id === enclosure.id;

              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer',
                    'hover:bg-[var(--color-surface-hover)]',
                    listened && 'opacity-50',
                    isPlaying && 'bg-[var(--color-accent-muted)]/30'
                  )}
                  onClick={() => onSelectEntry(entry)}
                  style={{
                    animationDelay: `${index * 30}ms`,
                    animation: isVisible ? `fadeSlideIn 200ms ease-out ${index * 30}ms both` : undefined,
                  }}
                >
                  {/* Play button */}
                  <div className="shrink-0">
                    <PlayButton entry={entry} enclosure={enclosure} size="sm" />
                  </div>

                  {/* Episode info */}
                  <div className="flex-1 min-w-0">
                    <h4 className={cn(
                      'text-sm font-medium line-clamp-1',
                      listened
                        ? 'text-[var(--color-text-tertiary)]'
                        : 'text-[var(--color-text-primary)]'
                    )}>
                      {entry.title}
                    </h4>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-[var(--color-text-tertiary)]">
                      <span>{formatRelativeTime(entry.published_at)}</span>
                      {duration > 0 && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {formatDuration(duration)}
                          </span>
                        </>
                      )}
                      {listened && (
                        <>
                          <span>·</span>
                          <CheckCircle size={11} className="text-[var(--color-success-fg)]" />
                        </>
                      )}
                    </div>
                    {/* Progress bar */}
                    {hasProgress && !listened && (
                      <div className="mt-1.5 h-0.5 bg-[var(--color-surface-tertiary)] rounded-full overflow-hidden max-w-[200px]">
                        <div
                          className="h-full bg-[var(--color-accent-primary)] rounded-full"
                          style={{ width: `${Math.min(progressPercent, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Offline save button */}
                  <EpisodeOfflineButton enclosure={enclosure} entry={entry} feedTitle={group.feed.title} />

                  {/* Queue button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); addAudioToQueue(enclosure, entry); }}
                    className={cn(
                      'shrink-0 p-1.5 rounded-full transition-colors',
                      isAudioQueued(enclosure.id)
                        ? 'text-[var(--color-accent-fg)]'
                        : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                    )}
                    title={isAudioQueued(enclosure.id) ? 'Already in queue' : 'Add to queue'}
                    disabled={isAudioQueued(enclosure.id)}
                  >
                    <ListPlus size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Load more / collapse */}
          {group.episodes.length > INITIAL_COUNT && (
            <div className="flex items-center gap-2 mt-2">
              {hasMore && (
                <button
                  onClick={() => setLoadedCount(prev => Math.min(prev + PAGE_SIZE, group.episodes.length))}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg',
                    'text-xs font-medium text-[var(--color-text-secondary)]',
                    'hover:bg-[var(--color-surface-hover)] transition-colors'
                  )}
                >
                  <ChevronDown size={14} />
                  Load more ({group.episodes.length - loadedCount} remaining)
                </button>
              )}
              {loadedCount > INITIAL_COUNT && (
                <button
                  onClick={() => setLoadedCount(INITIAL_COUNT)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg',
                    'text-xs font-medium text-[var(--color-text-tertiary)]',
                    'hover:bg-[var(--color-surface-hover)] transition-colors'
                  )}
                >
                  <ChevronUp size={14} />
                  Collapse
                </button>
              )}
            </div>
          )}
        </div>

        {/* Bottom edge */}
        <div className="mx-6 mt-0 mb-1">
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-default)] to-transparent" />
        </div>
      </div>
    </div>
  );
}

// Small inline component so each episode can independently track its offline state
function EpisodeOfflineButton({ enclosure, entry, feedTitle }: { enclosure: Enclosure; entry: Entry; feedTitle?: string }) {
  const saved = useIsOffline('podcast', String(enclosure.id));
  const [saving, setSaving] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saved) {
      await removeOfflineItem(`/offline/podcasts/${enclosure.id}`);
      return;
    }
    setSaving(true);
    try {
      await savePodcastOffline(enclosure.id, entry.title, enclosure.url, api.getAuthHeader(), feedTitle);
    } catch (err) {
      console.error('[offline] podcast save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={saving}
      className={cn(
        'shrink-0 p-1.5 rounded-full transition-colors',
        saved
          ? 'text-emerald-500'
          : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
        'disabled:opacity-50'
      )}
      title={saving ? 'Saving…' : saved ? 'Remove from offline' : 'Save for offline'}
    >
      {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <CloudOff size={14} />}
    </button>
  );
}
