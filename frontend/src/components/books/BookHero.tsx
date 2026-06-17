/**
 * BookHero
 * Featured "Currently Reading" card on the Books home view.
 *
 * Mobile (< sm): vertical stack, centered cover, full-width CTA.
 * Tablet (sm – lg): horizontal layout, modest cover, content beside it.
 * Desktop (lg+): generous layout with a larger cover, refined typography,
 * and a vertical column of secondary in-progress thumbs on the right.
 */

import { BookOpen, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BookCover, useBookCoverUrl } from './BookCover';
import type { Book, BookProgress } from '@/types/api';

interface BookHeroProps {
  book: Book;
  progress: BookProgress | undefined;
  onContinue: (book: Book) => void;
  secondaryInProgress: Book[];
  secondaryProgressMap: Record<number, BookProgress>;
  onOpenSecondary: (book: Book) => void;
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function BookHero({
  book,
  progress,
  onContinue,
  secondaryInProgress,
  secondaryProgressMap,
  onOpenSecondary,
}: BookHeroProps) {
  const pct = Math.round(Math.min(Math.max(progress?.percentage ?? 0, 0), 1) * 100);
  const backdropUrl = useBookCoverUrl(book);
  const lastReadLabel = formatRelativeTime(progress?.updated_at);
  const hasSecondary = secondaryInProgress.length > 0;

  return (
    <section className="px-4 sm:px-6 pt-4 pb-6 animate-scale-in">
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl',
          'border border-[var(--color-border-default)]',
          'bg-[var(--color-surface-secondary)]'
        )}
      >
        {/* Blurred cover backdrop */}
        <div className="absolute inset-0 -z-0 pointer-events-none">
          {backdropUrl && (
            <img
              key={book.id}
              src={backdropUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-50 dark:opacity-35 transition-opacity duration-500"
              draggable={false}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-surface-secondary)] via-[var(--color-surface-secondary)]/85 to-[var(--color-surface-secondary)]/50" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--color-surface-secondary)]/60" />
        </div>

        <div className="relative z-10 flex flex-col gap-5 sm:gap-6 p-5 sm:p-6 lg:p-8">
          <div className="flex flex-col sm:flex-row gap-5 sm:gap-7 items-center sm:items-start min-w-0">
            {/* Cover */}
            <button
              type="button"
              onClick={() => onContinue(book)}
              className={cn(
                'shrink-0 block aspect-[2/3] rounded-lg overflow-hidden',
                'w-[140px] sm:w-[160px] md:w-[180px] lg:w-[200px]',
                'shadow-[0_24px_50px_-14px_rgba(0,0,0,0.45)]',
                'ring-1 ring-black/5 dark:ring-white/10',
                'hover:scale-[1.02] active:scale-[0.98] transition-transform duration-300',
                '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]',
                'outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interactive-ring)]'
              )}
            >
              <BookCover book={book} priority />
            </button>

            {/* Text + CTA */}
            <div className="flex-1 min-w-0 flex flex-col justify-between text-center sm:text-left gap-4 sm:gap-5">
              <div className="space-y-2 min-w-0">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full',
                    'bg-[var(--color-accent-subtle)] text-[var(--color-accent-fg)]',
                    'text-[10px] uppercase tracking-[0.14em] font-semibold'
                  )}
                >
                  <BookOpen size={11} strokeWidth={2.25} />
                  Currently Reading
                </span>
                <h2 className="text-2xl sm:text-3xl lg:text-[2rem] font-semibold text-[var(--color-text-primary)] line-clamp-2 leading-tight tracking-tight">
                  {book.title}
                </h2>
                {book.author && (
                  <p className="text-sm sm:text-base text-[var(--color-text-secondary)] line-clamp-1">
                    {book.author}
                  </p>
                )}
                {progress?.chapter && (
                  <p className="text-xs sm:text-sm text-[var(--color-text-tertiary)] line-clamp-1 pt-1">
                    <span className="text-[var(--color-text-secondary)]/80">
                      Chapter ·
                    </span>{' '}
                    {progress.chapter}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--color-surface-inset)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent-fg)] transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-[var(--color-text-secondary)] tabular-nums">
                    {pct}%
                  </span>
                </div>

                <div className="flex items-center justify-center sm:justify-start gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => onContinue(book)}
                    className={cn(
                      'group/cta inline-flex items-center gap-2 px-4 py-2 rounded-full',
                      'bg-[var(--color-accent-fg)] text-[var(--color-surface-primary)]',
                      'text-sm font-medium shadow-md',
                      'hover:opacity-95 hover:-translate-y-[1px] active:scale-[0.98]',
                      'transition-all duration-200'
                    )}
                  >
                    <BookOpen size={15} strokeWidth={2} />
                    Continue Reading
                    <ArrowRight
                      size={14}
                      strokeWidth={2.25}
                      className="opacity-70 group-hover/cta:translate-x-0.5 transition-transform"
                    />
                  </button>
                  {lastReadLabel && (
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      Last read {lastReadLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Secondary in-progress: horizontal row, full hero width */}
          {hasSecondary && (
            <div className="flex flex-col gap-2.5 pt-1 border-t border-[var(--color-border-default)]/60">
              <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[var(--color-text-tertiary)]">
                Also Reading
              </p>
              <div
                className={cn(
                  'flex gap-3 sm:gap-4 overflow-x-auto pb-1 -mx-1 px-1',
                  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                )}
              >
                {secondaryInProgress.map((b) => (
                  <SecondaryThumb
                    key={b.id}
                    book={b}
                    progress={secondaryProgressMap[b.id]?.percentage ?? 0}
                    onClick={() => onOpenSecondary(b)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SecondaryThumb({
  book,
  progress,
  onClick,
}: {
  book: Book;
  progress: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={book.title}
      className={cn(
        'group/sec shrink-0 flex flex-col gap-1.5 text-left',
        'w-[68px] sm:w-[76px] lg:w-[84px]',
        'outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interactive-ring)] rounded-md'
      )}
    >
      <div
        className={cn(
          'relative aspect-[2/3] rounded-md overflow-hidden shadow',
          'ring-1 ring-black/5 dark:ring-white/10',
          'transition-transform duration-200',
          'group-hover/sec:scale-[1.04] active:scale-[0.97]',
          '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]'
        )}
      >
        <BookCover
          book={book}
          rounded="none"
          showProgress
          progress={progress}
          fallbackTitle={false}
        />
      </div>
      <span className="text-[10px] sm:text-[11px] text-[var(--color-text-tertiary)] line-clamp-2 leading-tight">
        {book.title}
      </span>
    </button>
  );
}
