/**
 * useReaderAnimation — Shared page transition animation for page-based readers
 *
 * Provides a state machine for page turn animations:
 * - slide-left / slide-right: content slides out (exit animation)
 * - enter-left / enter-right: new content positioned offscreen, then slides in
 * - none: resting state
 *
 * Also integrates with swipeOffset from gestures for live drag feedback.
 */

import { useCallback, useState } from 'react';

export type PageTransition =
  | 'none'
  | 'slide-left'
  | 'slide-right'
  | 'enter-left'
  | 'enter-right';

export interface ReaderAnimationState {
  /** Current transition state */
  pageTransition: PageTransition;
  /** Trigger an animated page turn. Calls `then()` after exit animation completes. */
  animatePageTurn: (direction: 'slide-left' | 'slide-right', then: () => void) => void;
  /** Compute inline styles for the page container element */
  getPageStyle: (opts: {
    scale: number;
    panOffset: { x: number; y: number };
    swipeOffset: number;
  }) => React.CSSProperties;
}

interface UseReaderAnimationOptions {
  disabled?: boolean;
}

export function useReaderAnimation(options: UseReaderAnimationOptions = {}): ReaderAnimationState {
  const { disabled = false } = options;
  const [pageTransition, setPageTransition] = useState<PageTransition>('none');

  const animatePageTurn = useCallback(
    (direction: 'slide-left' | 'slide-right', then: () => void) => {
      if (disabled) {
        then();
        setPageTransition('none');
        return;
      }

      setPageTransition(direction);
      setTimeout(() => {
        then();
        // Position new page at the opposite entry point (no transition)
        setPageTransition(direction === 'slide-left' ? 'enter-right' : 'enter-left');
        // Next frame: animate from entry point to center
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setPageTransition('none');
          });
        });
      }, 200);
    },
    [disabled],
  );

  const getPageStyle = useCallback(
    (opts: {
      scale: number;
      panOffset: { x: number; y: number };
      swipeOffset: number;
    }): React.CSSProperties => {
      const { scale, panOffset, swipeOffset } = opts;

      let transform: string | undefined;
      let opacity: number = 1;
      let transition: string | undefined;

      if (scale > 1) {
        transform = `translate(${panOffset.x}px, ${panOffset.y}px)`;
      } else if (pageTransition === 'slide-left') {
        transform = 'translateX(-25%)';
        opacity = 0.5;
      } else if (pageTransition === 'slide-right') {
        transform = 'translateX(25%)';
        opacity = 0.5;
      } else if (pageTransition === 'enter-right') {
        transform = 'translateX(25%)';
        opacity = 0;
      } else if (pageTransition === 'enter-left') {
        transform = 'translateX(-25%)';
        opacity = 0;
      } else if (swipeOffset !== 0) {
        transform = `translateX(${swipeOffset}px)`;
      }

      if (disabled) {
        return { transform, opacity, transition: 'none' };
      }

      if (pageTransition === 'slide-left' || pageTransition === 'slide-right') {
        transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      } else if (pageTransition === 'enter-left' || pageTransition === 'enter-right') {
        transition = 'none';
      } else if (swipeOffset !== 0) {
        transition = 'none';
      } else if (scale <= 1) {
        transition = 'transform 0.25s ease-out, opacity 0.15s ease-out';
      }

      return { transform, opacity, transition };
    },
    [disabled, pageTransition],
  );

  return {
    pageTransition,
    animatePageTurn,
    getPageStyle,
  };
}
