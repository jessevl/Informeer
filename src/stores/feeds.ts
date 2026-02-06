/**
 * Feeds Store
 * Manages feeds and categories state
 */

import { create } from 'zustand';
import { miniflux } from '@/api/miniflux';
import type { Feed, Category, FeedCounters, CreateFeedRequest } from '@/types/miniflux';

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
  createFeed: (data: CreateFeedRequest) => Promise<Feed>;
  updateFeed: (id: number, data: Partial<Feed>) => Promise<void>;
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
    set({ isLoading: true, error: null });

    try {
      const feeds = await miniflux.getFeeds();
      set({ feeds, isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch feeds',
      });
    }
  },

  // Fetch all categories
  fetchCategories: async () => {
    try {
      const categories = await miniflux.getCategories();
      set({ categories });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch categories',
      });
    }
  },

  // Fetch feed counters (unread counts)
  fetchCounters: async () => {
    try {
      const counters = await miniflux.getFeedCounters();
      set({ counters });
    } catch (error) {
      console.error('Failed to fetch counters:', error);
    }
  },

  // Refresh a single feed
  refreshFeed: async (feedId: number) => {
    try {
      await miniflux.refreshFeed(feedId);
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
      await miniflux.refreshAllFeeds();
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
    try {
      await miniflux.markFeedAsRead(feedId);
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
    try {
      await miniflux.markCategoryAsRead(categoryId);
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
    const feed = await miniflux.createFeed(data);
    // Refresh feeds list
    await get().fetchFeeds();
    await get().fetchCounters();
    return feed;
  },

  // Update an existing feed
  updateFeed: async (id: number, data: Partial<Feed>) => {
    try {
      await miniflux.updateFeed(id, data);
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
      await miniflux.deleteFeed(id);
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
    const category = await miniflux.createCategory(title);
    // Refresh categories list
    await get().fetchCategories();
    return category;
  },

  // Update an existing category
  updateCategory: async (id: number, data: { title?: string; hide_globally?: boolean }) => {
    try {
      await miniflux.updateCategory(id, data);
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
      await miniflux.deleteCategory(id);
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
