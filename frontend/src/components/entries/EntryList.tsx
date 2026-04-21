/**
 * EntryList Component
 * Scrollable list of entries with multiple view modes
 * Supports: list, cards, and magazine (masonry) views
 * 
 * Mobile: Adjusts padding for mobile header/nav
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { RefreshCw, Rss, Star, Play, Pause } from 'lucide-react';
import { useBreakpoint, useVirtualizer, type VirtualItem } from '@/lib/masonry';
import { cn, getExcerpt, extractFirstImage, formatRelativeTime, formatReadingTime } from '@/lib/utils';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import { EntryCard } from './EntryCard';
import { ArticleReader } from './ArticleReader';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import { useVideoStore, getVideoInfo } from '@/stores/video';
import { AudioPlayButton, VideoPlayButton } from '@/components/media';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/layout/PullToRefreshIndicator';
import type { Entry, Enclosure } from '@/types/api';
import type { ViewMode } from '@/stores/settings';
import { useSettingsStore } from '@/stores/settings';
import { einkPower } from '@/services/eink-power';

const EINK_INTERACTION_SETTLE_MS = 180;
const EINK_MASONRY_LAYOUT_SETTLE_MS = 240;

/** Resolves once all <img> elements in `container` have loaded, or after `timeoutMs`. */
function waitForPendingImages(container: Element | null, timeoutMs: number): Promise<void> {
  if (!container) return Promise.resolve();
  const pending = Array.from(container.querySelectorAll<HTMLImageElement>('img')).filter(img => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(pending.map(img => new Promise<void>(resolve => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    }))).then(() => undefined),
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}

