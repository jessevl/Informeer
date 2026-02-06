/**
 * FeedIcon Component
 * Displays a feed's favicon, falling back to a default RSS icon
 * Fetches icons via Miniflux API and caches them locally
 */

import { useState, useEffect, memo } from 'react';
import { Rss } from 'lucide-react';
import { miniflux } from '@/api/miniflux';
import { cn } from '@/lib/utils';

interface FeedIconProps {
  feedId: number;
  iconId?: number;
  size?: number;
  className?: string;
}

// Persistent cache using localStorage with in-memory fallback
const CACHE_KEY = 'informeer-icon-cache';
const CACHE_VERSION = 1;

interface IconCache {
  version: number;
  icons: Record<string, string>; // feedId -> dataUrl
  failed: string[]; // feedIds that failed
}

// Load cache from localStorage
function loadCache(): IconCache {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.version === CACHE_VERSION) {
        return parsed;
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
  return { version: CACHE_VERSION, icons: {}, failed: [] };
}

// In-memory cache (loaded from localStorage)
let iconCache = loadCache();
const pendingRequests = new Map<number, Promise<string | null>>();

// Save cache to localStorage (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function saveCache() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(iconCache));
    } catch (e) {
      // Storage full or unavailable
    }
  }, 1000);
}

/**
 * Convert icon data from Miniflux API to a data URL
 */
function toDataUrl(data: string, mimeType: string): string {
  if (data.startsWith('data:')) return data;
  if (data.includes(';base64,')) return `data:${data}`;
  return `data:${mimeType};base64,${data}`;
}

// Fetch icon with deduplication
async function fetchIconForFeed(feedId: number, iconId?: number): Promise<string | null> {
  // Check if already fetching
  if (pendingRequests.has(feedId)) {
    return pendingRequests.get(feedId)!;
  }
  
  const fetchPromise = (async () => {
    try {
      // Try by iconId first if available
      if (iconId) {
        try {
          const icon = await miniflux.getIcon(iconId);
          if (icon?.data && icon?.mime_type) {
            const url = toDataUrl(icon.data, icon.mime_type);
            iconCache.icons[String(feedId)] = url;
            saveCache();
            return url;
          }
        } catch (e) {
          // Fall through to feedId approach
        }
      }

      // Fallback: try to get icon by feedId
      const icon = await miniflux.getFeedIcon(feedId);
      if (icon?.data && icon?.mime_type) {
        const url = toDataUrl(icon.data, icon.mime_type);
        iconCache.icons[String(feedId)] = url;
        saveCache();
        return url;
      }
    } catch (e) {
      // Failed to fetch
    }
    
    // Mark as failed
    if (!iconCache.failed.includes(String(feedId))) {
      iconCache.failed.push(String(feedId));
      saveCache();
    }
    return null;
  })();
  
  pendingRequests.set(feedId, fetchPromise);
  const result = await fetchPromise;
  pendingRequests.delete(feedId);
  return result;
}

export const FeedIcon = memo(function FeedIcon({ feedId, iconId, size = 16, className }: FeedIconProps) {
  const feedKey = String(feedId);
  const cachedUrl = iconCache.icons[feedKey];
  const isFailed = iconCache.failed.includes(feedKey);
  
  const [iconUrl, setIconUrl] = useState<string | null>(cachedUrl || null);
  const [error, setError] = useState(isFailed);

  useEffect(() => {
    // Already have URL or already failed
    if (cachedUrl) {
      setIconUrl(cachedUrl);
      return;
    }
    if (isFailed) {
      setError(true);
      return;
    }

    let cancelled = false;
    
    fetchIconForFeed(feedId, iconId).then(url => {
      if (cancelled) return;
      if (url) {
        setIconUrl(url);
      } else {
        setError(true);
      }
    });

    return () => { cancelled = true; };
  }, [feedId, iconId, cachedUrl, isFailed]);

  // Show fallback icon
  if (error || !iconUrl) {
    return (
      <div 
        className={cn(
          'flex items-center justify-center flex-shrink-0 bg-[var(--color-surface-tertiary)]',
          className
        )}
        style={className?.includes('w-full') || className?.includes('h-full') ? undefined : { width: size, height: size }}
      >
        <Rss 
          size={Math.max(size * 0.5, 12)} 
          className="text-[var(--color-text-tertiary)]" 
        />
      </div>
    );
  }

  return (
    <img
      src={iconUrl}
      alt=""
      className={cn('flex-shrink-0 object-cover', className)}
      style={className?.includes('w-full') || className?.includes('h-full') ? undefined : { width: size, height: size }}
      onError={() => {
        if (!iconCache.failed.includes(feedKey)) {
          iconCache.failed.push(feedKey);
          saveCache();
        }
        setError(true);
      }}
    />
  );
});

export default FeedIcon;