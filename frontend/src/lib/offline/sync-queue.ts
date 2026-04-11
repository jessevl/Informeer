/**
 * Offline Sync Queue
 *
 * Lightweight queue stored in localStorage, for mutations made while offline.
 * Flushed when the app comes back online or on tab focus.
 */

import { api } from '@/api/client';

export interface SyncItem {
  id: string;
  type: 'book-progress' | 'magazine-progress' | 'mark-read' | 'mark-unread' | 'toggle-bookmark';
  payload: Record<string, any>;
  timestamp: number;
}

const QUEUE_KEY = 'informeer-sync-queue';

function getQueue(): SyncItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function setQueue(queue: SyncItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Add an item to the sync queue. Deduplicates by id (last write wins). */
export function enqueue(item: Omit<SyncItem, 'timestamp'>) {
  const queue = getQueue().filter(q => q.id !== item.id);
  queue.push({ ...item, timestamp: Date.now() });
  setQueue(queue);
}

/** Get current queue length (for UI badge). */
export function getSyncQueueLength(): number {
  return getQueue().length;
}

/**
 * Attempt to flush the queue. Called on:
 *  - `online` event
 *  - Tab focus/visibility (if online)
 *  - After successful API call
 */
export async function flushSyncQueue(): Promise<void> {
  if (!navigator.onLine) return;

  const queue = getQueue();
  if (queue.length === 0) return;

  const remaining: SyncItem[] = [];

  for (const item of queue) {
    try {
      await applySyncItem(item);
    } catch {
      remaining.push(item); // keep for retry
    }
  }

  setQueue(remaining);
}

async function applySyncItem(item: SyncItem): Promise<void> {
  switch (item.type) {
    case 'book-progress':
      await api.updateBookProgress(item.payload.bookId, {
        cfi: item.payload.cfi,
        percentage: item.payload.percentage,
        chapter: item.payload.chapter,
      });
      break;

    case 'magazine-progress':
      await api.updateEnclosureProgress(
        item.payload.enclosureId,
        item.payload.maxPage,
      );
      break;

    case 'mark-read':
      await api.updateEntries({
        entry_ids: [item.payload.entryId],
        status: 'read',
      });
      break;

    case 'mark-unread':
      await api.updateEntries({
        entry_ids: [item.payload.entryId],
        status: 'unread',
      });
      break;

    case 'toggle-bookmark':
      await api.toggleBookmark(item.payload.entryId);
      break;
  }
}
