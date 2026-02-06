/**
 * PodcastsView Component
 * Dedicated view for podcasts with series, recents, and queue management
 * Inspired by Pocket Casts UI
 */

import { useState, useMemo, useRef, useCallback } from 'react';
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils';
import { 
  Play, 
  Pause, 
  Clock, 
  ListMusic, 
  Radio, 
  ChevronRight,
  CheckCircle,
  Circle,
  MoreHorizontal,
  Shuffle,
  PlayCircle,
  Folder,
  ListPlus,
} from 'lucide-react';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import { PlayButton } from '@/components/player/PlayButton';
import { useAudioStore } from '@/stores/audio';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/layout/PullToRefreshIndicator';
import type { Entry, Feed, Enclosure, Category } from '@/types/miniflux';

type PodcastTab = 'recent' | 'queue' | 'history';

// Names that indicate a podcast category
const PODCAST_CATEGORY_NAMES = ['podcast', 'podcasts', 'audio', 'pod', 'shows', 'radio'];

interface PodcastsViewProps {
  feeds: Feed[];
  entries: Entry[];
  categories: Category[];
  onSelectEntry: (entry: Entry) => void;
  onPlaySeries: (feedId: number, entries: Entry[]) => void;
  onPlayAllRecent: (entries: Entry[]) => void;
  onRefresh?: () => Promise<void>;
  selectedPodcastId?: number | null;
  onSelectPodcast?: (feed: Feed | null) => void;
}

// Helper to get audio enclosure from entry
function getAudioEnclosure(entry: Entry): Enclosure | null {
  return entry.enclosures?.find(e => e.mime_type?.startsWith('audio/')) ?? null;
}

// Check if a category name indicates podcasts
function isPodcastCategory(category: Category): boolean {
  const title = category.title.toLowerCase();
  return PODCAST_CATEGORY_NAMES.some(name => title.includes(name));
}

// Get podcast categories
function getPodcastCategories(categories: Category[]): Category[] {
  return categories.filter(isPodcastCategory);
}

// Get podcast feeds (feeds in podcast categories - we assume all feeds in podcast categories are podcasts)
// This no longer filters by audio entries to avoid delay as entries load.
function getPodcastFeeds(feeds: Feed[], podcastCategories: Category[]): Feed[] {
  const categoryIds = new Set(podcastCategories.map(c => c.id));
  return feeds.filter(f => categoryIds.has(f.category?.id ?? -1));
}

// Episode Card Component
function EpisodeCard({ 
  entry, 
  onPlay,
  onSelect,
  showFeedInfo = true,
  isListened = false,
}: { 
  entry: Entry; 
  onPlay?: () => void;
  onSelect?: () => void;
  showFeedInfo?: boolean;
  isListened?: boolean;
}) {
  const enclosure = getAudioEnclosure(entry);
  const { queue, currentEnclosure, addToQueue } = useAudioStore();
  
  if (!enclosure) return null;

  const duration = enclosure.size ? Math.floor(enclosure.size / 16000) : 0; // rough estimate
  const progress = enclosure.media_progression || 0;
  const hasProgress = progress > 0;
  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;
  
  // Check if already in queue or currently playing
  const isCurrentlyPlaying = currentEnclosure?.id === enclosure.id;
  const isInQueue = queue.some(item => item.enclosure.id === enclosure.id);

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isInQueue && !isCurrentlyPlaying) {
      addToQueue(enclosure, entry);
    }
  };

  return (
    <div 
      className={cn(
        "flex items-start gap-3 p-3 rounded-xl transition-colors cursor-pointer",
        "hover:bg-[var(--color-surface-hover)]",
        isListened && "opacity-60"
      )}
      onClick={onSelect}
    >
      {/* Episode Artwork / Feed Icon */}
      <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-[var(--color-surface-tertiary)]">
        <FeedIcon feedId={entry.feed_id} iconId={entry.feed?.icon?.icon_id} size={56} />
        {/* Play overlay on hover */}
        {enclosure && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
            <PlayButton entry={entry} enclosure={enclosure} size="sm" />
          </div>
        )}
      </div>

      {/* Episode Info */}
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
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {formatDuration(duration)}
              </span>
            </>
          )}
          {isListened && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-[var(--color-success-fg)]">
                <CheckCircle size={12} />
                Played
              </span>
            </>
          )}
        </div>

        {/* Progress bar */}
        {hasProgress && !isListened && (
          <div className="mt-2 h-1 bg-[var(--color-surface-tertiary)] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[var(--color-accent-primary)] rounded-full transition-all"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Actions - Add to Queue button */}
      {!isCurrentlyPlaying && (
        <button 
          onClick={handleAddToQueue}
          disabled={isInQueue}
          className={cn(
            "p-2 rounded-full transition-colors",
            isInQueue
              ? "text-[var(--color-text-disabled)] cursor-default"
              : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]"
          )}
          title={isInQueue ? "Already in queue" : "Add to queue"}
        >
          <ListPlus size={16} />
        </button>
      )}
    </div>
  );
}

