/**
 * AudioPlayButton Component
 * Unified play button for podcast/audio content
 */

import { Play, Pause, Loader2, ListPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAudioStore } from '@/stores/audio';
import type { Entry, Enclosure } from '@/types/miniflux';

interface AudioPlayButtonProps {
  entry: Entry;
  enclosure: Enclosure;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'filled' | 'outline' | 'ghost';
  showLabel?: boolean;
  showAddToQueue?: boolean;
  className?: string;
}

export function AudioPlayButton({ 
  entry, 
  enclosure, 
  size = 'sm',
  variant = 'filled',
  showLabel = false,
  showAddToQueue = false,
  className 
}: AudioPlayButtonProps) {
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

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const sizeConfig = {
    xs: { button: 'w-6 h-6', icon: 12, label: 'text-[10px]' },
    sm: { button: 'w-8 h-8', icon: 14, label: 'text-xs' },
    md: { button: 'w-10 h-10', icon: 18, label: 'text-sm' },
    lg: { button: 'w-14 h-14', icon: 24, label: 'text-base' },
  };

  const variantConfig = {
    filled: cn(
      'bg-[var(--color-accent-primary)] text-white',
      'hover:bg-[var(--color-accent-hover)]',
      'shadow-lg hover:shadow-xl'
    ),
    outline: cn(
      'bg-transparent border-2 border-[var(--color-accent-primary)] text-[var(--color-accent-fg)]',
      'hover:bg-[var(--color-accent-muted)]'
    ),
    ghost: cn(
      'bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)]',
      'hover:bg-[var(--color-accent-primary)] hover:text-white'
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
      
      {showAddToQueue && !isCurrentTrack && (
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
