/**
 * useBackGestureClose
 *
 * Makes a UI "layer" (a modal, drill-down view, article reader, etc.)
 * participate in the browser/OS back gesture instead of letting the gesture
 * fall through to the host app. Without this, Android's edge-swipe-back
 * gesture inside an installed PWA has no history entry to consume (the app
 * never pushes real history state when navigating between in-app screens),
 * so the OS treats the swipe as "exit the app" instead of "close this
 * screen".
 *
 * While `isOpen` is true, one history entry is kept pushed. A back gesture
 * (or the hardware/software back button) fires `popstate`, which we use to
 * call `onClose` instead of navigating away. If the layer is closed some
 * other way (e.g. an in-app "X" button), the now-unnecessary history entry
 * is popped so it doesn't swallow the *next* back gesture.
 */
import { useEffect, useRef } from 'react';

const MARKER = 'informeerBackGestureLayer';

export function useBackGestureClose(isOpen: boolean, onClose: () => void) {
  const pushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen && !pushedRef.current) {
      pushedRef.current = true;
      window.history.pushState({ [MARKER]: true }, '');
    } else if (!isOpen && pushedRef.current) {
      pushedRef.current = false;
      // Closed via some in-app action rather than a back gesture — consume
      // the history entry we pushed so it doesn't linger.
      if (window.history.state?.[MARKER]) {
        window.history.back();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    const handlePopState = () => {
      if (pushedRef.current) {
        pushedRef.current = false;
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
}
