/**
 * TypographyPanel — Advanced typography & typesetting settings flyout
 *
 * Controls: font family, font size, line height, margins, text alignment,
 * paragraph spacing, hyphenation, and an "Original" preset that resets
 * all overrides to the epub's native styling.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { X, RotateCcw, Type } from 'lucide-react';
import { EPUB_FONT_OPTIONS } from '@/lib/epub-fonts';
import { getTypographyFontFamily, DEFAULT_TYPOGRAPHY } from '@/lib/typography';
import type { TypographySettings } from '@/lib/typography';

export type { TypographySettings } from '@/lib/typography';
export { DEFAULT_TYPOGRAPHY } from '@/lib/typography';

interface TypographyPanelProps {
  settings: TypographySettings;
  onChange: (settings: TypographySettings) => void;
  onClose: () => void;
  isDarkMode: boolean;
  className?: string;
  topOffset?: string;
  fontOptions?: ReadonlyArray<{ value: string; label: string }>;
  originalFormattingTitle?: string;
  defaultSettings?: TypographySettings;
  showMarginControls?: boolean;
  showMaxWidthControl?: boolean;
}

export function TypographyPanel({
  settings,
  onChange,
  onClose,
  isDarkMode,
  className,
  topOffset = '3rem',
  fontOptions = EPUB_FONT_OPTIONS,
  originalFormattingTitle = 'Use original formatting',
  defaultSettings = DEFAULT_TYPOGRAPHY,
  showMarginControls = true,
  showMaxWidthControl = false,
}: TypographyPanelProps) {
  const update = (partial: Partial<TypographySettings>) => {
    onChange({ ...settings, ...partial, preset: 'custom' });
  };

  const resetToOriginal = () => {
    onChange({
      ...defaultSettings,
      preset: 'original',
      fontFamily: 'original',
      textAlign: 'original',
    });
  };

  const isOriginal = settings.preset === 'original';

  return (
    <div
      className={cn(
        'absolute right-0 bottom-0 z-40 w-80 max-w-[90vw]',
        'bg-[var(--color-surface-primary)] border-l border-[var(--color-border-default)]',
        'shadow-xl overflow-y-auto',
        'animate-fade-in',
        className,
      )}
      style={{ top: topOffset }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2">
          <Type size={16} className="text-[var(--color-text-secondary)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Typography</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={resetToOriginal}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors',
              isOriginal
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]',
            )}
            title={originalFormattingTitle}
          >
            <RotateCcw size={12} />
            Original
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <X size={16} className="text-[var(--color-text-tertiary)]" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Font Family */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
            Font
          </label>
          <select
            value={settings.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value })}
            className={cn(
              'w-full px-3 py-2 text-sm rounded-lg',
              'bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]',
              'border border-[var(--color-border-default)]',
              'outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]',
              isOriginal && 'opacity-60',
            )}
          >
            {fontOptions.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <SliderSetting
          label="Font Size"
          value={settings.fontSize}
          min={60}
          max={200}
          step={5}
          format={(v) => `${v}%`}
          onChange={(fontSize) => update({ fontSize })}
          muted={isOriginal}
        />

        {/* Line Height */}
        <SliderSetting
          label="Line Height"
          value={settings.lineHeight}
          min={1.0}
          max={3.0}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(lineHeight) => update({ lineHeight })}
          muted={isOriginal}
        />

        {showMaxWidthControl && (
          <SliderSetting
            label="Content Width"
            value={settings.maxWidth}
            min={480}
            max={1440}
            step={24}
            format={(v) => `${v}px`}
            onChange={(maxWidth) => update({ maxWidth })}
            muted={isOriginal}
          />
        )}

        {showMarginControls && (
          <>
            {/* Margin */}
            <SliderSetting
              label="Side Margin"
              value={settings.margin}
              min={0}
              max={120}
              step={8}
              format={(v) => `${v}px`}
              onChange={(margin) => update({ margin })}
              muted={isOriginal}
            />

            {/* Vertical Margin */}
            <SliderSetting
              label="Top & Bottom"
              value={settings.verticalMargin}
              min={0}
              max={80}
              step={4}
              format={(v) => `${v}px`}
              onChange={(verticalMargin) => update({ verticalMargin })}
              muted={isOriginal}
            />
          </>
        )}

        {/* Paragraph Spacing */}
        <SliderSetting
          label="Paragraph Spacing"
          value={settings.paragraphSpacing}
          min={0}
          max={3}
          step={0.25}
          format={(v) => `${v}x`}
          onChange={(paragraphSpacing) => update({ paragraphSpacing })}
          muted={isOriginal}
        />

        {/* Text Alignment */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
            Text Alignment
          </label>
          <div className="flex gap-1">
            {[
              { value: 'original', label: 'Auto' },
              { value: 'left', label: 'Left' },
              { value: 'justify', label: 'Justify' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ textAlign: opt.value })}
                className={cn(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  settings.textAlign === opt.value
                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                    : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
                  isOriginal && settings.textAlign !== opt.value && 'opacity-60',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hyphenation */}
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Hyphenation
          </label>
          <button
            onClick={() => update({ hyphenation: !settings.hyphenation })}
            className={cn(
              'relative w-10 h-5 rounded-full transition-colors',
              settings.hyphenation
                ? 'bg-[var(--color-accent)]'
                : 'bg-[var(--color-surface-tertiary)]',
              isOriginal && 'opacity-60',
            )}
          >
            <div
              className={cn(
                'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                settings.hyphenation ? 'translate-x-5' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>

        {/* Preview indicator */}
        <div className={cn(
          'p-3 rounded-lg text-xs leading-relaxed',
          'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)]',
        )}
          style={{
            fontFamily: getTypographyFontFamily(settings.fontFamily),
            fontSize: `${settings.fontSize * 0.12}px`,
            lineHeight: settings.lineHeight,
            maxWidth: showMaxWidthControl ? `${Math.min(settings.maxWidth * 0.18, 260)}px` : undefined,
            textAlign: settings.textAlign === 'original' ? undefined : (settings.textAlign as any),
            hyphens: settings.hyphenation ? 'auto' : 'manual',
            padding: showMarginControls
              ? `${Math.min((settings.verticalMargin ?? 0) * 0.3, 12)}px ${Math.min(settings.margin * 0.3, 20)}px`
              : '12px',
            marginInline: 'auto',
          }}
        >
          The quick brown fox jumps over the lazy dog. Typography is the art and technique
          of arranging type to make written language legible, readable, and appealing when displayed.
        </div>
      </div>
    </div>
  );
}

// ---------- Slider sub-component ----------

function SliderSetting({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
  muted,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={disabled ? 'opacity-40 pointer-events-none' : muted ? 'opacity-60' : undefined}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">
          {label}
        </label>
        <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 accent-[var(--color-accent)]"
      />
    </div>
  );
}
