/**
 * Offline Store
 *
 * Reactive Zustand store for offline content state.
 * Listens for registry changes from blob-cache and keeps all subscribers in sync.
 */

import { create } from 'zustand';
import { useCallback } from 'react';
import { getOfflineRegistry, type OfflineItem } from '@/lib/offline/blob-cache';

// ── Event name used by blob-cache to signal mutations ──
export const OFFLINE_REGISTRY_CHANGED = 'offline-registry-changed';

interface OfflineState {
  /** Current snapshot of the offline registry */
  registry: OfflineItem[];
  /** Re-read registry from localStorage — called automatically on mutations */
  refresh: () => void;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  registry: getOfflineRegistry(),
  refresh: () => set({ registry: getOfflineRegistry() }),
}));

// Auto-refresh store when blob-cache signals a change
if (typeof window !== 'undefined') {
  window.addEventListener(OFFLINE_REGISTRY_CHANGED, () => {
    useOfflineStore.getState().refresh();
  });
}

// ── Convenience hooks ──

/** Reactive check whether a specific item is saved offline */
export function useIsOffline(type: OfflineItem['type'], id: string): boolean {
  const selector = useCallback(
    (s: OfflineState) => s.registry.some((i) => i.type === type && i.id === id),
    [type, id],
  );
  return useOfflineStore(selector);
}

export function useOfflineItem(type: OfflineItem['type'], id: string): OfflineItem | null {
  const selector = useCallback(
    (s: OfflineState) => s.registry.find((item) => item.type === type && item.id === id) ?? null,
    [type, id],
  );
  return useOfflineStore(selector);
}

/** Reactive access to the full registry */
export function useOfflineRegistry(): OfflineItem[] {
  return useOfflineStore((s) => s.registry);
}
