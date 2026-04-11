/**
 * AddFeedModal Component
 * Modal for adding new RSS feeds with discovery support
 * Supports YouTube channel, Reddit subreddit, Podcast, and MagazineLib search
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Search, Rss, Loader2, Plus, Check, ChevronDown, Youtube, MessageCircle, Library, Headphones, BookOpen, Download, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/api/client';
import type { YouTubeChannelResult, SubredditResult, PodcastResult } from '@/api/client';
import { getYouTubeChannelRSSUrl, getSubredditRSSUrl } from '@/api/comments';
import { useFeedsStore } from '@/stores/feeds';
import { useModulesStore } from '@/stores/modules';
import { useBooksStore } from '@/stores/books';
import { useMagazinesStore } from '@/stores/magazines';
import { useEntriesStore } from '@/stores/entries';
import type { Category, ZLibSearchResult, ZLibDownloadStatus } from '@/types/api';

type FeedType = 'rss' | 'youtube' | 'reddit' | 'podcasts' | 'magazinelib' | 'zlib';

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

/**
 * Inline Z-Library search panel for the Books tab.
 */
function ZLibPanel({ onClose: _onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ZLibSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<ZLibDownloadStatus | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const downloadFromZLib = useBooksStore(s => s.downloadFromZLib);

  useEffect(() => {
    api.getZLibStatus().then(setDownloadStatus).catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleSearch = useCallback(async (newSearch = true) => {
    const q = query.trim();
    if (!q) return;
    setIsSearching(true);
    setError(null);
    const searchPage = newSearch ? 1 : page + 1;
    try {
      const response = await api.searchZLib(q, searchPage);
      if (newSearch) {
        setResults(response.results);
      } else {
        setResults(prev => [...prev, ...response.results]);
      }
      setPage(searchPage);
      setHasMore(response.hasMore);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [query, page]);

  const handleDownload = useCallback(async (result: ZLibSearchResult) => {
    if (downloadingId) return;
    if (downloadStatus && !downloadStatus.canDownload) {
      setError(`Daily download limit reached (${downloadStatus.dailyLimit}/day). Resets at midnight.`);
      return;
    }
    setDownloadingId(result.id);
    setError(null);
    try {
      await downloadFromZLib(result);
      setResults(prev => prev.filter(r => r.id !== result.id));
      api.getZLibStatus().then(setDownloadStatus).catch(() => {});
    } catch (err: any) {
      setError(`Download failed: ${err.message}`);
    } finally {
      setDownloadingId(null);
    }
  }, [downloadingId, downloadFromZLib, downloadStatus]);

  return (
    <div className="flex flex-col gap-3">
      {/* Search input */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(true); }}
            placeholder="Search Z-Library for books..."
            className={cn(
              'w-full pl-9 pr-4 py-2.5 rounded-lg border text-sm',
              'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
              'focus:outline-none focus:border-[var(--color-accent-fg)] focus:ring-1 focus:ring-[var(--color-accent-fg)]/30',
              'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
            )}
          />
        </div>
        <button
          onClick={() => handleSearch(true)}
          disabled={isSearching || !query.trim()}
          className={cn(
            'px-4 py-2.5 rounded-lg font-medium text-sm transition-colors',
            'bg-[var(--color-accent-fg)] text-white hover:bg-[var(--color-accent-emphasis)]',
            'disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2',
          )}
        >
          {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Search
        </button>
      </div>

      {/* Download limit banner */}
      {downloadStatus && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg',
          downloadStatus.remaining <= 1
            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]',
        )}>
          <Info size={12} />
          <span>
            {downloadStatus.remaining > 0
              ? `${downloadStatus.remaining} of ${downloadStatus.dailyLimit} downloads remaining today`
              : 'Daily download limit reached — resets at midnight'}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-red-500 text-sm bg-red-500/10 rounded-lg">
          <AlertCircle size={14} />{error}
        </div>
      )}

      {/* Results */}
      {results.length === 0 && !isSearching && !error && (
        <div className="flex flex-col items-center justify-center py-8 text-[var(--color-text-tertiary)]">
          <BookOpen size={36} className="mb-2 opacity-30" />
          <p className="text-sm">Search for books to download</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="-mx-6 divide-y divide-[var(--color-border-subtle)]">
          {results.map(result => {
            const isEpub = result.extension?.toLowerCase() === 'epub';
            const downloadable = isEpub && downloadStatus?.canDownload !== false && !!result.downloadUrl;
            return (
              <div key={result.id} className="flex items-start gap-3 px-6 py-3 hover:bg-[var(--color-surface-hover)] transition-colors">
                {result.coverUrl ? (
                  <img src={api.getZLibCoverProxyUrl(result.coverUrl)} alt="" className="w-10 h-14 object-cover rounded flex-shrink-0 bg-[var(--color-surface-tertiary)]" loading="lazy" />
                ) : (
                  <div className="w-10 h-14 rounded flex-shrink-0 bg-[var(--color-surface-tertiary)] flex items-center justify-center">
                    <BookOpen size={16} className="text-[var(--color-text-disabled)]" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-1">{result.title}</h4>
                  <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1 mt-0.5">{result.author}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-text-tertiary)]">
                    {result.year && <span>{result.year}</span>}
                    {result.language && <span>{result.language}</span>}
                    {result.extension && (
                      <span className={cn(
                        'uppercase font-medium px-1.5 py-0.5 rounded',
                        isEpub ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-[var(--color-surface-tertiary)]',
                      )}>{result.extension}</span>
                    )}
                    {result.fileSize && <span>{result.fileSize}</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(result)}
                  disabled={downloadingId === result.id || !downloadable}
                  className={cn(
                    'flex-shrink-0 p-2 rounded-lg transition-colors',
                    downloadable ? 'text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-fg)]/10' : 'text-[var(--color-text-disabled)] cursor-not-allowed',
                    downloadingId === result.id && 'opacity-50',
                  )}
                >
                  {downloadingId === result.id ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                </button>
              </div>
            );
          })}
          {hasMore && !isSearching && (
            <button
              onClick={() => handleSearch(false)}
              className="w-full py-3 text-sm text-[var(--color-accent-fg)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Load more results
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AddFeedModal({ isOpen, onClose, categories, initialTab, initialCategory }: AddFeedModalProps) {
  const magEnabled = useModulesStore((s) => s.modules.magazinelib);
  const booksZlibEnabled = useModulesStore((s) => s.modules.booksZlib);
  const [feedType, setFeedType] = useState<FeedType>(initialTab ?? 'rss');
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
      setFeedType(initialTab ?? 'rss');
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
    if (feedType === 'zlib') return false; // ZLib has inline download buttons
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
          {booksZlibEnabled && (
            <button
              onClick={() => setFeedType('zlib')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap',
                feedType === 'zlib'
                  ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              )}
            >
              <BookOpen size={16} />
              Books
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
          
          {/* Z-Library Books Mode */}
          {feedType === 'zlib' && (
            <ZLibPanel onClose={onClose} />
          )}

          {/* Category Selector — hidden for feed types with system categories */}
          {feedType === 'youtube' || feedType === 'podcasts' || feedType === 'magazinelib' || feedType === 'zlib' ? (
            <div className="text-xs text-[var(--color-text-tertiary)]">
              Will be added to <span className="font-medium text-[var(--color-text-secondary)]">
                {feedType === 'youtube' ? 'Video' : feedType === 'podcasts' ? 'Audio' : feedType === 'zlib' ? 'Books' : 'Magazines'}
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
        
        {/* Footer — hidden for zlib (has inline download buttons) */}
        {feedType !== 'zlib' && (
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
        )}
      </div>
    </div>
  );
}

export default AddFeedModal;