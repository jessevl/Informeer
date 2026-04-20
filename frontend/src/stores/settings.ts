/**
 * Settings Store
 * Global app settings with Zustand - controls theme, accent color, view modes
 * Based on Planneer's settingsStore pattern
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_ARTICLE_TYPOGRAPHY, normalizeArticleTypographySettings } from '@/lib/typography';
import type { TypographySettings } from '@/lib/typography';

export type Theme = 'system' | 'light' | 'dark';
export type ThemeVariant = 'warm' | 'cool';

/**
 * Accent color options for UI elements like FAB, buttons, focus rings
 * null = use theme default (coral for warm, blue for cool)
 */
export type AccentColor = 'coral' | 'amber' | 'blue' | 'green' | 'red' | 'purple' | 'pink' | 'teal' | 'stone' | null;

/** EPUB reader colour palettes */
export type EpubReaderTheme = 'light' | 'sepia' | 'dark' | 'eink' | 'eink-dark';

/**
 * View modes for the entry list
 */
export type ViewMode = 'list' | 'cards' | 'magazine';

const DEFAULT_VIEW_MODES_BY_SCOPE: Record<string, ViewMode> = {
  home: 'list',
  audio: 'list',
  video: 'cards',
  starred: 'list',
};

function normalizeViewMode(mode: unknown): ViewMode {
  return mode === 'cards' || mode === 'magazine' ? mode : 'list';
}

function normalizeViewModesByScope(value: unknown): Record<string, ViewMode> {
  if (!value || typeof value !== 'object') {
    return DEFAULT_VIEW_MODES_BY_SCOPE;
  }

  const scopedModes = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries({
      ...DEFAULT_VIEW_MODES_BY_SCOPE,
      ...scopedModes,
    }).map(([scope, mode]) => [scope, normalizeViewMode(mode)]),
  );
}

interface SettingsState {
  // Appearance
  theme: Theme;
  themeVariant: ThemeVariant;
  einkMode: boolean;
  einkPowerSavingEnabled: boolean;
  einkDebugPanelEnabled: boolean;
  accentColor: AccentColor;
  
  // Entry List
  viewMode: ViewMode;
  viewModesByScope: Record<string, ViewMode>;
  magazineExcerptLines: number; // 3-10 lines for magazine view
  cardsExcerptLines: number; // 2-6 lines for cards view
  
  // Reading
  showArticleImages: boolean;
  articleTypography: TypographySettings;
  
  // Magazines
  hideAdsInMagazines: boolean; // Automatically detect and skip full-page ads in PDF magazines
  adDetectionThreshold: number; // Confidence threshold (0–100) for ad classification

  // EPUB reader
  epubLightTheme: EpubReaderTheme;   // reader palette when app is in light mode
  epubDarkTheme: EpubReaderTheme;    // reader palette when app is in dark mode

  // Media category assignments (Informeer category IDs)
  // When set, the corresponding tab appears in navigation
  audioCategoryId: number | null;
  videoCategoryId: number | null;
  magazinesCategoryId: number | null;

  // Offline mode — when true, only show offline-available content
  offlineMode: boolean;
  recentOfflineBooksLimit: number;
  recentOfflineMagazinesLimit: number;

  // Behavior
  confirmMarkAllRead: boolean; // Ask before marking all as read
  showReadingTime: boolean;    // Show estimated reading time on articles
  
