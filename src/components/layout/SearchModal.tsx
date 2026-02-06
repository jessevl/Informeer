/**
 * SearchModal Component
 * Command palette style search dialog
 * Mobile: Full-screen layout with improved touch targets
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, X, FileText, Rss, Folder, ArrowLeft } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import type { Entry, Feed, Category } from '@/types/miniflux';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string) => Promise<Entry[]>;
  onSelectEntry: (entry: Entry) => void;
  feeds: Feed[];
  categories: Category[];
  onSelectFeed?: (feedId: number) => void;
  onSelectCategory?: (categoryId: number) => void;
}

export function SearchModal({
  isOpen,
  onClose,
  onSearch,
  onSelectEntry,
  feeds,
  categories,
  onSelectFeed,
  onSelectCategory,
}: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Filter feeds and categories based on query
  const filteredFeeds = query
    ? feeds.filter(f => f.title.toLowerCase().includes(query.toLowerCase())).slice(0, 3)
    : [];
  const filteredCategories = query
    ? categories.filter(c => c.title.toLowerCase().includes(query.toLowerCase())).slice(0, 2)
    : [];

  // All results for keyboard navigation
  const allResults = [
    ...filteredCategories.map(c => ({ type: 'category' as const, item: c })),
    ...filteredFeeds.map(f => ({ type: 'feed' as const, item: f })),
    ...results.map(e => ({ type: 'entry' as const, item: e })),
  ];

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await onSearch(query);
        setResults(searchResults.slice(0, 10));
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, onSearch]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && allResults[selectedIndex]) {
      e.preventDefault();
      const selected = allResults[selectedIndex];
      if (selected.type === 'entry') {
        onSelectEntry(selected.item as Entry);
      } else if (selected.type === 'feed' && onSelectFeed) {
        onSelectFeed((selected.item as Feed).id);
      } else if (selected.type === 'category' && onSelectCategory) {
        onSelectCategory((selected.item as Category).id);
      }
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [allResults, selectedIndex, onSelectEntry, onSelectFeed, onSelectCategory, onClose]);

  const isMobile = useIsMobile();

  if (!isOpen) return null;

  // Mobile: Full screen search
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 bg-[var(--color-surface-app)] animate-fade-in">
        {/* Mobile Header */}
        <div className={cn(
          "flex items-center gap-2 px-2 py-2",
          "bg-[var(--color-surface-glass)] backdrop-blur-xl",
          "border-b border-[var(--color-border-subtle)]",
          "pt-[calc(8px+env(safe-area-inset-top))]"
        )}>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 flex items-center gap-2 bg-[var(--color-surface-inset)] rounded-lg px-3 py-2">
            <Search size={18} className="text-[var(--color-text-tertiary)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search..."
              className="flex-1 bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none text-base"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-1 rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Results - Mobile */}
        <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {isSearching ? (
            <div className="p-8 text-center text-[var(--color-text-tertiary)]">
              Searching...
            </div>
          ) : query && allResults.length === 0 ? (
            <div className="p-8 text-center text-[var(--color-text-tertiary)]">
              No results found for "{query}"
            </div>
          ) : !query ? (
            <div className="p-8 text-center text-[var(--color-text-tertiary)]">
              Type to search...
            </div>
          ) : (
            <div className="py-2">
              {/* Categories */}
              {filteredCategories.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                    Categories
                  </div>
                  {filteredCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        onSelectCategory?.(cat.id);
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] active:bg-[var(--color-surface-inset)]"
                    >
                      <Folder size={20} className="text-[var(--color-text-tertiary)]" />
                      <span className="text-[var(--color-text-primary)]">{cat.title}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Feeds */}
              {filteredFeeds.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                    Feeds
                  </div>
                  {filteredFeeds.map((feed) => (
                    <button
                      key={feed.id}
                      onClick={() => {
                        onSelectFeed?.(feed.id);
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] active:bg-[var(--color-surface-inset)]"
                    >
                      <Rss size={20} className="text-[var(--color-text-tertiary)]" />
                      <span className="text-[var(--color-text-primary)]">{feed.title}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Entries */}
              {results.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                    Articles
                  </div>
                  {results.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => {
                        onSelectEntry(entry);
                        onClose();
                      }}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] active:bg-[var(--color-surface-inset)]"
                    >
                      <FileText size={20} className="text-[var(--color-text-tertiary)] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[var(--color-text-primary)] line-clamp-2">{entry.title}</p>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-1 truncate">
                          {entry.feed?.title} · {formatRelativeTime(entry.published_at)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop: Modal style
  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-backdrop-in" />

      {/* Modal */}
      <div 
        className="relative w-full max-w-xl bg-[var(--color-surface-primary)] rounded-xl shadow-2xl border border-[var(--color-border-subtle)] overflow-hidden animate-slide-down"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <Search size={20} className="text-[var(--color-text-tertiary)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search entries, feeds, categories..."
            className="flex-1 bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]"
            >
              <X size={16} />
            </button>
          )}
          <kbd className="text-xs text-[var(--color-text-tertiary)] bg-[var(--color-surface-inset)] px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {isSearching ? (
            <div className="p-8 text-center text-[var(--color-text-tertiary)]">
              Searching...
            </div>
          ) : query && allResults.length === 0 ? (
            <div className="p-8 text-center text-[var(--color-text-tertiary)]">
              No results found for "{query}"
            </div>
          ) : !query ? (
            <div className="p-8 text-center text-[var(--color-text-tertiary)]">
              Type to search...
            </div>
          ) : (
            <div className="py-2">
              {/* Categories */}
              {filteredCategories.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                    Categories
                  </div>
                  {filteredCategories.map((cat, idx) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        onSelectCategory?.(cat.id);
                        onClose();
                      }}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                        selectedIndex === idx
                          ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                          : 'hover:bg-[var(--color-surface-hover)]'
                      )}
                    >
                      <Folder size={16} />
                      <span>{cat.title}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Feeds */}
              {filteredFeeds.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                    Feeds
                  </div>
                  {filteredFeeds.map((feed, idx) => {
                    const resultIdx = filteredCategories.length + idx;
                    return (
                      <button
                        key={feed.id}
                        onClick={() => {
                          onSelectFeed?.(feed.id);
                          onClose();
                        }}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                          selectedIndex === resultIdx
                            ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                            : 'hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        <Rss size={16} />
                        <span className="truncate">{feed.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Entries */}
              {results.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                    Articles
                  </div>
                  {results.map((entry, idx) => {
                    const resultIdx = filteredCategories.length + filteredFeeds.length + idx;
                    return (
                      <button
                        key={entry.id}
                        onClick={() => {
                          onSelectEntry(entry);
                          onClose();
                        }}
                        className={cn(
                          'w-full flex items-start gap-3 px-4 py-2 text-left transition-colors',
                          selectedIndex === resultIdx
                            ? 'bg-[var(--color-accent-fg)]/10'
                            : 'hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        <FileText size={16} className="mt-0.5 flex-shrink-0 text-[var(--color-text-tertiary)]" />
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            'truncate',
                            selectedIndex === resultIdx ? 'text-[var(--color-accent-fg)]' : 'text-[var(--color-text-primary)]'
                          )}>
                            {entry.title}
                          </p>
                          <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                            {entry.feed?.title} • {formatRelativeTime(entry.published_at)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {allResults.length > 0 && (
          <div className="px-4 py-2 border-t border-[var(--color-border-subtle)] flex items-center gap-4 text-xs text-[var(--color-text-tertiary)]">
            <span className="flex items-center gap-1">
              <kbd className="bg-[var(--color-surface-inset)] px-1 rounded">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-[var(--color-surface-inset)] px-1 rounded">↵</kbd>
              select
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
