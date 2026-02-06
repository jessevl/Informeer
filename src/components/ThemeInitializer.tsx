/**
 * ThemeInitializer Component
 * Syncs theme settings from Zustand store to DOM
 * Based on Planneer's ThemeInitializer
 */

import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settings';

// All possible accent color classes
const ACCENT_CLASSES = ['accent-amber', 'accent-blue', 'accent-green', 'accent-red', 'accent-purple', 'accent-pink', 'accent-teal', 'accent-stone'];

export default function ThemeInitializer() {
  const theme = useSettingsStore((s) => s.theme);
  const themeVariant = useSettingsStore((s) => s.themeVariant);
  const accentColor = useSettingsStore((s) => s.accentColor);

  // Handle theme variant (warm vs cool) and accent color together
  // They need to be applied together for proper specificity
  useEffect(() => {
    const root = document.documentElement;
    
    // Remove any existing variant and accent classes first
    root.classList.remove('theme-warm', 'theme-cool');
    ACCENT_CLASSES.forEach(cls => root.classList.remove(cls));
    
    // Add the current variant class (only 'cool' needs a class, 'warm' is default)
    if (themeVariant === 'cool') {
      root.classList.add('theme-cool');
    }
    
    // Determine the effective accent: use explicit choice or theme default
    const effectiveAccent = accentColor ?? (themeVariant === 'cool' ? 'blue' : 'stone');
    root.classList.add(`accent-${effectiveAccent}`);
    
    // Log for debugging
    console.log('[ThemeInitializer] Applied:', { themeVariant, accentColor, effectiveAccent, classes: root.className });
  }, [accentColor, themeVariant]);

  // Handle light/dark theme
  useEffect(() => {
    const root = document.documentElement;
    const apply = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      console.log('[ThemeInitializer] Dark mode:', isDark);
    };
    
    if (theme === 'dark') {
      apply(true);
      return;
    }
    if (theme === 'light') {
      apply(false);
      return;
    }
    // system: follow prefers-color-scheme
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    apply(mql.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, [theme]);

  return null;
}
