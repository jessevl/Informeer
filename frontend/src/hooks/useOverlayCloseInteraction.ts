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
 * pointerdown-initiated close we swallow exactly one capture-phase click.
 *
 * The guard deliberately lives at module scope rather than in the component.
 * Its whole purpose is to outlive the unmount it is protecting against, so
 * tying it to the hook's lifecycle would have it torn down by the very unmount
 * whose trailing click it needs to catch.
 */
import { useCallback, useRef } from 'react';

/** Grace period after release for the synthesised click to arrive. */
const CLICK_AFTER_RELEASE_MS = 400;
/** Ceiling, in case no release ever arrives (cancelled gesture, lost pointer). */
const MAX_GUARD_MS = 5000;

/**
 * Swallow the next capture-phase click, so it cannot reach whatever the
 * closing overlay was covering. Self-disarms on that click, shortly after the
 * pointer is released, or at the ceiling — whichever comes first.
 *
 * The release-anchored timer matters: a press held for a while still emits its
 * click on release, long after the pointerdown that armed this.
 */
function armGhostClickGuard(): void {
  let timer = window.setTimeout(disarm, MAX_GUARD_MS);

  function disarm() {
    window.clearTimeout(timer);
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('pointerup', onRelease, true);
  }

  function swallow(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    disarm();
  }

  function onRelease() {
    window.removeEventListener('pointerup', onRelease, true);
    window.clearTimeout(timer);
    timer = window.setTimeout(disarm, CLICK_AFTER_RELEASE_MS);
  }

  window.addEventListener('click', swallow, true);
  window.addEventListener('pointerup', onRelease, true);
}

interface CloseInteractionEvent {
  preventDefault?: () => void;
  stopPropagation?: () => void;
  nativeEvent?: Event;
}

export function useOverlayCloseInteraction(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  return useCallback((event?: CloseInteractionEvent) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const nativeEvent = event?.nativeEvent as (Event & { stopImmediatePropagation?: () => void }) | undefined;
    nativeEvent?.stopImmediatePropagation?.();

    // Only a pointerdown produces a trailing click; arming after a real click
    // would swallow the user's next, unrelated one.
    if (nativeEvent?.type === 'pointerdown') {
      armGhostClickGuard();
    }

    window.setTimeout(() => onCloseRef.current(), 0);
  }, []);
}
