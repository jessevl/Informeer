import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useFeedsStore } from '@/stores/feeds';
import { useEntriesStore } from '@/stores/entries';
import { useSettingsStore } from '@/stores/settings';
import { useAudioStore } from '@/stores/audio';
import { useVideoStore } from '@/stores/video';
import { miniflux } from '@/api/miniflux';
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
import { AudioPlayer } from '@/components/player/AudioPlayer';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import type { Entry, Feed } from '@/types/miniflux';

function HomePage() {
  const { logout } = useAuthStore();
  const { feeds, categories, counters, fetchFeeds, fetchCategories, fetchCounters, refreshAllFeeds } = useFeedsStore();
  const { 
    entries, 
    selectedEntry, 
    isLoading, 
    status,
    feedId,
    categoryId,
    starred,
    mediaType,
    fetchEntries, 
    fetchMoreEntries,
    hasMore,
    setFilter,
    selectEntry,
    markAsRead,
    markAsUnread,
    toggleBookmark,
    getFilteredEntries,
  } = useEntriesStore();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [editFeedOpen, setEditFeedOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<Feed | null>(null);
  const [feedManagementOpen, setFeedManagementOpen] = useState(false);
  
  // Track selected podcast for audio view
  const [selectedPodcastId, setSelectedPodcastId] = useState<number | null>(null);
  const [selectedPodcastTitle, setSelectedPodcastTitle] = useState<string | null>(null);
  
  // Track selected channel for video view
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [selectedChannelTitle, setSelectedChannelTitle] = useState<string | null>(null);
  
  // Navigation history for proper back behavior
  const [navigationHistory, setNavigationHistory] = useState<Array<{
    feedId: number | null;
    categoryId: number | null;
    starred: boolean;
    status: 'unread' | 'read' | 'all';
    mediaType: 'all' | 'audio' | 'video';
    podcastId?: number | null;
    channelId?: number | null;
  }>>([]);
  
  // Settings for view mode
  const { viewMode, showArticleImages, magazineExcerptLines } = useSettingsStore();

  // Load initial data
  useEffect(() => {
    fetchFeeds();
    fetchCategories();
    fetchCounters();
    fetchEntries();
  }, [fetchFeeds, fetchCategories, fetchCounters, fetchEntries]);

  // Handlers
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refreshAllFeeds();
    await fetchEntries();
    await fetchCounters();
    setIsRefreshing(false);
  }, [refreshAllFeeds, fetchEntries, fetchCounters]);

  const handleLogout = useCallback(() => {
    logout();
    window.location.href = '/login';
  }, [logout]);

  const handleSelectView = useCallback((view: { 
    feedId?: number | null; 
    categoryId?: number | null; 
    starred?: boolean;
    status?: 'unread' | 'read' | 'all';
    mediaType?: 'all' | 'audio' | 'video';
  }, addToHistory = true) => {
    // Save current view to history before navigating (if not explicitly prevented)
    if (addToHistory) {
      setNavigationHistory(prev => [...prev, {
        feedId: feedId ?? null,
        categoryId: categoryId ?? null,
        starred: starred ?? false,
        status: status ?? 'all',
        mediaType: mediaType ?? 'all',
        podcastId: selectedPodcastId,
        channelId: selectedChannelId,
      }]);
    }
    
    // Reset view mode to list when switching to audio or video (they don't support magazine view)
    if ((view.mediaType === 'audio' || view.mediaType === 'video') && viewMode === 'magazine') {
      useSettingsStore.getState().setViewMode('list');
    }
    
    // Clear selected podcast when changing views (unless staying in audio)
    if (view.mediaType !== 'audio') {
      setSelectedPodcastId(null);
      setSelectedPodcastTitle(null);
    }
    
    // Clear selected channel when changing views (unless staying in video)
    if (view.mediaType !== 'video') {
      setSelectedChannelId(null);
      setSelectedChannelTitle(null);
    }
    
    setFilter(view);
  }, [setFilter, viewMode, feedId, categoryId, starred, status, mediaType, selectedPodcastId, selectedChannelId]);

  // Go back to previous view
  const handleGoBack = useCallback(() => {
    if (selectedPodcastId !== null) {
      // If viewing a specific podcast, go back to the audio main view
      setSelectedPodcastId(null);
      setSelectedPodcastTitle(null);
    } else if (selectedChannelId !== null) {
      // If viewing a specific video channel, go back to the video main view
      setSelectedChannelId(null);
      setSelectedChannelTitle(null);
    } else if (navigationHistory.length > 0) {
      // Pop the last view from history and navigate to it
      const lastView = navigationHistory[navigationHistory.length - 1];
      setNavigationHistory(prev => prev.slice(0, -1));
      
      // Restore podcast if it was set
      if (lastView.podcastId) {
        setSelectedPodcastId(lastView.podcastId);
      }
      
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
  }, [selectedPodcastId, selectedChannelId, navigationHistory, setFilter]);

  // Handle podcast selection
  const handleSelectPodcast = useCallback((feed: Feed | null) => {
    setSelectedPodcastId(feed?.id ?? null);
    setSelectedPodcastTitle(feed?.title ?? null);
  }, []);

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

  const handleSelectEntry = useCallback((entry: Entry) => {
    selectEntry(entry);
    // Don't mark podcasts or videos as read - they're marked when played to completion
    // Only mark regular articles as read when opened
    if (entry.status === 'unread' && !isPodcastEntry(entry) && !isVideoEntry(entry)) {
      markAsRead(entry.id);
    }
  }, [selectEntry, markAsRead, isPodcastEntry, isVideoEntry]);

  const handleSearch = useCallback(async (query: string): Promise<Entry[]> => {
    try {
      const response = await miniflux.getEntries({ search: query, limit: 20 });
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
      // Show podcast title if viewing a specific podcast
      return selectedPodcastTitle || 'Audio';
    }
    if (mediaType === 'video') {
      // Show channel title if viewing a specific channel
      return selectedChannelTitle || 'Video';
    }
    if (feedId) {
      const feed = feeds.find(f => f.id === feedId);
      return feed?.title || 'Feed';
    }
    if (categoryId) {
      const category = categories.find(c => c.id === categoryId);
      return category?.title || 'Category';
    }
    return 'Home';
  }, [starred, mediaType, feedId, categoryId, feeds, categories, selectedPodcastTitle, selectedChannelTitle]);

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
        headerTitle={getViewTitle()}
        onBack={undefined}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        viewMode={viewMode}
        onViewModeChange={mediaType !== 'audio' && mediaType !== 'video' ? (mode) => useSettingsStore.getState().setViewMode(mode) : undefined}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        sidebar={
          <AppSidebar
            feeds={feeds}
            categories={categories}
            counters={counters}
            collapsed={sidebarCollapsed}
            onSelectView={(view) => handleSelectView(view)}
            onRefresh={handleRefresh}
            onLogout={handleLogout}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
            onAddFeed={() => setAddFeedOpen(true)}
            onManageFeeds={() => setFeedManagementOpen(true)}
            onEditFeed={handleEditFeed}
            onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
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
              categories={categories}
              onSelectEntry={handleSelectEntry}
              onPlaySeries={(feedId, feedEntries) => {
                useAudioStore.getState().playSeriesFromEntry(feedId, feedEntries);
              }}
              onPlayAllRecent={(recentEntries) => {
                useAudioStore.getState().playAllRecent(recentEntries);
              }}
              onRefresh={handleRefresh}
              selectedPodcastId={selectedPodcastId}
              onSelectPodcast={handleSelectPodcast}
            />
          ) : mediaType === 'video' ? (
            <VideosView
              feeds={feeds}
              entries={entries}
              categories={categories}
              onSelectEntry={handleSelectEntry}
              onRefresh={handleRefresh}
              selectedChannelId={selectedChannelId}
              onSelectChannel={handleSelectChannel}
            />
          ) : (
            <EntryList
              entries={filteredEntries}
              selectedEntry={selectedEntry}
              isLoading={isLoading}
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
            />
          )
        }
        reader={selectedEntry ? (
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
          handleSelectView({ feedId, categoryId: null, starred: false, status: 'unread' });
        }}
        onSelectCategory={(categoryId) => {
          handleSelectView({ feedId: null, categoryId, starred: false, status: 'unread' });
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
        onClose={() => setAddFeedOpen(false)}
        categories={categories}
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

      {/* Persistent Video Player */}
      <VideoPlayer />
    </>
  );
}

export const Route = createFileRoute('/')({
  component: HomePage,
});
