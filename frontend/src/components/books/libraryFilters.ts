/**
 * Library filter / sort primitives shared by the LibraryToolbar (UI) and
 * BooksView (data wiring). Keeping these in one module avoids divergence
 * between the toolbar's option list and the filter logic that consumes it.
 */

import type { Book, BookProgress } from '@/types/api';

export type LibrarySortMode =
  | 'recent-activity'
  | 'recent-added'
  | 'title'
  | 'author';

export type LibraryFilterMode =
  | 'all'
  | 'unfinished'
  | 'unread'
  | 'reading'
  | 'finished'
  | 'offline';

export const SORT_LABELS: Record<LibrarySortMode, string> = {
  'recent-activity': 'Recently Read',
  'recent-added': 'Recently Added',
  title: 'Title',
  author: 'Author',
};

export const FILTER_OPTIONS: ReadonlyArray<{
  value: LibraryFilterMode;
  label: string;
}> = [
  { value: 'all', label: 'All' },
  { value: 'unfinished', label: 'Unfinished' },
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'finished', label: 'Finished' },
  { value: 'offline', label: 'Offline' },
];

/** Plain-English label per filter for the empty-results message. */
export const FILTER_EMPTY_LABELS: Record<LibraryFilterMode, string | null> = {
  all: null,
  unfinished: 'unfinished',
  unread: 'unread',
  reading: 'currently reading',
  finished: 'finished',
  offline: 'saved offline',
};

export function getBookPercentage(
  progressCache: Record<number, BookProgress>,
  bookId: number
): number {
  return progressCache[bookId]?.percentage ?? 0;
}

export function bookMatchesFilter(
  book: Book,
  filter: LibraryFilterMode,
  progressCache: Record<number, BookProgress>,
  offlineBookIds: ReadonlySet<string>
): boolean {
  const pct = getBookPercentage(progressCache, book.id);
  switch (filter) {
    case 'all':
      return true;
    case 'unfinished':
      return pct < 1;
    case 'unread':
      return pct === 0;
    case 'reading':
      return pct > 0 && pct < 1;
    case 'finished':
      return pct >= 1;
    case 'offline':
      return offlineBookIds.has(String(book.id));
  }
}
