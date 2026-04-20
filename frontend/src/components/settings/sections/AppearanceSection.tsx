/**
 * Appearance Section
 * Theme, colors, feed list display, book reader palettes
 * All client-side settings (auto-persisted via zustand)
 */

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useSettingsStore,
  type Theme,
  type ThemeVariant,
  type AccentColor,
  type ViewMode,
  type EpubReaderTheme,
} from '@/stores/settings';
import {
  SegmentedControl,
  ToggleRow,
  SliderRow,
  SectionHeader,
  Separator,
} from '../ui';
import { einkPower } from '@/services/eink-power';

// ── Accent color palette ──────────────────────────────────────────────────────

const accentOptions: { value: AccentColor; label: string; color: string; darkColor: string }[] = [
  { value: null, label: 'Auto', color: '#E8705F', darkColor: '#F0887A' },
  { value: 'coral', label: 'Coral', color: '#E8705F', darkColor: '#F0887A' },
  { value: 'amber', label: 'Amber', color: '#f59e0b', darkColor: '#fbbf24' },
  { value: 'blue', label: 'Blue', color: '#3b82f6', darkColor: '#58a6ff' },
  { value: 'green', label: 'Green', color: '#22c55e', darkColor: '#4ade80' },
  { value: 'red', label: 'Red', color: '#ef4444', darkColor: '#f87171' },
  { value: 'purple', label: 'Purple', color: '#a855f7', darkColor: '#c084fc' },
  { value: 'pink', label: 'Pink', color: '#ec4899', darkColor: '#f472b6' },
  { value: 'teal', label: 'Teal', color: '#14b8a6', darkColor: '#2dd4bf' },
  { value: 'stone', label: 'Stone', color: '#78716c', darkColor: '#a8a29e' },
];

// ── Component ─────────────────────────────────────────────────────────────────

