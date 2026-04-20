/**
 * useReaderKeyboard — Shared keyboard shortcuts for page-based readers
 *
 * Handles:
 * - ArrowLeft / ArrowRight → page navigation
 * - Space → next page
 * - Escape → close reader
 * - +/- / 0 → zoom controls (optional)
 */

import { useEffect, useRef } from 'react';

export interface ReaderKeyboardCallbacks {
  nextPage: () => void;
  prevPage: () => void;
  onClose: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

export function useReaderKeyboard(callbacks: ReaderKeyboardCallbacks) {
  // Keep callbacks in a ref so the stable listener always calls the latest version.
  // Using a ref (instead of re-registering the listener on every callbacks change)
  // ensures there is never a brief window where no keyboard listener is attached,
  // which previously caused key presses to be silently dropped after page turns.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTypingTarget = Boolean(
        target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
      );
      if (isTypingTarget) return;

      const isPrevPageKey = e.key === 'ArrowLeft'
        || e.key === 'ArrowUp'
        || e.key === 'PageUp';

      const isNextPageKey = e.key === 'ArrowRight'
        || e.key === 'ArrowDown'
        || e.key === 'PageDown'
        || e.key === ' ';

      const isVolumeKey = e.key === 'AudioVolumeDown'
        || e.code === 'VolumeDown'
        || e.keyCode === 25
        || e.keyCode === 174
        || e.key === 'AudioVolumeUp'
        || e.code === 'VolumeUp'
        || e.keyCode === 24
        || e.keyCode === 175;

      // Handle page navigation
      if (isPrevPageKey || isNextPageKey || isVolumeKey) {
        e.preventDefault();

        if (isPrevPageKey || (isVolumeKey && (e.key === 'AudioVolumeDown' || e.code === 'VolumeDown' || e.keyCode === 25 || e.keyCode === 174))) {
          callbacksRef.current.prevPage();
        } else {
          callbacksRef.current.nextPage();
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          callbacksRef.current.onClose();
          break;
        case '+':
        case '=':
          callbacksRef.current.onZoomIn?.();
          break;
        case '-':
          callbacksRef.current.onZoomOut?.();
          break;
        case '0':
          callbacksRef.current.onZoomReset?.();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);  // stable: listener never re-registers, always calls latest callbacks via ref
}
