/**
 * useReaderKeyboard — Shared keyboard shortcuts for page-based readers
 *
 * Handles:
 * - ArrowLeft / ArrowRight → page navigation
 * - Space → next page
 * - Escape → close reader
 * - +/- / 0 → zoom controls (optional)
 */

import { useEffect } from 'react';

export interface ReaderKeyboardCallbacks {
  nextPage: () => void;
  prevPage: () => void;
  onClose: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

export function useReaderKeyboard(callbacks: ReaderKeyboardCallbacks) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowLeft':
          callbacks.prevPage();
          break;
        case 'ArrowRight':
        case ' ':
          e.preventDefault();
          callbacks.nextPage();
          break;
        case 'Escape':
          callbacks.onClose();
          break;
        case '+':
        case '=':
          callbacks.onZoomIn?.();
          break;
        case '-':
          callbacks.onZoomOut?.();
          break;
        case '0':
          callbacks.onZoomReset?.();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [callbacks]);
}
