/**
 * useOverlayCloseInteraction
 *
 * Returns a close handler for an overlay's dismiss control that is safe to
 * attach to `onPointerDown` as well as `onClick`.
 *
 * Closing on `pointerdown` unmounts the overlay before the browser dispatches
 * the matching `click`. That click then hit-tests against whatever the overlay
 * had been covering. In the books tab the reader's X sits directly on top of
 * the header's Back button, so one tap closed the reader *and* fired
 * `handleGoBack`, navigating the whole app back to the articles home screen.
 *
 * Neither `preventDefault` nor `stopPropagation` on the pointerdown helps: the
 * click is a separate, later event with nothing left to stop. So after a
 * pointerdown-initiated close we swallow exactly one capture-phase click,
 * which closes the window in which the element underneath is exposed.
 */
import { useCallback, useEffect, useRef } from 'react';

/** How long to wait for the synthesised click before dropping the guard. */
const GHOST_CLICK_WINDOW_MS = 350;

interface CloseInteractionEvent {
  preventDefault?: () => void;
  stopPropagation?: () => void;
  nativeEvent?: Event;
}

export function useOverlayCloseInteraction(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Uninstaller for a currently-armed click guard, so unmount can clean up.
  const disarmRef = useRef<(() => void) | null>(null);
  useEffect(() => () => disarmRef.current?.(), []);

  return useCallback((event?: CloseInteractionEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const nativeEvent = event?.nativeEvent as (Event & { stopImmediatePropagation?: () => void }) | undefined;
    nativeEvent?.stopImmediatePropagation?.();

    // Only a pointerdown produces a trailing click; arming after a real click
    // would swallow the user's next, unrelated one.
    if (nativeEvent?.type === 'pointerdown') {
      disarmRef.current?.();

      let timer = 0;
      const disarm = () => {
        window.removeEventListener('click', swallow, true);
        window.clearTimeout(timer);
        if (disarmRef.current === disarm) disarmRef.current = null;
      };
      function swallow(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        disarm();
      }

      window.addEventListener('click', swallow, true);
      timer = window.setTimeout(disarm, GHOST_CLICK_WINDOW_MS);
      disarmRef.current = disarm;
    }

    window.setTimeout(() => onCloseRef.current(), 0);
  }, []);
}
