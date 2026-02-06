/**
 * Miniflux API Types
 * Based on https://miniflux.app/docs/api.html
 */

export interface User {
  id: number;
  username: string;
  is_admin: boolean;
  theme: string;
  language: string;
  timezone: string;
  entry_sorting_direction: 'asc' | 'desc';
  entry_sorting_order: 'published_at' | 'created_at' | 'category_title' | 'status';
  stylesheet: string;
  google_id: string;
  openid_connect_id: string;
  entries_per_page: number;
  keyboard_shortcuts: boolean;
  show_reading_time: boolean;
  entry_swipe: boolean;
  last_login_at: string | null;
}

export interface Category {
  id: number;
  title: string;
  user_id: number;
  hide_globally: boolean;
}

export interface Feed {
  id: number;
  user_id: number;
  feed_url: string;
  site_url: string;
  title: string;
  checked_at: string;
  next_check_at: string;
  etag_header: string;
  last_modified_header: string;
  parsing_error_message: string;
  parsing_error_count: number;
  scraper_rules: string;
  rewrite_rules: string;
  crawler: boolean;
  blocklist_rules: string;
  keeplist_rules: string;
  urlrewrite_rules: string;
  user_agent: string;
  cookie: string;
  username: string;
  password: string;
  disabled: boolean;
  no_media_player: boolean;
  ignore_http_cache: boolean;
  allow_self_signed_certificates: boolean;
  fetch_via_proxy: boolean;
  hide_globally: boolean;
  category: Category;
  icon?: FeedIcon;
}

export interface FeedIcon {
  feed_id: number;
  icon_id: number;
}

export interface Icon {
  id: number;
  data: string;
  mime_type: string;
}

export interface Entry {
  id: number;
  user_id: number;
  feed_id: number;
  status: 'unread' | 'read' | 'removed';
  hash: string;
  title: string;
  url: string;
  comments_url: string;
  published_at: string;
  created_at: string;
  changed_at: string;
  content: string;
  author: string;
  share_code: string;
  starred: boolean;
  reading_time: number;
  enclosures: Enclosure[] | null;
  feed?: Feed;
  tags: string[];
}

export interface Enclosure {
  id: number;
  user_id: number;
  entry_id: number;
  url: string;
  mime_type: string;
  size: number;
  media_progression: number;
}

export interface FeedCounters {
  reads: Record<number, number>;
  unreads: Record<number, number>;
}

export interface EntriesResponse {
  total: number;
  entries: Entry[];
}

export interface EntryQueryParams {
  status?: 'unread' | 'read' | 'removed';
  offset?: number;
  limit?: number;
  order?: 'id' | 'status' | 'published_at' | 'category_title' | 'category_id';
  direction?: 'asc' | 'desc';
  before?: number;
  after?: number;
  before_entry_id?: number;
  after_entry_id?: number;
  starred?: boolean;
  search?: string;
  category_id?: number;
}

export interface CreateFeedRequest {
  feed_url: string;
  category_id?: number;
  crawler?: boolean;
  user_agent?: string;
  username?: string;
  password?: string;
  scraper_rules?: string;
  rewrite_rules?: string;
  blocklist_rules?: string;
  keeplist_rules?: string;
}

export interface UpdateEntryRequest {
  entry_ids: number[];
  status: 'read' | 'unread';
}
