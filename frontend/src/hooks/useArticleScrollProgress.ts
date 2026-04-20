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
const scrollPositionCache = new Map<string, number>();

type ScrollAxis = 'vertical' | 'horizontal';

interface ArticleScrollProgress {
  /** Ref to attach to the scrollable container */
  scrollRef: RefObject<HTMLElement | null>;
  /** Ref to attach to the progress bar element (sets width % directly) */
  progressRef: RefObject<HTMLDivElement | null>;
}

export function useArticleScrollProgress(entryId: number, axis: ScrollAxis = 'vertical'): ArticleScrollProgress {
  const scrollRef = useRef<HTMLElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const cacheKey = `${entryId}:${axis}`;

  // Track scroll progress — writes directly to DOM, no React state
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const bar = progressRef.current;
      if (!bar) return;
      const scrollOffset = axis === 'horizontal' ? el.scrollLeft : el.scrollTop;
      const scrollExtent = axis === 'horizontal'
        ? el.scrollWidth - el.clientWidth
        : el.scrollHeight - el.clientHeight;
      if (scrollExtent <= 0) { bar.style.width = '0%'; return; }
      const pct = Math.min(scrollOffset / scrollExtent, 1) * 100;
      bar.style.width = `${pct}%`;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [axis, entryId]);

  // Save/restore scroll position — always reset to 0 for articles with no saved position,
  // so switching articles in dual-pane doesn't inherit the previous article's scroll offset.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollPositionCache.get(cacheKey) ?? 0;
    requestAnimationFrame(() => {
      if (axis === 'horizontal') {
        el.scrollLeft = saved;
        return;
      }
      el.scrollTop = saved;
    });
    return () => {
      scrollPositionCache.set(cacheKey, axis === 'horizontal' ? el.scrollLeft : el.scrollTop);
    };
  }, [axis, cacheKey, entryId]);

  return { scrollRef, progressRef };
}
