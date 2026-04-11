/**
 * Masonry Virtualizer Core
 * Based on @tanstack/virtual with colSpan support for multi-column items
 * 
 * Key modification: Items can now span multiple columns via getItemColSpan option
 */

import { approxEqual, debounce, memo, notUndefined } from './utils';

export * from './utils';

type ScrollDirection = 'forward' | 'backward';
type ScrollAlignment = 'start' | 'center' | 'end' | 'auto';
type ScrollBehavior = 'auto' | 'smooth';

export interface ScrollToOptions {
  align?: ScrollAlignment;
  behavior?: ScrollBehavior;
}

type ScrollToOffsetOptions = ScrollToOptions;
type ScrollToIndexOptions = ScrollToOptions;

export interface Range {
  startIndex: number;
  endIndex: number;
  overscan: number;
  count: number;
}

type Key = number | string | bigint;

export interface VirtualItem {
  key: Key;
  index: number;
  start: number;
  end: number;
  size: number;
  lane: number;
  /** Number of lanes this item spans (1 = normal, 2+ = wide) */
  colSpan: number;
}

export interface Rect {
  width: number;
  height: number;
}

const getRect = (element: HTMLElement): Rect => {
  const { offsetWidth, offsetHeight } = element;
  return { width: offsetWidth, height: offsetHeight };
};

export const defaultKeyExtractor = (index: number) => index;

export const defaultRangeExtractor = (range: Range) => {
  const start = Math.max(range.startIndex - range.overscan, 0);
  const end = Math.min(range.endIndex + range.overscan, range.count - 1);

  const arr = [];
  for (let i = start; i <= end; i++) {
    arr.push(i);
  }
  return arr;
};

export const observeElementRect = <T extends Element>(
  instance: Virtualizer<T, any>,
  cb: (rect: Rect) => void
) => {
  const element = instance.scrollElement;
  if (!element) return;
  const targetWindow = instance.targetWindow;
  if (!targetWindow) return;

  const handler = (rect: Rect) => {
    const { width, height } = rect;
    cb({ width: Math.round(width), height: Math.round(height) });
  };

  handler(getRect(element as unknown as HTMLElement));

  if (!targetWindow.ResizeObserver) {
    return () => {};
  }

  const observer = new targetWindow.ResizeObserver((entries) => {
    const run = () => {
      const entry = entries[0];
      if (entry?.borderBoxSize) {
        const box = entry.borderBoxSize[0];
        if (box) {
          handler({ width: box.inlineSize, height: box.blockSize });
          return;
        }
      }
      handler(getRect(element as unknown as HTMLElement));
    };

    instance.options.useAnimationFrameWithResizeObserver ? requestAnimationFrame(run) : run();
  });

  observer.observe(element, { box: 'border-box' });

  return () => {
    observer.unobserve(element);
  };
};

const addEventListenerOptions = { passive: true };

export const observeWindowRect = (
  instance: Virtualizer<Window, any>,
  cb: (rect: Rect) => void
) => {
  const element = instance.scrollElement;
  if (!element) return;

  const handler = () => {
    cb({ width: element.innerWidth, height: element.innerHeight });
  };
  handler();

  element.addEventListener('resize', handler, addEventListenerOptions);

  return () => {
    element.removeEventListener('resize', handler);
  };
};

const supportsScrollend = typeof window == 'undefined' ? true : 'onscrollend' in window;

type ObserveOffsetCallBack = (offset: number, isScrolling: boolean) => void;

export const observeElementOffset = <T extends Element>(
  instance: Virtualizer<T, any>,
  cb: ObserveOffsetCallBack
) => {
  const element = instance.scrollElement;
  if (!element) return;
  const targetWindow = instance.targetWindow;
  if (!targetWindow) return;

  let offset = 0;
  const fallback =
    instance.options.useScrollendEvent && supportsScrollend
      ? () => undefined
      : debounce(targetWindow, () => { cb(offset, false); }, instance.options.isScrollingResetDelay);

  const createHandler = (isScrolling: boolean) => () => {
    const { horizontal, isRtl } = instance.options;
    offset = horizontal ? element['scrollLeft'] * ((isRtl && -1) || 1) : element['scrollTop'];
    fallback();
    cb(offset, isScrolling);
  };

  const handler = createHandler(true);
  const endHandler = createHandler(false);
  endHandler();

  element.addEventListener('scroll', handler, addEventListenerOptions);
  const registerScrollendEvent = instance.options.useScrollendEvent && supportsScrollend;
  if (registerScrollendEvent) {
    element.addEventListener('scrollend', endHandler, addEventListenerOptions);
  }

  return () => {
    element.removeEventListener('scroll', handler);
    if (registerScrollendEvent) {
      element.removeEventListener('scrollend', endHandler);
    }
  };
};

