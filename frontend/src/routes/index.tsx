import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useFeedsStore } from '@/stores/feeds';
import { useEntriesStore } from '@/stores/entries';
import { useSettingsStore } from '@/stores/settings';
import { useAudioStore } from '@/stores/audio';
import { useVideoStore } from '@/stores/video';
import { api } from '@/api/client';
import { AppLayout, type NavTab } from '@/components/layout/AppLayout';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { EntryList } from '@/components/entries/EntryList';
import { ArticleReader } from '@/components/entries/ArticleReader';
import { PodcastsView } from '@/components/podcasts/PodcastsView';
import { VideosView } from '@/components/videos/VideosView';
import { SearchModal } from '@/components/layout/SearchModal';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { AddFeedModal } from '@/components/feeds/AddFeedModal';
import { EditFeedModal } from '@/components/feeds/EditFeedModal';
import { FeedManagementModal } from '@/components/feeds/FeedManagementModal';
import { MagazinesView } from '@/components/magazines/MagazinesView';
import { BooksView, BookHeaderActions } from '@/components/books/BooksView';
import { Plus } from 'lucide-react';
import { useMagazinesStore } from '@/stores/magazines';
import { useBooksStore } from '@/stores/books';
import { useModulesStore } from '@/stores/modules';
import { AudioPlayer } from '@/components/player/AudioPlayer';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { TTSMiniPlayer } from '@/components/tts/TTSMiniPlayer';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useIsLandscapeViewport } from '@/hooks/useIsLandscapeViewport';
import type { Entry, Feed } from '@/types/api';

const SIDEBAR_PIN_MODE_STORAGE_KEY = 'informeer-sidebar-pin-mode';

