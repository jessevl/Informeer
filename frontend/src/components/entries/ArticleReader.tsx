/**
 * ArticleReader Component
 * Full article view with reading experience
 * Uses shared ArticleContent for the actual article rendering
 * Supports split-view with comments panel for HN and Reddit discussions
 * 
 * Mobile: Full-screen overlay with fixed header and back button
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { cn, stripHtml } from '@/lib/utils';
import { Star, Check, Circle, ExternalLink, X, Share2, ChevronUp, ChevronDown, FileText, Loader2, MessageSquare, PanelRightClose, ArrowLeft, MoreVertical, Headphones } from 'lucide-react';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import ContextMenu, { type ContextMenuItem } from '@frameer/components/ui/ContextMenu';
import type { Entry } from '@/types/api';
import { ArticleContent } from './ArticleContent';
import { CommentsPanel } from './CommentsPanel';
import { ArticleHeaderActions, getArticleActionDefinitions, getArticleContextMenuItems } from './ArticleHeaderActions';
import { api } from '@/api/client';
import { useTTSStore, prepareTextForTTS } from '@/stores/tts';
import { hasCommentsAvailable } from '@/api/comments';
import { useArticleScrollProgress } from '@/hooks/useArticleScrollProgress';
import { useSettingsStore } from '@/stores/settings';
import { TypographyPanel } from '@/components/reader/TypographyPanel';
import { ARTICLE_FONT_OPTIONS, DEFAULT_ARTICLE_TYPOGRAPHY } from '@/lib/typography';
import { useResolvedIsDark } from '@/hooks/useResolvedIsDark';

interface ArticleReaderProps {
  entry: Entry;
  onClose: () => void;
  onToggleBookmark: (entryId: number) => void;
  onMarkAsRead: (entryId: number) => void;
  onMarkAsUnread: (entryId: number) => void;
  onPreviousEntry?: () => void;
  onNextEntry?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  fullscreen?: boolean;
}

// In-memory cache of scroll positions per article is now in useArticleScrollProgress hook

export function ArticleReader({
  entry,
  onClose,
  onToggleBookmark,
  onMarkAsRead,
  onMarkAsUnread,
  onPreviousEntry,
  onNextEntry,
  hasPrevious = false,
  hasNext = false,
  fullscreen = false,
}: ArticleReaderProps) {
  const isUnread = entry.status === 'unread';
  const isMobile = useIsMobile();
  const einkMode = useSettingsStore((s) => s.einkMode);
  const articleTypography = useSettingsStore((s) => s.articleTypography);
  const setArticleTypography = useSettingsStore((s) => s.setArticleTypography);
  const isCompactReaderLayout = isMobile;
  const isDarkMode = useResolvedIsDark();
  
  // Per-feed content fetch policy (replaces global autoReaderView)
  const feedPolicy = entry.feed?.content_fetch_policy || 'rss_only';
  
  // Reader view state
  const [isReaderView, setIsReaderView] = useState(false);
  const [readerContent, setReaderContent] = useState<string | null>(null);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [showTypography, setShowTypography] = useState(false);
  
  // Comments panel state - auto-open on desktop only (mobile requires manual open)
  const hasComments = hasCommentsAvailable(entry);
  const [showComments, setShowComments] = useState(!isCompactReaderLayout && hasComments);
  
  // Update showComments when entry changes (keep closed on mobile)
  useEffect(() => {
    setShowComments(!isCompactReaderLayout && hasCommentsAvailable(entry));
  }, [entry.id, isCompactReaderLayout]);

  useEffect(() => {
    setShowTypography(false);
  }, [entry.id]);
  
  // Reset reader view when entry changes
  const [prevEntryId, setPrevEntryId] = useState(entry.id);
  if (entry.id !== prevEntryId) {
    setPrevEntryId(entry.id);
    setIsReaderView(false);
    setReaderContent(null);
    setIsLoadingReader(false);
  }
  
  // Auto-fetch based on per-feed content_fetch_policy:
  //  - 'always': content was pre-fetched during sync, already full in entry.content → no fetch needed
  //  - 'on_demand': fetch full article when the user opens it
  //  - 'rss_only': show RSS content as-is, manual toggle still available
  // Fallback: if content is too short (< 100 chars) and policy isn't rss_only, fetch anyway
  //
  // Never crawl non-RSS sources (NRC, MagazineLib) or media entries (YouTube, podcasts, videos).
  const feedSourceType = entry.feed?.source_type || 'rss';
  const isYouTube = /youtube\.com|youtu\.be/.test(entry.url);
  const isAudio = !!entry.enclosures?.some(e => e.mime_type?.startsWith('audio/'));
  const isVideo = !!entry.enclosures?.some(e => e.mime_type?.startsWith('video/'));
  const canUseReaderView = feedSourceType === 'rss' && !isYouTube && !isAudio && !isVideo;
  const [autoFetched, setAutoFetched] = useState<number | null>(null);
  const isContentTooShort = stripHtml(entry.content || '').trim().length < 100;
  const shouldAutoFetch = canUseReaderView && (feedPolicy === 'on_demand' || (isContentTooShort && feedPolicy !== 'rss_only'));
  
  if (shouldAutoFetch && entry.id !== autoFetched && !readerContent && !isLoadingReader) {
    setAutoFetched(entry.id);
    setIsLoadingReader(true);
    api.fetchOriginalContent(entry.id)
      .then(fullEntry => { setReaderContent(fullEntry.content); setIsReaderView(true); })
      .catch(e => console.error('Failed to fetch reader view:', e))
      .finally(() => setIsLoadingReader(false));
  }
  
  // Toggle reader view
  const handleToggleReaderView = useCallback(async () => {
    if (isLoadingReader) return;
    if (isReaderView) { setIsReaderView(false); return; }
    if (readerContent) { setIsReaderView(true); return; }
    
    setIsLoadingReader(true);
    try {
      const fullEntry = await api.fetchOriginalContent(entry.id);
      setReaderContent(fullEntry.content);
      setIsReaderView(true);
    } catch (e) { console.error('Failed to fetch reader view:', e); }
    finally { setIsLoadingReader(false); }
  }, [isLoadingReader, isReaderView, readerContent, entry.id]);

  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: entry.title, url: entry.url }); } catch {}
    } else {
      await navigator.clipboard.writeText(entry.url);
    }
  };

  // TTS handler
  const handleListenToArticle = useCallback(() => {
    const { modelStatus, initModel, generate, currentEntry: ttsEntry, isPlaying: ttsPlaying, setPlaying, generationStatus } = useTTSStore.getState();
    
    if (ttsEntry?.id === entry.id) {
      // Toggle playback for current article
      if (ttsPlaying) {
        setPlaying(false);
      } else if (generationStatus === 'done' || generationStatus === 'generating') {
        setPlaying(true);
      } else {
        const text = prepareTextForTTS(entry.content || '');
        if (text.length > 0) {
          if (modelStatus === 'idle') initModel();
          generate(text, entry);
        }
      }
    } else {
      const text = prepareTextForTTS(entry.content || '');
      if (text.length > 0) {
        if (modelStatus === 'idle') initModel();
        generate(text, entry);
      }
    }
  }, [entry]);

  const ttsState = useTTSStore();
  const isTTSCurrentArticle = ttsState.currentEntry?.id === entry.id;
  const isTTSPlaying = isTTSCurrentArticle && ttsState.isPlaying;

  // Common button class for header (shared between mobile and desktop)
  const btnClass = "flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 transition-colors";

  // ─── Swipe-down-to-close (mobile) ────────────────────────────────
  const { scrollRef, progressRef } = useArticleScrollProgress(entry.id);
  const [pullDismiss, setPullDismiss] = useState(0); // 0..1 progress
  const pullRef = useRef({ startY: 0, active: false, pulling: false });

  const handleArticleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    pullRef.current = { startY: e.touches[0].clientY, active: true, pulling: false };
  }, []);

  const handleArticleTouchMove = useCallback((e: React.TouchEvent) => {
    const p = pullRef.current;
    if (!p.active) return;
    const el = scrollRef.current;
    if (!el) return;

    const dy = e.touches[0].clientY - p.startY;

    // Only start pulling after a clear downward movement while at scroll top
    if (!p.pulling) {
      if (dy > 10 && el.scrollTop <= 0) {
        p.pulling = true;
      } else {
        return;
      }
    }

    if (dy > 0 && el.scrollTop <= 0) {
      const distance = Math.min(dy, 200);
      setPullDismiss(distance / 150); // 150px = full threshold
    }
  }, []);

  const handleArticleTouchEnd = useCallback(() => {
    const p = pullRef.current;
    p.active = false;
    p.pulling = false;
    if (pullDismiss >= 1) {
      onClose();
    }
    setPullDismiss(0);
  }, [pullDismiss, onClose]);

  // =========================================================================
  // MOBILE LAYOUT
  // =========================================================================
  if (isCompactReaderLayout) {
    const actionDefinitions = getArticleActionDefinitions({
      entry,
      isUnread,
      isReaderView,
      isLoadingReader,
      hasComments,
      showComments,
      showTypography,
      isTTSPlaying,
      onListenToArticle: handleListenToArticle,
      onToggleReaderView: handleToggleReaderView,
      onToggleTypography: () => setShowTypography((value) => !value),
      onToggleComments: () => { setShowComments(!showComments); setShowTypography(false); },
      onToggleBookmark: () => onToggleBookmark(entry.id),
      onToggleReadStatus: () => isUnread ? onMarkAsRead(entry.id) : onMarkAsUnread(entry.id),
      onShare: handleShare,
      onClose,
    });

    const mobileMenuItems: ContextMenuItem[] = getArticleContextMenuItems(actionDefinitions, [
      'listen',
      'reader-view',
      'typography',
      'comments',
      'read-status',
      'share',
      'open-original',
    ]);

    const pullOffset = Math.min(pullDismiss * 100, 100);
    const pullScale = 1 - Math.min(pullDismiss, 1) * 0.02;
    const pullOpacity = 1 - Math.min(pullDismiss, 1) * 0.08;

    return (
      <div
        className={cn(
          'fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-[var(--color-background)]',
          !einkMode && 'animate-slide-in-right'
        )}
        style={pullDismiss > 0 ? {
          transform: `translateY(${pullOffset}px) scale(${pullScale})`,
          opacity: pullOpacity,
          borderRadius: '12px',
          transition: 'none',
          overflow: 'hidden',
        } : undefined}
      >
        {/* Reader scroll progress bar */}
        <div className="absolute top-0 left-0 right-0 z-[70] h-0.5 pointer-events-none">
          <div 
            ref={progressRef}
            className="h-full bg-[var(--color-accent-fg)] transition-[width] duration-150"
            style={{ width: '0%' }}
          />
        </div>
        
        {/* Mobile Floating Header - glass panels like desktop */}
        <div className={cn(
          "absolute top-0 left-0 right-0 z-50 h-0 overflow-visible pointer-events-none",
          "pt-[env(safe-area-inset-top)]"
        )}>
          <div className="flex items-center gap-2 px-3 py-3 pointer-events-auto">
            {/* LEFT: Back button */}
            <div className="glass-panel-nav flex items-center px-1 py-1">
              <button
                onClick={onClose}
                className={btnClass}
                aria-label="Back"
              >
                <ArrowLeft size={18} strokeWidth={1.75} />
              </button>
            </div>
            
            {/* CENTER: Title breadcrumb */}
            <div className="glass-panel-nav flex items-center gap-1.5 px-2.5 py-1.5 min-w-0 flex-1">
              <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[80px]">
                {entry.feed?.title}
              </span>
              <span className="text-[var(--color-text-tertiary)]">›</span>
              <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {entry.title}
              </span>
            </div>
            
            {/* RIGHT: Actions */}
            <div className="glass-panel-nav flex items-center gap-0.5 px-1 py-1">
              <button
                onClick={() => onToggleBookmark(entry.id)}
                className={cn(btnClass, entry.starred && 'text-amber-500 bg-amber-500/10')}
                aria-label={entry.starred ? 'Remove from starred' : 'Add to starred'}
              >
                <Star size={18} className={entry.starred ? 'fill-current' : ''} />
              </button>
              
              <ContextMenu items={mobileMenuItems} trigger="click">
                <button
                  className={btnClass}
                  aria-label="More actions"
                >
                  <MoreVertical size={18} />
                </button>
              </ContextMenu>
            </div>
          </div>
        </div>
        
        {/* Pull-down dismiss indicator */}
        {pullDismiss > 0 && (
          <div className="absolute top-[env(safe-area-inset-top)] left-1/2 -translate-x-1/2 z-[60] pt-2 pointer-events-none">
            <div
              className="w-10 h-1 rounded-full bg-[var(--color-text-tertiary)]"
              style={{ opacity: Math.min(pullDismiss, 1), transform: `scaleX(${0.5 + pullDismiss * 0.5})` }}
            />
          </div>
        )}
        
        {/* Content - with padding for floating header and bottom bar */}
        <article
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain pt-12"
          onTouchStart={handleArticleTouchStart}
          onTouchMove={handleArticleTouchMove}
          onTouchEnd={handleArticleTouchEnd}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <ArticleContent 
            entry={entry} 
            showCoverImage 
            showFooter
            isReaderViewControlled={isReaderView}
            isLoadingReaderControlled={isLoadingReader}
            readerContentControlled={readerContent}
            onToggleReaderViewControlled={handleToggleReaderView}
          />
        </article>

        {showTypography && (
          <>
            <div
              className="absolute inset-0 z-[65] bg-black/20"
              onClick={() => setShowTypography(false)}
            />
            <TypographyPanel
              settings={articleTypography}
              onChange={setArticleTypography}
              onClose={() => setShowTypography(false)}
              isDarkMode={isDarkMode}
              className="z-[75]"
              topOffset="calc(env(safe-area-inset-top, 0px) + 3.75rem)"
              fontOptions={ARTICLE_FONT_OPTIONS}
              originalFormattingTitle="Use the article's default formatting"
              defaultSettings={DEFAULT_ARTICLE_TYPOGRAPHY}
              showMarginControls={false}
              showMaxWidthControl={true}
            />
          </>
        )}
        
        {/* Mobile Comments Overlay */}
        {showComments && hasComments && (
          <div className={cn(
            "fixed inset-0 z-[60]",
            "bg-[var(--color-surface-primary)]",
            !einkMode && 'animate-slide-in-right',
            'flex flex-col'
          )}>
            {/* Comments Floating Header */}
            <div className={cn(
              "absolute top-0 left-0 right-0 z-10 h-0 overflow-visible pointer-events-none",
              "pt-[env(safe-area-inset-top)]"
            )}>
              <div className="flex items-center gap-2 px-3 py-3 pointer-events-auto">
                <div className="glass-panel-nav flex items-center px-1 py-1">
                  <button
                    onClick={() => setShowComments(false)}
                    className={btnClass}
                    aria-label="Back to article"
                  >
                    <ArrowLeft size={18} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="glass-panel-nav flex items-center px-2.5 py-1.5">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Discussion
                  </span>
                </div>
              </div>
            </div>
            
            {/* Comments Content — top padding must clear safe-area + floating header */}
            <div className="flex-1 overflow-y-auto" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)' }}>
              <CommentsPanel entry={entry} className="h-full" />
            </div>
          </div>
        )}
        
        {/* Mobile Floating Bottom Navigation Bar */}
        <div className={cn(
          "fixed bottom-0 left-0 right-0 z-50 h-0 overflow-visible pointer-events-none",
          "pb-[env(safe-area-inset-bottom)]"
        )}>
          <div className="flex items-center justify-center gap-2 px-3 py-3 pointer-events-auto">
            <div className="glass-panel-nav flex items-center gap-1 px-1.5 py-1">
              {/* Previous */}
              <button
                onClick={onPreviousEntry}
                disabled={!hasPrevious}
                className={cn(btnClass, !hasPrevious && 'opacity-40 cursor-not-allowed')}
                aria-label="Previous article"
              >
                <ChevronUp size={18} />
              </button>
              
              {/* Next */}
              <button
                onClick={onNextEntry}
                disabled={!hasNext}
                className={cn(btnClass, !hasNext && 'opacity-40 cursor-not-allowed')}
                aria-label="Next article"
              >
                <ChevronDown size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // DESKTOP LAYOUT
  // =========================================================================
  return (
    <div className={cn('relative flex flex-col h-full', fullscreen && 'min-h-0')}>
      {/* Reader scroll progress bar */}
      <div className="absolute top-0 left-0 right-0 z-[40] h-0.5 pointer-events-none">
        <div 
          ref={progressRef}
          className="h-full bg-[var(--color-accent-fg)] transition-[width] duration-150"
          style={{ width: '0%' }}
        />
      </div>
      
      {/* Floating Glass Header */}
      <div className="absolute top-0 left-0 right-0 z-30 h-0 overflow-visible pointer-events-none">
        <div className="flex min-w-0 items-center gap-2 px-3 py-3 pointer-events-auto">
          {/* Navigation arrows */}
          <div className="glass-panel-nav flex flex-shrink-0 items-center gap-0.5 px-1.5 py-1 whitespace-nowrap">
            <button onClick={onPreviousEntry} disabled={!hasPrevious}
              className={cn(btnClass, !hasPrevious && 'text-[var(--color-text-disabled)] cursor-not-allowed')} title="Previous (K)">
              <ChevronUp size={18} />
            </button>
            <button onClick={onNextEntry} disabled={!hasNext}
              className={cn(btnClass, !hasNext && 'text-[var(--color-text-disabled)] cursor-not-allowed')} title="Next (J)">
              <ChevronDown size={18} />
            </button>
          </div>

          {/* Breadcrumb */}
          <div className="glass-panel-nav flex min-w-0 shrink items-center gap-1.5 overflow-hidden px-3 py-1.5 max-w-[min(100%,34rem)]">
            <span className="text-xs text-[var(--color-text-secondary)] truncate">{entry.feed?.title}</span>
            <span className="text-[var(--color-text-tertiary)]">›</span>
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{entry.title}</span>
          </div>

          {/* Actions */}
          <div className="ml-auto">
            <ArticleHeaderActions
              entry={entry}
              isUnread={isUnread}
              isReaderView={isReaderView}
              isLoadingReader={isLoadingReader}
              hasComments={hasComments}
              showComments={showComments}
              showTypography={showTypography}
              isTTSPlaying={isTTSPlaying}
              onListenToArticle={handleListenToArticle}
              onToggleReaderView={handleToggleReaderView}
              onToggleTypography={() => setShowTypography((value) => !value)}
              onToggleComments={() => { setShowComments(!showComments); setShowTypography(false); }}
              onToggleBookmark={() => onToggleBookmark(entry.id)}
              onToggleReadStatus={() => isUnread ? onMarkAsRead(entry.id) : onMarkAsUnread(entry.id)}
              onShare={handleShare}
              onClose={onClose}
            />
          </div>
        </div>
      </div>

      {showTypography && (
        <>
          <div
            className="absolute inset-0 z-[35]"
            onClick={() => setShowTypography(false)}
          />
          <TypographyPanel
            settings={articleTypography}
            onChange={setArticleTypography}
            onClose={() => setShowTypography(false)}
            isDarkMode={isDarkMode}
            topOffset="3.75rem"
            fontOptions={ARTICLE_FONT_OPTIONS}
            originalFormattingTitle="Use the article's default formatting"
            defaultSettings={DEFAULT_ARTICLE_TYPOGRAPHY}
            showMarginControls={false}
            showMaxWidthControl={true}
          />
        </>
      )}

      {/* Content Area - Split view when comments visible */}
      <div className={cn("flex-1 flex overflow-hidden", showComments && "gap-0")}>
        <article ref={scrollRef} className={cn("flex-1 overflow-y-auto min-w-0", showComments && "border-r border-[var(--color-border-subtle)]")}>
          <ArticleContent 
            entry={entry} 
            showCoverImage showFooter
            isReaderViewControlled={isReaderView}
            isLoadingReaderControlled={isLoadingReader}
            readerContentControlled={readerContent}
            onToggleReaderViewControlled={handleToggleReaderView}
          />
        </article>
        
        {showComments && hasComments && (
          <div className={cn(
            'w-[400px] flex-shrink-0 overflow-hidden',
            !einkMode && 'animate-slide-in-right'
          )}>
            <CommentsPanel entry={entry} className="h-full" />
          </div>
        )}
      </div>
    </div>
  );
}

export default ArticleReader;
