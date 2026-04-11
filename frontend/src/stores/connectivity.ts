/**
 * Connectivity Store
 * Tracks online/offline state and last successful API timestamp.
 */

import { create } from 'zustand';

interface ConnectivityState {
  isOnline: boolean;
  /** Timestamp of last successful API call */
  lastApiSuccess: number;
  /** Brief "Back online" toast visible after reconnect */
  showReconnected: boolean;
}

export const useConnectivityStore = create<ConnectivityState>(() => ({
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  lastApiSuccess: Date.now(),
  showReconnected: false,
}));

/** Call after every successful API response */
export function markApiSuccess() {
  useConnectivityStore.setState({ lastApiSuccess: Date.now() });
}

let cleanupFn: (() => void) | null = null;

/**
 * Initialise connectivity listeners. Call once from root component.
 * Returns a cleanup function.
 */
export function initConnectivity(onOnline?: () => void) {
  if (cleanupFn) return cleanupFn; // already initialised

  const set = useConnectivityStore.setState;

  const goOnline = () => {
    set({ isOnline: true, showReconnected: true });
    // Auto-hide "Back online" after 3 seconds
    setTimeout(() => set({ showReconnected: false }), 3000);
    onOnline?.();
  };

  const goOffline = () => {
    set({ isOnline: false, showReconnected: false });
  };

  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);

  cleanupFn = () => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
    cleanupFn = null;
  };

  return cleanupFn;
}
