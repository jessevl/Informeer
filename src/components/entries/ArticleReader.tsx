/**
 * ArticleReader Component
 * Full article view with reading experience
 * Uses shared ArticleContent for the actual article rendering
 * Supports split-view with comments panel for HN and Reddit discussions
 * 
 * Mobile: Full-screen overlay with fixed header and back button
 */

import { useState, useCallback, useEffect } from 'react';
import { cn, stripHtml } from '@/lib/utils';
import { Star, Check, Circle, ExternalLink, X, Share2, ChevronUp, ChevronDown, FileText, Loader2, MessageSquare, PanelRightClose, ArrowLeft, MoreVertical } from 'lucide-react';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import ContextMenu, { type ContextMenuItem } from '@frameer/components/ui/ContextMenu';
import type { Entry } from '@/types/miniflux';
import { ArticleContent } from './ArticleContent';
import { CommentsPanel } from './CommentsPanel';
import { miniflux } from '@/api/miniflux';
import { useSettingsStore } from '@/stores/settings';
import { hasCommentsAvailable } from '@/api/comments';

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
}

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
}: ArticleReaderProps) {
  const isUnread = entry.status === 'unread';
  const autoReaderView = useSettingsStore((s) => s.autoReaderView);
  const isMobile = useIsMobile();
  
  // Reader view state
  const [isReaderView, setIsReaderView] = useState(false);
  const [readerContent, setReaderContent] = useState<string | null>(null);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  
  // Comments panel state - auto-open on desktop only (mobile requires manual open)
  const hasComments = hasCommentsAvailable(entry);
  const [showComments, setShowComments] = useState(!isMobile && hasComments);
  
  // Update showComments when entry changes (keep closed on mobile)
  useEffect(() => {
    setShowComments(!isMobile && hasCommentsAvailable(entry));
  }, [entry.id, isMobile]);
  
  // Reset reader view when entry changes
  const [prevEntryId, setPrevEntryId] = useState(entry.id);
  if (entry.id !== prevEntryId) {
    setPrevEntryId(entry.id);
    setIsReaderView(false);
    setReaderContent(null);
    setIsLoadingReader(false);
  }
  
  // Auto-fetch reader view if enabled OR if content is too short
  const [autoFetched, setAutoFetched] = useState<number | null>(null);
  const isContentTooShort = stripHtml(entry.content || '').trim().length < 100;
  
  if ((autoReaderView || isContentTooShort) && entry.id !== autoFetched && !readerContent && !isLoadingReader) {
    setAutoFetched(entry.id);
    setIsLoadingReader(true);
    miniflux.fetchOriginalContent(entry.id)
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
      const fullEntry = await miniflux.fetchOriginalContent(entry.id);
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

  // Common button class for header (shared between mobile and desktop)
  const btnClass = "flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 transition-colors";

  // =========================================================================
  // MOBILE LAYOUT
  // =========================================================================
  if (isMobile) {
    // Build context menu items for the "more" dropdown
    const mobileMenuItems: ContextMenuItem[] = [
      {
        id: 'reader-view',
        label: isReaderView ? 'Show feed content' : 'Reader view',
        icon: isLoadingReader ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />,
        onClick: handleToggleReaderView,
        disabled: isLoadingReader,
      },
      ...(hasComments ? [{
        id: 'comments',
        label: 'Discussion',
        icon: <MessageSquare size={16} />,
        onClick: () => setShowComments(!showComments),
      }] : []),
      {
        id: 'share',
        label: 'Share',
        icon: <Share2 size={16} />,
        onClick: handleShare,
      },
      {
        id: 'read-status',
        label: isUnread ? 'Mark as read' : 'Mark as unread',
        icon: isUnread ? <Check size={16} /> : <Circle size={16} />,
        onClick: () => isUnread ? onMarkAsRead(entry.id) : onMarkAsUnread(entry.id),
        divider: true,
      },
      {
        id: 'open-original',
        label: 'Open original',
        icon: <ExternalLink size={16} />,
        onClick: () => window.open(entry.url, '_blank'),
      },
    ];
    
    return (
      <div className="flex flex-col h-full bg-[var(--color-surface-primary)]">
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
        
        {/* Content - with padding for floating header and bottom bar */}
        <article className="flex-1 overflow-y-auto pt-12">
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
        
        {/* Mobile Comments Overlay */}
        {showComments && hasComments && (
          <div className={cn(
            "fixed inset-0 z-[60]",
            "bg-[var(--color-surface-primary)]",
            "animate-slide-in-right flex flex-col"
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
            
            {/* Comments Content */}
            <div className="flex-1 overflow-y-auto pt-12">
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
    <div className="relative flex flex-col h-full">
      {/* Floating Glass Header */}
      <div className="absolute top-0 left-0 right-0 z-30 h-0 overflow-visible pointer-events-none">
        <div className="flex items-center justify-between gap-2 px-3 py-3 pointer-events-auto">
          {/* Navigation arrows */}
          <div className="glass-panel-nav flex items-center gap-0.5 px-1.5 py-1">
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
          <div className="glass-panel-nav flex items-center gap-1.5 px-3 py-1.5 min-w-0 max-w-md">
            <span className="text-xs text-[var(--color-text-secondary)] truncate">{entry.feed?.title}</span>
            <span className="text-[var(--color-text-tertiary)]">›</span>
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{entry.title}</span>
          </div>

          {/* Actions */}
          <div className="glass-panel-nav flex items-center gap-0.5 px-1.5 py-1">
            <button onClick={handleToggleReaderView} disabled={isLoadingReader}
              className={cn(btnClass, isReaderView && 'text-[var(--color-accent-primary)] bg-[var(--color-accent-muted)]')}
              title={isReaderView ? 'Show feed content' : 'Reader view'}>
              {isLoadingReader ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
            </button>
            {hasComments && (
              <button onClick={() => setShowComments(!showComments)}
                className={cn(btnClass, showComments && 'text-[var(--color-accent-primary)] bg-[var(--color-accent-muted)]')}
                title={showComments ? 'Hide discussion' : 'Show discussion'}>
                {showComments ? <PanelRightClose size={18} /> : <MessageSquare size={18} />}
              </button>
            )}
            <button onClick={() => onToggleBookmark(entry.id)}
              className={cn(btnClass, entry.starred && 'text-amber-500 bg-amber-500/10')}
              title={entry.starred ? 'Remove from starred' : 'Add to starred'}>
              <Star size={18} className={entry.starred ? 'fill-current' : ''} />
            </button>
            <button onClick={() => isUnread ? onMarkAsRead(entry.id) : onMarkAsUnread(entry.id)}
              className={btnClass} title={isUnread ? 'Mark as read' : 'Mark as unread'}>
              {isUnread ? <Check size={18} /> : <Circle size={18} />}
            </button>
            <button onClick={handleShare} className={btnClass} title="Share"><Share2 size={18} /></button>
            <a href={entry.url} target="_blank" rel="noopener noreferrer" className={btnClass} title="Open original">
              <ExternalLink size={18} />
            </a>
            <button onClick={onClose} className={btnClass} title="Close (Escape)"><X size={18} /></button>
          </div>
        </div>
      </div>

      {/* Content Area - Split view when comments visible */}
      <div className={cn("flex-1 flex overflow-hidden", showComments && "gap-0")}>
        <article className={cn("flex-1 overflow-y-auto min-w-0", showComments && "border-r border-[var(--color-border-subtle)]")}>
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
          <div className="w-[400px] flex-shrink-0 overflow-hidden animate-slide-in-right">
            <CommentsPanel entry={entry} className="h-full" />
          </div>
        )}
      </div>
    </div>
  );
}

export default ArticleReader;
