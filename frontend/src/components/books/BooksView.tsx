/**
 * BooksView Component
 * Top-level Books page. Splits into two sub-views:
 *   - "Reading": Currently Reading hero, stats strip, Recently Added shelf
 *   - "Library": searchable & paginated grid of every book the user owns
 * A floating glass tab bar at the bottom of the viewport switches between
 * the two. Uploads (header buttons + drag&drop), Z-Library search, and
 * the EPUB reader overlay are unchanged.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Library,
  Upload,
  Search,
  Loader2,
  CloudOff,
  SearchX,
  ChevronDown,
  BookOpen,
} from 'lucide-react';
import { useBooksStore } from '@/stores/books';
import { useModulesStore } from '@/stores/modules';
import { BookGrid } from './BookGrid';
import { EPUBReader } from './EPUBReader';
import { ZLibSearch } from './ZLibSearch';
import { BookHero } from './BookHero';
import { ReadingStatsStrip } from './ReadingStatsStrip';
import { BookCoverRow } from './BookCoverRow';
import { BooksHomeSection } from './BooksHomeSection';
import { useBooksHomeData } from './useBooksHomeData';
import { LibraryToolbar } from './LibraryToolbar';
import {
  type LibrarySortMode,
  type LibraryFilterMode,
  FILTER_EMPTY_LABELS,
  bookMatchesFilter,
} from './libraryFilters';
import { SegmentedTabBar, type SegmentedTab } from '@/components/ui/SegmentedTabBar';

type BooksTab = 'reading' | 'library';
import { useOfflineRegistry } from '@/stores/offline';
import { useEffectiveOfflineState } from '@/hooks/useEffectiveOfflineState';
import { useIsMobile, useIsTablet } from '@frameer/hooks/useMobileDetection';

import type { Book } from '@/types/api';

const LIBRARY_PAGE_SIZE = 36;
// Approximate rendered height of the BooksTabBar glass pill; used to pad
// the scroll area so the last grid row never tucks under the floating bar.
const BOOKS_TAB_BAR_HEIGHT_PX = 52;

/**
 * Floating header actions for the Books section.
 * Rendered as glass-panel buttons in the UnifiedHeader.
 */