  // Actions
  setTheme: (theme: Theme) => void;
  setThemeVariant: (variant: ThemeVariant) => void;
  setEinkMode: (enabled: boolean) => void;
  setEinkPowerSavingEnabled: (enabled: boolean) => void;
  setEinkDebugPanelEnabled: (enabled: boolean) => void;
  setAccentColor: (color: AccentColor) => void;
  setViewMode: (mode: ViewMode) => void;
  setViewModeForScope: (scope: string, mode: ViewMode) => void;
  getViewModeForScope: (scope: string) => ViewMode;
  setMagazineExcerptLines: (lines: number) => void;
  setCardsExcerptLines: (lines: number) => void;
  setShowArticleImages: (show: boolean) => void;
  setArticleTypography: (settings: TypographySettings) => void;
  setHideAdsInMagazines: (hide: boolean) => void;
  setAdDetectionThreshold: (threshold: number) => void;
  setEpubLightTheme: (theme: EpubReaderTheme) => void;
  setEpubDarkTheme: (theme: EpubReaderTheme) => void;
  setAudioCategoryId: (id: number | null) => void;
  setVideoCategoryId: (id: number | null) => void;
  setMagazinesCategoryId: (id: number | null) => void;
  setOfflineMode: (enabled: boolean) => void;
  setRecentOfflineBooksLimit: (limit: number) => void;
  setRecentOfflineMagazinesLimit: (limit: number) => void;
  setConfirmMarkAllRead: (v: boolean) => void;
  setShowReadingTime: (v: boolean) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS = {
  theme: 'system' as Theme,
  themeVariant: 'warm' as ThemeVariant,
  einkMode: false,
  einkPowerSavingEnabled: true,
  einkDebugPanelEnabled: false,
  accentColor: null as AccentColor,
  viewMode: 'list' as ViewMode,
  viewModesByScope: DEFAULT_VIEW_MODES_BY_SCOPE,
  magazineExcerptLines: 5,
  cardsExcerptLines: 3,
  showArticleImages: true,
  articleTypography: DEFAULT_ARTICLE_TYPOGRAPHY,
  hideAdsInMagazines: false,
  adDetectionThreshold: 55,
  epubLightTheme: 'light' as EpubReaderTheme,
  epubDarkTheme: 'dark' as EpubReaderTheme,
  audioCategoryId: null as number | null,
  videoCategoryId: null as number | null,
  magazinesCategoryId: null as number | null,
  offlineMode: false,
  recentOfflineBooksLimit: 10,
  recentOfflineMagazinesLimit: 3,
  confirmMarkAllRead: true,
  showReadingTime: true,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setTheme: (theme) => set({ theme }),
      setThemeVariant: (variant) => set({ themeVariant: variant }),
      setEinkMode: (enabled) => set({ einkMode: enabled }),
      setEinkPowerSavingEnabled: (enabled) => set((state) => ({
        einkPowerSavingEnabled: enabled,
        einkDebugPanelEnabled: enabled ? state.einkDebugPanelEnabled : false,
      })),
      setEinkDebugPanelEnabled: (enabled) => set({ einkDebugPanelEnabled: enabled }),
      setAccentColor: (color) => set({ accentColor: color }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setViewModeForScope: (scope, mode) =>
        set((state) => ({
          viewMode: mode,
          viewModesByScope: {
            ...state.viewModesByScope,
            [scope]: mode,
          },
        })),
      getViewModeForScope: (scope) => normalizeViewMode(get().viewModesByScope[scope] ?? get().viewModesByScope['home']),
      setMagazineExcerptLines: (lines) => set({ magazineExcerptLines: Math.min(10, Math.max(3, lines)) }),
      setCardsExcerptLines: (lines) => set({ cardsExcerptLines: Math.min(6, Math.max(2, lines)) }),
      setShowArticleImages: (show) => set({ showArticleImages: show }),
      setArticleTypography: (settings) => set({ articleTypography: normalizeArticleTypographySettings(settings) }),
      setHideAdsInMagazines: (hide) => set({ hideAdsInMagazines: hide }),
      setAdDetectionThreshold: (threshold) => set({ adDetectionThreshold: Math.min(100, Math.max(0, threshold)) }),
      setEpubLightTheme: (theme) => set({ epubLightTheme: theme }),
      setEpubDarkTheme: (theme) => set({ epubDarkTheme: theme }),
      setAudioCategoryId: (id) => set({ audioCategoryId: id }),
      setVideoCategoryId: (id) => set({ videoCategoryId: id }),
      setMagazinesCategoryId: (id) => set({ magazinesCategoryId: id }),
      setOfflineMode: (enabled) => set({ offlineMode: enabled }),
      setRecentOfflineBooksLimit: (limit) => set({ recentOfflineBooksLimit: Math.max(0, Math.min(50, Math.round(limit))) }),
      setRecentOfflineMagazinesLimit: (limit) => set({ recentOfflineMagazinesLimit: Math.max(0, Math.min(20, Math.round(limit))) }),
      setConfirmMarkAllRead: (v) => set({ confirmMarkAllRead: v }),
      setShowReadingTime: (v) => set({ showReadingTime: v }),
      
      resetSettings: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'informeer-settings',
      version: 9,
      migrate: (persistedState: any, version) => {
        if (!persistedState) {
          return persistedState;
        }

        const legacyVariant = persistedState.themeVariant;

        if (version < 2) {
          return {
            ...persistedState,
            viewMode: normalizeViewMode(persistedState.viewMode),
            viewModesByScope: normalizeViewModesByScope(persistedState.viewModesByScope),
            articleTypography: normalizeArticleTypographySettings(persistedState.articleTypography),
            themeVariant: legacyVariant === 'cool' ? 'cool' : 'warm',
            einkMode: legacyVariant === 'eink' ? true : Boolean(persistedState.einkMode),
            einkPowerSavingEnabled: persistedState.einkPowerSavingEnabled ?? true,
            einkDebugPanelEnabled: persistedState.einkDebugPanelEnabled ?? DEFAULT_SETTINGS.einkDebugPanelEnabled,
            recentOfflineBooksLimit: persistedState.recentOfflineBooksLimit ?? DEFAULT_SETTINGS.recentOfflineBooksLimit,
            recentOfflineMagazinesLimit: persistedState.recentOfflineMagazinesLimit ?? DEFAULT_SETTINGS.recentOfflineMagazinesLimit,
          };
        }

        return {
          ...persistedState,
          viewMode: normalizeViewMode(persistedState.viewMode),
          viewModesByScope: normalizeViewModesByScope(persistedState.viewModesByScope),
          articleTypography: normalizeArticleTypographySettings(persistedState.articleTypography),
          einkPowerSavingEnabled: persistedState.einkPowerSavingEnabled ?? (persistedState.einkMode ? true : DEFAULT_SETTINGS.einkPowerSavingEnabled),
          einkDebugPanelEnabled: persistedState.einkDebugPanelEnabled ?? DEFAULT_SETTINGS.einkDebugPanelEnabled,
          recentOfflineBooksLimit: persistedState.recentOfflineBooksLimit ?? DEFAULT_SETTINGS.recentOfflineBooksLimit,
          recentOfflineMagazinesLimit: persistedState.recentOfflineMagazinesLimit ?? DEFAULT_SETTINGS.recentOfflineMagazinesLimit,
        };
      },
    }
  )
);

