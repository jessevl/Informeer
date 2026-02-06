/**
 * VideoPlayer Component
 * Floating mini-player for video playback with PiP and fullscreen support
 * Uses react-player for unified YouTube and native video support
 * 
 * Mobile: Positions above the floating nav bar with responsive sizing
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactPlayer from 'react-player';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  X, 
  ChevronUp, 
  ChevronDown, 
  Volume2, 
  VolumeX,
  ListVideo, 
  Trash2,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  RotateCcw,
  RotateCw,
  Settings,
  RectangleHorizontal,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import { useVideoStore } from '@/stores/video';
import { FeedIcon } from '@/components/feeds/FeedIcon';

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

export function VideoPlayer() {
  // react-player v3 exposes an HTMLVideoElement ref
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playerReady, setPlayerReady] = useState(false);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track initial start time for YouTube videos (set once when video changes)
  const youtubeStartTimeRef = useRef<number>(0);
  const isMobile = useIsMobile();
  
  const {
    currentEnclosure,
    currentYouTubeId,
    currentEntry,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    playbackRate,
    volume,
    isMuted,
    isPiP,
    isFullscreen,
    playerSize,
    queue,
    pause,
    resume,
    stop,
    setCurrentTime,
    setDuration,
    setPlaybackRate,
    setVolume,
    setMuted,
    setIsLoading,
    setPiP,
    setFullscreen,
    setPlayerSize,
    setExpanded: setStoreExpanded,
    syncProgress,
    setYouTubeProgress,
    play,
    removeFromQueue,
    clearQueue,
    playNext,
    markAsWatched,
  } = useVideoStore();

  // Check if playing YouTube content - declare early for use in effects
  const isYouTube = !!currentYouTubeId;

  // Capture the YouTube start time when the video changes
  // This needs to be done immediately when the YouTube ID changes
  useEffect(() => {
    if (currentYouTubeId) {
      // Store the current time as the start time (this is set by playYouTube from saved progress)
      youtubeStartTimeRef.current = Math.floor(currentTime);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only run when YouTube ID changes
  }, [currentYouTubeId]);

  // Handle controls visibility for video
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (expanded && isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [expanded, isPlaying]);

  // Sync video element with store state
  useEffect(() => {
    // react-player handles play/pause via the playing prop
    // No direct video manipulation needed
  }, [isPlaying, currentEnclosure?.id]);

  // Update playback rate - react-player handles this via prop
  useEffect(() => {
    // Handled by playbackRate prop on ReactPlayer
  }, [playbackRate]);

  // Update volume - react-player handles this via props
  useEffect(() => {
    // Handled by volume and muted props on ReactPlayer
  }, [volume, isMuted]);

  // Seek to initial position when media changes
  useEffect(() => {
    if (playerRef.current && currentEnclosure && playerReady) {
      const startTime = currentEnclosure.media_progression || 0;
      if (startTime > 0) {
        playerRef.current.currentTime = startTime;
      }
    }
  }, [currentEnclosure?.id, playerReady]);

  // Sync progress periodically while playing
  useEffect(() => {
    if (!isPlaying) return;
    
    const interval = setInterval(() => {
      // Sync enclosure-based video progress to server
      syncProgress();
      // Save YouTube progress locally
      if (isYouTube && currentEntry && currentTime > 0 && duration > 0) {
        setYouTubeProgress(currentEntry.id, currentTime, duration);
      }
    }, 30000);
    
    return () => clearInterval(interval);
  }, [isPlaying, syncProgress, isYouTube, currentEntry, currentTime, duration, setYouTubeProgress]);

  // Check if we should mark as watched (within last 60 seconds)
  useEffect(() => {
    if (duration > 0 && currentTime > 0) {
      const timeRemaining = duration - currentTime;
      if (timeRemaining <= 60 && currentEntry) {
        markAsWatched(currentEntry.id);
      }
    }
  }, [currentTime, duration, currentEntry, markAsWatched]);

  // Handle PiP events - react-player v3 provides HTMLVideoElement ref directly
  useEffect(() => {
    const player = playerRef.current;
    if (!player || isYouTube) return;

    const handleEnterPiP = () => setPiP(true);
    const handleLeavePiP = () => setPiP(false);

    player.addEventListener('enterpictureinpicture', handleEnterPiP);
    player.addEventListener('leavepictureinpicture', handleLeavePiP);

    return () => {
      player.removeEventListener('enterpictureinpicture', handleEnterPiP);
      player.removeEventListener('leavepictureinpicture', handleLeavePiP);
    };
  }, [setPiP, isYouTube, playerReady]);

  // Handle fullscreen events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setFullscreen]);

  // Sync on unmount
  useEffect(() => {
    return () => {
      if (currentEnclosure && currentTime > 0) {
        syncProgress();
      }
    };
  }, []);

  // Clean up controls timeout on unmount
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Callback ref to capture the player element - must be before early return
  const setPlayerRef = useCallback((el: HTMLVideoElement | null) => {
    playerRef.current = el;
  }, []);

  if ((!currentEnclosure && !currentYouTubeId) || !currentEntry) return null;
  
  // Build the video URL for react-player
  // For YouTube, include the start time from saved progress (captured in ref when video loads)
  const videoUrl = isYouTube 
    ? `https://www.youtube.com/watch?v=${currentYouTubeId}${youtubeStartTimeRef.current > 0 ? `&t=${youtubeStartTimeRef.current}` : ''}`
    : currentEnclosure?.url;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  // react-player v3 event handlers - these receive standard video element events
  const handleTimeUpdate = () => {
    const player = playerRef.current;
    if (player) {
      setCurrentTime(player.currentTime);
    }
  };

  const handleDurationChange = () => {
    const player = playerRef.current;
    if (player && player.duration) {
      setDuration(player.duration);
    }
  };

  const handleReady = () => {
    setPlayerReady(true);
    setIsLoading(false);
    // Seek to saved position after ready
    if (currentEnclosure?.media_progression && playerRef.current) {
      playerRef.current.currentTime = currentEnclosure.media_progression;
    }
  };

  const handleEnded = () => {
    syncProgress();
    if (queue.length > 0) {
      playNext();
    } else {
      stop();
    }
  };

  const handleSeek = (newTime: number) => {
    if (playerRef.current) {
      playerRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const togglePiP = async () => {
    const player = playerRef.current;
    if (!player || isYouTube) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await player.requestPictureInPicture();
      }
    } catch (error) {
      console.error('PiP error:', error);
    }
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  };

  // Mini player when in PiP mode - just show a small indicator (not for YouTube)
  if (isPiP && !isYouTube) {
    return (
      <div className={cn(
        'fixed z-50 animate-player-enter',
        // On mobile, position above the nav bar; on desktop, bottom-right
        isMobile 
          ? 'bottom-[calc(80px+env(safe-area-inset-bottom))] left-4 right-4' 
          : 'bottom-4 right-4 w-64',
        'rounded-xl overflow-hidden',
        'bg-[var(--color-surface-base)]/95 backdrop-blur-xl',
        'border border-[var(--color-border-subtle)]',
        'shadow-lg p-3'
      )}>
        {/* Hidden player to maintain playback */}
        <div className="hidden">
          <ReactPlayer
            ref={setPlayerRef}
            src={videoUrl}
            playing={isPlaying}
            volume={volume}
            muted={isMuted}
            playbackRate={playbackRate}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleDurationChange}
            onEnded={handleEnded}
            onReady={handleReady}
            onPlay={() => { if (!isPlaying) resume(); }}
            onPause={() => { if (isPlaying) pause(); }}
            onWaiting={() => setIsLoading(true)}
            onPlaying={() => setIsLoading(false)}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-[var(--color-surface-secondary)]">
            <FeedIcon feedId={currentEntry.feed_id} iconId={currentEntry.feed?.icon?.icon_id} size={40} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--color-text-primary)] truncate">{currentEntry.title}</p>
            <p className="text-xs text-[var(--color-accent-fg)]">Playing in Picture-in-Picture</p>
          </div>
          <button
            onClick={() => {
              document.exitPictureInPicture().catch(console.error);
            }}
            className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)]"
          >
            <X size={16} className="text-[var(--color-text-tertiary)]" />
          </button>
        </div>
      </div>
    );
  }

  // Helper to get player size class
  const getPlayerSizeClass = () => {
    if (isFullscreen) return 'inset-0 w-full h-full';
    if (playerSize === 'theater') return 'inset-0 flex items-center justify-center p-4 md:p-8';
    // On mobile, position above the nav bar
    const mobileBottom = 'bottom-[calc(80px+env(safe-area-inset-bottom))]';
    const desktopBottom = 'bottom-4';
    const bottom = isMobile ? mobileBottom : desktopBottom;
    if (playerSize === 'normal' || expanded || isYouTube) {
      return isMobile 
        ? `${bottom} left-4 right-4` 
        : `${bottom} right-4 w-[480px] max-w-[calc(100vw-2rem)]`;
    }
    return isMobile 
      ? `${bottom} left-4 right-4` 
      : `${bottom} right-4 w-80`; // mini
  };

  // Cycle through player sizes
  const cyclePlayerSize = () => {
    if (playerSize === 'mini') {
      setPlayerSize('normal');
      setExpanded(true);
    } else if (playerSize === 'normal') {
      setPlayerSize('theater');
    } else {
      setPlayerSize('normal');
    }
  };

  return (
    <>
      {/* Theater mode backdrop */}
      {playerSize === 'theater' && !isFullscreen && (
        <div 
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm animate-backdrop-in"
          onClick={() => setPlayerSize('normal')}
        />
      )}
      
      <div 
        ref={containerRef}
        className={cn(
          'fixed z-50 animate-player-enter',
          'transition-all duration-500 transition-snappy',
          getPlayerSizeClass()
        )}
        onMouseMove={showControlsTemporarily}
        onMouseEnter={showControlsTemporarily}
      >
        {/* Player Card */}
        <div className={cn(
          'relative overflow-hidden',
          'transition-all duration-500 transition-snappy',
          isFullscreen 
            ? 'w-full h-full bg-black' 
            : playerSize === 'theater'
              ? 'w-full max-w-[min(1400px,calc(100vw-4rem))] aspect-video rounded-2xl bg-black shadow-2xl'
              : 'rounded-3xl bg-[var(--color-surface-base)]/95 backdrop-blur-xl border border-[var(--color-border-subtle)] shadow-2xl shadow-black/20 dark:shadow-black/40'
        )}>
          {/* Compact Mini Player - Not for YouTube (YouTube always expanded) */}
          {!expanded && !isFullscreen && !isYouTube && playerSize !== 'theater' && (
            <div className="p-3 animate-fade-in">
              <div className="flex items-center gap-3">
                {/* Video Thumbnail */}
                <button
                  onClick={() => setExpanded(true)}
                  className="relative w-16 h-9 rounded-lg overflow-hidden bg-[var(--color-surface-secondary)] flex-shrink-0 group"
                >
                  <ReactPlayer
                    ref={setPlayerRef}
                    src={videoUrl}
                    playing={isPlaying}
                    volume={volume}
                    muted={isMuted}
                    playbackRate={playbackRate}
                    onTimeUpdate={handleTimeUpdate}
                    onDurationChange={handleDurationChange}
                    onEnded={handleEnded}
                  onReady={handleReady}
                  onPlay={() => { if (!isPlaying) resume(); }}
                  onPause={() => { if (isPlaying) pause(); }}
                  onWaiting={() => setIsLoading(true)}
                  onPlaying={() => setIsLoading(false)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ChevronUp size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>

              {/* Track info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {currentEntry.title}
                </div>
                <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                  {currentEntry.feed?.title}
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

                <button
                  onClick={() => { syncProgress(); stop(); }}
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
        {(expanded || isFullscreen || isYouTube) && (
          <div className={cn(
            'flex flex-col',
            isFullscreen ? 'h-full' : 'h-auto'
          )}>
            {/* Video / YouTube via ReactPlayer */}
            <div 
              className={cn(
                'relative bg-black',
                isFullscreen ? 'flex-1' : 'aspect-video'
              )}
              onClick={() => isPlaying ? pause() : resume()}
              onMouseMove={showControlsTemporarily}
            >
              <ReactPlayer
                ref={setPlayerRef}
                src={videoUrl}
                playing={isPlaying}
                volume={volume}
                muted={isMuted}
                playbackRate={playbackRate}
                onTimeUpdate={handleTimeUpdate}
                onDurationChange={handleDurationChange}
                onEnded={handleEnded}
                onReady={handleReady}
                onPlay={() => { if (!isPlaying) resume(); }}
                onPause={() => { if (isPlaying) pause(); }}
                onWaiting={() => setIsLoading(true)}
                onPlaying={() => setIsLoading(false)}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                config={{
                  youtube: {
                    start: youtubeStartTimeRef.current,
                  }
                }}
              />

              {/* Loading spinner */}
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                  <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {/* Custom Overlay Controls */}
              <div className={cn(
                'absolute inset-0 flex flex-col justify-between pointer-events-none',
                'transition-opacity duration-300 transition-gentle',
                showControls || !isPlaying ? 'opacity-100' : 'opacity-0',
                'bg-gradient-to-b from-black/40 via-transparent to-black/60'
              )}>
                {/* Top bar */}
                <div className="flex items-center justify-between p-3 pointer-events-auto">
                  {/* Left side: Minimize button (only in normal mode) */}
                  <div className="flex items-center gap-1">
                    {!isFullscreen && playerSize !== 'theater' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(false); setPlayerSize('mini'); }}
                        className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 transition-colors"
                        title="Minimize"
                      >
                        <ChevronDown size={18} className="text-white" />
                      </button>
                    )}
                  </div>
                  
                  {/* Right side: All action buttons including theater mode exit */}
                  <div className="flex items-center gap-1 pointer-events-auto">
                    {document.pictureInPictureEnabled && !isYouTube && (
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePiP(); }}
                        className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 transition-colors"
                        title="Picture-in-Picture"
                      >
                        <PictureInPicture2 size={18} className="text-white" />
                      </button>
                    )}
                    {/* Theater mode button - show when not in theater/fullscreen */}
                    {!isFullscreen && playerSize !== 'theater' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPlayerSize('theater'); }}
                        className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 transition-colors"
                        title="Theater mode"
                      >
                        <RectangleHorizontal size={18} className="text-white" />
                      </button>
                    )}
                    {/* Exit theater mode button - show when in theater mode */}
                    {playerSize === 'theater' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPlayerSize('normal'); }}
                        className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 transition-colors"
                        title="Exit theater mode"
                      >
                        <Square size={18} className="text-white" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                      className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 transition-colors"
                      title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                      {isFullscreen ? (
                        <Minimize2 size={18} className="text-white" />
                      ) : (
                        <Maximize2 size={18} className="text-white" />
                      )}
                    </button>
                    {!isFullscreen && (
                      <button
                        onClick={(e) => { e.stopPropagation(); syncProgress(); stop(); }}
                        className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 transition-colors"
                      >
                        <X size={18} className="text-white" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Center play/pause button */}
                <div className="flex-1 flex items-center justify-center pointer-events-auto">
                  {!isPlaying && !isLoading && (
                    <button
                      onClick={(e) => { e.stopPropagation(); resume(); }}
                      className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center animate-bounce-in transition-all duration-300 transition-spring hover:scale-110 active:scale-95"
                    >
                      <Play size={32} fill="currentColor" className="text-black ml-1" />
                    </button>
                  )}
                </div>

                {/* Bottom controls */}
                <div className="p-3 space-y-2 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                  {/* Progress bar */}
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={(e) => handleSeek(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                      [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full 
                      [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                  />
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {/* Skip controls */}
                      <button
                        onClick={() => handleSeek(Math.max(0, currentTime - 10))}
                        className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                        title="Rewind 10s"
                      >
                        <RotateCcw size={18} className="text-white" />
                      </button>
                      
                      <button
                        onClick={() => isPlaying ? pause() : resume()}
                        className="w-10 h-10 rounded-full bg-white flex items-center justify-center transition-all duration-300 transition-spring hover:scale-110 active:scale-95"
                      >
                        {isPlaying ? (
                          <Pause size={20} fill="currentColor" className="text-black" />
                        ) : (
                          <Play size={20} fill="currentColor" className="text-black ml-0.5" />
                        )}
                      </button>
                      
                      <button
                        onClick={() => handleSeek(Math.min(duration, currentTime + 10))}
                        className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                        title="Forward 10s"
                      >
                        <RotateCw size={18} className="text-white" />
                      </button>

                      {queue.length > 0 && (
                        <button
                          onClick={playNext}
                          className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                          title="Next in queue"
                        >
                          <SkipForward size={18} className="text-white" />
                        </button>
                      )}
                    </div>

                    <div className="text-xs text-white tabular-nums">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Volume */}
                      <button
                        onClick={() => setMuted(!isMuted)}
                        className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                      >
                        {isMuted || volume === 0 ? (
                          <VolumeX size={18} className="text-white" />
                        ) : (
                          <Volume2 size={18} className="text-white" />
                        )}
                      </button>

                      {/* Speed */}
                      <div className="relative">
                        <button
                          onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                          className="px-2 py-1 rounded-lg hover:bg-white/20 text-white text-xs font-medium transition-colors"
                        >
                          {playbackRate}x
                        </button>
                        {showSpeedMenu && (
                          <div className="absolute bottom-full right-0 mb-2 py-1 rounded-lg bg-black/90 backdrop-blur shadow-lg animate-scale-in">
                            {speedOptions.map((speed) => (
                              <button
                                key={speed}
                                onClick={() => { setPlaybackRate(speed); setShowSpeedMenu(false); }}
                                className={cn(
                                  'block w-full px-4 py-1.5 text-left text-sm transition-colors',
                                  playbackRate === speed
                                    ? 'text-[var(--color-accent-fg)] bg-white/10'
                                    : 'text-white hover:bg-white/10'
                                )}
                              >
                                {speed}x
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Queue button */}
                      <button
                        onClick={() => setShowQueue(!showQueue)}
                        className={cn(
                          'p-1.5 rounded-lg transition-colors relative',
                          showQueue ? 'bg-white/30' : 'hover:bg-white/20'
                        )}
                      >
                        <ListVideo size={18} className="text-white" />
                        {queue.length > 0 && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-accent-fg)] text-white text-[10px] font-bold flex items-center justify-center">
                            {queue.length > 9 ? '9+' : queue.length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Video Info (non-fullscreen only) */}
            {!isFullscreen && (
              <div className="p-3 bg-[var(--color-surface-base)]">
                <div className="text-sm font-semibold text-[var(--color-text-primary)] line-clamp-2">
                  {currentEntry.title}
                </div>
                <button className="text-xs text-[var(--color-accent-fg)] hover:underline mt-1">
                  {currentEntry.feed?.title}
                </button>
              </div>
            )}

            {/* Queue Panel */}
            {showQueue && !isFullscreen && (
              <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] max-h-48 overflow-y-auto animate-slide-up">
                <div className="p-2 flex items-center justify-between border-b border-[var(--color-border-subtle)]">
                  <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                    Up Next ({queue.length})
                  </span>
                  {queue.length > 0 && (
                    <button
                      onClick={clearQueue}
                      className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
                    >
                      <Trash2 size={12} />
                      Clear
                    </button>
                  )}
                </div>
                {queue.length === 0 ? (
                  <p className="p-4 text-xs text-[var(--color-text-tertiary)] text-center">
                    No videos in queue
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--color-border-subtle)]">
                    {queue.map(({ entry, enclosure }, index) => (
                      <div
                        key={`${entry.id}-${index}`}
                        className="flex items-center gap-2 p-2 hover:bg-[var(--color-surface-hover)] transition-colors"
                      >
                        <span className="w-5 text-center text-xs text-[var(--color-text-tertiary)]">
                          {index + 1}
                        </span>
                        <div className="w-12 h-7 rounded overflow-hidden bg-[var(--color-surface-tertiary)]">
                          <FeedIcon feedId={entry.feed_id} iconId={entry.feed?.icon?.icon_id} size={48} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--color-text-primary)] truncate">
                            {entry.title}
                          </p>
                        </div>
                        <button
                          onClick={() => removeFromQueue(enclosure.id)}
                          className="p-1 rounded hover:bg-[var(--color-surface-active)] text-[var(--color-text-tertiary)]"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </>
  );
}

export default VideoPlayer;