/**
 * Magazines Store
 * Manages magazine feed tracking, PDF viewer state, and reading progress.
 *
 * Informeer feeds in the configured "Magazines" category are the sole source of truth.
 * Cover images and PDF URLs are dynamically extracted from entry content —
 * works with any feed that provides PDF links and cover images.
 * No external proxy dependency.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/api/client';
import { useSettingsStore } from '@/stores/settings';
import { markApiSuccess } from '@/stores/connectivity';
import { enqueue } from '@/lib/offline/sync-queue';
import type { Feed, Entry } from '@/types/api';

/**
 * A magazine issue derived from a Informeer entry.
 * Generic — works with any feed that has a cover image and a PDF link.
 */
export interface MagazineIssue {
  id: string;
  title: string;
  sourceUrl: string;
  coverUrl: string;
  pdfUrl: string;
  pdfLayout?: 'standard' | 'single-page-spread';
  pubDate: string;
  description: string;
  seriesName: string;
  categories: string[];
  downloadFailed?: boolean;
}

/** A magazine subscription — just a Informeer feed in the Magazines category */
export interface MagazineSubscription {
  feedId: number;
  displayName: string;
  feedUrl: string;
  /** Terms to exclude from this subscription's entries (client-side filter) */
  excludeTerms?: string[];
}

/** User overrides for ad detection (per PDF URL) */
export interface AdPageOverrides {
  /** Pages manually marked as ads by the user */
  added: number[];
  /** Pages the user un-flagged (false positives) */
  removed: number[];
}

interface MagazinesState {
  // Subscriptions (derived from Informeer feeds)
  subscriptions: MagazineSubscription[];
  isLoadingSubscriptions: boolean;

  // Current view
  selectedIssue: MagazineIssue | null;
  isPdfViewerOpen: boolean;
  currentPdfPage: number;

  // Progress tracking: entryId → { maxPage, totalPages, enclosureId }
  readingProgress: Record<number, { maxPage: number; totalPages: number; enclosureId?: number }>;

  // Ad detection cache: pdfUrl → detected ad page numbers
  adPageCache: Record<string, number[]>;
  // User corrections per PDF
  adPageOverrides: Record<string, AdPageOverrides>;

  // Informeer integration
  magazineFeedIds: number[];

  // Actions
  fetchSubscriptions: () => Promise<void>;
  unsubscribe: (feedId: number) => Promise<void>;
  selectIssue: (issue: MagazineIssue | null) => void;
  openPdfViewer: (issue: MagazineIssue) => void;
  closePdfViewer: () => void;
  setPdfPage: (page: number) => void;
  updateReadingProgress: (entryId: number, page: number, totalPages: number, enclosureId?: number) => void;
  syncProgressToServer: (entryId: number) => Promise<void>;
  loadProgressFromEntries: (entries: Entry[]) => void;
  getProgress: (entryId: number) => { maxPage: number; totalPages: number } | null;
  isMagazineEntry: (feedId: number) => boolean;

  // Ad detection actions
  setAdPages: (pdfUrl: string, pages: number[]) => void;
  toggleAdPageOverride: (pdfUrl: string, pageNum: number) => void;
  getEffectiveAdPages: (pdfUrl: string) => Set<number>;
  clearAdCache: (pdfUrl?: string) => void;
}

