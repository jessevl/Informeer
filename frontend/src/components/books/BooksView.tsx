/**
 * BooksView Component
 * Main view for the Books section.
 * Shows the user's EPUB library as a cover grid.
 * Supports uploading EPUBs and searching/downloading from LibGen.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Library, Upload, Search, Loader2, ArrowUpDown, Filter, CloudOff } from 'lucide-react';
import { useBooksStore } from '@/stores/books';
import { useModulesStore } from '@/stores/modules';
import { useSettingsStore } from '@/stores/settings';
import { BookGrid } from './BookGrid';
import { EPUBReader } from './EPUBReader';
import { ZLibSearch } from './ZLibSearch';
import { useOfflineRegistry } from '@/stores/offline';
import { FilterBar } from '@/components/ui/FilterBar';

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
    fetchBooks,
    uploadBook,
    deleteBook,
    openReader,
    closeReader,
  } = useBooksStore();

  // Sort & filter state
  type SortMode = 'recent' | 'title' | 'author';
  type FilterMode = 'all' | 'unread' | 'reading' | 'finished' | 'offline';
  const [sortBy, setSortBy] = useState<SortMode>('recent');
  const [filterBy, setFilterBy] = useState<FilterMode>('all');
  const offlineMode = useSettingsStore(s => s.offlineMode);
  const effectiveFilterBy = offlineMode ? 'offline' : filterBy;
  const offlineRegistry = useOfflineRegistry();

  // Fetch books on mount
  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  // Sort & filter
  const sortedFilteredBooks = useMemo(() => {
    let filtered = [...books];

    // Filter
    if (effectiveFilterBy === 'unread') {
      filtered = filtered.filter(b => !progressCache[b.id] || progressCache[b.id].percentage === 0);
    } else if (effectiveFilterBy === 'reading') {
      filtered = filtered.filter(b => {
        const p = progressCache[b.id]?.percentage || 0;
        return p > 0 && p < 1;
      });
    } else if (effectiveFilterBy === 'finished') {
      filtered = filtered.filter(b => (progressCache[b.id]?.percentage || 0) >= 1);
    } else if (effectiveFilterBy === 'offline') {
      const offlineBookIds = new Set(offlineRegistry.filter(i => i.type === 'book').map(i => i.id));
      filtered = filtered.filter(b => offlineBookIds.has(String(b.id)));
    }

    // Sort
    if (sortBy === 'title') {
      filtered.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'author') {
      filtered.sort((a, b) => (a.author || '').localeCompare(b.author || ''));
    } else {
      // recent: newest first by created_at
      filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return filtered;
  }, [books, progressCache, sortBy, effectiveFilterBy, offlineRegistry]);

  // Delete handler with confirmation
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto content-below-header content-above-navbar">
          {/* Sort/Filter bar — only shown when there are books */}
          {books.length > 0 && (
            <FilterBar
              groups={[
                {
                  icon: ArrowUpDown,
                  options: [
                    { value: 'recent' as const, label: 'Recent' },
                    { value: 'title' as const, label: 'Title' },
                    { value: 'author' as const, label: 'Author' },
                  ],
                  value: sortBy,
                  onChange: setSortBy,
                },
                ...(!offlineMode ? [{
                  icon: Filter,
                  options: [
                    { value: 'all' as const, label: 'All' },
                    { value: 'unread' as const, label: 'Unread' },
                    { value: 'reading' as const, label: 'Reading' },
                    { value: 'finished' as const, label: 'Finished' },
                    { value: 'offline' as const, label: 'Offline' },
                  ],
                  value: effectiveFilterBy,
                  onChange: setFilterBy,
                }] : []),
              ]}
              trailing={`${sortedFilteredBooks.length} ${sortedFilteredBooks.length === 1 ? 'book' : 'books'}`}
            />
          )}

          {/* Book grid or empty state */}
          {isLoading && books.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 border-[var(--color-accent-fg)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : books.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[60vh] text-[var(--color-text-tertiary)] p-8">
              <Library size={64} className="mb-6 opacity-30" />
              <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                Your book library is empty
              </h2>
              <p className="text-sm text-center max-w-md mb-6">
                Upload EPUB files or search Z-Library to build your library.
                Books are stored on the server for reading across devices.
              </p>
              <div className="flex flex-col items-center gap-2 text-xs">
                <p className="flex items-center gap-1.5">
                  <Upload size={12} />
                  Drag &amp; drop EPUB files or use the header buttons
                </p>
              </div>
            </div>
          ) : (
            <BookGrid
              books={sortedFilteredBooks}
              progressCache={progressCache}
              onOpenBook={openReader}
              onDeleteBook={handleDelete}
            />
          )}

          {/* Error state */}
          {error && (
            <div className="px-6 py-3 text-sm text-red-500 text-center">{error}</div>
          )}
        </div>
      </div>

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
