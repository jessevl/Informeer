/**
 * Audio Store
 * Manages podcast/audio playback state with series tracking and queue modes
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { miniflux } from '@/api/miniflux';
import type { Enclosure, Entry } from '@/types/miniflux';

// Queue playback modes
export type QueueMode = 'queue' | 'recent' | 'series';

// Function to stop video playback - will be set by video store
let stopVideoPlayback: (() => void) | null = null;

export function setStopVideoCallback(callback: () => void) {
  stopVideoPlayback = callback;
}

interface AudioState {
  // Current playback
  currentEnclosure: Enclosure | null;
  currentEntry: Entry | null;
  
  // Playback state
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  
  // Queue
  queue: Array<{ enclosure: Enclosure; entry: Entry }>;
  queueMode: QueueMode;
  
  // Listened tracking (entry IDs that have been listened to completion)
  listenedEntries: Set<number>;
  
  // Actions
  play: (enclosure: Enclosure, entry: Entry) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setIsLoading: (loading: boolean) => void;
  
  // Queue management
  addToQueue: (enclosure: Enclosure, entry: Entry) => void;
  removeFromQueue: (enclosureId: number) => void;
  clearQueue: () => void;
  playNext: () => void;
  playPrevious: () => void;
  setQueueMode: (mode: QueueMode) => void;
  
  // Series/podcast management
  playSeriesFromEntry: (feedId: number, entries: Entry[], startFromEntry?: Entry) => void;
  playAllRecent: (entries: Entry[]) => void;
  
  // Progress sync
  syncProgress: () => Promise<void>;
  markAsListened: (entryId: number) => void;
  isEntryListened: (entryId: number) => boolean;
}

// Helper to get audio enclosure from entry
function getAudioEnclosure(entry: Entry): Enclosure | null {
  if (!entry.enclosures) return null;
  return entry.enclosures.find(enc => 
    enc.mime_type?.startsWith('audio/') || 
    enc.mime_type === 'application/x-mpegURL'
  ) || null;
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentEnclosure: null,
      currentEntry: null,
      isPlaying: false,
      isLoading: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      volume: 1,
      queue: [],
      queueMode: 'queue' as QueueMode,
      listenedEntries: new Set<number>(),

      // Play an enclosure
      play: (enclosure, entry) => {
        // Stop video playback if playing (unified player behavior)
        if (stopVideoPlayback) {
          stopVideoPlayback();
        }
        
        // Save progress of current track before switching
        const current = get().currentEnclosure;
        if (current && get().currentTime > 0) {
          get().syncProgress();
        }
        
        set({
          currentEnclosure: enclosure,
          currentEntry: entry,
          isPlaying: true,
          isLoading: true,
          currentTime: enclosure.media_progression || 0,
        });
      },

      pause: () => {
        set({ isPlaying: false });
        // Sync progress when pausing
        get().syncProgress();
      },

      resume: () => {
        set({ isPlaying: true });
      },

      stop: () => {
        // Sync progress before stopping
        get().syncProgress();
        set({
          currentEnclosure: null,
          currentEntry: null,
          isPlaying: false,
          isLoading: false,
          currentTime: 0,
          duration: 0,
        });
      },

      setCurrentTime: (time) => {
        set({ currentTime: time });
      },

      setDuration: (duration) => {
        set({ duration });
      },

      setPlaybackRate: (rate) => {
        set({ playbackRate: rate });
      },

      setVolume: (volume) => {
        set({ volume });
      },

      setIsLoading: (loading) => {
        set({ isLoading: loading });
      },

      setQueueMode: (mode) => {
        set({ queueMode: mode });
      },

      // Queue management
      addToQueue: (enclosure, entry) => {
        set((state) => ({
          queue: [...state.queue, { enclosure, entry }],
        }));
      },

      removeFromQueue: (enclosureId) => {
        set((state) => ({
          queue: state.queue.filter((item) => item.enclosure.id !== enclosureId),
        }));
      },

      clearQueue: () => {
        set({ queue: [] });
      },

      playNext: () => {
        const { queue, currentEnclosure, syncProgress } = get();
        if (queue.length === 0) return;
        
        // Sync current progress
        if (currentEnclosure) {
          syncProgress();
        }
        
        const [next, ...rest] = queue;
        set({
          currentEnclosure: next.enclosure,
          currentEntry: next.entry,
          isPlaying: true,
          isLoading: true,
          currentTime: next.enclosure.media_progression || 0,
          queue: rest,
        });
      },

      playPrevious: () => {
        // For now, just restart current track
        set({ currentTime: 0 });
      },

      // Play all episodes from a podcast series (oldest to newest)
      playSeriesFromEntry: (feedId, entries, startFromEntry) => {
        // Filter entries from this feed that have audio
        const feedEntries = entries
          .filter(e => e.feed_id === feedId)
          .filter(e => getAudioEnclosure(e) !== null)
          .sort((a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime());
        
        if (feedEntries.length === 0) return;
        
        // Find starting point
        let startIndex = 0;
        if (startFromEntry) {
          const idx = feedEntries.findIndex(e => e.id === startFromEntry.id);
          if (idx !== -1) startIndex = idx;
        }
        
        const [first, ...rest] = feedEntries.slice(startIndex);
        const enclosure = getAudioEnclosure(first);
        if (!enclosure) return;
        
        // Build queue from remaining entries
        const queueItems = rest
          .map(entry => {
            const enc = getAudioEnclosure(entry);
            return enc ? { enclosure: enc, entry } : null;
          })
          .filter((item): item is { enclosure: Enclosure; entry: Entry } => item !== null);
        
        set({
          currentEnclosure: enclosure,
          currentEntry: first,
          isPlaying: true,
          isLoading: true,
          currentTime: enclosure.media_progression || 0,
          queue: queueItems,
          queueMode: 'series',
        });
      },

      // Play all recent podcasts (newest to oldest)
      playAllRecent: (entries) => {
        // Filter entries that have audio, sort newest first
        const audioEntries = entries
          .filter(e => getAudioEnclosure(e) !== null)
          .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
        
        if (audioEntries.length === 0) return;
        
        const [first, ...rest] = audioEntries;
        const enclosure = getAudioEnclosure(first);
        if (!enclosure) return;
        
        // Build queue from remaining entries
        const queueItems = rest
          .map(entry => {
            const enc = getAudioEnclosure(entry);
            return enc ? { enclosure: enc, entry } : null;
          })
          .filter((item): item is { enclosure: Enclosure; entry: Entry } => item !== null);
        
        set({
          currentEnclosure: enclosure,
          currentEntry: first,
          isPlaying: true,
          isLoading: true,
          currentTime: enclosure.media_progression || 0,
          queue: queueItems,
          queueMode: 'recent',
        });
      },

      // Mark entry as listened (called when reaching last 60 seconds)
      markAsListened: (entryId) => {
        set((state) => {
          const newSet = new Set(state.listenedEntries);
          newSet.add(entryId);
          return { listenedEntries: newSet };
        });
        
        // Also mark as read in Miniflux
        miniflux.updateEntries({ entry_ids: [entryId], status: 'read' }).catch(console.error);
      },

      // Check if entry has been listened to
      isEntryListened: (entryId) => {
        return get().listenedEntries.has(entryId);
      },

      // Sync progress to Miniflux
      syncProgress: async () => {
        const { currentEnclosure, currentTime } = get();
        if (!currentEnclosure || currentTime <= 0) return;
        
        try {
          await miniflux.updateEnclosureProgress(currentEnclosure.id, Math.floor(currentTime));
        } catch (error) {
          console.error('Failed to sync audio progress:', error);
        }
      },
    }),
    {
      name: 'informeer-audio',
      // Only persist certain fields
      partialize: (state) => ({
        playbackRate: state.playbackRate,
        volume: state.volume,
        listenedEntries: Array.from(state.listenedEntries),
      }),
      // Convert array back to Set on hydration
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray(state.listenedEntries)) {
          state.listenedEntries = new Set(state.listenedEntries);
        }
      },
    }
  )
);