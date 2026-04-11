/**
 * Masonry Virtualizer with colSpan support
 * 
 * A virtualized masonry layout that supports multi-column spanning items.
 * Based on @tanstack/virtual with modifications for responsive masonry layouts.
 * 
 * Usage:
 * ```tsx
 * const virtualizer = useVirtualizer({
 *   count: items.length,
 *   getScrollElement: () => scrollRef.current,
 *   estimateSize: (index, lanes) => 300,
 *   lanes: 3,
 *   gap: 16,
 *   // NEW: Return colSpan for each item
 *   getItemColSpan: (index, lanes) => items[index].featured ? 2 : 1,
 * });
 * ```
 */

export { useVirtualizer, useWindowVirtualizer } from './hooks';
export { useBreakpoint, type BreakpointColumn } from './useBreakpoint';
export type { VirtualItem, VirtualizerOptions, Rect, Range, ScrollToOptions } from './core';
