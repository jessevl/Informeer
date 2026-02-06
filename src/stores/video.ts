/**
 * Video Store
 * Manages video playback state with series tracking and queue modes
 * Based on audio store pattern but for video content (YouTube, video feeds, etc.)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { miniflux } from '@/api/miniflux';
import { isYouTubeUrl, extractYouTubeId } from '@/lib/utils';
import type { Enclosure, Entry } from '@/types/miniflux';

// Queue playback modes
export type VideoQueueMode = 'queue' | 'recent' | 'series';

// Player size modes
export type PlayerSize = 'mini' | 'normal' | 'theater';

// Function to stop audio playback - will be set by audio store
let stopAudioPlayback: (() => void) | null = null;

export function setStopAudioCallback(callback: () => void) {
  stopAudioPlayback = callback;
}

// YouTube progress tracking (keyed by entry ID since YouTube doesn't have enclosures)
interface YouTubeProgress {
  currentTime: number;
  duration: number;
  entryId: number;
}

interface VideoState {
  // Current playback
  currentEnclosure: Enclosure | null;
  currentYouTubeId: string | null; // YouTube video ID for embedded playback
  currentEntry: Entry | null;
  
  // Playback state
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  
  // Display modes
  isExpanded: boolean;
  isPiP: boolean;
  isFullscreen: boolean;
  playerSize: PlayerSize;
  
  // Queue
  queue: Array<{ enclosure: Enclosure; entry: Entry }>;
  queueMode: VideoQueueMode;
  
  // Watched tracking (entry IDs that have been watched to completion)
  watchedEntries: Set<number>;
  
  // YouTube progress tracking (by entry ID)
  youtubeProgress: Map<number, { currentTime: number; duration: number }>;
  
  // Actions
  play: (enclosure: Enclosure, entry: Entry) => void;
  playYouTube: (youtubeId: string, entry: Entry) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  
  // Display mode actions
  setExpanded: (expanded: boolean) => void;
  setPiP: (pip: boolean) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setPlayerSize: (size: PlayerSize) => void;
  
  // Queue management
  addToQueue: (enclosure: Enclosure, entry: Entry) => void;
  removeFromQueue: (enclosureId: number) => void;
  clearQueue: () => void;
  playNext: () => void;
  playPrevious: () => void;
  setQueueMode: (mode: VideoQueueMode) => void;
  
  // Series/channel management
  playSeriesFromEntry: (feedId: number, entries: Entry[], startFromEntry?: Entry) => void;
  playAllRecent: (entries: Entry[]) => void;
  
  // Progress sync
  syncProgress: () => Promise<void>;
  markAsWatched: (entryId: number) => void;
  isEntryWatched: (entryId: number) => boolean;
  
  // YouTube progress tracking
  getYouTubeProgress: (entryId: number) => { currentTime: number; duration: number } | null;
  setYouTubeProgress: (entryId: number, currentTime: number, duration: number) => void;
}

// Helper to get video enclosure from entry
function getVideoEnclosure(entry: Entry): Enclosure | null {
  if (!entry.enclosures) return null;
  return entry.enclosures.find(enc => 
    enc.mime_type?.startsWith('video/') || 
    enc.mime_type === 'application/x-mpegURL' ||
    enc.mime_type === 'application/vnd.apple.mpegurl'
  ) || null;
}

// Check if an entry is a video (has video enclosure OR is a YouTube URL)
function isVideoEntry(entry: Entry): boolean {
  // Check for video enclosure
  if (getVideoEnclosure(entry)) return true;
  // Check for YouTube URL
  if (entry.url && isYouTubeUrl(entry.url)) return true;
  return false;
}

// Get video info for an entry (either enclosure-based or YouTube-based)
function getVideoInfo(entry: Entry): { type: 'enclosure'; enclosure: Enclosure } | { type: 'youtube'; videoId: string; url: string } | null {
  const enclosure = getVideoEnclosure(entry);
  if (enclosure) {
    return { type: 'enclosure', enclosure };
  }
  if (entry.url && isYouTubeUrl(entry.url)) {
    const videoId = extractYouTubeId(entry.url);
    if (videoId) {
      return { type: 'youtube', videoId, url: entry.url };
    }
  }
  return null;
}

export const useVideoStore = create<VideoState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentEnclosure: null,
      currentYouTubeId: null,
      currentEntry: null,
      isPlaying: false,
      isLoading: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      volume: 1,
      isMuted: false,
      isExpanded: false,
      isPiP: false,
      isFullscreen: false,
      playerSize: 'normal' as PlayerSize,
      queue: [],
      queueMode: 'queue' as VideoQueueMode,
      watchedEntries: new Set<number>(),
      youtubeProgress: new Map<number, { currentTime: number; duration: number }>(),

      // Play a video enclosure
      play: (enclosure, entry) => {
        // Stop audio playback if playing (unified player behavior)
        if (stopAudioPlayback) {
          stopAudioPlayback();
        }
        
        const current = get().currentEnclosure;
        if (current && get().currentTime > 0) {
          get().syncProgress();
        }
        
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(console.error);
        }
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(console.error);
        }
        
        set({
          currentEnclosure: enclosure,
          currentYouTubeId: null,
          currentEntry: entry,
          isPlaying: true,
          isLoading: true,
          currentTime: enclosure.media_progression || 0,
          isPiP: false,
          isFullscreen: false,
        });
      },

      // Play a YouTube video
      playYouTube: (youtubeId, entry) => {
        // Stop audio playback if playing (unified player behavior)
        if (stopAudioPlayback) {
          stopAudioPlayback();
        }
        
        const current = get().currentEnclosure;
        if (current && get().currentTime > 0) {
          get().syncProgress();
        }
        
        // Save current YouTube progress before switching
        const currentYouTubeId = get().currentYouTubeId;
        const currentEntry = get().currentEntry;
        if (currentYouTubeId && currentEntry && get().currentTime > 0) {
          get().setYouTubeProgress(currentEntry.id, get().currentTime, get().duration);
        }
        
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(console.error);
        }
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(console.error);
        }
        
        // Get saved progress for this YouTube video
        const savedProgress = get().getYouTubeProgress(entry.id);
        const startTime = savedProgress?.currentTime || 0;
        
        set({
          currentEnclosure: null,
          currentYouTubeId: youtubeId,
          currentEntry: entry,
          isPlaying: true,
          isLoading: true,
          currentTime: startTime,
          isPiP: false,
          isFullscreen: false,
          isExpanded: true, // Expand for YouTube videos
        });
      },

      pause: () => {
        // Save YouTube progress before pausing
        const { currentYouTubeId, currentEntry, currentTime, duration } = get();
        if (currentYouTubeId && currentEntry && currentTime > 0 && duration > 0) {
          get().setYouTubeProgress(currentEntry.id, currentTime, duration);
        }
        
        set({ isPlaying: false });
        get().syncProgress();
      },

      resume: () => {
        set({ isPlaying: true });
      },

      stop: () => {
        // Save YouTube progress before stopping
        const { currentYouTubeId, currentEntry, currentTime, duration } = get();
        if (currentYouTubeId && currentEntry && currentTime > 0 && duration > 0) {
          get().setYouTubeProgress(currentEntry.id, currentTime, duration);
        }
        
        get().syncProgress();
        
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(console.error);
        }
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(console.error);
        }
        
        set({
          currentEnclosure: null,
          currentYouTubeId: null,
          currentEntry: null,
          isPlaying: false,
          isLoading: false,
          currentTime: 0,
          duration: 0,
          isExpanded: false,
          isPiP: false,
          isFullscreen: false,
        });
      },

      setCurrentTime: (time) => set({ currentTime: time }),
      setDuration: (duration) => set({ duration }),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
      setMuted: (muted) => set({ isMuted: muted }),
      setIsLoading: (loading) => set({ isLoading: loading }),
      setExpanded: (expanded) => set({ isExpanded: expanded }),
      setPiP: (pip) => set({ isPiP: pip }),
      setFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
      setPlayerSize: (size) => set({ playerSize: size }),
      setQueueMode: (mode) => set({ queueMode: mode }),

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

      clearQueue: () => set({ queue: [] }),

      playNext: () => {
        const { queue, currentEnclosure, syncProgress } = get();
        if (queue.length === 0) return;
        
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

      playPrevious: () => set({ currentTime: 0 }),

      playSeriesFromEntry: (feedId, entries, startFromEntry) => {
        const feedEntries = entries
          .filter(e => e.feed_id === feedId)
          .filter(e => getVideoEnclosure(e) !== null)
          .sort((a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime());
        
        if (feedEntries.length === 0) return;
        
        let startIndex = 0;
        if (startFromEntry) {
          const idx = feedEntries.findIndex(e => e.id === startFromEntry.id);
          if (idx !== -1) startIndex = idx;
        }
        
        const [first, ...rest] = feedEntries.slice(startIndex);
        const enclosure = getVideoEnclosure(first);
        if (!enclosure) return;
        
        const queueItems = rest
          .map(entry => {
            const enc = getVideoEnclosure(entry);
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

      playAllRecent: (entries) => {
        const videoEntries = entries
          .filter(e => getVideoEnclosure(e) !== null)
          .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
        
        if (videoEntries.length === 0) return;
        
        const [first, ...rest] = videoEntries;
        const enclosure = getVideoEnclosure(first);
        if (!enclosure) return;
        
        const queueItems = rest
          .map(entry => {
            const enc = getVideoEnclosure(entry);
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

      markAsWatched: (entryId) => {
        set((state) => {
          const newSet = new Set(state.watchedEntries);
          newSet.add(entryId);
          return { watchedEntries: newSet };
        });
        miniflux.updateEntries({ entry_ids: [entryId], status: 'read' }).catch(console.error);
      },

      isEntryWatched: (entryId) => get().watchedEntries.has(entryId),

      syncProgress: async () => {
        const { currentEnclosure, currentTime } = get();
        if (!currentEnclosure || currentTime <= 0) return;
        
        try {
          await miniflux.updateEnclosureProgress(currentEnclosure.id, Math.floor(currentTime));
        } catch (error) {
          console.error('Failed to sync video progress:', error);
        }
      },
      
      getYouTubeProgress: (entryId) => {
        return get().youtubeProgress.get(entryId) || null;
      },
      
      setYouTubeProgress: (entryId, currentTime, duration) => {
        set((state) => {
          const newMap = new Map(state.youtubeProgress);
          newMap.set(entryId, { currentTime, duration });
          return { youtubeProgress: newMap };
        });
      },
    }),
    {
      name: 'informeer-video',
      partialize: (state) => ({
        playbackRate: state.playbackRate,
        volume: state.volume,
        isMuted: state.isMuted,
        playerSize: state.playerSize,
        watchedEntries: Array.from(state.watchedEntries),
        youtubeProgress: Array.from(state.youtubeProgress.entries()),
      }),
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray(state.watchedEntries)) {
          state.watchedEntries = new Set(state.watchedEntries);
        }
        if (state && Array.isArray(state.youtubeProgress)) {
          state.youtubeProgress = new Map(state.youtubeProgress);
        }
      },
    }
  )
);

// Re-export functions from utils for convenience
export { isYouTubeUrl, extractYouTubeId } from '@/lib/utils';
export { getVideoEnclosure, isVideoEntry, getVideoInfo };