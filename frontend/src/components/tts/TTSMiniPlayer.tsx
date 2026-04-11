/**
 * TTSMiniPlayer Component
 * Floating mini-player for TTS playback, styled consistently with AudioPlayer
 * Handles streaming playback of TTS audio chunks
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  Play,
  Pause,
  X,
  ChevronUp,
  ChevronDown,
  SkipForward,
  SkipBack,
  Headphones,
  ListMusic,
  Trash2,
  Square,
  Podcast,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import { useTTSStore } from '@/stores/tts';
import { useMediaQueueStore } from '@/stores/mediaQueue';
import { useAudioStore } from '@/stores/audio';
import { useVideoStore } from '@/stores/video';
import { FeedIcon } from '@/components/feeds/FeedIcon';

export function TTSMiniPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [waitingForChunk, setWaitingForChunk] = useState(false);
  const isMobile = useIsMobile();

  const {
    chunks,
    currentChunkIndex,
    isPlaying,
    generationStatus,
    currentEntry,
    modelStatus,
    setPlaying,
    advanceToNextChunk,
    cleanup,
    abort,
    speed,
    setSpeed,
  } = useTTSStore();

  const { play: playAudio } = useAudioStore();
  const { play: playVideo, playYouTube } = useVideoStore();
  const {
    queue: mediaQueue,
    popNext,
    removeFromQueue,
    clearQueue,
  } = useMediaQueueStore();

  const currentChunk =
    currentChunkIndex >= 0 && currentChunkIndex < chunks.length
      ? chunks[currentChunkIndex]
      : null;

  const totalChunks = chunks.length;
  const progress = totalChunks > 0
    ? ((currentChunkIndex + 1) / Math.max(totalChunks, currentChunkIndex + 2)) * 100
    : 0;

  // Load current chunk into audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentChunk) return;

    audio.src = currentChunk.audioUrl;
    audio.playbackRate = speed;
    if (isPlaying) {
      setWaitingForChunk(false);
      audio.play().catch(console.error);
    }
  }, [currentChunk?.audioUrl]);

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      if (currentChunk && audio.paused && audio.src) {
        audio.play().catch(console.error);
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
    }
  }, [isPlaying]);

  // Update playback rate
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = speed;
    }
  }, [speed]);

  // Wait for next chunk when generating
  useEffect(() => {
    if (!isPlaying || !waitingForChunk) return;
    if (currentChunkIndex >= 0 && currentChunkIndex < chunks.length) {
      setWaitingForChunk(false);
    }
  }, [isPlaying, waitingForChunk, currentChunkIndex, chunks.length]);

  const playNextQueueItem = useCallback(() => {
    const next = popNext();
    if (!next) return false;

    cleanup();

    if (next.mediaType === 'audio') {
      playAudio(next.enclosure, next.entry);
      return true;
    }

    if (next.mediaType === 'video') {
      if (next.youtubeId) {
        playYouTube(next.youtubeId, next.entry);
        return true;
      }
      if (next.enclosure) {
        playVideo(next.enclosure, next.entry);
        return true;
      }
      return false;
    }

    const { generate, initModel, modelStatus } = useTTSStore.getState();
    if (modelStatus === 'idle') initModel();
    generate(next.text, next.entry);
    return true;
  }, [cleanup, popNext, playAudio, playVideo, playYouTube]);

  const handleEnded = useCallback(() => {
    const hasMore = advanceToNextChunk();
    if (!hasMore && generationStatus !== 'generating') {
      if (playNextQueueItem()) return;
      cleanup();
    } else if (!hasMore && generationStatus === 'generating') {
      setWaitingForChunk(true);
    }
  }, [advanceToNextChunk, generationStatus, cleanup, playNextQueueItem]);

  const handleStop = useCallback(() => {
    abort();
    cleanup();
  }, [abort, cleanup]);

  const handleSkipBack = useCallback(() => {
    if (currentChunkIndex > 0) {
      useTTSStore.getState().setCurrentChunkIndex(currentChunkIndex - 1);
    }
  }, [currentChunkIndex]);

  const handleSkipForward = useCallback(() => {
    if (mediaQueue.length > 0) {
      playNextQueueItem();
      return;
    }

    if (currentChunkIndex < chunks.length - 1) {
      useTTSStore.getState().setCurrentChunkIndex(currentChunkIndex + 1);
    }
  }, [currentChunkIndex, chunks.length, mediaQueue.length, playNextQueueItem]);

  // Don't render if nothing is playing
  if (!currentEntry || (generationStatus === 'idle' && chunks.length === 0)) return null;

  const speedOptions = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const hasNextQueueItem = mediaQueue.length > 0;

  return (
    <div
      className={cn(
        'fixed z-50 animate-player-enter',
        'transition-all duration-500 transition-snappy',
        isMobile
          ? 'bottom-[calc(80px+env(safe-area-inset-bottom))] left-4 right-4'
          : 'bottom-4 right-4 w-80'
      )}
    >
      {/* Hidden audio element for chunk playback */}
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onError={() => advanceToNextChunk()}
        style={{ display: 'none' }}
      />

      {/* Player Card */}
      <div
        className={cn(
          'relative overflow-hidden rounded-3xl',
          'bg-[var(--color-surface-base)]/95 backdrop-blur-xl',
          'border border-[var(--color-border-subtle)]',
          'shadow-2xl shadow-black/20 dark:shadow-black/40',
          'transition-all duration-500 transition-snappy'
        )}
      >
        {/* Compact Mini Player */}
        {!expanded && (
          <div className="p-3 animate-fade-in">
            <div className="flex items-center gap-3">
              {/* Artwork */}
              <button
                onClick={() => setExpanded(true)}
                className="relative w-12 h-12 rounded-xl overflow-hidden bg-[var(--color-surface-secondary)] flex-shrink-0 group transition-transform duration-300 active:scale-95"
              >
                <FeedIcon
                  feedId={currentEntry.feed_id}
                  iconId={currentEntry.feed?.icon?.icon_id}
                  size={48}
                  className="w-full h-full rounded-xl"
                />
                {/* TTS badge */}
                <div className="absolute bottom-0 right-0 w-5 h-5 rounded-tl-lg bg-[var(--color-accent-fg)] flex items-center justify-center">
                  <Headphones size={10} className="text-white" />
                </div>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ChevronUp
                    size={20}
                    className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </div>
              </button>

              {/* Track info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {currentEntry.title}
                </div>
                <div className="text-xs text-[var(--color-text-tertiary)] truncate flex items-center gap-1">
                  <Headphones size={10} />
                  <span>
                    {generationStatus === 'generating'
                      ? `Reading... (${currentChunkIndex + 1}/${totalChunks}+)`
                      : `${currentChunkIndex + 1}/${totalChunks} passages`}
                  </span>
                </div>
                {/* Mini progress bar */}
                <div className="mt-1.5 h-1 bg-[var(--color-surface-inset)] rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      generationStatus === 'generating'
                        ? "bg-[var(--color-accent-fg)] animate-pulse"
                        : "bg-[var(--color-accent-fg)]"
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => (isPlaying ? setPlaying(false) : setPlaying(true))}
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center',
                    'bg-[var(--color-accent-fg)] text-white',
                    'transition-all duration-300 transition-spring',
                    'hover:scale-110 hover:shadow-lg active:scale-95'
                  )}
                >
                  {waitingForChunk ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : isPlaying ? (
                    <Pause size={18} fill="currentColor" />
                  ) : (
                    <Play size={18} fill="currentColor" className="ml-0.5" />
                  )}
                </button>

                <button
                  onClick={handleStop}
                  className="p-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-all duration-200 hover:rotate-90"
                  title="Stop reading"
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
            {/* Header */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <ChevronDown size={18} className="text-[var(--color-text-secondary)]" />
              </button>
              <div className="flex items-center gap-1">
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
                  onClick={handleStop}
                  className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <X size={18} className="text-[var(--color-text-secondary)]" />
                </button>
              </div>
            </div>

            {/* Artwork */}
            <div className="relative aspect-square w-full max-w-[200px] mx-auto rounded-2xl overflow-hidden bg-[var(--color-surface-secondary)] shadow-lg">
              <FeedIcon
                feedId={currentEntry.feed_id}
                iconId={currentEntry.feed?.icon?.icon_id}
                size={200}
                className={cn(
                  'w-full h-full rounded-2xl transition-transform duration-700 transition-gentle',
                  isPlaying && 'scale-105'
                )}
              />
              {/* TTS overlay badge */}
              <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur flex items-center gap-1.5 eink-media-chip">
                <Headphones size={12} className="text-white" />
                <span className="text-white text-xs font-medium">TTS</span>
              </div>
            </div>

            {/* Track Info */}
            <div className="text-center space-y-1">
              <div className="text-base font-semibold text-[var(--color-text-primary)] line-clamp-2">
                {currentEntry.title}
              </div>
              <div className="text-sm text-[var(--color-accent-fg)]">
                {currentEntry.feed?.title}
              </div>
            </div>

            {/* Current sentence display */}
            {currentChunk && (
              <div className="px-3 py-2 rounded-xl bg-[var(--color-surface-inset)] text-sm text-[var(--color-text-secondary)] leading-relaxed line-clamp-3 text-center italic">
                "{currentChunk.text}"
              </div>
            )}

            {/* Progress */}
            <div className="space-y-2">
              <div className="h-1.5 bg-[var(--color-surface-inset)] rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    generationStatus === 'generating' && "bg-gradient-to-r from-[var(--color-accent-fg)] to-[var(--color-accent-fg)]/60",
                    generationStatus !== 'generating' && "bg-[var(--color-accent-fg)]"
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-[var(--color-text-tertiary)] tabular-nums">
                <span>Passage {currentChunkIndex + 1}</span>
                <span>
                  {generationStatus === 'generating'
                    ? `${totalChunks}+ passages`
                    : `${totalChunks} passages`}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleSkipBack}
                disabled={currentChunkIndex <= 0}
                className={cn(
                  'p-2 rounded-full transition-colors',
                  currentChunkIndex > 0
                    ? 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
                    : 'text-[var(--color-text-disabled)] cursor-not-allowed'
                )}
                title="Previous passage"
              >
                <SkipBack size={20} />
              </button>

              <button
                onClick={() => (isPlaying ? setPlaying(false) : setPlaying(true))}
                className={cn(
                  'w-14 h-14 rounded-full flex items-center justify-center',
                  'bg-[var(--color-accent-fg)] text-white',
                  'transition-all duration-300 transition-spring',
                  'hover:scale-110 hover:shadow-xl active:scale-95',
                  'shadow-lg shadow-[var(--color-accent-fg)]/30'
                )}
              >
                {waitingForChunk ? (
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause size={24} fill="currentColor" />
                ) : (
                  <Play size={24} fill="currentColor" className="ml-1" />
                )}
              </button>

              <button
                onClick={handleSkipForward}
                disabled={mediaQueue.length === 0 && currentChunkIndex >= chunks.length - 1}
                className={cn(
                  'p-2 rounded-full transition-colors',
                  mediaQueue.length > 0 || currentChunkIndex < chunks.length - 1
                    ? 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
                    : 'text-[var(--color-text-disabled)] cursor-not-allowed'
                )}
                title={mediaQueue.length > 0 ? 'Next in queue' : 'Next passage'}
              >
                <SkipForward size={20} />
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
                    speed !== 1
                      ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                >
                  {speed}x
                </button>

                {showSpeedMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowSpeedMenu(false)}
                    />
                    <div className="absolute bottom-full left-0 mb-2 bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-xl shadow-xl overflow-hidden z-20 animate-scale-in">
                      {speedOptions.map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            setSpeed(s);
                            setShowSpeedMenu(false);
                          }}
                          className={cn(
                            'w-full px-4 py-2 text-sm text-left transition-colors',
                            speed === s
                              ? 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]'
                              : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                          )}
                        >
                          {s}x
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Generation status */}
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                {generationStatus === 'generating' && (
                  <span className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Generating...
                  </span>
                )}
                {modelStatus === 'loading' && (
                  <span className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Loading model...
                  </span>
                )}
              </div>
            </div>

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
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors group"
                      >
                        <span className="text-xs text-[var(--color-text-tertiary)] w-4 text-center">
                          {index + 1}
                        </span>
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
                          <div className="text-xs text-[var(--color-text-tertiary)] truncate flex items-center gap-1">
                            {item.mediaType === 'tts' && (
                              <Headphones size={8} />
                            )}
                            {item.entry.feed?.title}
                          </div>
                        </div>
                        <button
                          onClick={() => removeFromQueue(item.id)}
                          className="p-1 rounded hover:bg-[var(--color-surface-inset)] transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove"
                        >
                          <Trash2 size={12} className="text-[var(--color-text-tertiary)]" />
                        </button>
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
