/**
 * useRemoteProgressSync — Cross-device reading progress sync
 *
 * Periodically polls the server for the latest reading position.
 * If the server position is further ahead than the local max position
 * (i.e. another device has read further), surfaces a notification
 * so the user can jump to that position — like Kindle's Whispersync.
 *
 * Works for both EPUBs (percentage-based) and magazines (page-based).
 *
 * Edge cases handled:
 * - User going back to review earlier pages → doesn't re-trigger
 * - User dismisses → won't show again for that same remote position
 * - Network failures → silently ignored, retries on next interval
 * - Reader closes → cleanup via useEffect
 * - Offline → skips polling entirely
 * - Fast page turns → only polls at intervals, not on every page change
 * - Race with own sync → uses updated_at / position comparison to avoid
 *   showing notification for our own recently-synced progress
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/** Position descriptor — either percentage (EPUB) or page number (magazine) */
export interface ProgressPosition {
  /** Normalized value for comparison: percentage (0-1) or page number */
  value: number;
  /** Human-readable label for the notification, e.g. "42%" or "page 87" */
  label: string;
  /** For EPUB: the CFI to jump to */
  cfi?: string;
}

export interface RemoteProgressSyncOptions {
  /** Whether sync is enabled (reader is open and we have an ID) */
  enabled: boolean;
  /** Poll interval in ms (default: 30000 = 30s) */
  pollInterval?: number;
  /** Fetch the latest progress from the server. Return null if unavailable. */
  fetchRemoteProgress: () => Promise<ProgressPosition | null>;
  /** The local max position (furthest point reached on this device/session) */
  localMaxPosition: number;
  /** Grace margin — server must be ahead by at least this much to trigger (default: 0.01 for %, 1 for pages) */
  threshold?: number;
}

export interface RemoteProgressSyncState {
  /** Whether we have a remote position to offer */
  hasRemoteUpdate: boolean;
  /** The remote position description */
  remotePosition: ProgressPosition | null;
  /** Jump to the remote position (consumer must implement the actual jump) */
  acceptRemotePosition: () => void;
  /** Dismiss the notification (won't show again for this position) */
  dismissRemotePosition: () => void;
}

export function useRemoteProgressSync(
  options: RemoteProgressSyncOptions,
): RemoteProgressSyncState {
  const {
    enabled,
    pollInterval = 15_000,
    fetchRemoteProgress,
    localMaxPosition,
    threshold = 0,
  } = options;

  const [remotePosition, setRemotePosition] = useState<ProgressPosition | null>(null);
  const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false);

  // Track the dismissed position so we don't re-show
  const dismissedValueRef = useRef<number | null>(null);
  // Track accepted position to avoid re-prompting
  const acceptedValueRef = useRef<number | null>(null);
  // Track the local max to avoid stale closure issues
  const localMaxRef = useRef(localMaxPosition);
  localMaxRef.current = localMaxPosition;
  // Stable callback refs
  const fetchRef = useRef(fetchRemoteProgress);
  fetchRef.current = fetchRemoteProgress;

  // Reset dismissed/accepted when the reader target changes
  // (the consumer should change `enabled` when switching books/magazines)
  useEffect(() => {
    dismissedValueRef.current = null;
    acceptedValueRef.current = null;
    setHasRemoteUpdate(false);
    setRemotePosition(null);
  }, [enabled]);

  // Polling effect
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function poll() {
      if (cancelled || !navigator.onLine) return;

      try {
        const remote = await fetchRef.current();
        if (cancelled || !remote) return;

        const localMax = localMaxRef.current;

        // Is the server position meaningfully ahead of our local max?
        const isAhead = remote.value > localMax + threshold;

        // Was this position already dismissed or accepted?
        const wasDismissed = dismissedValueRef.current !== null &&
          Math.abs(remote.value - dismissedValueRef.current) < threshold + 0.001;
        const wasAccepted = acceptedValueRef.current !== null &&
          Math.abs(remote.value - acceptedValueRef.current) < threshold + 0.001;

        if (isAhead && !wasDismissed && !wasAccepted) {
          setRemotePosition(remote);
          setHasRemoteUpdate(true);
        } else if (!isAhead) {
          // Local caught up or surpassed — hide notification
          setHasRemoteUpdate(false);
          setRemotePosition(null);
        }
      } catch {
        // Network error — silently ignore, retry next interval
      }
    }

    // Initial poll shortly after open so remote progress surfaces quickly.
    const initialTimer = setTimeout(poll, Math.min(750, pollInterval));

    // Recurring poll
    const interval = setInterval(poll, pollInterval);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [enabled, pollInterval, threshold]);

  const acceptRemotePosition = useCallback(() => {
    if (remotePosition) {
      acceptedValueRef.current = remotePosition.value;
    }
    setHasRemoteUpdate(false);
  }, [remotePosition]);

  const dismissRemotePosition = useCallback(() => {
    if (remotePosition) {
      dismissedValueRef.current = remotePosition.value;
    }
    setHasRemoteUpdate(false);
    setRemotePosition(null);
  }, [remotePosition]);

  return {
    hasRemoteUpdate,
    remotePosition,
    acceptRemotePosition,
    dismissRemotePosition,
  };
}
