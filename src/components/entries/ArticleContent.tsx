/**
 * ArticleContent Component
 * Shared article content rendering used by both ArticleReader and ArticleModal
 * Handles cover images, YouTube videos, audio/video enclosures, and prose content
 */

import { useState, useEffect, useCallback } from 'react';
import { cn, formatRelativeTime, formatReadingTime, isYouTubeUrl, extractYouTubeId, extractFirstImage, removeFirstImageFromContent, stripYouTubeEmbeds } from '@/lib/utils';
import { ExternalLink, Play, ListPlus } from 'lucide-react';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import { PlayButton } from '@/components/player/PlayButton';
import { miniflux } from '@/api/miniflux';
import type { Entry } from '@/types/miniflux';
import { useSettingsStore } from '@/stores/settings';
import { useVideoStore, getVideoEnclosure } from '@/stores/video';

interface ArticleContentProps {
  entry: Entry;
  showCoverImage?: boolean;
  showFooter?: boolean;
  // Controlled reader view props - when provided, ArticleContent won't manage its own state
  isReaderViewControlled?: boolean;
  isLoadingReaderControlled?: boolean;
  readerContentControlled?: string | null;
  onToggleReaderViewControlled?: () => void;
  // Deprecated - kept for backward compatibility
  showReaderViewToggle?: boolean;
  onReaderViewToggle?: (isReaderView: boolean) => void;
  className?: string;
}

// Page Hero Component - Notion-style cover image that extends under header
function PageHero({ imageUrl }: { imageUrl: string }) {
  return (
    <div className="relative w-full h-56 md:h-72 -mt-14 overflow-hidden">
      <img 
        src={imageUrl} 
        alt="" 
        className="w-full h-full object-cover"
        loading="eager"
      />
      {/* Top gradient for header readability */}
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/40 to-transparent" />
      {/* Bottom gradient for content transition */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--color-surface-base)] to-transparent" />
    </div>
  );
}

