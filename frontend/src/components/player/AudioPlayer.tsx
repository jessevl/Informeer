/**
 * AudioPlayer Component
 * Floating mini-player for podcast playback using native HTML5 audio
 * Inspired by NextFlux design - floats in bottom-right with prominent artwork
 * 
 * Mobile: Positions above the floating nav bar
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  X, 
  ChevronUp, 
  ChevronDown, 
  Volume2, 
  ListMusic, 
  Trash2,
  Podcast,
  Headphones,
  RotateCcw,
  RotateCw,
  Moon,
  GripVertical,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import { useAudioStore } from '@/stores/audio';
import { useVideoStore } from '@/stores/video';
import { useMediaQueueStore } from '@/stores/mediaQueue';
import { useTTSStore } from '@/stores/tts';
import { PodcastArtwork } from '@/components/podcasts/PodcastArtwork';
import { getCachedBlob } from '@/lib/offline/blob-cache';
import { extractChapters, type PodcastChapter } from '@/lib/podcast-chapters';

// Format time in mm:ss or hh:mm:ss
function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const isMobile = useIsMobile();
  
  const {
    currentEnclosure,
    currentEntry,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    playbackRate,
    volume,
    queue,
    pause,
    resume,
    stop,
    setCurrentTime,
    setDuration,
    setPlaybackRate,
    setVolume,
    setIsLoading,
    syncProgress,
    play,
    playNext,
    markAsListened,
  } = useAudioStore();
  const sleepTimerEndTime = useAudioStore(s => s.sleepTimerEndTime);
  const setSleepTimer = useAudioStore(s => s.setSleepTimer);
  const checkSleepTimer = useAudioStore(s => s.checkSleepTimer);
  const isSyncing = useAudioStore(s => s.isSyncing);
  const { play: playVideo, playYouTube } = useVideoStore();
  const {
    queue: mediaQueue,
    popNext,
    removeFromQueue,
    reorderQueue,
    clearQueue,
  } = useMediaQueueStore();

  // Resolve audio source: prefer offline cache, fall back to remote URL
  useEffect(() => {
    if (!currentEnclosure) {
      // Revoke any previous blob URL
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      setAudioSrc(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // Revoke prior blob URL
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      try {
        const cached = await getCachedBlob(`/offline/podcasts/${currentEnclosure.id}`);
        if (cached && !cancelled) {
          const blob = await cached.blob();
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setAudioSrc(url);
          return;
        }
      } catch { /* fall through */ }
      if (!cancelled) setAudioSrc(currentEnclosure.url);
    })();
    return () => { cancelled = true; };
  }, [currentEnclosure?.id]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); };
  }, []);

  // Sync audio element with store state
  // Include currentEnclosure.id to handle track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      // When a new track loads, we need to wait for it to be ready
      // The onCanPlay/onLoadedMetadata will handle starting playback
      // For existing tracks, we can play immediately
      if (audio.readyState >= 2) {
        audio.play().catch(console.error);
      }
      // Otherwise, we rely on onLoadedMetadata to start playback
    } else {
      audio.pause();
    }
  }, [isPlaying, currentEnclosure?.id]);

  // Update playback rate (always preserve pitch)
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
      audio.preservesPitch = true;
    }
  }, [playbackRate]);

  // Update volume
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  // Set initial time when enclosure changes
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && currentEnclosure) {
      audio.currentTime = currentEnclosure.media_progression || 0;
    }
  }, [currentEnclosure?.id]);

  // Sync progress periodically while playing
  useEffect(() => {
    if (!isPlaying) return;
    
    const interval = setInterval(() => {
      syncProgress();
    }, 30000); // Sync every 30 seconds
    
    return () => clearInterval(interval);
  }, [isPlaying, syncProgress]);

  // Check if we should mark as listened (within last 60 seconds)
  useEffect(() => {
    if (duration > 0 && currentTime > 0) {
      const timeRemaining = duration - currentTime;
      if (timeRemaining <= 60 && currentEntry) {
        // Mark as listened when reaching the last minute
        markAsListened(currentEntry.id);
      }
    }
  }, [currentTime, duration, currentEntry, markAsListened]);

  // Sleep timer check
  useEffect(() => {
    if (!sleepTimerEndTime || !isPlaying) return;
    const interval = setInterval(checkSleepTimer, 1000);
    return () => clearInterval(interval);
  }, [sleepTimerEndTime, isPlaying, checkSleepTimer]);

  // Sync on unmount
  useEffect(() => {
    return () => {
      if (currentEnclosure && currentTime > 0) {
        syncProgress();
      }
    };
  }, []);

  // Extract chapters from episode show notes
  const chapters = useMemo(() => 
    currentEntry?.content ? extractChapters(currentEntry.content) : [],
    [currentEntry?.id, currentEntry?.content]
  );
  const currentChapter = useMemo(() => {
    if (chapters.length === 0) return null;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].time) return chapters[i];
    }
    return chapters[0];
  }, [chapters, currentTime]);

  if (!currentEnclosure || !currentEntry) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const speedOptions = [
    { speed: 0.75, label: '0.75x' },
    { speed: 1, label: '1x Normal' },
    { speed: 1.25, label: '1.25x' },
    { speed: 1.5, label: '1.5x Commute' },
    { speed: 1.75, label: '1.75x' },
    { speed: 2, label: '2x Catch-up' },
  ];
  const hasNextQueueItem = mediaQueue.length > 0 || queue.length > 0;

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (audio) {
      setDuration(audio.duration);
      setIsLoading(false);
      // If we should be playing (e.g., after playNext), start playback now
      if (isPlaying) {
        audio.play().catch(console.error);
      }
    }
  };

  const handleEnded = () => {
    syncProgress();
    if (mediaQueue.length > 0) {
      const next = popNext();
      if (next?.mediaType === 'audio') {
        play(next.enclosure, next.entry);
        return;
      }
      if (next?.mediaType === 'video') {
        if (next.youtubeId) {
          playYouTube(next.youtubeId, next.entry);
          return;
        }
        if (next.enclosure) {
          playVideo(next.enclosure, next.entry);
          return;
        }
      }
      if (next?.mediaType === 'tts') {
        // Transition to TTS player — generate() will stop audio internally
        const { generate, initModel, modelStatus } = useTTSStore.getState();
        if (modelStatus === 'idle') initModel();
        generate(next.text, next.entry);
        return;
      }
    }
    // Auto-play next in queue if available
    if (queue.length > 0) {
      playNext();
    } else {
      stop();
    }
  };

  const handleSeek = (newTime: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  return (
    <div className={cn(
      'fixed z-50 animate-player-enter',
      'transition-all duration-500 transition-snappy',
      // On mobile, position above the nav bar; on desktop, bottom-right
      isMobile 
        ? 'bottom-[calc(80px+env(safe-area-inset-bottom))] left-4 right-4' 
        : 'bottom-4 right-4 w-80'
    )}>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioSrc || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => {
          if (!isPlaying) resume();
          setIsLoading(false);
        }}
        onPause={() => {
          if (isPlaying) pause();
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
      />

      {/* Player Card */}
      <div className={cn(
        'relative overflow-hidden rounded-3xl',
        'bg-[var(--color-surface-base)]/95 backdrop-blur-xl',
        'border border-[var(--color-border-subtle)]',
        'shadow-2xl shadow-black/20 dark:shadow-black/40',
        'transition-all duration-500 transition-snappy'
      )}>
        {/* Compact Mini Player */}
        {!expanded && (
          <div className="p-3 animate-fade-in">
            <div className="flex items-center gap-3">
              {/* Artwork - Use PodcastArtwork for high-res iTunes covers */}
              <button
                onClick={() => setExpanded(true)}
                className="relative w-12 h-12 rounded-xl overflow-hidden bg-[var(--color-surface-secondary)] flex-shrink-0 group transition-transform duration-300 active:scale-95"
              >
                <PodcastArtwork 
                  feedId={currentEntry.feed_id} 
                  feedTitle={currentEntry.feed?.title || ''}
                  iconId={currentEntry.feed?.icon?.icon_id} 
                  size={48} 
                  className="w-full h-full rounded-xl"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ChevronUp size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>

              {/* Track info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {currentEntry.title}
                </div>
                <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                  {currentChapter ? currentChapter.title : currentEntry.feed?.title}
                </div>
                {/* Mini progress bar */}
                <div className="mt-1.5 h-1 bg-[var(--color-surface-inset)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[var(--color-accent-fg)] transition-all duration-150 rounded-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1">
                {/* Play/Pause */}
                <button
                  onClick={() => isPlaying ? pause() : resume()}
                  disabled={isLoading}
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center',
                    'bg-[var(--color-accent-fg)] text-white',
                    'transition-all duration-300 transition-spring',
                    'hover:scale-110 hover:shadow-lg active:scale-95',
                    'disabled:opacity-50'
                  )}
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : isPlaying ? (
                    <Pause size={18} fill="currentColor" />
                  ) : (
                    <Play size={18} fill="currentColor" className="ml-0.5" />
                  )}
                </button>

                {/* Close */}
                <button
                  onClick={() => {
                    syncProgress();
                    stop();
                  }}
                  className="p-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-all duration-200 hover:rotate-90"
                  title="Close player"
                >
                  <X size={16} className="text-[var(--color-text-tertiary)]" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Expanded Player */}
        {expanded && (
          <div className="p-4 space-y-4 animate-scale-in">
            {/* Header with collapse button */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <ChevronDown size={18} className="text-[var(--color-text-secondary)]" />
              </button>
              <div className="flex items-center gap-1">
                {/* Chapters button (only when chapters detected) */}
                {chapters.length > 0 && (
                  <button
                    onClick={() => { setShowChapters(!showChapters); setShowQueue(false); }}
                    className={cn(
                      'p-2 rounded-lg transition-colors text-xs font-medium',
                      showChapters
                        ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                    )}
                    title={`${chapters.length} chapters`}
                  >
                    Ch
                  </button>
                )}
                {/* Queue button */}
                <button
                  onClick={() => setShowQueue(!showQueue)}
                  className={cn(
                    'p-2 rounded-lg transition-colors relative',
                    showQueue 
                      ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                  title={`Queue (${mediaQueue.length})`}
                >
                  <ListMusic size={18} />
                  {mediaQueue.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-accent-fg)] text-white text-[10px] font-bold flex items-center justify-center">
                      {mediaQueue.length > 9 ? '9+' : mediaQueue.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => {
                    syncProgress();
                    stop();
                  }}
                  className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <X size={18} className="text-[var(--color-text-secondary)]" />
                </button>
              </div>
            </div>

            {/* Large Artwork - Use PodcastArtwork for high-res iTunes covers */}
            <div className="relative aspect-square w-full max-w-[200px] mx-auto rounded-2xl overflow-hidden bg-[var(--color-surface-secondary)] shadow-lg transition-all duration-500 transition-snappy">
              <PodcastArtwork 
                feedId={currentEntry.feed_id} 
                feedTitle={currentEntry.feed?.title || ''}
                iconId={currentEntry.feed?.icon?.icon_id} 
                size={200} 
                className={cn(
                  "w-full h-full rounded-2xl transition-transform duration-700 transition-gentle",
                  isPlaying && "scale-105"
                )}
              />
              {isPlaying && (
                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
              )}
            </div>

            {/* Track Info */}
            <div className="text-center space-y-1">
              <div className="text-base font-semibold text-[var(--color-text-primary)] line-clamp-2">
                {currentEntry.title}
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <button 
                  className="text-sm text-[var(--color-accent-fg)] hover:underline"
                  title="View podcast series"
                >
                  {currentEntry.feed?.title}
                </button>
                {isSyncing && (
                  <Loader2 size={12} className="animate-spin text-[var(--color-text-tertiary)]" />
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[var(--color-surface-inset)] rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                  [&::-webkit-slider-thumb]:bg-[var(--color-accent-fg)] [&::-webkit-slider-thumb]:rounded-full 
                  [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
              />
              <div className="flex justify-between text-xs text-[var(--color-text-tertiary)] tabular-nums">
                <span>{formatTime(currentTime)}</span>
                <span>-{formatTime(duration - currentTime)}</span>
              </div>
            </div>

            {/* Main Controls */}
            <div className="flex items-center justify-center gap-2">
              {/* Skip back 15s */}
              <button
                onClick={() => handleSeek(Math.max(0, currentTime - 15))}
                className="p-3 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                title="Rewind 15s"
              >
                <RotateCcw size={20} className="text-[var(--color-text-secondary)]" />
              </button>

              {/* Restart */}
              <button
                onClick={() => handleSeek(0)}
                className="p-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                title="Restart"
              >
                <SkipBack size={20} className="text-[var(--color-text-secondary)]" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={() => isPlaying ? pause() : resume()}
                disabled={isLoading}
                className={cn(
                  'w-14 h-14 rounded-full flex items-center justify-center',
                  'bg-[var(--color-accent-fg)] text-white',
                  'transition-all duration-300 transition-spring',
                  'hover:scale-110 hover:shadow-xl active:scale-95',
                  'shadow-lg shadow-[var(--color-accent-fg)]/30',
                  'disabled:opacity-50'
                )}
              >
                {isLoading ? (
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause size={24} fill="currentColor" />
                ) : (
                  <Play size={24} fill="currentColor" className="ml-1" />
                )}
              </button>

              {/* Next */}
              <button
                onClick={() => {
                  if (mediaQueue.length > 0) {
                    const next = popNext();
                    if (next?.mediaType === 'audio') {
                      play(next.enclosure, next.entry);
                      return;
                    }
                    if (next?.mediaType === 'video') {
                      if (next.youtubeId) {
                        playYouTube(next.youtubeId, next.entry);
                        return;
                      }
                      if (next.enclosure) {
                        playVideo(next.enclosure, next.entry);
                        return;
                      }
                    }
                  }
                  if (queue.length > 0) {
                    playNext();
                  }
                }}
                disabled={!hasNextQueueItem}
                className={cn(
                  "p-2 rounded-full transition-colors",
                  hasNextQueueItem
                    ? "hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                    : "text-[var(--color-text-disabled)] cursor-not-allowed"
                )}
                title={hasNextQueueItem ? "Next in queue" : "No items in queue"}
              >
                <SkipForward size={20} />
              </button>

              {/* Skip forward 30s */}
              <button
                onClick={() => handleSeek(Math.min(duration, currentTime + 30))}
                className="p-3 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
                title="Forward 30s"
              >
                <RotateCw size={20} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* Secondary Controls */}
            <div className="flex items-center justify-between px-2">
              {/* Speed control */}
              <div className="relative">
                <button
                  onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    playbackRate !== 1
                      ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                >
                  {playbackRate}x
                </button>
                
                {showSpeedMenu && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => setShowSpeedMenu(false)} 
                    />
                    <div className="absolute bottom-full left-0 mb-2 bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-xl shadow-xl overflow-hidden z-20 animate-scale-in">
                      {speedOptions.map(({ speed, label }) => (
                        <button
                          key={speed}
                          onClick={() => {
                            setPlaybackRate(speed);
                            setShowSpeedMenu(false);
                          }}
                          className={cn(
                            'w-full px-4 py-2 text-sm text-left transition-colors whitespace-nowrap',
                            playbackRate === speed
                              ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                              : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Sleep timer */}
              <div className="relative">
                <button
                  onClick={() => setShowSleepMenu(!showSleepMenu)}
                  className={cn(
                    'px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    sleepTimerEndTime
                      ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                  title="Sleep timer"
                >
                  <Moon size={14} />
                </button>
                {showSleepMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowSleepMenu(false)} />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-xl shadow-xl overflow-hidden z-20 animate-scale-in min-w-[120px]">
                      {[
                        { label: 'Off', value: null },
                        { label: '15 min', value: 15 },
                        { label: '30 min', value: 30 },
                        { label: '45 min', value: 45 },
                        { label: '60 min', value: 60 },
                        { label: '90 min', value: 90 },
                      ].map((opt) => (
                        <button
                          key={opt.label}
                          onClick={() => { setSleepTimer(opt.value); setShowSleepMenu(false); }}
                          className={cn(
                            'w-full px-4 py-2 text-sm text-left transition-colors',
                            (opt.value === null && !sleepTimerEndTime) || (opt.value !== null && sleepTimerEndTime)
                              ? ''
                              : '',
                            'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Volume control */}
              <div className="flex items-center gap-2">
                <Volume2 size={14} className="text-[var(--color-text-tertiary)]" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-20 h-1 bg-[var(--color-surface-inset)] rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 
                    [&::-webkit-slider-thumb]:bg-[var(--color-accent-fg)] [&::-webkit-slider-thumb]:rounded-full 
                    [&::-webkit-slider-thumb]:cursor-pointer"
                />
              </div>
            </div>

            {/* Chapters Panel */}
            {showChapters && chapters.length > 0 && (
              <div className="border-t border-[var(--color-border-subtle)] pt-4 mt-4 animate-slide-up">
                <span className="text-sm font-medium text-[var(--color-text-primary)] mb-3 block">
                  Chapters
                </span>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {chapters.map((ch, i) => {
                    const isCurrent = currentChapter?.time === ch.time;
                    return (
                      <button
                        key={i}
                        onClick={() => handleSeek(ch.time)}
                        className={cn(
                          'w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors',
                          isCurrent
                            ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                            : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        <span className="text-xs tabular-nums text-[var(--color-text-tertiary)] w-12 flex-shrink-0">
                          {ch.formattedTime}
                        </span>
                        <span className="text-sm truncate">{ch.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Queue Panel */}
            {showQueue && (
              <div className="border-t border-[var(--color-border-subtle)] pt-4 mt-4 animate-slide-up">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    Up Next
                  </span>
                  {mediaQueue.length > 0 && (
                    <button
                      onClick={clearQueue}
                      className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-danger-fg)] transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {mediaQueue.length === 0 ? (
                    <div className="text-center py-6 text-sm text-[var(--color-text-tertiary)]">
                      Queue is empty
                    </div>
                  ) : (
                    mediaQueue.map((item, index) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
                        onDragEnd={() => {
                          if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
                            reorderQueue(dragIndex, dragOverIndex);
                          }
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors group",
                          dragIndex === index && "opacity-50",
                          dragOverIndex === index && dragIndex !== index && "border-t-2 border-[var(--color-accent-fg)]"
                        )}
                      >
                        <div className="cursor-grab active:cursor-grabbing touch-none text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
                          <GripVertical size={14} />
                        </div>
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-[var(--color-surface-secondary)] flex-shrink-0">
                          <div className="w-full h-full flex items-center justify-center">
                            {item.mediaType === 'tts' ? (
                              <Headphones size={14} className="text-[var(--color-text-tertiary)]" />
                            ) : (
                              <Podcast size={14} className="text-[var(--color-text-tertiary)]" />
                            )}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {item.entry.title}
                          </div>
                          <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                            {item.mediaType === 'tts' ? '🎧 TTS · ' : ''}{item.entry.feed?.title}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              if (item.mediaType === 'audio') {
                                play(item.enclosure, item.entry);
                                return;
                              }
                              if (item.mediaType === 'tts') {
                                // Stop audio, start TTS
                                stop();
                                const { generate, initModel, modelStatus } = useTTSStore.getState();
                                if (modelStatus === 'idle') initModel();
                                generate(item.text, item.entry);
                                removeFromQueue(item.id);
                                return;
                              }
                              if (item.youtubeId) {
                                playYouTube(item.youtubeId, item.entry);
                                return;
                              }
                              if (item.enclosure) {
                                playVideo(item.enclosure, item.entry);
                              }
                            }}
                            className="p-1 rounded hover:bg-[var(--color-surface-inset)] transition-colors"
                            title="Play now"
                          >
                            <Play size={12} className="text-[var(--color-text-secondary)]" />
                          </button>
                          <button
                            onClick={() => removeFromQueue(item.id)}
                            className="p-1 rounded hover:bg-[var(--color-surface-inset)] transition-colors"
                            title="Remove"
                          >
                            <Trash2 size={12} className="text-[var(--color-text-tertiary)]" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AudioPlayer;
