/**
 * AppSidebar Component
 * Main navigation sidebar with feeds and categories
 * Uses Planneer-style glass-item tree styling
 * 
 * New Design:
 * - Home (all feeds)
 * - Audio filter (podcasts)
 * - Video filter (YouTube)
 * - Saved section (Links, Later, Bookmarks, Favorites)
 * - Categories with feeds
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  FolderOpen,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Search,
  Plus,
  Home,
  Headphones,
  Video,
  Star,
  MoreHorizontal,
  BookOpen,
  Library,
  Pin,
  PinOff,
  WifiOff,
} from 'lucide-react';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import { useMagazinesStore } from '@/stores/magazines';
import { useBooksStore } from '@/stores/books';
import { useSettingsStore } from '@/stores/settings';
import { useModulesStore } from '@/stores/modules';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useIsMobile, useIsTablet } from '@frameer/hooks/useMobileDetection';
import type { Feed, Category, FeedCounters } from '@/types/api';

const PINNED_FEEDS_STORAGE_KEY = 'informeer-pinned-feeds';
const RAIL_HOVER_SUPPRESS_MS = 450;

interface AppSidebarProps {
  feeds: Feed[];
  categories: Category[];
  counters: FeedCounters | null;
  collapsed?: boolean;
  sidebarPinned: boolean;
  onSidebarPinnedChange: (value: boolean) => void;
  overlayRequestToken?: number;
  onSelectView: (view: { 
    feedId?: number | null; 
    categoryId?: number | null; 
    starred?: boolean;
    status?: 'unread' | 'read' | 'all';
    mediaType?: 'all' | 'audio' | 'video' | 'magazines' | 'books';
  }) => void;
  onRefresh: () => void;
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
  onAddFeed?: (categoryId?: number, tab?: 'rss' | 'youtube' | 'reddit' | 'podcasts' | 'magazinelib' | 'zlib') => void;
  onManageFeeds?: () => void;
  onEditFeed?: (feed: Feed) => void;
  onToggleCollapse?: () => void;
  isRefreshing: boolean;
  currentView: {
    feedId: number | null;
    categoryId: number | null;
    starred: boolean;
    status: 'unread' | 'read' | 'all';
    mediaType?: 'all' | 'audio' | 'video' | 'magazines' | 'books';
  };
}

export function AppSidebar({
  feeds,
  categories,
  counters,
  collapsed = false,
  sidebarPinned,
  onSidebarPinnedChange,
  overlayRequestToken = 0,
  onSelectView,
  onRefresh,
  onOpenSettings,
  onOpenSearch,
  onAddFeed,
  onManageFeeds,
  onEditFeed,
  onToggleCollapse,
  isRefreshing,
  currentView,
}: AppSidebarProps) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isPhone = isMobile && !isTablet;
  const [pinnedFeedIds, setPinnedFeedIds] = useState<number[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(PINNED_FEEDS_STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [isRailOverlayOpen, setIsRailOverlayOpen] = useState(false);
  const [isRailHoverSuppressed, setIsRailHoverSuppressed] = useState(false);
  const overlayCloseTimeoutRef = useRef<number | null>(null);
  const railHoverSuppressTimeoutRef = useRef<number | null>(null);
  const prevFullscreenReaderOpenRef = useRef(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(
    new Set(categories.map(c => c.id))
  );

  const audioCategoryId = useSettingsStore(s => s.audioCategoryId);
  const videoCategoryId = useSettingsStore(s => s.videoCategoryId);
  const magazinesCategoryId = useSettingsStore(s => s.magazinesCategoryId);
  const offlineMode = useSettingsStore(s => s.offlineMode);
  const setOfflineMode = useSettingsStore(s => s.setOfflineMode);
  const booksEnabled = useModulesStore(s => s.modules.books);
  const isPdfViewerOpen = useMagazinesStore(s => s.isPdfViewerOpen);
  const isBookReaderOpen = useBooksStore(s => s.isReaderOpen);
  const isFullscreenReaderOpen = isPdfViewerOpen || isBookReaderOpen;

  // Hide categories assigned to media types (audio, video, magazines)
  const mediaCategoryIds = useMemo(() => {
    const ids = new Set<number>();
    if (audioCategoryId != null) ids.add(audioCategoryId);
    if (videoCategoryId != null) ids.add(videoCategoryId);
    if (magazinesCategoryId != null) ids.add(magazinesCategoryId);
    return ids;
  }, [audioCategoryId, videoCategoryId, magazinesCategoryId]);

  const feedsByCategory = categories
    .filter(cat => !mediaCategoryIds.has(cat.id))
    .map(cat => ({
      ...cat,
      feeds: feeds.filter(f => f.category?.id === cat.id),
    }));

  const totalUnread = counters 
    ? Object.values(counters.unreads).reduce((a, b) => a + b, 0)
    : 0;

  const pinnedFeeds = useMemo(
    () => pinnedFeedIds
      .map((id) => feeds.find((feed) => feed.id === id))
      .filter((feed): feed is Feed => !!feed)
      .slice(0, 10),
    [feeds, pinnedFeedIds]
  );

  useEffect(() => {
    localStorage.setItem(PINNED_FEEDS_STORAGE_KEY, JSON.stringify(pinnedFeedIds));
  }, [pinnedFeedIds]);

  useEffect(() => {
    return () => {
      if (overlayCloseTimeoutRef.current !== null) {
        window.clearTimeout(overlayCloseTimeoutRef.current);
      }
      if (railHoverSuppressTimeoutRef.current !== null) {
        window.clearTimeout(railHoverSuppressTimeoutRef.current);
      }
    };
  }, []);

  const clearOverlayCloseTimeout = useCallback(() => {
    if (overlayCloseTimeoutRef.current !== null) {
      window.clearTimeout(overlayCloseTimeoutRef.current);
      overlayCloseTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isFullscreenReaderOpen) {
      prevFullscreenReaderOpenRef.current = true;
      setIsRailHoverSuppressed(true);
      clearOverlayCloseTimeout();
      setIsRailOverlayOpen(false);
      if (railHoverSuppressTimeoutRef.current !== null) {
        window.clearTimeout(railHoverSuppressTimeoutRef.current);
        railHoverSuppressTimeoutRef.current = null;
      }
      return;
    }

    if (!prevFullscreenReaderOpenRef.current) {
      return;
    }

    prevFullscreenReaderOpenRef.current = false;
    setIsRailHoverSuppressed(true);
    if (railHoverSuppressTimeoutRef.current !== null) {
      window.clearTimeout(railHoverSuppressTimeoutRef.current);
    }
    railHoverSuppressTimeoutRef.current = window.setTimeout(() => {
      setIsRailHoverSuppressed(false);
      railHoverSuppressTimeoutRef.current = null;
    }, RAIL_HOVER_SUPPRESS_MS);
  }, [clearOverlayCloseTimeout, isFullscreenReaderOpen]);

  const openRailOverlay = useCallback(() => {
    if (sidebarPinned || isRailHoverSuppressed) return;
    clearOverlayCloseTimeout();
    setIsRailOverlayOpen(true);
  }, [clearOverlayCloseTimeout, isRailHoverSuppressed, sidebarPinned]);

  const closeRailOverlaySoon = useCallback(() => {
    if (sidebarPinned) return;
    clearOverlayCloseTimeout();
    overlayCloseTimeoutRef.current = window.setTimeout(() => {
      setIsRailOverlayOpen(false);
      overlayCloseTimeoutRef.current = null;
    }, 120);
  }, [clearOverlayCloseTimeout, sidebarPinned]);

  const closeRailOverlayNow = useCallback(() => {
    clearOverlayCloseTimeout();
    setIsRailOverlayOpen(false);
  }, [clearOverlayCloseTimeout]);

  useEffect(() => {
    if (!collapsed || sidebarPinned) {
      clearOverlayCloseTimeout();
      setIsRailOverlayOpen(false);
    }
  }, [clearOverlayCloseTimeout, collapsed, sidebarPinned]);

  useEffect(() => {
    if (!collapsed || sidebarPinned || overlayRequestToken === 0) return;
    openRailOverlay();
  }, [collapsed, openRailOverlay, overlayRequestToken, sidebarPinned]);

  const handleSidebarPinnedChange = useCallback((value: boolean) => {
    clearOverlayCloseTimeout();
    setIsRailOverlayOpen(false);
    onSidebarPinnedChange(value);
  }, [clearOverlayCloseTimeout, onSidebarPinnedChange]);

  const handleTogglePinnedFeed = useCallback((feedId: number) => {
    setPinnedFeedIds((prev) => prev.includes(feedId)
      ? prev.filter((id) => id !== feedId)
      : [...prev, feedId]
    );
  }, []);

  const toggleCategory = (categoryId: number) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const isViewActive = (check: { feedId?: number | null; categoryId?: number | null; starred?: boolean; mediaType?: string }) => {
    // Exact match - all properties must match for mutual exclusivity
    const currentMediaType = currentView.mediaType || 'all';
    const checkMediaType = check.mediaType || 'all';
    
    // For media-type filters (audio/video/magazines), the categoryId may be
    // set implicitly (e.g. Magazines sets categoryId to the "Magazines" category).
    // Only compare categoryId for non-media-type views.
    const isMediaFilter = checkMediaType !== 'all';
    const feedMatch = (check.feedId ?? null) === currentView.feedId;
    const categoryMatch = isMediaFilter || (check.categoryId ?? null) === currentView.categoryId;
    const starredMatch = (check.starred ?? false) === currentView.starred;
    const mediaTypeMatch = checkMediaType === currentMediaType;
    
    return feedMatch && categoryMatch && starredMatch && mediaTypeMatch;
  };

  if (collapsed && !isPhone) {
    return (
      <SidebarRail
        feedsByCategory={feedsByCategory}
        pinnedFeeds={pinnedFeeds}
        audioCategoryId={audioCategoryId}
        videoCategoryId={videoCategoryId}
        magazinesCategoryId={magazinesCategoryId}
        booksEnabled={booksEnabled}
        offlineMode={offlineMode}
        onSelectView={onSelectView}
        onOpenSettings={onOpenSettings}
        onOpenSearch={onOpenSearch}
        onAddFeed={onAddFeed}
        onManageFeeds={onManageFeeds}
        onEditFeed={onEditFeed}
        onToggleCollapse={onToggleCollapse}
        onOpenOverlay={openRailOverlay}
        onCloseOverlaySoon={closeRailOverlaySoon}
        onCancelOverlayClose={clearOverlayCloseTimeout}
        onCloseOverlayNow={closeRailOverlayNow}
        overlayOpen={isRailOverlayOpen}
        sidebarPinned={sidebarPinned}
        onSidebarPinnedChange={handleSidebarPinnedChange}
        onTogglePinnedFeed={handleTogglePinnedFeed}
        currentView={currentView}
        counters={counters}
        expandedCategories={expandedCategories}
        onToggleCategory={toggleCategory}
        setOfflineMode={setOfflineMode}
        totalUnread={totalUnread}
      />
    );
  }

  return (
    <ExpandedSidebarContent
      feedsByCategory={feedsByCategory}
      counters={counters}
      expandedCategories={expandedCategories}
      onToggleCategory={toggleCategory}
      onSelectView={onSelectView}
      onRefresh={onRefresh}
      onOpenSettings={onOpenSettings}
      onOpenSearch={onOpenSearch}
      onAddFeed={onAddFeed}
      onManageFeeds={onManageFeeds}
      onEditFeed={onEditFeed}
      onToggleCollapse={onToggleCollapse}
      isRefreshing={isRefreshing}
      currentView={currentView}
      offlineMode={offlineMode}
      setOfflineMode={setOfflineMode}
      magazinesCategoryId={magazinesCategoryId}
      audioCategoryId={audioCategoryId}
      videoCategoryId={videoCategoryId}
      booksEnabled={booksEnabled}
      totalUnread={totalUnread}
      sidebarPinned={sidebarPinned}
      onSidebarPinnedChange={handleSidebarPinnedChange}
      onTogglePinnedFeed={handleTogglePinnedFeed}
      pinnedFeedIds={pinnedFeedIds}
      showPanelControls={!isPhone}
    />
  );
}

function ExpandedSidebarContent({
  feedsByCategory,
  counters,
  expandedCategories,
  onToggleCategory,
  onSelectView,
  onRefresh,
  onOpenSettings,
  onOpenSearch,
  onAddFeed,
  onManageFeeds,
  onEditFeed,
  onToggleCollapse,
  isRefreshing,
  currentView,
  offlineMode,
  setOfflineMode,
  magazinesCategoryId,
  audioCategoryId,
  videoCategoryId,
  booksEnabled,
  totalUnread,
  sidebarPinned,
  onSidebarPinnedChange,
  onTogglePinnedFeed,
  pinnedFeedIds,
  onCloseTemporaryPanel,
  showPanelControls = true,
}: {
  feedsByCategory: Array<Category & { feeds: Feed[] }>;
  counters: FeedCounters | null;
  expandedCategories: Set<number>;
  onToggleCategory: (categoryId: number) => void;
  onSelectView: AppSidebarProps['onSelectView'];
  onRefresh: () => void;
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
  onAddFeed?: AppSidebarProps['onAddFeed'];
  onManageFeeds?: () => void;
  onEditFeed?: (feed: Feed) => void;
  onToggleCollapse?: () => void;
  isRefreshing: boolean;
  currentView: AppSidebarProps['currentView'];
  offlineMode: boolean;
  setOfflineMode: (enabled: boolean) => void;
  magazinesCategoryId: number | null;
  audioCategoryId: number | null;
  videoCategoryId: number | null;
  booksEnabled: boolean;
  totalUnread: number;
  sidebarPinned: boolean;
  onSidebarPinnedChange: (value: boolean) => void;
  onTogglePinnedFeed: (feedId: number) => void;
  pinnedFeedIds: number[];
  onCloseTemporaryPanel?: () => void;
  showPanelControls?: boolean;
}) {
  const isViewActive = (check: { feedId?: number | null; categoryId?: number | null; starred?: boolean; mediaType?: string }) => {
    const currentMediaType = currentView.mediaType || 'all';
    const checkMediaType = check.mediaType || 'all';
    const isMediaFilter = checkMediaType !== 'all';
    const feedMatch = (check.feedId ?? null) === currentView.feedId;
    const categoryMatch = isMediaFilter || (check.categoryId ?? null) === currentView.categoryId;
    const starredMatch = (check.starred ?? false) === currentView.starred;
    const mediaTypeMatch = checkMediaType === currentMediaType;
    return feedMatch && categoryMatch && starredMatch && mediaTypeMatch;
  };

  return (
    <div className="flex flex-col h-full">
      {showPanelControls && (
        <div className="px-1 pb-2 pt-1 flex-shrink-0">
          <div className="eink-shell-surface flex items-center justify-between rounded-2xl border border-[var(--color-border-default)]/70 bg-[var(--color-surface-base)]/72 px-2 py-1.5 shadow-[0_16px_36px_-28px_rgba(15,23,42,0.42)] backdrop-blur-sm">
            {onToggleCollapse ? (
              <button
                type="button"
                onClick={onCloseTemporaryPanel ?? onToggleCollapse}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text-primary)]"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4.5 w-4.5" />
              </button>
            ) : <div className="h-9 w-9" />}
            <button
              type="button"
              onClick={() => onSidebarPinnedChange(!sidebarPinned)}
              className={cn(
                'flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-[background-color,border-color,color,box-shadow]',
                sidebarPinned
                  ? 'border-[var(--color-border-emphasis)] bg-[color-mix(in_srgb,var(--color-accent-muted)_78%,transparent)] text-[var(--color-text-primary)] shadow-[0_14px_32px_-26px_rgba(15,23,42,0.45)]'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border-default)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text-primary)]'
              )}
              aria-label={sidebarPinned ? 'Disable hover overlay' : 'Enable hover overlay'}
              title={sidebarPinned ? 'Pinned layout' : 'Overlay mode'}
            >
              {sidebarPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
              <span>{sidebarPinned ? 'Pinned layout' : 'Overlay mode'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Search Button — Planneer-style input bar */}
      {onOpenSearch && (
        <div className="px-1.5 pt-1 pb-1.5">
          <button
            onClick={onOpenSearch}
            className="eink-shell-surface w-full flex items-center gap-3 px-3 py-1.5 rounded-xl border border-[var(--color-border-default)]/80 bg-[color-mix(in_srgb,var(--color-surface-primary)_78%,transparent)] text-sm text-[var(--color-text-tertiary)] shadow-[0_14px_30px_-28px_rgba(15,23,42,0.35)] backdrop-blur-sm hover:border-[var(--color-border-emphasis)] hover:bg-[color-mix(in_srgb,var(--color-surface-secondary)_82%,transparent)] transition-all"
          >
            <Search size={16} className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-left">Search...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--color-surface-tertiary)] rounded text-[10px] font-medium text-[var(--color-text-disabled)]">
              ⌘K
            </kbd>
          </button>
        </div>
      )}

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {/* Main views — Home + media filters + starred */}
        <div className="mb-4 space-y-0.5">
          {!offlineMode && (
          <TreeItem
            icon={<Home size={18} />}
            label="Home"
            subtitle="All feeds"
            count={totalUnread > 0 ? totalUnread : undefined}
            isActive={isViewActive({ feedId: null, categoryId: null, starred: false, mediaType: 'all' })}
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'all' })}
          />
          )}
          {audioCategoryId != null && (
                <TreeItem
                  icon={<Headphones size={18} />}
                  label="Audio"
                  isActive={isViewActive({ mediaType: 'audio' })}
                  onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'audio' })}
                  rightAction={onAddFeed ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddFeed?.(undefined, 'podcasts'); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-all"
                      title="Add podcast"
                    >
                      <Plus size={12} />
                    </button>
                  ) : undefined}
                />
          )}
          {!offlineMode && videoCategoryId != null && (
                <TreeItem
                  icon={<Video size={18} />}
                  label="Video"
                  isActive={isViewActive({ mediaType: 'video' })}
                  onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'video' })}
                  rightAction={onAddFeed ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddFeed?.(undefined, 'youtube'); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-all"
                      title="Add YouTube channel"
                    >
                      <Plus size={12} />
                    </button>
                  ) : undefined}
                />
          )}
          {magazinesCategoryId != null && (
                <TreeItem
                  icon={<BookOpen size={18} />}
                  label="Magazines"
                  isActive={isViewActive({ mediaType: 'magazines' })}
                  onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'magazines' })}
                  rightAction={onAddFeed ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddFeed?.(undefined, 'magazinelib'); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-all"
                      title="Add magazine"
                    >
                      <Plus size={12} />
                    </button>
                  ) : undefined}
                />
          )}
          {booksEnabled && (
                <TreeItem
                  icon={<Library size={18} />}
                  label="Books"
                  isActive={isViewActive({ mediaType: 'books' })}
                  onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'books' })}
                  rightAction={onAddFeed ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddFeed?.(undefined, 'zlib'); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-all"
                      title="Search books"
                    >
                      <Plus size={12} />
                    </button>
                  ) : undefined}
                />
          )}
          {!offlineMode && (
          <TreeItem
            icon={<Star size={18} />}
            label="Starred"
            isActive={isViewActive({ starred: true })}
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: true, status: 'all', mediaType: 'all' })}
          />
          )}
        </div>

        {/* Categories & Feeds */}
        {!offlineMode && feedsByCategory.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between px-3 mb-2">
              <span className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-[0.14em]">
                Feeds
              </span>
              <div className="flex items-center gap-0.5">
                {onManageFeeds && (
                  <button
                    onClick={onManageFeeds}
                    className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                    title="Manage feeds"
                  >
                    <Settings size={14} />
                  </button>
                )}
                {onAddFeed && (
                  <button
                    onClick={() => onAddFeed?.()}
                    className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                    title="Add feed"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-0.5">
              {feedsByCategory.map(cat => (
                <CategorySection
                  key={cat.id}
                  category={cat}
                  feeds={cat.feeds}
                  counters={counters}
                  expanded={expandedCategories.has(cat.id)}
                  onToggle={() => onToggleCategory(cat.id)}
                  onSelectCategory={() => onSelectView({ feedId: null, categoryId: cat.id, starred: false, status: 'all', mediaType: 'all' })}
                  onSelectFeed={(feedId) => onSelectView({ feedId, categoryId: null, starred: false, status: 'all', mediaType: 'all' })}
                  onEditFeed={onEditFeed}
                  onAddFeed={(categoryId) => {
                    onAddFeed?.(categoryId, 'rss');
                  }}
                  pinnedFeedIds={pinnedFeedIds}
                  onTogglePinnedFeed={onTogglePinnedFeed}
                  currentFeedId={currentView.feedId}
                  currentCategoryId={currentView.categoryId}
                  currentMediaType={currentView.mediaType || 'all'}
                />
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Footer — Offline toggle + Theme switcher */}
      <SidebarFooter
        offlineMode={offlineMode}
        onOpenSettings={onOpenSettings}
        onToggleOffline={() => {
          const newValue = !offlineMode;
          setOfflineMode(newValue);
          // If turning ON and current view isn't offline-capable, navigate to first offline view
          if (newValue) {
            const mt = currentView.mediaType || 'all';
            const isOfflineView = mt === 'audio' || mt === 'magazines' || mt === 'books';
            if (!isOfflineView) {
              // Pick magazines → audio → books, whichever is available
              if (magazinesCategoryId != null) {
                onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'magazines' });
              } else if (audioCategoryId != null) {
                onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'audio' });
              } else if (booksEnabled) {
                onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'books' });
              }
            }
          }
        }}
      />
    </div>
  );
}