// YouTube Video Trigger Component
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
    <button
      onClick={handlePlay}
      className="group mb-8 relative aspect-video w-full rounded-xl overflow-hidden bg-black shadow-lg hover:shadow-xl transition-shadow"
    >
      {/* YouTube Thumbnail */}
      <img
        src={thumbnailUrl}
        alt={entry.title}
        className="w-full h-full object-cover"
        onError={(e) => {
          e.currentTarget.src = `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
        }}
      />
      {/* Play Overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
          {isCurrentlyPlaying ? (
            <div className="w-5 h-5 border-2 border-white rounded-sm" />
          ) : (
            <Play size={28} fill="white" className="text-white ml-1" />
          )}
        </div>
      </div>
      {/* Progress bar */}
      {progressPercent > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
          <div 
            className="h-full bg-red-500"
            style={{ width: `${Math.min(progressPercent, 100)}%` }}
          />
        </div>
      )}
    </button>
  );
}

export function ArticleContent({
  entry,
  showCoverImage = true,
  showFooter = true,
  // Controlled reader view props
  isReaderViewControlled,
  isLoadingReaderControlled,
  readerContentControlled,
  onToggleReaderViewControlled,
  // Deprecated props
  showReaderViewToggle = false,
  onReaderViewToggle,
  className,
}: ArticleContentProps) {
  const { play: playVideo, addToQueue: addVideoToQueue, queue: videoQueue, currentEntry: currentVideoEntry } = useVideoStore();
  const showArticleImages = useSettingsStore((s) => s.showArticleImages);
  const autoReaderView = useSettingsStore((s) => s.autoReaderView);
  
  // Internal reader view state (used when not controlled externally)
  const [isReaderViewInternal, setIsReaderViewInternal] = useState(false);
  const [readerContentInternal, setReaderContentInternal] = useState<string | null>(null);
  const [isLoadingReaderInternal, setIsLoadingReaderInternal] = useState(false);
  
  // Use controlled values if provided, otherwise use internal state
  const isControlled = isReaderViewControlled !== undefined;
  const isReaderView = isControlled ? isReaderViewControlled : isReaderViewInternal;
  const isLoadingReader = isControlled ? (isLoadingReaderControlled ?? false) : isLoadingReaderInternal;
  const readerContent = isControlled ? readerContentControlled : readerContentInternal;
  
  // YouTube ID from URL
  const youtubeId = isYouTubeUrl(entry.url) ? extractYouTubeId(entry.url) : null;
  
  // Check for audio enclosures (podcasts)
  const audioEnclosure = entry.enclosures?.find(e => e.mime_type?.startsWith('audio/'));
  
  // Check for video enclosures
  const videoEnclosure = getVideoEnclosure(entry);
  const isVideoCurrentlyPlaying = currentVideoEntry?.id === entry.id;
  const isVideoInQueue = videoQueue.some(item => item.entry.id === entry.id);
  
  // Use entry.content directly
  const originalContent = entry.content;
  
  // Toggle reader view - fetch full content from original source
  // Only used in uncontrolled mode
  const handleToggleReaderView = useCallback(async () => {
    // If controlled externally, delegate to parent
    if (isControlled && onToggleReaderViewControlled) {
      onToggleReaderViewControlled();
      return;
    }
    
    if (isLoadingReaderInternal) return;
    
    if (isReaderViewInternal) {
      setIsReaderViewInternal(false);
      onReaderViewToggle?.(false);
      return;
    }
    
    if (readerContentInternal) {
      setIsReaderViewInternal(true);
      onReaderViewToggle?.(true);
      return;
    }
    
    setIsLoadingReaderInternal(true);
    try {
      const fullEntry = await miniflux.fetchOriginalContent(entry.id);
      setReaderContentInternal(fullEntry.content);
      setIsReaderViewInternal(true);
      onReaderViewToggle?.(true);
    } catch (error) {
      console.error('Failed to fetch reader view content:', error);
    } finally {
      setIsLoadingReaderInternal(false);
    }
  }, [isControlled, onToggleReaderViewControlled, isLoadingReaderInternal, isReaderViewInternal, readerContentInternal, entry.id, onReaderViewToggle]);
  
  // Auto-fetch reader view if enabled (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled && autoReaderView && showReaderViewToggle && !readerContentInternal) {
      handleToggleReaderView();
    }
  }, [entry.id, autoReaderView, showReaderViewToggle, isControlled]);
  
  // Reset reader view when entry changes (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled) {
      setIsReaderViewInternal(false);
      setReaderContentInternal(null);
    }
  }, [entry.id, isControlled]);
  
  // Use reader content if active, otherwise original
  const displayContent = isReaderView && readerContent ? readerContent : originalContent;
  
  // Extract cover image from content
  const coverImage = showArticleImages && showCoverImage ? extractFirstImage(displayContent) : null;
  
  // Remove the first image from content if shown as cover
  let articleContent = coverImage 
    ? removeFirstImageFromContent(displayContent, coverImage)
    : displayContent;
  
  // Always strip YouTube embeds and detect embedded videos
  const { html: strippedContent, youtubeIds: embeddedYouTubeIds } = stripYouTubeEmbeds(articleContent);
  articleContent = strippedContent;
  
  // Use entry URL YouTube ID or first embedded YouTube ID
  const effectiveYouTubeId = youtubeId || embeddedYouTubeIds[0] || null;

  return (
    <>
      {/* Page Hero Cover Image - extends under header */}
      {coverImage && !effectiveYouTubeId && (
        <PageHero imageUrl={coverImage} />
      )}
      
      {/* Spacer when no cover image */}
      {(!coverImage || effectiveYouTubeId) && <div className="h-14" />}
      
      <div className={cn(
        "max-w-3xl mx-auto px-6",
        coverImage && !effectiveYouTubeId ? "-mt-8 relative z-10" : "py-8",
        className
      )}>
        {/* Article Title */}
        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] leading-tight">
            {entry.title}
          </h1>
          
          {/* Meta row with feed icon */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-4 text-sm text-[var(--color-text-secondary)]">
            <FeedIcon 
              feedId={entry.feed_id} 
              iconId={entry.feed?.icon?.icon_id}
              size={18}
            />
            <span className="font-medium">{entry.feed?.title}</span>
            {entry.author && (
              <>
                <span className="text-[var(--color-text-tertiary)]">·</span>
                <span>{entry.author}</span>
              </>
            )}
            <span className="text-[var(--color-text-tertiary)]">·</span>
            <time dateTime={entry.published_at}>
              {formatRelativeTime(entry.published_at)}
            </time>
            {entry.reading_time > 0 && (
              <>
                <span className="text-[var(--color-text-tertiary)]">·</span>
                <span>{formatReadingTime(entry.reading_time)} read</span>
              </>
            )}
          </div>

          {/* Audio Player Button for Podcasts */}
          {audioEnclosure && (
            <div className="mt-4">
              <PlayButton 
                entry={entry} 
                enclosure={audioEnclosure}
                size="md"
                showLabel
                showAddToQueue
              />
            </div>
          )}
        </header>

        {/* YouTube Video Play Button */}
        {effectiveYouTubeId && (
          <YouTubeVideoTrigger entry={entry} youtubeId={effectiveYouTubeId} />
        )}

        {/* Video Enclosure Play Button (non-YouTube videos) */}
        {!effectiveYouTubeId && videoEnclosure && (
          <div className="mb-8 flex items-center gap-3">
            <button
              onClick={() => playVideo(videoEnclosure, entry)}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-full text-sm font-medium transition-all",
                "bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-hover)]",
                "shadow-lg hover:shadow-xl"
              )}
            >
              <Play size={20} fill="currentColor" className="ml-0.5" />
              Play Video
            </button>
            {!isVideoCurrentlyPlaying && (
              <button
                onClick={() => {
                  if (!isVideoInQueue) {
                    addVideoToQueue(videoEnclosure, entry);
                  }
                }}
                disabled={isVideoInQueue}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 rounded-full text-sm font-medium transition-all",
                  isVideoInQueue
                    ? "bg-[var(--color-surface-inset)] text-[var(--color-text-tertiary)] cursor-default"
                    : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                )}
                title={isVideoInQueue ? "Already in queue" : "Add to queue"}
              >
                <ListPlus size={18} />
                {isVideoInQueue ? "In Queue" : "Add to Queue"}
              </button>
            )}
          </div>
        )}

        {/* Article HTML Content */}
        <div 
          className="prose prose-stone dark:prose-invert max-w-none
            prose-headings:font-semibold prose-headings:text-[var(--color-text-primary)]
            prose-p:text-[var(--color-text-secondary)] prose-p:leading-relaxed
            prose-a:text-[var(--color-accent-fg)] prose-a:no-underline hover:prose-a:underline
            prose-img:rounded-lg prose-img:shadow-md
            prose-blockquote:border-l-[var(--color-accent-fg)] prose-blockquote:text-[var(--color-text-secondary)]
            prose-code:bg-[var(--color-surface-inset)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.875em]
            prose-pre:bg-[var(--color-surface-secondary)] prose-pre:border prose-pre:border-[var(--color-border-subtle)]
          "
          dangerouslySetInnerHTML={{ __html: articleContent }}
        />

        {/* Footer: Link to original */}
        {showFooter && (
          <footer className="mt-12 pt-6 border-t border-[var(--color-border-subtle)]">
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[var(--color-accent-fg)] hover:underline"
            >
              <ExternalLink size={14} />
              Read original article
            </a>
          </footer>
        )}
      </div>
    </>
  );
}

export default ArticleContent;
