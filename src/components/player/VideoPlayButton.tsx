/**
 * VideoPlayButton Component
 * Button to play video enclosures from articles
 */

import { Play, Pause, Loader2, ListPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVideoStore } from '@/stores/video';
import type { Entry, Enclosure } from '@/types/miniflux';

interface VideoPlayButtonProps {
  entry: Entry;
  enclosure: Enclosure;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showAddToQueue?: boolean;
  className?: string;
}

export function VideoPlayButton({ 
  entry, 
  enclosure, 
  size = 'md', 
  showLabel = false,
  showAddToQueue = false,
  className 
}: VideoPlayButtonProps) {
  const { 
    currentEnclosure, 
    isPlaying, 
    isLoading,
    queue,
    play, 
    pause, 
    resume,
    addToQueue,
  } = useVideoStore();

  const isCurrentVideo = currentEnclosure?.id === enclosure.id;
  const isCurrentlyPlaying = isCurrentVideo && isPlaying;
  const isCurrentlyLoading = isCurrentVideo && isLoading;
  const isInQueue = queue.some(item => item.enclosure.id === enclosure.id);

  const handleClick = () => {
    if (isCurrentVideo) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
    } else {
      play(enclosure, entry);
    }
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isInQueue && !isCurrentVideo) {
      addToQueue(enclosure, entry);
    }
  };

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
  };

  const iconSizes = {
    sm: 14,
    md: 18,
    lg: 24,
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        onClick={handleClick}
        className={cn(
          'flex items-center justify-center gap-2 rounded-full transition-all',
          'bg-[var(--color-accent-fg)] text-white',
          'hover:bg-[var(--color-accent-emphasis)]',
          'shadow-lg hover:shadow-xl',
          sizeClasses[size],
          showLabel && 'px-4 w-auto'
        )}
      >
        {isCurrentlyLoading ? (
          <Loader2 size={iconSizes[size]} className="animate-spin" />
        ) : isCurrentlyPlaying ? (
          <Pause size={iconSizes[size]} fill="currentColor" />
        ) : (
          <Play size={iconSizes[size]} fill="currentColor" className="ml-0.5" />
        )}
        {showLabel && (
          <span className="text-sm font-medium">
            {isCurrentlyPlaying ? 'Pause' : 'Play'}
          </span>
        )}
      </button>

      {showAddToQueue && !isCurrentVideo && !isInQueue && (
        <button
          onClick={handleAddToQueue}
          className={cn(
            'flex items-center justify-center rounded-full transition-all',
            'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]',
            'hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]',
            size === 'sm' ? 'w-7 h-7' : size === 'md' ? 'w-8 h-8' : 'w-10 h-10'
          )}
          title="Add to queue"
        >
          <ListPlus size={size === 'sm' ? 12 : size === 'md' ? 16 : 20} />
        </button>
      )}

      {isInQueue && (
        <span className="text-xs text-[var(--color-text-tertiary)]">In queue</span>
      )}
    </div>
  );
}

export default VideoPlayButton;