function SidebarRail({
  feedsByCategory,
  pinnedFeeds,
  audioCategoryId,
  videoCategoryId,
  magazinesCategoryId,
  booksEnabled,
  offlineMode,
  onSelectView,
  onOpenSettings,
  onOpenSearch,
  onAddFeed,
  onManageFeeds,
  onEditFeed,
  onToggleCollapse,
  onOpenOverlay,
  onCloseOverlaySoon,
  onCancelOverlayClose,
  onCloseOverlayNow,
  overlayOpen,
  sidebarPinned,
  onSidebarPinnedChange,
  onTogglePinnedFeed,
  currentView,
  counters,
  expandedCategories,
  onToggleCategory,
  setOfflineMode,
  totalUnread,
}: {
  feedsByCategory: Array<Category & { feeds: Feed[] }>;
  pinnedFeeds: Feed[];
  audioCategoryId: number | null;
  videoCategoryId: number | null;
  magazinesCategoryId: number | null;
  booksEnabled: boolean;
  offlineMode: boolean;
  onSelectView: (view: {
    feedId?: number | null;
    categoryId?: number | null;
    starred?: boolean;
    status?: 'unread' | 'read' | 'all';
    mediaType?: 'all' | 'audio' | 'video' | 'magazines' | 'books';
  }) => void;
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
  onAddFeed?: (categoryId?: number, tab?: 'rss' | 'youtube' | 'reddit' | 'podcasts' | 'magazinelib' | 'zlib') => void;
  onManageFeeds?: () => void;
  onEditFeed?: (feed: Feed) => void;
  onToggleCollapse?: () => void;
  onOpenOverlay: () => void;
  onCloseOverlaySoon: () => void;
  onCancelOverlayClose: () => void;
  onCloseOverlayNow: () => void;
  overlayOpen: boolean;
  sidebarPinned: boolean;
  onSidebarPinnedChange: (value: boolean) => void;
  onTogglePinnedFeed: (feedId: number) => void;
  currentView: {
    feedId: number | null;
    categoryId: number | null;
    starred: boolean;
    status: 'unread' | 'read' | 'all';
    mediaType?: 'all' | 'audio' | 'video' | 'magazines' | 'books';
  };
  counters: FeedCounters | null;
  expandedCategories: Set<number>;
  onToggleCategory: (categoryId: number) => void;
  setOfflineMode: (enabled: boolean) => void;
  totalUnread: number;
}) {
  const currentMediaType = currentView.mediaType || 'all';
  const railHostRef = useRef<HTMLDivElement | null>(null);
  const [overlayFrame, setOverlayFrame] = useState<{ top: number; left: number; height: number } | null>(null);
  const [overlayMounted, setOverlayMounted] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);


  useEffect(() => {
    if (!overlayOpen || sidebarPinned) {
      setOverlayFrame(null);
      return;
    }

    const updateFrame = () => {
      const rect = railHostRef.current?.getBoundingClientRect();
      if (!rect) return;
      setOverlayFrame({
        top: rect.top,
        left: rect.left,
        height: rect.height,
      });
    };

    updateFrame();
    window.addEventListener('resize', updateFrame);
    window.addEventListener('scroll', updateFrame, true);

    return () => {
      window.removeEventListener('resize', updateFrame);
      window.removeEventListener('scroll', updateFrame, true);
    };
  }, [overlayOpen, sidebarPinned]);

  useEffect(() => {
    if (overlayOpen && overlayFrame) {
      setOverlayMounted(true);
      const rafId = window.requestAnimationFrame(() => setOverlayVisible(true));
      return () => window.cancelAnimationFrame(rafId);
    }

    setOverlayVisible(false);
    if (!overlayMounted) return;

    // Keep overlay in DOM long enough for both the overlay fade-out (300ms)
    // and the rail cross-fade-in (200ms) to complete.
    const timeoutId = window.setTimeout(() => setOverlayMounted(false), 350);
    return () => window.clearTimeout(timeoutId);
  }, [overlayFrame, overlayMounted, overlayOpen]);

  // Cross-fade: rail starts fading in as soon as overlay starts fading out.
  // Both animate simultaneously for a seamless transition.
  const hideRail = overlayVisible;

  return (
    <div ref={railHostRef} className="relative h-full w-full" onMouseLeave={onCloseOverlaySoon}>
    <aside className={cn(
      'relative z-10 flex h-full w-full flex-col select-none overflow-visible bg-transparent px-2 py-2',
      'transition-opacity duration-200',
      hideRail ? 'opacity-0' : 'opacity-100'
    )}>
      <div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden">
        {onToggleCollapse && (
          <RailButton
            icon={<PanelLeftOpen size={18} />}
            label="Expand sidebar"
            onClick={onToggleCollapse}
            onMouseEnter={onOpenOverlay}
          />
        )}

        {onOpenSearch && (
          <RailButton
            icon={<Search size={18} />}
            label="Search"
            onClick={onOpenSearch}
          />
        )}

        {!offlineMode && onAddFeed && (
          <RailButton
            icon={<Plus size={18} />}
            label="Add feed"
            onClick={() => onAddFeed(undefined, 'rss')}
          />
        )}

        <div className="my-1.5 h-px w-8 bg-[var(--color-border-default)]/70" />

        {!offlineMode && (
          <RailButton
            icon={<Home size={18} />}
            label="Home"
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'all' })}
            isActive={currentMediaType === 'all' && !currentView.feedId && !currentView.categoryId && !currentView.starred}
            badge={totalUnread > 0 ? totalUnread : undefined}
          />
        )}

        {audioCategoryId != null && (
          <RailButton
            icon={<Headphones size={18} />}
            label="Audio"
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'audio' })}
            isActive={currentMediaType === 'audio'}
          />
        )}

        {!offlineMode && videoCategoryId != null && (
          <RailButton
            icon={<Video size={18} />}
            label="Video"
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'video' })}
            isActive={currentMediaType === 'video'}
          />
        )}

        {magazinesCategoryId != null && (
          <RailButton
            icon={<BookOpen size={18} />}
            label="Magazines"
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'magazines' })}
            isActive={currentMediaType === 'magazines'}
          />
        )}

        {booksEnabled && (
          <RailButton
            icon={<Library size={18} />}
            label="Books"
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'books' })}
            isActive={currentMediaType === 'books'}
          />
        )}

        {!offlineMode && (
          <RailButton
            icon={<Star size={18} />}
            label="Starred"
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: true, status: 'all', mediaType: 'all' })}
            isActive={currentView.starred}
          />
        )}

        {pinnedFeeds.length > 0 && (
          <>
            <div className="my-1.5 h-px w-8 bg-[var(--color-border-default)]/70" />
            <div className="flex min-h-0 w-full flex-col items-center gap-1.5 overflow-visible pb-1">
              {pinnedFeeds.map((feed) => (
                <RailButton
                  key={feed.id}
                  icon={<FeedIcon feedId={feed.id} iconId={feed.icon?.icon_id} size={18} />}
                  label={feed.title}
                  onClick={() => onSelectView({ feedId: feed.id, categoryId: null, starred: false, status: 'all', mediaType: 'all' })}
                  isActive={currentView.feedId === feed.id}
                  badge={(counters?.unreads[feed.id] || 0) > 0 ? counters?.unreads[feed.id] : undefined}
                />
              ))}
            </div>
          </>
        )}

        <div className="mt-auto flex flex-col items-center gap-1.5 pt-1.5">
          {onOpenSettings && (
            <RailButton
              icon={<Settings size={18} />}
              label="Settings"
              onClick={onOpenSettings}
            />
          )}
        </div>
      </div>
    </aside>
    {!sidebarPinned && overlayMounted && overlayFrame && typeof document !== 'undefined' && createPortal(
      <div
        className="fixed z-[120] w-[296px] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          top: overlayFrame.top,
          left: overlayFrame.left,
          height: overlayFrame.height,
          opacity: overlayVisible ? 1 : 0,
          transform: overlayVisible ? 'translateX(0)' : 'translateX(-10px)',
        }}
        onMouseEnter={onCancelOverlayClose}
        onMouseLeave={onCloseOverlaySoon}
      >
        <div className="eink-shell-surface h-full overflow-hidden rounded-[26px] border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-base)_88%,transparent)] shadow-[0_20px_70px_-34px_rgba(15,23,42,0.42)] backdrop-blur-xl">
          <ExpandedSidebarContent
            feedsByCategory={feedsByCategory}
            counters={counters}
            expandedCategories={expandedCategories}
            onToggleCategory={onToggleCategory}
            onSelectView={onSelectView}
            onRefresh={() => {}}
            onOpenSettings={onOpenSettings}
            onOpenSearch={onOpenSearch}
            onAddFeed={onAddFeed}
            onManageFeeds={onManageFeeds}
            onEditFeed={onEditFeed}
            onToggleCollapse={onToggleCollapse}
            isRefreshing={false}
            currentView={currentView}
            offlineMode={offlineMode}
            setOfflineMode={setOfflineMode}
            magazinesCategoryId={magazinesCategoryId}
            audioCategoryId={audioCategoryId}
            videoCategoryId={videoCategoryId}
            booksEnabled={booksEnabled}
            totalUnread={totalUnread}
            sidebarPinned={sidebarPinned}
            onSidebarPinnedChange={onSidebarPinnedChange}
            onTogglePinnedFeed={onTogglePinnedFeed}
            pinnedFeedIds={pinnedFeeds.map((feed) => feed.id)}
            onCloseTemporaryPanel={onCloseOverlayNow}
          />
        </div>
      </div>,
      document.body
    )}
    </div>
  );
}

