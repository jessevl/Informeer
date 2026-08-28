/**
 * AddFeedModal Component
 * Modal for adding new RSS feeds with discovery support
 * Supports YouTube channel, Reddit subreddit, Podcast, and MagazineLib search
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Search, Rss, Loader2, Plus, Check, ChevronDown, Youtube, MessageCircle, Library, Headphones, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/api/client';
import type { YouTubeChannelResult, SubredditResult, PodcastResult } from '@/api/client';
import { getYouTubeChannelRSSUrl, getSubredditRSSUrl } from '@/api/comments';
import { useFeedsStore } from '@/stores/feeds';
import { useModulesStore } from '@/stores/modules';
import { useBooksStore } from '@/stores/books';
import { useMagazinesStore } from '@/stores/magazines';
import { useEntriesStore } from '@/stores/entries';
import { PODCASTS_YOUTUBE_ENABLED } from '@/config/features';
import type { Category } from '@/types/api';

type FeedType = 'rss' | 'youtube' | 'reddit' | 'podcasts' | 'magazinelib';

// Podcasts/YouTube are gated off (see @/config/features) — never resolve to
// those tabs even if a stale initialTab prop or persisted value asks for one.
function resolveFeedType(type: FeedType | undefined): FeedType {
  if (!PODCASTS_YOUTUBE_ENABLED && (type === 'youtube' || type === 'podcasts')) return 'rss';
  return type ?? 'rss';
}

interface AddFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  initialTab?: FeedType;
  initialCategory?: number;
}

interface DiscoveredFeed {
  url: string;
  title: string;
  type: string;
}

interface MagazinePreview {
  id: string;
  title: string;
  coverUrl: string;
  seriesName?: string;
}

export function AddFeedModal({ isOpen, onClose, categories, initialTab, initialCategory }: AddFeedModalProps) {
  const magEnabled = useModulesStore((s) => s.modules.magazinelib);
  const [feedType, setFeedType] = useState<FeedType>(resolveFeedType(initialTab));
  const [url, setUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [discoveredFeeds, setDiscoveredFeeds] = useState<DiscoveredFeed[]>([]);
  const [youtubeChannels, setYoutubeChannels] = useState<YouTubeChannelResult[]>([]);
  const [subreddits, setSubreddits] = useState<SubredditResult[]>([]);
  const [podcasts, setPodcasts] = useState<PodcastResult[]>([]);
  const [selectedFeed, setSelectedFeed] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<YouTubeChannelResult | null>(null);
  const [selectedSubreddit, setSelectedSubreddit] = useState<SubredditResult | null>(null);
  const [selectedPodcast, setSelectedPodcast] = useState<PodcastResult | null>(null);
  const [redditSort, setRedditSort] = useState<'hot' | 'new' | 'top'>('hot');
  const [magazinePreviews, setMagazinePreviews] = useState<MagazinePreview[]>([]);
  const [magazineQueryConfirmed, setMagazineQueryConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  
  const { createFeed, fetchFeeds, fetchCounters } = useFeedsStore();

  // Reset state when modal opens or feed type changes
  useEffect(() => {
    if (isOpen) {
      setFeedType(resolveFeedType(initialTab));
      setUrl('');
      setSearchQuery('');
      const userCategories = categories.filter(c => !c.is_system);
      setSelectedCategory(initialCategory ?? userCategories[0]?.id ?? null);
      setDiscoveredFeeds([]);
      setYoutubeChannels([]);
      setSubreddits([]);
      setPodcasts([]);
      setMagazinePreviews([]);
      setMagazineQueryConfirmed(false);
      setSelectedFeed(null);
      setSelectedChannel(null);
      setSelectedSubreddit(null);
      setSelectedPodcast(null);
      setError(null);
    }
  }, [isOpen, categories, initialTab]);

  // Reset search results when changing feed type
  useEffect(() => {
    setSearchQuery('');
    setDiscoveredFeeds([]);
    setYoutubeChannels([]);
    setSubreddits([]);
    setPodcasts([]);
    setMagazinePreviews([]);
    setMagazineQueryConfirmed(false);
    setSelectedFeed(null);
    setSelectedChannel(null);
    setSelectedSubreddit(null);
    setSelectedPodcast(null);
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
      const feeds = await api.discoverFeeds(url);
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
      const channels = await api.searchYouTubeChannels(searchQuery);
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
      const results = await api.searchSubreddits(searchQuery);
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

  // Handle MagazineLib search
  const handleMagazineSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    setMagazinePreviews([]);
    setMagazineQueryConfirmed(false);

    try {
      const results = await api.searchMagazines(searchQuery);
      if (!results.issues || results.issues.length === 0) {
        setError('No magazines found. Try a different search term.');
      } else {
        setMagazinePreviews(results.issues.map(issue => ({
          id: issue.id,
          title: issue.title,
          coverUrl: issue.coverUrl,
          seriesName: issue.seriesName,
        })));
        setMagazineQueryConfirmed(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search magazines');
    } finally {
      setIsSearching(false);
    }
  };

  // Handle Podcast search
  const handlePodcastSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    setPodcasts([]);
    setSelectedPodcast(null);

    try {
      const results = await api.searchPodcasts(searchQuery);
      if (results.length === 0) {
        setError('No podcasts found. Try a different search term.');
      } else {
        setPodcasts(results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search podcasts');
    } finally {
      setIsSearching(false);
    }
  };

  // Handle form submit
  const handleSubmit = async () => {
    // Feed types that auto-assign to system categories — don't send category_id
    const systemCategoryTypes: FeedType[] = ['youtube', 'podcasts', 'magazinelib'];
    const useSystemCategory = systemCategoryTypes.includes(feedType);

    // MagazineLib uses a different API (subscribe, not createFeed)
    if (feedType === 'magazinelib' && magazineQueryConfirmed) {
      setIsSubmitting(true);
      setError(null);
      try {
        await api.subscribeMagazine({
          query: searchQuery.trim(),
        });
        // Refresh sidebar feed list & counters so the new feed shows immediately
        await Promise.all([fetchFeeds(), fetchCounters()]);
        // Also refresh magazine subscriptions and entries so the new subscription
        // appears as a loading placeholder and entries start loading
        useMagazinesStore.getState().fetchSubscriptions();
        useEntriesStore.getState().fetchEntries();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to subscribe to magazine');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    let feedUrl: string | undefined;
    
    if (feedType === 'rss') {
      feedUrl = selectedFeed || url;
    } else if (feedType === 'youtube' && selectedChannel) {
      feedUrl = getYouTubeChannelRSSUrl(selectedChannel.id);
    } else if (feedType === 'reddit' && selectedSubreddit) {
      feedUrl = getSubredditRSSUrl(selectedSubreddit.name, redditSort);
    } else if (feedType === 'podcasts' && selectedPodcast) {
      feedUrl = selectedPodcast.feedUrl;
    }
    
    if (!feedUrl?.trim()) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const systemCategoryMap: Record<string, string> = {
        youtube: 'Video',
        podcasts: 'Audio',
      };
      await createFeed({
        feed_url: feedUrl,
        category_id: useSystemCategory ? undefined : (selectedCategory || undefined),
        ...(systemCategoryMap[feedType] ? { system_category: systemCategoryMap[feedType] } : {}),
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
    if (feedType === 'podcasts') return selectedPodcast !== null;
    if (feedType === 'magazinelib') return magazineQueryConfirmed && searchQuery.trim().length > 0;
    return false;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-backdrop-in eink-modal-backdrop"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className={cn(
        'relative w-full bg-[var(--color-surface-base)] rounded-2xl shadow-2xl overflow-hidden animate-scale-in eink-shell-surface eink-modal-surface',
        'flex flex-col max-h-[80vh]',
'max-w-md'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)] shrink-0">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Add Feed</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>
        
        {/* Feed Type Tabs */}
        <div className="flex overflow-x-auto border-b border-[var(--color-border-subtle)] shrink-0 scrollbar-none">
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
          {PODCASTS_YOUTUBE_ENABLED && (
            <button
              onClick={() => setFeedType('youtube')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap',
                feedType === 'youtube'
                  ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              )}
            >
              <Youtube size={16} />
              YouTube
            </button>
          )}
          <button
            onClick={() => setFeedType('reddit')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap',
              feedType === 'reddit'
                ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            )}
          >
            <MessageCircle size={16} />
            Reddit
          </button>
          {PODCASTS_YOUTUBE_ENABLED && (
            <button
              onClick={() => setFeedType('podcasts')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap',
                feedType === 'podcasts'
                  ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              )}
            >
              <Headphones size={16} />
              Podcasts
            </button>
          )}
          {magEnabled && (
            <button
              onClick={() => setFeedType('magazinelib')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap',
                feedType === 'magazinelib'
                  ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              )}
            >
              <Library size={16} />
              Magazines
            </button>
          )}
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto min-h-0">
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

          {/* Podcasts Mode */}
          {feedType === 'podcasts' && (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Search Podcasts
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Headphones size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Podcast name..."
                      className={cn(
                        'w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm',
                        'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                        'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                        'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                      )}
                      onKeyDown={(e) => e.key === 'Enter' && handlePodcastSearch()}
                    />
                  </div>
                  <button
                    onClick={handlePodcastSearch}
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

              {/* Podcast Results */}
              {podcasts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    Select Podcast
                  </label>
                  <div className="space-y-1 max-h-60 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)]">
                    {podcasts.map((podcast) => (
                      <button
                        key={podcast.id}
                        onClick={() => setSelectedPodcast(podcast)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                          selectedPodcast?.id === podcast.id
                            ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                            : 'hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        {podcast.artworkUrl ? (
                          <img
                            src={podcast.artworkUrl}
                            alt={podcast.title}
                            className="w-10 h-10 rounded object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                            <Headphones size={20} className="text-purple-500" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{podcast.title}</div>
                          <div className="text-xs text-[var(--color-text-tertiary)]">
                            {podcast.author}
                            {podcast.episodeCount > 0 && ` · ${podcast.episodeCount} episodes`}
                          </div>
                          {podcast.genres.length > 0 && (
                            <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                              {podcast.genres.join(', ')}
                            </div>
                          )}
                        </div>
                        {selectedPodcast?.id === podcast.id && (
                          <Check size={16} className="flex-shrink-0 text-[var(--color-accent-fg)]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* MagazineLib Mode */}
          {feedType === 'magazinelib' && (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Magazine Search Query
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Library size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setMagazineQueryConfirmed(false); }}
                      placeholder="e.g. Wired -fashion -beauty"
                      className={cn(
                        'w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm',
                        'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                        'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                        'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                      )}
                      onKeyDown={(e) => e.key === 'Enter' && handleMagazineSearch()}
                    />
                  </div>
                  <button
                    onClick={handleMagazineSearch}
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
                <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">
                  Use <span className="font-mono">-word</span> to exclude terms. New issues matching this query will be fetched automatically.
                </p>
              </div>

              {/* Magazine Preview Results */}
              {magazinePreviews.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    Preview — {magazinePreviews.length} issues found
                  </label>
                  <div className="grid grid-cols-4 gap-2 max-h-52 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] p-2">
                    {magazinePreviews.map((mag) => (
                      <div key={mag.id} className="flex flex-col items-center gap-1">
                        {mag.coverUrl ? (
                          <img
                            src={mag.coverUrl}
                            alt={mag.title}
                            className="w-full aspect-[3/4] rounded object-cover"
                          />
                        ) : (
                          <div className="w-full aspect-[3/4] rounded bg-purple-500/20 flex items-center justify-center">
                            <Library size={20} className="text-purple-500" />
                          </div>
                        )}
                        <div className="text-[10px] text-[var(--color-text-tertiary)] text-center truncate w-full" title={mag.title}>
                          {mag.seriesName || mag.title}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          
          {/* Category Selector — hidden for feed types with system categories */}
          {feedType === 'youtube' || feedType === 'podcasts' || feedType === 'magazinelib' ? (
            <div className="text-xs text-[var(--color-text-tertiary)]">
              Will be added to <span className="font-medium text-[var(--color-text-secondary)]">
                {feedType === 'youtube' ? 'Video' : feedType === 'podcasts' ? 'Audio' : 'Magazines'}
              </span>
            </div>
          ) : (
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
                  {categories.filter(c => !c.is_system).map((category) => (
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
          )}
          
          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
              {error}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border-subtle)] shrink-0">
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
            {feedType === 'magazinelib' ? 'Subscribe' : 'Add Feed'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddFeedModal;