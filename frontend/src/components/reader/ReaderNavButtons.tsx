/**
 * ReaderNavButtons — Shared navigation arrows for page-based readers
 *
 * Positioned at vertical center of the parent container.
 * Shown on all screen sizes when the controls overlay is visible.
 */

import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ReaderNavButtonsProps {
  onPrev: () => void;
  onNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  className?: string;
}

export function ReaderNavButtons({
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  className,
}: ReaderNavButtonsProps) {
  return (
    <>
      <button
        onClick={onPrev}
        disabled={!canGoPrev}
        className={cn(
          'absolute left-4 top-1/2 -translate-y-1/2',
          'p-3 rounded-full transition-all',
          'bg-[var(--color-surface-primary)]',
          'border border-[var(--color-border-default)]',
          'shadow-lg',
          'hover:bg-[var(--color-surface-hover)]',
          'disabled:opacity-30 disabled:cursor-not-allowed',
          'text-[var(--color-text-secondary)]',
          'flex',
          'reader-overlay-surface',
          className,
        )}
      >
        <ChevronLeft size={24} />
      </button>

      <button
        onClick={onNext}
        disabled={!canGoNext}
        className={cn(
          'absolute right-4 top-1/2 -translate-y-1/2',
          'p-3 rounded-full transition-all',
          'bg-[var(--color-surface-primary)]',
          'border border-[var(--color-border-default)]',
          'shadow-lg',
          'hover:bg-[var(--color-surface-hover)]',
          'disabled:opacity-30 disabled:cursor-not-allowed',
          'text-[var(--color-text-secondary)]',
          'flex',
          'reader-overlay-surface',
          className,
        )}
      >
        <ChevronRight size={24} />
      </button>
    </>
  );
}
