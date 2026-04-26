/**
 * VideosView Component
 * Dedicated view for video content with channels, recents, and queue management
 * Based on PodcastsView pattern but for video content (YouTube, video feeds, etc.)
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { cn, formatRelativeTime, formatDuration, getExcerpt } from '@/lib/utils';
import { 
  Play, 
  Clock, 
  Tv, 
  CheckCircle,
  MoreHorizontal,
  Shuffle,
  PlayCircle,
  Folder,
  MonitorPlay,
  ListPlus,
} from 'lucide-react';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import { useVideoStore, getVideoEnclosure, isVideoEntry, getVideoInfo } from '@/stores/video';
import { useMediaQueueStore } from '@/stores/mediaQueue';
import { useSettingsStore } from '@/stores/settings';
import type { Entry, Feed, Enclosure } from '@/types/api';
import type { ViewMode } from '@/stores/settings';
import { useEffectiveOfflineState } from '@/hooks/useEffectiveOfflineState';
import {
  PaginatedOverviewSurface,
  useMeasuredContainerSize,
  usePaginatedItems,
  useResponsiveGridPageSize,
  useResponsiveListPageSize,
} from '@/components/overview/PaginatedOverview';

interface VideosViewProps {
  feeds: Feed[];
  entries: Entry[];
  viewMode?: ViewMode;
  onSelectEntry: (entry: Entry) => void;
  onRefresh?: () => Promise<void>;
  selectedChannelId?: number | null;
  onSelectChannel?: (feed: Feed | null) => void;
}

function isYouTubeShort(entry: Entry): boolean {
  const url = (entry.url || '').toLowerCase();
  const content = (entry.content || '').toLowerCase();
  const title = (entry.title || '').toLowerCase();

  return (
    url.includes('youtube.com/shorts/') ||
    content.includes('youtube.com/shorts/') ||
    title.includes('#shorts')
  );
}

function getVideoGridColumns(width: number): number {
  if (width >= 1700) return 6;
  if (width >= 1400) return 5;
  if (width >= 1100) return 4;
  if (width >= 760) return 3;
  return 2;
}

function useVideoGridColumns(): number {
  const [columns, setColumns] = useState(() => getVideoGridColumns(window.innerWidth));

  useEffect(() => {
    const handleResize = () => setColumns(getVideoGridColumns(window.innerWidth));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return columns;
}

function PaginatedVideoCollection({
  entries,
  viewMode,
  onSelectEntry,
  chromeOffset,
  paginated,
}: {
  entries: Entry[];
  viewMode: ViewMode;
  onSelectEntry: (entry: Entry) => void;
  chromeOffset: number;
  paginated: boolean;
}) {
  const { isEntryWatched } = useVideoStore();
  const gridColumns = useVideoGridColumns();
  const overviewRef = useRef<HTMLDivElement>(null);
  const overviewSize = useMeasuredContainerSize(overviewRef);
  const cardsPerPage = useResponsiveGridPageSize({
    columns: gridColumns,
    aspectRatio: 16 / 9,
    metaHeight: 96,
    containerSize: overviewSize,
    gap: 12,
    chromeOffset,
  });
  const listPerPage = useResponsiveListPageSize({
    itemHeight: 148,
    containerSize: overviewSize,
    gap: 8,
    chromeOffset,
  });
  const magazinePerPage = useResponsiveListPageSize({
    itemHeight: 320,
    containerSize: overviewSize,
    gap: 16,
    chromeOffset,
  });
  const itemsPerPage = viewMode === 'cards'
    ? cardsPerPage
    : viewMode === 'list'
      ? listPerPage
      : magazinePerPage;
  const pagedEntries = usePaginatedItems(entries, itemsPerPage);
  const visibleEntries = paginated ? pagedEntries.pageItems : entries;

  const content = (
    <div
      className={cn(
        'p-4 pb-10',
        viewMode === 'cards' && 'grid gap-3',
        viewMode === 'list' && 'space-y-2',
        viewMode === 'magazine' && 'space-y-4 max-w-4xl mx-auto'
      )}
      style={viewMode === 'cards' ? { gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` } : undefined}
    >
      {visibleEntries.map((entry) => (
        <VideoCard
          key={entry.id}
          entry={entry}
          viewMode={viewMode}
          onSelect={() => onSelectEntry(entry)}
          isWatched={isEntryWatched(entry.id)}
        />
      ))}
    </div>
  );

  if (!paginated) {
    return <div className="h-full min-h-0 overflow-y-auto">{content}</div>;
  }

  return (
    <div ref={overviewRef} className="h-full min-h-0">
      <PaginatedOverviewSurface
        currentPage={pagedEntries.currentPage}
        pageCount={pagedEntries.pageCount}
        totalItems={entries.length}
        rangeStart={pagedEntries.rangeStart}
        rangeEnd={pagedEntries.rangeEnd}
        onPrevPage={pagedEntries.goToPrevPage}
        onNextPage={pagedEntries.goToNextPage}
      >
        {content}
      </PaginatedOverviewSurface>
    </div>
  );
}

// Video Card Component
function VideoCard({ 
  entry, 
  onPlay,
  onSelect,
  viewMode = 'cards',
  showFeedInfo = true,
  isWatched = false,
}: { 
  entry: Entry; 
  onPlay?: () => void;
  onSelect?: () => void;
  viewMode?: ViewMode;
  showFeedInfo?: boolean;
  isWatched?: boolean;
}) {
  const [imageError, setImageError] = useState(false);
  const videoInfo = getVideoInfo(entry);
  const { play, playYouTube, currentEntry, getYouTubeProgress } = useVideoStore();
  const { addVideoToQueue, isVideoQueued } = useMediaQueueStore();
  
  if (!videoInfo) return null;

  // Get thumbnail - use YouTube thumbnail for YouTube videos
  const thumbnailUrl = videoInfo.type === 'youtube' 
    ? `https://img.youtube.com/vi/${videoInfo.videoId}/mqdefault.jpg`
    : null;

  // Duration and progress from enclosure if available
  const enclosure = videoInfo.type === 'enclosure' ? videoInfo.enclosure : null;
  
  // Get progress for either enclosure or YouTube video
  let progress = 0;
  let duration = 0;
  
  if (enclosure) {
    duration = enclosure.size ? Math.floor(enclosure.size / 500000) : 0;
    progress = enclosure.media_progression || 0;
  } else if (videoInfo.type === 'youtube') {
    // Get saved YouTube progress
    const youtubeProgress = getYouTubeProgress(entry.id);
    if (youtubeProgress) {
      progress = youtubeProgress.currentTime;
      duration = youtubeProgress.duration;
    }
  }
  
  const hasProgress = progress > 0;
  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  // Check if already in queue or currently playing
  const isCurrentlyPlaying = currentEntry?.id === entry.id;
  const isInQueue = isVideoQueued(entry.id);

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoInfo.type === 'youtube') {
      // Play YouTube video in our embedded player
      playYouTube(videoInfo.videoId, entry);
    } else {
      play(videoInfo.enclosure, entry);
    }
    onPlay?.();
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isInQueue && !isCurrentlyPlaying) {
      if (videoInfo.type === 'youtube') {
        addVideoToQueue(entry, { youtubeId: videoInfo.videoId });
        return;
      }

      if (enclosure) {
        addVideoToQueue(entry, { enclosure });
      }
    }
  };

  if (viewMode === 'list') {
    return (
      <div
        className={cn(
          "flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer",
          "bg-[var(--color-surface-base)] border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]",
          isWatched && "opacity-60"
        )}
        onClick={onSelect}
      >
        <div className="relative w-36 @sm:w-44 aspect-video rounded-lg overflow-hidden flex-shrink-0 bg-[var(--color-surface-tertiary)]">
          {thumbnailUrl && !imageError ? (
            <img
              src={thumbnailUrl}
              alt={entry.title}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => setImageError(true)}
            />
          ) : (
            <FeedIcon feedId={entry.feed_id} iconId={entry.feed?.icon?.icon_id} size={176} className="w-full h-full object-cover" />
          )}
          {duration > 0 && (
            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-xs font-medium bg-black/80 text-white">
              {formatDuration(duration)}
            </div>
          )}
          {hasProgress && !isWatched && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
              <div className="h-full bg-[var(--color-accent-primary)]" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className={cn("text-sm font-medium text-[var(--color-text-primary)] line-clamp-2", isWatched && "text-[var(--color-text-tertiary)]")}>
            {entry.title}
          </h4>
          {showFeedInfo && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1 truncate">{entry.feed?.title}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-[var(--color-text-tertiary)]">
            <span>{formatRelativeTime(entry.published_at)}</span>
            {isWatched && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1 text-[var(--color-success-fg)]">
                  <CheckCircle size={12} />
                  Watched
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={handlePlay}
            className="w-9 h-9 rounded-full bg-[var(--color-accent-primary)] text-white flex items-center justify-center hover:bg-[var(--color-accent-hover)] transition-colors"
            title="Play"
          >
            <Play size={16} fill="currentColor" className="ml-0.5" />
          </button>
          {!isCurrentlyPlaying && (
            <button
              onClick={handleAddToQueue}
              disabled={isInQueue}
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center transition-colors",
                isInQueue
                  ? "bg-[var(--color-surface-secondary)] text-[var(--color-text-disabled)] cursor-default"
                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              )}
              title={isInQueue ? 'Already in queue' : 'Add to queue'}
            >
              <ListPlus size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (viewMode === 'magazine') {
    return (
      <div
        className={cn(
          "group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 transition-spring",
          "bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)]",
          "hover:shadow-lg hover:border-[var(--color-border-default)]",
          isWatched && "opacity-70"
        )}
        onClick={onSelect}
      >
        <div className="relative aspect-video bg-[var(--color-surface-tertiary)] overflow-hidden">
          {thumbnailUrl && !imageError ? (
            <img
              src={thumbnailUrl}
              alt={entry.title}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => setImageError(true)}
            />
          ) : (
            <FeedIcon feedId={entry.feed_id} iconId={entry.feed?.icon?.icon_id} size={560} className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent opacity-80" />
          <button
            onClick={handlePlay}
            className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-white/95 text-black flex items-center justify-center hover:scale-110 active:scale-95 transition-all"
            title="Play"
          >
            <Play size={20} fill="currentColor" className="ml-0.5" />
          </button>
          {duration > 0 && (
            <div className="absolute top-3 right-3 px-1.5 py-0.5 rounded text-xs font-medium bg-black/80 text-white">
              {formatDuration(duration)}
            </div>
          )}
          {hasProgress && !isWatched && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
              <div className="h-full bg-[var(--color-accent-primary)]" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
            </div>
          )}
        </div>

        <div className="p-4">
          <h4 className={cn("text-base font-semibold text-[var(--color-text-primary)] line-clamp-2", isWatched && "text-[var(--color-text-tertiary)]")}>
            {entry.title}
          </h4>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)] line-clamp-3">
            {getExcerpt(entry.content, 220)}
          </p>
          <div className="flex items-center justify-between mt-3 text-xs text-[var(--color-text-tertiary)]">
            <div className="flex items-center gap-2 min-w-0">
              {showFeedInfo && <span className="truncate">{entry.feed?.title}</span>}
              <span>·</span>
              <span>{formatRelativeTime(entry.published_at)}</span>
            </div>
            {!isCurrentlyPlaying && (
              <button
                onClick={handleAddToQueue}
                disabled={isInQueue}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                  isInQueue
                    ? "text-[var(--color-text-disabled)] bg-[var(--color-surface-secondary)] cursor-default"
                    : "text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)]"
                )}
                title={isInQueue ? 'Already in queue' : 'Add to queue'}
              >
                <ListPlus size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "group relative flex flex-col rounded-xl overflow-hidden cursor-pointer transition-all duration-300 transition-spring",
        "bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)]",
        "hover:shadow-lg hover:border-[var(--color-border-default)] active:scale-[0.98]",
        isWatched && "opacity-60"
      )}
      onClick={onSelect}
    >
      {/* Video Thumbnail */}
      <div className="relative aspect-video bg-[var(--color-surface-tertiary)] overflow-hidden">
        {thumbnailUrl && !imageError ? (
          <img 
            src={thumbnailUrl} 
            alt={entry.title} 
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <FeedIcon feedId={entry.feed_id} iconId={entry.feed?.icon?.icon_id} size={200} className="w-full h-full object-cover" />
        )}

        {/* Play button — small corner button, doesn't block card taps */}
        <button
          onClick={handlePlay}
          className="absolute bottom-2 left-2 w-10 h-10 rounded-full bg-white/90 text-black flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-md"
          title="Play"
        >
          <Play size={16} fill="currentColor" className="ml-0.5" />
        </button>

        {/* Add to queue — small corner button */}
        {!isCurrentlyPlaying && !isInQueue && (
          <button
            onClick={handleAddToQueue}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-all eink-media-action"
            title="Add to queue"
          >
            <ListPlus size={14} />
          </button>
        )}

        {/* Duration badge */}
        {duration > 0 && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-xs font-medium bg-black/80 text-white eink-media-badge">
            {formatDuration(duration)}
          </div>
        )}

        {/* Progress bar */}
        {hasProgress && !isWatched && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
            <div 
              className="h-full bg-[var(--color-accent-primary)]"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Video Info */}
      <div className="p-3 flex-1">
        <h4 className={cn(
          "text-sm font-medium text-[var(--color-text-primary)] line-clamp-2",
          isWatched && "text-[var(--color-text-tertiary)]"
        )}>
          {entry.title}
        </h4>
        
        {showFeedInfo && (
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1 truncate">
            {entry.feed?.title}
          </p>
        )}
        
        <div className="flex items-center gap-2 mt-1.5 text-xs text-[var(--color-text-tertiary)]">
          <span>{formatRelativeTime(entry.published_at)}</span>
          {isWatched && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-[var(--color-success-fg)]">
                <CheckCircle size={12} />
                Watched
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Channel Detail View
function ChannelDetail({
  feed,
  entries,
  viewMode,
  onSelectEntry,
  onPlayAll,
  paginated,
}: {
  feed: Feed;
  entries: Entry[];
  viewMode: ViewMode;
  onSelectEntry: (entry: Entry) => void;
  onPlayAll: () => void;
  paginated: boolean;
}) {
  const { isEntryWatched } = useVideoStore();
  const videoEntries = entries
    .filter(e => e.feed_id === feed.id && isVideoEntry(e))
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

  const unwatchedCount = videoEntries.filter(e => !isEntryWatched(e.id)).length;

  return (
    <div className="flex flex-col h-full relative">
      {/* Channel Info Banner */}
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
              {videoEntries.length} video{videoEntries.length !== 1 ? 's' : ''}
              {unwatchedCount > 0 && ` · ${unwatchedCount} unwatched`}
            </p>
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

      {/* Videos */}
      <div className="flex-1 min-h-0 content-below-header content-above-navbar">
        <PaginatedVideoCollection
          entries={videoEntries}
          viewMode={viewMode}
          onSelectEntry={onSelectEntry}
          chromeOffset={320}
          paginated={paginated}
        />
      </div>
    </div>
  );
}

export function VideosView({
  feeds,
  entries,
  viewMode = 'cards',
  onSelectEntry,
  onRefresh,
  selectedChannelId,
  onSelectChannel,
}: VideosViewProps) {
  const { isEntryWatched, playSeriesFromEntry } = useVideoStore();
  const videoCategoryId = useSettingsStore((s) => s.videoCategoryId);
  const einkMode = useSettingsStore((s) => s.einkMode);
  const { effectiveOffline } = useEffectiveOfflineState();

  // Get video feeds from the configured category
  const videoFeeds = useMemo(() => 
    videoCategoryId ? feeds.filter(f => f.category?.id === videoCategoryId) : [],
    [feeds, videoCategoryId]
  );
  
  // Find selected feed from external ID
  const selectedFeed = useMemo(() => 
    selectedChannelId ? videoFeeds.find(f => f.id === selectedChannelId) || null : null,
    [selectedChannelId, videoFeeds]
  );
  
  // Get recent videos from video feeds only (both enclosures and YouTube URLs)
  const videoFeedIds = useMemo(() => new Set(videoFeeds.map(f => f.id)), [videoFeeds]);
  const recentVideos = useMemo(() => 
    entries
      .filter(e => videoFeedIds.has(e.feed_id) && isVideoEntry(e) && !isYouTubeShort(e))
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()),
    [entries, videoFeedIds]
  );

  // Handle play series from feed
  const handlePlaySeries = (feed: Feed) => {
    const feedEntries = entries.filter(e => e.feed_id === feed.id && isVideoEntry(e) && !isYouTubeShort(e));
    playSeriesFromEntry(feed.id, feedEntries);
  };

  const selectedChannelVideos = useMemo(() => {
    if (!selectedFeed) return [];
    return entries
      .filter(e => e.feed_id === selectedFeed.id && isVideoEntry(e) && !isYouTubeShort(e))
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  }, [entries, selectedFeed]);

  // If a channel is selected, show channel detail
  if (selectedFeed) {
    return (
      <ChannelDetail
        feed={selectedFeed}
        entries={selectedChannelVideos}
        viewMode={viewMode}
        onSelectEntry={onSelectEntry}
        onPlayAll={() => handlePlaySeries(selectedFeed)}
        paginated={einkMode}
      />
    );
  }

  // Show empty state if no video category is configured
  if (!videoCategoryId) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-[var(--color-surface-secondary)] flex items-center justify-center mb-4">
          <Folder size={40} className="text-[var(--color-text-tertiary)]" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
          Video Not Configured
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)] max-w-sm">
          Assign a category to the Video section in Settings to see your video feeds here.
        </p>
      </div>
    );
  }

  if (effectiveOffline) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-[var(--color-surface-secondary)] flex items-center justify-center mb-4">
          <MonitorPlay size={40} className="text-[var(--color-text-tertiary)]" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
          Video unavailable offline
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)] max-w-sm">
          Videos stay hidden while the app is offline because playback depends on live online sources.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 min-h-0 content-below-header content-above-navbar">
        <PaginatedVideoCollection
          entries={recentVideos}
          viewMode={viewMode}
          onSelectEntry={onSelectEntry}
          chromeOffset={230}
          paginated={einkMode}
        />
      </div>
    </div>
  );
}

export default VideosView;