/**
 * Shared Reader Components & Hooks
 *
 * Provides a consistent reading experience across EPUB and PDF readers:
 * - Gesture handling (swipe, pinch-zoom, trackpad scroll)
 * - Page transition animations
 * - Keyboard navigation
 * - Navigation buttons
 * - Progress bar
 * - E-ink power lifecycle management
 */

export { useReaderGestures } from './useReaderGestures';
export type { ReaderGestureCallbacks, ReaderGestureOptions, ReaderGestureState } from './useReaderGestures';

export { useReaderAnimation } from './useReaderAnimation';
export type { PageTransition, ReaderAnimationState } from './useReaderAnimation';

export { useReaderKeyboard } from './useReaderKeyboard';
export type { ReaderKeyboardCallbacks } from './useReaderKeyboard';

export { useEinkWorkTag, useReaderWakeHandlers, useAutoHideControls } from './useEinkReaderLifecycle';
export { usePaginationWheel } from './usePaginationWheel';

export { ReaderNavButtons } from './ReaderNavButtons';
export { ReaderProgressBar } from './ReaderProgressBar';
export { SyncPositionToast } from './SyncPositionToast';
