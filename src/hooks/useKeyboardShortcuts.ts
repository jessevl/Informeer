/**
 * Keyboard Shortcuts Hook
 * Global keyboard shortcuts for the app
 */

import { useEffect, useCallback } from 'react';

interface KeyboardShortcutsOptions {
  // Navigation
  onNextEntry?: () => void;
  onPreviousEntry?: () => void;
  onOpenEntry?: () => void;
  onCloseEntry?: () => void;
  onToggleSidebar?: () => void;

  // Entry Actions
  onToggleRead?: () => void;
  onToggleStarred?: () => void;
  onOpenInBrowser?: () => void;
  onRefresh?: () => void;

  // Views
  onGoToUnread?: () => void;
  onGoToStarred?: () => void;
  onGoToAll?: () => void;
  onGoToToday?: () => void;

  // Search & Settings
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onShowHelp?: () => void;

  // Global state
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onNextEntry,
  onPreviousEntry,
  onOpenEntry,
  onCloseEntry,
  onToggleSidebar,
  onToggleRead,
  onToggleStarred,
  onOpenInBrowser,
  onRefresh,
  onGoToUnread,
  onGoToStarred,
  onGoToAll,
  onGoToToday,
  onOpenSearch,
  onOpenSettings,
  onShowHelp,
  enabled = true,
}: KeyboardShortcutsOptions) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle shortcuts when typing in inputs
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // Allow Escape in inputs
      if (e.key !== 'Escape') return;
    }

    // Cmd/Ctrl + K for search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      onOpenSearch?.();
      return;
    }

    // Don't process other shortcuts if modifier keys are pressed (except Shift for capital letters)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();

    switch (key) {
      // Navigation
      case 'j':
      case 'arrowdown':
        e.preventDefault();
        onNextEntry?.();
        break;
      case 'k':
      case 'arrowup':
        e.preventDefault();
        onPreviousEntry?.();
        break;
      case 'enter':
      case 'o':
        if (!e.shiftKey) {
          e.preventDefault();
          onOpenEntry?.();
        }
        break;
      case 'escape':
      case 'h':
        e.preventDefault();
        onCloseEntry?.();
        break;
      case '[':
        e.preventDefault();
        onToggleSidebar?.();
        break;

      // Entry Actions
      case 'm':
        e.preventDefault();
        onToggleRead?.();
        break;
      case 's':
      case 'd':
        if (e.key === 's' || e.key === 'd') {
          e.preventDefault();
          onToggleStarred?.();
        }
        break;
      case 'v':
        e.preventDefault();
        onOpenInBrowser?.();
        break;
      case 'r':
        e.preventDefault();
        onRefresh?.();
        break;

      // Search
      case '/':
        e.preventDefault();
        onOpenSearch?.();
        break;

      // Settings
      case ',':
        e.preventDefault();
        onOpenSettings?.();
        break;

      // Help
      case '?':
        e.preventDefault();
        onShowHelp?.();
        break;
    }

    // Handle G + letter combinations for navigation
    // This requires tracking the last key, simplified here
  }, [
    onNextEntry,
    onPreviousEntry,
    onOpenEntry,
    onCloseEntry,
    onToggleSidebar,
    onToggleRead,
    onToggleStarred,
    onOpenInBrowser,
    onRefresh,
    onGoToUnread,
    onGoToStarred,
    onGoToAll,
    onGoToToday,
    onOpenSearch,
    onOpenSettings,
    onShowHelp,
  ]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

// Keyboard shortcuts reference for help display
export const KEYBOARD_SHORTCUTS = [
  { category: 'Navigation', shortcuts: [
    { keys: ['J', '↓'], description: 'Next entry' },
    { keys: ['K', '↑'], description: 'Previous entry' },
    { keys: ['Enter', 'O'], description: 'Open entry' },
    { keys: ['Escape', 'H'], description: 'Close entry' },
    { keys: ['['], description: 'Toggle sidebar' },
  ]},
  { category: 'Entry Actions', shortcuts: [
    { keys: ['M'], description: 'Toggle read/unread' },
    { keys: ['S', 'D'], description: 'Toggle starred' },
    { keys: ['V'], description: 'Open in browser' },
    { keys: ['R'], description: 'Refresh feeds' },
  ]},
  { category: 'Global', shortcuts: [
    { keys: ['/', '⌘K'], description: 'Search' },
    { keys: [','], description: 'Settings' },
    { keys: ['?'], description: 'Show shortcuts' },
  ]},
];