const AppearanceSection: React.FC = () => {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const themeVariant = useSettingsStore((s) => s.themeVariant);
  const setThemeVariant = useSettingsStore((s) => s.setThemeVariant);
  const einkMode = useSettingsStore((s) => s.einkMode);
  const setEinkMode = useSettingsStore((s) => s.setEinkMode);
  const einkPowerSavingEnabled = useSettingsStore((s) => s.einkPowerSavingEnabled);
  const setEinkPowerSavingEnabled = useSettingsStore((s) => s.setEinkPowerSavingEnabled);
  const einkDebugPanelEnabled = useSettingsStore((s) => s.einkDebugPanelEnabled);
  const setEinkDebugPanelEnabled = useSettingsStore((s) => s.setEinkDebugPanelEnabled);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const showArticleImages = useSettingsStore((s) => s.showArticleImages);
  const setShowArticleImages = useSettingsStore((s) => s.setShowArticleImages);
  const magazineExcerptLines = useSettingsStore((s) => s.magazineExcerptLines);
  const setMagazineExcerptLines = useSettingsStore((s) => s.setMagazineExcerptLines);
  const cardsExcerptLines = useSettingsStore((s) => s.cardsExcerptLines);
  const setCardsExcerptLines = useSettingsStore((s) => s.setCardsExcerptLines);
  const hideAdsInMagazines = useSettingsStore((s) => s.hideAdsInMagazines);
  const setHideAdsInMagazines = useSettingsStore((s) => s.setHideAdsInMagazines);
  const adDetectionThreshold = useSettingsStore((s) => s.adDetectionThreshold);
  const setAdDetectionThreshold = useSettingsStore((s) => s.setAdDetectionThreshold);
  const magazinesCategoryId = useSettingsStore((s) => s.magazinesCategoryId);
  const epubLightTheme = useSettingsStore((s) => s.epubLightTheme);
  const setEpubLightTheme = useSettingsStore((s) => s.setEpubLightTheme);
  const epubDarkTheme = useSettingsStore((s) => s.epubDarkTheme);
  const setEpubDarkTheme = useSettingsStore((s) => s.setEpubDarkTheme);
  const confirmMarkAllRead = useSettingsStore((s) => s.confirmMarkAllRead);
  const setConfirmMarkAllRead = useSettingsStore((s) => s.setConfirmMarkAllRead);
  const showReadingTime = useSettingsStore((s) => s.showReadingTime);
  const setShowReadingTime = useSettingsStore((s) => s.setShowReadingTime);

  // Auto accent label depends on variant
  const autoLabel = themeVariant === 'warm' ? 'coral' : 'blue';
  const adjustedAccentOptions = accentOptions.map((opt) =>
    opt.value === null
      ? {
          ...opt,
          color: themeVariant === 'warm' ? '#E8705F' : '#3b82f6',
          darkColor: themeVariant === 'warm' ? '#F0887A' : '#58a6ff',
        }
      : opt,
  );

  return (
    <div className="space-y-5">
      {/* ── Theme ──────────────────────────────────────────────────────── */}
      <SectionHeader title="Theme" />

      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--color-text-primary)]">Mode</span>
        <SegmentedControl<Theme>
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
          value={theme}
          onChange={setTheme}
        />
      </div>

      <ToggleRow
        label="E-Ink Mode"
        description="High-contrast monochrome mode for e-ink and e-paper screens"
        enabled={einkMode}
        onChange={setEinkMode}
      />

      {einkMode && einkPower.isHardwareSupported() && (
        <ToggleRow
          label="E-Ink Power Saving"
          description="Allow the native sleep and wake controller to hibernate stable reader surfaces"
          enabled={einkPowerSavingEnabled}
          onChange={setEinkPowerSavingEnabled}
        />
      )}

      {einkMode && einkPowerSavingEnabled && einkPower.isHardwareSupported() && (
        <ToggleRow
          label="E-Ink Debug Overlay"
          description="Show the floating sleep and wake diagnostics panel"
          enabled={einkDebugPanelEnabled}
          onChange={setEinkDebugPanelEnabled}
        />
      )}

      {!einkMode && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-[var(--color-text-primary)]">Palette</span>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                {themeVariant === 'warm' ? 'Paper-like warm neutrals' : 'Cool blues and grays'}
              </p>
            </div>
            <SegmentedControl<ThemeVariant>
              options={[
                { value: 'warm', label: 'Warm' },
                { value: 'cool', label: 'Cool' },
              ]}
              value={themeVariant}
              onChange={setThemeVariant}
            />
          </div>

          <div>
            <span className="text-sm text-[var(--color-text-primary)]">Accent Color</span>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {adjustedAccentOptions.map((opt) => {
                const isSelected = accentColor === opt.value;
                return (
                  <button
                    key={opt.value ?? 'auto'}
                    onClick={() => setAccentColor(opt.value)}
                    data-selected={isSelected}
                    aria-pressed={isSelected}
                    aria-label={`Use ${opt.label} accent color`}
                    className={cn(
                      'accent-swatch relative flex h-7 w-7 items-center justify-center rounded-full border transition-all',
                      isSelected
                        ? 'border-[var(--color-text-primary)] ring-2 ring-offset-2 ring-offset-[var(--color-surface-base)] ring-[var(--color-accent-primary)]'
                        : 'border-[var(--color-border-default)] hover:scale-110 hover:border-[var(--color-border-emphasis)]',
                    )}
                    style={{
                      background: `linear-gradient(135deg, ${opt.color} 0%, ${opt.darkColor} 100%)`,
                    }}
                    title={opt.label}
                  >
                    {isSelected && (
                      <span className="pointer-events-none flex h-4 w-4 items-center justify-center rounded-full bg-[rgba(0,0,0,0.45)] text-white">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">
              {accentColor === null
                ? `Auto (${autoLabel})`
                : accentColor.charAt(0).toUpperCase() + accentColor.slice(1)}
            </p>
          </div>
        </>
      )}

      <Separator />

      {/* ── Feed List Display ──────────────────────────────────────────── */}
      <SectionHeader title="Feed List" />

      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--color-text-primary)]">View Mode</span>
        <SegmentedControl<ViewMode>
          options={[
            { value: 'list', label: 'List' },
            { value: 'cards', label: 'Cards' },
            { value: 'magazine', label: 'Magazine' },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
      </div>

      <ToggleRow
        label="Show Article Images"
        description="Display cover images in cards and magazine view"
        enabled={showArticleImages}
        onChange={setShowArticleImages}
      />

      {viewMode === 'magazine' && (
        <SliderRow
          label="Excerpt Length"
          description="Lines shown in magazine layout"
          value={magazineExcerptLines}
          min={3}
          max={10}
          unit=" lines"
          onChange={setMagazineExcerptLines}
        />
      )}

      {viewMode === 'cards' && (
        <SliderRow
          label="Excerpt Length"
          description="Lines shown in card layout"
          value={cardsExcerptLines}
          min={2}
          max={6}
          unit=" lines"
          onChange={setCardsExcerptLines}
        />
      )}

      <ToggleRow
        label="Show Reading Time"
        description="Display estimated reading time on articles"
        enabled={showReadingTime}
        onChange={setShowReadingTime}
      />

      <ToggleRow
        label="Confirm Mark All Read"
        description="Ask for confirmation before marking all entries as read"
        enabled={confirmMarkAllRead}
        onChange={setConfirmMarkAllRead}
      />

      {/* Magazine ad detection - only if magazines module is active */}
      {magazinesCategoryId && (
        <>
          <Separator />
          <SectionHeader title="Magazines" />

          <ToggleRow
            label="Hide Full-Page Ads"
            description="Detect and skip advertisement pages in PDF magazines"
            enabled={hideAdsInMagazines}
            onChange={setHideAdsInMagazines}
          />

          {hideAdsInMagazines && (
            <SliderRow
              label="Detection Sensitivity"
              value={adDetectionThreshold}
              min={20}
              max={80}
              step={5}
              formatValue={(v) =>
                v <= 40 ? `Aggressive (${v})` : v <= 60 ? `Balanced (${v})` : `Conservative (${v})`
              }
              onChange={setAdDetectionThreshold}
            />
          )}
        </>
      )}

      <Separator />

      {/* ── Book Reader ────────────────────────────────────────────────── */}
      <SectionHeader title="Book Reader" />

      {einkMode ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">
          EPUB reader colors follow E-Ink mode automatically.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text-primary)]">Light Palette</span>
            <div className="flex gap-1.5">
              {([
                { value: 'light' as EpubReaderTheme, label: 'White', swatch: '#ffffff', border: true },
                { value: 'sepia' as EpubReaderTheme, label: 'Sepia', swatch: '#f4ecd8', border: false },
                { value: 'eink' as EpubReaderTheme, label: 'E-Ink', swatch: '#ffffff', border: true },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setEpubLightTheme(opt.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                    'bg-[var(--color-surface-secondary)]',
                    epubLightTheme === opt.value
                      ? 'ring-2 ring-offset-1 ring-offset-[var(--color-surface-base)] ring-[var(--color-accent-primary)]'
                      : 'hover:bg-[var(--color-surface-tertiary)]',
                  )}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full shadow-sm"
                    style={{
                      background: opt.swatch,
                      border: opt.border ? '1px solid var(--color-border-default)' : undefined,
                      boxShadow: opt.value === 'eink' ? 'inset 0 0 0 1px #111111' : undefined,
                    }}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text-primary)]">Dark Palette</span>
            <div className="flex gap-1.5">
              {([
                { value: 'dark' as EpubReaderTheme, label: 'Dark', swatch: '#1a1a1a' },
                { value: 'eink-dark' as EpubReaderTheme, label: 'E-Ink', swatch: '#000000' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setEpubDarkTheme(opt.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                    'bg-[var(--color-surface-secondary)]',
                    epubDarkTheme === opt.value
                      ? 'ring-2 ring-offset-1 ring-offset-[var(--color-surface-base)] ring-[var(--color-accent-primary)]'
                      : 'hover:bg-[var(--color-surface-tertiary)]',
                  )}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full shadow-sm"
                    style={{
                      background: opt.swatch,
                      boxShadow: opt.value === 'eink-dark' ? 'inset 0 0 0 1px #f5f5f5' : undefined,
                    }}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AppearanceSection;
