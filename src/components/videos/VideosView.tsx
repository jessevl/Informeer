/**
 * VideosView Component
 * Dedicated view for video content with channels, recents, and queue management
 * Based on PodcastsView pattern but for video content (YouTube, video feeds, etc.)
 */

import { useState, useMemo, useRef, useCallback } from 'react';
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils';
import { 
  Play, 
  Clock, 
  ListVideo, 
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
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/layout/PullToRefreshIndicator';
import type { Entry, Feed, Enclosure, Category } from '@/types/miniflux';

type VideoTab = 'recent' | 'queue';

// Names that indicate a video category
const VIDEO_CATEGORY_NAMES = ['video', 'videos', 'youtube', 'vlog', 'tv', 'movie', 'movies', 'watch'];

interface VideosViewProps {
  feeds: Feed[];
  entries: Entry[];
  categories: Category[];
  onSelectEntry: (entry: Entry) => void;
  onRefresh?: () => Promise<void>;
  selectedChannelId?: number | null;
  onSelectChannel?: (feed: Feed | null) => void;
}

// Check if a category name indicates videos
function isVideoCategory(category: Category): boolean {
  const title = category.title.toLowerCase();
  return VIDEO_CATEGORY_NAMES.some(name => title.includes(name));
}

// Get video categories
function getVideoCategories(categories: Category[]): Category[] {
  return categories.filter(isVideoCategory);
}

// Get video feeds (feeds in video categories)
function getVideoFeeds(feeds: Feed[], videoCategories: Category[]): Feed[] {
  const categoryIds = new Set(videoCategories.map(c => c.id));
  return feeds.filter(f => categoryIds.has(f.category?.id ?? -1));
}

// Video Card Component
function VideoCard({ 
  entry, 
  onPlay,
  onSelect,
  showFeedInfo = true,
  isWatched = false,
}: { 
  entry: Entry; 
  onPlay?: () => void;
  onSelect?: () => void;
  showFeedInfo?: boolean;
  isWatched?: boolean;
}) {
  const [imageError, setImageError] = useState(false);
  const videoInfo = getVideoInfo(entry);
  const { play, playYouTube, addToQueue, queue, currentEntry, getYouTubeProgress } = useVideoStore();
  
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
  const isInQueue = queue.some(item => item.entry.id === entry.id);

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
    if (!isInQueue && !isCurrentlyPlaying && enclosure) {
      addToQueue(enclosure, entry);
    }
  };

  return (
    <div 
      className={cn(
        "group relative flex flex-col rounded-xl overflow-hidden cursor-pointer transition-all duration-300 transition-spring",
        "bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)]",
        "hover:shadow-lg hover:border-[var(--color-border-default)] hover:scale-[1.02] active:scale-[0.98]",
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
        
        {/* Play overlay on hover */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={handlePlay}
            className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-300 transition-spring"
            title="Play"
          >
            <Play size={24} fill="currentColor" className="text-black ml-1" />
          </button>
          {/* Add to Queue button - only for enclosure videos (not YouTube) */}
          {enclosure && !isCurrentlyPlaying && (
            <button
              onClick={handleAddToQueue}
              disabled={isInQueue}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                isInQueue
                  ? "bg-black/50 text-white/50 cursor-default"
                  : "bg-white/90 text-black hover:scale-110"
              )}
              title={isInQueue ? "Already in queue" : "Add to queue"}
            >
              <ListPlus size={18} />
            </button>
          )}
        </div>

        {/* Duration badge */}
        {duration > 0 && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-xs font-medium bg-black/80 text-white">
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

// Channel Card Component (Video Series) - Tiled/Card View
function ChannelCard({ 
  feed, 
  episodeCount,
  unwatchedCount,
  onSelect,
  onPlayAll,
}: { 
  feed: Feed; 
  episodeCount: number;
  unwatchedCount: number;
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
      {/* Channel Artwork - Square */}
      <div className="aspect-square bg-[var(--color-surface-tertiary)] overflow-hidden">
        <FeedIcon feedId={feed.id} iconId={feed.icon?.icon_id} size={200} className="w-full h-full" />
      </div>

      {/* Content */}
      <div className="p-3">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {feed.title}
        </h4>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
          {episodeCount} video{episodeCount !== 1 ? 's' : ''}
          {unwatchedCount > 0 && (
            <span className="ml-1 text-[var(--color-accent-fg)]">
              · {unwatchedCount} new
            </span>
          )}
        </p>
      </div>

      {/* Play all button overlay */}
      <button
        onClick={(e) => { e.stopPropagation(); onPlayAll(); }}
        className={cn(
          "absolute top-2 right-2 p-2 rounded-full transition-all",
          "opacity-0 group-hover:opacity-100",
          "bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-hover)]",
          "shadow-lg"
        )}
        title="Play all videos"
      >
        <Play size={16} fill="currentColor" />
      </button>

      {/* Unwatched badge */}
      {unwatchedCount > 0 && (
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-accent-primary)] text-white">
          {unwatchedCount}
        </div>
      )}
    </div>
  );
}

// Channel Detail View
function ChannelDetail({
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

      {/* Videos Grid */}
      <div className="flex-1 overflow-y-auto p-4 pt-12 md:pt-16">
        <div className="grid grid-cols-2 @sm:grid-cols-2 @md:grid-cols-3 @lg:grid-cols-4 gap-3">
          {videoEntries.map(entry => (
            <VideoCard
              key={entry.id}
              entry={entry}
              onSelect={() => onSelectEntry(entry)}
              showFeedInfo={false}
              isWatched={isEntryWatched(entry.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function VideosView({
  feeds,
  entries,
  categories,
  onSelectEntry,
  onRefresh,
  selectedChannelId,
  onSelectChannel,
}: VideosViewProps) {
  const [activeTab, setActiveTab] = useState<VideoTab>('recent');
  const { queue, isEntryWatched, playSeriesFromEntry, playAllRecent } = useVideoStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pull-to-refresh
  const defaultRefresh = useCallback(async () => {}, []);
  const { pullDistance, isRefreshing: isPTRRefreshing, isPulling, progress } = usePullToRefresh({
    scrollRef,
    onRefresh: onRefresh || defaultRefresh,
    enabled: !!onRefresh,
  });

  // Get video categories
  const videoCategories = useMemo(() => getVideoCategories(categories), [categories]);
  const hasVideoCategory = videoCategories.length > 0;

  // Get video feeds from those categories
  const videoFeeds = useMemo(() => 
    getVideoFeeds(feeds, videoCategories), 
    [feeds, videoCategories]
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
      .filter(e => videoFeedIds.has(e.feed_id) && isVideoEntry(e))
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .slice(0, 50),
    [entries, videoFeedIds]
  );

  const tabs: { id: VideoTab; label: string; icon: React.ReactNode }[] = [
    { id: 'recent', label: 'Recent', icon: <Clock size={16} /> },
    { id: 'queue', label: 'Up Next', icon: <ListVideo size={16} /> },
  ];

  // Handle play series from feed
  const handlePlaySeries = (feed: Feed) => {
    const feedEntries = entries.filter(e => e.feed_id === feed.id);
    playSeriesFromEntry(feed.id, feedEntries);
  };

  // If a channel is selected, show channel detail
  if (selectedFeed) {
    return (
      <div className="flex flex-col h-full relative">
        <ChannelDetail
          feed={selectedFeed}
          entries={entries}
          onSelectEntry={onSelectEntry}
          onPlayAll={() => handlePlaySeries(selectedFeed)}
        />
        
        {/* Bottom Tab Bar */}
        <div className="absolute bottom-0 left-0 right-0 z-30 p-3 pb-4 pointer-events-none">
          <div className="glass-panel-nav flex items-center justify-center gap-1 px-2 py-1.5 mx-auto w-fit pointer-events-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  onSelectChannel?.(null);
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

  // Show empty state if no video category exists
  if (!hasVideoCategory) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-[var(--color-surface-secondary)] flex items-center justify-center mb-4">
          <Folder size={40} className="text-[var(--color-text-tertiary)]" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
          No Video Category Found
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)] max-w-sm">
          Videos will automatically appear here once you create a category named 
          <span className="font-medium text-[var(--color-text-secondary)]"> "Videos"</span>, 
          <span className="font-medium text-[var(--color-text-secondary)]"> "YouTube"</span>, or similar 
          and add your video feeds to it.
        </p>
        <div className="mt-4 text-xs text-[var(--color-text-disabled)]">
          Supported names: {VIDEO_CATEGORY_NAMES.join(', ')}
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

      {/* Main Content Area */}
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
          <div className="p-4">
            {recentVideos.length > 0 && (
              <button
                onClick={() => playAllRecent(entries.filter(e => videoFeedIds.has(e.feed_id)))}
                className={cn(
                  "w-full flex items-center gap-3 p-3 mb-4 rounded-xl transition-colors",
                  "bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)]"
                )}
              >
                <div className="w-10 h-10 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center text-white">
                  <Shuffle size={20} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">Play All Recent</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {recentVideos.length} videos from newest to oldest
                  </p>
                </div>
              </button>
            )}
            
            {recentVideos.length === 0 ? (
              <div className="text-center py-12 text-[var(--color-text-tertiary)]">
                <Clock size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-sm">No recent videos</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 @sm:grid-cols-2 @md:grid-cols-3 @lg:grid-cols-4 gap-3">
                {recentVideos.map(entry => (
                  <VideoCard
                    key={entry.id}
                    entry={entry}
                    onSelect={() => onSelectEntry(entry)}
                    isWatched={isEntryWatched(entry.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Queue Tab */}
        {activeTab === 'queue' && (
          <div className="p-4">
            {queue.length === 0 ? (
              <div className="text-center py-12 text-[var(--color-text-tertiary)]">
                <ListVideo size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-sm">Your queue is empty</p>
                <p className="text-xs mt-1">Add videos to play them next</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 @sm:grid-cols-2 @md:grid-cols-3 @lg:grid-cols-4 gap-3">
                {queue.map(({ entry, enclosure }, index) => (
                  <div key={`${entry.id}-${index}`} className="relative">
                    <span className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full bg-black/70 text-white text-xs font-medium flex items-center justify-center">
                      {index + 1}
                    </span>
                    <VideoCard
                      entry={entry}
                      onSelect={() => onSelectEntry(entry)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Tab Bar */}
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

export default VideosView;