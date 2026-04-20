/**
 * Informeer API Client
 * Handles all communication with the Informeer backend
 * Uses HTTP Basic Authentication with username/password.
 * API base can be same-origin or a user-configured backend endpoint.
 */

import type {
  User,
  Category,
  Feed,
  Entry,
  Icon,
  FeedCounters,
  EntriesResponse,
  EntryQueryParams,
  CreateFeedRequest,
  CreateFeedResponse,
  UpdateEntryRequest,
} from '@/types/api';
import { buildApiUrl, buildBackendUrl } from './base-url';

class ApiClient {
  private username: string | null = null;
  private password: string | null = null;

  /**
   * Set authentication credentials (username/password for HTTP Basic Auth)
   */
  setCredentials(username: string, password: string) {
    this.username = username;
    this.password = password;
  }

  /**
   * Check if client is authenticated
   */
  isAuthenticated(): boolean {
    return this.username !== null && this.password !== null;
  }

  /**
   * Clear credentials
   */
  clearCredentials() {
    this.username = null;
    this.password = null;
  }

  /**
   * Get Basic Auth header value
   */
  getAuthHeader(): string {
    if (!this.username || !this.password) {
      throw new Error('Not authenticated');
    }
    return 'Basic ' + btoa(`${this.username}:${this.password}`);
  }

  /**
   * Make authenticated request to the API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const url = buildApiUrl(endpoint);
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': this.getAuthHeader(),
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error ${response.status}: ${error}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) return {} as T;
    
    return JSON.parse(text);
  }

  // ==================== User ====================

  async getCurrentUser(): Promise<User> {
    return this.request<User>('/me');
  }

  // ==================== Categories ====================

  async getCategories(): Promise<Category[]> {
    return this.request<Category[]>('/categories');
  }

  async createCategory(title: string): Promise<Category> {
    return this.request<Category>('/categories', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }

  async updateCategory(id: number, data: { title?: string; hide_globally?: boolean }): Promise<Category> {
    return this.request<Category>(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCategory(id: number): Promise<void> {
    await this.request<void>(`/categories/${id}`, {
      method: 'DELETE',
    });
  }

  async markCategoryAsRead(id: number): Promise<void> {
    await this.request<void>(`/categories/${id}/mark-all-as-read`, {
      method: 'PUT',
    });
  }

  // ==================== Feeds ====================

  async getFeeds(): Promise<Feed[]> {
    return this.request<Feed[]>('/feeds');
  }

  async getFeed(id: number): Promise<Feed> {
    return this.request<Feed>(`/feeds/${id}`);
  }

  async createFeed(data: CreateFeedRequest): Promise<CreateFeedResponse> {
    return this.request<CreateFeedResponse>('/feeds', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFeed(id: number, data: Partial<Feed> & { category_id?: number }): Promise<Feed> {
    return this.request<Feed>(`/feeds/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteFeed(id: number): Promise<void> {
    await this.request<void>(`/feeds/${id}`, {
      method: 'DELETE',
    });
  }

  async refreshFeed(id: number): Promise<void> {
    await this.request<void>(`/feeds/${id}/refresh`, {
      method: 'PUT',
    });
  }

  async refreshAllFeeds(): Promise<void> {
    await this.request<void>('/feeds/refresh', {
      method: 'PUT',
    });
  }

  async getFeedCounters(): Promise<FeedCounters> {
    return this.request<FeedCounters>('/feeds/counters');
  }

  async markFeedAsRead(id: number): Promise<void> {
    await this.request<void>(`/feeds/${id}/mark-all-as-read`, {
      method: 'PUT',
    });
  }

  async discoverFeeds(url: string): Promise<{ url: string; title: string; type: string }[]> {
    return this.request<{ url: string; title: string; type: string }[]>('/discover', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  // ==================== Feed Icons ====================

  async getFeedIcon(feedId: number): Promise<Icon> {
    return this.request<Icon>(`/feeds/${feedId}/icon`);
  }

  async getIcon(iconId: number): Promise<Icon> {
    return this.request<Icon>(`/icons/${iconId}`);
  }

  // ==================== Entries ====================

  async getEntries(params: EntryQueryParams = {}): Promise<EntriesResponse> {
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    const query = searchParams.toString();
    const endpoint = query ? `/entries?${query}` : '/entries';
    
    return this.request<EntriesResponse>(endpoint);
  }

  async getFeedEntries(
    feedId: number,
    params: EntryQueryParams = {}
  ): Promise<EntriesResponse> {
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    const query = searchParams.toString();
    const endpoint = query 
      ? `/feeds/${feedId}/entries?${query}` 
      : `/feeds/${feedId}/entries`;
    
    return this.request<EntriesResponse>(endpoint);
  }

  async getCategoryEntries(
    categoryId: number,
    params: EntryQueryParams = {}
  ): Promise<EntriesResponse> {
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    const query = searchParams.toString();
    const endpoint = query 
      ? `/categories/${categoryId}/entries?${query}` 
      : `/categories/${categoryId}/entries`;
    
    return this.request<EntriesResponse>(endpoint);
  }

  async getEntry(id: number): Promise<Entry> {
    return this.request<Entry>(`/entries/${id}`);
  }

  async updateEntries(data: UpdateEntryRequest): Promise<void> {
    await this.request<void>('/entries', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async toggleBookmark(id: number): Promise<void> {
    await this.request<void>(`/entries/${id}/bookmark`, {
      method: 'PUT',
    });
  }

  async fetchOriginalContent(id: number): Promise<Entry> {
    return this.request<Entry>(`/entries/${id}/fetch-content`, {
      method: 'GET',
    });
  }

  async saveEntry(id: number): Promise<void> {
    await this.request<void>(`/entries/${id}/save`, {
      method: 'POST',
    });
  }

  // ==================== Enclosures ====================

  async updateEnclosureProgress(
    enclosureId: number,
    mediaProgression: number
  ): Promise<void> {
    await this.request<void>(`/enclosures/${enclosureId}`, {
      method: 'PUT',
      body: JSON.stringify({ media_progression: mediaProgression }),
    });
  }

  // ==================== OPML Import/Export ====================

  /**
   * Export all feeds as OPML file
   * Returns XML string containing all subscriptions
   */
  async exportOPML(): Promise<string> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const url = buildApiUrl('/export');
    const response = await fetch(url, {
      headers: {
        'Authorization': this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error ${response.status}: ${error}`);
    }

    return response.text();
  }

  /**
   * Import feeds from OPML file
   * Accepts XML string with OPML content
   */
  async importOPML(opmlContent: string): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const url = buildApiUrl('/import');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Authorization': this.getAuthHeader(),
      },
      body: opmlContent,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error ${response.status}: ${error}`);
    }
  }

