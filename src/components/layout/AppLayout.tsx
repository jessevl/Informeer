/**
 * AppLayout Component
 * Main application layout with resizable panels (Planneer-style)
 * 
 * Structure:
 * - Sidebar (recessed, transparent background)
 * - Paper Surface (elevated content area with rounded corners and shadow)
 *   - Floating Header (glass-panel navigation)
 *   - Entry List Panel
 *   - Article Reader Panel
 * 
 * Mobile Layout:
 * - Full-screen content with floating bottom navigation
 * - Slide-out drawer for sidebar
 * - Full-screen article reader overlay
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { ResizeHandle } from '@frameer/components/ui';
import { useIsMobile, useIsTablet } from '@frameer/hooks/useMobileDetection';
import { UnifiedHeader } from './UnifiedHeader';
import { FloatingNavBar } from './FloatingNavBar';
import { MobileDrawer } from './MobileDrawer';
import { ViewTransition } from './ViewTransition';
import type { ViewMode } from '@/stores/settings';

// Navigation tab type for floating nav bar
export type NavTab = 'home' | 'audio' | 'video' | 'starred' | 'settings';

interface AppLayoutProps {
  sidebar: React.ReactNode;
  list: React.ReactNode;
  reader?: React.ReactNode;
  sidebarCollapsed?: boolean;
  onSidebarCollapse?: (collapsed: boolean) => void;
  // Header props
  headerTitle?: string;
  headerIcon?: React.ReactNode;
  onBack?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  // View mode
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  // Mobile navigation
  activeTab?: NavTab;
  onTabChange?: (tab: NavTab) => void;
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
}

// Layout constants (matching Planneer)
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 0;

const LIST_MIN_WIDTH = 280;
const LIST_MAX_WIDTH = 600;
const LIST_DEFAULT_WIDTH = 360;
const LIST_COMPACT_WIDTH = 320;

// LocalStorage keys
const STORAGE_SIDEBAR_WIDTH = 'informeer-sidebar-width';
const STORAGE_LIST_WIDTH = 'informeer-list-width';

export function AppLayout({
  sidebar,
  list,
  reader,
  sidebarCollapsed = false,
  onSidebarCollapse,
  headerTitle,
  headerIcon,
  onBack,
  onRefresh,
  isRefreshing,
  viewMode,
  onViewModeChange,
  activeTab = 'home',
  onTabChange,
  onOpenSettings,
  onOpenSearch,
}: AppLayoutProps) {
  // Mobile/Tablet detection
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isMobileOrTablet = isMobile || isTablet;
  
  // Mobile drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // Panel widths from localStorage with defaults
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const stored = localStorage.getItem(STORAGE_SIDEBAR_WIDTH);
    return stored ? parseInt(stored, 10) : SIDEBAR_DEFAULT_WIDTH;
  });

  const [listWidth, setListWidth] = useState(() => {
    if (typeof window === 'undefined') return LIST_DEFAULT_WIDTH;
    const stored = localStorage.getItem(STORAGE_LIST_WIDTH);
    return stored ? parseInt(stored, 10) : LIST_DEFAULT_WIDTH;
  });

  // Resizing state
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingList, setIsResizingList] = useState(false);
  
  // Refs for drag handling
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Save widths to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_SIDEBAR_WIDTH, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(STORAGE_LIST_WIDTH, String(listWidth));
  }, [listWidth]);

  // Sidebar resize handlers
  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // List resize handlers
  const handleListResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingList(true);
    startXRef.current = e.clientX;
    startWidthRef.current = listWidth;
  }, [listWidth]);

  // Mouse move handler (shared)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const delta = e.clientX - startXRef.current;
        const newWidth = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, startWidthRef.current + delta)
        );
        setSidebarWidth(newWidth);
      } else if (isResizingList) {
        const delta = e.clientX - startXRef.current;
        const newWidth = Math.min(
          LIST_MAX_WIDTH,
          Math.max(LIST_MIN_WIDTH, startWidthRef.current + delta)
        );
        setListWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingList(false);
    };

    if (isResizingSidebar || isResizingList) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar, isResizingList]);

  // Calculated widths
  const effectiveSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  // For magazine view, list takes full width (no reader panel)
  // For other views, use the user's resizable listWidth
  const isMagazineView = viewMode === 'magazine';
  const effectiveListWidth = isMagazineView ? '100%' : listWidth;

  // =========================================================================
  // MOBILE LAYOUT
  // =========================================================================
  if (isMobileOrTablet) {
    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--color-surface-app)]">
        {/* Mobile Floating Header */}
        <UnifiedHeader
          onBack={onBack}
          sidebarVisible={false}
          currentTitle={headerTitle}
          currentIcon={headerIcon}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          isMobile={true}
          onOpenSearch={onOpenSearch}
        />
        
        {/* Main Content Area - Full height minus nav bar */}
        <div className="flex-1 overflow-hidden relative">
          {/* List Content */}
          <div className={cn(
            'h-full overflow-y-auto',
            'bg-[var(--color-surface-secondary)]'
          )}>
            <ViewTransition transitionKey={headerTitle || 'home'}>
              {list}
            </ViewTransition>
          </div>
          
          {/* Article Reader - Full screen overlay on mobile */}
          {reader && (
            <div className={cn(
              'fixed inset-0 z-40',
              'bg-[var(--color-surface-primary)]',
              'animate-slide-up-full'
            )}>
              {reader}
            </div>
          )}
        </div>
        
        {/* Floating Navigation Bar - hide when reader is open */}
        {!reader && (
          <FloatingNavBar
            activeTab={activeTab}
            onTabChange={onTabChange}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
        )}
        
        {/* Mobile Drawer for Sidebar */}
        <MobileDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        >
          {sidebar}
        </MobileDrawer>
      </div>
    );
  }

  // =========================================================================
  // DESKTOP LAYOUT
  // =========================================================================
  return (
    <div className="h-screen w-screen flex overflow-hidden layout-background">
      {/* Sidebar Panel - Recessed behind paper surface, full height */}
      {!sidebarCollapsed && (
        <div 
          className="relative flex-shrink-0 sidebar-recessed"
          style={{ width: effectiveSidebarWidth }}
        >
          <div className="sidebar-content overflow-hidden" style={{ height: 'calc(100% - 12px)', marginTop: '6px', marginBottom: '6px' }}>
            {sidebar}
          </div>
          
          {/* Sidebar Resize Handle */}
          <ResizeHandle
            onMouseDown={handleSidebarResizeStart}
            className="right-0"
          />
        </div>
      )}

      {/* Paper Surface - Elevated content area */}
      <div className={cn(
        "flex-1 flex flex-col h-[calc(100%-16px)] min-w-0 relative",
        "paper-surface paper-surface-glow paper-surface-animate",
        "overflow-hidden"
      )}>
        {/* Content Area - Full height since header floats */}
        <div className="flex-1 flex min-h-0">
          {/* Entry List Panel - Slightly darker background */}
          {/* In magazine view, this takes full width */}
          <div 
            className={cn(
              "relative h-full",
              isMagazineView ? "flex-1" : "flex-shrink-0"
            )}
            style={isMagazineView ? undefined : { width: effectiveListWidth }}
          >
            {/* Floating Header - Glass panel over the list area ONLY */}
            <UnifiedHeader
              onBack={onBack}
              sidebarVisible={!sidebarCollapsed}
              onToggleSidebar={onSidebarCollapse ? () => onSidebarCollapse(!sidebarCollapsed) : undefined}
              currentTitle={headerTitle}
              currentIcon={headerIcon}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              onRefresh={onRefresh}
              isRefreshing={isRefreshing}
            />
            
            <div className={cn(
              'h-full overflow-hidden',
              'bg-[var(--color-surface-secondary)]',
              // Only show right border when reader is present (non-magazine views)
              reader && !isMagazineView ? 'border-r border-[var(--color-border-subtle)]' : '',
              // Round left corners when sidebar is collapsed
              sidebarCollapsed && 'rounded-tl-[12px]'
            )}>
              <ViewTransition transitionKey={headerTitle || 'home'}>
                {list}
              </ViewTransition>
            </div>

            {/* List Resize Handle - only show when not in magazine view */}
            {!isMagazineView && (
              <ResizeHandle
                onMouseDown={handleListResizeStart}
                className="right-0"
              />
            )}
          </div>

          {/* Article Reader Panel - has its own floating header */}
          {/* Only show in non-magazine views */}
          {reader && !isMagazineView && (
            <div className="flex-1 h-full min-w-0 overflow-hidden bg-[var(--color-surface-primary)]">
              {reader}
            </div>
          )}

          {/* Expand to fill when no reader (non-magazine views only) */}
          {!reader && !isMagazineView && (
            <div className="flex-1 h-full min-w-0 bg-[var(--color-surface-primary)]" />
          )}
        </div>
      </div>
    </div>
  );
}

export default AppLayout;
