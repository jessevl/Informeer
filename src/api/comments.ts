/**
 * Comments API
 * Unified API for fetching comments from Hacker News and Reddit
 */

// ==================== Hacker News API (via Algolia) ====================

export interface HNItem {
  id: number;
  type: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time: number;
  text?: string;
  kids?: number[];
  parent?: number;
  url?: string;
  title?: string;
  score?: number;
  descendants?: number;
  deleted?: boolean;
  dead?: boolean;
}

export interface HNComment {
  id: number;
  by: string;
  time: number;
  text: string;
  kids?: number[];
  parent: number;
  children?: HNComment[];
  depth: number;
}

// Algolia API response types
interface AlgoliaHNItem {
  id: number;
  created_at: string;
  author: string | null;
  title?: string;
  url?: string;
  text: string | null;
  points?: number;
  parent_id: number | null;
  children: AlgoliaHNItem[];
}

/**
 * Extract HN item ID from URL
 */
export function extractHNItemId(url: string): number | null {
  const match = url.match(/news\.ycombinator\.com\/item\?id=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Check if URL is a Hacker News URL
 */
export function isHackerNewsUrl(url: string): boolean {
  return url.includes('news.ycombinator.com');
}

/**
 * Check if a feed URL is from hnrss.org
 */
export function isHNRSSFeed(feedUrl: string): boolean {
  return feedUrl.includes('hnrss.org');
}

/**
 * Extract HN item ID from comments_url field
 */
export function extractHNItemIdFromCommentsUrl(commentsUrl: string): number | null {
  if (!commentsUrl) return null;
  return extractHNItemId(commentsUrl);
}

/** Convert Algolia item to HNComment recursively */
const convertAlgoliaToComment = (item: AlgoliaHNItem, depth = 0): HNComment => ({
  id: item.id,
  by: item.author || '[deleted]',
  time: Math.floor(new Date(item.created_at).getTime() / 1000),
  text: item.text || '',
  parent: item.parent_id || 0,
  depth,
  children: item.children?.length 
    ? item.children.map(child => convertAlgoliaToComment(child, depth + 1))
    : undefined,
});

/** Fetch all comments for an HN story - single request via Algolia API */
export async function fetchHNComments(storyId: number): Promise<{
  story: HNItem | null;
  comments: HNComment[];
}> {
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/items/${storyId}`);
    if (!res.ok) return { story: null, comments: [] };
    
    const data: AlgoliaHNItem = await res.json();
    
    // Convert to our HNItem format
    const story: HNItem = {
      id: data.id,
      type: 'story',
      by: data.author || undefined,
      time: Math.floor(new Date(data.created_at).getTime() / 1000),
      title: data.title,
      url: data.url,
      text: data.text || undefined,
      score: data.points,
      descendants: countDescendants(data.children),
    };
    
    // Convert children to comments
    const comments = data.children
      ?.filter(child => child.author) // Filter out deleted
      .map(child => convertAlgoliaToComment(child, 0)) || [];
    
    return { story, comments };
  } catch (error) {
    console.error('Failed to fetch HN comments:', error);
    return { story: null, comments: [] };
  }
}

/** Count total descendants recursively */
const countDescendants = (children: AlgoliaHNItem[]): number => {
  if (!children?.length) return 0;
  return children.reduce((acc, child) => acc + 1 + countDescendants(child.children), 0);
};

// ==================== Reddit API ====================

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  body_html: string;
  created_utc: number;
  score: number;
  replies?: RedditComment[];
  depth: number;
  is_submitter: boolean;
  distinguished?: string;
  stickied?: boolean;
  permalink: string;
}

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  selftext?: string;
  selftext_html?: string;
  url: string;
  permalink: string;
  score: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  subreddit_name_prefixed: string;
}

/**
 * Extract Reddit post info from URL
 */
export function extractRedditInfo(url: string): { subreddit: string; postId: string } | null {
  const match = url.match(/reddit\.com\/r\/([^\/]+)\/comments\/([^\/]+)/);
  if (match) {
    return { subreddit: match[1], postId: match[2] };
  }
  return null;
}

/**
 * Check if URL is a Reddit URL
 */
export function isRedditUrl(url: string): boolean {
  return url.includes('reddit.com/r/');
}

/**
 * Check if a feed URL is a Reddit RSS feed
 */
export function isRedditRSSFeed(feedUrl: string): boolean {
  return feedUrl.includes('reddit.com/r/') && feedUrl.includes('.rss');
}

/**
 * Parse Reddit API comment response recursively
 */
function parseRedditComments(listing: any, depth: number = 0): RedditComment[] {
  if (!listing || !listing.data || !listing.data.children) return [];
  
  const comments: RedditComment[] = [];
  
  for (const child of listing.data.children) {
    if (child.kind !== 't1') continue;
    
    const data = child.data;
    const comment: RedditComment = {
      id: data.id,
      author: data.author || '[deleted]',
      body: data.body || '',
      body_html: data.body_html || '',
      created_utc: data.created_utc,
      score: data.score || 0,
      depth,
      is_submitter: data.is_submitter || false,
      distinguished: data.distinguished,
      stickied: data.stickied,
      permalink: `https://reddit.com${data.permalink}`,
    };
    
    if (data.replies && typeof data.replies === 'object') {
      comment.replies = parseRedditComments(data.replies, depth + 1);
    }
    
    comments.push(comment);
  }
  
  return comments;
}

