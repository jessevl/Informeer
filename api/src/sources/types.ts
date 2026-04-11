/** Content source types — the unified abstraction for RSS feeds and scrapers */

export interface NewEntry {
  hash: string;
  title: string;
  url: string;
  author: string;
  content: string;
  published_at: string;
  image_url?: string;
  enclosures: Array<{
    url: string;
    mime_type: string;
    size: number;
  }>;
  comments_url?: string;
  tags?: string[];
}

export interface FetchResult {
  entries: NewEntry[];
  etag?: string;
  lastModified?: string;
}

export interface Feed {
  id: number;
  user_id: number;
  category_id: number;
  source_type: string;
  source_config: string;
  feed_url: string;
  site_url: string;
  title: string;
  etag_header: string;
  last_modified_header: string;
  user_agent: string;
  cookie: string;
  username: string;
  password: string;
  crawler: number;
  scraper_rules: string;
  rewrite_rules: string;
  blocklist_rules: string;
  keeplist_rules: string;
  ignore_http_cache: number;
}

export interface ContentSource {
  readonly type: string;
  fetch(feed: Feed, signal: AbortSignal): Promise<FetchResult>;
}
