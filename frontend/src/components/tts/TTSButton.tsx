/**
 * TTSButton Component
 * Button to start TTS reading of an article
 * Shows model loading state, generation progress, and play/pause controls
 */

import { useCallback } from 'react';
import { Headphones, Loader2, ListPlus, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTTSStore, prepareTextForTTS } from '@/stores/tts';
import { useMediaQueueStore } from '@/stores/mediaQueue';
import type { Entry } from '@/types/api';

interface TTSButtonProps {
  entry: Entry;
  size?: 'sm' | 'md';
  variant?: 'filled' | 'outline' | 'ghost';
  showLabel?: boolean;
  showAddToQueue?: boolean;
  className?: string;
}

export function TTSButton({
  entry,
  size = 'sm',
  variant = 'ghost',
  showLabel = true,
  showAddToQueue = true,
  className,
}: TTSButtonProps) {
  const {
    modelStatus,
    generationStatus,
    currentEntry,
    isPlaying,
    initModel,
    generate,
    setPlaying,
    abort,
    cleanup,
  } = useTTSStore();

  const { addTTSToQueue, isTTSQueued } = useMediaQueueStore();
  const isCurrentArticle = currentEntry?.id === entry.id;
  const isCurrentlyPlaying = isCurrentArticle && isPlaying;
  const isGenerating = isCurrentArticle && generationStatus === 'generating';
  const isModelLoading = modelStatus === 'loading';
  const isInQueue = isTTSQueued(entry.id);

  const handleClick = useCallback(() => {
    if (isCurrentArticle) {
      if (isPlaying) {
        setPlaying(false);
      } else if (generationStatus === 'done' || generationStatus === 'generating') {
        setPlaying(true);
      } else {
        // Re-generate
        const text = prepareTextForTTS(entry.content || '');
        if (text.length > 0) {
          generate(text, entry);
        }
      }
    } else {
      // Start TTS for this article
      if (modelStatus === 'idle') {
        initModel();
      }
      const text = prepareTextForTTS(entry.content || '');
      if (text.length > 0) {
        generate(text, entry);
      }
    }
  }, [isCurrentArticle, isPlaying, generationStatus, modelStatus, entry, generate, setPlaying, initModel]);

  const handleStop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    abort();
    cleanup();
  }, [abort, cleanup]);

  const handleAddToQueue = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isInQueue) {
      const text = prepareTextForTTS(entry.content || '');
      if (text.length > 0) {
        addTTSToQueue(entry, text);
        // Pre-init model if not loaded
        if (modelStatus === 'idle') {
          initModel();
        }
      }
    }
  }, [entry, isInQueue, addTTSToQueue, modelStatus, initModel]);

  const sizeConfig = {
    sm: { button: 'h-8 px-3', icon: 14, label: 'text-xs' },
    md: { button: 'h-9 px-4', icon: 16, label: 'text-sm' },
  };

  const variantConfig = {
    filled: cn(
      'bg-[var(--color-accent-primary)] text-white',
      'hover:bg-[var(--color-accent-hover)]',
      'shadow-sm hover:shadow-md'
    ),
    outline: cn(
      'bg-transparent border border-[var(--color-border-default)] text-[var(--color-text-secondary)]',
      'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
    ),
    ghost: cn(
      'text-[var(--color-text-secondary)]',
      'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
    ),
  };

  const config = sizeConfig[size];
  const hasContent = (entry.content || '').length > 0;

  if (!hasContent) return null;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        onClick={handleClick}
        disabled={isModelLoading && !isCurrentArticle}
        className={cn(
          'flex items-center gap-1.5 rounded-full',
          'transition-all duration-200',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          config.button,
          variantConfig[variant],
          isCurrentlyPlaying && 'bg-[var(--color-accent-fg)]/10 text-[var(--color-accent-fg)]',
        )}
        title={isCurrentlyPlaying ? 'Pause reading' : 'Listen to article'}
      >
        {isModelLoading && !isCurrentArticle ? (
          <Loader2 size={config.icon} className="animate-spin" />
        ) : isGenerating && !isCurrentlyPlaying ? (
          <Loader2 size={config.icon} className="animate-spin" />
        ) : isCurrentlyPlaying ? (
          <div className="flex items-center gap-[2px]">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-[3px] bg-[var(--color-accent-fg)] rounded-full animate-pulse"
                style={{
                  height: `${8 + Math.random() * 6}px`,
                  animationDelay: `${i * 0.15}s`,
                  animationDuration: '0.6s',
                }}
              />
            ))}
          </div>
        ) : (
          <Headphones size={config.icon} />
        )}
        {showLabel && (
          <span className={config.label}>
            {isModelLoading && !isCurrentArticle
              ? 'Loading...'
              : isGenerating && !isCurrentlyPlaying
                ? 'Preparing...'
                : isCurrentlyPlaying
                  ? 'Listening'
                  : 'Listen'}
          </span>
        )}
      </button>

      {/* Stop button - shown during active TTS */}
      {isCurrentArticle && (generationStatus === 'generating' || generationStatus === 'done') && (
        <button
          onClick={handleStop}
          className={cn(
            'flex items-center justify-center rounded-full',
            'text-[var(--color-text-tertiary)] hover:text-[var(--color-danger-fg)]',
            'hover:bg-[var(--color-danger-fg)]/10',
            'transition-all duration-200',
            size === 'sm' ? 'w-7 h-7' : 'w-8 h-8',
          )}
          title="Stop reading"
        >
          <Square size={size === 'sm' ? 12 : 14} fill="currentColor" />
        </button>
      )}

      {/* Add to queue button */}
      {showAddToQueue && !isCurrentArticle && (
        <button
          onClick={handleAddToQueue}
          disabled={isInQueue}
          className={cn(
            'flex items-center justify-center rounded-full',
            'transition-all duration-200',
            size === 'sm' ? 'w-7 h-7' : 'w-8 h-8',
            isInQueue
              ? 'text-[var(--color-accent-fg)] bg-[var(--color-accent-fg)]/10'
              : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
          )}
          title={isInQueue ? 'Already in queue' : 'Add to listen queue'}
        >
          <ListPlus size={size === 'sm' ? 14 : 16} />
        </button>
      )}
    </div>
  );
}