function RailButton({
  icon,
  label,
  onClick,
  isActive = false,
  badge,
  onMouseEnter,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  badge?: number | string;
  onMouseEnter?: () => void;
}) {
  const einkMode = useSettingsStore(s => s.einkMode);

  return (
    <div className="group relative flex justify-center">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        title={label}
        aria-label={label}
        className={cn(
            'relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-fg)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
          einkMode ? 'active:scale-100 hover:translate-y-0' : 'active:scale-[0.97] hover:-translate-y-0.5',
          isActive
            ? 'glass-item text-[var(--color-text-primary)]'
            : 'glass-item-subtle text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
        )}
      >
        <span className={cn(
          'flex items-center justify-center transition-transform duration-200',
          !einkMode && 'group-hover:scale-105',
        )}>{icon}</span>
        {badge !== undefined ? (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[var(--color-accent-fg)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm">
            {badge}
          </span>
        ) : null}
      </button>
      <div className="pointer-events-none absolute left-[calc(100%+0.85rem)] top-1/2 z-30 -translate-y-1/2 translate-x-[-6px] opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
        <div className="eink-shell-surface whitespace-nowrap rounded-xl border border-[var(--color-border-default)]/80 bg-[color-mix(in_srgb,var(--color-surface-base)_94%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] shadow-[0_14px_34px_-24px_rgba(15,23,42,0.42)] backdrop-blur-md">
          {label}
        </div>
      </div>
    </div>
  );
}

/**
 * SidebarFooter — Settings + offline mode controls
 */
function SidebarFooter({
  offlineMode,
  onToggleOffline,
  onOpenSettings,
}: {
  offlineMode: boolean;
  onToggleOffline: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="border-t border-[var(--color-border-subtle)] px-3 py-3">
      <div className="flex items-center gap-2">
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="eink-shell-surface flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-default)]/80 bg-[color-mix(in_srgb,var(--color-surface-primary)_78%,transparent)] text-[var(--color-text-secondary)] shadow-[0_14px_30px_-28px_rgba(15,23,42,0.35)] backdrop-blur-sm transition-all hover:border-[var(--color-border-emphasis)] hover:bg-[color-mix(in_srgb,var(--color-surface-secondary)_82%,transparent)] hover:text-[var(--color-text-primary)]"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={16} />
          </button>
        )}
        <div
          className="eink-shell-surface flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-[var(--color-border-default)]/80 bg-[color-mix(in_srgb,var(--color-surface-primary)_78%,transparent)] px-3 py-2 text-sm text-[var(--color-text-primary)] shadow-[0_14px_30px_-28px_rgba(15,23,42,0.35)] backdrop-blur-sm transition-all hover:border-[var(--color-border-emphasis)] hover:bg-[color-mix(in_srgb,var(--color-surface-secondary)_82%,transparent)]"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border',
              offlineMode
                ? 'border-[var(--color-border-emphasis)] bg-[var(--color-surface-inverse)] text-[var(--color-text-inverse)]'
                : 'border-[var(--color-border-default)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]'
            )}>
              <WifiOff size={14} />
            </span>
            <button
              type="button"
              onClick={onToggleOffline}
              className="min-w-0 flex-1 truncate text-left font-medium"
              title="Toggle offline mode"
            >
              Offline mode
            </button>
          </div>
          <ToggleSwitch size="sm" enabled={offlineMode} onChange={onToggleOffline} />
        </div>
      </div>
    </div>
  );
}

