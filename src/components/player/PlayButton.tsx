/**
 * PlayButton Component
 * Button to play audio enclosures from articles
 */

import { Play, Pause, Loader2, ListPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAudioStore } from '@/stores/audio';
import type { Entry, Enclosure } from '@/types/miniflux';

interface PlayButtonProps {
  entry: Entry;
  enclosure: Enclosure;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showAddToQueue?: boolean;
  className?: string;
}

export function PlayButton({ 
  entry, 
  enclosure, 
  size = 'md', 
  showLabel = false,
  showAddToQueue = false,
  className 
}: PlayButtonProps) {
  const { 
    currentEnclosure, 
    isPlaying, 
    isLoading,
    queue,
    play, 
    pause, 
    resume,
    addToQueue,
  } = useAudioStore();

  const isCurrentTrack = currentEnclosure?.id === enclosure.id;
  const isCurrentlyPlaying = isCurrentTrack && isPlaying;
  const isCurrentlyLoading = isCurrentTrack && isLoading;
  const isInQueue = queue.some(item => item.enclosure.id === enclosure.id);

  const handleClick = () => {
    if (isCurrentTrack) {
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
    if (!isInQueue && !isCurrentTrack) {
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
          'flex items-center justify-center gap-2 rounded-full',
          'bg-[var(--color-accent-fg)] text-white',
          'hover:bg-[var(--color-accent-emphasis)]',
          'shadow-lg hover:shadow-xl',
          'transition-all duration-300 transition-spring',
          'hover:scale-110 active:scale-95',
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
      
      {showAddToQueue && !isCurrentTrack && (
        <button
          onClick={handleAddToQueue}
          disabled={isInQueue}
          className={cn(
            'flex items-center justify-center rounded-full transition-all',
            sizeClasses[size],
            isInQueue
              ? 'bg-[var(--color-surface-inset)] text-[var(--color-text-tertiary)] cursor-default'
              : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
          )}
          title={isInQueue ? 'Already in queue' : 'Add to queue'}
        >
          <ListPlus size={iconSizes[size]} />
        </button>
      )}
    </div>
  );
}

export default PlayButton;