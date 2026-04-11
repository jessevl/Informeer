/**
 * useOfflineStatus Hook
 *
 * Reusable hook for "Save offline / Remove" interactions on any content type.
 * Uses the reactive offline store so state stays in sync across all components.
 */

import { useState, useCallback } from 'react';
import {
  removeOfflineItem,
  type OfflineItem,
} from '@/lib/offline/blob-cache';
import { useIsOffline } from '@/stores/offline';

export function useOfflineStatus(type: OfflineItem['type'], id: string) {
  const saved = useIsOffline(type, id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (downloadFn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await downloadFn();
      // No need to setSaved — store auto-updates via event
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      console.error(`[offline] Failed to save ${type} ${id}:`, err);
    } finally {
      setSaving(false);
    }
  }, [type, id]);

  const remove = useCallback(async (cacheKey: string) => {
    await removeOfflineItem(cacheKey);
    // No need to setSaved — store auto-updates via event
  }, []);

  return { saved, saving, error, save, remove };
}
