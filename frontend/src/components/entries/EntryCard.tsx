/**
 * EntryCard Component
 * Displays a single entry in the list view (similar to PageRow in Planneer)
 * Mobile: Larger touch targets and always-visible media controls
 */

import { cn, formatRelativeTime, formatReadingTime, getExcerpt, getMediaType } from '@/lib/utils';
import { Circle, Check, Star, Headphones, Video, FileText, MessageSquare } from 'lucide-react';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import { AudioPlayButton, VideoPlayButton } from '@/components/media';
import { getVideoInfo, isVideoEntry, useVideoStore } from '@/stores/video';
import { useSettingsStore } from '@/stores/settings';
import { useAudioStore } from '@/stores/audio';
import { hasCommentsAvailable } from '@/api/comments';
import type { Entry, Enclosure } from '@/types/api';

// Mini progress ring SVG for media cards
function ProgressRing({ percent, size = 16, strokeWidth = 2 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-surface-inset)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-accent-fg)" strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-300" />
    </svg>
  );
}

// Helper to get audio enclosure from entry
function getAudioEnclosure(entry: Entry): Enclosure | null {
  if (!entry.enclosures || entry.enclosures.length === 0) return null;
  return entry.enclosures.find(e => e.mime_type?.startsWith('audio/')) || null;
}

interface EntryCardProps {
  entry: Entry;
  isSelected: boolean;
  isCompact?: boolean;
  onSelect: (entry: Entry) => void;
  onToggleBookmark?: (entryId: number) => void;
  'data-entry-id'?: number;
}

