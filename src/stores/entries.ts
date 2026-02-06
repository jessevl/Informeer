/**
 * Entries Store
 * Manages entries/articles state and pagination
 */

import { create } from 'zustand';
import { miniflux } from '@/api/miniflux';
import type { Entry, EntryQueryParams } from '@/types/miniflux';
import { isYouTubeUrl } from '@/lib/utils';
import { useFeedsStore } from './feeds';

// Helper to check if an entry is audio content (podcast)
function isAudioEntry(entry: Entry): boolean {
  // Check enclosures for audio mime types
  if (entry.enclosures) {
    return entry.enclosures.some(enc => 
      enc.mime_type?.startsWith('audio/') || 
      enc.mime_type === 'application/x-mpegURL'
    );
  }
  return false;
}

// Helper to check if an entry is video content (YouTube, etc)
function isVideoEntry(entry: Entry): boolean {
  // Check if URL is YouTube
  if (isYouTubeUrl(entry.url)) return true;
  
  // Check enclosures for video mime types
  if (entry.enclosures) {
    return entry.enclosures.some(enc => 
      enc.mime_type?.startsWith('video/')
    );
  }
  return false;
}

interface EntriesState {
  // State
  entries: Entry[];
  selectedEntry: Entry | null;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;

  // Filter state
  status: 'unread' | 'read' | 'all';
  feedId: number | null;
  categoryId: number | null;
  starred: boolean;
  searchQuery: string;
  mediaType: 'all' | 'audio' | 'video';

