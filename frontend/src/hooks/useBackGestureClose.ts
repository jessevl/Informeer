/**
 * useBackGestureClose
 *
 * Makes a UI "layer" (a modal, drill-down view, article/book/magazine
 * reader, etc.) participate in the browser/OS back gesture instead of
 * letting the gesture fall through to the host app. Without this, Android's
 * edge-swipe-back gesture inside an installed PWA has no history entry to
 * consume (the app never pushes real history state when navigating between
 * in-app screens), so the OS treats the swipe as "exit the app" instead of
 * "close this screen".
 *
 * Every currently-open layer — regardless of which component registered it —
 * shares one global LIFO stack, each entry backed by exactly one pushed
 * history entry. A back gesture (or the hardware/software back button)
 * fires a single `popstate` event; only the topmost (most recently opened)
 * layer closes in response, so screens nested several levels deep (e.g.
 * category list -> article reader, or books overview -> reader) unwind one
 * at a time instead of all collapsing together or leaving later swipes with
 * nothing left to do.
 *
 * If a layer is closed some other way (an in-app "X"/back button) while it
 * is still the topmost layer, the now-unnecessary history entry is popped
 * so it doesn't swallow the *next* back gesture.
 */
import { useEffect, useRef } from 'react';

const MARKER = 'informeerBackGestureLayer';

interface StackLayer {
  id: number;
  close: () => void;
}

let stack: StackLayer[] = [];
let nextId = 0;
let listenerAttached = false;

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener('popstate', () => {
    const top = stack[stack.length - 1];
    if (!top) return;
    stack = stack.slice(0, -1);
    top.close();
  });
}

export function useBackGestureClose(isOpen: boolean, onClose: () => void) {
  const idRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    ensureListener();
  }, []);

  useEffect(() => {
    if (isOpen && idRef.current === null) {
      const id = nextId++;
      idRef.current = id;
      stack.push({ id, close: () => onCloseRef.current() });
      window.history.pushState({ [MARKER]: id }, '');
    } else if (!isOpen && idRef.current !== null) {
      const id = idRef.current;
      idRef.current = null;
      const idx = stack.findIndex((l) => l.id === id);
      if (idx !== -1) {
        const wasTop = idx === stack.length - 1;
        stack = stack.slice(0, idx).concat(stack.slice(idx + 1));
        // Closed via some in-app action rather than a back gesture. Only
        // safe to pop history if our entry was still the current top —
        // otherwise the top belongs to a still-open layer above us.
        if (wasTop && window.history.state?.[MARKER] === id) {
          window.history.back();
        }
      }
    }
  }, [isOpen]);

  // If the component unmounts while its layer is still open, drop it from
  // the stack without touching history (nothing to navigate to for it).
  useEffect(() => {
    return () => {
      if (idRef.current !== null) {
        const id = idRef.current;
        stack = stack.filter((l) => l.id !== id);
      }
    };
  }, []);
}