// YouTube Video Trigger - plays YouTube video in our custom player (used in cards)
function YouTubeVideoTrigger({ entry, youtubeId }: { entry: Entry; youtubeId: string }) {
  const { playYouTube, currentEntry, isPlaying, getYouTubeProgress } = useVideoStore();
  
  const thumbnailUrl = `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`;
  const isCurrentVideo = currentEntry?.id === entry.id;
  const isCurrentlyPlaying = isCurrentVideo && isPlaying;
  
  // Get progress
  const progress = getYouTubeProgress(entry.id);
  const progressPercent = progress && progress.duration > 0 
    ? (progress.currentTime / progress.duration) * 100 
    : 0;

  const handlePlay = () => {
    playYouTube(youtubeId, entry);
  };

  return (
    <div 
      className="mb-8 aspect-video rounded-xl overflow-hidden bg-black shadow-lg relative cursor-pointer group"
      onClick={handlePlay}
    >
      {/* Thumbnail */}
      <img 
        src={thumbnailUrl}
        alt={entry.title}
        className="w-full h-full object-cover"
      />
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-100 group-hover:bg-black/40 transition-colors">
        <button className="w-20 h-20 rounded-full bg-red-600 flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-300 transition-spring shadow-lg">
          {isCurrentlyPlaying ? (
            <Pause size={36} fill="currentColor" className="text-white" />
          ) : (
            <Play size={36} fill="currentColor" className="text-white ml-1" />
          )}
        </button>
      </div>
      
      {/* Progress bar */}
      {progressPercent > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50">
          <div 
            className="h-full bg-red-600 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
      
      {/* YouTube branding */}
      <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/70 text-white text-xs font-medium flex items-center gap-1">
        <svg viewBox="0 0 90 20" className="h-3 w-auto">
          <path fill="currentColor" d="M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 2.24288e-07 14.285 0 14.285 0C14.285 0 5.35042 2.24288e-07 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C2.24288e-07 5.35042 0 10 0 10C0 10 2.24288e-07 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z"/>
          <path fill="red" d="M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z"/>
        </svg>
        <span>YouTube</span>
      </div>
    </div>
  );
}

interface EntryListProps {
  entries: Entry[];
  selectedEntry?: Entry | null;
  isLoading: boolean;
  isLoadingMore?: boolean;
  isRefetching?: boolean;
  hasMore: boolean;
  title?: string;
  count?: number;
  onSelectEntry: (entry: Entry) => void;
  onLoadMore: () => void;
  onRefresh?: () => Promise<void>;
  onToggleBookmark?: (entryId: number) => void;
  onMarkAsRead?: (entryId: number) => void;
  onMarkAsUnread?: (entryId: number) => void;
  onBack?: () => void;
  isCompact?: boolean;
  viewMode?: ViewMode;
  showImages?: boolean;
  preferFullscreenReader?: boolean;
}

// Article Modal for Magazine View
function ArticleModal({ 
  entry, 
  onClose,
  onToggleBookmark,
  onMarkAsRead,
  onMarkAsUnread,
}: { 
  entry: Entry; 
  onClose: () => void;
  onToggleBookmark?: (entryId: number) => void;
  onMarkAsRead?: (entryId: number) => void;
  onMarkAsUnread?: (entryId: number) => void;
}) {
  return (
    <ArticleReader
      modal
      entry={entry}
      onClose={onClose}
      onToggleBookmark={(entryId) => onToggleBookmark?.(entryId)}
      onMarkAsRead={(entryId) => onMarkAsRead?.(entryId)}
      onMarkAsUnread={(entryId) => onMarkAsUnread?.(entryId)}
    />
  );
}

// Card View Item Component
function CardItem({ 
  entry, 
  isSelected, 
  onSelect, 
  showImages = true,
  excerptLines = 3,
}: { 
  entry: Entry; 
  isSelected: boolean; 
  onSelect: (entry: Entry) => void;
  showImages?: boolean;
  excerptLines?: number;
}) {
  const [imageError, setImageError] = useState(false);
  const isUnread = entry.status === 'unread';
  const showReadingTime = useSettingsStore((s) => s.showReadingTime);
  const imageUrl = showImages ? (entry.image_url || extractFirstImage(entry.content)) : null;
  const excerpt = getExcerpt(entry.content, excerptLines * 60);
  
  const { audioEnclosure, videoInfo, isPodcast, isVideo, thumbnailUrl, progressPercent, hasProgress } = useMediaProgress(entry);
  const displayThumb = !imageError ? (thumbnailUrl || imageUrl) : null;
  
  return (
    <article
      onClick={() => onSelect(entry)}
      className={cn(
        'group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200',
        'bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)]',
        'hover:shadow-lg hover:border-[var(--color-border-default)]',
        isSelected && 'ring-2 ring-[var(--color-accent-primary)] border-transparent'
      )}
    >
      {/* Cover Image */}
      {displayThumb && (
        <div className="aspect-[16/10] bg-[var(--color-surface-inset)] overflow-hidden relative">
          <img 
            src={displayThumb}
            alt="" 
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImageError(true)}
          />
          
          {/* Media play button — small corner button so taps on the
             thumbnail still reach the card onClick. The button components
             already call e.stopPropagation() internally. */}
          {isVideo && (
            <div className="absolute bottom-2 left-2" onClick={(e) => e.stopPropagation()}>
              <VideoPlayButton entry={entry} size="md" showAddToQueue />
            </div>
          )}
          {isPodcast && !isVideo && audioEnclosure && (
            <div className="absolute bottom-2 left-2" onClick={(e) => e.stopPropagation()}>
              <AudioPlayButton entry={entry} enclosure={audioEnclosure} size="md" showAddToQueue />
            </div>
          )}
          
          {/* Media badges */}
          {isVideo && videoInfo?.type === 'youtube' && (
            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold">YouTube</div>
          )}
          {isPodcast && !isVideo && (
            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-[var(--color-accent-primary)] text-white text-[10px] font-bold">Podcast</div>
          )}
          
          {/* Progress bar */}
          {hasProgress && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
              <div className="h-full bg-[var(--color-accent-primary)]" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
            </div>
          )}
        </div>
      )}
      
      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          {isUnread && <span className="w-2 h-2 rounded-full bg-[var(--color-accent-fg)]" />}
          <FeedIcon feedId={entry.feed_id} iconId={entry.feed?.icon?.icon_id} size={14} className="rounded-sm" />
          <span className="text-xs text-[var(--color-text-tertiary)] truncate">{entry.feed?.title}</span>
        </div>
        
        <h3 className={cn(
          'text-sm leading-snug line-clamp-2 mb-2',
          isUnread ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
        )}>{entry.title}</h3>
        
        {excerpt && excerptLines > 0 && (
          <p className="text-sm text-[var(--color-text-tertiary)] leading-relaxed mb-2"
            style={{ display: '-webkit-box', WebkitLineClamp: excerptLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {excerpt}
          </p>
        )}
        
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            <span>{formatRelativeTime(entry.published_at)}</span>
            {showReadingTime && entry.reading_time > 0 && !isPodcast && !isVideo && (
              <><span>·</span><span>{formatReadingTime(entry.reading_time)}</span></>
            )}
          </div>
          
          {!displayThumb && !isVideo && (isPodcast || isVideo) && (
            <div onClick={(e) => e.stopPropagation()}>
              {isPodcast && audioEnclosure && <AudioPlayButton entry={entry} enclosure={audioEnclosure} size="xs" showLabel showAddToQueue />}
              {isVideo && <VideoPlayButton entry={entry} size="xs" showLabel showAddToQueue />}
            </div>
          )}
        </div>
        
        {hasProgress && !displayThumb && (
          <div className="mt-2 h-1 bg-[var(--color-surface-tertiary)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--color-accent-primary)] rounded-full" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
          </div>
        )}
      </div>
      
      {entry.starred && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-amber-500/90 flex items-center justify-center">
          <span className="text-white text-xs">★</span>
        </div>
      )}
    </article>
  );
}