  // Actions
  fetchEntries: (reset?: boolean) => Promise<void>;
  fetchMoreEntries: () => Promise<void>;
  setFilter: (filter: Partial<Pick<EntriesState, 'status' | 'feedId' | 'categoryId' | 'starred' | 'searchQuery' | 'mediaType'>>) => void;
  selectEntry: (entry: Entry | null) => void;
  markAsRead: (entryId: number) => Promise<void>;
  markAsUnread: (entryId: number) => Promise<void>;
  toggleBookmark: (entryId: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  
  // Getters
  getFilteredEntries: () => Entry[];
}

export const useEntriesStore = create<EntriesState>((set, get) => ({
  // Initial state
  entries: [],
  selectedEntry: null,
  total: 0,
  offset: 0,
  limit: 50,
  hasMore: false,
  isLoading: false,
  isLoadingMore: false,
  error: null,

  // Filter state
  status: 'all',
  feedId: null,
  categoryId: null,
  starred: false,
  searchQuery: '',
  mediaType: 'all',

  // Get entries filtered by media type and hide_globally (client-side filtering since Miniflux doesn't support this)
  getFilteredEntries: () => {
    const { entries, mediaType, feedId, categoryId } = get();
    
    // Get feeds and categories data for hide_globally filtering
    const { feeds, categories } = useFeedsStore.getState();
    
    // Build sets of hidden feed IDs and category IDs
    const hiddenFeedIds = new Set(
      feeds.filter(f => f.hide_globally).map(f => f.id)
    );
    const hiddenCategoryIds = new Set(
      categories.filter(c => c.hide_globally).map(c => c.id)
    );
    
    let filtered = entries;
    
    // Apply hide_globally filtering only in global view (no specific feed or category selected)
    if (feedId === null && categoryId === null) {
      filtered = filtered.filter(entry => {
        // Check if entry's feed is hidden
        if (entry.feed_id && hiddenFeedIds.has(entry.feed_id)) {
          return false;
        }
        // Check if entry's category is hidden
        if (entry.feed?.category?.id && hiddenCategoryIds.has(entry.feed.category.id)) {
          return false;
        }
        return true;
      });
    }
    
    // Apply media type filtering
    if (mediaType === 'audio') filtered = filtered.filter(isAudioEntry);
    if (mediaType === 'video') filtered = filtered.filter(isVideoEntry);
    
    return filtered;
  },

  // Fetch entries with current filters
  fetchEntries: async (reset = true) => {
    const { status, feedId, categoryId, starred, searchQuery, limit, mediaType } = get();

    if (reset) {
      set({ isLoading: true, error: null, offset: 0 });
    }

    try {
      // Use higher limit for media types since they're filtered client-side
      const effectiveLimit = (mediaType === 'audio' || mediaType === 'video') ? 500 : limit;
      
      const params: EntryQueryParams = {
        limit: effectiveLimit,
        offset: 0,
        order: 'published_at',
        direction: 'desc',
      };

      // Apply filters
      if (status !== 'all') {
        params.status = status;
      }
      if (starred) {
        params.starred = true;
      }
      if (searchQuery) {
        params.search = searchQuery;
      }
      if (categoryId) {
        params.category_id = categoryId;
      }

      // Fetch entries based on context
      let response;
      if (feedId) {
        response = await miniflux.getFeedEntries(feedId, params);
      } else if (categoryId) {
        response = await miniflux.getCategoryEntries(categoryId, params);
      } else {
        response = await miniflux.getEntries(params);
      }

      set({
        entries: response.entries,
        total: response.total,
        offset: response.entries.length,
        hasMore: response.entries.length < response.total,
        isLoading: false,
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch entries',
      });
    }
  },

  // Fetch more entries (pagination)
  fetchMoreEntries: async () => {
    const { status, feedId, categoryId, starred, searchQuery, limit, offset, hasMore, isLoadingMore, mediaType } = get();

    if (!hasMore || isLoadingMore) return;

    set({ isLoadingMore: true });

    try {
      // Use higher limit for media types since they're filtered client-side
      const effectiveLimit = (mediaType === 'audio' || mediaType === 'video') ? 500 : limit;
      
      const params: EntryQueryParams = {
        limit: effectiveLimit,
        offset,
        order: 'published_at',
        direction: 'desc',
      };

      if (status !== 'all') {
        params.status = status;
      }
      if (starred) {
        params.starred = true;
      }
      if (searchQuery) {
        params.search = searchQuery;
      }
      if (categoryId) {
        params.category_id = categoryId;
      }

      let response;
      if (feedId) {
        response = await miniflux.getFeedEntries(feedId, params);
      } else if (categoryId) {
        response = await miniflux.getCategoryEntries(categoryId, params);
      } else {
        response = await miniflux.getEntries(params);
      }

      set((state) => ({
        entries: [...state.entries, ...response.entries],
        offset: state.offset + response.entries.length,
        hasMore: state.offset + response.entries.length < response.total,
        isLoadingMore: false,
      }));
    } catch (error) {
      set({
        isLoadingMore: false,
        error: error instanceof Error ? error.message : 'Failed to fetch more entries',
      });
    }
  },

  // Update filters and re-fetch
  setFilter: (filter) => {
    set(filter);
    get().fetchEntries(true);
  },

  // Select an entry for reading
  selectEntry: (entry) => {
    set({ selectedEntry: entry });
    // NOTE: Auto-marking as read is now handled by the component (handleSelectEntry in routes/index.tsx)
    // to properly check for both podcasts AND videos (including YouTube URLs)
    // Do NOT mark as read here to avoid duplicate logic and ensure videos aren't marked prematurely
  },

  // Mark entry as read
  markAsRead: async (entryId: number) => {
    try {
      await miniflux.updateEntries({
        entry_ids: [entryId],
        status: 'read',
      });

      set((state) => ({
        entries: state.entries.map((e) =>
          e.id === entryId ? { ...e, status: 'read' } : e
        ),
        selectedEntry:
          state.selectedEntry?.id === entryId
            ? { ...state.selectedEntry, status: 'read' }
            : state.selectedEntry,
      }));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  },

  // Mark entry as unread
  markAsUnread: async (entryId: number) => {
    try {
      await miniflux.updateEntries({
        entry_ids: [entryId],
        status: 'unread',
      });

      set((state) => ({
        entries: state.entries.map((e) =>
          e.id === entryId ? { ...e, status: 'unread' } : e
        ),
        selectedEntry:
          state.selectedEntry?.id === entryId
            ? { ...state.selectedEntry, status: 'unread' }
            : state.selectedEntry,
      }));
    } catch (error) {
      console.error('Failed to mark as unread:', error);
    }
  },

  // Toggle bookmark
  toggleBookmark: async (entryId: number) => {
    try {
      await miniflux.toggleBookmark(entryId);

      set((state) => ({
        entries: state.entries.map((e) =>
          e.id === entryId ? { ...e, starred: !e.starred } : e
        ),
        selectedEntry:
          state.selectedEntry?.id === entryId
            ? { ...state.selectedEntry, starred: !state.selectedEntry.starred }
            : state.selectedEntry,
      }));
    } catch (error) {
      console.error('Failed to toggle bookmark:', error);
    }
  },

  // Mark all current entries as read
  markAllAsRead: async () => {
    const { entries } = get();
    const unreadIds = entries.filter((e) => e.status === 'unread').map((e) => e.id);

    if (unreadIds.length === 0) return;

    try {
      await miniflux.updateEntries({
        entry_ids: unreadIds,
        status: 'read',
      });

      set((state) => ({
        entries: state.entries.map((e) => ({ ...e, status: 'read' })),
      }));
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  },
}));