function HomePage() {
  const { feeds, categories, counters, fetchFeeds, fetchCategories, fetchCounters, refreshAllFeeds } = useFeedsStore();
  const { 
    entries, 
    selectedEntry, 
    isLoading, 
    isRefetching,
    status,
    feedId,
    categoryId,
    starred,
    mediaType,
    fetchEntries, 
    fetchMoreEntries,
    hasMore,
    isLoadingMore,
    setFilter,
    selectEntry,
    markAsRead,
    markAsUnread,
    toggleBookmark,
    getFilteredEntries,
  } = useEntriesStore();

  const [sidebarPinned, setSidebarPinned] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_PIN_MODE_STORAGE_KEY) === 'true';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(SIDEBAR_PIN_MODE_STORAGE_KEY) !== 'true';
  });
  const [sidebarOverlayRequestToken, setSidebarOverlayRequestToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [addFeedInitialTab, setAddFeedInitialTab] = useState<'rss' | 'youtube' | 'reddit' | 'podcasts' | 'magazinelib' | 'zlib'>('rss');
  const [addFeedInitialCategory, setAddFeedInitialCategory] = useState<number | undefined>(undefined);
  const [editFeedOpen, setEditFeedOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<Feed | null>(null);
  const [feedManagementOpen, setFeedManagementOpen] = useState(false);
  
  // Track selected channel for video view
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [selectedChannelTitle, setSelectedChannelTitle] = useState<string | null>(null);
  
  // Navigation history for proper back behavior
  const [navigationHistory, setNavigationHistory] = useState<Array<{
    feedId: number | null;
    categoryId: number | null;
    starred: boolean;
    status: 'unread' | 'read' | 'all';
    mediaType: 'all' | 'audio' | 'video' | 'magazines' | 'books';
    channelId?: number | null;
  }>>([]);
  
  // Settings for view mode
  const {
    viewMode,
    einkMode,
    showArticleImages,
    magazineExcerptLines,
    setViewMode,
    setViewModeForScope,
    getViewModeForScope,
  } = useSettingsStore();
  const isLandscapeViewport = useIsLandscapeViewport();
  // In eink mode, always use fullscreen/overlay for the article reader so the
  // full viewport width is available for paginated two-column layout even in
  // landscape, where the "desktop" side-panel layout is too narrow.
  const preferFullscreenMagazineReader = einkMode;

  const viewScopeKey = useMemo(() => {
    if (mediaType === 'audio') return 'audio';
    if (mediaType === 'video') return 'video';
    if (mediaType === 'magazines') return 'magazines';
    if (mediaType === 'books') return 'books';
    if (starred) return 'starred';
    if (feedId) return `feed:${feedId}`;
    if (categoryId) return `category:${categoryId}`;
    return 'home';
  }, [mediaType, starred, feedId, categoryId]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_PIN_MODE_STORAGE_KEY, String(sidebarPinned));
    setSidebarCollapsed(!sidebarPinned);
  }, [sidebarPinned]);

  useEffect(() => {
    const scopedViewMode = getViewModeForScope(viewScopeKey);
    const normalizedViewMode = mediaType === 'audio' && scopedViewMode === 'magazine'
      ? 'list'
      : mediaType === 'video' && scopedViewMode === 'list'
        ? 'cards'
        : scopedViewMode;

    if (normalizedViewMode !== viewMode) {
      setViewMode(normalizedViewMode);
    }
  }, [getViewModeForScope, mediaType, setViewMode, viewMode, viewScopeKey]);

  useEffect(() => {
    if (mediaType !== 'magazines') {
      const { isPdfViewerOpen, closePdfViewer } = useMagazinesStore.getState();
      if (isPdfViewerOpen) {
        closePdfViewer();
      }
    }

    if (mediaType !== 'books') {
      const { isReaderOpen, closeReader } = useBooksStore.getState();
      if (isReaderOpen) {
        closeReader();
      }
    }
  }, [mediaType]);

  // Load initial data
  useEffect(() => {
    fetchFeeds();
    fetchCategories();
    fetchCounters();
    fetchEntries();
    useModulesStore.getState().fetchModules();
  }, [fetchFeeds, fetchCategories, fetchCounters, fetchEntries]);

  // Handlers
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // Just re-fetch from the API — the backend scheduler already polls
    // feeds on its own interval so we don't need to trigger a backend refresh.
    await Promise.all([fetchEntries(), fetchCounters(), fetchFeeds()]);
    setIsRefreshing(false);
  }, [fetchEntries, fetchCounters, fetchFeeds]);

  const handleSelectView = useCallback((view: { 
    feedId?: number | null; 
    categoryId?: number | null; 
    starred?: boolean;
    status?: 'unread' | 'read' | 'all';
    mediaType?: 'all' | 'audio' | 'video' | 'magazines' | 'books';
  }, addToHistory = true) => {
    let nextView = {
      feedId: view.feedId ?? null,
      categoryId: view.categoryId ?? null,
      starred: view.starred ?? false,
      status: view.status ?? 'all' as const,
      mediaType: view.mediaType ?? 'all' as const,
    };

    // Save current view to history before navigating (if not explicitly prevented)
    if (addToHistory) {
      setNavigationHistory(prev => [...prev, {
        feedId: feedId ?? null,
        categoryId: categoryId ?? null,
        starred: starred ?? false,
        status: status ?? 'all',
        mediaType: mediaType ?? 'all',
        channelId: selectedChannelId,
      }]);
    }
    
    // Reset view mode to list when switching to audio (audio keeps special list-only behavior)
    if (nextView.mediaType === 'audio' && viewMode === 'magazine') {
      useSettingsStore.getState().setViewMode('list');
    }
    
    // Clear selected channel when changing views (unless staying in video)
    if (nextView.mediaType !== 'video') {
      setSelectedChannelId(null);
      setSelectedChannelTitle(null);
    }

    // Close magazine PDF viewer when navigating away from magazines
    if (nextView.mediaType !== 'magazines') {
      const magStore = useMagazinesStore.getState();
      if (magStore.isPdfViewerOpen) {
        magStore.closePdfViewer();
      }
    }

    // When switching to audio, set the configured audio category
    if (nextView.mediaType === 'audio' && !nextView.categoryId) {
      const catId = useSettingsStore.getState().audioCategoryId;
      if (catId) {
        nextView = { ...nextView, categoryId: catId };
      }
    }

    // When switching to video, set the configured video category
    if (nextView.mediaType === 'video' && !nextView.categoryId) {
      const catId = useSettingsStore.getState().videoCategoryId;
      if (catId) {
        nextView = { ...nextView, categoryId: catId };
      }
    }

    // When switching to magazines, set the configured magazines category
    if (nextView.mediaType === 'magazines' && !nextView.categoryId) {
      const catId = useSettingsStore.getState().magazinesCategoryId;
      if (catId) {
        nextView = { ...nextView, categoryId: catId };
      }
    }
    
    setFilter(nextView);
  }, [setFilter, viewMode, feedId, categoryId, starred, status, mediaType, selectedChannelId]);

  // Go back to previous view
  const handleGoBack = useCallback(() => {
    if (selectedEntry) {
      handleSelectEntry(null);
    } else if (selectedChannelId !== null) {
      // If viewing a specific video channel, go back to the video main view
      setSelectedChannelId(null);
      setSelectedChannelTitle(null);
    } else if (navigationHistory.length > 0) {
      // Pop the last view from history and navigate to it
      const lastView = navigationHistory[navigationHistory.length - 1];
      setNavigationHistory(prev => prev.slice(0, -1));
      
      // Restore channel if it was set
      if (lastView.channelId) {
        setSelectedChannelId(lastView.channelId);
      }
      
      // Navigate without adding to history
      setFilter({
        feedId: lastView.feedId,
        categoryId: lastView.categoryId,
        starred: lastView.starred,
        status: lastView.status,
        mediaType: lastView.mediaType,
      });
    }
  }, [selectedChannelId, navigationHistory, setFilter]);

  // Handle video channel selection
  const handleSelectChannel = useCallback((feed: Feed | null) => {
    setSelectedChannelId(feed?.id ?? null);
    setSelectedChannelTitle(feed?.title ?? null);
  }, []);

  // Check if an entry is a podcast (has audio enclosure)
  const isPodcastEntry = useCallback((entry: Entry): boolean => {
    return entry.enclosures?.some(e => e.mime_type?.startsWith('audio/')) ?? false;
  }, []);

  // Check if an entry is a video (has video enclosure OR is a YouTube URL)
  const isVideoEntry = useCallback((entry: Entry): boolean => {
    // Check for video enclosure
    if (entry.enclosures?.some(e => e.mime_type?.startsWith('video/'))) return true;
    // Check for YouTube URL
    if (entry.url && (entry.url.includes('youtube.com') || entry.url.includes('youtu.be'))) return true;
    return false;
  }, []);

  const handleSelectEntry = useCallback((entry: Entry | null) => {
    selectEntry(entry);
    // Don't mark podcasts or videos as read - they're marked when played to completion
    // Only mark regular articles as read when opened
    if (entry && entry.status === 'unread' && !isPodcastEntry(entry) && !isVideoEntry(entry)) {
      markAsRead(entry.id);
    }
  }, [selectEntry, markAsRead, isPodcastEntry, isVideoEntry]);

  const handleSearch = useCallback(async (query: string): Promise<Entry[]> => {
    try {
      const response = await api.getEntries({ search: query, limit: 20 });
      return response.entries;
    } catch {
      return [];
    }
  }, []);

  // Feed management handlers
  const handleEditFeed = useCallback((feed: Feed) => {
    setEditingFeed(feed);
    setEditFeedOpen(true);
  }, []);

  const handleFeedDeleted = useCallback((feedId: number) => {
    // If we're viewing the deleted feed, go back to Home
    if (feedId === feeds.find(f => f.id === feedId)?.id) {
      handleSelectView({ feedId: null, categoryId: null, starred: false, status: 'all' });
    }
  }, [feeds]);

  // Get current view title
  const getViewTitle = useCallback(() => {
    if (starred) return 'Bookmarks';
    if (mediaType === 'audio') {
      return 'Audio';
    }
    if (mediaType === 'video') {
      // Show channel title if viewing a specific channel
      return selectedChannelTitle || 'Video';
    }
    if (mediaType === 'magazines') return 'Magazines';
    if (mediaType === 'books') return 'Books';
    if (feedId) {
      const feed = feeds.find(f => f.id === feedId);
      return feed?.title || 'Feed';
    }
    if (categoryId) {
      const category = categories.find(c => c.id === categoryId);
      return category?.title || 'Category';
    }
    return 'Home';
  }, [starred, mediaType, feedId, categoryId, feeds, categories, selectedChannelTitle]);

  // Get filtered entries based on media type
  const filteredEntries = useMemo(() => getFilteredEntries(), [entries, mediaType, getFilteredEntries]);

  // Find current entry index for navigation
  const currentIndex = useMemo(() => 
    selectedEntry ? filteredEntries.findIndex(e => e.id === selectedEntry.id) : -1,
    [selectedEntry, filteredEntries]
  );

  // Navigation handlers
  const goToPreviousEntry = useCallback(() => {
    if (currentIndex > 0) {
      handleSelectEntry(filteredEntries[currentIndex - 1]);
    }
  }, [currentIndex, filteredEntries, handleSelectEntry]);

  const goToNextEntry = useCallback(() => {
    if (currentIndex < filteredEntries.length - 1) {
      handleSelectEntry(filteredEntries[currentIndex + 1]);
    }
  }, [currentIndex, filteredEntries, handleSelectEntry]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNextEntry: goToNextEntry,
    onPreviousEntry: goToPreviousEntry,
    onOpenEntry: () => {
      if (!selectedEntry && filteredEntries.length > 0) {
        handleSelectEntry(filteredEntries[0]);
      }
    },
    onCloseEntry: () => selectEntry(null),
    onToggleSidebar: () => setSidebarCollapsed(prev => !prev),
    onToggleRead: () => {
      if (selectedEntry) {
        if (selectedEntry.status === 'unread') {
          markAsRead(selectedEntry.id);
        } else {
          markAsUnread(selectedEntry.id);
        }
      }
    },
    onToggleStarred: () => {
      if (selectedEntry) {
        toggleBookmark(selectedEntry.id);
      }
    },
    onOpenInBrowser: () => {
      if (selectedEntry) {
        window.open(selectedEntry.url, '_blank');
      }
    },
    onRefresh: handleRefresh,
    onOpenSearch: () => setSearchOpen(true),
    enabled: !searchOpen,
  });

  // Derive active tab from current view state for mobile navigation
  const activeTab: NavTab = useMemo(() => {
    if (starred) return 'starred';
    if (mediaType === 'audio') return 'audio';
    if (mediaType === 'video') return 'video';
    if (mediaType === 'magazines') return 'magazines';
    if (mediaType === 'books') return 'books';
    return 'home';
  }, [starred, mediaType]);

  // Handle mobile navigation tab changes
  const handleTabChange = useCallback((tab: NavTab) => {
    switch (tab) {
      case 'home':
        handleSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'all' });
        break;
      case 'audio':
        handleSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'audio' });
        break;
      case 'video':
        handleSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'video' });
        break;
      case 'magazines':
        handleSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'magazines' });
        break;
      case 'books':
        handleSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'books' });
        break;
      case 'starred':
        handleSelectView({ feedId: null, categoryId: null, starred: true, status: 'all', mediaType: 'all' });
        break;
    }
  }, [handleSelectView]);

  // Back button is removed - use bottom navigation tabs instead
  
  return (
    <>
      <AppLayout
        sidebarCollapsed={sidebarCollapsed}
        onSidebarCollapse={setSidebarCollapsed}
        sidebarPinned={sidebarPinned}
        onSidebarOverlayRequest={() => setSidebarOverlayRequestToken((prev) => prev + 1)}
        headerTitle={getViewTitle()}
        onBack={(selectedEntry || selectedChannelId !== null || navigationHistory.length > 0) ? handleGoBack : undefined}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        viewMode={viewMode}
        onViewModeChange={mediaType !== 'audio' && mediaType !== 'magazines' && mediaType !== 'video' && mediaType !== 'books' ? (mode) => setViewModeForScope(viewScopeKey, mode) : undefined}
        mediaType={mediaType}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        overlayReader={preferFullscreenMagazineReader}
        headerActions={
          mediaType === 'books' ? (
            <BookHeaderActions />
          ) : mediaType === 'audio' || mediaType === 'video' || mediaType === 'magazines' ? (
            <div className="glass-panel-nav flex items-center px-1.5 py-1">
              <button
                onClick={() => {
                  const tab = mediaType === 'audio' ? 'podcasts' : mediaType === 'video' ? 'youtube' : 'magazinelib';
                  setAddFeedInitialTab(tab);
                  setAddFeedInitialCategory(undefined);
                  setAddFeedOpen(true);
                }}
                className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 transition-all"
                title={`Add ${mediaType === 'audio' ? 'podcast' : mediaType === 'video' ? 'channel' : 'magazine'}`}
              >
                <Plus className="w-[18px] h-[18px]" strokeWidth={1.75} />
              </button>
            </div>
          ) : !starred && !feedId && !categoryId ? (
            <div className="glass-panel-nav flex items-center px-1.5 py-1">
              <button
                onClick={() => {
                  setAddFeedInitialTab('rss');
                  setAddFeedInitialCategory(undefined);
                  setAddFeedOpen(true);
                }}
                className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 transition-all"
                title="Add feed"
              >
                <Plus className="w-[18px] h-[18px]" strokeWidth={1.75} />
              </button>
            </div>
          ) : undefined
        }
        sidebar={
          <AppSidebar
            feeds={feeds}
            categories={categories}
            counters={counters}
            collapsed={sidebarCollapsed}
            sidebarPinned={sidebarPinned}
            onSidebarPinnedChange={setSidebarPinned}
            overlayRequestToken={sidebarOverlayRequestToken}
            onSelectView={(view) => handleSelectView(view)}
            onRefresh={handleRefresh}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
            onAddFeed={(categoryId?: number, tab?: 'rss' | 'youtube' | 'reddit' | 'podcasts' | 'magazinelib' | 'zlib') => { setAddFeedInitialTab(tab || 'rss'); setAddFeedInitialCategory(categoryId); setAddFeedOpen(true); }}
            onManageFeeds={() => setFeedManagementOpen(true)}
            onEditFeed={handleEditFeed}
            onToggleCollapse={() => {
              if (sidebarPinned) {
                setSidebarCollapsed((prev) => !prev);
                return;
              }
              setSidebarOverlayRequestToken((prev) => prev + 1);
            }}
            isRefreshing={isRefreshing}
            currentView={{
              feedId,
              categoryId,
              starred,
              status,
              mediaType,
            }}
          />
        }
        list={
          mediaType === 'audio' ? (
            <PodcastsView
              feeds={feeds}
              entries={entries}
              onSelectEntry={handleSelectEntry}
              onPlaySeries={(feedId, feedEntries) => {
                useAudioStore.getState().playSeriesFromEntry(feedId, feedEntries);
              }}
              onPlayAllRecent={(recentEntries) => {
                useAudioStore.getState().playAllRecent(recentEntries);
              }}
              onRefresh={handleRefresh}
            />
          ) : mediaType === 'video' ? (
            <VideosView
              feeds={feeds}
              entries={entries}
              viewMode={viewMode}
              onSelectEntry={handleSelectEntry}
              onRefresh={handleRefresh}
              selectedChannelId={selectedChannelId}
              onSelectChannel={handleSelectChannel}
            />
          ) : mediaType === 'magazines' ? (
            <MagazinesView
              entries={entries}
              feeds={feeds}
              onRefresh={handleRefresh}
            />
          ) : mediaType === 'books' ? (
            <BooksView />
          ) : (
            <EntryList
              entries={filteredEntries}
              selectedEntry={selectedEntry}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              isRefetching={isRefetching}
              hasMore={hasMore}
              title={getViewTitle()}
              count={filteredEntries.length}
              onSelectEntry={handleSelectEntry}
              onLoadMore={fetchMoreEntries}
              onRefresh={handleRefresh}
              onToggleBookmark={toggleBookmark}
              onMarkAsRead={markAsRead}
              onMarkAsUnread={markAsUnread}
              viewMode={viewMode}
              showImages={useSettingsStore.getState().showArticleImages}
              preferFullscreenReader={preferFullscreenMagazineReader}
            />
          )
        }
        reader={selectedEntry && mediaType !== 'audio' && mediaType !== 'video' ? (
          <ArticleReader
            entry={selectedEntry}
            onClose={() => selectEntry(null)}
            onToggleBookmark={toggleBookmark}
            onMarkAsRead={markAsRead}
            onMarkAsUnread={markAsUnread}
            onPreviousEntry={goToPreviousEntry}
            onNextEntry={goToNextEntry}
            hasPrevious={currentIndex > 0}
            hasNext={currentIndex < filteredEntries.length - 1}
            fullscreen={preferFullscreenMagazineReader}
          />
        ) : undefined}
      />

      {/* Search Modal */}
      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={handleSearch}
        onSelectEntry={(entry) => {
          handleSelectEntry(entry);
          setSearchOpen(false);
        }}
        feeds={feeds}
        categories={categories}
        onSelectFeed={(feedId) => {
          handleSelectView({ feedId, categoryId: null, starred: false, status: 'all' });
        }}
        onSelectCategory={(categoryId) => {
          handleSelectView({ feedId: null, categoryId, starred: false, status: 'all' });
        }}
      />
      
      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Add Feed Modal */}
      <AddFeedModal
        isOpen={addFeedOpen}
        onClose={() => { setAddFeedOpen(false); setAddFeedInitialCategory(undefined); }}
        categories={categories}
        initialTab={addFeedInitialTab}
        initialCategory={addFeedInitialCategory}
      />

      {/* Edit Feed Modal */}
      <EditFeedModal
        isOpen={editFeedOpen}
        onClose={() => {
          setEditFeedOpen(false);
          setEditingFeed(null);
        }}
        feed={editingFeed}
        categories={categories}
        onDelete={handleFeedDeleted}
      />

      {/* Feed Management Modal */}
      <FeedManagementModal
        isOpen={feedManagementOpen}
        onClose={() => setFeedManagementOpen(false)}
        feeds={feeds}
        categories={categories}
      />

      {/* Persistent Audio Player */}
      <AudioPlayer />

      {/* Persistent TTS Player */}
      <TTSMiniPlayer />

      {/* Persistent Video Player */}
      <VideoPlayer />
    </>
  );
}

export const Route = createFileRoute('/')({
  component: HomePage,
});