// Threshold for considering an article "long" (in minutes)
const LONG_ARTICLE_THRESHOLD = 8;

// Helper to get audio enclosure from entry
function getAudioEnclosure(entry: Entry): Enclosure | null {
  return entry.enclosures?.find(e => e.mime_type?.startsWith('audio/')) || null;
}

// Hook to get media progress info for an entry
function useMediaProgress(entry: Entry) {
  const { getYouTubeProgress } = useVideoStore();
  
  const audioEnclosure = getAudioEnclosure(entry);
  const videoInfo = getVideoInfo(entry);
  const isPodcast = !!audioEnclosure;
  const isVideo = !!videoInfo;
  
  // Thumbnail URL
  const thumbnailUrl = videoInfo?.type === 'youtube'
    ? `https://img.youtube.com/vi/${videoInfo.videoId}/mqdefault.jpg`
    : null;
  
  // Calculate progress
  let progressPercent = 0;
  let hasProgress = false;
  
  if (isVideo && videoInfo?.type === 'youtube') {
    const p = getYouTubeProgress(entry.id);
    if (p && p.duration > 0) {
      progressPercent = (p.currentTime / p.duration) * 100;
      hasProgress = p.currentTime > 0;
    }
  } else if (isVideo && videoInfo?.type === 'enclosure' && videoInfo.enclosure.media_progression) {
    const enc = videoInfo.enclosure;
    if (enc.size && enc.size > 0) {
      const duration = Math.floor(enc.size / 500000);
      if (duration > 0) {
        progressPercent = (enc.media_progression / duration) * 100;
        hasProgress = enc.media_progression > 0;
      }
    }
  } else if (isPodcast && audioEnclosure?.media_progression) {
    hasProgress = true;
    if (audioEnclosure.size && audioEnclosure.size > 0) {
      const duration = Math.floor(audioEnclosure.size / 16000);
      if (duration > 0) progressPercent = Math.min((audioEnclosure.media_progression / duration) * 100, 100);
    }
  }
  
  return { audioEnclosure, videoInfo, isPodcast, isVideo, thumbnailUrl, progressPercent, hasProgress };
}

