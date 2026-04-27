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

type ClientFilterSnapshot = Pick<EntriesState, 'feedId' | 'categoryId' | 'mediaType'>;

function applyClientSideFilters(entries: Entry[], filter: ClientFilterSnapshot): Entry[] {
  const { magazinesCategoryId } = useSettingsStore.getState();
  const { feeds, categories } = useFeedsStore.getState();

  const hiddenFeedIds = new Set(feeds.filter((feed) => feed.hide_globally).map((feed) => feed.id));
  const hiddenCategoryIds = new Set(categories.filter((category) => category.hide_globally).map((category) => category.id));

  let filtered = entries;

  if (filter.feedId === null && filter.categoryId === null) {
    filtered = filtered.filter((entry) => {
      if (entry.feed_id && hiddenFeedIds.has(entry.feed_id)) {
        return false;
      }

      if (entry.feed?.category?.id && hiddenCategoryIds.has(entry.feed.category.id)) {
        return false;
      }

      return true;
    });

    if (filter.mediaType === 'all' && magazinesCategoryId !== null) {
      filtered = filtered.filter((entry) => entry.feed?.category?.id !== magazinesCategoryId);
    }
  }

  if (filter.mediaType === 'audio') filtered = filtered.filter(isAudioEntry);
  if (filter.mediaType === 'video') filtered = filtered.filter(isVideoEntry);

  return filtered;
}

function usesClientSideFilteredPagination(filter: ClientFilterSnapshot): boolean {
  return filter.mediaType === 'audio' || filter.mediaType === 'video' || (filter.feedId === null && filter.categoryId === null);
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
  entriesCache: Record<string, {
    entries: Entry[];
    total: number;
    offset: number;
    hasMore: boolean;
  }>;

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
  entriesCache: {},
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

    return applyClientSideFilters(entries, { mediaType, feedId, categoryId });
  },

  // Fetch entries with current filters
  fetchEntries: async (reset = true) => {
    const requestId = ++latestEntriesRequestId;
    const { status, feedId, categoryId, starred, searchQuery, limit, mediaType } = get();
    const filterSnapshot: ClientFilterSnapshot = { feedId, categoryId, mediaType };
    const filterKey = buildFilterKey({ status, feedId, categoryId, starred, searchQuery, mediaType });

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
      const baseParams: EntryQueryParams = {
        limit: effectiveLimit,
        order: 'published_at',
        direction: 'desc',
      };

      if (status !== 'all') {
        baseParams.status = status;
      }
      if (starred) {
        baseParams.starred = true;
      }
      if (searchQuery) {
        baseParams.search = searchQuery;
      }
      if (categoryId) {
        baseParams.category_id = categoryId;
      }

      const fetchPage = async (pageOffset: number) => {
        const params: EntryQueryParams = { ...baseParams, offset: pageOffset };

        if (feedId) {
          return api.getFeedEntries(feedId, params);
        }
        if (categoryId) {
          return api.getCategoryEntries(categoryId, params);
        }
        return api.getEntries(params);
      };

      let accumulatedEntries: Entry[] = [];
      let total = 0;
      let nextOffset = 0;

      while (true) {
        const response = await fetchPage(nextOffset);

        if (requestId !== latestEntriesRequestId) {
          return;
        }

        accumulatedEntries = [...accumulatedEntries, ...response.entries];
        total = response.total;
        nextOffset += response.entries.length;

        const visibleEntries = applyClientSideFilters(accumulatedEntries, filterSnapshot);
        const shouldContinue = usesClientSideFilteredPagination(filterSnapshot)
          && response.entries.length > 0
          && nextOffset < total
          && visibleEntries.length < limit;

        if (!shouldContinue) {
          break;
        }
      }

      set((state) => ({
        entries: accumulatedEntries,
        total,
        offset: nextOffset,
        hasMore: nextOffset < total,
        isLoading: false,
        isRefetching: false,
        entriesCache: {
          ...state.entriesCache,
          [filterKey]: {
            entries: accumulatedEntries,
            total,
            offset: nextOffset,
            hasMore: nextOffset < total,
          },
        },
      }));
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
    const { status, feedId, categoryId, starred, searchQuery, limit, offset, hasMore, isLoadingMore, mediaType, entries } = get();
    const filterSnapshot: ClientFilterSnapshot = { feedId, categoryId, mediaType };
    const filterKey = buildFilterKey({ status, feedId, categoryId, starred, searchQuery, mediaType });

    if (!hasMore || isLoadingMore) return;

    const requestId = ++latestEntriesRequestId;

    set({ isLoadingMore: true });

    try {
      // Use higher limit for media types since they're filtered client-side
      const effectiveLimit = (mediaType === 'audio' || mediaType === 'video' || mediaType === 'magazines') ? 500 : limit;
      const baseParams: EntryQueryParams = {
        limit: effectiveLimit,
        order: 'published_at',
        direction: 'desc',
      };

      if (status !== 'all') {
        baseParams.status = status;
      }
      if (starred) {
        baseParams.starred = true;
      }
      if (searchQuery) {
        baseParams.search = searchQuery;
      }
      if (categoryId) {
        baseParams.category_id = categoryId;
      }

      const fetchPage = async (pageOffset: number) => {
        const params: EntryQueryParams = { ...baseParams, offset: pageOffset };

        if (feedId) {
          return api.getFeedEntries(feedId, params);
        }
        if (categoryId) {
          return api.getCategoryEntries(categoryId, params);
        }
        return api.getEntries(params);
      };

      const visibleBeforeCount = applyClientSideFilters(entries, filterSnapshot).length;
      let accumulatedEntries: Entry[] = [];
      let total = offset;
      let nextOffset = offset;

      while (true) {
        const response = await fetchPage(nextOffset);

        if (requestId !== latestEntriesRequestId) {
          return;
        }

        accumulatedEntries = [...accumulatedEntries, ...response.entries];
        total = response.total;
        nextOffset += response.entries.length;

        const visibleAfterCount = applyClientSideFilters([...entries, ...accumulatedEntries], filterSnapshot).length;
        const gainedVisibleEntries = visibleAfterCount > visibleBeforeCount;
        const shouldContinue = usesClientSideFilteredPagination(filterSnapshot)
          && response.entries.length > 0
          && nextOffset < total
          && !gainedVisibleEntries;

        if (!shouldContinue) {
          break;
        }
      }

      set((state) => {
        const nextEntries = [...state.entries, ...accumulatedEntries];
        return {
          entries: nextEntries,
          offset: nextOffset,
          hasMore: nextOffset < total,
          isLoadingMore: false,
          entriesCache: {
            ...state.entriesCache,
            [filterKey]: {
              entries: nextEntries,
              total,
              offset: nextOffset,
              hasMore: nextOffset < total,
            },
          },
        };
      });
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
    const nextFilterKey = buildFilterKey(nextFilter);
    const cachedScope = current.entriesCache[nextFilterKey];

    if (isScopeChange) {
      latestEntriesRequestId += 1;
      set({
        ...nextFilter,
        entries: cachedScope?.entries ?? [],
        total: cachedScope?.total ?? 0,
        offset: cachedScope?.offset ?? 0,
        hasMore: cachedScope?.hasMore ?? false,
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
