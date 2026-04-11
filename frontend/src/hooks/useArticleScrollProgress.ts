/**
 * Shared hook for article reading progress bar & scroll position memory.
 * Used by both ArticleReader (side panel) and ArticleModal (magazine modal).
 *
 * Uses direct DOM manipulation for the progress bar to avoid React re-renders
 * on every scroll event (which would cause dangerouslySetInnerHTML to re-apply
 * and images to flash).
 */

import { useEffect, useRef, type RefObject } from 'react';

// In-memory cache of scroll positions per article (survives component re-mounts within session)
const scrollPositionCache = new Map<number, number>();

interface ArticleScrollProgress {
  /** Ref to attach to the scrollable container */
  scrollRef: RefObject<HTMLElement | null>;
  /** Ref to attach to the progress bar element (sets width % directly) */
  progressRef: RefObject<HTMLDivElement | null>;
}

export function useArticleScrollProgress(entryId: number): ArticleScrollProgress {
  const scrollRef = useRef<HTMLElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  // Track scroll progress — writes directly to DOM, no React state
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const bar = progressRef.current;
      if (!bar) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight) { bar.style.width = '0%'; return; }
      const pct = Math.min(scrollTop / (scrollHeight - clientHeight), 1) * 100;
      bar.style.width = `${pct}%`;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [entryId]);

  // Save/restore scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollPositionCache.get(entryId);
    if (saved && saved > 0) {
      requestAnimationFrame(() => { el.scrollTop = saved; });
    }
    return () => { scrollPositionCache.set(entryId, el.scrollTop); };
  }, [entryId]);

  return { scrollRef, progressRef };
}
