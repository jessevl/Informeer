/**
 * PodcastsView Component
 * Dedicated view for podcasts with two modes:
 * - Shows (default): Visual stacks grid like MagazinesView, with inline episode rows
 * - Saved: Offline/downloaded episodes
 */

import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils';
import {
  Play,
  Clock,
  Radio,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Folder,
  LayoutGrid,
  ListPlus,
  CloudOff,
  Check,
  Loader2,
} from 'lucide-react';
import { PodcastArtwork } from './PodcastArtwork';
import { PlayButton } from '@/components/player/PlayButton';
import { useAudioStore } from '@/stores/audio';
import { useMediaQueueStore } from '@/stores/mediaQueue';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/layout/PullToRefreshIndicator';
import { useSettingsStore } from '@/stores/settings';
import { PodcastStack } from './PodcastStack';
import type { PodcastGroup } from './PodcastStack';
import { PodcastEpisodesRow } from './PodcastEpisodesRow';
import type { Entry, Feed, Enclosure } from '@/types/api';
import { savePodcastOffline, removeOfflineItem } from '@/lib/offline/blob-cache';
import { useIsOffline, useOfflineStore, useOfflineRegistry } from '@/stores/offline';
import { api } from '@/api/client';
import { useFeedsStore } from '@/stores/feeds';
import { FilterBar } from '@/components/ui/FilterBar';
import { useEffectiveOfflineState } from '@/hooks/useEffectiveOfflineState';
import {
  PaginatedOverviewSurface,
  useMeasuredContainerSize,
  usePaginatedItems,
  useResponsiveGridPageSize,
  useResponsiveListPageSize,
} from '@/components/overview/PaginatedOverview';

type PodcastViewMode = 'shows' | 'saved';

interface PodcastsViewProps {
  feeds: Feed[];
  entries: Entry[];
  onSelectEntry: (entry: Entry) => void;
  onPlaySeries: (feedId: number, entries: Entry[]) => void;
  onPlayAllRecent: (entries: Entry[]) => void;
  onRefresh?: () => Promise<void>;
}

// Helper to get audio enclosure from entry
function getAudioEnclosure(entry: Entry): Enclosure | null {
  return entry.enclosures?.find(e => e.mime_type?.startsWith('audio/')) ?? null;
}