export const observeWindowOffset = (
  instance: Virtualizer<Window, any>,
  cb: ObserveOffsetCallBack
) => {
  const element = instance.scrollElement;
  if (!element) return;
  const targetWindow = instance.targetWindow;
  if (!targetWindow) return;

  let offset = 0;
  const fallback =
    instance.options.useScrollendEvent && supportsScrollend
      ? () => undefined
      : debounce(targetWindow, () => { cb(offset, false); }, instance.options.isScrollingResetDelay);

  const createHandler = (isScrolling: boolean) => () => {
    offset = element[instance.options.horizontal ? 'scrollX' : 'scrollY'];
    fallback();
    cb(offset, isScrolling);
  };

  const handler = createHandler(true);
  const endHandler = createHandler(false);
  endHandler();

  element.addEventListener('scroll', handler, addEventListenerOptions);
  const registerScrollendEvent = instance.options.useScrollendEvent && supportsScrollend;
  if (registerScrollendEvent) {
    element.addEventListener('scrollend', endHandler, addEventListenerOptions);
  }

  return () => {
    element.removeEventListener('scroll', handler);
    if (registerScrollendEvent) {
      element.removeEventListener('scrollend', endHandler);
    }
  };
};

export const measureElement = <TItemElement extends Element>(
  element: TItemElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<any, TItemElement>
) => {
  if (entry?.borderBoxSize) {
    const box = entry.borderBoxSize[0];
    if (box) {
      const size = Math.round(box[instance.options.horizontal ? 'inlineSize' : 'blockSize']);
      return size;
    }
  }

  return (element as unknown as HTMLElement)[
    instance.options.horizontal ? 'offsetWidth' : 'offsetHeight'
  ];
};

export const windowScroll = <T extends Window>(
  offset: number,
  { adjustments = 0, behavior }: { adjustments?: number; behavior?: ScrollBehavior },
  instance: Virtualizer<T, any>
) => {
  const toOffset = offset + adjustments;
  instance.scrollElement?.scrollTo?.({
    [instance.options.horizontal ? 'left' : 'top']: toOffset,
    behavior,
  });
};

export const elementScroll = <T extends Element>(
  offset: number,
  { adjustments = 0, behavior }: { adjustments?: number; behavior?: ScrollBehavior },
  instance: Virtualizer<T, any>
) => {
  const toOffset = offset + adjustments;
  instance.scrollElement?.scrollTo?.({
    [instance.options.horizontal ? 'left' : 'top']: toOffset,
    behavior,
  });
};

export interface VirtualizerOptions<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
> {
  count: number;
  getScrollElement: () => TScrollElement | null;
  estimateSize: (index: number, lanes: number) => number;
  scrollToFn: (
    offset: number,
    options: { adjustments?: number; behavior?: ScrollBehavior },
    instance: Virtualizer<TScrollElement, TItemElement>
  ) => void;
  observeElementRect: (
    instance: Virtualizer<TScrollElement, TItemElement>,
    cb: (rect: Rect) => void
  ) => void | (() => void);
  observeElementOffset: (
    instance: Virtualizer<TScrollElement, TItemElement>,
    cb: ObserveOffsetCallBack
  ) => void | (() => void);
  debug?: boolean;
  initialRect?: Rect;
  onChange?: (instance: Virtualizer<TScrollElement, TItemElement>, sync: boolean) => void;
  measureElement?: (
    element: TItemElement,
    entry: ResizeObserverEntry | undefined,
    instance: Virtualizer<TScrollElement, TItemElement>
  ) => number;
  overscan?: number;
  horizontal?: boolean;
  paddingStart?: number;
  paddingEnd?: number;
  scrollPaddingStart?: number;
  scrollPaddingEnd?: number;
  initialOffset?: number | (() => number);
  getItemKey?: (index: number) => Key;
  rangeExtractor?: (range: Range) => Array<number>;
  scrollMargin?: number;
  gap?: number;
  indexAttribute?: string;
  lanes?: number;
  isScrollingResetDelay?: number;
  useScrollendEvent?: boolean;
  enabled?: boolean;
  isRtl?: boolean;
  useAnimationFrameWithResizeObserver?: boolean;
  resizeDelay?: number;
  /** NEW: Get column span for an item (default: 1). Return 2+ for multi-column items. */
  getItemColSpan?: (index: number, lanes: number) => number;
}

