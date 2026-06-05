/**
 * Books Store
 * Manages book library, EPUB reader state, reading progress, and highlights.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/api/client';
import type { Book, BookProgress, BookHighlight, ZLibSearchResult } from '@/types/api';
import { markApiSuccess } from './connectivity';
import { enqueue } from '@/lib/offline/sync-queue';

interface BooksState {
  // Library
  books: Book[];
  total: number;
  isLoading: boolean;
  error: string | null;

  // Reader
  selectedBook: Book | null;
  isReaderOpen: boolean;
  currentCfi: string;
  currentPercentage: number;
  currentChapter: string;

  // Highlights
  highlights: BookHighlight[];

  // Progress cache
  progressCache: Record<number, BookProgress>;
  recentBookActivity: Record<number, string>;

  // Actions
  fetchBooks: (search?: string) => Promise<void>;
  uploadBook: (file: File) => Promise<Book>;
  deleteBook: (id: number) => Promise<void>;
  updateBook: (id: number, data: { title?: string; author?: string }) => Promise<Book>;
  openReader: (book: Book) => void;
  closeReader: () => void;
  updateProgress: (bookId: number, cfi: string, percentage: number, chapter: string) => void;
  markFinished: (bookId: number) => Promise<void>;
  syncProgress: (bookId: number) => Promise<void>;
  loadProgress: (bookId: number) => Promise<BookProgress>;
  fetchHighlights: (bookId: number) => Promise<void>;
  addHighlight: (bookId: number, data: { cfi_range: string; text: string; note?: string; color?: string }) => Promise<BookHighlight>;
  updateHighlight: (bookId: number, highlightId: number, data: { note?: string; color?: string }) => Promise<void>;
  deleteHighlight: (bookId: number, highlightId: number) => Promise<void>;
  downloadFromZLib: (result: ZLibSearchResult) => Promise<Book>;
}

function normalizeBookPercentage(percentage: number): number {
  if (!Number.isFinite(percentage)) return 0;

  const clamped = Math.min(Math.max(percentage, 0), 1);
  return clamped >= 0.995 ? 1 : clamped;
}

export const useBooksStore = create<BooksState>()(
  persist(
    (set, get) => ({
      books: [],
      total: 0,
      isLoading: false,
      error: null,
      selectedBook: null,
      isReaderOpen: false,
      currentCfi: '',
      currentPercentage: 0,
      currentChapter: '',
      highlights: [],
      progressCache: {},
      recentBookActivity: {},

      fetchBooks: async (search?: string) => {
        if (!navigator.onLine && get().books.length > 0) {
          return; // keep existing data
        }
        if (get().books.length === 0) {
          set({ isLoading: true, error: null });
        }
        try {
          const response = await api.getBooks({ search, limit: 200 });
          set({
            books: response.books,
            total: response.total,
            isLoading: false,
          });
          markApiSuccess();
        } catch (err: any) {
          if (get().books.length > 0) {
            set({ isLoading: false });
            return;
          }
          set({ error: err.message, isLoading: false });
        }
      },

      uploadBook: async (file: File) => {
        const book = await api.uploadBook(file);
        set(state => ({
          books: [book, ...state.books],
          total: state.total + 1,
        }));
        return book;
      },

      deleteBook: async (id: number) => {
        await api.deleteBook(id);
        set(state => {
          const { [id]: _removed, ...remainingProgress } = state.progressCache;
          const { [id]: _removedActivity, ...remainingActivity } = state.recentBookActivity;
          return {
            books: state.books.filter(b => b.id !== id),
            total: state.total - 1,
            selectedBook: state.selectedBook?.id === id ? null : state.selectedBook,
            isReaderOpen: state.selectedBook?.id === id ? false : state.isReaderOpen,
            progressCache: remainingProgress,
            recentBookActivity: remainingActivity,
          };
        });
      },

      updateBook: async (id: number, data: { title?: string; author?: string }) => {
        const book = await api.updateBook(id, data);
        set(state => ({
          books: state.books.map(b => b.id === id ? book : b),
          selectedBook: state.selectedBook?.id === id ? book : state.selectedBook,
        }));
        return book;
      },

      openReader: (book: Book) => {
        const cached = get().progressCache[book.id];
        const openedAt = new Date().toISOString();
        set({
          selectedBook: book,
          isReaderOpen: true,
          currentCfi: cached?.cfi || '',
          currentPercentage: cached?.percentage || 0,
          currentChapter: cached?.chapter || '',
          recentBookActivity: {
            ...get().recentBookActivity,
            [book.id]: openedAt,
          },
        });
        // Load progress from server
        get().loadProgress(book.id).catch(() => {});
        get().fetchHighlights(book.id).catch(() => {});
      },

      closeReader: () => {
        const { selectedBook } = get();
        if (selectedBook) {
          get().syncProgress(selectedBook.id).catch(() => {});
        }
        set({ isReaderOpen: false });
      },

      updateProgress: (bookId, cfi, percentage, chapter) => {
        const normalizedPercentage = normalizeBookPercentage(percentage);
        const updatedAt = new Date().toISOString();

        set(state => ({
          currentCfi: cfi,
          currentPercentage: normalizedPercentage,
          currentChapter: chapter,
          progressCache: {
            ...state.progressCache,
            [bookId]: {
              cfi,
              percentage: normalizedPercentage,
              chapter,
              updated_at: updatedAt,
            },
          },
          recentBookActivity: {
            ...state.recentBookActivity,
            [bookId]: updatedAt,
          },
        }));
      },

      markFinished: async (bookId: number) => {
        const existing = get().progressCache[bookId];
        const updatedAt = new Date().toISOString();

        set(state => ({
          currentCfi: state.selectedBook?.id === bookId ? (existing?.cfi || state.currentCfi) : state.currentCfi,
          currentPercentage: state.selectedBook?.id === bookId ? 1 : state.currentPercentage,
          currentChapter: state.selectedBook?.id === bookId ? (existing?.chapter || state.currentChapter) : state.currentChapter,
          progressCache: {
            ...state.progressCache,
            [bookId]: {
              cfi: existing?.cfi || '',
              percentage: 1,
              chapter: existing?.chapter || '',
              updated_at: updatedAt,
            },
          },
          recentBookActivity: {
            ...state.recentBookActivity,
            [bookId]: updatedAt,
          },
        }));

        await get().syncProgress(bookId);
      },

      syncProgress: async (bookId: number) => {
        const progress = get().progressCache[bookId];
        if (!progress) return;

        const normalizedPercentage = normalizeBookPercentage(progress.percentage);
        const payload = {
          cfi: progress.cfi,
          percentage: normalizedPercentage,
          chapter: progress.chapter,
        };

        if (!navigator.onLine) {
          enqueue({
            id: `book-progress-${bookId}`,
            type: 'book-progress',
            payload: { bookId, ...payload },
          });
          return;
        }

        try {
          await api.updateBookProgress(bookId, payload);
          markApiSuccess();
        } catch (err) {
          // Network failed — queue it
          enqueue({
            id: `book-progress-${bookId}`,
            type: 'book-progress',
            payload: { bookId, ...payload },
          });
          console.error('[books] Failed to sync progress:', err);
        }
      },

      loadProgress: async (bookId: number) => {
        try {
          const progress = await api.getBookProgress(bookId);
          const normalizedProgress = {
            ...progress,
            percentage: normalizeBookPercentage(progress.percentage),
          };

          if (normalizedProgress.cfi || normalizedProgress.percentage > 0 || normalizedProgress.chapter) {
            set(state => {
              const local = state.progressCache[bookId];
              const isBookActive = state.selectedBook?.id === bookId;

              // Prefer whichever position is further ahead. Timestamp comparison is
              // unreliable here: the server timestamp is always written 1500ms+ after
              // the client timestamp (sync debounce + network latency), so a stale
              // server page can appear "newer" than a fresh local page.
              // The 2% threshold matches the remote sync hook and avoids noise from
              // percentage rounding differences. Cross-device advancement beyond this
              // gap is still caught here; live cross-device sync is handled separately
              // by useRemoteProgressSync (which shows a confirmation toast).
              const localPct = local?.percentage ?? 0;
              const serverPct = normalizedProgress.percentage;
              const serverIsMateriallyAhead = serverPct - localPct > 0.02;
              const localHasNoPosition = !local?.cfi;
              const serverShouldWin = localHasNoPosition || serverIsMateriallyAhead;

              if (serverShouldWin) {
                return {
                  currentCfi: isBookActive ? normalizedProgress.cfi : state.currentCfi,
                  currentPercentage: isBookActive ? normalizedProgress.percentage : state.currentPercentage,
                  currentChapter: isBookActive ? normalizedProgress.chapter : state.currentChapter,
                  progressCache: {
                    ...state.progressCache,
                    [bookId]: normalizedProgress,
                  },
                };
              }

              return {};
            });
          }
          return normalizedProgress;
        } catch {
          return { cfi: '', percentage: 0, chapter: '', updated_at: null };
        }
      },

      fetchHighlights: async (bookId: number) => {
        try {
          const highlights = await api.getBookHighlights(bookId);
          set({ highlights });
        } catch {
          set({ highlights: [] });
        }
      },

      addHighlight: async (bookId, data) => {
        const highlight = await api.createBookHighlight(bookId, data);
        set(state => ({
          highlights: [highlight, ...state.highlights],
        }));
        return highlight;
      },

      updateHighlight: async (bookId, highlightId, data) => {
        const updated = await api.updateBookHighlight(bookId, highlightId, data);
        set(state => ({
          highlights: state.highlights.map(h =>
            h.id === highlightId ? updated : h
          ),
        }));
      },

      deleteHighlight: async (bookId, highlightId) => {
        await api.deleteBookHighlight(bookId, highlightId);
        set(state => ({
          highlights: state.highlights.filter(h => h.id !== highlightId),
        }));
      },

      downloadFromZLib: async (result: ZLibSearchResult) => {
        const book = await api.downloadFromZLib({
          bookId: result.id,
          downloadUrl: result.downloadUrl,
          title: result.title,
          author: result.author,
          coverUrl: result.coverUrl,
        });
        set(state => ({
          books: [book, ...state.books],
          total: state.total + 1,
        }));
        return book;
      },
    }),
    {
      name: 'informeer-books',
      partialize: (state) => ({
        books: state.books,
        total: state.total,
        progressCache: state.progressCache,
        recentBookActivity: state.recentBookActivity,
      }),
    }
  )
);
