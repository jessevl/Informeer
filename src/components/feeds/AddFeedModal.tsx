/**
 * AddFeedModal Component
 * Modal for adding new RSS feeds with discovery support
 * Now supports YouTube channel and Reddit subreddit search
 */

import { useState, useEffect } from 'react';
import { X, Search, Rss, Loader2, Plus, Check, ChevronDown, Youtube, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { miniflux } from '@/api/miniflux';
import { useFeedsStore } from '@/stores/feeds';
import { 
  searchYouTubeChannels, 
  searchSubreddits, 
  getYouTubeChannelRSSUrl, 
  getSubredditRSSUrl,
  YouTubeChannel,
  SubredditInfo
} from '@/api/comments';
import type { Category } from '@/types/miniflux';

interface AddFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
}

interface DiscoveredFeed {
  url: string;
  title: string;
  type: string;
}

type FeedType = 'rss' | 'youtube' | 'reddit';

export function AddFeedModal({ isOpen, onClose, categories }: AddFeedModalProps) {
  const [feedType, setFeedType] = useState<FeedType>('rss');
  const [url, setUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [discoveredFeeds, setDiscoveredFeeds] = useState<DiscoveredFeed[]>([]);
  const [youtubeChannels, setYoutubeChannels] = useState<YouTubeChannel[]>([]);
  const [subreddits, setSubreddits] = useState<SubredditInfo[]>([]);
  const [selectedFeed, setSelectedFeed] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<YouTubeChannel | null>(null);
  const [selectedSubreddit, setSelectedSubreddit] = useState<SubredditInfo | null>(null);
  const [redditSort, setRedditSort] = useState<'hot' | 'new' | 'top'>('hot');
  const [error, setError] = useState<string | null>(null);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  
  const { createFeed } = useFeedsStore();

  // Reset state when modal opens or feed type changes
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setSearchQuery('');
      setSelectedCategory(categories[0]?.id || null);
      setDiscoveredFeeds([]);
      setYoutubeChannels([]);
      setSubreddits([]);
      setSelectedFeed(null);
      setSelectedChannel(null);
      setSelectedSubreddit(null);
      setError(null);
    }
  }, [isOpen, categories]);

  // Reset search results when changing feed type
  useEffect(() => {
    setSearchQuery('');
    setDiscoveredFeeds([]);
    setYoutubeChannels([]);
    setSubreddits([]);
    setSelectedFeed(null);
    setSelectedChannel(null);
    setSelectedSubreddit(null);
    setError(null);
  }, [feedType]);

  // Handle URL discovery for RSS
  const handleDiscover = async () => {
    if (!url.trim()) return;
    
    setIsDiscovering(true);
    setError(null);
    setDiscoveredFeeds([]);
    setSelectedFeed(null);
    
    try {
      const feeds = await miniflux.discoverFeeds(url);
      if (feeds.length === 0) {
        setError('No feeds found at this URL. Try a different URL or paste a direct feed link.');
      } else {
        setDiscoveredFeeds(feeds);
        setSelectedFeed(feeds[0].url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover feeds');
    } finally {
      setIsDiscovering(false);
    }
  };

  // Handle YouTube channel search
  const handleYouTubeSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setError(null);
    setYoutubeChannels([]);
    setSelectedChannel(null);
    
    try {
      const channels = await searchYouTubeChannels(searchQuery);
      if (channels.length === 0) {
        setError('No YouTube channels found. Try a different search term.');
      } else {
        setYoutubeChannels(channels);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search YouTube channels');
    } finally {
      setIsSearching(false);
    }
  };

  // Handle Reddit subreddit search
  const handleRedditSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setError(null);
    setSubreddits([]);
    setSelectedSubreddit(null);
    
    try {
      const results = await searchSubreddits(searchQuery);
      if (results.length === 0) {
        setError('No subreddits found. Try a different search term.');
      } else {
        setSubreddits(results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search subreddits');
    } finally {
      setIsSearching(false);
    }
  };

  // Handle form submit
  const handleSubmit = async () => {
    let feedUrl: string | undefined;
    
    if (feedType === 'rss') {
      feedUrl = selectedFeed || url;
    } else if (feedType === 'youtube' && selectedChannel) {
      feedUrl = getYouTubeChannelRSSUrl(selectedChannel.id);
    } else if (feedType === 'reddit' && selectedSubreddit) {
      feedUrl = getSubredditRSSUrl(selectedSubreddit.name, redditSort);
    }
    
    if (!feedUrl?.trim()) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      await createFeed({
        feed_url: feedUrl,
        category_id: selectedCategory || undefined,
      });
      
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add feed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if submit is enabled
  const canSubmit = () => {
    if (feedType === 'rss') return url.trim() || selectedFeed;
    if (feedType === 'youtube') return selectedChannel !== null;
    if (feedType === 'reddit') return selectedSubreddit !== null;
    return false;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-backdrop-in"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-md bg-[var(--color-surface-base)] rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Add Feed</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>
        
        {/* Feed Type Tabs */}
        <div className="flex border-b border-[var(--color-border-subtle)]">
          <button
            onClick={() => setFeedType('rss')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
              feedType === 'rss'
                ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            )}
          >
            <Rss size={16} />
            RSS
          </button>
          <button
            onClick={() => setFeedType('youtube')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
              feedType === 'youtube'
                ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            )}
          >
            <Youtube size={16} />
            YouTube
          </button>
          <button
            onClick={() => setFeedType('reddit')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
              feedType === 'reddit'
                ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            )}
          >
            <MessageCircle size={16} />
            Reddit
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-4">
          {/* RSS Mode */}
          {feedType === 'rss' && (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Website or Feed URL
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Rss size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com or feed URL"
                      className={cn(
                        'w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm',
                        'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                        'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                        'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                      )}
                      onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
                    />
                  </div>
                  <button
                    onClick={handleDiscover}
                    disabled={isDiscovering || !url.trim()}
                    className={cn(
                      'px-4 py-2.5 rounded-lg font-medium text-sm transition-colors',
                      'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
                      'hover:bg-[var(--color-surface-hover)]',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {isDiscovering ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  </button>
                </div>
              </div>
              
              {/* Discovered Feeds */}
              {discoveredFeeds.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    Found Feeds
                  </label>
                  <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)]">
                    {discoveredFeeds.map((feed) => (
                      <button
                        key={feed.url}
                        onClick={() => setSelectedFeed(feed.url)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                          selectedFeed === feed.url
                            ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                            : 'hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        {selectedFeed === feed.url ? (
                          <Check size={16} className="flex-shrink-0" />
                        ) : (
                          <Rss size={16} className="flex-shrink-0 text-[var(--color-text-tertiary)]" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{feed.title}</div>
                          <div className="text-xs text-[var(--color-text-tertiary)] truncate">{feed.type}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          
          {/* YouTube Mode */}
          {feedType === 'youtube' && (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Search YouTube Channels
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Youtube size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Channel name..."
                      className={cn(
                        'w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm',
                        'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                        'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                        'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                      )}
                      onKeyDown={(e) => e.key === 'Enter' && handleYouTubeSearch()}
                    />
                  </div>
                  <button
                    onClick={handleYouTubeSearch}
                    disabled={isSearching || !searchQuery.trim()}
                    className={cn(
                      'px-4 py-2.5 rounded-lg font-medium text-sm transition-colors',
                      'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
                      'hover:bg-[var(--color-surface-hover)]',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {isSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  </button>
                </div>
              </div>
              
              {/* YouTube Channels Results */}
              {youtubeChannels.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    Select Channel
                  </label>
                  <div className="space-y-1 max-h-60 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)]">
                    {youtubeChannels.map((channel) => (
                      <button
                        key={channel.id}
                        onClick={() => setSelectedChannel(channel)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                          selectedChannel?.id === channel.id
                            ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                            : 'hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        {channel.thumbnailUrl ? (
                          <img 
                            src={channel.thumbnailUrl} 
                            alt={channel.title}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                            <Youtube size={20} className="text-red-500" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{channel.title}</div>
                          {channel.subscriberCount && (
                            <div className="text-xs text-[var(--color-text-tertiary)]">
                              {channel.subscriberCount} subscribers
                            </div>
                          )}
                          {channel.description && (
                            <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                              {channel.description}
                            </div>
                          )}
                        </div>
                        {selectedChannel?.id === channel.id && (
                          <Check size={16} className="flex-shrink-0 text-[var(--color-accent-fg)]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          
          {/* Reddit Mode */}
          {feedType === 'reddit' && (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Search Subreddits
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <MessageCircle size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Subreddit name..."
                      className={cn(
                        'w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm',
                        'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                        'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                        'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                      )}
                      onKeyDown={(e) => e.key === 'Enter' && handleRedditSearch()}
                    />
                  </div>
                  <button
                    onClick={handleRedditSearch}
                    disabled={isSearching || !searchQuery.trim()}
                    className={cn(
                      'px-4 py-2.5 rounded-lg font-medium text-sm transition-colors',
                      'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
                      'hover:bg-[var(--color-surface-hover)]',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {isSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  </button>
                </div>
              </div>
              
              {/* Subreddit Results */}
              {subreddits.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    Select Subreddit
                  </label>
                  <div className="space-y-1 max-h-60 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)]">
                    {subreddits.map((sub) => (
                      <button
                        key={sub.name}
                        onClick={() => setSelectedSubreddit(sub)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                          selectedSubreddit?.name === sub.name
                            ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                            : 'hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        {sub.iconUrl ? (
                          <img 
                            src={sub.iconUrl} 
                            alt={sub.name}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                            <MessageCircle size={20} className="text-orange-500" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            r/{sub.name}
                            {sub.over18 && (
                              <span className="ml-2 text-xs text-red-500">NSFW</span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--color-text-tertiary)]">
                            {sub.subscribers.toLocaleString()} members
                          </div>
                          {sub.description && (
                            <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                              {sub.description}
                            </div>
                          )}
                        </div>
                        {selectedSubreddit?.name === sub.name && (
                          <Check size={16} className="flex-shrink-0 text-[var(--color-accent-fg)]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Reddit Sort Option */}
              {selectedSubreddit && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    Sort By
                  </label>
                  <div className="flex gap-2">
                    {(['hot', 'new', 'top'] as const).map((sort) => (
                      <button
                        key={sort}
                        onClick={() => setRedditSort(sort)}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                          redditSort === sort
                            ? 'bg-[var(--color-accent-fg)] text-white'
                            : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        {sort}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          
          {/* Category Selector (common to all modes) */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
              Category
            </label>
            <div className="relative">
              <button
                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm',
                  'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                  'text-[var(--color-text-primary)]'
                )}
              >
                <span>{categories.find(c => c.id === selectedCategory)?.title || 'Select category'}</span>
                <ChevronDown size={16} className="text-[var(--color-text-tertiary)]" />
              </button>
              
              {showCategoryDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => {
                        setSelectedCategory(category.id);
                        setShowCategoryDropdown(false);
                      }}
                      className={cn(
                        'w-full px-4 py-2 text-left text-sm transition-colors',
                        selectedCategory === category.id
                          ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                          : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
                      )}
                    >
                      {category.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
              {error}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border-subtle)]">
          <button
            onClick={onClose}
            className={cn(
              'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
              'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !canSubmit()}
            className={cn(
              'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
              'bg-[var(--color-accent-fg)] text-white',
              'hover:bg-[var(--color-accent-emphasis)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'flex items-center gap-2'
            )}
          >
            {isSubmitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            Add Feed
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddFeedModal;