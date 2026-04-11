/**
 * ReaderProgressBar — Shared bottom progress bar for page-based readers
 *
 * Shows: current page/label, slider, total pages, optional markers.
 */

import { cn } from '@/lib/utils';

interface ProgressMarker {
  position: number; // 0..1
  color: string;
  key: string;
}

interface ReaderProgressBarProps {
  /** Current position (1-based page number, or any numeric position) */
  currentPosition: number;
  /** Total positions (total pages) */
  totalPositions: number;
  /** Label displayed left side (e.g. "Page 5" or "Ch. 3") */
  label?: string;
  /** Secondary label (e.g. "5 min left") */
  secondaryLabel?: string;
  /** Label displayed right side next to total (e.g. "12 min left") */
  rightLabel?: string;
  /** Called when slider changes */
  onPositionChange: (position: number) => void;
  /** Optional highlight marker (e.g. "last read" position) */
  highlightPosition?: number;
  /** Optional array of markers on the slider track */
  markers?: ProgressMarker[];
  /** Extra class on the container */
  className?: string;
}

export function ReaderProgressBar({
  currentPosition,
  totalPositions,
  label,
  secondaryLabel,
  rightLabel,
  onPositionChange,
  highlightPosition,
  markers,
  className,
}: ReaderProgressBarProps) {
  if (totalPositions <= 0) return null;

  return (
    <div
      className={cn(
        'px-4 py-3',
        'bg-[var(--color-surface-primary)]',
        'border-t border-[var(--color-border-default)]',
        'reader-overlay-surface',
        className,
      )}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end min-w-[3rem]">
          <span className="text-xs text-[var(--color-text-tertiary)] text-right">
            {label || currentPosition}
          </span>
          {secondaryLabel && (
            <span className="text-[10px] text-[var(--color-text-tertiary)] opacity-70">
              {secondaryLabel}
            </span>
          )}
        </div>

        <div className="relative flex-1">
          <input
            type="range"
            min={1}
            max={totalPositions}
            value={currentPosition}
            onChange={(e) => onPositionChange(parseInt(e.target.value, 10))}
            className="w-full h-1 accent-[var(--color-accent)]"
          />

          {/* Highlight marker (e.g. "last read") */}
          {highlightPosition != null && highlightPosition > 0 && highlightPosition < totalPositions && (
            <div
              className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${((highlightPosition - 1) / (totalPositions - 1)) * 100}%` }}
            >
              <div className="w-1.5 h-3 bg-[var(--color-accent)] rounded-full opacity-60 -translate-x-1/2" />
            </div>
          )}

          {/* Custom markers */}
          {markers?.map((m) => (
            <div
              key={m.key}
              className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${m.position * 100}%` }}
            >
              <div
                className="w-1 h-2 rounded-full opacity-40 -translate-x-1/2"
                style={{ backgroundColor: m.color }}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-col items-start min-w-[2rem]">
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {totalPositions}
          </span>
          {rightLabel && (
            <span className="text-[10px] text-[var(--color-text-tertiary)] opacity-70">
              {rightLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