type LaneCache = {
  measurements: Array<VirtualItem>;
  minPendingMeasuredIndex: number;
};

export class Virtualizer<TScrollElement extends Element | Window, TItemElement extends Element> {
  private unsubs: Array<void | (() => void)> = [];
  options!: Required<VirtualizerOptions<TScrollElement, TItemElement>>;
  scrollElement: TScrollElement | null = null;
  targetWindow: (Window & typeof globalThis) | null = null;
  isScrolling = false;
  measuredLanes = -1;
  private lanesCache: Array<LaneCache> = [];
  private itemSizeCache = new Map<Key, number>();
  scrollRect: Rect | null = null;
  scrollOffset: number | null = null;
  scrollDirection: ScrollDirection | null = null;
  private scrollAdjustments = 0;
  shouldAdjustScrollPositionOnItemSizeChange:
    | undefined
    | ((item: VirtualItem, delta: number, instance: Virtualizer<TScrollElement, TItemElement>) => boolean);
  elementsCache = new Map<Key, TItemElement>();

  private observer = (() => {
    let _ro: ResizeObserver | null = null;

    const get = () => {
      if (_ro) return _ro;
      if (!this.targetWindow || !this.targetWindow.ResizeObserver) return null;

      return (_ro = new this.targetWindow.ResizeObserver((entries) => {
        entries.forEach((entry) => {
          const run = () => {
            this._measureElement(entry.target as TItemElement, entry);
          };
          this.options.useAnimationFrameWithResizeObserver ? requestAnimationFrame(run) : run();
        });
      }));
    };

    return {
      disconnect: () => { get()?.disconnect(); _ro = null; },
      observe: (target: Element) => get()?.observe(target, { box: 'border-box' }),
      unobserve: (target: Element) => get()?.unobserve(target),
    };
  })();

  range: { startIndex: number; endIndex: number } | null = null;

  constructor(opts: VirtualizerOptions<TScrollElement, TItemElement>) {
    this.setOptions(opts);
  }

  setOptions = (opts: VirtualizerOptions<TScrollElement, TItemElement>) => {
    Object.entries(opts).forEach(([key, value]) => {
      if (typeof value === 'undefined') delete (opts as any)[key];
    });

    this.options = {
      debug: false,
      initialOffset: 0,
      overscan: 1,
      paddingStart: 0,
      paddingEnd: 0,
      scrollPaddingStart: 0,
      scrollPaddingEnd: 0,
      horizontal: false,
      getItemKey: defaultKeyExtractor,
      rangeExtractor: defaultRangeExtractor,
      onChange: () => {},
      measureElement,
      initialRect: { width: 0, height: 0 },
      scrollMargin: 0,
      gap: 0,
      indexAttribute: 'data-index',
      lanes: 1,
      isScrollingResetDelay: 150,
      enabled: true,
      isRtl: false,
      useScrollendEvent: false,
      useAnimationFrameWithResizeObserver: false,
      resizeDelay: 0,
      getItemColSpan: () => 1, // Default: no spanning
      ...opts,
    };
  };

  private notify = (sync: boolean) => {
    this.options.onChange?.(this, sync);
  };

