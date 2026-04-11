/**
 * ArticleContent Component
 * Shared article content rendering used by both ArticleReader and ArticleModal
 * Handles cover images, YouTube videos, audio/video enclosures, and prose content
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn, formatRelativeTime, formatReadingTime, isYouTubeUrl, extractYouTubeId, extractFirstImage, sanitizeArticleHtml, stripYouTubeEmbeds } from '@/lib/utils';
import { ExternalLink, Play, ListPlus, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import { PlayButton } from '@/components/player/PlayButton';
import { api } from '@/api/client';
import { TTSButton } from '@/components/tts/TTSButton';
import type { Entry } from '@/types/api';
import { useSettingsStore } from '@/stores/settings';
import { useVideoStore, getVideoEnclosure } from '@/stores/video';
import { useMediaQueueStore } from '@/stores/mediaQueue';
import { ImageGallery } from '@/components/reader/ImageGallery';
import { EPUB_FONT_FACE_CSS } from '@/lib/epub-fonts';
import { getTypographyFontFamily, isOriginalTypography } from '@/lib/typography';
import type { CSSProperties } from 'react';

const ARTICLE_FONT_STYLE_ID = 'informeer-article-font-faces';

interface ArticleContentProps {
  entry: Entry;
  showCoverImage?: boolean;
  showFooter?: boolean;
  // Controlled reader view props - when provided, ArticleContent won't manage its own state
  isReaderViewControlled?: boolean;
  isLoadingReaderControlled?: boolean;
  readerContentControlled?: string | null;
  onToggleReaderViewControlled?: () => void;
  fetchError?: string | null;
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
  fetchError,
  // Deprecated props
  showReaderViewToggle = false,
  onReaderViewToggle,
  className,
}: ArticleContentProps) {
  const { play: playVideo, currentEntry: currentVideoEntry } = useVideoStore();
  const { addVideoToQueue, isVideoQueued } = useMediaQueueStore();
  const showArticleImages = useSettingsStore((s) => s.showArticleImages);
  const articleTypography = useSettingsStore((s) => s.articleTypography);
  
  // Per-feed content fetch policy
  const feedPolicy = entry.feed?.content_fetch_policy || 'rss_only';
  
  // Internal reader view state (used when not controlled externally)
  const [isReaderViewInternal, setIsReaderViewInternal] = useState(false);
  const [readerContentInternal, setReaderContentInternal] = useState<string | null>(null);
  const [isLoadingReaderInternal, setIsLoadingReaderInternal] = useState(false);
  const [fetchErrorInternal, setFetchErrorInternal] = useState<string | null>(null);
  
  // Use controlled values if provided, otherwise use internal state
  const isControlled = isReaderViewControlled !== undefined;
  const isReaderView = isControlled ? isReaderViewControlled : isReaderViewInternal;
  const isLoadingReader = isControlled ? (isLoadingReaderControlled ?? false) : isLoadingReaderInternal;
  const readerContent = isControlled ? readerContentControlled : readerContentInternal;
  const effectiveFetchError = isControlled ? fetchError : fetchErrorInternal;
  
  // YouTube ID from URL
  const youtubeId = isYouTubeUrl(entry.url) ? extractYouTubeId(entry.url) : null;
  
  // Check for audio enclosures (podcasts)
  const audioEnclosure = entry.enclosures?.find(e => e.mime_type?.startsWith('audio/'));
  
  // Check for video enclosures
  const videoEnclosure = getVideoEnclosure(entry);
  const isVideoCurrentlyPlaying = currentVideoEntry?.id === entry.id;
  const isVideoInQueue = isVideoQueued(entry.id);
  
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
    setFetchErrorInternal(null);
    try {
      const fullEntry = await api.fetchOriginalContent(entry.id);
      setReaderContentInternal(fullEntry.content);
      setIsReaderViewInternal(true);
      onReaderViewToggle?.(true);
    } catch (error) {
      console.error('Failed to fetch reader view content:', error);
      setFetchErrorInternal('Could not load full article content');
    } finally {
      setIsLoadingReaderInternal(false);
    }
  }, [isControlled, onToggleReaderViewControlled, isLoadingReaderInternal, isReaderViewInternal, readerContentInternal, entry.id, onReaderViewToggle]);
  
  // Auto-fetch reader view based on per-feed policy (only in uncontrolled mode)
  // 'on_demand' → auto-fetch when opened; 'always' → already full; 'rss_only' → skip
  useEffect(() => {
    if (!isControlled && feedPolicy === 'on_demand' && showReaderViewToggle && !readerContentInternal) {
      handleToggleReaderView();
    }
  }, [entry.id, feedPolicy, showReaderViewToggle, isControlled]);
  
  // Reset reader view when entry changes (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled) {
      setIsReaderViewInternal(false);
      setReaderContentInternal(null);
    }
  }, [entry.id, isControlled]);
  
  // Use reader content if active, otherwise original
  const displayContent = isReaderView && readerContent ? readerContent : originalContent;
  
  // Strip social-share widgets and icon blocks before extracting the cover or rendering HTML.
  let articleContent = sanitizeArticleHtml(displayContent);
  
  // Extract cover image from sanitized content
  const coverImage = showArticleImages && showCoverImage ? extractFirstImage(articleContent) : null;
  
  // Always strip YouTube embeds and detect embedded videos
  const { html: strippedContent, youtubeIds: embeddedYouTubeIds } = stripYouTubeEmbeds(articleContent);
  articleContent = strippedContent;
  
  // Use entry URL YouTube ID or first embedded YouTube ID
  const effectiveYouTubeId = youtubeId || embeddedYouTubeIds[0] || null;

  // ─── Image gallery mode ──────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null);
  const [galleryImages, setGalleryImages] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'IMG') return;
    const img = target as HTMLImageElement;
    if (!img.src) return;
    
    // Collect all images in the article content
    const container = contentRef.current;
    if (!container) return;
    const allImgs = Array.from(container.querySelectorAll('img'))
      .map(el => el.src)
      .filter(Boolean);
    if (allImgs.length === 0) return;
    
    const idx = allImgs.indexOf(img.src);
    setGalleryImages(allImgs);
    setGalleryIndex(idx >= 0 ? idx : 0);
  }, []);

  useEffect(() => {
    let style = document.getElementById(ARTICLE_FONT_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = ARTICLE_FONT_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = EPUB_FONT_FACE_CSS;
  }, []);

  const originalTypography = isOriginalTypography(articleTypography);
  const contentFontFamily = getTypographyFontFamily(articleTypography.fontFamily);
  const articleTitleStyle: CSSProperties | undefined = contentFontFamily
    ? { fontFamily: contentFontFamily }
    : undefined;
  const articleLayoutStyle: CSSProperties = {
    maxWidth: `${articleTypography.maxWidth}px`,
  };
  const articleBodyStyle: CSSProperties | undefined = originalTypography
    ? undefined
    : {
        fontFamily: contentFontFamily,
        fontSize: `${articleTypography.fontSize}%`,
        lineHeight: articleTypography.lineHeight,
        textAlign: articleTypography.textAlign === 'original'
          ? undefined
          : articleTypography.textAlign as CSSProperties['textAlign'],
        hyphens: articleTypography.hyphenation ? 'auto' : 'manual',
      };
  const articleTypographyCss = originalTypography
    ? ''
    : `
      .informeer-article-typography p {
        margin-top: 0;
        margin-bottom: ${articleTypography.paragraphSpacing}em;
        line-height: ${articleTypography.lineHeight} !important;
      }

      .informeer-article-typography ul,
      .informeer-article-typography ol,
      .informeer-article-typography blockquote,
      .informeer-article-typography pre {
        margin-top: ${Math.max(articleTypography.paragraphSpacing * 0.85, 0.75)}em;
        margin-bottom: ${Math.max(articleTypography.paragraphSpacing * 0.85, 0.75)}em;
        line-height: ${articleTypography.lineHeight} !important;
      }

      .informeer-article-typography li + li {
        margin-top: ${Math.max(articleTypography.paragraphSpacing * 0.35, 0.3)}em;
      }

      .informeer-article-typography li,
      .informeer-article-typography figcaption,
      .informeer-article-typography td,
      .informeer-article-typography th,
      .informeer-article-typography dd,
      .informeer-article-typography dt,
      .informeer-article-typography blockquote p {
        line-height: ${articleTypography.lineHeight} !important;
      }
    `;

  return (
    <>
      {articleTypographyCss && <style>{articleTypographyCss}</style>}
      {/* Page Hero Cover Image - extends under header */}
      {coverImage && !effectiveYouTubeId && (
        <PageHero imageUrl={coverImage} />
      )}
      
      {/* Spacer when no cover image */}
      {(!coverImage || effectiveYouTubeId) && <div className="h-14" />}
      
      <div className={cn(
        "mx-auto px-6",
        coverImage && !effectiveYouTubeId ? "-mt-8 relative z-10" : "py-8",
        className
      )}
        style={articleLayoutStyle}
      >
        {/* Article Title */}
        <header className="mb-8">
          <h1
            className="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] leading-tight"
            style={articleTitleStyle}
          >
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

          {/* TTS Listen Button for text articles (no podcast audio) */}
          {!audioEnclosure && !effectiveYouTubeId && (
            <div className="mt-4">
              <TTSButton
                entry={entry}
                size="md"
                variant="outline"
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
                    addVideoToQueue(entry, { enclosure: videoEnclosure });
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

        {/* Content fetch status */}
        {isLoadingReader && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] text-sm text-[var(--color-text-tertiary)] animate-pulse">
            <Loader2 size={14} className="animate-spin" />
            Loading full article content...
          </div>
        )}
        {effectiveFetchError && !isLoadingReader && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-red-500/10 text-sm text-red-500">
            {effectiveFetchError}
          </div>
        )}
        {isReaderView && readerContent && !isLoadingReader && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-[var(--color-accent-primary)]/10 text-xs text-[var(--color-accent-fg)]">
            Full article content loaded
          </div>
        )}

        {/* Article HTML Content */}
        <div>
          <div 
            ref={contentRef}
            onClick={handleContentClick}
            className={cn(
              'prose prose-stone dark:prose-invert max-w-none',
              !originalTypography && 'informeer-article-typography',
              'prose-headings:font-semibold prose-headings:text-[var(--color-text-primary)]',
              'prose-p:text-[var(--color-text-secondary)] prose-p:leading-relaxed',
              'prose-a:text-[var(--color-accent-fg)] prose-a:no-underline hover:prose-a:underline',
              'prose-img:rounded-lg prose-img:shadow-md prose-img:cursor-zoom-in',
              'prose-blockquote:border-l-[var(--color-accent-fg)] prose-blockquote:text-[var(--color-text-secondary)]',
              'prose-code:bg-[var(--color-surface-inset)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.875em]',
              'prose-pre:bg-[var(--color-surface-secondary)] prose-pre:border prose-pre:border-[var(--color-border-subtle)]',
            )}
            style={articleBodyStyle}
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
      </div>
      
      {/* Image Gallery Overlay */}
      {galleryImages && createPortal(
        <ImageGallery
          images={galleryImages}
          initialIndex={galleryIndex}
          onClose={() => setGalleryImages(null)}
        />,
        document.body
      )}
    </>
  );
}

export default ArticleContent;
