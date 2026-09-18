/**
 * ReaderColorSchemePicker — page color scheme swatches for the EPUB reader.
 *
 * The reader remembers one scheme per app mode, so picking a swatch sets the
 * scheme for the mode that is active right now (light or dark). E-Ink mode
 * overrides the scheme, so the picker only shows a note there.
 */

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EPUB_READER_THEMES, EPUB_READER_THEME_CHOICES } from '@/lib/epub-reader-themes';
import type { EpubReaderTheme } from '@/lib/epub-reader-themes';

interface ReaderColorSchemePickerProps {
  value: EpubReaderTheme;
  onChange: (theme: EpubReaderTheme) => void;
  /** Whether the app is currently in dark mode (decides which slot is edited). */
  appIsDark: boolean;
  einkMode: boolean;
}

export function ReaderColorSchemePicker({ value, onChange, appIsDark, einkMode }: ReaderColorSchemePickerProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">
          Page Color
        </label>
        {!einkMode && (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {appIsDark ? 'For dark mode' : 'For light mode'}
          </span>
        )}
      </div>

      {einkMode ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Page colors follow E-Ink mode automatically.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {EPUB_READER_THEME_CHOICES.map((theme) => {
            const colors = EPUB_READER_THEMES[theme];
            const selected = value === theme;
            return (
              <button
                key={theme}
                onClick={() => onChange(theme)}
                title={colors.label}
                aria-pressed={selected}
                className="group flex flex-col items-center gap-1 outline-none"
              >
                <span
                  className={cn(
                    'relative flex items-center justify-center w-full aspect-[4/3] rounded-xl',
                    'border transition-all',
                    selected
                      ? 'border-transparent ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface-primary)]'
                      : 'border-[var(--color-border-default)] group-hover:scale-[1.04] group-focus-visible:ring-2 group-focus-visible:ring-[var(--color-accent)]',
                  )}
                  style={{ backgroundColor: colors.bg, color: colors.fg }}
                >
                  <span className="text-sm font-serif font-medium leading-none">Aa</span>
                  {selected && (
                    <span
                      className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-[var(--color-accent)] text-white shadow"
                    >
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'text-[11px] leading-none',
                    selected ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-tertiary)]',
                  )}
                >
                  {colors.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
