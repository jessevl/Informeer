/**
 * Miniflux API Client
 * Handles all communication with the Miniflux server
 * Uses HTTP Basic Authentication with username/password
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
  UpdateEntryRequest,
} from '@/types/miniflux';

class MinifluxClient {
  private baseUrl: string;
  private username: string | null = null;
  private password: string | null = null;

  constructor() {
    // Use proxy in development, direct URL in production
    this.baseUrl = '/api';
  }

  /**
   * Set authentication credentials (username/password for HTTP Basic Auth)
   */
  setCredentials(serverUrl: string, username: string, password: string) {
    this.baseUrl = serverUrl.replace(/\/$/, '') + '/v1';
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
    this.baseUrl = '/api';
  }

  /**
   * Get Basic Auth header value
   */
  private getAuthHeader(): string {
    if (!this.username || !this.password) {
      throw new Error('Not authenticated');
    }
    return 'Basic ' + btoa(`${this.username}:${this.password}`);
  }

  /**
   * Make authenticated request to Miniflux API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const url = `${this.baseUrl}${endpoint}`;
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

  async createFeed(data: CreateFeedRequest): Promise<Feed> {
    return this.request<Feed>('/feeds', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFeed(id: number, data: Partial<Feed>): Promise<Feed> {
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

    const url = `${this.baseUrl}/export`;
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

    const url = `${this.baseUrl}/import`;
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
}

// Export singleton instance
export const miniflux = new MinifluxClient();
export default miniflux;
