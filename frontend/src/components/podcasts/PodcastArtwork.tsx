/**
 * PodcastArtwork Component
 * Displays high-resolution podcast artwork from the iTunes catalogue.
 * Falls back to the standard FeedIcon (Informeer favicon) when unavailable.
 */

import { useState, useEffect, memo } from 'react';
import { Rss } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FeedIcon } from '@/components/feeds/FeedIcon';
import { getPodcastArtwork, getCachedPodcastArtwork } from '@/api/podcastArtwork';

interface PodcastArtworkProps {
  feedId: number;
  feedTitle: string;
  iconId?: number;
  /** Desired image dimension in pixels */
  size?: number;
  className?: string;
}

export const PodcastArtwork = memo(function PodcastArtwork({
  feedId,
  feedTitle,
  iconId,
  size = 200,
  className,
}: PodcastArtworkProps) {
  // Try to get the cached URL synchronously for instant render
  const [artworkUrl, setArtworkUrl] = useState<string | null>(
    () => getCachedPodcastArtwork(feedId, size)
  );
  const [failed, setFailed] = useState(false);

  // Reset when feed changes (e.g. queue advances to different podcast)
  const [prevFeedId, setPrevFeedId] = useState(feedId);
  if (feedId !== prevFeedId) {
    setPrevFeedId(feedId);
    setArtworkUrl(getCachedPodcastArtwork(feedId, size));
    setFailed(false);
  }

  useEffect(() => {
    let cancelled = false;

    // If already have a URL, skip (but still re-fetch if nothing cached)
    if (artworkUrl) return;

    getPodcastArtwork(feedId, feedTitle, size).then(url => {
      if (cancelled) return;
      if (url) {
        setArtworkUrl(url);
      } else {
        setFailed(true);
      }
    });

    return () => { cancelled = true; };
  }, [feedId, feedTitle, size, artworkUrl]);

  // High-res artwork available — render it
  if (artworkUrl && !failed) {
    return (
      <img
        src={artworkUrl}
        alt={feedTitle}
        className={cn('flex-shrink-0 object-cover', className)}
        style={
          className?.includes('w-full') || className?.includes('h-full')
            ? undefined
            : { width: size, height: size }
        }
        loading="lazy"
        onError={() => {
          // iTunes URL broken — fall through to FeedIcon
          setFailed(true);
        }}
      />
    );
  }

  // Fallback: standard Informeer favicon
  return (
    <FeedIcon
      feedId={feedId}
      iconId={iconId}
      size={size}
      className={className}
    />
  );
});

export default PodcastArtwork;
