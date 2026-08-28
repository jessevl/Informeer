/**
 * useBackGestureClose
 *
 * Makes a UI "layer" (a modal, drill-down view, article/book/magazine
 * reader, etc.) consume the browser/OS Back action so that pressing the
 * browser Back button — or an Android/iOS PWA edge-swipe — closes the
 * top-most open layer instead of navigating the whole app to a previous
 * view or exiting the installed PWA.
 *
 * Implementation notes — why `useBlocker` and not synthetic history entries:
 * this app uses TanStack Router, which owns `window.history`. It throttles
 * history writes through a microtask (coalescing near-simultaneous pushes)
 * and classifies popstate as BACK/FORWARD/GO purely from a `__TSR_index`
 * delta. Pushing our own dummy `history.pushState` entries fought all of
 * that and proved unreliable in practice (Back would skip the reader or
 * navigate the view behind it). Instead we use the router's purpose-built
 * navigation blocker: `useBlocker` intercepts the Back at TanStack's own
 * popstate handler, we close the overlay, and TanStack restores the history
 * position — so nothing behind the overlay moves and no entries desync.
 *
 * Priority: every open layer registers into a shared LIFO stack. When Back
 * fires, TanStack asks every blocker whether to block; only the layer that
 * is currently on top of the stack answers yes (closing itself). That makes
 * nested screens (e.g. category list -> article reader, or books overview
 * -> reader) unwind exactly one level per Back, regardless of the order in
 * which the individual blockers happen to be registered.
 */
import { useEffect, useRef } from 'react';
import { useBlocker } from '@tanstack/react-router';

// Shared LIFO stack of the ids of every currently-open layer.
let stack: number[] = [];
let nextId = 0;

export function useBackGestureClose(isOpen: boolean, onClose: () => void) {
  // Stable id for this hook instance.
  const idRef = useRef<number>(-1);
  if (idRef.current === -1) idRef.current = nextId++;
  const id = idRef.current;

  // Latest values read from inside the (long-lived) blocker callback.
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Maintain LIFO membership in the shared stack as this layer opens/closes.
  useEffect(() => {
    if (isOpen) {
      if (!stack.includes(id)) stack.push(id);
    } else {
      stack = stack.filter((x) => x !== id);
    }
    return () => {
      stack = stack.filter((x) => x !== id);
    };
  }, [isOpen, id]);

  useBlocker({
    disabled: !isOpen,
    // Don't add a "Leave site?" beforeunload prompt — we only care about
    // in-app Back navigation.
    enableBeforeUnload: false,
    shouldBlockFn: ({ action }) => {
      if (!isOpenRef.current) return false;
      // Only backward navigation (Back button / PWA back gesture).
      if (action !== 'BACK') return false;
      // Only the top-most open layer consumes this Back.
      if (stack[stack.length - 1] !== id) return false;
      onCloseRef.current();
      return true; // block the navigation; TanStack restores the position
    },
  });
}
