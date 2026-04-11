/**
 * Feeds Store
 * Manages feeds and categories state
 */

import { create } from 'zustand';
import { api } from '@/api/client';
import type { Feed, Category, FeedCounters, CreateFeedRequest, CreateFeedResponse } from '@/types/api';
import { useSettingsStore } from './settings';
import { markApiSuccess } from './connectivity';
import { markRefreshed } from '@/lib/focus-refresh';

interface FeedsState {
  // State
  feeds: Feed[];
  categories: Category[];
  counters: FeedCounters | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchFeeds: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchCounters: () => Promise<void>;
  createFeed: (data: CreateFeedRequest) => Promise<CreateFeedResponse>;
  updateFeed: (id: number, data: Partial<Feed> & { category_id?: number }) => Promise<void>;
  deleteFeed: (id: number) => Promise<void>;
  refreshFeed: (feedId: number) => Promise<void>;
  refreshAllFeeds: () => Promise<void>;
  markFeedAsRead: (feedId: number) => Promise<void>;
  markCategoryAsRead: (categoryId: number) => Promise<void>;
  createCategory: (title: string) => Promise<Category>;
  updateCategory: (id: number, data: { title?: string; hide_globally?: boolean }) => Promise<void>;
  deleteCategory: (id: number) => Promise<void>;
}

export const useFeedsStore = create<FeedsState>((set, get) => ({
  // Initial state
  feeds: [],
  categories: [],
  counters: null,
  isLoading: false,
  error: null,

  // Fetch all feeds
  fetchFeeds: async () => {
    // Offline: keep whatever feeds we have, don't set error
    if (!navigator.onLine) return;

    // Only show spinner if we have no data yet
    if (get().feeds.length === 0) {
      set({ isLoading: true, error: null });
    }

    try {
      const feeds = await api.getFeeds();
      set({ feeds, isLoading: false });
      markRefreshed('feeds');
      markApiSuccess();
    } catch (error) {
      // If feeds already populated, keep them silently
      if (get().feeds.length > 0) {
        set({ isLoading: false });
        return;
      }
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unable to load feeds. Check your connection.',
      });
    }
  },

  // Fetch all categories
  fetchCategories: async () => {
    if (!navigator.onLine && get().categories.length > 0) return;

    try {
      const categories = await api.getCategories();
      set({ categories });
      markApiSuccess();

      // Auto-populate media category IDs from system categories
      const settings = useSettingsStore.getState();
      const audio = categories.find(c => c.is_system && c.title === 'Audio');
      const video = categories.find(c => c.is_system && c.title === 'Video');
      const magazines = categories.find(c => c.is_system && c.title === 'Magazines');
      if (audio) settings.setAudioCategoryId(audio.id);
      if (video) settings.setVideoCategoryId(video.id);
      if (magazines) settings.setMagazinesCategoryId(magazines.id);
    } catch (error) {
      // If categories already populated, keep them silently
      if (get().categories.length > 0) return;
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch categories',
      });
    }
  },

  // Fetch feed counters (unread counts)
  fetchCounters: async () => {
    if (!navigator.onLine) return;

    try {
      const counters = await api.getFeedCounters();
      set({ counters });
      markRefreshed('counters');
      markApiSuccess();
    } catch (error) {
      console.error('Failed to fetch counters:', error);
    }
  },

  // Refresh a single feed
  refreshFeed: async (feedId: number) => {
    try {
      await api.refreshFeed(feedId);
      // Re-fetch counters after refresh
      await get().fetchCounters();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to refresh feed',
      });
    }
  },

  // Refresh all feeds
  refreshAllFeeds: async () => {
    set({ isLoading: true });
    try {
      await api.refreshAllFeeds();
      // Re-fetch counters after refresh
      await get().fetchCounters();
      set({ isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to refresh feeds',
      });
    }
  },

  // Mark all entries in a feed as read
  markFeedAsRead: async (feedId: number) => {
    const { confirmMarkAllRead } = await import('@/stores/settings').then(m => m.useSettingsStore.getState());
    if (confirmMarkAllRead && !confirm('Mark all entries in this feed as read?')) return;
    try {
      await api.markFeedAsRead(feedId);
      // Update counters
      const { counters } = get();
      if (counters) {
        const newCounters = { ...counters };
        if (newCounters.unreads[feedId]) {
          newCounters.reads[feedId] = (newCounters.reads[feedId] || 0) + newCounters.unreads[feedId];
          newCounters.unreads[feedId] = 0;
        }
        set({ counters: newCounters });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to mark feed as read',
      });
    }
  },

  // Mark all entries in a category as read
  markCategoryAsRead: async (categoryId: number) => {
    const { confirmMarkAllRead } = await import('@/stores/settings').then(m => m.useSettingsStore.getState());
    if (confirmMarkAllRead && !confirm('Mark all entries in this category as read?')) return;
    try {
      await api.markCategoryAsRead(categoryId);
      // Re-fetch counters to get updated state
      await get().fetchCounters();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to mark category as read',
      });
    }
  },

  // Create a new feed
  createFeed: async (data: CreateFeedRequest) => {
    const feed = await api.createFeed(data);
    // Refresh feeds list
    await get().fetchFeeds();
    await get().fetchCounters();
    return feed;
  },

  // Update an existing feed
  updateFeed: async (id: number, data: Partial<Feed> & { category_id?: number }) => {
    try {
      await api.updateFeed(id, data);
      // Refresh feeds list
      await get().fetchFeeds();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update feed',
      });
      throw error;
    }
  },

  // Delete a feed
  deleteFeed: async (id: number) => {
    try {
      await api.deleteFeed(id);
      // Remove from local state
      set({ feeds: get().feeds.filter(f => f.id !== id) });
      await get().fetchCounters();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete feed',
      });
      throw error;
    }
  },

  // Create a new category
  createCategory: async (title: string) => {
    const category = await api.createCategory(title);
    // Refresh categories list
    await get().fetchCategories();
    return category;
  },

  // Update an existing category
  updateCategory: async (id: number, data: { title?: string; hide_globally?: boolean }) => {
    try {
      await api.updateCategory(id, data);
      // Refresh categories and feeds list (feeds have category embedded)
      await Promise.all([get().fetchCategories(), get().fetchFeeds()]);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update category',
      });
      throw error;
    }
  },

  // Delete a category
  deleteCategory: async (id: number) => {
    try {
      await api.deleteCategory(id);
      // Refresh categories list
      await get().fetchCategories();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete category',
      });
      throw error;
    }
  },
}));