export const useMagazinesStore = create<MagazinesState>()(
  persist(
    (set, get) => ({
      // Initial state
      subscriptions: [],
      isLoadingSubscriptions: false,
      selectedIssue: null,
      isPdfViewerOpen: false,
      currentPdfPage: 1,
      readingProgress: {},
      adPageCache: {},
      adPageOverrides: {},
      magazineFeedIds: [],

      /**
       * Fetch subscriptions from Informeer feeds in the Magazines category.
       * Reads from the shared feeds store to avoid duplicate API calls.
       */
      fetchSubscriptions: async () => {
        set({ isLoadingSubscriptions: true });
        try {
          const categoryId = useSettingsStore.getState().magazinesCategoryId;
          if (!categoryId) {
            set({ subscriptions: [], magazineFeedIds: [], isLoadingSubscriptions: false });
            return;
          }

          // Import feeds store lazily to avoid circular deps
          const { useFeedsStore } = await import('@/stores/feeds');
          let allFeeds = useFeedsStore.getState().feeds;

          // If feeds store is empty (not yet loaded), fetch from API as fallback
          if (allFeeds.length === 0) {
            allFeeds = await api.getFeeds();
          }

          const magazineFeeds = allFeeds.filter(
            (f: Feed) => f.category?.id === categoryId
          );

          const feedIds = magazineFeeds.map((f: Feed) => f.id);

          // Merge with persisted subscriptions to preserve excludeTerms
          const existingSubs = get().subscriptions;
          const existingByFeedId = new Map(existingSubs.map(s => [s.feedId, s]));

          const subscriptions: MagazineSubscription[] = magazineFeeds.map((f: Feed) => {
            const existing = existingByFeedId.get(f.id);
            return {
              feedId: f.id,
              displayName: f.title,
              feedUrl: f.feed_url,
              excludeTerms: existing?.excludeTerms,
            };
          });

          set({
            subscriptions,
            magazineFeedIds: feedIds,
            isLoadingSubscriptions: false,
          });
        } catch (error) {
          console.error('Failed to fetch magazine subscriptions:', error);
          set({ isLoadingSubscriptions: false });
        }
      },

      /**
       * Unsubscribe: delete the Informeer feed.
       */
      unsubscribe: async (feedId: number) => {
        await api.deleteFeed(feedId);

        set(state => ({
          subscriptions: state.subscriptions.filter(s => s.feedId !== feedId),
          magazineFeedIds: state.magazineFeedIds.filter(fid => fid !== feedId),
        }));
      },

      // Select an issue to view details
      selectIssue: (issue) => {
        set({ selectedIssue: issue });
      },

      // Open PDF viewer for an issue — restore saved progress if available
      openPdfViewer: (issue) => {
        const entryId = parseInt(issue.id, 10);
        const progress = get().readingProgress[entryId];
        set({
          selectedIssue: issue,
          isPdfViewerOpen: true,
          currentPdfPage: progress?.maxPage || 1,
        });
      },

      // Close PDF viewer
      closePdfViewer: () => {
        // Sync progress on close
        const { selectedIssue } = get();
        if (selectedIssue) {
          const entryId = parseInt(selectedIssue.id, 10);
          get().syncProgressToServer(entryId).catch(() => {});
        }
        set({ isPdfViewerOpen: false, selectedIssue: null });
      },

      // Set current PDF page and track max progress
      setPdfPage: (page) => {
        set({ currentPdfPage: page });
      },

      // Update reading progress (tracks furthest page reached)
      updateReadingProgress: (entryId, page, totalPages, enclosureId) => {
        set(state => {
          const existing = state.readingProgress[entryId];
          const maxPage = Math.max(page, existing?.maxPage || 0);
          return {
            readingProgress: {
              ...state.readingProgress,
              [entryId]: {
                maxPage,
                totalPages,
                enclosureId: enclosureId || existing?.enclosureId,
              },
            },
          };
        });
      },

      // Sync progress to Informeer via enclosure media_progression
      syncProgressToServer: async (entryId) => {
        const progress = get().readingProgress[entryId];
        if (!progress?.enclosureId || !progress.maxPage) return;

        if (!navigator.onLine) {
          enqueue({
            id: `magazine-progress-${entryId}`,
            type: 'magazine-progress',
            payload: { enclosureId: progress.enclosureId, maxPage: progress.maxPage },
          });
          return;
        }

        try {
          // Store maxPage as media_progression (page number, not seconds)
          await api.updateEnclosureProgress(progress.enclosureId, progress.maxPage);
          markApiSuccess();
        } catch (err) {
          enqueue({
            id: `magazine-progress-${entryId}`,
            type: 'magazine-progress',
            payload: { enclosureId: progress.enclosureId, maxPage: progress.maxPage },
          });
          console.error('Failed to sync magazine progress:', err);
        }
      },

      // Load progress from Informeer entries (enclosure media_progression)
      // Only updates local progress when the server value is higher (cross-device sync)
      // to avoid regressing progress on the current device.
      loadProgressFromEntries: (entries) => {
        set(state => {
          const newProgress = { ...state.readingProgress };
          let changed = false;

          for (const entry of entries) {
            const pdfEnclosure = entry.enclosures?.find(e => e.mime_type === 'application/pdf');
            if (pdfEnclosure && pdfEnclosure.media_progression > 0) {
              const existing = newProgress[entry.id];
              if (!existing || pdfEnclosure.media_progression > existing.maxPage) {
                // Server is ahead — update local progress
                newProgress[entry.id] = {
                  maxPage: pdfEnclosure.media_progression,
                  totalPages: existing?.totalPages || 0,
                  enclosureId: pdfEnclosure.id,
                };
                changed = true;
              } else if (existing && !existing.enclosureId) {
                // Ensure enclosureId is populated even if local is ahead
                newProgress[entry.id] = { ...existing, enclosureId: pdfEnclosure.id };
                changed = true;
              }
            }
          }

          return changed ? { readingProgress: newProgress } : {};
        });
      },

      // Get progress for an entry
      getProgress: (entryId) => {
        return get().readingProgress[entryId] || null;
      },

      // Check if an entry belongs to a magazine feed
      isMagazineEntry: (feedId: number): boolean => {
        return get().magazineFeedIds.includes(feedId);
      },

      // ── Ad Detection ──────────────────────────────────────────

      /** Store detected ad pages for a PDF (from background analysis) */
      setAdPages: (pdfUrl, pages) => {
        set(state => ({
          adPageCache: { ...state.adPageCache, [pdfUrl]: pages },
        }));
      },

      /** Toggle a page's ad override: mark / unmark as ad */
      toggleAdPageOverride: (pdfUrl, pageNum) => {
        set(state => {
          const existing = state.adPageOverrides[pdfUrl] || { added: [], removed: [] };
          const detectedAds = new Set(state.adPageCache[pdfUrl] || []);
          const isDetectedAd = detectedAds.has(pageNum);

          let { added, removed } = existing;

          if (isDetectedAd) {
            // Page was auto-detected as ad
            if (removed.includes(pageNum)) {
              // User previously un-flagged it → re-flag
              removed = removed.filter(p => p !== pageNum);
            } else {
              // Un-flag it (false positive)
              removed = [...removed, pageNum];
            }
          } else {
            // Page was NOT auto-detected
            if (added.includes(pageNum)) {
              // User previously marked it → unmark
              added = added.filter(p => p !== pageNum);
            } else {
              // Mark as ad
              added = [...added, pageNum];
            }
          }

          return {
            adPageOverrides: {
              ...state.adPageOverrides,
              [pdfUrl]: { added, removed },
            },
          };
        });
      },

      /** Compute effective ad pages = (detected + user-added) - user-removed */
      getEffectiveAdPages: (pdfUrl) => {
        const state = get();
        const detected = new Set(state.adPageCache[pdfUrl] || []);
        const overrides = state.adPageOverrides[pdfUrl] || { added: [], removed: [] };

        for (const p of overrides.added) detected.add(p);
        for (const p of overrides.removed) detected.delete(p);

        return detected;
      },

      /** Clear ad cache for a specific PDF or all PDFs */
      clearAdCache: (pdfUrl) => {
        if (pdfUrl) {
          set(state => {
            const { [pdfUrl]: _, ...rest } = state.adPageCache;
            const { [pdfUrl]: __, ...overridesRest } = state.adPageOverrides;
            return { adPageCache: rest, adPageOverrides: overridesRest };
          });
        } else {
          set({ adPageCache: {}, adPageOverrides: {} });
        }
      },
    }),
    {
      name: 'informeer-magazines',
      partialize: (state) => ({
        subscriptions: state.subscriptions,
        magazineFeedIds: state.magazineFeedIds,
        currentPdfPage: state.currentPdfPage,
        readingProgress: state.readingProgress,
        adPageCache: state.adPageCache,
        adPageOverrides: state.adPageOverrides,
      }),
    }
  )
);