export function BookHeaderActions() {
  const uploadBook = useBooksStore(s => s.uploadBook);
  const zlibEnabled = useModulesStore(s => s.modules.booksZlib);
  const [isUploading, setIsUploading] = useState(false);
  const [zlibSearchOpen, setZlibSearchOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.name.toLowerCase().endsWith('.epub')) {
          await uploadBook(file);
        }
      }
    } catch { /* handled by store */ } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [uploadBook]);

  return (
    <>
      <div className="glass-panel-nav flex items-center gap-0.5 px-1.5 py-1">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-full transition-all',
            'text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10',
            isUploading && 'animate-spin'
          )}
          title="Upload EPUB"
        >
          {isUploading ? <Loader2 className="w-[18px] h-[18px]" strokeWidth={1.75} /> : <Upload className="w-[18px] h-[18px]" strokeWidth={1.75} />}
        </button>
        {zlibEnabled && (
          <button
            onClick={() => setZlibSearchOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 transition-all"
            title="Search Z-Library"
          >
            <Search className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub"
        multiple
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />
      <ZLibSearch isOpen={zlibSearchOpen} onClose={() => setZlibSearchOpen(false)} />
    </>
  );
}

export function BooksView() {
  const {
    books,
    isLoading,
    error,
    selectedBook,
    isReaderOpen,
    progressCache,
    recentBookActivity,
    highlights,
    yearlyBooksGoal,
    fetchBooks,
    uploadBook,
    deleteBook,
    openReader,
    closeReader,
    setYearlyBooksGoal,
  } = useBooksStore();

  // Active sub-view
  const [activeTab, setActiveTab] = useState<BooksTab>('reading');

  // Detect whether the bottom FloatingNavBar is rendered (mobile + tablet
  // layouts), so the tab bar can sit just above it.
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const hasFloatingNav = isMobile || isTablet;
  // CSS offset matching AppLayout's --app-navbar-offset for the current layout.
  const floatingNavOffsetCss = hasFloatingNav
    ? 'calc(72px + var(--safe-area-bottom))'
    : 'calc(max(var(--safe-area-bottom), 0px) + 12px)';
  // Where the BooksTabBar sits: just above the nav (or above the safe area on desktop).
  const tabBarBottomCss = `calc(${floatingNavOffsetCss} + 8px)`;
  // Bottom buffer for the scroll area: clear the tab bar + 12px breathing room.
  const scrollPaddingBottomCss = `calc(${floatingNavOffsetCss} + ${BOOKS_TAB_BAR_HEIGHT_PX}px + 20px)`;

  // Library sort/filter/search state
  const [sortBy, setSortBy] = useState<LibrarySortMode>('recent-activity');
  const [filterBy, setFilterBy] = useState<LibraryFilterMode>('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryPage, setLibraryPage] = useState(1);
  const { effectiveOffline } = useEffectiveOfflineState();
  const effectiveFilterBy: LibraryFilterMode = effectiveOffline ? 'offline' : filterBy;
  const offlineRegistry = useOfflineRegistry();
  const offlineFallbackBooks = useMemo<Book[]>(() => {
    return offlineRegistry
      .filter((item) => item.type === 'book')
      .flatMap((item) => {
        const bookId = Number(item.id);
        if (!Number.isFinite(bookId)) {
          return [];
        }

        const timestamp = new Date(item.savedAt).toISOString();
        return [{
          id: bookId,
          user_id: 0,
          title: item.title,
          author: item.author || '',
          publisher: '',
          language: '',
          description: '',
          cover_path: item.coverUrl || '',
          epub_path: item.cacheKey,
          file_size: item.sizeBytes,
          isbn: '',
          tags: [] as string[],
          metadata: { offlineOnly: 'true' },
          created_at: timestamp,
          updated_at: timestamp,
        } satisfies Book];
      });
  }, [offlineRegistry]);
  const displayedBooks = effectiveOffline && books.length === 0 ? offlineFallbackBooks : books;

  const booksTabs = useMemo<ReadonlyArray<SegmentedTab<BooksTab>>>(
    () => [
      { value: 'reading', label: 'Reading', icon: BookOpen },
      {
        value: 'library',
        label: 'Library',
        icon: Library,
        badge: displayedBooks.length,
      },
    ],
    [displayedBooks.length]
  );

  const home = useBooksHomeData({
    books: displayedBooks,
    progressCache,
    recentBookActivity,
    highlightsCount: highlights.length,
    yearlyBooksGoal,
  });

  const secondaryProgressMap = useMemo(() => {
    const map: Record<number, typeof progressCache[number]> = {};
    home.secondaryInProgress.forEach((b) => {
      if (progressCache[b.id]) map[b.id] = progressCache[b.id];
    });
    return map;
  }, [home.secondaryInProgress, progressCache]);

  // Fetch books on mount
  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  // Set of book IDs saved offline — computed once per registry change so the
  // 'offline' filter doesn't rebuild a Set on every input keystroke.
  const offlineBookIds = useMemo(
    () =>
      new Set(
        offlineRegistry.filter((i) => i.type === 'book').map((i) => i.id)
      ),
    [offlineRegistry]
  );

  // Sort & filter (library section)
  const sortedFilteredBooks = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    const filtered = displayedBooks.filter((b) => {
      if (q) {
        const matchesQuery =
          b.title.toLowerCase().includes(q) ||
          (b.author || '').toLowerCase().includes(q);
        if (!matchesQuery) return false;
      }
      return bookMatchesFilter(b, effectiveFilterBy, progressCache, offlineBookIds);
    });

    const toEpoch = (iso: string | null | undefined) => {
      if (!iso) return 0;
      const t = new Date(iso).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const getActivityTime = (book: Book) =>
      Math.max(
        toEpoch(recentBookActivity[book.id]),
        toEpoch(progressCache[book.id]?.updated_at)
      );

    switch (sortBy) {
      case 'title':
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'author':
        filtered.sort((a, b) =>
          (a.author || '').localeCompare(b.author || '')
        );
        break;
      case 'recent-added':
        filtered.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
      case 'recent-activity':
      default:
        filtered.sort((a, b) => {
          const diff = getActivityTime(b) - getActivityTime(a);
          if (diff !== 0) return diff;
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        });
        break;
    }

    return filtered;
  }, [
    displayedBooks,
    progressCache,
    recentBookActivity,
    sortBy,
    effectiveFilterBy,
    offlineBookIds,
    librarySearch,
  ]);

  // Reset pagination whenever the result set changes shape
  useEffect(() => {
    setLibraryPage(1);
  }, [sortBy, effectiveFilterBy, librarySearch]);

  const visibleLibraryBooks = useMemo(
    () => sortedFilteredBooks.slice(0, libraryPage * LIBRARY_PAGE_SIZE),
    [sortedFilteredBooks, libraryPage]
  );
  const remainingLibraryBooks = sortedFilteredBooks.length - visibleLibraryBooks.length;

  const handleDelete = useCallback(async (book: { id: number; title: string }) => {
    if (!confirm(`Delete "${book.title}"?`)) return;
    try {
      await deleteBook(book.id);
    } catch (err: any) {
      console.error('[books] Delete failed:', err);
    }
  }, [deleteBook]);

  // Drag & drop upload
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    for (const file of Array.from(files)) {
      if (file.name.toLowerCase().endsWith('.epub')) {
        try { await uploadBook(file); } catch { /* handled by store */ }
      }
    }
  }, [uploadBook]);

  // displayedBooks.length > 0 implies !(isLoading && length === 0) so the
  // second clause is redundant.
  const showHomeView = displayedBooks.length > 0;
  const stats = home.stats;

  return (
    <>
      <div
        className="flex flex-col h-full relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--color-accent-fg)]/10 border-2 border-dashed border-[var(--color-accent-fg)] rounded-lg m-4">
            <div className="flex flex-col items-center gap-2 text-[var(--color-accent-fg)]">
              <Upload size={40} />
              <p className="text-sm font-medium">Drop EPUB files here</p>
            </div>
          </div>
        )}

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden content-below-header">
          {isLoading && displayedBooks.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 border-[var(--color-accent-fg)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : displayedBooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[60vh] text-[var(--color-text-tertiary)] p-8">
              {effectiveOffline ? (
                <CloudOff size={64} className="mb-6 opacity-30" />
              ) : (
                <Library size={64} className="mb-6 opacity-30" />
              )}
              <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                {effectiveOffline ? 'No books saved offline' : 'Your book library is empty'}
              </h2>
              <p className="text-sm text-center max-w-md mb-6">
                {effectiveOffline
                  ? 'Save books for offline use while online and they will remain available here on cold offline starts.'
                  : 'Upload EPUB files or search Z-Library to build your library. Books are stored on the server for reading across devices.'}
              </p>
              {!effectiveOffline && (
                <div className="flex flex-col items-center gap-2 text-xs">
                  <p className="flex items-center gap-1.5">
                    <Upload size={12} />
                    Drag &amp; drop EPUB files or use the header buttons
                  </p>
                </div>
              )}
            </div>
          ) : showHomeView ? (
            <div
              key={activeTab}
              className="flex-1 min-h-0 overflow-y-auto animate-fade-in"
              style={{ paddingBottom: scrollPaddingBottomCss }}
            >
                {activeTab === 'reading' ? (
                  <>
                    {home.hero && (
                      <BookHero
                        book={home.hero}
                        progress={progressCache[home.hero.id]}
                        onContinue={openReader}
                        secondaryInProgress={home.secondaryInProgress}
                        secondaryProgressMap={secondaryProgressMap}
                        onOpenSecondary={openReader}
                      />
                    )}

                    <div
                      className="animate-fade-in"
                      style={{ animationDelay: '80ms', animationFillMode: 'backwards' }}
                    >
                      <ReadingStatsStrip
                        streakDays={stats.streakDays}
                        yearlyGoal={stats.yearlyBooksGoal}
                        finishedThisYear={stats.finishedThisYear}
                        totalBooks={stats.totalBooks}
                        highlightsCount={stats.highlightsCount}
                        onSetGoal={setYearlyBooksGoal}
                      />
                    </div>


                    {home.recentlyAdded.length > 0 && (
                      <div
                        className="animate-fade-in"
                        style={{ animationDelay: '160ms', animationFillMode: 'backwards' }}
                      >
                        <BooksHomeSection
                          title="Recently Added"
                          count={home.recentlyAdded.length}
                          action={{
                            label: 'See library',
                            onClick: () => setActiveTab('library'),
                          }}
                        >
                          <BookCoverRow
                            books={home.recentlyAdded}
                            progressCache={progressCache}
                            onOpenBook={openReader}
                          />
                        </BooksHomeSection>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="pt-2 pb-6">
                    <LibraryToolbar
                      search={librarySearch}
                      onSearchChange={setLibrarySearch}
                      sortBy={sortBy}
                      onSortChange={setSortBy}
                      filterBy={effectiveFilterBy}
                      onFilterChange={setFilterBy}
                      isOffline={effectiveOffline}
                      filteredCount={sortedFilteredBooks.length}
                      totalCount={displayedBooks.length}
                    />
                    {sortedFilteredBooks.length === 0 ? (
                      <LibraryNoResults
                        hasSearch={librarySearch.trim() !== ''}
                        filterBy={effectiveFilterBy}
                        onClear={() => {
                          setLibrarySearch('');
                          setFilterBy('all');
                        }}
                      />
                    ) : (
                      <>
                        <BookGrid
                          books={visibleLibraryBooks}
                          progressCache={progressCache}
                          onOpenBook={openReader}
                          onDeleteBook={handleDelete}
                        />
                        {remainingLibraryBooks > 0 && (
                          <div className="flex flex-col items-center gap-2 px-6 py-5">
                            <button
                              type="button"
                              onClick={() => setLibraryPage((p) => p + 1)}
                              className={cn(
                                'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full',
                                'bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)]',
                                'text-sm font-medium text-[var(--color-text-secondary)]',
                                'hover:border-[var(--color-border-emphasis)] hover:text-[var(--color-text-primary)]',
                                'transition-colors'
                              )}
                            >
                              <ChevronDown size={14} />
                              Show {Math.min(LIBRARY_PAGE_SIZE, remainingLibraryBooks)} more
                            </button>
                            <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
                              Showing {visibleLibraryBooks.length} of {sortedFilteredBooks.length}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
            </div>
          ) : null}

          {error && (
            <div className="px-6 py-3 text-sm text-red-500 text-center">{error}</div>
          )}
        </div>
      </div>

      {/* Floating sub-view tab bar — bottom of viewport, above FloatingNavBar */}
      {showHomeView && !isReaderOpen && (
        <div
          className={cn(
            'fixed left-0 right-0 z-50 px-4',
            'flex justify-center pointer-events-none',
            'animate-slide-up'
          )}
          style={{ bottom: tabBarBottomCss }}
        >
          <div className="pointer-events-auto">
            <SegmentedTabBar
              value={activeTab}
              onChange={setActiveTab}
              tabs={booksTabs}
              ariaLabel="Books views"
            />
          </div>
        </div>
      )}

      {/* EPUB Reader overlay */}
      {isReaderOpen && selectedBook && (
        <EPUBReader
          book={selectedBook}
          onClose={closeReader}
        />
      )}
    </>
  );
}

function LibraryNoResults({
  hasSearch,
  filterBy,
  onClear,
}: {
  hasSearch: boolean;
  filterBy: LibraryFilterMode;
  onClear: () => void;
}) {
  const label = FILTER_EMPTY_LABELS[filterBy];
  let message: string;
  if (hasSearch && label) {
    message = `No ${label} books match your search.`;
  } else if (hasSearch) {
    message = 'No books match your search.';
  } else if (label) {
    message = `No ${label} books yet.`;
  } else {
    message = 'No books to show.';
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
      <SearchX
        size={36}
        className="text-[var(--color-text-tertiary)] opacity-50"
      />
      <p className="text-sm text-[var(--color-text-secondary)]">{message}</p>
      {(hasSearch || filterBy !== 'all') && (
        <button
          type="button"
          onClick={onClear}
          className={cn(
            'text-xs font-medium px-3 py-1 rounded-full',
            'text-[var(--color-accent-fg)]',
            'hover:bg-[var(--color-accent-subtle)] transition-colors'
          )}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
