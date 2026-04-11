/**
 * FloatingNavBar Component
 * Floating bottom navigation bar for mobile devices
 * Inspired by Planneer's mobile navigation design
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Home, Headphones, Video, Star, Menu, BookOpen, Library } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings';
import { useModulesStore } from '@/stores/modules';
import type { NavTab } from './AppLayout';

interface FloatingNavBarProps {
  activeTab?: NavTab;
  onTabChange?: (tab: NavTab) => void;
  onOpenDrawer?: () => void;
  onScrollToTop?: () => void;
  className?: string;
}

const ALL_NAV_ITEMS: { id: NavTab | 'menu'; icon: typeof Home; label: string }[] = [
  { id: 'menu', icon: Menu, label: 'Menu' },
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'audio', icon: Headphones, label: 'Audio' },
  { id: 'video', icon: Video, label: 'Video' },
  { id: 'magazines', icon: BookOpen, label: 'Magazines' },
  { id: 'books', icon: Library, label: 'Books' },
  { id: 'starred', icon: Star, label: 'Starred' },
];

export function FloatingNavBar({
  activeTab = 'home',
  onTabChange,
  onOpenDrawer,
  onScrollToTop,
  className,
}: FloatingNavBarProps) {
  const audioCategoryId = useSettingsStore(s => s.audioCategoryId);
  const videoCategoryId = useSettingsStore(s => s.videoCategoryId);
  const magazinesCategoryId = useSettingsStore(s => s.magazinesCategoryId);
  const booksEnabled = useModulesStore(s => s.modules.books);

  const navItems = useMemo(() => ALL_NAV_ITEMS.filter(item => {
    if (item.id === 'audio') return audioCategoryId != null;
    if (item.id === 'video') return videoCategoryId != null;
    if (item.id === 'magazines') return magazinesCategoryId != null;
    if (item.id === 'books') return booksEnabled;
    return true;
  }), [audioCategoryId, videoCategoryId, magazinesCategoryId, booksEnabled]);
  const handleTabClick = (tab: NavTab | 'menu') => {
    if (tab === 'menu') {
      onOpenDrawer?.();
    } else if (tab === activeTab) {
      // Tapping the already-active tab scrolls to top (iOS convention)
      onScrollToTop?.();
    } else {
      onTabChange?.(tab);
    }
  };

  return (
    <nav className={cn(
      'fixed bottom-0 left-0 right-0 z-50',
      'flex items-center justify-center',
      'pb-[max(12px,env(safe-area-inset-bottom))] pt-2 px-4',
      'pointer-events-none',
      'animate-slide-up',
      className
    )}>
      <div className={cn(
        'flex items-center gap-1',
        'glass-panel-nav',
        'px-2 py-1.5',
        'pointer-events-auto',
        'shadow-lg',
        'eink-shell-surface'
      )}>
        {navItems.map(({ id, icon: Icon, label }) => {
          // Menu is never active (it's an action button, not a tab)
          const isActive = id !== 'menu' && activeTab === id;
          return (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              className={cn(
                'flex items-center justify-center',
                'w-12 h-12 rounded-full',
                'transition-all duration-300 transition-spring',
                isActive
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)] scale-110'
                  : 'text-[var(--color-text-secondary)] hover:bg-white/10 active:scale-90 active:bg-white/20'
              )}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon 
                size={22} 
                strokeWidth={isActive ? 2 : 1.5}
                className={cn(
                  'transition-transform duration-300 transition-spring',
                  isActive && 'scale-110'
                )}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default FloatingNavBar;