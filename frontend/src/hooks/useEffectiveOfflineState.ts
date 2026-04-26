import { useConnectivityStore } from '@/stores/connectivity';
import { useSettingsStore } from '@/stores/settings';

export interface EffectiveOfflineState {
  manualOffline: boolean;
  forcedOffline: boolean;
  effectiveOffline: boolean;
  isOnline: boolean;
}

export function getEffectiveOfflineStateSnapshot(): EffectiveOfflineState {
  const manualOffline = useSettingsStore.getState().offlineMode;
  const isOnline = useConnectivityStore.getState().isOnline;
  const forcedOffline = !isOnline;

  return {
    manualOffline,
    forcedOffline,
    effectiveOffline: manualOffline || forcedOffline,
    isOnline,
  };
}

export function useEffectiveOfflineState(): EffectiveOfflineState {
  const manualOffline = useSettingsStore((s) => s.offlineMode);
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const forcedOffline = !isOnline;

  return {
    manualOffline,
    forcedOffline,
    effectiveOffline: manualOffline || forcedOffline,
    isOnline,
  };
}