  private debouncedNotify = memo(
    () => [this.targetWindow, this.options.resizeDelay],
    (targetWindow, resizeDelay) => {
      return targetWindow && resizeDelay > 0
        ? debounce(targetWindow, (sync: boolean) => this.notify(sync), resizeDelay)
        : this.notify.bind(this);
    },
    { key: false }
  );

  private maybeNotify = memo(
    () => {
      this.calculateRange();
      return [
        this.isScrolling,
        this.range ? this.range.startIndex : null,
        this.range ? this.range.endIndex : null,
      ];
    },
    () => { this.notify(this.isScrolling); },
    {
      key: false,
      initialDeps: [this.isScrolling, this.range?.startIndex ?? null, this.range?.endIndex ?? null] as [boolean, number | null, number | null],
    }
  );

  private cleanup = () => {
    this.unsubs.filter(Boolean).forEach((d) => d!());
    this.unsubs = [];
    this.observer.disconnect();
    this.scrollElement = null;
    this.targetWindow = null;
  };

  _didMount = () => {
    return () => { this.cleanup(); };
  };

  _willUpdate = () => {
    const scrollElement = this.options.enabled ? this.options.getScrollElement() : null;

    if (this.scrollElement !== scrollElement) {
      this.cleanup();

      if (!scrollElement) {
        this.maybeNotify();
        return;
      }

      this.scrollElement = scrollElement;

      if (this.scrollElement && 'ownerDocument' in this.scrollElement) {
        this.targetWindow = this.scrollElement.ownerDocument.defaultView;
      } else {
        this.targetWindow = this.scrollElement?.window ?? null;
      }

      this.elementsCache.forEach((cached) => {
        this.observer.observe(cached);
      });

      this._scrollToOffset(this.getScrollOffset(), { adjustments: undefined, behavior: undefined });

      this.unsubs.push(
        this.options.observeElementRect(this, (rect) => {
          this.scrollRect = rect;
          this.maybeNotify();
        })
      );

      this.unsubs.push(
        this.options.observeElementOffset(this, (offset, isScrolling) => {
          this.scrollAdjustments = 0;
          this.scrollDirection = isScrolling
            ? this.getScrollOffset() < offset ? 'forward' : 'backward'
            : null;
          this.scrollOffset = offset;
          this.isScrolling = isScrolling;
          this.maybeNotify();
        })
      );
    }
  };

  private getSize = () => {
    if (!this.options.enabled) {
      this.scrollRect = null;
      return 0;
    }
    this.scrollRect = this.scrollRect ?? this.options.initialRect;
    return this.scrollRect[this.options.horizontal ? 'width' : 'height'];
  };

  private getScrollOffset = () => {
    if (!this.options.enabled) {
      this.scrollOffset = null;
      return 0;
    }
    this.scrollOffset =
      this.scrollOffset ??
      (typeof this.options.initialOffset === 'function'
        ? this.options.initialOffset()
        : this.options.initialOffset);
    return this.scrollOffset;
  };

  indexFromElement = (node: TItemElement) => {
    const attributeName = this.options.indexAttribute;
    const indexStr = node.getAttribute(attributeName);
    if (!indexStr) {
      console.warn(`Missing attribute name '${attributeName}={index}' on measured element.`);
      return -1;
    }
    return parseInt(indexStr, 10);
  };

  private _measureElement = (node: TItemElement, entry: ResizeObserverEntry | undefined) => {
    const index = this.indexFromElement(node);
    const laneCache = this.lanesCache[this.measuredLanes - 1];
    if (!laneCache) return;

    const item = laneCache.measurements[index];
    if (!item) return;

    const key = item.key;
    const prevNode = this.elementsCache.get(key);

    if (prevNode !== node) {
      if (prevNode) this.observer.unobserve(prevNode);
      this.observer.observe(node);
      this.elementsCache.set(key, node);
    }

    if (node.isConnected) {
      this.resizeItem(index, this.options.measureElement(node, entry, this));
    }
  };