  // ==================== Settings ====================

  async getSettings(): Promise<Record<string, any>> {
    return this.request<Record<string, any>>('/settings');
  }

  async updateSettings(data: Record<string, unknown>): Promise<Record<string, any>> {
    return this.request<Record<string, any>>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getStats(): Promise<{
    database: { size_bytes: number; entry_count: number; feed_count: number };
    cache: { covers_bytes: number; pdfs_bytes: number; total_bytes: number };
  }> {
    return this.request('/settings/stats');
  }

  async clearCache(): Promise<{ deleted: number }> {
    return this.request<{ deleted: number }>('/settings/cache/clear', { method: 'POST' });
  }

  async runCleanup(): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/settings/cleanup', { method: 'POST' });
  }

  async cleanupOlderThan(days: number): Promise<{ deleted: number }> {
    return this.request<{ deleted: number }>('/settings/cleanup/older-than', {
      method: 'POST',
      body: JSON.stringify({ days }),
    });
  }

  // ==================== Health / Modules ====================

  /**
   * Fetch health endpoint (public, no auth required)
   * Returns module status and system info
   */
  async getHealth(): Promise<HealthResponse> {
    const response = await fetch(buildBackendUrl('/health'));
    if (!response.ok) throw new Error('Failed to fetch health');
    return response.json();
  }

  // ==================== MagazineLib ====================

  async searchMagazines(query: string, page = 1): Promise<MagazineSearchResult> {
    return this.request<MagazineSearchResult>(
      `/magazinelib/search?q=${encodeURIComponent(query)}&page=${page}`
    );
  }

  async subscribeMagazine(data: {
    query: string;
    title?: string;
    category_id?: number;
  }): Promise<{ feed_id: number }> {
    return this.request<{ feed_id: number }>('/magazinelib/subscribe', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async retryMagazineDownload(entryId: number): Promise<void> {
    await this.request<{ ok: boolean }>(`/magazinelib/retry/${entryId}`, {
      method: 'PUT',
    });
  }

  // ==================== Search (server-proxied) ====================

  async searchYouTubeChannels(query: string): Promise<YouTubeChannelResult[]> {
    const data = await this.request<{ results: YouTubeChannelResult[] }>(
      `/search/youtube?q=${encodeURIComponent(query)}`
    );
    return data.results;
  }

  async searchSubreddits(query: string): Promise<SubredditResult[]> {
    const data = await this.request<{ results: SubredditResult[] }>(
      `/search/reddit?q=${encodeURIComponent(query)}`
    );
    return data.results;
  }

  async searchPodcasts(query: string): Promise<PodcastResult[]> {
    const data = await this.request<{ results: PodcastResult[] }>(
      `/search/podcasts?q=${encodeURIComponent(query)}`
    );
    return data.results;
  }

  // ==================== Books ====================

  async getBooks(params: { search?: string; limit?: number; offset?: number } = {}): Promise<import('@/types/api').BooksResponse> {
    const searchParams = new URLSearchParams();
    if (params.search) searchParams.append('search', params.search);
    if (params.limit) searchParams.append('limit', String(params.limit));
    if (params.offset) searchParams.append('offset', String(params.offset));
    const query = searchParams.toString();
    return this.request(query ? `/books?${query}` : '/books');
  }

  async getBook(id: number): Promise<import('@/types/api').Book> {
    return this.request(`/books/${id}`);
  }

  async uploadBook(file: File): Promise<import('@/types/api').Book> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated');
    const formData = new FormData();
    formData.append('file', file);
    const url = buildApiUrl('/books');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': this.getAuthHeader() },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error ${response.status}: ${error}`);
    }
    return response.json();
  }