function getExpandedSidebarItemClass(isActive: boolean, einkMode: boolean) {
  if (einkMode) {
    return cn(
      'eink-expanded-sidebar-item border border-transparent bg-transparent shadow-none',
      isActive
        ? 'eink-expanded-sidebar-item-active text-[var(--color-text-primary)]'
        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
    );
  }

  return isActive
    ? 'glass-item text-[var(--color-text-primary)]'
    : 'glass-item-subtle text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]';
}

/**
 * TreeItem - Planneer-style tree item with glass selection effect
 * Matches the styling from TreeSidebarItem.tsx in Planneer
 */
function TreeItem({
  icon,
  label,
  subtitle,
  isActive = false,
  onClick,
  count,
  countHighlight = false,
  level = 0,
  hasChildren = false,
  isExpanded = false,
  onToggle,
  disabled = false,
  rightAction,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  isActive?: boolean;
  onClick?: () => void;
  count?: number | string;
  countHighlight?: boolean;
  level?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  rightAction?: React.ReactNode;
}) {
  const einkMode = useSettingsStore(s => s.einkMode);
  const paddingLeft = 12 + (level * 16);
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ paddingLeft: `${paddingLeft}px` }}
      className={cn(
        // Base styles - matching Planneer TreeSidebarItem
        'group w-full flex items-center gap-2 pr-2 py-1.5 rounded-lg font-medium transition-all cursor-pointer outline-none text-sm',
        
        // Focus ring
        'focus-visible:ring-2 focus-visible:ring-[var(--color-interactive-ring)] focus-visible:ring-offset-1',
        getExpandedSidebarItemClass(isActive, einkMode),
        
        // Disabled
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {/* Expand/Collapse for items with children */}
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className="w-4 h-4 flex items-center justify-center hover:bg-[var(--color-surface-inset)] rounded transition-colors flex-shrink-0 -ml-1"
        >
          <ChevronRight
            size={14}
            className={cn(
              'transition-transform duration-300 transition-spring text-[var(--color-text-tertiary)]',
              isExpanded && 'rotate-90'
            )}
          />
        </button>
      )}
      
      {/* Icon */}
      <span className="flex-shrink-0 text-[var(--color-text-tertiary)]">{icon}</span>
      
      {/* Label with optional subtitle */}
      <div className="flex-1 truncate text-left">
        <span>{label}</span>
        {subtitle && (
          <span className="block text-xs text-[var(--color-text-tertiary)] font-normal">{subtitle}</span>
        )}
      </div>
      
      {/* Count badge */}
      {count !== undefined && (
        <span className={cn(
          'text-xs tabular-nums flex-shrink-0',
          countHighlight 
            ? 'px-1.5 py-0.5 rounded-full bg-[var(--color-accent-fg)] text-white font-medium'
            : 'text-[var(--color-text-tertiary)]'
        )}>
          {count}
        </span>
      )}

      {/* Right action (e.g. add button) */}
      {rightAction}
    </button>
  );
}

