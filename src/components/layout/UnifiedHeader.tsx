/**
 * UnifiedHeader Component
 * Floating glass-panel header for Informeer (Planneer-style)
 * 
 * Groups: [back button? + sidebar toggle + list title] [view mode] [refresh]
 * Positioned above the entry list panel
 * 
 * Mobile: Simplified header with menu button and search
 */

import { cn } from '@/lib/utils';
import {
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Rss,
  Star,
  Inbox,
  Clock,
  FolderOpen,
  List,
  LayoutGrid,
  Newspaper,
  ArrowLeft,
  Search,
} from 'lucide-react';
import type { ViewMode } from '@/stores/settings';

export interface BreadcrumbItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}

interface UnifiedHeaderProps {
  // Back button
  onBack?: () => void;
  
  // Sidebar toggle
  sidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  
  // Current view title
  currentTitle?: string;
  currentIcon?: React.ReactNode;
  
  // View mode
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  
  // Actions
  onRefresh?: () => void;
  isRefreshing?: boolean;
  
  // Mobile
  isMobile?: boolean;
  onOpenSearch?: () => void;
  
  // Styling
  className?: string;
}

export function UnifiedHeader({
  onBack,
  sidebarVisible = true,
  onToggleSidebar,
  currentTitle,
  currentIcon,
  viewMode = 'list',
  onViewModeChange,
  onRefresh,
  isRefreshing,
  isMobile = false,
  onOpenSearch,
  className,
}: UnifiedHeaderProps) {
  // Mobile header layout - floating glass panels like desktop
  if (isMobile) {
    return (
      <header className={cn(
        "absolute top-0 left-0 right-0 z-40 h-0 overflow-visible pointer-events-none",
        "pt-[env(safe-area-inset-top)]",
        className
      )}>
        <div className="flex items-center gap-2 px-3 py-3 pointer-events-auto">
          {/* LEFT GROUP: Title with optional icon */}
          <div className="glass-panel-nav flex items-center gap-1 px-2.5 py-1.5">
            {currentIcon && (
              <span className="text-[var(--color-text-tertiary)]">{currentIcon}</span>
            )}
            <span className="text-sm font-semibold text-[var(--color-text-primary)] max-w-[140px] truncate">
              {currentTitle || 'All Feeds'}
            </span>
          </div>
          
          {/* Spacer */}
          <div className="flex-1" />
          
          {/* VIEW MODE TOGGLE */}
          {onViewModeChange && (
            <div className="glass-panel-nav flex items-center gap-0.5 px-1 py-1">
              {([  
                { mode: 'list' as ViewMode, icon: List, label: 'List view' },
                { mode: 'cards' as ViewMode, icon: LayoutGrid, label: 'Card view' },
                { mode: 'magazine' as ViewMode, icon: Newspaper, label: 'Magazine view' },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => onViewModeChange(mode)}
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300 transition-spring",
                    viewMode === mode
                      ? "bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)] scale-110"
                      : "text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 active:scale-90"
                  )}
                  title={label}
                >
                  <Icon className="w-[16px] h-[16px]" strokeWidth={1.75} />
                </button>
              ))}
            </div>
          )}
          
          {/* Search button */}
          {onOpenSearch && (
            <div className="glass-panel-nav flex items-center px-1 py-1">
              <button
                onClick={onOpenSearch}
                className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 transition-colors"
                aria-label="Search"
              >
                <Search size={18} strokeWidth={1.75} />
              </button>
            </div>
          )}
          
          {/* Refresh button */}
          {onRefresh && (
            <div className="glass-panel-nav flex items-center px-1 py-1">
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full transition-colors",
                  "text-[var(--color-text-secondary)] hover:bg-white/10",
                  isRefreshing && "animate-spin"
                )}
                aria-label="Refresh"
              >
                <RefreshCw size={18} strokeWidth={1.75} />
              </button>
            </div>
          )}
          
        </div>
      </header>
    );
  }

  // Desktop header layout
  return (
    <header className={cn(
      "absolute top-0 left-0 right-0 z-40 h-0 overflow-visible pointer-events-none",
      className
    )}>
      <div className="flex items-center gap-3 px-3 py-3 pointer-events-auto">
        {/* LEFT GROUP: Back button + Sidebar toggle + list title */}
        <div className="glass-panel-nav flex items-center gap-0.5 px-1.5 py-1">
          {/* Back button (shows when onBack is provided) */}
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 transition-all"
              title="Back to Home"
            >
              <ArrowLeft className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </button>
          )}
          
          {/* Sidebar toggle */}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 transition-all"
              title={sidebarVisible ? "Close sidebar" : "Open sidebar"}
            >
              {sidebarVisible ? (
                <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.75} />
              ) : (
                <PanelLeftOpen className="w-[18px] h-[18px]" strokeWidth={1.75} />
              )}
            </button>
          )}

          {/* List title */}
          {currentTitle && (
            <div className="flex items-center gap-1.5 px-2 py-1">
              {currentIcon && (
                <span className="text-[var(--color-text-tertiary)]">{currentIcon}</span>
              )}
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                {currentTitle}
              </span>
            </div>
          )}
        </div>
        
        {/* Spacer to push remaining items right */}
        <div className="flex-1" />
        
        {/* VIEW MODE TOGGLE - to the right of title */}
        {onViewModeChange && (
          <div className="glass-panel-nav flex items-center gap-0.5 px-1.5 py-1">
            {([
              { mode: 'list' as ViewMode, icon: List, label: 'List view' },
              { mode: 'cards' as ViewMode, icon: LayoutGrid, label: 'Card view' },
              { mode: 'magazine' as ViewMode, icon: Newspaper, label: 'Magazine view' },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => onViewModeChange(mode)}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300 transition-spring",
                  viewMode === mode
                    ? "bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)] scale-110"
                    : "text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 active:scale-90"
                )}
                title={label}
              >
                <Icon className="w-[16px] h-[16px]" strokeWidth={1.75} />
              </button>
            ))}
          </div>
        )}

        {/* REFRESH - rightmost */}
        {onRefresh && (
          <div className="glass-panel-nav flex items-center px-1.5 py-1">
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full transition-all",
                "text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10",
                isRefreshing && "animate-spin"
              )}
              title="Refresh feeds"
            >
              <RefreshCw className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        )}

      </div>
    </header>
  );
}

// Helper function to get icon for view type
export function getViewIcon(viewType: 'unread' | 'starred' | 'today' | 'all' | 'feed' | 'category') {
  switch (viewType) {
    case 'unread':
      return <Inbox className="w-4 h-4" />;
    case 'starred':
      return <Star className="w-4 h-4" />;
    case 'today':
      return <Clock className="w-4 h-4" />;
    case 'all':
      return <Rss className="w-4 h-4" />;
    case 'feed':
      return <Rss className="w-4 h-4" />;
    case 'category':
      return <FolderOpen className="w-4 h-4" />;
    default:
      return <Rss className="w-4 h-4" />;
  }
}

export default UnifiedHeader;
