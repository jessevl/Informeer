/**
 * OfflineBanner
 *
 * Thin bar shown when the device is offline.
 * Auto-dismisses on reconnect with a brief "Back online" flash.
 */

import { useConnectivityStore } from '@/stores/connectivity';

export function OfflineBanner() {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const showReconnected = useConnectivityStore((s) => s.showReconnected);

  if (isOnline && !showReconnected) return null;

  if (showReconnected) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium bg-emerald-500/90 text-white transition-all duration-300">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-white" />
        Back online
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium bg-amber-500/90 text-amber-950 transition-all duration-300">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-800 animate-pulse" />
      Offline — showing last loaded data
    </div>
  );
}
