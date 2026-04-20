/**
 * Shared tap-zone logic for all page-based readers.
 *
 * The viewport is split into three horizontal zones:
 *   Left  (0 – 30%)   → previous page
 *   Center (30 – 70%)  → toggle controls
 *   Right (70 – 100%)  → next page
 *
 * Every reader surface (ArticleReader, PDFViewer, EPUBReader) should
 * resolve taps through this function so the interaction model is
 * consistent regardless of the underlying rendering engine.
 */

export type TapZoneAction = 'prev' | 'next' | 'toggle';

/** Fraction of the viewport width that constitutes the edge tap zone. */
export const TAP_ZONE_EDGE_RATIO = 0.3;

/**
 * Determine which zone a tap falls into.
 *
 * @param clientX  The clientX of the tap/click event.
 * @param rect     The bounding rect of the tappable container.
 * @returns The action that should be taken for this tap position.
 */
export function getTapZoneAction(clientX: number, rect: { left: number; width: number }): TapZoneAction {
  if (rect.width <= 0) return 'toggle';

  const x = clientX - rect.left;
  const leftBoundary = rect.width * TAP_ZONE_EDGE_RATIO;
  const rightBoundary = rect.width * (1 - TAP_ZONE_EDGE_RATIO);

  if (x <= leftBoundary) return 'prev';
  if (x >= rightBoundary) return 'next';
  return 'toggle';
}
