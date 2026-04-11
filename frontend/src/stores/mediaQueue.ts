import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Entry, Enclosure } from '@/types/api';

export type MediaQueueItem =
  | {
      id: string;
      mediaType: 'audio';
      entry: Entry;
      enclosure: Enclosure;
    }
  | {
      id: string;
      mediaType: 'video';
      entry: Entry;
      enclosure: Enclosure | null;
      youtubeId: string | null;
    }
  | {
      id: string;
      mediaType: 'tts';
      entry: Entry;
      text: string;
    };

interface MediaQueueState {
  queue: MediaQueueItem[];
  addAudioToQueue: (enclosure: Enclosure, entry: Entry) => void;
  addVideoToQueue: (entry: Entry, options: { enclosure?: Enclosure | null; youtubeId?: string | null }) => void;
  addTTSToQueue: (entry: Entry, text: string) => void;
  removeFromQueue: (queueItemId: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  popNext: () => MediaQueueItem | null;
  isAudioQueued: (enclosureId: number) => boolean;
  isVideoQueued: (entryId: number) => boolean;
  isTTSQueued: (entryId: number) => boolean;
}

const MEDIA_QUEUE_STORAGE_VERSION = 1;

function isValidEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Entry>;
  return typeof candidate.id === 'number' && typeof candidate.title === 'string';
}

function isValidEnclosure(value: unknown): value is Enclosure {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Enclosure>;
  return typeof candidate.id === 'number' && typeof candidate.url === 'string';
}

function sanitizeQueue(value: unknown): MediaQueueItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const mediaType = item.mediaType;

      if (mediaType === 'audio' && isValidEntry(item.entry) && isValidEnclosure(item.enclosure) && typeof item.id === 'string') {
        return {
          id: item.id,
          mediaType: 'audio' as const,
          entry: item.entry,
          enclosure: item.enclosure,
        };
      }

      if (
        mediaType === 'video' &&
        isValidEntry(item.entry) &&
        (item.enclosure === null || isValidEnclosure(item.enclosure)) &&
        (item.youtubeId === null || typeof item.youtubeId === 'string') &&
        typeof item.id === 'string'
      ) {
        return {
          id: item.id,
          mediaType: 'video' as const,
          entry: item.entry,
          enclosure: item.enclosure,
          youtubeId: item.youtubeId,
        };
      }

      if (mediaType === 'tts' && isValidEntry(item.entry) && typeof item.text === 'string' && typeof item.id === 'string') {
        return {
          id: item.id,
          mediaType: 'tts' as const,
          entry: item.entry,
          text: item.text,
        };
      }

      return null;
    })
    .filter((item): item is MediaQueueItem => item !== null);
}

function getAudioQueueItemId(enclosureId: number): string {
  return `audio:${enclosureId}`;
}

function getVideoQueueItemId(entryId: number, enclosureId?: number | null, youtubeId?: string | null): string {
  if (enclosureId) {
    return `video:enclosure:${enclosureId}`;
  }
  return `video:youtube:${entryId}:${youtubeId ?? 'unknown'}`;
}

function getTTSQueueItemId(entryId: number): string {
  return `tts:${entryId}`;
}

export const useMediaQueueStore = create<MediaQueueState>()(
  persist(
    (set, get) => ({
      queue: [],

      addAudioToQueue: (enclosure, entry) => {
        const queueItemId = getAudioQueueItemId(enclosure.id);
        set((state) => {
          if (state.queue.some((item) => item.id === queueItemId)) {
            return state;
          }
          return {
            queue: [
              ...state.queue,
              {
                id: queueItemId,
                mediaType: 'audio',
                entry,
                enclosure,
              },
            ],
          };
        });
      },

      addVideoToQueue: (entry, options) => {
        const enclosure = options.enclosure ?? null;
        const youtubeId = options.youtubeId ?? null;
        const queueItemId = getVideoQueueItemId(entry.id, enclosure?.id, youtubeId);

        set((state) => {
          if (state.queue.some((item) => item.id === queueItemId)) {
            return state;
          }

          return {
            queue: [
              ...state.queue,
              {
                id: queueItemId,
                mediaType: 'video',
                entry,
                enclosure,
                youtubeId,
              },
            ],
          };
        });
      },

      removeFromQueue: (queueItemId) => {
        set((state) => ({
          queue: state.queue.filter((item) => item.id !== queueItemId),
        }));
      },

      reorderQueue: (fromIndex, toIndex) => {
        set((state) => {
          const newQueue = [...state.queue];
          const [moved] = newQueue.splice(fromIndex, 1);
          newQueue.splice(toIndex, 0, moved);
          return { queue: newQueue };
        });
      },

      clearQueue: () => set({ queue: [] }),

      popNext: () => {
        const state = get();
        if (state.queue.length === 0) {
          return null;
        }

        const [next, ...rest] = state.queue;
        set({ queue: rest });
        return next;
      },

      isAudioQueued: (enclosureId) => {
        const queueItemId = getAudioQueueItemId(enclosureId);
        return get().queue.some((item) => item.id === queueItemId);
      },

      isVideoQueued: (entryId) => {
        return get().queue.some((item) => item.mediaType === 'video' && item.entry.id === entryId);
      },

      addTTSToQueue: (entry, text) => {
        const queueItemId = getTTSQueueItemId(entry.id);
        set((state) => {
          if (state.queue.some((item) => item.id === queueItemId)) {
            return state;
          }
          return {
            queue: [
              ...state.queue,
              {
                id: queueItemId,
                mediaType: 'tts',
                entry,
                text,
              },
            ],
          };
        });
      },

      isTTSQueued: (entryId) => {
        const queueItemId = getTTSQueueItemId(entryId);
        return get().queue.some((item) => item.id === queueItemId);
      },
    }),
    {
      name: 'informeer-media-queue',
      version: MEDIA_QUEUE_STORAGE_VERSION,
      partialize: (state) => ({
        queue: state.queue,
      }),
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as { queue?: unknown };

        if (version < 1) {
          return {
            queue: sanitizeQueue(state.queue),
          };
        }

        return {
          ...state,
          queue: sanitizeQueue(state.queue),
        };
      },
    }
  )
);