  async deleteBook(id: number): Promise<void> {
    await this.request<{ ok: boolean }>(`/books/${id}`, { method: 'DELETE' });
  }

  async updateBook(id: number, data: { title?: string; author?: string }): Promise<import('@/types/api').Book> {
    return this.request(`/books/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  getBookFileUrl(id: number): string {
    return buildApiUrl(`/books/${id}/file`);
  }

  getBookCoverUrl(id: number): string {
    return buildApiUrl(`/books/${id}/cover`);
  }

  async getBookProgress(id: number): Promise<import('@/types/api').BookProgress> {
    return this.request(`/books/${id}/progress`);
  }

  async updateBookProgress(id: number, data: { cfi?: string; percentage?: number; chapter?: string }): Promise<void> {
    await this.request(`/books/${id}/progress`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getBookHighlights(id: number): Promise<import('@/types/api').BookHighlight[]> {
    return this.request(`/books/${id}/highlights`);
  }

  async createBookHighlight(bookId: number, data: { cfi_range: string; text: string; note?: string; color?: string }): Promise<import('@/types/api').BookHighlight> {
    return this.request(`/books/${bookId}/highlights`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBookHighlight(bookId: number, highlightId: number, data: { note?: string; color?: string }): Promise<import('@/types/api').BookHighlight> {
    return this.request(`/books/${bookId}/highlights/${highlightId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteBookHighlight(bookId: number, highlightId: number): Promise<void> {
    await this.request(`/books/${bookId}/highlights/${highlightId}`, { method: 'DELETE' });
  }

  // ==================== Z-Library ====================

  async searchZLib(query: string, page = 1): Promise<import('@/types/api').ZLibSearchResponse> {
    return this.request(`/books/zlib/search?q=${encodeURIComponent(query)}&page=${page}`);
  }

  async downloadFromZLib(data: { bookId: string; downloadUrl: string; title?: string; author?: string; coverUrl?: string }): Promise<import('@/types/api').Book> {
    return this.request('/books/zlib/download', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getZLibStatus(): Promise<import('@/types/api').ZLibDownloadStatus> {
    return this.request('/books/zlib/status');
  }

  async getZLibMirrors(): Promise<{ mirrors: string[] }> {
    return this.request('/books/zlib/mirrors');
  }

  getZLibCoverProxyUrl(coverUrl: string): string {
    return buildBackendUrl(`/cover-proxy?url=${encodeURIComponent(coverUrl)}`);
  }
}

export interface HealthResponse {
  status: string;
  version: string;
  modules: {
    nrc: { enabled: boolean };
    magazinelib: { enabled: boolean };
    books: { enabled: boolean; zlib_enabled: boolean };
  };
  scheduler: { running: boolean; feeds: number; erroring: number };
  database: { entries: number; size_mb: number };
  cache: { pdfs: number; covers: number; size_mb: number };
}

/** Matches the backend MagazineSearchResult shape from sources/magazinelib.ts */
export interface MagazineSearchResult {
  issues: Array<{
    id: string;
    title: string;
    sourceUrl: string;
    coverUrl: string;
    description: string;
    seriesName: string;
    categories: string[];
    pubDate: string;
  }>;
  page: number;
  hasMore: boolean;
}

export interface YouTubeChannelResult {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount?: string;
}

export interface SubredditResult {
  name: string;
  title: string;
  description: string;
  subscribers: number;
  iconUrl: string | null;
  over18: boolean;
}

export interface PodcastResult {
  id: number;
  title: string;
  author: string;
  feedUrl: string;
  artworkUrl: string;
  genres: string[];
  episodeCount: number;
}

// Export singleton instance
export const api = new ApiClient();
export default api;
