/**
 * Entries Store
 * Manages entries/articles state and pagination
 */

import { create } from 'zustand';
import { api } from '@/api/client';
import type { Entry, EntryQueryParams } from '@/types/api';
import { isYouTubeUrl } from '@/lib/utils';
import { useFeedsStore } from './feeds';
import { useSettingsStore } from './settings';
import { markApiSuccess } from './connectivity';
import { markRefreshed } from '@/lib/focus-refresh';
import { enqueue } from '@/lib/offline/sync-queue';

let latestEntriesRequestId = 0;

function hasOwn<Key extends PropertyKey>(value: object, key: Key): value is Record<Key, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function buildFilterKey(filter: Pick<EntriesState, 'status' | 'feedId' | 'categoryId' | 'starred' | 'searchQuery' | 'mediaType'>): string {
  return JSON.stringify([
    filter.status,
    filter.feedId,
    filter.categoryId,
    filter.starred,
    filter.searchQuery,
    filter.mediaType,
  ]);
}

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
  isRefetching: boolean;
  error: string | null;

  // Filter state
  status: 'unread' | 'read' | 'all';
  feedId: number | null;
  categoryId: number | null;
  starred: boolean;
  searchQuery: string;
  mediaType: 'all' | 'audio' | 'video' | 'magazines' | 'books';

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
  isRefetching: false,
  error: null,

  // Filter state
  status: 'all',
  feedId: null,
  categoryId: null,
  starred: false,
  searchQuery: '',
  mediaType: 'all',

  // Get entries filtered by media type and hide_globally (client-side filtering since Informeer doesn't support this)
  getFilteredEntries: () => {
    const { entries, mediaType, feedId, categoryId } = get();
    const { magazinesCategoryId } = useSettingsStore.getState();
    
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

      if (mediaType === 'all' && magazinesCategoryId !== null) {
        filtered = filtered.filter((entry) => entry.feed?.category?.id !== magazinesCategoryId);
      }
    }
    
    // Apply media type filtering
    if (mediaType === 'audio') filtered = filtered.filter(isAudioEntry);
    if (mediaType === 'video') filtered = filtered.filter(isVideoEntry);
    // 'magazines' type is handled by MagazinesView directly via magazineFeedIds
    
    return filtered;
  },

  // Fetch entries with current filters
  fetchEntries: async (reset = true) => {
    const requestId = ++latestEntriesRequestId;
    const { status, feedId, categoryId, starred, searchQuery, limit, mediaType } = get();

    if (reset) {
      if (get().entries.length === 0) {
        set({ isLoading: true, error: null, offset: 0 });
      } else {
        // Already have entries — keep them visible, show subtle refetch indicator
        set({ isRefetching: true, error: null, offset: 0 });
      }
    }

    // Offline: keep existing data, don't error
    if (!navigator.onLine) {
      set({ isLoading: false, isRefetching: false });
      return;
    }

    try {
      // Use higher limit for media types since they're filtered client-side
      const effectiveLimit = (mediaType === 'audio' || mediaType === 'video' || mediaType === 'magazines') ? 500 : limit;
      
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
        response = await api.getFeedEntries(feedId, params);
      } else if (categoryId) {
        response = await api.getCategoryEntries(categoryId, params);
      } else {
        response = await api.getEntries(params);
      }

      if (requestId !== latestEntriesRequestId) {
        return;
      }

      set({
        entries: response.entries,
        total: response.total,
        offset: response.entries.length,
        hasMore: response.entries.length < response.total,
        isLoading: false,
        isRefetching: false,
      });
      markRefreshed('entries');
      markApiSuccess();
    } catch (error) {
      if (requestId !== latestEntriesRequestId) {
        return;
      }

      // Already have data? Silently keep it.
      if (get().entries.length > 0) {
        set({ isLoading: false, isRefetching: false });
        return;
      }
      set({
        isLoading: false,
        isRefetching: false,
        error: error instanceof Error ? error.message : 'Failed to fetch entries',
      });
    }
  },

  // Fetch more entries (pagination)
  fetchMoreEntries: async () => {
    const requestId = ++latestEntriesRequestId;
    const { status, feedId, categoryId, starred, searchQuery, limit, offset, hasMore, isLoadingMore, mediaType } = get();

    if (!hasMore || isLoadingMore) return;

    set({ isLoadingMore: true });

    try {
      // Use higher limit for media types since they're filtered client-side
      const effectiveLimit = (mediaType === 'audio' || mediaType === 'video' || mediaType === 'magazines') ? 500 : limit;
      
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
        response = await api.getFeedEntries(feedId, params);
      } else if (categoryId) {
        response = await api.getCategoryEntries(categoryId, params);
      } else {
        response = await api.getEntries(params);
      }

      if (requestId !== latestEntriesRequestId) {
        return;
      }

      set((state) => ({
        entries: [...state.entries, ...response.entries],
        offset: state.offset + response.entries.length,
        hasMore: state.offset + response.entries.length < response.total,
        isLoadingMore: false,
      }));
    } catch (error) {
      if (requestId !== latestEntriesRequestId) {
        return;
      }

      set({
        isLoadingMore: false,
        error: error instanceof Error ? error.message : 'Failed to fetch more entries',
      });
    }
  },

  // Update filters and re-fetch — clear stale entries when the active view scope changes
  setFilter: (filter) => {
    const current = get();
    const nextFilter = {
      status: hasOwn(filter, 'status') ? (filter.status as EntriesState['status']) : current.status,
      feedId: hasOwn(filter, 'feedId') ? (filter.feedId as EntriesState['feedId']) : current.feedId,
      categoryId: hasOwn(filter, 'categoryId') ? (filter.categoryId as EntriesState['categoryId']) : current.categoryId,
      starred: hasOwn(filter, 'starred') ? (filter.starred as EntriesState['starred']) : current.starred,
      searchQuery: hasOwn(filter, 'searchQuery') ? (filter.searchQuery as EntriesState['searchQuery']) : current.searchQuery,
      mediaType: hasOwn(filter, 'mediaType') ? (filter.mediaType as EntriesState['mediaType']) : current.mediaType,
    };
    const isScopeChange = buildFilterKey(current) !== buildFilterKey(nextFilter);

    if (isScopeChange) {
      latestEntriesRequestId += 1;
      set({
        ...nextFilter,
        entries: [],
        total: 0,
        offset: 0,
        hasMore: false,
        isLoadingMore: false,
        isRefetching: false,
        error: null,
        selectedEntry: null,
      });
    } else {
      set({ ...nextFilter, selectedEntry: null });
    }

    get().fetchEntries(true);
  },

  // Select an entry for reading
  selectEntry: (entry) => {
    set({ selectedEntry: entry });
    // NOTE: Auto-marking as read is now handled by the component (handleSelectEntry in routes/index.tsx)
    // to properly check for both podcasts AND videos (including YouTube URLs)
    // Do NOT mark as read here to avoid duplicate logic and ensure videos aren't marked prematurely
  },

  // Mark entry as read (optimistic + offline queue)
  markAsRead: async (entryId: number) => {
    // Optimistic UI update always
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === entryId ? { ...e, status: 'read' } : e
      ),
      selectedEntry:
        state.selectedEntry?.id === entryId
          ? { ...state.selectedEntry, status: 'read' }
          : state.selectedEntry,
    }));

    if (!navigator.onLine) {
      enqueue({ id: `read-${entryId}`, type: 'mark-read', payload: { entryId } });
      return;
    }

    try {
      await api.updateEntries({
        entry_ids: [entryId],
        status: 'read',
      });
      markApiSuccess();
    } catch (error) {
      enqueue({ id: `read-${entryId}`, type: 'mark-read', payload: { entryId } });
      console.error('Failed to mark as read:', error);
    }
  },

  // Mark entry as unread (optimistic + offline queue)
  markAsUnread: async (entryId: number) => {
    // Optimistic UI update always
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === entryId ? { ...e, status: 'unread' } : e
      ),
      selectedEntry:
        state.selectedEntry?.id === entryId
          ? { ...state.selectedEntry, status: 'unread' }
          : state.selectedEntry,
    }));

    if (!navigator.onLine) {
      enqueue({ id: `unread-${entryId}`, type: 'mark-unread', payload: { entryId } });
      return;
    }

    try {
      await api.updateEntries({
        entry_ids: [entryId],
        status: 'unread',
      });
      markApiSuccess();
    } catch (error) {
      enqueue({ id: `unread-${entryId}`, type: 'mark-unread', payload: { entryId } });
      console.error('Failed to mark as unread:', error);
    }
  },

  // Toggle bookmark (optimistic + offline queue)
  toggleBookmark: async (entryId: number) => {
    // Optimistic UI update always
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === entryId ? { ...e, starred: !e.starred } : e
      ),
      selectedEntry:
        state.selectedEntry?.id === entryId
          ? { ...state.selectedEntry, starred: !state.selectedEntry.starred }
          : state.selectedEntry,
    }));

    if (!navigator.onLine) {
      enqueue({ id: `bookmark-${entryId}`, type: 'toggle-bookmark', payload: { entryId } });
      return;
    }

    try {
      await api.toggleBookmark(entryId);
      markApiSuccess();
    } catch (error) {
      enqueue({ id: `bookmark-${entryId}`, type: 'toggle-bookmark', payload: { entryId } });
      console.error('Failed to toggle bookmark:', error);
    }
  },

  // Mark all current entries as read
  markAllAsRead: async () => {
    const { entries } = get();
    const unreadIds = entries.filter((e) => e.status === 'unread').map((e) => e.id);

    if (unreadIds.length === 0) return;

    try {
      await api.updateEntries({
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