  resizeItem = (index: number, size: number) => {
    const laneCache = this.lanesCache[this.measuredLanes - 1];
    if (!laneCache) return;

    const item = laneCache.measurements[index];
    if (!item) return;

    const itemSize = this.itemSizeCache.get(item.key) ?? item.size;
    const delta = size - itemSize;

    if (delta !== 0) {
      if (
        this.shouldAdjustScrollPositionOnItemSizeChange !== undefined
          ? this.shouldAdjustScrollPositionOnItemSizeChange(item, delta, this)
          : item.start < this.getScrollOffset() + this.scrollAdjustments
      ) {
        this._scrollToOffset(this.getScrollOffset(), {
          adjustments: (this.scrollAdjustments += delta),
          behavior: undefined,
        });
      }

      const prevMinIndex = laneCache.minPendingMeasuredIndex;
      laneCache.minPendingMeasuredIndex = prevMinIndex >= 0 ? Math.min(prevMinIndex, item.index) : item.index;

      this.itemSizeCache = new Map(this.itemSizeCache.set(item.key, size));
      this.debouncedNotify()(false);
    }
  };

  measureElement = (node: TItemElement | null | undefined) => {
    if (!node) {
      this.elementsCache.forEach((cached, key) => {
        if (!cached.isConnected) {
          this.observer.unobserve(cached);
          this.elementsCache.delete(key);
        }
      });
      return;
    }
    this._measureElement(node, undefined);
  };

  private getMeasurementOptions = memo(
    () => [
      this.options.count,
      this.options.paddingStart,
      this.options.scrollMargin,
      this.options.getItemKey,
      this.options.enabled,
      this.options.getItemColSpan,
    ],
    (count, paddingStart, scrollMargin, getItemKey, enabled, getItemColSpan) => {
      this.lanesCache.length = 0;
      return { count, paddingStart, scrollMargin, getItemKey, enabled, getItemColSpan };
    },
    { key: false }
  );

  /**
   * Get the furthest measurement in each lane up to the given index
   * Modified to handle colSpan - a spanning item occupies multiple lanes
   */
  private getFurthestMeasurement = (measurements: Array<VirtualItem>, index: number) => {
    const furthestMeasurementsFound = new Map<number, true>();
    const furthestMeasurements = new Map<number, VirtualItem>();

    for (let m = index - 1; m >= 0; m--) {
      const measurement = measurements[m]!;

      // For spanning items, check all lanes they occupy
      for (let l = 0; l < measurement.colSpan; l++) {
        const lane = measurement.lane + l;
        if (furthestMeasurementsFound.has(lane)) continue;

        const previousFurthestMeasurement = furthestMeasurements.get(lane);
        if (
          previousFurthestMeasurement == null ||
          measurement.end > previousFurthestMeasurement.end
        ) {
          furthestMeasurements.set(lane, measurement);
        } else if (measurement.end < previousFurthestMeasurement.end) {
          furthestMeasurementsFound.set(lane, true);
        }
      }

      if (furthestMeasurementsFound.size === this.measuredLanes) break;
    }

    return furthestMeasurements.size === this.measuredLanes
      ? Array.from(furthestMeasurements.values()).sort((a, b) => {
          if (a.end === b.end) return a.index - b.index;
          return a.end - b.end;
        })[0]
      : undefined;
  };

  private getPreviousMeasurement = (measurements: Array<VirtualItem>, current: VirtualItem) => {
    for (let m = current.index - 1; m >= 0; m--) {
      const previous = measurements[m]!;
      // Check if previous item occupies the same lane (including via colSpan)
      const prevLaneEnd = previous.lane + previous.colSpan - 1;
      if (current.lane >= previous.lane && current.lane <= prevLaneEnd) {
        return previous;
      }
    }
    return undefined;
  };