// Magazine/Masonry View Item Component
function MagazineItem({ 
  entry, 
  onSelect, 
  showImages = true,
  baseExcerptLines = 4,
}: { 
  entry: Entry; 
  onSelect: (entry: Entry) => void;
  showImages?: boolean;
  baseExcerptLines?: number;
}) {
  const [imageError, setImageError] = useState(false);
  const isUnread = entry.status === 'unread';
  const showReadingTime = useSettingsStore((s) => s.showReadingTime);
  const imageUrl = showImages ? (entry.image_url || extractFirstImage(entry.content)) : null;
  const { audioEnclosure, videoInfo, isPodcast, isVideo, thumbnailUrl, progressPercent, hasProgress } = useMediaProgress(entry);
  const displayThumb = !imageError ? (thumbnailUrl || imageUrl) : null;
  
  // Adjust excerpt lines based on reading time
  const readingTime = entry.reading_time || 0;
  const excerptLines = readingTime < 3 ? Math.max(1, baseExcerptLines - 2) 
    : readingTime < LONG_ARTICLE_THRESHOLD ? baseExcerptLines : baseExcerptLines + 2;
  const excerpt = getExcerpt(entry.content, excerptLines * 60);
  
  return (
    <article
      onClick={() => onSelect(entry)}
      className={cn(
        'group rounded-xl overflow-hidden cursor-pointer transition-all duration-200',
        'bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)]',
        'hover:shadow-lg hover:border-[var(--color-border-default)] hover:scale-[1.01]'
      )}
    >
      {/* Cover Image / Video Thumbnail */}
      {displayThumb && (
        <div className="aspect-video bg-[var(--color-surface-inset)] overflow-hidden flex-shrink-0 relative">
          <img 
            src={displayThumb}
            alt="" 
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImageError(true)}
          />
          
          {/* Media play button overlay — pointer-events-none on the overlay itself
             so taps pass through to the card. Only the buttons are interactive.
             The buttons already call e.stopPropagation() internally. */}
          {(isPodcast || isVideo) && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
              <div className="transform scale-90 group-hover:scale-100 transition-transform pointer-events-auto">
                {isVideo && <VideoPlayButton entry={entry} size="lg" showAddToQueue />}
                {isPodcast && !isVideo && audioEnclosure && <AudioPlayButton entry={entry} enclosure={audioEnclosure} size="lg" showAddToQueue />}
              </div>
            </div>
          )}
          
          {/* Media badges */}
          {isVideo && videoInfo?.type === 'youtube' && (
            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold">YouTube</div>
          )}
          {isPodcast && !isVideo && (
            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-[var(--color-accent-primary)] text-white text-[10px] font-bold">Podcast</div>
          )}
          
          {/* Progress bar */}
          {hasProgress && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
              <div className="h-full bg-[var(--color-accent-primary)]" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
            </div>
          )}
        </div>
      )}
      
      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <FeedIcon feedId={entry.feed_id} iconId={entry.feed?.icon?.icon_id} size={14} />
          {isUnread && <span className="w-2 h-2 rounded-full bg-[var(--color-accent-fg)] flex-shrink-0" />}
          <span className="text-xs font-medium text-[var(--color-text-secondary)] truncate">{entry.feed?.title}</span>
          <span className="text-[var(--color-text-disabled)]">·</span>
          <span className="text-xs text-[var(--color-text-tertiary)]">{formatRelativeTime(entry.published_at)}</span>
          {entry.starred && <span className="text-amber-500 text-xs">★</span>}
        </div>
        
        <h3 className={cn(
          'text-base leading-tight mb-2 line-clamp-3',
          isUnread ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)]'
        )}>{entry.title}</h3>
        
        {excerpt && (
          <p className="text-sm text-[var(--color-text-tertiary)] leading-relaxed"
            style={{ display: '-webkit-box', WebkitLineClamp: excerptLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {excerpt}
          </p>
        )}
        
        <div className="mt-3 flex items-center gap-2">
          {!displayThumb && !isVideo && (
            <>
              {isPodcast && audioEnclosure ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <AudioPlayButton entry={entry} enclosure={audioEnclosure} size="xs" variant="ghost" showLabel showAddToQueue />
                </div>
              ) : showReadingTime && entry.reading_time > 0 ? (
                <span className="text-xs text-[var(--color-text-disabled)]">{formatReadingTime(entry.reading_time)} read</span>
              ) : null}
            </>
          )}
          {showReadingTime && displayThumb && !isPodcast && !isVideo && entry.reading_time > 0 && (
            <span className="text-xs text-[var(--color-text-disabled)]">{formatReadingTime(entry.reading_time)} read</span>
          )}
          {displayThumb && isPodcast && !isVideo && audioEnclosure && (
            <div onClick={(e) => e.stopPropagation()}>
              <AudioPlayButton entry={entry} enclosure={audioEnclosure} size="xs" variant="ghost" showLabel showAddToQueue />
            </div>
          )}
        </div>
        
        {hasProgress && !displayThumb && (
          <div className="mt-2 h-1 bg-[var(--color-surface-tertiary)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--color-accent-primary)] rounded-full" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
          </div>
        )}
      </div>
    </article>
  );
}

// Breakpoint configuration for responsive masonry
const masonryBreakpoints = [
  { name: 'mobile', minWidth: 0, nCol: 1 },
  { name: 'small', minWidth: 480, nCol: 2 },
  { name: 'medium', minWidth: 768, nCol: 3 },
  { name: 'large', minWidth: 1280, nCol: 4 },
];

// Height estimates for masonry items
const CARD_BASE_HEIGHT = 120;
const CARD_IMAGE_HEIGHT = 180;
const CARD_EXCERPT_HEIGHT_PER_LINE = 20;

