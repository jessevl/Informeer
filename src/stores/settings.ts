/**
 * Settings Store
 * Global app settings with Zustand - controls theme, accent color, view modes
 * Based on Planneer's settingsStore pattern
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';
export type ThemeVariant = 'warm' | 'cool';

/**
 * Accent color options for UI elements like FAB, buttons, focus rings
 * null = use theme default (stone for warm, blue for cool)
 */
export type AccentColor = 'amber' | 'blue' | 'green' | 'red' | 'purple' | 'pink' | 'teal' | 'stone' | null;

/**
 * View modes for the entry list
 */
export type ViewMode = 'list' | 'cards' | 'magazine';

interface SettingsState {
  // Appearance
  theme: Theme;
  themeVariant: ThemeVariant;
  accentColor: AccentColor;
  
  // Entry List
  viewMode: ViewMode;
  magazineExcerptLines: number; // 3-10 lines for magazine view
  cardsExcerptLines: number; // 2-6 lines for cards view
  
  // Reading
  showArticleImages: boolean;
  autoReaderView: boolean; // Automatically fetch full content when opening articles
  
  // Actions
  setTheme: (theme: Theme) => void;
  setThemeVariant: (variant: ThemeVariant) => void;
  setAccentColor: (color: AccentColor) => void;
  setViewMode: (mode: ViewMode) => void;
  setMagazineExcerptLines: (lines: number) => void;
  setCardsExcerptLines: (lines: number) => void;
  setShowArticleImages: (show: boolean) => void;
  setAutoReaderView: (auto: boolean) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS = {
  theme: 'system' as Theme,
  themeVariant: 'cool' as ThemeVariant,
  accentColor: null as AccentColor,
  viewMode: 'list' as ViewMode,
  magazineExcerptLines: 5,
  cardsExcerptLines: 3,
  showArticleImages: true,
  autoReaderView: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      setTheme: (theme) => set({ theme }),
      setThemeVariant: (variant) => set({ themeVariant: variant }),
      setAccentColor: (color) => set({ accentColor: color }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setMagazineExcerptLines: (lines) => set({ magazineExcerptLines: Math.min(10, Math.max(3, lines)) }),
      setCardsExcerptLines: (lines) => set({ cardsExcerptLines: Math.min(6, Math.max(2, lines)) }),
      setShowArticleImages: (show) => set({ showArticleImages: show }),
      setAutoReaderView: (auto) => set({ autoReaderView: auto }),
      
      resetSettings: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'informeer-settings',
    }
  )
);

