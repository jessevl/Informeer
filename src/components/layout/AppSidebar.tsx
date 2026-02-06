/**
 * AppSidebar Component
 * Main navigation sidebar with feeds and categories
 * Uses Planneer-style glass-item tree styling
 * 
 * New Design:
 * - Home (all feeds)
 * - Audio filter (podcasts)
 * - Video filter (YouTube)
 * - Saved section (Links, Later, Bookmarks, Favorites)
 * - Categories with feeds
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  FolderOpen,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  LogOut,
  Settings,
  Search,
  Plus,
  Home,
  Headphones,
  Video,
  Star,
  MoreHorizontal,
  Rss,
} from 'lucide-react';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import type { Feed, Category, FeedCounters } from '@/types/miniflux';

interface AppSidebarProps {
  feeds: Feed[];
  categories: Category[];
  counters: FeedCounters | null;
  collapsed?: boolean;
  onSelectView: (view: { 
    feedId?: number | null; 
    categoryId?: number | null; 
    starred?: boolean;
    status?: 'unread' | 'read' | 'all';
    mediaType?: 'all' | 'audio' | 'video';
  }) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
  onAddFeed?: () => void;
  onManageFeeds?: () => void;
  onEditFeed?: (feed: Feed) => void;
  onToggleCollapse?: () => void;
  isRefreshing: boolean;
  currentView: {
    feedId: number | null;
    categoryId: number | null;
    starred: boolean;
    status: 'unread' | 'read' | 'all';
    mediaType?: 'all' | 'audio' | 'video';
  };
}

export function AppSidebar({
  feeds,
  categories,
  counters,
  collapsed = false,
  onSelectView,
  onRefresh,
  onLogout,
  onOpenSettings,
  onOpenSearch,
  onAddFeed,
  onManageFeeds,
  onEditFeed,
  onToggleCollapse,
  isRefreshing,
  currentView,
}: AppSidebarProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(
    new Set(categories.map(c => c.id))
  );

  const feedsByCategory = categories.map(cat => ({
    ...cat,
    feeds: feeds.filter(f => f.category?.id === cat.id),
  }));

  const totalUnread = counters 
    ? Object.values(counters.unreads).reduce((a, b) => a + b, 0)
    : 0;

  const toggleCategory = (categoryId: number) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const isViewActive = (check: { feedId?: number | null; categoryId?: number | null; starred?: boolean; mediaType?: string }) => {
    // Exact match - all properties must match for mutual exclusivity
    const currentMediaType = currentView.mediaType || 'all';
    const checkMediaType = check.mediaType || 'all';
    
    // Check for exact match
    const feedMatch = (check.feedId ?? null) === currentView.feedId;
    const categoryMatch = (check.categoryId ?? null) === currentView.categoryId;
    const starredMatch = (check.starred ?? false) === currentView.starred;
    const mediaTypeMatch = checkMediaType === currentMediaType;
    
    return feedMatch && categoryMatch && starredMatch && mediaTypeMatch;
  };

  if (collapsed) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sidebar Header - Logo + Settings/Logout */}
      <div className="px-2 pt-3 pb-2">
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg',
            'glass-item-subtle text-[var(--color-text-primary)]',
            'transition-all duration-200 group'
          )}
        >
          {/* App icon */}
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--color-accent-fg)] to-[var(--color-accent-emphasis)] flex items-center justify-center text-white flex-shrink-0 shadow-sm transition-transform group-hover:scale-105">
            <Rss size={14} />
          </div>
          {/* App name */}
          <span className="flex-1 text-sm font-semibold text-[var(--color-text-primary)] truncate text-left">
            Informeer
          </span>
          {/* Settings button (visible on hover) */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
            {onOpenSettings && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
                className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
                title="Settings"
              >
                <Settings size={14} className="text-[var(--color-text-secondary)]" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onLogout(); }}
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
              title="Logout"
            >
              <LogOut size={14} className="text-[var(--color-text-secondary)]" />
            </button>
          </div>
        </button>
      </div>

      {/* Search Button */}
      {onOpenSearch && (
        <div className="px-3 pb-2">
          <button
            onClick={onOpenSearch}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
              'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
              'border border-[var(--color-border-subtle)]',
              'bg-[var(--color-surface-inset)]/50'
            )}
          >
            <Search size={16} className="text-[var(--color-text-tertiary)]" />
            <span className="flex-1 text-sm">Search...</span>
            <kbd className="text-xs text-[var(--color-text-tertiary)] bg-[var(--color-surface-secondary)] px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)]">⌘K</kbd>
          </button>
        </div>
      )}

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {/* Home - Same style as other filters */}
        <div className="mb-4">
          <TreeItem
            icon={<Home size={18} />}
            label="Home"
            subtitle="All feeds"
            count={totalUnread > 0 ? totalUnread : undefined}
            isActive={isViewActive({ feedId: null, categoryId: null, starred: false, mediaType: 'all' })}
            onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'all' })}
          />
        </div>

        {/* Filters Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
              Filters
            </span>
          </div>
          <div className="space-y-0.5">
            <TreeItem
              icon={<Headphones size={18} />}
              label="Audio"
              isActive={isViewActive({ mediaType: 'audio' })}
              onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'audio' })}
            />
            <TreeItem
              icon={<Video size={18} />}
              label="Video"
              isActive={isViewActive({ mediaType: 'video' })}
              onClick={() => onSelectView({ feedId: null, categoryId: null, starred: false, status: 'all', mediaType: 'video' })}
            />
            <TreeItem
              icon={<Star size={18} />}
              label="Starred"
              isActive={isViewActive({ starred: true })}
              onClick={() => onSelectView({ feedId: null, categoryId: null, starred: true, status: 'all', mediaType: 'all' })}
            />
          </div>
        </div>

        {/* Categories & Feeds */}
        {feedsByCategory.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between px-3 mb-2">
              <span className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                Feeds
              </span>
              <div className="flex items-center gap-0.5">
                {onManageFeeds && (
                  <button
                    onClick={onManageFeeds}
                    className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                    title="Manage feeds"
                  >
                    <Settings size={14} />
                  </button>
                )}
                {onAddFeed && (
                  <button
                    onClick={onAddFeed}
                    className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                    title="Add feed"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-0.5">
              {feedsByCategory.map(cat => (
                <CategorySection
                  key={cat.id}
                  category={cat}
                  feeds={cat.feeds}
                  counters={counters}
                  expanded={expandedCategories.has(cat.id)}
                  onToggle={() => toggleCategory(cat.id)}
                  onSelectCategory={() => onSelectView({ feedId: null, categoryId: cat.id, starred: false, status: 'unread', mediaType: 'all' })}
                  onSelectFeed={(feedId) => onSelectView({ feedId, categoryId: null, starred: false, status: 'unread', mediaType: 'all' })}
                  onEditFeed={onEditFeed}
                  currentFeedId={currentView.feedId}
                  currentCategoryId={currentView.categoryId}
                />
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Footer Actions */}
      <div className="px-2 py-2 border-t border-[var(--color-border-subtle)]" />
    </div>
  );
}

/**
 * TreeItem - Planneer-style tree item with glass selection effect
 * Matches the styling from TreeSidebarItem.tsx in Planneer
 */
function TreeItem({
  icon,
  label,
  subtitle,
  isActive = false,
  onClick,
  count,
  countHighlight = false,
  level = 0,
  hasChildren = false,
  isExpanded = false,
  onToggle,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  isActive?: boolean;
  onClick?: () => void;
  count?: number | string;
  countHighlight?: boolean;
  level?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  const paddingLeft = 12 + (level * 16);
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ paddingLeft: `${paddingLeft}px` }}
      className={cn(
        // Base styles - matching Planneer TreeSidebarItem
        'group w-full flex items-center gap-2 pr-2 py-1.5 rounded-lg font-medium transition-all cursor-pointer outline-none text-sm',
        
        // Focus ring
        'focus-visible:ring-2 focus-visible:ring-[var(--color-interactive-ring)] focus-visible:ring-offset-1',
        
        // Active state - macOS glassy effect
        isActive && 'glass-item text-[var(--color-text-primary)]',
        
        // Inactive state - subtle hover
        !isActive && 'glass-item-subtle text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
        
        // Disabled
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {/* Expand/Collapse for items with children */}
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className="w-4 h-4 flex items-center justify-center hover:bg-[var(--color-surface-inset)] rounded transition-colors flex-shrink-0 -ml-1"
        >
          <ChevronRight
            size={14}
            className={cn(
              'transition-transform duration-300 transition-spring text-[var(--color-text-tertiary)]',
              isExpanded && 'rotate-90'
            )}
          />
        </button>
      )}
      
      {/* Icon */}
      <span className="flex-shrink-0 text-[var(--color-text-tertiary)]">{icon}</span>
      
      {/* Label with optional subtitle */}
      <div className="flex-1 truncate text-left">
        <span>{label}</span>
        {subtitle && (
          <span className="block text-xs text-[var(--color-text-tertiary)] font-normal">{subtitle}</span>
        )}
      </div>
      
      {/* Count badge */}
      {count !== undefined && (
        <span className={cn(
          'text-xs tabular-nums flex-shrink-0',
          countHighlight 
            ? 'px-1.5 py-0.5 rounded-full bg-[var(--color-accent-fg)] text-white font-medium'
            : 'text-[var(--color-text-tertiary)]'
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

// Category Section with expandable feeds - Planneer-style
function CategorySection({
  category,
  feeds,
  counters,
  expanded,
  onToggle,
  onSelectCategory,
  onSelectFeed,
  onEditFeed,
  currentFeedId,
  currentCategoryId,
}: {
  category: Category;
  feeds: Feed[];
  counters: FeedCounters | null;
  expanded: boolean;
  onToggle: () => void;
  onSelectCategory: () => void;
  onSelectFeed: (feedId: number) => void;
  onEditFeed?: (feed: Feed) => void;
  currentFeedId: number | null;
  currentCategoryId: number | null;
}) {
  const unreadCount = counters
    ? feeds.reduce((sum, f) => sum + (counters.unreads[f.id] || 0), 0)
    : 0;

  const isCategoryActive = currentCategoryId === category.id && currentFeedId === null;

  return (
    <div>
      {/* Category Header - Click to select, toggle on right */}
      <div
        className={cn(
          'group w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer',
          isCategoryActive 
            ? 'glass-item text-[var(--color-text-primary)]'
            : 'glass-item-subtle text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
        )}
      >
        {/* Icon */}
        <FolderOpen size={16} className="flex-shrink-0 text-[var(--color-text-tertiary)]" />
        
        {/* Label - Click to select category */}
        <button
          onClick={onSelectCategory}
          className="flex-1 truncate text-left"
        >
          {category.title}
        </button>
        
        {/* Unread count */}
        {unreadCount > 0 && (
          <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums">{unreadCount}</span>
        )}
        
        {/* Hover actions */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); /* TODO: Add feed to category */ }}
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
            title="Add feed"
          >
            <Plus size={12} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>
        
        {/* Expand/collapse toggle - far right */}
        {feeds.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors flex-shrink-0"
          >
            <ChevronDown 
              size={14} 
              className={cn(
                'text-[var(--color-text-tertiary)] transition-transform duration-300 transition-spring',
                !expanded && '-rotate-90'
              )} 
            />
          </button>
        )}
      </div>
      
      {/* Feeds List - Nested tree items */}
      {expanded && feeds.length > 0 && (
        <div className="space-y-0.5 mt-0.5">
          {feeds.map(feed => {
            const feedUnread = counters?.unreads[feed.id] || 0;
            const isActive = currentFeedId === feed.id;
            
            return (
              <div
                key={feed.id}
                onClick={() => onSelectFeed(feed.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onEditFeed?.(feed);
                }}
                style={{ paddingLeft: '28px' }}
                className={cn(
                  'group w-full flex items-center gap-2 pr-2 py-1.5 rounded-lg text-left text-sm font-medium transition-all cursor-pointer',
                  isActive
                    ? 'glass-item text-[var(--color-text-primary)]'
                    : 'glass-item-subtle text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
                )}
              >
                <FeedIcon 
                  feedId={feed.id} 
                  iconId={feed.icon?.icon_id} 
                  size={14} 
                />
                <span className="truncate flex-1">{feed.title}</span>
                {feedUnread > 0 && (
                  <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums">
                    {feedUnread}
                  </span>
                )}
                
                {/* Hover actions for feed */}
                <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
                  <button
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      onEditFeed?.(feed); 
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
                    title="Feed options"
                  >
                    <MoreHorizontal size={12} className="text-[var(--color-text-secondary)]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AppSidebar;
