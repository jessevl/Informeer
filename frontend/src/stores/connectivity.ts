/**
 * Connectivity Store
 * Tracks online/offline state and last successful API timestamp.
 */

import { create } from 'zustand';
import { getNativeShellNetworkStatus } from '@/services/native-shell';

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

let reconnectToastTimer: ReturnType<typeof setTimeout> | null = null;

function applyConnectivityState(nextOnline: boolean, onOnline?: () => void, showReconnectToast = false) {
  const previousOnline = useConnectivityStore.getState().isOnline;
  const shouldShowReconnect = showReconnectToast && nextOnline && !previousOnline;

  useConnectivityStore.setState({
    isOnline: nextOnline,
    showReconnected: shouldShowReconnect,
  });

  if (reconnectToastTimer) {
    clearTimeout(reconnectToastTimer);
    reconnectToastTimer = null;
  }

  if (shouldShowReconnect) {
    reconnectToastTimer = setTimeout(() => {
      useConnectivityStore.setState({ showReconnected: false });
      reconnectToastTimer = null;
    }, 3000);
  }

  if (nextOnline && !previousOnline) {
    onOnline?.();
  }
}

export async function refreshConnectivityState(onOnline?: () => void, showReconnectToast = false) {
  let nextOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  try {
    const nativeStatus = await getNativeShellNetworkStatus();
    if (nativeStatus) {
      nextOnline = nativeStatus.connected;
    }
  } catch {
    // Fall back to navigator.onLine when the native bridge is unavailable.
  }

  applyConnectivityState(nextOnline, onOnline, showReconnectToast);
  return nextOnline;
}

let cleanupFn: (() => void) | null = null;

/**
 * Initialise connectivity listeners. Call once from root component.
 * Returns a cleanup function.
 */
export function initConnectivity(onOnline?: () => void) {
  if (cleanupFn) return cleanupFn; // already initialised

  const syncConnectivity = (showReconnectToast = false) => {
    void refreshConnectivityState(onOnline, showReconnectToast);
  };

  const handleOnline = () => syncConnectivity(true);
  const handleOffline = () => syncConnectivity(false);
  const handleFocus = () => syncConnectivity(true);
  const handlePageShow = () => syncConnectivity(true);

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      syncConnectivity(true);
    }
  };

  syncConnectivity(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  window.addEventListener('focus', handleFocus);
  window.addEventListener('pageshow', handlePageShow);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  cleanupFn = () => {
    if (reconnectToastTimer) {
      clearTimeout(reconnectToastTimer);
      reconnectToastTimer = null;
    }
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('pageshow', handlePageShow);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    cleanupFn = null;
  };

  return cleanupFn;
}