// Category Section with expandable feeds - Planneer-style
function CategorySection({
  category,
  feeds,
  counters,
  expanded,
  onToggle,
  onSelectCategory,
  onSelectFeed,
  onEditFeed,
  onAddFeed,
  pinnedFeedIds,
  onTogglePinnedFeed,
  currentFeedId,
  currentCategoryId,
  currentMediaType,
}: {
  category: Category;
  feeds: Feed[];
  counters: FeedCounters | null;
  expanded: boolean;
  onToggle: () => void;
  onSelectCategory: () => void;
  onSelectFeed: (feedId: number) => void;
  onEditFeed?: (feed: Feed) => void;
  onAddFeed?: (categoryId: number) => void;
  pinnedFeedIds: number[];
  onTogglePinnedFeed: (feedId: number) => void;
  currentFeedId: number | null;
  currentCategoryId: number | null;
  currentMediaType?: string;
}) {
  const einkMode = useSettingsStore(s => s.einkMode);
  const unreadCount = counters
    ? feeds.reduce((sum, f) => sum + (counters.unreads[f.id] || 0), 0)
    : 0;

  // Don't highlight this category when a media-type filter (audio/video/magazines)
  // is active — even if its categoryId happens to match (magazines sets it implicitly).
  const isMediaFilter = currentMediaType && currentMediaType !== 'all';
  const isCategoryActive = !isMediaFilter && currentCategoryId === category.id && currentFeedId === null;

  return (
    <div>
      {/* Category Header - Click to select, toggle on right */}
      <div
        className={cn(
          'group w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer',
          getExpandedSidebarItemClass(isCategoryActive, einkMode)
        )}
      >
        {/* Icon */}
        <FolderOpen size={16} className="flex-shrink-0 text-[var(--color-text-tertiary)]" />
        
        {/* Label - Click to select category */}
        <button
          onClick={onSelectCategory}
          className="flex-1 truncate text-left"
        >
          {category.title}
        </button>
        
        {/* Unread count */}
        {unreadCount > 0 && (
          <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums">{unreadCount}</span>
        )}
        
        {/* Hover actions */}
        {!category.is_system && onAddFeed && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onAddFeed(category.id); }}
              className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
              title="Add feed"
            >
              <Plus size={12} className="text-[var(--color-text-secondary)]" />
            </button>
          </div>
        )}
        
        {/* Expand/collapse toggle - far right */}
        {feeds.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors flex-shrink-0"
          >
            <ChevronDown 
              size={14} 
              className={cn(
                'text-[var(--color-text-tertiary)] transition-transform duration-300 transition-spring',
                !expanded && '-rotate-90'
              )} 
            />
          </button>
        )}
      </div>
      
      {/* Feeds List - Nested tree items */}
      {expanded && feeds.length > 0 && (
        <div className="space-y-0.5 mt-0.5">
          {feeds.map(feed => {
            const feedUnread = counters?.unreads[feed.id] || 0;
            const isActive = currentFeedId === feed.id;
            const isPinned = pinnedFeedIds.includes(feed.id);
            
            return (
              <div
                key={feed.id}
                onClick={() => onSelectFeed(feed.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onEditFeed?.(feed);
                }}
                style={{ paddingLeft: '28px' }}
                className={cn(
                  'group w-full flex items-center gap-2 pr-2 py-1.5 rounded-lg text-left text-sm font-medium transition-all cursor-pointer',
                  getExpandedSidebarItemClass(isActive, einkMode),
                  !isActive && 'text-[var(--color-text-tertiary)]'
                )}
              >
                <FeedIcon 
                  feedId={feed.id} 
                  iconId={feed.icon?.icon_id} 
                  size={14} 
                />
                <span className="truncate flex-1">{feed.title}</span>
                {feedUnread > 0 && (
                  <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums">
                    {feedUnread}
                  </span>
                )}
                
                {/* Hover actions for feed */}
                <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePinnedFeed(feed.id);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
                    title={isPinned ? 'Unpin from rail' : 'Pin to rail'}
                  >
                    {isPinned ? (
                      <Pin size={12} className="text-[var(--color-text-secondary)]" />
                    ) : (
                      <PinOff size={12} className="text-[var(--color-text-secondary)]" />
                    )}
                  </button>
                  <button
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      onEditFeed?.(feed); 
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
                    title="Feed options"
                  >
                    <MoreHorizontal size={12} className="text-[var(--color-text-secondary)]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AppSidebar;
