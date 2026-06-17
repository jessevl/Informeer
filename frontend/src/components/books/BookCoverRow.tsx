/**
 * BookCoverRow
 * Horizontally scrolling row of book covers.
 * Used by Up Next / Recently Added / Recently Finished on the Books home view.
 *
 * Desktop: hover-revealed left/right arrow buttons fade in over the row edges.
 * Mobile: native scroll with snap, arrows hidden.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BookCover } from './BookCover';
import type { Book, BookProgress } from '@/types/api';

interface BookCoverRowProps {
  books: Book[];
  progressCache: Record<number, BookProgress>;
  onOpenBook: (book: Book) => void;
}

export function BookCoverRow({
  books,
  progressCache,
  onOpenBook,
}: BookCoverRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const refreshScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    refreshScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', refreshScrollState, { passive: true });
    const ro = new ResizeObserver(refreshScrollState);
    ro.observe(el);
    window.addEventListener('resize', refreshScrollState);
    return () => {
      el.removeEventListener('scroll', refreshScrollState);
      ro.disconnect();
      window.removeEventListener('resize', refreshScrollState);
    };
  }, [refreshScrollState, books.length]);

  const scrollBy = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.6, 240);
    el.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  }, []);

  return (
    <div className="relative group">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollBy('left')}
          className={cn(
            'hidden sm:flex absolute left-2 top-[42%] -translate-y-1/2 z-10',
            'w-8 h-8 items-center justify-center rounded-full',
            'bg-[var(--color-surface-primary)]/85 backdrop-blur-md',
            'border border-[var(--color-border-default)] shadow',
            'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            'opacity-0 group-hover:opacity-100 transition-opacity duration-200'
          )}
          aria-label="Scroll left"
        >
          <ChevronLeft size={16} />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollBy('right')}
          className={cn(
            'hidden sm:flex absolute right-2 top-[42%] -translate-y-1/2 z-10',
            'w-8 h-8 items-center justify-center rounded-full',
            'bg-[var(--color-surface-primary)]/85 backdrop-blur-md',
            'border border-[var(--color-border-default)] shadow',
            'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            'opacity-0 group-hover:opacity-100 transition-opacity duration-200'
          )}
          aria-label="Scroll right"
        >
          <ChevronRight size={16} />
        </button>
      )}

      <div
        ref={scrollRef}
        className={cn(
          'flex gap-4 px-6 pb-2 overflow-x-auto snap-x',
          '[scrollbar-width:none] [-ms-overflow-style:none]',
          '[&::-webkit-scrollbar]:hidden'
        )}
      >
        {books.map((book) => {
          const progress = progressCache[book.id]?.percentage ?? 0;
          return (
            <button
              key={book.id}
              type="button"
              onClick={() => onOpenBook(book)}
              className={cn(
                'group/cell shrink-0 snap-start',
                'w-[110px] sm:w-[120px] flex flex-col gap-1.5',
                'text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interactive-ring)] rounded-lg'
              )}
            >
              <div
                className={cn(
                  'relative aspect-[2/3] rounded-lg overflow-hidden',
                  'shadow-md transition-all duration-200',
                  'group-hover/cell:shadow-lg group-hover/cell:scale-[1.03]',
                  'active:scale-[0.98]',
                  '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]'
                )}
              >
                <BookCover book={book} showProgress progress={progress} />
              </div>
              <div className="px-0.5">
                <h4 className="text-xs font-medium text-[var(--color-text-primary)] line-clamp-2 leading-tight">
                  {book.title}
                </h4>
                {book.author && (
                  <p className="text-[11px] text-[var(--color-text-tertiary)] line-clamp-1 mt-0.5">
                    {book.author}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
