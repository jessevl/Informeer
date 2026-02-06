/**
 * VideoPlayButton Component
 * Unified play button for video content (YouTube and native video)
 */

import { Play, Pause, Loader2, ListPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVideoStore, getVideoInfo } from '@/stores/video';
import type { Entry, Enclosure } from '@/types/miniflux';

interface VideoPlayButtonProps {
  entry: Entry;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'filled' | 'outline' | 'ghost';
  showLabel?: boolean;
  showAddToQueue?: boolean;
  className?: string;
}

export function VideoPlayButton({ 
  entry, 
  size = 'sm',
  variant = 'filled',
  showLabel = false,
  showAddToQueue = false,
  className 
}: VideoPlayButtonProps) {
  const { 
    currentEntry,
    isPlaying, 
    isLoading,
    queue,
    play,
    playYouTube,
    pause, 
    resume,
    addToQueue,
  } = useVideoStore();

  const videoInfo = getVideoInfo(entry);
  if (!videoInfo) return null;

  const isYouTube = videoInfo.type === 'youtube';
  const enclosure = videoInfo.type === 'enclosure' ? videoInfo.enclosure : null;

  const isCurrentVideo = currentEntry?.id === entry.id;
  const isCurrentlyPlaying = isCurrentVideo && isPlaying;
  const isCurrentlyLoading = isCurrentVideo && isLoading;
  const isInQueue = enclosure ? queue.some(item => item.entry.id === entry.id) : false;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurrentVideo) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
    } else if (isYouTube) {
      playYouTube(videoInfo.videoId, entry);
    } else if (enclosure) {
      play(enclosure, entry);
    }
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isInQueue && !isCurrentVideo && enclosure) {
      addToQueue(enclosure, entry);
    }
  };

  const sizeConfig = {
    xs: { button: 'w-6 h-6', icon: 12, label: 'text-[10px]' },
    sm: { button: 'w-8 h-8', icon: 14, label: 'text-xs' },
    md: { button: 'w-10 h-10', icon: 18, label: 'text-sm' },
    lg: { button: 'w-14 h-14', icon: 24, label: 'text-base' },
  };

  const variantConfig = {
    filled: cn(
      isYouTube ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-hover)]',
      'text-white',
      'shadow-lg hover:shadow-xl'
    ),
    outline: cn(
      isYouTube ? 'border-red-600 text-red-600 hover:bg-red-600/10' : 'border-[var(--color-accent-primary)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-muted)]',
      'bg-transparent border-2'
    ),
    ghost: cn(
      'bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)]',
      isYouTube ? 'hover:bg-red-600 hover:text-white' : 'hover:bg-[var(--color-accent-primary)] hover:text-white'
    ),
  };

  const config = sizeConfig[size];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        onClick={handleClick}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-full',
          'transition-all duration-300 transition-spring',
          'hover:scale-110 active:scale-95',
          config.button,
          variantConfig[variant],
          showLabel && 'px-3 w-auto'
        )}
      >
        {isCurrentlyLoading ? (
          <Loader2 size={config.icon} className="animate-spin" />
        ) : isCurrentlyPlaying ? (
          <Pause size={config.icon} fill="currentColor" />
        ) : (
          <Play size={config.icon} fill="currentColor" className="ml-0.5" />
        )}
        {showLabel && (
          <span className={cn('font-medium', config.label)}>
            {isCurrentlyPlaying ? 'Pause' : 'Play'}
          </span>
        )}
      </button>
      
      {showAddToQueue && !isCurrentVideo && enclosure && !isYouTube && (
        <button
          onClick={handleAddToQueue}
          disabled={isInQueue}
          className={cn(
            'flex items-center justify-center rounded-full transition-all',
            config.button,
            isInQueue
              ? 'bg-[var(--color-surface-inset)] text-[var(--color-text-tertiary)] cursor-default'
              : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
          )}
          title={isInQueue ? 'Already in queue' : 'Add to queue'}
        >
          <ListPlus size={config.icon} />
        </button>
      )}
    </div>
  );
}
