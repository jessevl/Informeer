/**
 * BookGrid Component
 * Displays books as a responsive cover grid with progress indicators.
 * Supports inline editing of title and author.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Book, MoreHorizontal, Trash2, Pencil, Check, X, CloudOff, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { useBooksStore } from '@/stores/books';
import type { Book as BookType } from '@/types/api';
import { saveBookOffline, removeOfflineItem } from '@/lib/offline/blob-cache';
import { useOfflineItem } from '@/stores/offline';
import { useCachedImageUrl } from '@/hooks/useCachedImageUrl';

interface BookGridProps {
  books: BookType[];
  progressCache: Record<number, { percentage: number }>;
  onOpenBook: (book: BookType) => void;
  onDeleteBook: (book: BookType) => void;
  columns?: number;
}

export function BookGrid({ books, progressCache, onOpenBook, onDeleteBook, columns }: BookGridProps) {
  return (
    <div
      className={cn(
        'grid gap-4 p-6',
        !columns && 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
      )}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {books.map(book => (
        <BookCard
          key={book.id}
          book={book}
          progress={progressCache[book.id]?.percentage || 0}
          onOpen={() => onOpenBook(book)}
          onDelete={() => onDeleteBook(book)}
        />
      ))}
    </div>
  );
}

function BookCard({
  book,
  progress,
  onOpen,
  onDelete,
}: {
  book: BookType;
  progress: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(book.title);
  const [editAuthor, setEditAuthor] = useState(book.author || '');
  const [isSaving, setIsSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const updateBook = useBooksStore(s => s.updateBook);
  const markFinished = useBooksStore(s => s.markFinished);
  const hasLibraryRecord = book.user_id > 0;

  // Offline state
  const offlineItem = useOfflineItem('book', String(book.id));
  const isSavedOffline = offlineItem != null;
  const [isSavingOffline, setIsSavingOffline] = useState(false);

  // Always try to load the cover — the API returns 404 if missing, which triggers onError fallback
  const coverUrl = hasLibraryRecord ? api.getBookCoverUrl(book.id) : (offlineItem?.coverUrl || book.cover_path || '');
  const coverBlobUrl = useCachedImageUrl({
    cacheKey: offlineItem?.coverCacheKey,
    imageUrl: coverUrl,
    authenticated: hasLibraryRecord,
  });

  // Focus title input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [isEditing]);

  // Sync local state if book prop changes
  useEffect(() => {
    setEditTitle(book.title);
    setEditAuthor(book.author || '');
  }, [book.title, book.author]);

  const handleStartEdit = () => {
    setEditTitle(book.title);
    setEditAuthor(book.author || '');
    setIsEditing(true);
    setShowMenu(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditTitle(book.title);
    setEditAuthor(book.author || '');
  };

  const handleSaveEdit = async () => {
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) return;

    // Skip if nothing changed
    if (trimmedTitle === book.title && editAuthor.trim() === (book.author || '')) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await updateBook(book.id, {
        title: trimmedTitle,
        author: editAuthor.trim(),
      });
      setIsEditing(false);
    } catch (err) {
      console.error('[books] Failed to update book:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleToggleOffline = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (isSavedOffline) {
      await removeOfflineItem(`/offline/books/${book.id}`);
      return;
    }
    setIsSavingOffline(true);
    try {
      const bookUrl = api.getBookFileUrl(book.id);
      const authHeader = api.isAuthenticated() ? api.getAuthHeader() || '' : '';
      await saveBookOffline(book.id, book.title, bookUrl, authHeader, coverUrl, book.author);
    } catch (err) {
      console.error('[books] Offline save failed:', err);
    } finally {
      setIsSavingOffline(false);
    }
  };

  const handleMarkFinished = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);

    try {
      await markFinished(book.id);
    } catch (err) {
      console.error('[books] Failed to mark book as finished:', err);
    }
  };

  return (
    <div className="group relative flex flex-col">
      {/* Cover */}
      <button
        onClick={isEditing ? undefined : onOpen}
        className={cn(
          'relative aspect-[2/3] rounded-lg overflow-hidden',
          'bg-[var(--color-surface-tertiary)]',
          'shadow-md hover:shadow-lg transition-all duration-200',
          !isEditing && 'hover:scale-[1.02] active:scale-[0.98]',
          'focus-visible:ring-2 focus-visible:ring-[var(--color-interactive-ring)] outline-none'
        )}
      >
        {coverBlobUrl && !imageError ? (
          <img
            src={coverBlobUrl}
            alt={book.title}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-[var(--color-text-tertiary)]">
            <Book size={32} className="opacity-40" />
            <span className="text-xs text-center line-clamp-3 font-medium">
              {book.title}
            </span>
          </div>
        )}

        {/* Progress bar overlay at bottom */}
        {progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
            <div
              className="h-full bg-[var(--color-accent-fg)] transition-all"
              style={{ width: `${Math.min(progress * 100, 100)}%` }}
            />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />

        {/* Offline badge */}
        {isSavedOffline && !isSavingOffline && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/80 text-white text-[9px] font-medium pointer-events-none backdrop-blur-sm">
            <Check size={8} />
            Saved
          </div>
        )}
        {isSavingOffline && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/50 text-white text-[9px] font-medium pointer-events-none backdrop-blur-sm">
            <Loader2 size={8} className="animate-spin" />
            Saving…
          </div>
        )}
      </button>

      {/* Menu button */}
      {!isEditing && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          className={cn(
            'absolute top-1.5 right-1.5 w-7 h-7 rounded-full',
            'flex items-center justify-center',
            'bg-black/40 text-white backdrop-blur-sm',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:bg-black/60'
          )}
        >
          <MoreHorizontal size={14} />
        </button>
      )}

      {/* Dropdown menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className={cn(
            'absolute top-9 right-1 z-50 min-w-[140px]',
            'bg-[var(--color-surface-primary)] border border-[var(--color-border-default)]',
            'rounded-lg shadow-lg py-1'
          )}>
            {hasLibraryRecord && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <Pencil size={14} />
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    onDelete();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
                {progress < 1 && (
                  <>
                    <div className="h-px bg-[var(--color-border-default)] mx-2" />
                    <button
                      onClick={handleMarkFinished}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      <Check size={14} className="text-emerald-500" />
                      Mark finished
                    </button>
                  </>
                )}
              </>
            )}
            <div className="h-px bg-[var(--color-border-default)] mx-2" />
            <button
              onClick={handleToggleOffline}
              disabled={isSavingOffline}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {isSavedOffline ? (
                <>
                  <Check size={14} className="text-emerald-500" />
                  Remove offline
                </>
              ) : isSavingOffline ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <CloudOff size={14} />
                  Save offline
                </>
              )}
            </button>
          </div>
        </>
      )}

      {/* Title and author — editable or display */}
      {isEditing ? (
        <div className="mt-2 px-0.5 space-y-1">
          <input
            ref={titleInputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleEditKeyDown}
            placeholder="Title"
            className={cn(
              'w-full px-1.5 py-0.5 text-sm font-medium rounded',
              'bg-[var(--color-surface-inset)] text-[var(--color-text-primary)]',
              'border border-[var(--color-border-default)]',
              'outline-none focus:ring-1 focus:ring-[var(--color-accent-fg)]'
            )}
          />
          <input
            type="text"
            value={editAuthor}
            onChange={(e) => setEditAuthor(e.target.value)}
            onKeyDown={handleEditKeyDown}
            placeholder="Author"
            className={cn(
              'w-full px-1.5 py-0.5 text-xs rounded',
              'bg-[var(--color-surface-inset)] text-[var(--color-text-primary)]',
              'border border-[var(--color-border-default)]',
              'outline-none focus:ring-1 focus:ring-[var(--color-accent-fg)]'
            )}
          />
          <div className="flex items-center gap-1">
            <button
              onClick={handleSaveEdit}
              disabled={isSaving || !editTitle.trim()}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 text-xs rounded font-medium',
                'bg-[var(--color-accent-fg)] text-white',
                'hover:opacity-90 disabled:opacity-50'
              )}
            >
              <Check size={10} />
              Save
            </button>
            <button
              onClick={handleCancelEdit}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
            >
              <X size={10} />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 px-0.5">
          <h3 className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-2 leading-tight">
            {book.title}
          </h3>
          {book.author && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 line-clamp-1">
              {book.author}
            </p>
          )}
          {progress > 0 && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              {Math.round(progress * 100)}%
            </p>
          )}
        </div>
      )}
    </div>
  );
}