// Virtualized Masonry Component
interface VirtualizedMasonryProps {
  entries: Entry[];
  onSelect: (entry: Entry) => void;
  showImages: boolean;
  excerptLines: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onLayoutActivity?: () => void;
}

function VirtualizedMasonry({ 
  entries, 
  onSelect,
  showImages,
  excerptLines,
  scrollContainerRef,
  hasMore,
  isLoading,
  isLoadingMore,
  onLoadMore,
  onLayoutActivity,
}: VirtualizedMasonryProps) {
  const { currentBreakpoint } = useBreakpoint(masonryBreakpoints);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Track if component is ready for virtualization
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(true);
  }, []);

  // No column spanning - all items single column
  const getItemColSpan = useCallback(() => 1, []);

  const getItemKey = useCallback((index: number) => {
    const entry = entries[index];
    return entry?.id ?? index;
  }, [entries]);

  // Estimate item heights based on content and reading time
  const estimateItemHeight = useCallback((index: number) => {
    const entry = entries[index];
    if (!entry) return 300;
    
    const hasImage = showImages && extractFirstImage(entry.content);
    
    let height = CARD_BASE_HEIGHT;
    
    if (hasImage) {
      height += CARD_IMAGE_HEIGHT;
    }
    
    // Excerpt lines based on reading time, using setting as average
    const readingTime = entry.reading_time || 0;
    let effectiveLines: number;
    if (readingTime < 3) {
      effectiveLines = Math.max(1, excerptLines - 2);
    } else if (readingTime < LONG_ARTICLE_THRESHOLD) {
      effectiveLines = excerptLines;
    } else {
      effectiveLines = excerptLines + 2;
    }
    
    height += effectiveLines * CARD_EXCERPT_HEIGHT_PER_LINE;
    
    return height;
  }, [entries, showImages, excerptLines]);

  const lanes = currentBreakpoint.nCol;
  const columnGap = 16;
  
  const rowVirtualizer = useVirtualizer({
    enabled,
    count: entries.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: estimateItemHeight,
    overscan: 10,
    lanes,
    gap: columnGap,
    getItemKey,
    getItemColSpan, // Native colSpan support!
    useAnimationFrameWithResizeObserver: true,
    resizeDelay: 50,
    onChange: (_instance, sync) => {
      if (!sync) {
        onLayoutActivity?.();
      }
    },
  });

  useEffect(() => {
    onLayoutActivity?.();
  }, [entries.length, currentBreakpoint.name, showImages, excerptLines, onLayoutActivity]);

  // getVirtualItems returns { virtualItems, lanes }
  const result = rowVirtualizer.getVirtualItems() as { virtualItems: VirtualItem[], lanes: number };
  const virtualItems = result.virtualItems || [];

  // Reference for load more trigger element
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Use IntersectionObserver for reliable load-more detection
  useEffect(() => {
    if (!hasMore || isLoading || isLoadingMore) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1, root: scrollContainerRef.current }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoading, isLoadingMore, onLoadMore, scrollContainerRef]);

  // Calculate column width percentage
  const columnWidth = 100 / lanes;

  return (
    <div className="p-4">
      {/* Virtualized Masonry Grid */}
      <div 
        ref={containerRef}
        className="relative"
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => {
          const entry = entries[virtualItem.index];
          if (!entry) return null;
          
          // Calculate width and left position based on lane
          const left = virtualItem.lane * columnWidth;
          
          return (
            <div
              key={entry.id}
              data-index={virtualItem.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: `calc(${left}% + ${virtualItem.lane * columnGap / lanes}px)`,
                width: `calc(${columnWidth}% - ${columnGap * (lanes - 1) / lanes}px)`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <MagazineItem
                entry={entry}
                onSelect={onSelect}
                showImages={showImages}
                baseExcerptLines={excerptLines}
              />
            </div>
          );
        })}
        
        {/* Load more trigger - at the bottom of the content */}
        {entries.length > 0 && (
          <div 
            ref={loadMoreRef} 
            style={{ 
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 20,
            }} 
          />
        )}
      </div>
      
    </div>
  );
}


