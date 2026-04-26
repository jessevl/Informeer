/**
 * MagazinesView Component
 * Main view for the Magazines section.
 * Shows magazine feeds as visual stacks grouped by feed.
 * Clicking a stack reveals all issues for that magazine.
 * Works with any feed that provides PDF links and cover images —
 * no dependency on any specific proxy service.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Library, Rss, CloudOff, Loader2 } from 'lucide-react';
import { useMagazinesStore } from '@/stores/magazines';
import type { MagazineIssue } from '@/stores/magazines';
import { ErrorBoundary } from '@frameer/components';
import { MagazineStack } from './MagazineStack';
import type { MagazineGroup } from './MagazineStack';
import { MagazineIssuesRow } from './MagazineIssuesRow';
import { PDFViewer } from './PDFViewer';
import type { Entry, Feed } from '@/types/api';
import { removeOfflineItem } from '@/lib/offline/blob-cache';
import { useOfflineStore, useOfflineRegistry } from '@/stores/offline';
import { useFeedsStore } from '@/stores/feeds';
import { useSettingsStore } from '@/stores/settings';
import { FilterBar } from '@/components/ui/FilterBar';
import { useEffectiveOfflineState } from '@/hooks/useEffectiveOfflineState';
import {
  PaginatedOverviewSurface,
  useMeasuredContainerSize,
  usePaginatedItems,
  useResponsiveGridPageSize,
} from '@/components/overview/PaginatedOverview';

/** Breakpoint → column count, must stay in sync with the grid-cols-* classes below */
function useGridColumns() {
  const [cols, setCols] = useState(() => getColCount());
  useEffect(() => {
    const onResize = () => setCols(getColCount());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return cols;
}

function getColCount(): number {
  const w = window.innerWidth;
  if (w >= 1280) return 6; // xl
  if (w >= 1024) return 5; // lg
  if (w >= 768) return 4;  // md
  if (w >= 640) return 3;  // sm
  return 2;                // default
}

function usePaginatedGridColumns() {
  const [cols, setCols] = useState(() => getPaginatedColCount());
  useEffect(() => {
    const onResize = () => setCols(getPaginatedColCount());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return cols;
}

function getPaginatedColCount(): number {
  const w = window.innerWidth;
  if (w >= 1700) return 8;
  if (w >= 1450) return 7;
  if (w >= 1200) return 6;
  if (w >= 900) return 5;
  if (w >= 640) return 4;
  if (w >= 480) return 3;
  return 2;
}

interface MagazinesViewProps {
  /** Informeer entries from magazine feeds */
  entries: Entry[];
  /** All feeds (to find magazine ones) */
  feeds: Feed[];
  /** Refresh entries */
  onRefresh?: () => Promise<void>;
}

/**
 * Extract a PDF URL from a Informeer entry.
 *
 * Checks (in priority order):
 * 1. PDF enclosure (mime_type = application/pdf)
 * 2. Link with data-magazine-pdf attribute in content
 * 3. Any <a> href ending in .pdf in content
 * 4. Any <a> href containing /pdf/ in content
 */
function extractPdfUrl(entry: Entry): string {
  // 1. Enclosure
  const pdfEnclosure = entry.enclosures?.find(e => e.mime_type === 'application/pdf');
  if (pdfEnclosure?.url) return pdfEnclosure.url;

  const content = entry.content || '';

  // 2. data-magazine-pdf attribute
  const pdfAttrMatch = content.match(/<a[^>]+data-magazine-pdf[^>]+href="([^"]+)"/)
    || content.match(/<a[^>]+href="([^"]+)"[^>]+data-magazine-pdf/);
  if (pdfAttrMatch?.[1]) return pdfAttrMatch[1];

  // 3. Any href ending in .pdf
  const pdfExtMatch = content.match(/<a[^>]+href="([^"]+\.pdf(?:\?[^"]*)?)"/i);
  if (pdfExtMatch?.[1]) return pdfExtMatch[1];

  // 4. Any href containing /pdf/ (common path pattern)
  const pdfPathMatch = content.match(/<a[^>]+href="([^"]*\/pdf\/[^"]*)"/);
  if (pdfPathMatch?.[1]) return pdfPathMatch[1];

  return '';
}

/**
 * Extract a cover image URL from a Informeer entry.
 *
 * Checks (in priority order):
 * 1. Image with data-magazine-cover attribute
 * 2. First <img> in content
 */
function extractCoverUrl(entry: Entry): string {
  const content = entry.content || '';

  // 1. data-magazine-cover attribute
  const coverAttrMatch = content.match(/<img[^>]+data-magazine-cover[^>]+src="([^"]+)"/)
    || content.match(/<img[^>]+src="([^"]+)"[^>]+data-magazine-cover/);
  if (coverAttrMatch?.[1]) return coverAttrMatch[1];

  // 2. First <img> src
  const imgMatch = content.match(/<img[^>]+src="([^"]+)"/);
  if (imgMatch?.[1]) return imgMatch[1];

  return '';
}