export function EntryCard({
  entry,
  isSelected,
  isCompact = false,
  onSelect,
  onToggleBookmark,
  ...props
}: EntryCardProps) {
  const mediaType = getMediaType(entry.enclosures);
  const isUnread = entry.status === 'unread';
  const isMobile = useIsMobile();
  const showReadingTime = useSettingsStore((s) => s.showReadingTime);
  
  // Check for media content
  const audioEnclosure = getAudioEnclosure(entry);
  const videoInfo = getVideoInfo(entry);
  const isPodcast = !!audioEnclosure;
  const isVideo = !!videoInfo;
  
  // Active media detection (accent color on currently playing)
  const audioCurrentEntryId = useAudioStore((s) => s.currentEntry?.id);
  const audioIsPlaying = useAudioStore((s) => s.isPlaying);
  const videoCurrentEntryId = useVideoStore((s) => s.currentEntry?.id);
  const videoIsPlaying = useVideoStore((s) => s.isPlaying);
  const isCurrentlyPlaying = 
    (audioCurrentEntryId === entry.id && audioIsPlaying) ||
    (videoCurrentEntryId === entry.id && videoIsPlaying);
  
  // Media progress for progress ring
  const mediaProgress = (() => {
    if (isPodcast && audioEnclosure) {
      const progression = audioEnclosure.media_progression || 0;
      const dur = audioEnclosure.size || 0; // size in bytes, not duration
      // For podcasts, use enclosure.media_progression / estimated duration
      // media_progression is in seconds; enclosure.media_duration may not exist
      // Show ring only when we have progression data
      if (progression > 0) return Math.min((progression / 3600) * 100, 95); // rough estimate, cap at 95%
    }
    return 0;
  })();
  
  // Check if comments are available
  const hasComments = hasCommentsAvailable(entry);

  // Media type icon
  const MediaIcon = mediaType === 'audio' 
    ? Headphones 
    : mediaType === 'video' 
      ? Video 
      : FileText;
  const isTextType = mediaType !== 'audio' && mediaType !== 'video' && !isVideo;

  return (
    <article
      onClick={() => onSelect(entry)}
      data-entry-id={props['data-entry-id'] || entry.id}
      className={cn(
        'group relative cursor-pointer',
        'transition-all duration-200 transition-gentle',
        // Larger padding on mobile for better touch targets
        isMobile ? 'px-4 py-4' : 'px-4 py-3',
        // Selection state with glass effect (like Planneer)
        isSelected
          ? 'glass-item bg-[var(--color-interactive-bg)]'
          : isCurrentlyPlaying
            ? 'bg-[var(--color-accent-muted)]'
            : 'hover:bg-[var(--color-surface-hover)]',
        // Read state
        !isUnread && !isSelected && !isCurrentlyPlaying && 'opacity-70'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Left: Feed icon + unread indicator */}
        <div className="flex-shrink-0 relative">
          <FeedIcon 
            feedId={entry.feed_id} 
            iconId={entry.feed?.icon?.icon_id}
            size={20}
          />
          {/* Unread dot - positioned at bottom right of icon */}
          {isUnread && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--color-accent-fg)] border-2 border-[var(--color-surface-base)]" />
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className={cn(
            'text-sm leading-snug line-clamp-2',
            isUnread 
              ? 'font-medium text-[var(--color-text-primary)]' 
              : 'text-[var(--color-text-secondary)]',
            isSelected && 'text-[var(--color-text-primary)]'
          )}>
            {entry.title}
          </h3>

          {/* Meta row */}
          <div className="flex items-center gap-1.5 mt-1 text-xs text-[var(--color-text-tertiary)]">
            <span className="truncate max-w-[120px]">{entry.feed?.title}</span>
            <span className="text-[var(--color-border-default)]">·</span>
            <span className="whitespace-nowrap">{formatRelativeTime(entry.published_at)}</span>
            {showReadingTime && entry.reading_time > 0 && !isPodcast && !isVideo && (
              <>
                <span className="text-[var(--color-border-default)]">·</span>
                <span className="whitespace-nowrap">{formatReadingTime(entry.reading_time)}</span>
              </>
            )}
            {/* Media type indicator with progress ring */}
            {!isTextType && (
              <>
                <span className="text-[var(--color-border-default)]">·</span>
                {mediaProgress > 0 ? (
                  <ProgressRing percent={mediaProgress} size={14} strokeWidth={1.5} />
                ) : (
                  <MediaIcon 
                    size={12} 
                    className={cn(
                      mediaType === 'audio' && 'text-purple-500',
                      (mediaType === 'video' || isVideo) && 'text-red-500'
                    )} 
                  />
                )}
              </>
            )}
            {/* Comments indicator */}
            {hasComments && (
              <>
                <span className="text-[var(--color-border-default)]">·</span>
                <MessageSquare size={12} className="text-orange-500" />
              </>
            )}
          </div>

          {/* Excerpt - only in expanded mode */}
          {!isCompact && (
            <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)] line-clamp-2 leading-relaxed">
              {getExcerpt(entry.content, 120)}
            </p>
          )}
        </div>

        {/* Right: Play button or Star indicator */}
        <div className="flex-shrink-0 flex items-center gap-2 pt-0.5">
          {/* Play buttons for media content - always visible on mobile */}
          {(isPodcast || isVideo) && (
            <div 
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "transition-opacity",
                isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
            >
              {isVideo && <VideoPlayButton entry={entry} size="xs" showAddToQueue />}
              {isPodcast && !isVideo && audioEnclosure && <AudioPlayButton entry={entry} enclosure={audioEnclosure} size="xs" showAddToQueue />}
            </div>
          )}
          
          {/* Star indicator - always visible on mobile if starred */}
          {entry.starred ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleBookmark?.(entry.id);
              }}
              className="p-1 -m-1 rounded hover:bg-[var(--color-surface-hover)] transition-all duration-300 transition-spring active:scale-125"
              title="Remove from starred"
            >
              <Star 
                size={14} 
                className="fill-amber-400 text-amber-400 animate-bounce-in" 
              />
            </button>
          ) : (
            /* Show star button on hover (desktop only) */
            !isMobile && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleBookmark?.(entry.id);
                }}
                className="p-1 -m-1 rounded hover:bg-[var(--color-surface-hover)] transition-colors opacity-0 group-hover:opacity-100"
                title="Add to starred"
              >
                <Star 
                  size={14} 
                  className="text-[var(--color-text-disabled)]" 
                />
              </button>
            )
          )}
        </div>
      </div>

      {/* Selection indicator line (left border, like Planneer) */}
      {isSelected && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent-fg)] animate-fade-in" />
      )}
      
      {/* Now-playing accent bar */}
      {isCurrentlyPlaying && !isSelected && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent-fg)] animate-fade-in opacity-60" />
      )}
    </article>
  );
}

export default EntryCard;
