/**
 * Shared E-ink power lifecycle hooks for reader components.
 *
 * Provides:
 * - useEinkWorkTag: critical work tracking with auto-replace semantics
 * - useReaderWakeHandlers: page-turn wake command registration
 * - useAutoHideControls: toolbar auto-hide with configurable delay
 */

import type { PluginListenerHandle } from '@capacitor/core';
import { useCallback, useEffect, useRef } from 'react';
import { einkPower } from '@/services/eink-power';

// ─── Critical Work Tag Management ──────────────────────────────────

interface EinkWorkTagOptions {
  /** Prefix for tags, e.g. 'epub:42' or 'pdf:42' */
  prefix: string;
  /**
   * Replace-on-start: when true, starting new work automatically ends
   * the previous work tag (EPUB/PDF pattern). When false, each tag is
   * independent and must be ended explicitly (Article pattern).
   */
  replaceOnStart?: boolean;
}

/**
 * Manages E-ink critical work tags for a reader component.
 *
 * Two patterns are supported:
 * - **replace** (EPUB/PDF): `startEinkWork` auto-ends the previous tag
 *   via a ref, ensuring only one tag is active at a time.
 *   `finishEinkWork(markReady?)` ends the current tag and optionally
 *   sends the ready signals.
 * - **independent** (Article): each `startEinkWork` returns a tag that
 *   the caller must pass to `finishEinkWork` manually.
 */
export function useEinkWorkTag({ prefix, replaceOnStart = true }: EinkWorkTagOptions) {
  const tagRef = useRef<string | null>(null);

  const startEinkWork = useCallback((reason: string) => {
    const tag = `${prefix}:${reason}:${Date.now()}`;
    if (replaceOnStart && tagRef.current) {
      einkPower.endCriticalWork(tagRef.current);
    }
    if (replaceOnStart) {
      tagRef.current = tag;
    }
    einkPower.beginCriticalWork(tag);
    return tag;
  }, [prefix, replaceOnStart]);

  const finishEinkWork = useCallback(async (tagOrReady?: string | null | boolean) => {
    if (replaceOnStart) {
      // Replace pattern: end stored tag, optionally signal ready
      const markReady = typeof tagOrReady === 'boolean' ? tagOrReady : false;
      if (tagRef.current) {
        einkPower.endCriticalWork(tagRef.current);
        tagRef.current = null;
      }
      if (markReady) {
        await einkPower.markVisualStable();
        await einkPower.notifyInteractiveReady();
      }
    } else {
      // Independent pattern: end the specific tag passed in
      const tag = typeof tagOrReady === 'string' ? tagOrReady : null;
      if (tag) {
        einkPower.endCriticalWork(tag);
      }
    }
  }, [replaceOnStart]);

  // Cleanup: end any active tag on unmount
  useEffect(() => {
    return () => {
      if (tagRef.current) {
        einkPower.endCriticalWork(tagRef.current);
        tagRef.current = null;
      }
    };
  }, []);

  return { startEinkWork, finishEinkWork, tagRef };
}

// ─── Wake Command Handlers ─────────────────────────────────────────

/**
 * Registers page-turn wake command handlers with the E-ink power controller.
 * When the device wakes from hibernation via hardware buttons, the native
 * side sends a wake command that triggers the registered page-turn callback.
 */
export function useReaderWakeHandlers(
  nextPage: (() => void) | undefined,
  prevPage: (() => void) | undefined,
  enabled = true,
) {
  const wakeReadyInFlightRef = useRef(false);
  // Track whether page-turn wake handlers are currently registered.
  // When they are, the fast-track notifyInteractiveReady must be skipped
  // because the wake will trigger a page turn and finishEinkWork(true) in the
  // relocated handler will call notifyInteractiveReady at the right time.
  // If we fast-track here too, native sees notifyInteractiveReady BEFORE
  // beginCriticalWork, which breaks the hibernate-after-page-turn sequence
  // and produces the alternating pattern (1st turn hibernates, 2nd doesn't...).
  const hasTurnHandlersRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      hasTurnHandlersRef.current = false;
      einkPower.setWakeHandlers(null);
      return;
    }

    hasTurnHandlersRef.current = !!(nextPage || prevPage);
    einkPower.setWakeHandlers({
      nextPage: nextPage ?? undefined,
      prevPage: prevPage ?? undefined,
    });

    return () => {
      hasTurnHandlersRef.current = false;
      einkPower.setWakeHandlers(null);
    };
  }, [nextPage, prevPage, enabled]);

  useEffect(() => {
    if (!enabled) {
      wakeReadyInFlightRef.current = false;
      return;
    }

    let disposed = false;
    let stateHandle: PluginListenerHandle | null = null;

    void einkPower.addStateListener((event) => {
      if (disposed) return;

      const shouldFastTrackWake = event.gestureModel === 'paginated'
        && event.state === 'waking'
        && event.waitingForInteractiveReady
        && event.reason === 'hardware-key';

      if (!shouldFastTrackWake) {
        wakeReadyInFlightRef.current = false;
        return;
      }

      // Skip fast-track when page-turn handlers are registered: the wake will
      // trigger a page turn and finishEinkWork(true) → notifyInteractiveReady
      // will fire after the page renders, which is the correct moment.
      if (hasTurnHandlersRef.current) return;

      if (wakeReadyInFlightRef.current) return;
      wakeReadyInFlightRef.current = true;

      void einkPower.notifyInteractiveReady().finally(() => {
        if (!disposed) {
          wakeReadyInFlightRef.current = false;
        }
      });
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      stateHandle = handle;
    }).catch((error) => {
      console.error('Failed to subscribe to E-ink wake state', error);
    });

    return () => {
      disposed = true;
      wakeReadyInFlightRef.current = false;
      if (stateHandle) {
        void stateHandle.remove();
      }
    };
  }, [enabled]);
}

// ─── Auto-Hide Controls ────────────────────────────────────────────

const DEFAULT_AUTO_HIDE_MS = 4000;

/**
 * Auto-hides reader controls (toolbar, TOC, etc.) after a period of
 * inactivity. The timer resets each time `deps` change (e.g. user
 * re-toggles the controls).
 */
export function useAutoHideControls(
  showControls: boolean,
  setShowControls: (show: boolean) => void,
  /** Extra conditions that suppress auto-hide (e.g. loading, TOC open) */
  suppressWhen?: boolean,
  delayMs = DEFAULT_AUTO_HIDE_MS,
) {
  useEffect(() => {
    if (!showControls || suppressWhen) return;
    const timer = setTimeout(() => setShowControls(false), delayMs);
    return () => clearTimeout(timer);
  }, [showControls, setShowControls, suppressWhen, delayMs]);
}