  /**
   * Core measurement function - MODIFIED FOR COLSPAN SUPPORT
   * 
   * For items with colSpan > 1:
   * - Find N adjacent lanes with the minimum combined height
   * - Place the item spanning those lanes
   * - All spanned lanes get their "end" position updated
   */
  private getMeasurements = memo(
    () => [this.getMeasurementOptions(), this.itemSizeCache, this.options.lanes],
    ({ count, paddingStart, scrollMargin, getItemKey, enabled, getItemColSpan }, itemSizeCache, lanes) => {
      this.measuredLanes = lanes;
      if (!enabled) {
        this.lanesCache.length = 0;
        this.itemSizeCache.clear();
        return [];
      }

      // Initialize lanes cache
      if (this.lanesCache.length < lanes) {
        for (let i = this.lanesCache.length; i < lanes; i++) {
          this.lanesCache.push({ measurements: [], minPendingMeasuredIndex: -1 });
        }
      }

      const laneCache = this.lanesCache[lanes - 1]!;
      const min = laneCache.minPendingMeasuredIndex > 0 ? laneCache.minPendingMeasuredIndex : 0;
      laneCache.minPendingMeasuredIndex = -1;

      const measurements = laneCache.measurements.slice(0, min);

      // Track the current end position of each lane
      const laneEnds: number[] = Array(lanes).fill(paddingStart + scrollMargin);

      // Initialize lane ends from existing measurements
      for (let i = 0; i < min; i++) {
        const item = measurements[i];
        if (item) {
          for (let l = 0; l < item.colSpan; l++) {
            const lane = item.lane + l;
            if (lane < lanes) {
              laneEnds[lane] = Math.max(laneEnds[lane], item.end + this.options.gap);
            }
          }
        }
      }

      for (let i = min; i < count; i++) {
        const key = getItemKey(i);
        const colSpan = Math.min(getItemColSpan(i, lanes), lanes); // Clamp to max lanes

        // Find the best starting lane for this item
        let bestLane = 0;
        let bestStart = Infinity;

        if (colSpan === 1) {
          // Simple case: find the shortest lane
          for (let l = 0; l < lanes; l++) {
            if (laneEnds[l] < bestStart) {
              bestStart = laneEnds[l];
              bestLane = l;
            }
          }
        } else {
          // Multi-column: find the best set of adjacent lanes
          // We need `colSpan` consecutive lanes with minimum max height
          for (let startLane = 0; startLane <= lanes - colSpan; startLane++) {
            // Find the max end position among the lanes we'd span
            let maxEnd = 0;
            for (let l = 0; l < colSpan; l++) {
              maxEnd = Math.max(maxEnd, laneEnds[startLane + l]);
            }
            
            if (maxEnd < bestStart) {
              bestStart = maxEnd;
              bestLane = startLane;
            }
          }
        }

        const start = bestStart;
        const measuredSize = itemSizeCache.get(key);
        const size = typeof measuredSize === 'number' ? measuredSize : this.options.estimateSize(i, lanes);
        const end = start + size;

        measurements[i] = {
          index: i,
          start,
          size,
          end,
          key,
          lane: bestLane,
          colSpan,
        };

        // Update all spanned lanes
        for (let l = 0; l < colSpan; l++) {
          laneEnds[bestLane + l] = end + this.options.gap;
        }
      }

      laneCache.measurements = measurements;
      return measurements;
    },
    { key: false }
  );

  calculateRange = memo(
    () => [this.getMeasurements(), this.getSize(), this.getScrollOffset(), this.measuredLanes],
    (measurements, outerSize, scrollOffset, lanes) => {
      return (this.range =
        measurements.length > 0 && outerSize > 0
          ? calculateRange({ measurements, outerSize, scrollOffset, lanes })
          : null);
    },
    { key: false }
  );

  getVirtualIndexes = memo(
    () => {
      let startIndex: number | null = null;
      let endIndex: number | null = null;
      const range = this.calculateRange();
      if (range) {
        startIndex = range.startIndex;
        endIndex = range.endIndex;
      }
      this.maybeNotify.updateDeps([this.isScrolling, startIndex, endIndex]);
      return [
        this.options.rangeExtractor,
        this.options.overscan,
        this.options.count,
        startIndex,
        endIndex,
      ];
    },
    (rangeExtractor, overscan, count, startIndex, endIndex) => {
      return startIndex === null || endIndex === null
        ? []
        : rangeExtractor({ startIndex, endIndex, overscan, count });
    },
    { key: false }
  );

  getVirtualItems = memo(
    () => [this.getVirtualIndexes(), this.getMeasurements()],
    (indexes, measurements) => {
      const virtualItems: Array<VirtualItem> = [];
      for (let k = 0, len = indexes.length; k < len; k++) {
        const i = indexes[k]!;
        const measurement = measurements[i]!;
        virtualItems.push(measurement);
      }
      return { virtualItems, lanes: this.measuredLanes };
    },
    { key: false }
  );