// Show Card Component (Podcast Series) - Tiled/Card View
function ShowCard({ 
  feed, 
  episodeCount,
  unlistenedCount,
  onSelect,
  onPlayAll,
}: { 
  feed: Feed; 
  episodeCount: number;
  unlistenedCount: number;
  onSelect: () => void;
  onPlayAll: () => void;
}) {
  return (
    <div 
      className={cn(
        "group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 transition-spring",
        "bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)]",
        "hover:shadow-lg hover:border-[var(--color-border-default)] hover:scale-[1.02] active:scale-[0.98]"
      )}
      onClick={onSelect}
    >
      {/* Podcast Artwork - Square */}
      <div className="aspect-square bg-[var(--color-surface-tertiary)] overflow-hidden">
        <FeedIcon feedId={feed.id} iconId={feed.icon?.icon_id} size={200} className="w-full h-full" />
      </div>

      {/* Content */}
      <div className="p-3">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {feed.title}
        </h4>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
          {episodeCount} episode{episodeCount !== 1 ? 's' : ''}
          {unlistenedCount > 0 && (
            <span className="ml-1 text-[var(--color-accent-fg)]">
              · {unlistenedCount} new
            </span>
          )}
        </p>
      </div>

      {/* Play all button overlay (visible on hover) */}
      <button
        onClick={(e) => { e.stopPropagation(); onPlayAll(); }}
        className={cn(
          "absolute top-2 right-2 p-2 rounded-full transition-all",
          "opacity-0 group-hover:opacity-100",
          "bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-hover)]",
          "shadow-lg"
        )}
        title="Play all episodes"
      >
        <Play size={16} fill="currentColor" />
      </button>

      {/* Unplayed badge */}
      {unlistenedCount > 0 && (
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-accent-primary)] text-white">
          {unlistenedCount}
        </div>
      )}
    </div>
  );
}