export function EntryList({
  entries,
  selectedEntry,
  isLoading,
  isLoadingMore = false,
  isRefetching,
  hasMore,
  title,
  count,
  onSelectEntry,
  onLoadMore,
  onRefresh,
  onToggleBookmark,
  onMarkAsRead,
  onMarkAsUnread,
  onBack,
  isCompact = false,
  viewMode = 'list',
  showImages = true,
  preferFullscreenReader = false,
}: EntryListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const magazineExcerptLines = useSettingsStore((s) => s.magazineExcerptLines);
  const cardsExcerptLines = useSettingsStore((s) => s.cardsExcerptLines);
  const showReadingTime = useSettingsStore((s) => s.showReadingTime);
  const einkMode = useSettingsStore((s) => s.einkMode);
  const isMobile = useIsMobile();
  const useFullscreenMagazineReader = preferFullscreenReader;
  const feedReadySchedulerRef = useRef<(() => void) | null>(null);
  const masonryLayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const masonryLayoutWorkTagRef = useRef<string | null>(null);
  
  // State for magazine modal
  const [modalEntry, setModalEntry] = useState<Entry | null>(null);

  // Pull-to-refresh
  const defaultRefresh = useCallback(async () => {}, []);
  const { pullDistance, isRefreshing: isPTRRefreshing, isPulling, progress } = usePullToRefresh({
    scrollRef: listRef,
    onRefresh: onRefresh || defaultRefresh,
    enabled: !!onRefresh,
  });
  const isFeedSurfaceEligible = !selectedEntry && !modalEntry && !isLoading && !isLoadingMore && !isRefetching && !isPTRRefreshing && !isPulling;
  const scheduleMasonryLayoutReady = useCallback(() => {
    feedReadySchedulerRef.current?.();
  }, []);

  const handleMasonryLayoutActivity = useCallback(() => {
    if (viewMode !== 'magazine' || selectedEntry || modalEntry) return;

    const workTag = masonryLayoutWorkTagRef.current ?? 'feed-list:masonry-layout';
    masonryLayoutWorkTagRef.current = workTag;
    einkPower.beginCriticalWork(workTag);

    if (masonryLayoutTimerRef.current) {
      clearTimeout(masonryLayoutTimerRef.current);
    }

    masonryLayoutTimerRef.current = setTimeout(() => {
      masonryLayoutTimerRef.current = null;
      void (async () => {
        await einkPower.waitForPaintCommit();
        // Wait for any in-DOM images that are still loading (lazy-loaded card images)
        // so the E-ink display doesn't hibernate on a frame with unrendered placeholders.
        // Cap at 3 s to avoid blocking hibernation if a single image stalls.
        await waitForPendingImages(listRef.current, 3000);
        einkPower.endCriticalWork(workTag);
        scheduleMasonryLayoutReady();
      })();
    }, EINK_MASONRY_LAYOUT_SETTLE_MS);
  }, [modalEntry, scheduleMasonryLayoutReady, selectedEntry, viewMode]);

  useEffect(() => {
    if (viewMode === 'magazine' && !selectedEntry && !modalEntry) return;

    if (masonryLayoutTimerRef.current) {
      clearTimeout(masonryLayoutTimerRef.current);
      masonryLayoutTimerRef.current = null;
    }

    if (masonryLayoutWorkTagRef.current) {
      einkPower.endCriticalWork(masonryLayoutWorkTagRef.current);
      masonryLayoutWorkTagRef.current = null;
    }
  }, [modalEntry, selectedEntry, viewMode]);

  useEffect(() => {
    return () => {
      if (masonryLayoutTimerRef.current) {
        clearTimeout(masonryLayoutTimerRef.current);
      }
      if (masonryLayoutWorkTagRef.current) {
        einkPower.endCriticalWork(masonryLayoutWorkTagRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedEntry || modalEntry) return;

    einkPower.setSurface({
      mode: 'feed-list',
      eligible: isFeedSurfaceEligible,
      reason: isLoading
        ? 'feed-loading'
        : isLoadingMore
          ? 'feed-loading-more'
          : isRefetching
            ? 'feed-refetching'
            : isPTRRefreshing
              ? 'feed-refreshing'
              : isPulling
                ? 'feed-pulling'
                : undefined,
      gestureModel: 'scroll',
    });

    return () => {
      // Only reset if article-reader hasn't already taken over — avoids a race
      // where EntryList re-renders after the ArticleReader has registered itself.
      if (einkPower.getSurfaceMode() !== 'article-reader') {
        einkPower.setSurface({
          mode: 'none',
          eligible: false,
          reason: 'feed-list-closed',
          gestureModel: 'none',
        });
      }
    };
  }, [selectedEntry, modalEntry, isFeedSurfaceEligible, isLoading, isLoadingMore, isRefetching, isPTRRefreshing, isPulling]);

  useEffect(() => {
    if (!isFeedSurfaceEligible) return;

    const listEl = listRef.current;
    if (!listEl) return;

    let cancelled = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let readyToken = 0;
    let interactionWorkActive = false;
    const interactionWorkTag = 'feed-list:interaction';

    const beginInteractionWork = () => {
      if (interactionWorkActive) return;
      interactionWorkActive = true;
      einkPower.beginCriticalWork(interactionWorkTag);
    };

    const endInteractionWork = () => {
      if (!interactionWorkActive) return;
      interactionWorkActive = false;
      einkPower.endCriticalWork(interactionWorkTag);
    };

    const cancelReady = () => {
      readyToken += 1;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
    };

    const scheduleReady = () => {
      cancelReady();
      const token = ++readyToken;
      readyTimer = setTimeout(() => {
        readyTimer = null;
        void (async () => {
          await einkPower.waitForPaintCommit();
          if (cancelled || token != readyToken) return;
          endInteractionWork();
          await einkPower.markVisualStable();
          if (cancelled || token != readyToken) return;
          await einkPower.notifyInteractiveReady();
        })();
      }, EINK_INTERACTION_SETTLE_MS);
    };

    const handleInteractionStart = () => {
      beginInteractionWork();
      cancelReady();
    };

    const handleInteractionSettle = () => {
      scheduleReady();
    };

    const handleInteractionProgress = () => {
      beginInteractionWork();
      scheduleReady();
    };

    feedReadySchedulerRef.current = scheduleReady;

    listEl.addEventListener('pointerdown', handleInteractionStart, { capture: true, passive: true });
    listEl.addEventListener('touchstart', handleInteractionStart, { capture: true, passive: true });
    listEl.addEventListener('pointerup', handleInteractionSettle, { capture: true, passive: true });
    listEl.addEventListener('touchend', handleInteractionSettle, { capture: true, passive: true });
    listEl.addEventListener('touchcancel', handleInteractionSettle, { capture: true, passive: true });
    listEl.addEventListener('wheel', handleInteractionProgress, { capture: true, passive: true });
    listEl.addEventListener('scroll', handleInteractionProgress, { capture: true, passive: true });

    scheduleReady();

    return () => {
      cancelled = true;
      cancelReady();
      endInteractionWork();
      feedReadySchedulerRef.current = null;
      listEl.removeEventListener('pointerdown', handleInteractionStart, { capture: true });
      listEl.removeEventListener('touchstart', handleInteractionStart, { capture: true });
      listEl.removeEventListener('pointerup', handleInteractionSettle, { capture: true });
      listEl.removeEventListener('touchend', handleInteractionSettle, { capture: true });
      listEl.removeEventListener('touchcancel', handleInteractionSettle, { capture: true });
      listEl.removeEventListener('wheel', handleInteractionProgress, { capture: true });
      listEl.removeEventListener('scroll', handleInteractionProgress, { capture: true });
    };
  }, [isFeedSurfaceEligible, title, entries.length]);

  // Infinite scroll with Intersection Observer
  useEffect(() => {
    if (viewMode === 'magazine' || !hasMore || isLoading || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: '200px' }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [viewMode, hasMore, isLoading, isLoadingMore, onLoadMore]);

  // Scroll to selected entry when it changes (not for magazine view)
  useEffect(() => {
    if (viewMode !== 'magazine' && selectedEntry && listRef.current) {
      const selectedElement = listRef.current.querySelector(`[data-entry-id="${selectedEntry.id}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedEntry?.id, viewMode]);

  // Reset scroll position when the title (view) changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [title]);

  // Handle entry click in magazine view
  const handleMagazineSelect = (entry: Entry) => {
    if (isMobile || useFullscreenMagazineReader) {
      onSelectEntry(entry);
      return;
    }
    setModalEntry(entry);
  };

  // Render entries based on view mode
  const renderEntries = () => {
    if (viewMode === 'cards') {
      // Use container queries (@sm, @md, @lg) for responsive grid based on container width, not viewport
      return (
        <div className="grid grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3 gap-4 p-4">
          {entries.map(entry => (
            <CardItem
              key={entry.id}
              entry={entry}
              isSelected={selectedEntry?.id === entry.id}
              onSelect={onSelectEntry}
              showImages={showImages}
              excerptLines={cardsExcerptLines}
            />
          ))}
        </div>
      );
    }
    
    if (viewMode === 'magazine') {
      // Magazine view using virtualized masonry
      return (
        <VirtualizedMasonry
          entries={entries}
          onSelect={handleMagazineSelect}
          showImages={showImages}
          excerptLines={magazineExcerptLines}
          scrollContainerRef={listRef}
          hasMore={hasMore}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          onLayoutActivity={handleMasonryLayoutActivity}
        />
      );
    }
    
    // Default: list view - always compact (no excerpts)
    return (
      <div className="divide-y divide-[var(--color-border-subtle)]">
        {entries.map(entry => (
          <EntryCard
            key={entry.id}
            entry={entry}
            isSelected={selectedEntry?.id === entry.id}
            isCompact={true}
            onSelect={onSelectEntry}
            onToggleBookmark={onToggleBookmark}
            data-entry-id={entry.id}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Pull-to-refresh indicator */}
      <PullToRefreshIndicator
        pullDistance={pullDistance}
        isRefreshing={isPTRRefreshing}
        isPulling={isPulling}
        progress={progress}
      />

      {/* Entry List - Scrollable, with padding for floating header */}
      <div 
        ref={listRef}
        className={cn(
          "flex-1 content-below-header content-above-navbar @container",
          'overflow-y-auto',
        )}
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: isPulling ? 'none' : 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {isLoading && entries.length === 0 ? (
          /* Skeleton Loading State */
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-4 flex items-start gap-3 animate-pulse">
                {/* Feed icon skeleton */}
                <div className="w-5 h-5 rounded bg-[var(--color-surface-inset)] flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Title skeleton - two lines */}
                  <div className="h-3.5 bg-[var(--color-surface-inset)] rounded w-[85%]" />
                  <div className="h-3.5 bg-[var(--color-surface-inset)] rounded w-[60%]" />
                  {/* Meta row skeleton */}
                  <div className="flex items-center gap-2 mt-1">
                    <div className="h-2.5 bg-[var(--color-surface-inset)] rounded w-20" />
                    <div className="h-2.5 bg-[var(--color-surface-inset)] rounded w-12" />
                  </div>
                  {/* Excerpt skeleton */}
                  <div className="h-2.5 bg-[var(--color-surface-inset)] rounded w-[90%] mt-1" />
                  <div className="h-2.5 bg-[var(--color-surface-inset)] rounded w-[70%]" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 && !isRefetching ? (
          /* Empty State — context-specific illustrations */
          <div className="flex flex-col items-center justify-center h-64 px-6">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-surface-inset)] flex items-center justify-center mb-4">
              {title === 'Bookmarks' ? (
                <Star size={32} className="text-amber-400/60" />
              ) : (
                <Rss size={32} className="text-[var(--color-text-tertiary)]" />
              )}
            </div>
            <p className="text-[var(--color-text-secondary)] text-center font-medium">
              {title === 'Bookmarks' ? 'No bookmarks yet' : 'No articles found'}
            </p>
            <p className="text-sm text-[var(--color-text-tertiary)] text-center mt-1">
              {title === 'Bookmarks'
                ? 'Star articles to save them here for later'
                : 'Try selecting a different view or refreshing your feeds'}
            </p>
          </div>
        ) : (
          <>
            {renderEntries()}
            
            {/* Load More Trigger */}
            {hasMore && viewMode !== 'magazine' && (
              <div 
                ref={loadMoreRef}
                className="py-6 flex items-center justify-center"
              >
                {isLoadingMore ? (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]">
                    <RefreshCw className="animate-spin" size={14} />
                    <span>Loading more...</span>
                  </div>
                ) : (
                  <button
                    onClick={onLoadMore}
                    className={cn(
                      'px-4 py-2 text-sm rounded-lg transition-colors',
                      'text-[var(--color-accent-fg)] hover:bg-[var(--color-surface-hover)]'
                    )}
                  >
                    Load more articles
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Article Modal for Magazine View */}
      {modalEntry && !isMobile && !useFullscreenMagazineReader && (
        <ArticleModal
          entry={modalEntry}
          onClose={() => setModalEntry(null)}
          onToggleBookmark={onToggleBookmark}
          onMarkAsRead={onMarkAsRead}
          onMarkAsUnread={onMarkAsUnread}
        />
      )}
    </div>
  );
}

export default EntryList;