  getVirtualItemForOffset = (offset: number) => {
    const measurements = this.getMeasurements();
    if (measurements.length === 0) return undefined;
    return notUndefined(
      measurements[
        findNearestBinarySearch(
          0,
          measurements.length - 1,
          (index: number) => notUndefined(measurements[index]).start,
          offset
        )
      ]
    );
  };

  getOffsetForAlignment = (toOffset: number, align: ScrollAlignment, itemSize = 0) => {
    const size = this.getSize();
    const scrollOffset = this.getScrollOffset();

    if (align === 'auto') {
      align = toOffset >= scrollOffset + size ? 'end' : 'start';
    }

    if (align === 'center') {
      toOffset += (itemSize - size) / 2;
    } else if (align === 'end') {
      toOffset -= size;
    }

    const maxOffset = this.getTotalSize() + this.options.scrollMargin - size;
    return Math.max(Math.min(maxOffset, toOffset), 0);
  };

  getOffsetForIndex = (index: number, align: ScrollAlignment = 'auto') => {
    index = Math.max(0, Math.min(index, this.options.count - 1));
    const laneCache = this.lanesCache[this.measuredLanes - 1];
    if (!laneCache) return undefined;

    const item = laneCache.measurements[index];
    if (!item) return undefined;

    const size = this.getSize();
    const scrollOffset = this.getScrollOffset();

    if (align === 'auto') {
      if (item.end >= scrollOffset + size - this.options.scrollPaddingEnd) {
        align = 'end';
      } else if (item.start <= scrollOffset + this.options.scrollPaddingStart) {
        align = 'start';
      } else {
        return [scrollOffset, align] as const;
      }
    }

    const toOffset =
      align === 'end'
        ? item.end + this.options.scrollPaddingEnd
        : item.start - this.options.scrollPaddingStart;

    return [this.getOffsetForAlignment(toOffset, align, item.size), align] as const;
  };

  private isDynamicMode = () => this.elementsCache.size > 0;

  scrollToOffset = (toOffset: number, { align = 'start', behavior }: ScrollToOffsetOptions = {}) => {
    if (behavior === 'smooth' && this.isDynamicMode()) {
      console.warn('The `smooth` scroll behavior is not fully supported with dynamic size.');
    }
    this._scrollToOffset(this.getOffsetForAlignment(toOffset, align), { adjustments: undefined, behavior });
  };

  scrollToIndex = (index: number, { align: initialAlign = 'auto', behavior }: ScrollToIndexOptions = {}) => {
    if (behavior === 'smooth' && this.isDynamicMode()) {
      console.warn('The `smooth` scroll behavior is not fully supported with dynamic size.');
    }

    index = Math.max(0, Math.min(index, this.options.count - 1));

    let attempts = 0;
    const maxAttempts = 10;

    const tryScroll = (currentAlign: ScrollAlignment) => {
      if (!this.targetWindow) return;

      const offsetInfo = this.getOffsetForIndex(index, currentAlign);
      if (!offsetInfo) {
        console.warn('Failed to get offset for index:', index);
        return;
      }

      const [offset, align] = offsetInfo;
      this._scrollToOffset(offset, { adjustments: undefined, behavior });

      this.targetWindow.requestAnimationFrame(() => {
        const currentOffset = this.getScrollOffset();
        const afterInfo = this.getOffsetForIndex(index, align);
        if (!afterInfo) {
          console.warn('Failed to get offset for index:', index);
          return;
        }

        if (!approxEqual(afterInfo[0], currentOffset)) {
          scheduleRetry(align);
        }
      });
    };

    const scheduleRetry = (align: ScrollAlignment) => {
      if (!this.targetWindow) return;
      attempts++;
      if (attempts < maxAttempts) {
        this.targetWindow.requestAnimationFrame(() => tryScroll(align));
      } else {
        console.warn(`Failed to scroll to index ${index} after ${maxAttempts} attempts.`);
      }
    };

    tryScroll(initialAlign);
  };