/** Breakpoint -> column count, must stay in sync with the grid-cols-* classes */
function useGridColumns() {
  const [cols, setCols] = useState(() => getColCount());
  useEffect(() => {
    const onResize = () => setCols(getColCount());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return cols;
}

function getColCount(): number {
  const w = window.innerWidth;
  if (w >= 1280) return 6; // xl
  if (w >= 1024) return 5; // lg
  if (w >= 768) return 4;  // md
  if (w >= 640) return 4;  // sm
  return 3;                // default
}

function usePaginatedGridColumns() {
  const [cols, setCols] = useState(() => getPaginatedColCount());
  useEffect(() => {
    const onResize = () => setCols(getPaginatedColCount());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return cols;
}

function getPaginatedColCount(): number {
  const w = window.innerWidth;
  if (w >= 1700) return 8;
  if (w >= 1450) return 7;
  if (w >= 1200) return 6;
  if (w >= 900) return 5;
  if (w >= 640) return 4;
  return 3;
}

// ==================== Episode Card (for Recent view) ====================

function EpisodeCard({
  entry,
  onSelect,
  showFeedInfo = true,
  isListened = false,
}: {
  entry: Entry;
  onSelect?: () => void;
  showFeedInfo?: boolean;
  isListened?: boolean;
}) {
  const enclosure = getAudioEnclosure(entry);
  const { currentEnclosure } = useAudioStore();
  const { addAudioToQueue, isAudioQueued } = useMediaQueueStore();

  if (!enclosure) return null;

  const duration = enclosure.size ? Math.floor(enclosure.size / 16000) : 0;
  const progress = enclosure.media_progression || 0;
  const hasProgress = progress > 0;
  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;
  const isCurrentlyPlaying = currentEnclosure?.id === enclosure.id;

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-xl transition-colors cursor-pointer",
        "hover:bg-[var(--color-surface-hover)]",
        isListened && "opacity-60"
      )}
      onClick={onSelect}
    >
      <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-[var(--color-surface-tertiary)]">
        <PodcastArtwork feedId={entry.feed_id} feedTitle={entry.feed?.title || ''} iconId={entry.feed?.icon?.icon_id} size={56} />
        {enclosure && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
            <PlayButton entry={entry} enclosure={enclosure} size="sm" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className={cn(
          "text-sm font-medium text-[var(--color-text-primary)] line-clamp-2",
          isListened && "text-[var(--color-text-tertiary)]"
        )}>
          {entry.title}
        </h4>

        {showFeedInfo && (
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 truncate">
            {entry.feed?.title}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1.5 text-xs text-[var(--color-text-tertiary)]">
          <span>{formatRelativeTime(entry.published_at)}</span>
          {duration > 0 && (
            <>
              <span>&middot;</span>
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {formatDuration(duration)}
              </span>
            </>
          )}
          {isListened && (
            <>
              <span>&middot;</span>
              <span className="flex items-center gap-1 text-[var(--color-success-fg)]">
                <CheckCircle size={12} />
                Played
              </span>
            </>
          )}
        </div>

        {hasProgress && !isListened && (
          <div className="mt-2 h-1 bg-[var(--color-surface-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent-primary)] rounded-full transition-all"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
        )}
      </div>

      {!isCurrentlyPlaying && <div className="w-8" />}

      {/* Offline save button */}
      {enclosure && <EpisodeOfflineButton enclosure={enclosure} entry={entry} />}

      {/* Queue button */}
      {enclosure && (
        <button
          onClick={(e) => { e.stopPropagation(); addAudioToQueue(enclosure, entry); }}
          className={cn(
            'self-start shrink-0 p-1.5 rounded-full transition-colors mt-3',
            isAudioQueued(enclosure.id)
              ? 'text-[var(--color-accent-fg)]'
              : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
          )}
          title={isAudioQueued(enclosure.id) ? 'Already in queue' : 'Add to queue'}
          disabled={isAudioQueued(enclosure.id)}
        >
          <ListPlus size={16} />
        </button>
      )}
    </div>
  );
}

// ==================== Main PodcastsView ====================

export function PodcastsView({
  feeds,
  entries,
  onSelectEntry,
  onPlaySeries,
  onPlayAllRecent,
  onRefresh,
}: PodcastsViewProps) {
  const { isEntryListened, playSeriesFromEntry } = useAudioStore();
  const { addAudioToQueue, isAudioQueued } = useMediaQueueStore();
  const deleteFeed = useFeedsStore(s => s.deleteFeed);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recentScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const audioCategoryId = useSettingsStore((s) => s.audioCategoryId);
  const einkMode = useSettingsStore((s) => s.einkMode);
  const { effectiveOffline } = useEffectiveOfflineState();
  const gridColumns = useGridColumns();
  const paginatedGridColumns = usePaginatedGridColumns();
  const showsOverviewRef = useRef<HTMLDivElement>(null);
  const savedOverviewRef = useRef<HTMLDivElement>(null);
  const showsOverviewSize = useMeasuredContainerSize(showsOverviewRef);
  const savedOverviewSize = useMeasuredContainerSize(savedOverviewRef);

  // View mode toggle: shows (stacks) vs saved (offline)
  const [podcastViewMode, setPodcastViewMode] = useState<PodcastViewMode>('shows');

  // Force 'saved' mode when global offline mode is on
  const effectiveViewMode = effectiveOffline ? 'saved' : podcastViewMode;

  // Stacks selection state
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [mountedFeedId, setMountedFeedId] = useState<number | null>(null);

  // Pull-to-refresh
  const defaultRefresh = useCallback(async () => {}, []);
  const { pullDistance, isRefreshing: isPTRRefreshing, isPulling, progress } = usePullToRefresh({
    scrollRef,
    onRefresh: onRefresh || defaultRefresh,
    enabled: !!onRefresh,
  });

  // Get podcast feeds from the configured category
  const podcastFeeds = useMemo(() =>
    audioCategoryId ? feeds.filter(f => f.category?.id === audioCategoryId) : [],
    [feeds, audioCategoryId]
  );

  // Get podcast feed IDs
  const podcastFeedIds = useMemo(() => new Set(podcastFeeds.map(f => f.id)), [podcastFeeds]);

  // Recent episodes (for recent view) — all matching, sorted
  const allRecentEpisodes = useMemo(() =>
    entries
      .filter(e => podcastFeedIds.has(e.feed_id) && getAudioEnclosure(e))
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()),
    [entries, podcastFeedIds]
  );

  // Recent episodes for horizontal scroll row (top 25)
  const recentRowEpisodes = allRecentEpisodes.slice(0, 25);

  // Recent row scroll state
  const updateRecentScrollState = useCallback(() => {
    const el = recentScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = recentScrollRef.current;
    if (!el) return;
    updateRecentScrollState();
    el.addEventListener('scroll', updateRecentScrollState, { passive: true });
    return () => el.removeEventListener('scroll', updateRecentScrollState);
  }, [recentRowEpisodes.length, updateRecentScrollState]);

  const scrollRecent = useCallback((dir: 'left' | 'right') => {
    const el = recentScrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  }, []);

  // Build set of offline-available enclosure IDs for "saved" view
  const offlineRegistry = useOfflineRegistry();
  const offlinePodcastIds = useMemo(() => {
    if (effectiveViewMode !== 'saved') return new Set<string>();
    return new Set(offlineRegistry.filter(i => i.type === 'podcast').map(i => i.id));
  }, [effectiveViewMode, offlineRegistry]);

  // Saved-offline episodes filtered from allRecentEpisodes
  const savedEpisodes = useMemo(() => {
    if (effectiveViewMode !== 'saved') return [];
    return allRecentEpisodes.filter(e => {
      const enc = getAudioEnclosure(e);
      return enc && offlinePodcastIds.has(String(enc.id));
    });
  }, [allRecentEpisodes, offlinePodcastIds, effectiveViewMode]);
  const showsPerPage = useResponsiveGridPageSize({
    columns: paginatedGridColumns,
    aspectRatio: 1,
    metaHeight: 72,
    containerSize: showsOverviewSize,
    gap: 16,
    chromeOffset: recentRowEpisodes.length > 0 ? 430 : 270,
  });
  const savedEpisodesPerPage = useResponsiveListPageSize({
    itemHeight: 104,
    containerSize: savedOverviewSize,
    gap: 4,
    chromeOffset: recentRowEpisodes.length > 0 ? 430 : 270,
  });

  // Build podcast groups (for shows/stacks view)
  const podcastGroups = useMemo((): PodcastGroup[] => {
    const feedMap = new Map<number, Entry[]>();

    for (const entry of entries) {
      if (!podcastFeedIds.has(entry.feed_id)) continue;
      if (!getAudioEnclosure(entry)) continue;

      if (!feedMap.has(entry.feed_id)) {
        feedMap.set(entry.feed_id, []);
      }
      feedMap.get(entry.feed_id)!.push(entry);
    }

    const groups: PodcastGroup[] = [];

    for (const [feedId, episodes] of feedMap) {
      const feed = podcastFeeds.find(f => f.id === feedId);
      if (!feed) continue;

      // Sort newest first
      episodes.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

      const unlistenedCount = episodes.filter(e => !isEntryListened(e.id)).length;

      groups.push({
        feedId,
        feed,
        episodes,
        unlistenedCount,
      });
    }

    // Sort podcast overview alphabetically by show title.
    // Keep per-show episodes newest-first and leave the recent episodes row untouched.
    groups.sort((a, b) => a.feed.title.localeCompare(b.feed.title, undefined, { sensitivity: 'base' }));

    return groups;
  }, [entries, podcastFeedIds, podcastFeeds, isEntryListened]);

  // Compute saved-offline counts per podcast feed
  const savedCountByFeed = useMemo(() => {
    const podItems = offlineRegistry.filter(i => i.type === 'podcast');
    const podItemIds = new Set(podItems.map(i => i.id));
    const counts: Record<number, number> = {};
    for (const group of podcastGroups) {
      let count = 0;
      for (const ep of group.episodes) {
        const enc = ep.enclosures?.find(e => e.mime_type?.startsWith('audio/'));
        if (enc && podItemIds.has(String(enc.id))) count++;
      }
      counts[group.feedId] = count;
    }
    return counts;
  }, [podcastGroups, offlineRegistry]);
  const pagedPodcastGroups = usePaginatedItems(podcastGroups, showsPerPage);
  const pagedSavedEpisodes = usePaginatedItems(savedEpisodes, savedEpisodesPerPage);
  const visiblePodcastGroups = einkMode ? pagedPodcastGroups.pageItems : podcastGroups;
  const visibleSavedEpisodes = einkMode ? pagedSavedEpisodes.pageItems : savedEpisodes;
  const visibleShowColumns = einkMode ? paginatedGridColumns : gridColumns;

  useEffect(() => {
    const visibleFeedIds = new Set(visiblePodcastGroups.map((group) => group.feedId));

    if (selectedFeedId !== null && !visibleFeedIds.has(selectedFeedId)) {
      setSelectedFeedId(null);
    }

    if (mountedFeedId !== null && !visibleFeedIds.has(mountedFeedId)) {
      setMountedFeedId(null);
    }
  }, [visiblePodcastGroups, selectedFeedId, mountedFeedId]);

  // Toggle a group open/closed
  const handleToggleGroup = useCallback((group: PodcastGroup) => {
    setSelectedFeedId(prev => {
      const next = prev === group.feedId ? null : group.feedId;
      if (next !== null) {
        setMountedFeedId(next);
      }
      return next;
    });
  }, []);

  const handleRowClosed = useCallback(() => {
    setMountedFeedId(null);
  }, []);

  // Handle unsubscribe (delete the podcast feed)
  const handleUnsubscribe = useCallback(async (feedId: number) => {
    try {
      await deleteFeed(feedId);
      if (selectedFeedId === feedId) setSelectedFeedId(null);
    } catch (err) {
      console.error('[podcasts] Failed to unsubscribe:', err);
    }
  }, [deleteFeed, selectedFeedId]);

  // Handle removing all saved episodes for a feed
  const handleRemoveAllSaved = useCallback(async (feedId: number) => {
    const registry = useOfflineStore.getState().registry;
    const group = podcastGroups.find(g => g.feedId === feedId);
    if (!group) return;
    const enclosureIds = new Set<string>();
    for (const ep of group.episodes) {
      const enc = ep.enclosures?.find(e => e.mime_type?.startsWith('audio/'));
      if (enc) enclosureIds.add(String(enc.id));
    }
    const toRemove = registry.filter(i => i.type === 'podcast' && enclosureIds.has(i.id));
    for (const item of toRemove) {
      await removeOfflineItem(item.cacheKey);
    }
  }, [podcastGroups]);

  // Handle play series from feed
  const handlePlaySeries = useCallback((feed: Feed) => {
    const feedEntries = entries.filter(e => e.feed_id === feed.id);
    playSeriesFromEntry(feed.id, feedEntries);
  }, [entries, playSeriesFromEntry]);

  // Empty state
  if (!audioCategoryId) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-[var(--color-surface-secondary)] flex items-center justify-center mb-4">
          <Folder size={40} className="text-[var(--color-text-tertiary)]" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
          Audio Not Configured
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)] max-w-sm">
          Assign a category to the Audio section in Settings to see your podcasts here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Pull-to-refresh indicator */}
      <PullToRefreshIndicator
        pullDistance={pullDistance}
        isRefreshing={isPTRRefreshing}
        isPulling={isPulling}
        progress={progress}
      />

      {/* Main Content Area */}
      <div
        ref={scrollRef}
        className="flex flex-1 min-h-0 flex-col overflow-y-auto overflow-x-hidden content-below-header content-above-navbar"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: isPulling ? 'none' : 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* View mode toggle bar */}
        {!effectiveOffline && (
          <FilterBar
            groups={[{
              options: [
                { value: 'shows' as const, label: 'Shows', icon: LayoutGrid },
                { value: 'saved' as const, label: 'Saved', icon: CloudOff },
              ],
              value: effectiveViewMode,
              onChange: setPodcastViewMode,
            }]}
          />
        )}

        {/* Recent Episodes horizontal scroll row */}
        {recentRowEpisodes.length > 0 && (
          <div className="pt-3 pb-3 bg-[var(--color-surface-base)]/50 border-b border-[var(--color-border-subtle)]">
            <div className="flex items-center justify-between px-4 mb-2">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Recent Episodes
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => scrollRecent('left')}
                  disabled={!canScrollLeft}
                  className={cn(
                    'p-1 rounded-full transition-colors',
                    canScrollLeft
                      ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-disabled)] cursor-default'
                  )}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={() => scrollRecent('right')}
                  disabled={!canScrollRight}
                  className={cn(
                    'p-1 rounded-full transition-colors',
                    canScrollRight
                      ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-disabled)] cursor-default'
                  )}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div
              ref={recentScrollRef}
              className="flex gap-3 overflow-x-auto pb-2 px-4 scrollbar-hide"
            >
              {recentRowEpisodes.map(entry => {
                const enc = getAudioEnclosure(entry)!;
                return (
                  <div
                    key={entry.id}
                    className="flex-shrink-0 w-36 group"
                  >
                    <div className="relative w-36 h-36 rounded-xl overflow-hidden bg-[var(--color-surface-tertiary)] mb-1.5">
                      <button
                        onClick={() => onSelectEntry(entry)}
                        className="w-full h-full"
                      >
                        <PodcastArtwork feedId={entry.feed_id} feedTitle={entry.feed?.title || ''} iconId={entry.feed?.icon?.icon_id} size={144} />
                      </button>
                      {/* Play button overlay */}
                      <div className="absolute bottom-1.5 right-1.5">
                        <PlayButton entry={entry} enclosure={enc} size="sm" />
                      </div>
                      {/* Queue button overlay */}
                      <button
                        onClick={(e) => { e.stopPropagation(); addAudioToQueue(enc, entry); }}
                        className={cn(
                          'absolute bottom-1.5 left-1.5 p-1.5 rounded-full transition-colors',
                          'bg-black/40 backdrop-blur-sm eink-media-action',
                          isAudioQueued(enc.id)
                            ? 'text-[var(--color-accent-fg)]'
                            : 'text-white/80 hover:text-white hover:bg-black/60'
                        )}
                        title={isAudioQueued(enc.id) ? 'Already in queue' : 'Add to queue'}
                        disabled={isAudioQueued(enc.id)}
                      >
                        <ListPlus size={14} />
                      </button>
                    </div>
                    <button
                      onClick={() => onSelectEntry(entry)}
                      className="block text-left w-full"
                    >
                      <p className="text-xs font-medium text-[var(--color-text-primary)] line-clamp-2">
                        {entry.title}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-tertiary)] truncate">
                        {entry.feed?.title}
                      </p>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {effectiveViewMode === 'shows' ? (
          /* ==================== Shows (Stacks) View ==================== */
          podcastGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-tertiary)]">
              <Radio size={48} className="mb-4 opacity-30" />
              <p className="text-sm">No podcast shows loaded yet</p>
            </div>
          ) : (
            <div ref={showsOverviewRef} className="flex-1 min-h-0">
              {einkMode ? (
                <PaginatedOverviewSurface
                  currentPage={pagedPodcastGroups.currentPage}
                  pageCount={pagedPodcastGroups.pageCount}
                  totalItems={podcastGroups.length}
                  rangeStart={pagedPodcastGroups.rangeStart}
                  rangeEnd={pagedPodcastGroups.rangeEnd}
                  onPrevPage={pagedPodcastGroups.goToPrevPage}
                  onNextPage={pagedPodcastGroups.goToNextPage}
                >
                  <div
                    className="grid gap-x-4 gap-y-4 p-4"
                    style={{ gridTemplateColumns: `repeat(${visibleShowColumns}, minmax(0, 1fr))` }}
                  >
                    {renderStacksWithEpisodeRow(
                      visiblePodcastGroups,
                      visibleShowColumns,
                      selectedFeedId,
                      mountedFeedId,
                      handleToggleGroup,
                      handleRowClosed,
                      setSelectedFeedId,
                      onSelectEntry,
                      entries,
                      playSeriesFromEntry,
                      savedCountByFeed,
                      handleUnsubscribe,
                      handleRemoveAllSaved,
                    )}
                  </div>
                </PaginatedOverviewSurface>
              ) : (
                <div
                  className={cn(
                    'grid gap-x-4 gap-y-4 p-4',
                    'grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                  )}
                >
                  {renderStacksWithEpisodeRow(
                    visiblePodcastGroups,
                    visibleShowColumns,
                    selectedFeedId,
                    mountedFeedId,
                    handleToggleGroup,
                    handleRowClosed,
                    setSelectedFeedId,
                    onSelectEntry,
                    entries,
                    playSeriesFromEntry,
                    savedCountByFeed,
                    handleUnsubscribe,
                    handleRemoveAllSaved,
                  )}
                </div>
              )}
            </div>
          )
        ) : (
          /* ==================== Saved (Offline) View ==================== */
          <div className="flex flex-1 min-h-0 flex-col p-2">
            {savedEpisodes.length === 0 ? (
              <div className="text-center py-12 text-[var(--color-text-tertiary)]">
                <CloudOff size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-sm">No episodes saved for offline use</p>
                <p className="text-xs mt-1 text-[var(--color-text-tertiary)]">
                  Use the <CloudOff size={11} className="inline -mt-0.5" /> button on any episode to save it
                </p>
              </div>
            ) : (
              <div ref={savedOverviewRef} className="flex-1 min-h-0">
                {einkMode ? (
                  <PaginatedOverviewSurface
                    currentPage={pagedSavedEpisodes.currentPage}
                    pageCount={pagedSavedEpisodes.pageCount}
                    totalItems={savedEpisodes.length}
                    rangeStart={pagedSavedEpisodes.rangeStart}
                    rangeEnd={pagedSavedEpisodes.rangeEnd}
                    onPrevPage={pagedSavedEpisodes.goToPrevPage}
                    onNextPage={pagedSavedEpisodes.goToNextPage}
                  >
                    <div className="space-y-1 pb-10">
                      {visibleSavedEpisodes.map(entry => (
                        <EpisodeCard
                          key={entry.id}
                          entry={entry}
                          onSelect={() => onSelectEntry(entry)}
                          isListened={isEntryListened(entry.id)}
                        />
                      ))}
                    </div>
                  </PaginatedOverviewSurface>
                ) : (
                  <div className="space-y-1 pb-10">
                    {visibleSavedEpisodes.map(entry => (
                      <EpisodeCard
                        key={entry.id}
                        entry={entry}
                        onSelect={() => onSelectEntry(entry)}
                        isListened={isEntryListened(entry.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Grid Row Logic ====================

/**
 * Renders podcast stacks in the CSS grid, inserting the episodes row
 * after the complete visual row that contains the selected stack.
 * Same pattern as MagazinesView's renderStacksWithIssueRow.
 */
function renderStacksWithEpisodeRow(
  groups: PodcastGroup[],
  columns: number,
  selectedFeedId: number | null,
  mountedFeedId: number | null,
  onToggle: (g: PodcastGroup) => void,
  onRowClosed: () => void,
  setSelectedFeedId: (id: number | null) => void,
  onSelectEntry: (entry: Entry) => void,
  allEntries: Entry[],
  playSeriesFromEntry: (feedId: number, entries: Entry[]) => void,
  savedCountByFeed?: Record<number, number>,
  onUnsubscribe?: (feedId: number) => void,
  onRemoveAllSaved?: (feedId: number) => void,
) {
  const activeFeedId = mountedFeedId ?? selectedFeedId;
  const selectedIdx = activeFeedId != null
    ? groups.findIndex(g => g.feedId === activeFeedId)
    : -1;

  const rowEnd = selectedIdx >= 0
    ? Math.min(Math.floor(selectedIdx / columns) * columns + columns - 1, groups.length - 1)
    : -1;

  const rowGroup = activeFeedId != null
    ? groups.find(g => g.feedId === activeFeedId)
    : null;

  const items: React.ReactNode[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    items.push(
      <PodcastStack
        key={group.feedId}
        group={group}
        onOpen={onToggle}
        isSelected={selectedFeedId === group.feedId}
        savedCount={savedCountByFeed?.[group.feedId] || 0}
        onUnsubscribe={onUnsubscribe}
        onRemoveAllSaved={onRemoveAllSaved}
      />
    );

    if (i === rowEnd && rowGroup) {
      items.push(
        <PodcastEpisodesRow
          key={`row-${rowGroup.feedId}`}
          group={rowGroup}
          isOpen={selectedFeedId === rowGroup.feedId}
          onClose={() => setSelectedFeedId(null)}
          onClosed={onRowClosed}
          onSelectEntry={onSelectEntry}
          onPlayAll={() => {
            const feedEntries = allEntries.filter(e => e.feed_id === rowGroup.feedId);
            playSeriesFromEntry(rowGroup.feedId, feedEntries);
          }}
        />
      );
    }
  }

  return items;
}

// ==================== Inline offline save button for episodes ====================

function EpisodeOfflineButton({ enclosure, entry }: { enclosure: Enclosure; entry: Entry }) {
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
      await savePodcastOffline(enclosure.id, entry.title, enclosure.url, api.getAuthHeader(), entry.feed?.title);
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
        'self-start shrink-0 p-1.5 rounded-full transition-colors mt-3',
        saved
          ? 'text-emerald-500'
          : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
        'disabled:opacity-50'
      )}
      title={saving ? 'Saving…' : saved ? 'Remove from offline' : 'Save for offline'}
    >
      {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <CloudOff size={16} />}
    </button>
  );
}

export default PodcastsView;