/**
 * Fetch Reddit comments for a post
 */
export async function fetchRedditComments(subreddit: string, postId: string): Promise<{
  post: RedditPost | null;
  comments: RedditComment[];
}> {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?raw_json=1&limit=100`;
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`Reddit API error: ${response.status}`);
      return { post: null, comments: [] };
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data) || data.length < 2) {
      return { post: null, comments: [] };
    }
    
    const postData = data[0].data.children[0]?.data;
    const post: RedditPost | null = postData ? {
      id: postData.id,
      title: postData.title,
      author: postData.author || '[deleted]',
      selftext: postData.selftext,
      selftext_html: postData.selftext_html,
      url: postData.url,
      permalink: `https://reddit.com${postData.permalink}`,
      score: postData.score || 0,
      num_comments: postData.num_comments || 0,
      created_utc: postData.created_utc,
      subreddit: postData.subreddit,
      subreddit_name_prefixed: postData.subreddit_name_prefixed,
    } : null;
    
    const comments = parseRedditComments(data[1]);
    
    return { post, comments };
  } catch (error) {
    console.error('Failed to fetch Reddit comments:', error);
    return { post: null, comments: [] };
  }
}

// ==================== Search APIs ====================

export interface YouTubeChannel {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount?: string;
}

export interface SubredditInfo {
  name: string;
  title: string;
  description: string;
  subscribers: number;
  iconUrl?: string;
  over18: boolean;
}

/**
 * Search for Reddit subreddits by name
 */
export async function searchSubreddits(query: string): Promise<SubredditInfo[]> {
  try {
    const url = `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=10&raw_json=1`;
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`Reddit search error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.data?.children) return [];
    
    return data.data.children
      .filter((child: any) => child.kind === 't5')
      .map((child: any) => ({
        name: child.data.display_name,
        title: child.data.title || child.data.display_name,
        description: child.data.public_description || '',
        subscribers: child.data.subscribers || 0,
        iconUrl: child.data.icon_img || child.data.community_icon?.split('?')[0] || null,
        over18: child.data.over18 || false,
      }));
  } catch (error) {
    console.error('Failed to search subreddits:', error);
    return [];
  }
}

/**
 * Get the RSS feed URL for a subreddit
 */
export function getSubredditRSSUrl(subredditName: string, sort: 'hot' | 'new' | 'top' = 'hot'): string {
  return `https://www.reddit.com/r/${subredditName}/${sort}/.rss`;
}

/**
 * Get the RSS feed URL for a YouTube channel
 */
export function getYouTubeChannelRSSUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/**
 * Check if an entry has comments available from HN or Reddit
 */
export function hasCommentsAvailable(entry: { comments_url?: string; url?: string }): boolean {
  if (entry.comments_url) {
    if (isHackerNewsUrl(entry.comments_url)) {
      return !!extractHNItemIdFromCommentsUrl(entry.comments_url);
    }
    if (isRedditUrl(entry.comments_url)) {
      return !!extractRedditInfo(entry.comments_url);
    }
  }
  if (entry.url && isRedditUrl(entry.url)) {
    return !!extractRedditInfo(entry.url);
  }
  return false;
}

// List of Invidious instances to try
const INVIDIOUS_INSTANCES = [
  'https://vid.puffyan.us',
  'https://invidious.lunar.icu',
  'https://yt.artemislena.eu',
  'https://invidious.privacydev.net',
  'https://inv.tux.pizza',
];

/**
 * Search YouTube channels using Invidious API
 * Tries multiple instances for reliability
 */
export async function searchYouTubeChannels(query: string): Promise<YouTubeChannel[]> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=channel`;
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(5000) // 5 second timeout per instance
      });
      
      if (!response.ok) continue;
      
      const data = await response.json();
      const channels = parseInvidiousChannels(data);
      if (channels.length > 0) return channels;
    } catch (error) {
      console.warn(`Invidious instance ${instance} failed:`, error);
      continue;
    }
  }
  
  console.error('All Invidious instances failed for YouTube channel search');
  return [];
}

function parseInvidiousChannels(data: any[]): YouTubeChannel[] {
  return data
    .filter((item: any) => item.type === 'channel')
    .slice(0, 10)
    .map((item: any) => ({
      id: item.authorId,
      title: item.author,
      description: item.description || '',
      thumbnailUrl: item.authorThumbnails?.[0]?.url || '',
      subscriberCount: item.subCount ? formatSubscriberCount(item.subCount) : undefined,
    }));
}

function formatSubscriberCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}
