/**
 * useBackGestureClose / useBackGestureDepth
 *
 * React bindings for the app's back stack: they give every open layer (a
 * modal, a drill-down view, the article/PDF/EPUB readers) a real browser
 * history entry, so Back — the Android/PWA back gesture, the browser's Back
 * button, a mouse thumb button — closes the top-most layer instead of leaving
 * the app. See `@/lib/back-stack` for how that is kept in sync with TanStack
 * Router's history.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';
import {
  attachBackStack,
  createBackGroup,
  releaseBackGroup,
  setBackGroupDepth,
  type BackGroup,
} from '@/lib/back-stack';

/**
 * Give a layer `depth` history entries of its own.
 *
 * `onPop` is called once for every entry Back takes away, so a layer that
 * keeps its own stack (for example the drill-down view history) can pass its
 * length and unwind one level per press.
 */
export function useBackGestureDepth(depth: number, onPop: () => void) {
  const router = useRouter();

  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;

  const groupRef = useRef<BackGroup | null>(null);
  if (groupRef.current === null) {
    groupRef.current = createBackGroup(() => onPopRef.current());
  }
  const group = groupRef.current;

  useEffect(() => {
    attachBackStack(router.history);
    return () => releaseBackGroup(group);
  }, [group, router]);

  // Deliberately runs on every render rather than only when `depth` changes:
  // several layers share one `onPop` (the app's single "go back" handler), so
  // a press can close a layer other than the one that owned the entry.
  // Re-checking every render lets the back stack heal that drift; it is a
  // no-op once the pushed entries match.
  useEffect(() => {
    setBackGroupDepth(group, depth);
  });
}

/**
 * Make an open/closed layer (a modal, a reader, a drill-down) consume one
 * Back press: while `isOpen`, Back calls `onClose` instead of leaving the app.
 */
export function useBackGestureClose(isOpen: boolean, onClose: () => void) {
  useBackGestureDepth(isOpen ? 1 : 0, onClose);
}
