import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { getCachedBlob } from '@/lib/offline/blob-cache';

interface UseCachedImageUrlOptions {
  cacheKey?: string | null;
  imageUrl?: string | null;
  authenticated?: boolean;
}

export function useCachedImageUrl({
  cacheKey,
  imageUrl,
  authenticated = false,
}: UseCachedImageUrlOptions): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let revokeUrl: string | null = null;

    if (!cacheKey && !imageUrl) {
      setObjectUrl(null);
      return;
    }

    async function load() {
      let blob: Blob | null = null;

      if (cacheKey) {
        const cached = await getCachedBlob(cacheKey);
        if (cached) {
          blob = await cached.blob();
        }
      }

      if (!blob && imageUrl) {
        const headers: Record<string, string> = {};
        if (authenticated && api.isAuthenticated()) {
          headers.Authorization = api.getAuthHeader();
        }

        const response = await fetch(imageUrl, {
          headers,
          cache: 'no-cache',
        });

        if (response.ok) {
          blob = await response.blob();
        }
      }

      if (!blob || cancelled) {
        if (!cancelled) {
          setObjectUrl(null);
        }
        return;
      }

      revokeUrl = URL.createObjectURL(blob);
      setObjectUrl(revokeUrl);
    }

    load().catch(() => {
      if (!cancelled) {
        setObjectUrl(null);
      }
    });

    return () => {
      cancelled = true;
      if (revokeUrl) {
        URL.revokeObjectURL(revokeUrl);
      }
    };
  }, [authenticated, cacheKey, imageUrl]);

  return objectUrl;
}