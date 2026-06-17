/**
 * BookCover Component
 * Shared cover renderer used by hero, rows, and grid.
 * Resolves cover URL (server or offline blob), falls back to a placeholder
 * with the book icon and title when no cover is available.
 */

import { useState } from 'react';
import { Book as BookIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/api/client';
import { useOfflineItem } from '@/stores/offline';
import { useCachedImageUrl } from '@/hooks/useCachedImageUrl';
import type { Book } from '@/types/api';

interface BookCoverProps {
  book: Book;
  className?: string;
  rounded?: 'lg' | 'xl' | 'none';
  showProgress?: boolean;
  progress?: number;
  priority?: boolean;
  fallbackTitle?: boolean;
}

export function BookCover({
  book,
  className,
  rounded = 'lg',
  showProgress = false,
  progress = 0,
  priority = false,
  fallbackTitle = true,
}: BookCoverProps) {
  const [imageError, setImageError] = useState(false);
  const offlineItem = useOfflineItem('book', String(book.id));
  const hasLibraryRecord = book.user_id > 0;

  const coverUrl = hasLibraryRecord
    ? api.getBookCoverUrl(book.id)
    : (offlineItem?.coverUrl || book.cover_path || '');

  const coverBlobUrl = useCachedImageUrl({
    cacheKey: offlineItem?.coverCacheKey,
    imageUrl: coverUrl,
    authenticated: hasLibraryRecord,
  });

  const radiusClass =
    rounded === 'none' ? '' : rounded === 'xl' ? 'rounded-xl' : 'rounded-lg';

  return (
    <div
      className={cn(
        'relative w-full h-full overflow-hidden bg-[var(--color-surface-tertiary)]',
        radiusClass,
        className
      )}
    >
      {coverBlobUrl && !imageError ? (
        <img
          src={coverBlobUrl}
          alt={book.title}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
          loading={priority ? 'eager' : 'lazy'}
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-[var(--color-text-tertiary)]">
          <BookIcon size={28} className="opacity-40" />
          {fallbackTitle && (
            <span className="text-[11px] text-center line-clamp-3 font-medium leading-tight">
              {book.title}
            </span>
          )}
        </div>
      )}

      {showProgress && progress > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
          <div
            className="h-full bg-[var(--color-accent-fg)] transition-all"
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Returns the URL/blob URL for the cover. Useful for backdrops where you want
 * the image source directly rather than the rendered component.
 */
export function useBookCoverUrl(book: Book): string | null {
  const offlineItem = useOfflineItem('book', String(book.id));
  const hasLibraryRecord = book.user_id > 0;

  const coverUrl = hasLibraryRecord
    ? api.getBookCoverUrl(book.id)
    : (offlineItem?.coverUrl || book.cover_path || '');

  return useCachedImageUrl({
    cacheKey: offlineItem?.coverCacheKey,
    imageUrl: coverUrl,
    authenticated: hasLibraryRecord,
  });
}
