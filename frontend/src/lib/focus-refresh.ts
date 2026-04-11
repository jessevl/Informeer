/**
 * Focus / Visibility Refetch
 *
 * When the user returns to the tab after inactivity, refresh stale data
 * in the background without disrupting the current view.
 */

const STALE_THRESHOLDS = {
  entries: 2 * 60_000,   // 2 min
  feeds: 10 * 60_000,    // 10 min
  counters: 2 * 60_000,  // 2 min
} as const;

const lastRefresh: Record<string, number> = {
  entries: Date.now(),
  feeds: Date.now(),
  counters: Date.now(),
};

/** Mark a data type as freshly fetched (call after successful fetch). */
export function markRefreshed(key: keyof typeof STALE_THRESHOLDS) {
  lastRefresh[key] = Date.now();
}

export interface FocusRefreshCallbacks {
  refreshEntries: () => Promise<void>;
  refreshFeeds: () => Promise<void>;
  refreshCounters: () => Promise<void>;
}

/**
 * Initialise focus/visibility-based background refetch.
 * Call once from root component after auth is confirmed.
 * Returns a cleanup function.
 */
export function initFocusRefresh(callbacks: FocusRefreshCallbacks): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const handler = () => {
    if (document.hidden || !navigator.onLine) return;

    // Debounce rapid focus/visibility events (300 ms)
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const now = Date.now();

      if (now - lastRefresh.entries > STALE_THRESHOLDS.entries) {
        callbacks.refreshEntries()
          .then(() => markRefreshed('entries'))
          .catch(() => {}); // silent — keep existing data
      }
      if (now - lastRefresh.feeds > STALE_THRESHOLDS.feeds) {
        callbacks.refreshFeeds()
          .then(() => markRefreshed('feeds'))
          .catch(() => {});
      }
      if (now - lastRefresh.counters > STALE_THRESHOLDS.counters) {
        callbacks.refreshCounters()
          .then(() => markRefreshed('counters'))
          .catch(() => {});
      }
    }, 300);
  };

  document.addEventListener('visibilitychange', handler);
  window.addEventListener('focus', handler);

  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('focus', handler);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
