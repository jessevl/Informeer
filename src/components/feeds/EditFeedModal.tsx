/**
 * EditFeedModal Component
 * Modal for editing feed settings (crawler, rules, etc.)
 */

import { useState, useEffect } from 'react';
import { X, Loader2, Save, ChevronDown, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeedsStore } from '@/stores/feeds';
import type { Feed, Category } from '@/types/miniflux';

interface EditFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  feed: Feed | null;
  categories: Category[];
  onDelete?: (feedId: number) => void;
}

export function EditFeedModal({ isOpen, onClose, feed, categories, onDelete }: EditFeedModalProps) {
  const [title, setTitle] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [crawler, setCrawler] = useState(false);
  const [scraperRules, setScraperRules] = useState('');
  const [rewriteRules, setRewriteRules] = useState('');
  const [blocklistRules, setBlocklistRules] = useState('');
  const [keeplistRules, setKeeplistRules] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [hideGlobally, setHideGlobally] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'advanced'>('general');
  
  const { updateFeed, refreshFeed, deleteFeed } = useFeedsStore();

  // Reset state when modal opens or feed changes
  useEffect(() => {
    if (isOpen && feed) {
      setTitle(feed.title);
      setSiteUrl(feed.site_url);
      setFeedUrl(feed.feed_url);
      setCategoryId(feed.category?.id || null);
      setCrawler(feed.crawler);
      setScraperRules(feed.scraper_rules || '');
      setRewriteRules(feed.rewrite_rules || '');
      setBlocklistRules(feed.blocklist_rules || '');
      setKeeplistRules(feed.keeplist_rules || '');
      setUserAgent(feed.user_agent || '');
      setDisabled(feed.disabled);
      setHideGlobally(feed.hide_globally);
      setError(null);
      setActiveTab('general');
    }
  }, [isOpen, feed]);

  // Handle form submit
  const handleSubmit = async () => {
    if (!feed) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      await updateFeed(feed.id, {
        title,
        site_url: siteUrl,
        feed_url: feedUrl,
        category: categoryId ? { id: categoryId, title: '', user_id: 0, hide_globally: false } : undefined,
        crawler,
        scraper_rules: scraperRules,
        rewrite_rules: rewriteRules,
        blocklist_rules: blocklistRules,
        keeplist_rules: keeplistRules,
        user_agent: userAgent,
        disabled,
        hide_globally: hideGlobally,
      });
      
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle refresh
  const handleRefresh = async () => {
    if (!feed) return;
    
    setIsRefreshing(true);
    try {
      await refreshFeed(feed.id);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!feed) return;
    
    if (confirm(`Are you sure you want to delete "${feed.title}"? This cannot be undone.`)) {
      try {
        await deleteFeed(feed.id);
        onDelete?.(feed.id);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete feed');
      }
    }
  };

  if (!isOpen || !feed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-backdrop-in"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg bg-[var(--color-surface-base)] rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Edit Feed</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={cn(
                'p-2 rounded-full transition-colors',
                'hover:bg-[var(--color-surface-hover)]',
                'disabled:opacity-50'
              )}
              title="Refresh feed"
            >
              <RefreshCw size={18} className={cn('text-[var(--color-text-secondary)]', isRefreshing && 'animate-spin')} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <X size={18} className="text-[var(--color-text-secondary)]" />
            </button>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border-subtle)]">
          <button
            onClick={() => setActiveTab('general')}
            className={cn(
              'flex-1 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === 'general'
                ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            )}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={cn(
              'flex-1 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === 'advanced'
                ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            )}
          >
            Advanced
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === 'general' ? (
            <>
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg border text-sm',
                    'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                    'text-[var(--color-text-primary)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                  )}
                />
              </div>
              
              {/* Site URL */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Site URL
                </label>
                <input
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg border text-sm',
                    'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                    'text-[var(--color-text-primary)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                  )}
                />
              </div>
              
              {/* Feed URL */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Feed URL
                </label>
                <input
                  type="url"
                  value={feedUrl}
                  onChange={(e) => setFeedUrl(e.target.value)}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg border text-sm',
                    'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                    'text-[var(--color-text-primary)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                  )}
                />
              </div>
              
              {/* Category */}
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
                    <span>{categories.find(c => c.id === categoryId)?.title || 'Select category'}</span>
                    <ChevronDown size={16} className="text-[var(--color-text-tertiary)]" />
                  </button>
                  
                  {showCategoryDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                      {categories.map((category) => (
                        <button
                          key={category.id}
                          onClick={() => {
                            setCategoryId(category.id);
                            setShowCategoryDropdown(false);
                          }}
                          className={cn(
                            'w-full px-4 py-2 text-left text-sm transition-colors',
                            categoryId === category.id
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
              
              {/* Options */}
              <div className="space-y-3 pt-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={crawler}
                    onChange={(e) => setCrawler(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--color-border-default)] text-[var(--color-accent-fg)] focus:ring-[var(--color-accent-fg)]"
                  />
                  <span className="text-sm text-[var(--color-text-primary)]">Fetch original content (crawler)</span>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disabled}
                    onChange={(e) => setDisabled(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--color-border-default)] text-[var(--color-accent-fg)] focus:ring-[var(--color-accent-fg)]"
                  />
                  <span className="text-sm text-[var(--color-text-primary)]">Disable feed updates</span>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideGlobally}
                    onChange={(e) => setHideGlobally(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--color-border-default)] text-[var(--color-accent-fg)] focus:ring-[var(--color-accent-fg)]"
                  />
                  <span className="text-sm text-[var(--color-text-primary)]">Hide entries in global unread list</span>
                </label>
              </div>
            </>
          ) : (
            <>
              {/* Scraper Rules */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Scraper Rules
                </label>
                <textarea
                  value={scraperRules}
                  onChange={(e) => setScraperRules(e.target.value)}
                  placeholder="CSS selectors for content extraction"
                  rows={2}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg border text-sm',
                    'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                    'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent',
                    'resize-none'
                  )}
                />
              </div>
              
              {/* Rewrite Rules */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Rewrite Rules
                </label>
                <textarea
                  value={rewriteRules}
                  onChange={(e) => setRewriteRules(e.target.value)}
                  placeholder="Content rewriting rules"
                  rows={2}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg border text-sm',
                    'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                    'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent',
                    'resize-none'
                  )}
                />
              </div>
              
              {/* Blocklist Rules */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Blocklist Rules
                </label>
                <textarea
                  value={blocklistRules}
                  onChange={(e) => setBlocklistRules(e.target.value)}
                  placeholder="Regex patterns to block entries"
                  rows={2}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg border text-sm',
                    'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                    'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent',
                    'resize-none'
                  )}
                />
              </div>
              
              {/* Keeplist Rules */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Keeplist Rules
                </label>
                <textarea
                  value={keeplistRules}
                  onChange={(e) => setKeeplistRules(e.target.value)}
                  placeholder="Regex patterns to keep entries"
                  rows={2}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg border text-sm',
                    'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                    'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent',
                    'resize-none'
                  )}
                />
              </div>
              
              {/* User Agent */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  Custom User Agent
                </label>
                <input
                  type="text"
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                  placeholder="Override the default user agent"
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg border text-sm',
                    'bg-[var(--color-surface-inset)] border-[var(--color-border-default)]',
                    'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                  )}
                />
              </div>
            </>
          )}
          
          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
              {error}
            </div>
          )}
          
          {/* Feed info */}
          {feed.parsing_error_count > 0 && (
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 text-sm">
              <strong>Parsing errors:</strong> {feed.parsing_error_count}
              {feed.parsing_error_message && (
                <p className="mt-1 text-xs">{feed.parsing_error_message}</p>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex justify-between gap-3 px-6 py-4 border-t border-[var(--color-border-subtle)]">
          <button
            onClick={handleDelete}
            className={cn(
              'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
              'text-red-500 hover:bg-red-500/10',
              'flex items-center gap-2'
            )}
          >
            <Trash2 size={16} />
            Delete
          </button>
          
          <div className="flex gap-3">
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
              disabled={isSubmitting}
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
                <Save size={16} />
              )}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditFeedModal;