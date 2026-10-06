/**
 * Shared tuning for follow-the-finger page drags.
 *
 * All three readers let the page track the pointer during a swipe and only
 * decide on release, rather than jumping once a distance threshold is crossed.
 *
 * The EPUB and article readers both stay stuck to the pointer 1:1, by different
 * means: the article reader drives `scrollLeft`, so the next page's real content
 * comes with it, while the EPUB reader translates its iframe and trails the page
 * colour in behind. Both take their commit thresholds from here.
 *
 * The PDF reader still damps its drag to `SWIPE_FOLLOW_DAMPING` and keeps its
 * own thresholds inside `useReaderGestures`, which it reaches through the
 * generic gesture hook.
 */

/**
 * Fraction of the pointer's travel applied by the PDF reader, which trades
 * tracking the finger exactly for keeping the empty gutter beside the page out
 * of view. The EPUB and article readers move 1:1 instead.
 */
export const SWIPE_FOLLOW_DAMPING = 0.4;

/** Resistance at the first/last page, where there is nothing to turn to. */
export const SWIPE_FOLLOW_EDGE_DAMPING = 0.2;

/** Travel that commits a page turn on release, for a slow, deliberate drag. */
export const SWIPE_COMMIT_DISTANCE_PX = 96;

/** A flick commits on velocity, so it needs far less distance. */
export const SWIPE_FLICK_MIN_DISTANCE_PX = 60;
export const SWIPE_FLICK_MIN_VELOCITY = 0.5;

/** Past this, a drag is treated as deliberate positioning rather than a swipe. */
export const SWIPE_MAX_DURATION_MS = 600;

/** Movement before a gesture is committed to the horizontal or vertical axis. */
export const SWIPE_AXIS_LOCK_PX = 8;

/** How long the page takes to ease to its resting position after release. */
export const SWIPE_SETTLE_MS = 220;

/**
 * Quiet period that ends a trackpad gesture. A trackpad has no touch-end, so
 * the page settles once wheel events stop arriving. Long enough to ride out the
 * gaps between events in a momentum tail, short enough to feel immediate.
 */
export const WHEEL_GESTURE_END_MS = 120;

/** Whether a gesture is horizontal enough to be a page swipe rather than a scroll. */
export function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy) * 1.2;
}

/** A fast, short gesture: always turns one page, in its own direction. */
export function isSwipeFlick(dx: number, durationMs: number): boolean {
  const absDx = Math.abs(dx);
  return absDx / Math.max(durationMs, 1) > SWIPE_FLICK_MIN_VELOCITY
    && absDx > SWIPE_FLICK_MIN_DISTANCE_PX;
}

/**
 * Whether a released gesture should turn the page when the page gave no live
 * feedback — the E-ink paths, where a swipe is either recognised or ignored.
 * The duration cap keeps a slow drag from reading as a swipe, since the reader
 * had no way to show it was being tracked.
 */
export function shouldCommitSwipe(dx: number, durationMs: number): boolean {
  return isSwipeFlick(dx, durationMs)
    || (Math.abs(dx) > SWIPE_COMMIT_DISTANCE_PX && durationMs < SWIPE_MAX_DURATION_MS);
}

/**
 * Whether a released follow-drag should turn the page. No duration cap here:
 * the page has been tracking the pointer the whole time, so a slow, deliberate
 * drag past the commit distance is as intentional as a flick — and on a
 * trackpad, where a momentum tail stretches one gesture over a second or more,
 * the cap would reject most real page turns.
 *
 * Used by the EPUB and PDF readers, which can only translate their current
 * page. The article reader moves real content and instead lands on whichever
 * page it ends up nearest.
 */
export function shouldCommitFollowSwipe(dx: number, durationMs: number): boolean {
  return isSwipeFlick(dx, durationMs) || Math.abs(dx) > SWIPE_COMMIT_DISTANCE_PX;
}