/**
 * Convert a Informeer entry from a magazine feed into a MagazineIssue
 * for display in the cover grid.
 *
 * Generically extracts cover and PDF URLs — works with any feed that
 * provides PDF links and cover images in its content or enclosures.
 */
function entryToMagazineIssue(entry: Entry): MagazineIssue {
  const coverUrl = extractCoverUrl(entry);
  const pdfUrl = extractPdfUrl(entry);
  const isNrcSource = entry.feed?.source_type === 'nrc';

  // Extract series name from title (strip date/issue suffixes)
  const title = entry.title || 'Untitled';
  const seriesName = title.replace(/\s*[-–—]\s*[A-Z][a-z]+\s+\d{4}.*$/, '').trim() || title;

  const content = entry.content || '';

  return {
    id: String(entry.id),
    title,
    sourceUrl: entry.url,
    coverUrl,
    pdfUrl,
    pdfLayout: isNrcSource ? 'single-page-spread' : 'standard',
    pubDate: entry.published_at,
    description: content.replace(/<[^>]*>/g, '').slice(0, 200) || '',
    seriesName,
    categories: entry.feed?.category ? [entry.feed.category.title] : [],
    downloadFailed: entry.download_failed || false,
  };
}

export function MagazinesView({
  entries,
  feeds,
  onRefresh,
}: MagazinesViewProps) {
  const gridColumns = useGridColumns();
  const paginatedGridColumns = usePaginatedGridColumns();
  const {
    subscriptions,
    magazineFeedIds,
    isPdfViewerOpen,
    selectedIssue,
    currentPdfPage,
    readingProgress,
    fetchSubscriptions,
    openPdfViewer,
    closePdfViewer,
    setPdfPage,
    updateReadingProgress,
    syncProgressToServer,
    loadProgressFromEntries,
    unsubscribe,
    isMagazineEntry,
  } = useMagazinesStore();

  const deleteFeed = useFeedsStore(s => s.deleteFeed);

  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  // Track the feed whose row is currently mounted (stays set during close animation)
  const [mountedFeedId, setMountedFeedId] = useState<number | null>(null);
  const [showOfflineOnly, setShowOfflineOnly] = useState(false);
  const einkMode = useSettingsStore((s) => s.einkMode);
  const { effectiveOffline } = useEffectiveOfflineState();
  const effectiveOfflineOnly = effectiveOffline || showOfflineOnly;
  const gridRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const overviewSize = useMeasuredContainerSize(overviewRef);

  // Fetch subscriptions on mount
  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  // Load reading progress from Informeer enclosures
  useEffect(() => {
    if (entries.length > 0) {
      loadProgressFromEntries(entries);
    }
  }, [entries, loadProgressFromEntries]);

  // Get magazine feeds
  const magazineFeeds = useMemo(() => {
    return feeds.filter(f => magazineFeedIds.includes(f.id));
  }, [feeds, magazineFeedIds]);

  // Build a lookup of exclusion terms per feed
  const excludeByFeed = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const sub of subscriptions) {
      if (sub.excludeTerms && sub.excludeTerms.length > 0) {
        map.set(sub.feedId, sub.excludeTerms);
      }
    }
    return map;
  }, [subscriptions]);

  // Filter an entry against its subscription's exclusion terms
  const passesExclusionFilter = useCallback((entry: Entry) => {
    const terms = excludeByFeed.get(entry.feed_id);
    if (!terms || terms.length === 0) return true;
    const text = `${entry.title} ${(entry.content || '').replace(/<[^>]*>/g, '')}`.toLowerCase();
    return !terms.some(term => text.includes(term));
  }, [excludeByFeed]);

  // All entries passed in are already from magazine feeds (filtered by Magazines category)
  // Apply per-subscription exclusion filtering
  const allIssues = useMemo(() => {
    return entries
      .filter(passesExclusionFilter)
      .map(e => entryToMagazineIssue(e));
  }, [entries, passesExclusionFilter]);

  // Group issues by feed and sort each group by parsed issue date
  const magazineGroups = useMemo((): MagazineGroup[] => {
    const feedMap = new Map<number, { feedTitle: string; issues: MagazineIssue[] }>();

    // Group by feed_id
    for (const entry of entries.filter(passesExclusionFilter)) {
      const issue = entryToMagazineIssue(entry);
      const feedId = entry.feed_id;
      const feedTitle = entry.feed?.title || issue.seriesName;

      if (!feedMap.has(feedId)) {
        feedMap.set(feedId, { feedTitle, issues: [] });
      }
      feedMap.get(feedId)!.issues.push(issue);
    }

    // Sort issues within each group by parsed date (newest first)
    const groups: MagazineGroup[] = [];
    for (const [feedId, { feedTitle, issues }] of feedMap) {
      // Sort by parsed issue date from title, fallback to pubDate
      issues.sort((a, b) => {
        const dateA = parseIssueDateFromTitle(a.title) || new Date(a.pubDate).getTime();
        const dateB = parseIssueDateFromTitle(b.title) || new Date(b.pubDate).getTime();
        return dateB - dateA; // newest first
      });

      groups.push({
        feedId,
        feedTitle,
        issues,
        latestIssue: issues[0],
      });
    }

    // Sort groups by newest issue (most recently published on top)
    groups.sort((a, b) => {
      const dateA = new Date(a.latestIssue.pubDate).getTime();
      const dateB = new Date(b.latestIssue.pubDate).getTime();
      return dateB - dateA;
    });

    return groups;
  }, [entries, passesExclusionFilter]);

  // Feeds that have subscriptions but no entries yet (still loading on the backend)
  const loadingFeeds = useMemo(() => {
    const feedIdsWithEntries = new Set(magazineGroups.map(g => g.feedId));
    return magazineFeeds.filter(f => !feedIdsWithEntries.has(f.id));
  }, [magazineFeeds, magazineGroups]);

  // Auto-refresh entries while there are feeds with no entries yet (still loading on backend)
  // Give up after ~2 minutes (15 retries * 8s) to avoid polling indefinitely
  const pollCountRef = useRef(0);
  useEffect(() => {
    if (loadingFeeds.length === 0) {
      pollCountRef.current = 0;
      return;
    }
    if (pollCountRef.current >= 15) return;
    const interval = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= 15) {
        clearInterval(interval);
        return;
      }
      onRefresh?.();
    }, 8000);
    return () => clearInterval(interval);
  }, [loadingFeeds.length, onRefresh]);

  // Compute saved-offline counts per feed
  const offlineRegistry = useOfflineRegistry();
  const offlineFallbackGroups = useMemo((): MagazineGroup[] => {
    const grouped = new Map<string, MagazineIssue[]>();

    for (const item of offlineRegistry) {
      if (item.type !== 'magazine') continue;

      const feedTitle = item.feedTitle || 'Saved magazines';
      const issue: MagazineIssue = {
        id: item.id,
        title: item.title,
        sourceUrl: '',
        coverUrl: item.coverUrl || '',
        pdfUrl: '',
        pdfLayout: 'standard',
        pubDate: new Date(item.savedAt).toISOString(),
        description: '',
        seriesName: feedTitle,
        categories: [],
      };

      const existing = grouped.get(feedTitle);
      if (existing) {
        existing.push(issue);
      } else {
        grouped.set(feedTitle, [issue]);
      }
    }

    return Array.from(grouped.entries())
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { sensitivity: 'base' }))
      .map(([feedTitle, issues], index) => {
        issues.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
        return {
          feedId: -(index + 1),
          feedTitle,
          issues,
          latestIssue: issues[0],
        };
      });
  }, [offlineRegistry]);

  // Apply offline filter to groups
  const filteredGroups = useMemo(() => {
    if (!effectiveOfflineOnly) return magazineGroups;
    const offlineIds = new Set(offlineRegistry.filter(i => i.type === 'magazine').map(i => i.id));
    return magazineGroups
      .map(g => ({
        ...g,
        issues: g.issues.filter(i => offlineIds.has(i.id)),
      }))
      .filter(g => g.issues.length > 0)
      .map(g => ({ ...g, latestIssue: g.issues[0] }));
  }, [magazineGroups, effectiveOfflineOnly, offlineRegistry]);

  const displayedGroups = useMemo(() => {
    if (filteredGroups.length > 0 || !effectiveOfflineOnly) {
      return filteredGroups;
    }

    return offlineFallbackGroups;
  }, [filteredGroups, effectiveOfflineOnly, offlineFallbackGroups]);

  const visibleLoadingFeeds = useMemo(() => {
    if (displayedGroups.length > 0 && effectiveOfflineOnly) {
      return [];
    }

    return loadingFeeds;
  }, [displayedGroups.length, effectiveOfflineOnly, loadingFeeds]);

  const savedCountByFeed = useMemo(() => {
    const savedIds = new Set(offlineRegistry.filter(i => i.type === 'magazine').map(i => i.id));
    const counts: Record<number, number> = {};
    for (const group of displayedGroups) {
      counts[group.feedId] = group.issues.filter((issue) => savedIds.has(issue.id)).length;
    }
    return counts;
  }, [displayedGroups, offlineRegistry]);
  const groupsPerPage = useResponsiveGridPageSize({
    columns: paginatedGridColumns,
    aspectRatio: 3 / 4,
    metaHeight: 84,
    containerSize: overviewSize,
    gap: 24,
    chromeOffset: effectiveOffline ? 250 : 290,
  });
  const pagedGroups = usePaginatedItems(displayedGroups, groupsPerPage);
  const visibleGroups = einkMode ? pagedGroups.pageItems : displayedGroups;
  const visibleColumns = einkMode ? paginatedGridColumns : gridColumns;

  // Resolve the currently selected group from the feedId
  const selectedGroup = useMemo(() => {
    if (!selectedFeedId) return null;
    return displayedGroups.find(g => g.feedId === selectedFeedId) || null;
  }, [selectedFeedId, displayedGroups]);

  useEffect(() => {
    const visibleFeedIds = new Set(visibleGroups.map((group) => group.feedId));

    if (selectedFeedId !== null && !visibleFeedIds.has(selectedFeedId)) {
      setSelectedFeedId(null);
    }

    if (mountedFeedId !== null && !visibleFeedIds.has(mountedFeedId)) {
      setMountedFeedId(null);
    }
  }, [visibleGroups, selectedFeedId, mountedFeedId]);

  // Toggle a group open/closed
  const handleToggleGroup = useCallback((group: MagazineGroup) => {
    setSelectedFeedId(prev => {
      const next = prev === group.feedId ? null : group.feedId;
      if (next !== null) {
        // Opening — mount immediately
        setMountedFeedId(next);
      }
      // When closing, mountedFeedId stays set — cleared by handleRowAnimationDone
      return next;
    });
  }, []);

  // Called when the close animation finishes so we can unmount the row
  const handleRowClosed = useCallback(() => {
    setMountedFeedId(null);
  }, []);

  // Handle unsubscribe (delete feed)
  const handleUnsubscribe = useCallback(async (feedId: number) => {
    try {
      await unsubscribe(feedId);
      if (selectedFeedId === feedId) setSelectedFeedId(null);
    } catch (err) {
      console.error('[magazines] Failed to unsubscribe:', err);
    }
  }, [unsubscribe, selectedFeedId]);

  // Handle removing all saved issues for a feed
  const handleRemoveAllSaved = useCallback(async (feedId: number) => {
    const registry = useOfflineStore.getState().registry;
    const group = displayedGroups.find(g => g.feedId === feedId);
    if (!group) return;
    const issueIds = new Set(group.issues.map(i => i.id));
    const toRemove = registry.filter(i => i.type === 'magazine' && issueIds.has(i.id));
    for (const item of toRemove) {
      await removeOfflineItem(item.cacheKey);
    }
  }, [displayedGroups]);

  // Handle opening an issue
  const handleOpenIssue = useCallback((issue: MagazineIssue) => {
    openPdfViewer(issue);
  }, [openPdfViewer]);

  // Handle retry of a failed magazine download
  const handleRetryIssue = useCallback((_issue: MagazineIssue) => {
    // The IssueThumb handles the API call + local state.
    // Nothing extra needed here right now.
  }, []);

  // Handle page change — track progress
  const handlePageChange = useCallback((page: number, totalPages: number) => {
    setPdfPage(page);
    if (selectedIssue) {
      const entryId = parseInt(selectedIssue.id, 10);
      const entry = entries.find(e => e.id === entryId);
      const pdfEnclosure = entry?.enclosures?.find(e => e.mime_type === 'application/pdf');
      updateReadingProgress(entryId, page, totalPages, pdfEnclosure?.id);
    }
  }, [setPdfPage, selectedIssue, entries, updateReadingProgress]);

  // Handle close — sync progress to Informeer
  const handleClosePdfViewer = useCallback(() => {
    closePdfViewer();
  }, [closePdfViewer]);

  // Get max read page for current PDF
  const currentMaxReadPage = useMemo(() => {
    if (!selectedIssue) return 0;
    const entryId = parseInt(selectedIssue.id, 10);
    return readingProgress[entryId]?.maxPage || 0;
  }, [selectedIssue, readingProgress]);

  // Build progress map for cover grid
  const progressMap = useMemo(() => {
    const map: Record<string, { maxPage: number; totalPages: number }> = {};
    for (const [entryId, progress] of Object.entries(readingProgress)) {
      if (progress.maxPage > 0) {
        map[entryId] = { maxPage: progress.maxPage, totalPages: progress.totalPages };
      }
    }
    return map;
  }, [readingProgress]);

  return (
    <>
      <div className="flex flex-col h-full relative">
        {/* Stack grid view — always visible */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden content-below-header content-above-navbar">
          {subscriptions.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-tertiary)] p-8">
              <Library size={64} className="mb-6 opacity-30" />
              <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                No magazine feeds yet
              </h2>
              <p className="text-sm text-center max-w-md mb-6">
                Add RSS feeds with PDF download links to the configured Magazines category.
                They'll appear here as a cover grid, and you can read PDFs right in the app.
              </p>
              <div className="mt-4 flex flex-col items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                <p className="flex items-center gap-1.5">
                  <Rss size={12} />
                  Add feeds with PDF links to your Magazines category
                </p>
                <p>Covers and PDFs are detected automatically from entry content</p>
              </div>
            </div>
          ) : displayedGroups.length === 0 && effectiveOfflineOnly ? (
            // No offline issues
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-tertiary)] p-8">
              <CloudOff size={48} className="mb-4 opacity-30" />
              <p className="text-sm">No magazines saved for offline use</p>
              {!effectiveOffline && (
              <button
                onClick={() => setShowOfflineOnly(false)}
                className="mt-3 text-xs text-[var(--color-accent-fg)] hover:underline"
              >
                Show all magazines
              </button>
              )}
            </div>
          ) : displayedGroups.length === 0 && visibleLoadingFeeds.length === 0 ? (
            // Loading state
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-tertiary)] p-8">
              <Library size={48} className="mb-4 opacity-30" />
              <p className="text-sm">No magazine issues loaded yet. The server is fetching them...</p>
            </div>
          ) : (
            // Magazine stacks grid with inline issue rows
            <>
              {/* Filter bar */}
              {!effectiveOffline && (
                <FilterBar
                  groups={[{
                    options: [
                      { value: 'all', label: 'All' },
                      { value: 'offline', label: 'Saved Offline', icon: CloudOff },
                    ],
                    value: effectiveOfflineOnly ? 'offline' : 'all',
                    onChange: (v: string) => setShowOfflineOnly(v === 'offline'),
                  }]}
                />
              )}
              <div ref={overviewRef} className="flex-1 min-h-0">
                {einkMode ? (
                  <PaginatedOverviewSurface
                    currentPage={pagedGroups.currentPage}
                    pageCount={pagedGroups.pageCount}
                    totalItems={displayedGroups.length}
                    rangeStart={pagedGroups.rangeStart}
                    rangeEnd={pagedGroups.rangeEnd}
                    onPrevPage={pagedGroups.goToPrevPage}
                    onNextPage={pagedGroups.goToNextPage}
                    enabled={!isPdfViewerOpen}
                  >
                    <div
                      ref={gridRef}
                      className="grid gap-x-8 gap-y-6 p-6"
                      style={{ gridTemplateColumns: `repeat(${visibleColumns}, minmax(0, 1fr))` }}
                    >
                      {/* Placeholder stacks for feeds still loading entries */}
                      {pagedGroups.currentPage === 0 && visibleLoadingFeeds.map(feed => (
                        <div key={`loading-${feed.id}`} className="flex flex-col gap-2.5">
                          <div className={cn(
                            'relative aspect-[3/4] w-full rounded-lg',
                            'bg-[var(--color-surface-secondary)]',
                            'flex items-center justify-center',
                            'animate-pulse',
                          )}>
                            <Loader2 size={28} className="text-[var(--color-text-tertiary)] animate-spin" />
                          </div>
                          <div className="flex flex-col gap-0.5 px-0.5">
                            <h3 className="text-sm font-semibold leading-tight line-clamp-2 text-[var(--color-text-primary)]">
                              {feed.title}
                            </h3>
                            <span className="text-xs text-[var(--color-text-tertiary)]">Fetching issues…</span>
                          </div>
                        </div>
                      ))}
                      {renderStacksWithIssueRow(
                        visibleGroups,
                        visibleColumns,
                        selectedFeedId,
                        mountedFeedId,
                        handleToggleGroup,
                        handleOpenIssue,
                        handleRowClosed,
                        setSelectedFeedId,
                        progressMap,
                        handleRetryIssue,
                        savedCountByFeed,
                        handleUnsubscribe,
                        handleRemoveAllSaved,
                      )}
                    </div>
                  </PaginatedOverviewSurface>
                ) : (
                  <div className="h-full min-h-0 overflow-y-auto">
                    <div
                      ref={gridRef}
                      className={cn(
                        'grid gap-x-8 gap-y-6 p-6',
                        'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                      )}
                    >
                      {visibleLoadingFeeds.map(feed => (
                        <div key={`loading-${feed.id}`} className="flex flex-col gap-2.5">
                          <div className={cn(
                            'relative aspect-[3/4] w-full rounded-lg',
                            'bg-[var(--color-surface-secondary)]',
                            'flex items-center justify-center',
                            'animate-pulse',
                          )}>
                            <Loader2 size={28} className="text-[var(--color-text-tertiary)] animate-spin" />
                          </div>
                          <div className="flex flex-col gap-0.5 px-0.5">
                            <h3 className="text-sm font-semibold leading-tight line-clamp-2 text-[var(--color-text-primary)]">
                              {feed.title}
                            </h3>
                            <span className="text-xs text-[var(--color-text-tertiary)]">Fetching issues…</span>
                          </div>
                        </div>
                      ))}
                      {renderStacksWithIssueRow(
                        visibleGroups,
                        visibleColumns,
                        selectedFeedId,
                        mountedFeedId,
                        handleToggleGroup,
                        handleOpenIssue,
                        handleRowClosed,
                        setSelectedFeedId,
                        progressMap,
                        handleRetryIssue,
                        savedCountByFeed,
                        handleUnsubscribe,
                        handleRemoveAllSaved,
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* PDF Viewer overlay */}
      {isPdfViewerOpen && selectedIssue && (
        <ErrorBoundary
          context="PDFViewer"
          onError={() => closePdfViewer()}
        >
          <PDFViewer
            pdfUrl={selectedIssue.pdfUrl}
            title={selectedIssue.title}
            pdfLayout={selectedIssue.pdfLayout}
            entryId={selectedIssue.id}
            coverUrl={selectedIssue.coverUrl}
            feedTitle={selectedIssue.seriesName}
            initialPage={currentPdfPage}
            maxReadPage={currentMaxReadPage}
            onPageChange={handlePageChange}
            onClose={handleClosePdfViewer}
          />
        </ErrorBoundary>
      )}
    </>
  );
}

// ==================== Grid Row Logic ====================

/**
 * Renders magazine stacks in the CSS grid, inserting the issues row
 * after the complete *visual row* that contains the selected stack.
 *
 * E.g. with 4 columns and stacks [A B C D | E F G H | I J]:
 *   - clicking C (index 2, visual row 0) inserts the row after D (index 3)
 *   - clicking F (index 5, visual row 1) inserts the row after H (index 7)
 *
 * The `col-span-full` on the IssuesRow then spans the full grid width
 * without displacing any stacks within the same visual row.
 */
function renderStacksWithIssueRow(
  groups: MagazineGroup[],
  columns: number,
  selectedFeedId: number | null,
  mountedFeedId: number | null,
  onToggle: (g: MagazineGroup) => void,
  onOpenIssue: (issue: MagazineIssue) => void,
  onRowClosed: () => void,
  setSelectedFeedId: (id: number | null) => void,
  progressMap: Record<string, { maxPage: number; totalPages: number }>,
  onRetryIssue?: (issue: MagazineIssue) => void,
  savedCountByFeed?: Record<number, number>,
  onUnsubscribe?: (feedId: number) => void,
  onRemoveAllSaved?: (feedId: number) => void,
) {
  // Find the index of the group that should have the row beneath it
  const activeFeedId = mountedFeedId ?? selectedFeedId;
  const selectedIdx = activeFeedId != null
    ? groups.findIndex(g => g.feedId === activeFeedId)
    : -1;

  // Compute the last index in the same visual row
  const rowEnd = selectedIdx >= 0
    ? Math.min(Math.floor(selectedIdx / columns) * columns + columns - 1, groups.length - 1)
    : -1;

  // The group whose data the row will show
  const rowGroup = activeFeedId != null
    ? groups.find(g => g.feedId === activeFeedId)
    : null;

  const items: React.ReactNode[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    items.push(
      <MagazineStack
        key={group.feedId}
        group={group}
        onOpen={onToggle}
        progressMap={progressMap}
        isSelected={selectedFeedId === group.feedId}
        savedCount={savedCountByFeed?.[group.feedId] || 0}
        onUnsubscribe={group.feedId > 0 ? onUnsubscribe : undefined}
        onRemoveAllSaved={onRemoveAllSaved}
      />
    );

    // Insert the issues row after the last stack in the selected visual row
    if (i === rowEnd && rowGroup) {
      items.push(
        <MagazineIssuesRow
          key={`row-${rowGroup.feedId}`}
          group={rowGroup}
          isOpen={selectedFeedId === rowGroup.feedId}
          onClose={() => setSelectedFeedId(null)}
          onClosed={onRowClosed}
          onOpenIssue={onOpenIssue}
          onRetryIssue={onRetryIssue}
          progressMap={progressMap}
        />
      );
    }
  }

  return items;
}

// ==================== Issue Date Parsing ====================

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a date from a magazine issue title.
 * Handles common patterns:
 * - "... – 21-27 February 2026"        → date range
 * - "... – March-April 2026"            → month range
 * - "... – March 2026"                  → single month
 * - "... – April 2026"                  → single month
 * - "... – 7 February 2026"             → specific date
 * Returns a timestamp (ms) or null if unparseable.
 */
function parseIssueDateFromTitle(title: string): number | null {
  // Extract the date part after the separator
  const separators = [' – ', ' — ', ' - ', ': '];
  let datePart = '';
  for (const sep of separators) {
    const idx = title.indexOf(sep);
    if (idx !== -1) {
      datePart = title.slice(idx + sep.length).trim();
      break;
    }
  }
  if (!datePart) return null;

  const lower = datePart.toLowerCase();

  // Pattern: "DD Month YYYY" or "DD-DD Month YYYY"
  const dayMonthYear = lower.match(/(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s+([a-z]+)\s+(\d{4})/);
  if (dayMonthYear) {
    const day = parseInt(dayMonthYear[1], 10);
    const month = MONTH_MAP[dayMonthYear[2]];
    const year = parseInt(dayMonthYear[3], 10);
    if (month !== undefined && year > 2000) {
      return new Date(year, month, day).getTime();
    }
  }

  // Pattern: "Month-Month YYYY" or "Month YYYY"
  const monthYear = lower.match(/([a-z]+)(?:\s*[-–]\s*[a-z]+)?\s+(\d{4})/);
  if (monthYear) {
    const month = MONTH_MAP[monthYear[1]];
    const year = parseInt(monthYear[2], 10);
    if (month !== undefined && year > 2000) {
      return new Date(year, month, 1).getTime();
    }
  }

  return null;
}