  scrollBy = (delta: number, { behavior }: ScrollToOffsetOptions = {}) => {
    if (behavior === 'smooth' && this.isDynamicMode()) {
      console.warn('The `smooth` scroll behavior is not fully supported with dynamic size.');
    }
    this._scrollToOffset(this.getScrollOffset() + delta, { adjustments: undefined, behavior });
  };

  getTotalSize = () => {
    const measurements = this.getMeasurements();
    let end: number;

    if (measurements.length === 0) {
      end = this.options.paddingStart;
    } else if (this.measuredLanes === 1) {
      end = measurements[measurements.length - 1]?.end ?? 0;
    } else {
      // Find max end across all lanes, accounting for colSpan
      const endByLane = Array<number | null>(this.measuredLanes).fill(null);
      let endIndex = measurements.length - 1;

      while (endIndex >= 0 && endByLane.some((val) => val === null)) {
        const item = measurements[endIndex]!;
        // Update all lanes this item spans
        for (let l = 0; l < item.colSpan; l++) {
          const lane = item.lane + l;
          if (lane < this.measuredLanes && endByLane[lane] === null) {
            endByLane[lane] = item.end;
          }
        }
        endIndex--;
      }

      end = Math.max(...endByLane.filter((val): val is number => val !== null));
    }

    return Math.max(end - this.options.scrollMargin + this.options.paddingEnd, 0);
  };

  private _scrollToOffset = (
    offset: number,
    { adjustments, behavior }: { adjustments: number | undefined; behavior: ScrollBehavior | undefined }
  ) => {
    this.options.scrollToFn(offset, { behavior, adjustments }, this);
  };

  measure = () => {
    this.itemSizeCache = new Map();
    this.notify(false);
  };
}

const findNearestBinarySearch = (
  low: number,
  high: number,
  getCurrentValue: (i: number) => number,
  value: number
) => {
  while (low <= high) {
    const middle = ((low + high) / 2) | 0;
    const currentValue = getCurrentValue(middle);

    if (currentValue < value) {
      low = middle + 1;
    } else if (currentValue > value) {
      high = middle - 1;
    } else {
      return middle;
    }
  }

  if (low > 0) {
    return low - 1;
  } else {
    return 0;
  }
};

function calculateRange({
  measurements,
  outerSize,
  scrollOffset,
  lanes,
}: {
  measurements: Array<VirtualItem>;
  outerSize: number;
  scrollOffset: number;
  lanes: number;
}) {
  const lastIndex = measurements.length - 1;
  const getOffset = (index: number) => measurements[index]!.start;

  if (measurements.length <= lanes) {
    return { startIndex: 0, endIndex: lastIndex };
  }

  let startIndex = findNearestBinarySearch(0, lastIndex, getOffset, scrollOffset);
  let endIndex = startIndex;

  if (lanes === 1) {
    while (endIndex < lastIndex && measurements[endIndex]!.end < scrollOffset + outerSize) {
      endIndex++;
    }
  } else if (lanes > 1) {
    const endPerLane = Array(lanes).fill(0);
    while (endIndex < lastIndex && endPerLane.some((pos) => pos < scrollOffset + outerSize)) {
      const item = measurements[endIndex]!;
      // Update all lanes this item spans
      for (let l = 0; l < item.colSpan; l++) {
        const lane = item.lane + l;
        if (lane < lanes) {
          endPerLane[lane] = item.end;
        }
      }
      endIndex++;
    }

    const startPerLane = Array(lanes).fill(scrollOffset + outerSize);
    while (startIndex >= 0 && startPerLane.some((pos) => pos >= scrollOffset)) {
      const item = measurements[startIndex]!;
      for (let l = 0; l < item.colSpan; l++) {
        const lane = item.lane + l;
        if (lane < lanes) {
          startPerLane[lane] = item.start;
        }
      }
      startIndex--;
    }

    startIndex = Math.max(0, startIndex - (startIndex % lanes));
    endIndex = Math.min(lastIndex, endIndex + (lanes - 1 - (endIndex % lanes)));
  }

  return { startIndex, endIndex };
}