// Series Detail View
function SeriesDetail({
  feed,
  entries,
  onSelectEntry,
  onPlayAll,
}: {
  feed: Feed;
  entries: Entry[];
  onSelectEntry: (entry: Entry) => void;
  onPlayAll: () => void;
}) {
  const { isEntryListened } = useAudioStore();
  const podcastEntries = entries
    .filter(e => e.feed_id === feed.id && getAudioEnclosure(e))
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

  const unlistenedCount = podcastEntries.filter(e => !isEntryListened(e.id)).length;

  return (
    <div className="flex flex-col h-full relative">
      {/* Series Info Banner - with space for main header */}
      <div className="p-4 bg-gradient-to-b from-[var(--color-surface-secondary)] to-transparent">
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 rounded-xl overflow-hidden shadow-lg flex-shrink-0">
            <FeedIcon feedId={feed.id} iconId={feed.icon?.icon_id} size={80} className="w-full h-full" />
          </div>
          <div className="flex-1 min-w-0 py-1">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
              {feed.title}
            </h2>
            <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
              {podcastEntries.length} episode{podcastEntries.length !== 1 ? 's' : ''}
              {unlistenedCount > 0 && ` · ${unlistenedCount} unplayed`}
            </p>
            {/* Play All button below episode count */}
            <button
              onClick={onPlayAll}
              className={cn(
                "mt-3 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
                "bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-hover)]",
                "shadow-md hover:shadow-lg"
              )}
            >
              <PlayCircle size={16} />
              Play All
            </button>
          </div>
        </div>
      </div>

      {/* Episodes List - with bottom padding for tab bar */}
      <div className="flex-1 overflow-y-auto p-2 pt-12 md:pt-16">
        {podcastEntries.map(entry => (
          <EpisodeCard
            key={entry.id}
            entry={entry}
            onSelect={() => onSelectEntry(entry)}
            showFeedInfo={false}
            isListened={isEntryListened(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function PodcastsView({
  feeds,
  entries,
  categories,
  onSelectEntry,
  onPlaySeries,
  onPlayAllRecent,
  onRefresh,
  selectedPodcastId,
  onSelectPodcast,
}: PodcastsViewProps) {
  const [activeTab, setActiveTab] = useState<PodcastTab>('recent');
  const { queue, isEntryListened, playSeriesFromEntry, playAllRecent } = useAudioStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pull-to-refresh
  const defaultRefresh = useCallback(async () => {}, []);
  const { pullDistance, isRefreshing: isPTRRefreshing, isPulling, progress } = usePullToRefresh({
    scrollRef,
    onRefresh: onRefresh || defaultRefresh,
    enabled: !!onRefresh,
  });

  // Get podcast categories (categories named podcast, audio, etc.)
  const podcastCategories = useMemo(() => getPodcastCategories(categories), [categories]);
  const hasPodcastCategory = podcastCategories.length > 0;

  // Get podcast feeds from those categories (no longer depends on entries for faster display)
  const podcastFeeds = useMemo(() => 
    getPodcastFeeds(feeds, podcastCategories), 
    [feeds, podcastCategories]
  );
  
  // Find selected feed from external ID
  const selectedFeed = useMemo(() => 
    selectedPodcastId ? podcastFeeds.find(f => f.id === selectedPodcastId) || null : null,
    [selectedPodcastId, podcastFeeds]
  );
  
  // Get recent episodes from podcast feeds only
  const podcastFeedIds = useMemo(() => new Set(podcastFeeds.map(f => f.id)), [podcastFeeds]);
  const recentEpisodes = useMemo(() => 
    entries
      .filter(e => podcastFeedIds.has(e.feed_id) && getAudioEnclosure(e))
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .slice(0, 50),
    [entries, podcastFeedIds]
  );

  const tabs: { id: PodcastTab; label: string; icon: React.ReactNode }[] = [
    { id: 'recent', label: 'Recent', icon: <Clock size={16} /> },
    { id: 'queue', label: 'Up Next', icon: <ListMusic size={16} /> },
  ];

  // Handle play series from feed
  const handlePlaySeries = (feed: Feed) => {
    const feedEntries = entries.filter(e => e.feed_id === feed.id);
    playSeriesFromEntry(feed.id, feedEntries);
  };

  // If a feed is selected, show series detail with bottom tabs still visible
  if (selectedFeed) {
    return (
      <div className="flex flex-col h-full relative">
        <SeriesDetail
          feed={selectedFeed}
          entries={entries}
          onSelectEntry={onSelectEntry}
          onPlayAll={() => handlePlaySeries(selectedFeed)}
        />
        
        {/* Bottom Tab Bar - Still visible but no selection */}
        <div className="absolute bottom-0 left-0 right-0 z-30 p-3 pb-4 pointer-events-none">
          <div className="glass-panel-nav flex items-center justify-center gap-1 px-2 py-1.5 mx-auto w-fit pointer-events-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  onSelectPodcast?.(null);
                  setActiveTab(tab.id);
                }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 transition-spring active:scale-95",
                  "text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10"
                )}
              >
                {tab.icon}
                <span className="text-sm font-medium">{tab.label}</span>
                {tab.id === 'queue' && queue.length > 0 && (
                  <span className={cn(
                    "px-1.5 min-w-[20px] h-5 rounded-full text-xs font-medium flex items-center justify-center",
                    "bg-[var(--color-accent-primary)] text-white"
                  )}>
                    {queue.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Show empty state if no podcast category exists
  if (!hasPodcastCategory) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-[var(--color-surface-secondary)] flex items-center justify-center mb-4">
          <Folder size={40} className="text-[var(--color-text-tertiary)]" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
          No Podcast Category Found
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)] max-w-sm">
          Podcasts will automatically appear here once you create a category named 
          <span className="font-medium text-[var(--color-text-secondary)]"> "Podcasts"</span>, 
          <span className="font-medium text-[var(--color-text-secondary)]"> "Audio"</span>, or similar 
          and add your podcast feeds to it.
        </p>
        <div className="mt-4 text-xs text-[var(--color-text-disabled)]">
          Supported names: {PODCAST_CATEGORY_NAMES.join(', ')}
        </div>
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

      {/* Main Content Area - with top padding for UnifiedHeader and bottom padding for tab bar */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pt-12 md:pt-14"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: isPulling ? 'none' : 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Recent Tab */}
        {activeTab === 'recent' && (
          <div className="p-2">
            {/* Play all recent header */}
            {recentEpisodes.length > 0 && (
              <button
                onClick={() => playAllRecent(entries.filter(e => podcastFeedIds.has(e.feed_id)))}
                className={cn(
                  "w-full flex items-center gap-3 p-3 mb-2 rounded-xl transition-colors",
                  "bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)]"
                )}
              >
                <div className="w-10 h-10 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center text-white">
                  <Shuffle size={20} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">Play All Recent</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {recentEpisodes.length} episodes from newest to oldest
                  </p>
                </div>
              </button>
            )}
            
            {recentEpisodes.length === 0 ? (
              <div className="text-center py-12 text-[var(--color-text-tertiary)]">
                <Clock size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-sm">No recent episodes</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentEpisodes.map(entry => (
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

        {/* Queue Tab */}
        {activeTab === 'queue' && (
          <div className="p-2">
            {queue.length === 0 ? (
              <div className="text-center py-12 text-[var(--color-text-tertiary)]">
                <ListMusic size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-sm">Your queue is empty</p>
                <p className="text-xs mt-1">Add episodes to play them next</p>
              </div>
            ) : (
              <div className="space-y-1">
                {queue.map(({ entry, enclosure }, index) => (
                  <div key={`${entry.id}-${index}`} className="flex items-center gap-2">
                    <span className="w-6 text-center text-xs text-[var(--color-text-tertiary)]">
                      {index + 1}
                    </span>
                    <div className="flex-1">
                      <EpisodeCard
                        entry={entry}
                        onSelect={() => onSelectEntry(entry)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Tab Bar - Floating glass panel (absolute positioned over content) */}
      <div className="absolute bottom-0 left-0 right-0 z-30 p-3 pb-4 pointer-events-none">
        <div className="glass-panel-nav flex items-center justify-center gap-1 px-2 py-1.5 mx-auto w-fit pointer-events-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 transition-spring",
                activeTab === tab.id
                  ? "bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)] scale-105"
                  : "text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 active:scale-95"
              )}
            >
              {tab.icon}
              <span className="text-sm font-medium">{tab.label}</span>
              {tab.id === 'queue' && queue.length > 0 && (
                <span className={cn(
                  "px-1.5 min-w-[20px] h-5 rounded-full text-xs font-medium flex items-center justify-center",
                  "bg-[var(--color-accent-primary)] text-white"
                )}>
                  {queue.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PodcastsView;
