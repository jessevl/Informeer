/**
 * back-stack
 *
 * Informeer is a single-route app: every "screen" (drill-down view, article
 * reader, PDF/EPUB reader, modal) is component state, not a URL. Without help
 * the browser therefore has exactly one history entry for the whole app, so
 * the very first Back — Android's back gesture, the desktop browser's Back
 * button, a mouse thumb button — leaves the page entirely and, in the
 * Capacitor shell, closes the app.
 *
 * This module fixes that by giving each open layer a real history entry of
 * its own. Opening a layer pushes an entry (same URL, a marker token in
 * `history.state`); Back pops it, which we translate into "close that layer";
 * closing the layer from the UI consumes its entry with `go(-1)` so the two
 * stacks never drift apart.
 *
 * Implementation notes:
 * - Entries are pushed through the router's own history rather than
 *   `window.history`, because TanStack Router owns `window.history` — it
 *   patches `pushState`/`replaceState`, coalesces writes in a microtask and
 *   tracks its own `__TSR_index`. Going through it keeps the router in sync;
 *   `flush()` after each push defeats the coalescing so N pushes really
 *   produce N entries.
 * - Pushes and pops are serialised through a small queue: `go()` only takes
 *   effect on the next popstate, so a push issued in the same tick would
 *   otherwise be swallowed by an in-flight pop.
 * - Each entry carries a unique token, so reconciliation is by identity, not
 *   by counting: whatever entry we land on, every layer stacked above it is
 *   closed. An entry whose token we no longer know (a reload that restored a
 *   deep position, or Forward back into a closed layer) is stepped out of,
 *   since its layer state is gone for good.
 *
 * See `@/hooks/useBackGestureClose` for the React-facing wrapper.
 */

/** Marker we store in `history.state` to recognise our own entries. */
const LAYER_KEY = '__informeerLayer';
/** Safety net in case a `go()` never produces a popstate. */
const POP_TIMEOUT_MS = 400;
/** Stops a pathological rewind loop from spinning forever. */
const MAX_AUTO_REWIND = 20;

/** The slice of TanStack's `RouterHistory` this module needs. */
export interface BackStackHistory {
  readonly location: { readonly href: string; readonly state: unknown };
  push(path: string, state?: any, opts?: { ignoreBlocker?: boolean }): void;
  go(delta: number, opts?: { ignoreBlocker?: boolean }): void;
  flush(): void;
  subscribe(listener: (...args: any[]) => void): () => void;
}

export interface BackGroup {
  /** How many back-steps this layer currently wants to own. */
  count: number;
  /** How many history entries we have actually pushed for it. */
  pushed: number;
  /** Called once per history entry that Back takes away from this layer. */
  onPop: () => void;
}

type LayerEntry = { token: number; group: BackGroup };
type Op = { kind: 'push'; group: BackGroup } | { kind: 'pop'; group: BackGroup };

let history: BackStackHistory | null = null;
/** Our synthetic entries, bottom-most first. */
let layers: LayerEntry[] = [];
let queue: Op[] = [];
let draining = false;
let awaitingPop = false;
let popTimer: ReturnType<typeof setTimeout> | null = null;
let autoRewinds = 0;
let nextToken = 1;

/**
 * The marker on the entry we are currently sitting on.
 *
 * Read from the router's location rather than `window.history.state`: on a
 * push the router notifies subscribers before it actually flushes the write,
 * so `window.history.state` is momentarily stale while the router's own
 * location is already correct.
 */
function currentToken(): number | null {
  const state = history?.location.state as Record<string, unknown> | undefined;
  const token = state?.[LAYER_KEY];
  return typeof token === 'number' ? token : null;
}

function rewindStaleEntry() {
  if (!history || autoRewinds >= MAX_AUTO_REWIND) return;
  autoRewinds += 1;
  history.go(-1, { ignoreBlocker: true });
}

function settlePop() {
  if (popTimer !== null) {
    clearTimeout(popTimer);
    popTimer = null;
  }
  awaitingPop = false;
}

function onHistoryChange() {
  const token = currentToken();

  if (token !== null && !layers.some((layer) => layer.token === token)) {
    // Either a reload parked us on an entry from a previous page load, or the
    // user pressed Forward back into a layer we can no longer restore. Either
    // way there is nothing to show for this entry, so step out of it.
    settlePop();
    rewindStaleEntry();
    return;
  }
  autoRewinds = 0;

  // Everything stacked above the entry we landed on is now closed.
  const keep = token === null ? 0 : layers.findIndex((layer) => layer.token === token) + 1;
  while (layers.length > keep) {
    const entry = layers.pop()!;
    entry.group.pushed -= 1;
    entry.group.onPop();
  }

  settlePop();
  drain();
}

function drain() {
  if (draining || awaitingPop || !history) return;
  draining = true;
  try {
    while (queue.length > 0 && !awaitingPop) {
      const op = queue.shift()!;

      if (op.kind === 'push') {
        // The layer may have closed again before we got here.
        if (op.group.pushed >= op.group.count) continue;
        const token = nextToken++;
        op.group.pushed += 1;
        layers.push({ token, group: op.group });
        history.push(history.location.href, { [LAYER_KEY]: token }, { ignoreBlocker: true });
        // Force the write out now; the router batches history writes in a
        // microtask and would otherwise collapse consecutive pushes into one.
        history.flush();
        continue;
      }

      const wanted = Math.min(op.group.pushed - op.group.count, layers.length);
      if (wanted <= 0) continue;
      // History can only be unwound from the top, so drop the top-most
      // entries and close any other layer that happens to sit above this one.
      for (let i = 0; i < wanted; i += 1) {
        const entry = layers.pop()!;
        entry.group.pushed -= 1;
        if (entry.group !== op.group) entry.group.onPop();
      }
      awaitingPop = true;
      popTimer = setTimeout(() => {
        popTimer = null;
        awaitingPop = false;
        drain();
      }, POP_TIMEOUT_MS);
      history.go(-wanted, { ignoreBlocker: true });
    }
  } finally {
    draining = false;
  }
}

function sync(group: BackGroup) {
  if (!history) return;
  if (group.count > group.pushed) {
    for (let i = group.pushed; i < group.count; i += 1) queue.push({ kind: 'push', group });
  } else if (group.count < group.pushed) {
    queue.push({ kind: 'pop', group });
  } else {
    return;
  }
  drain();
}

/** Wire the back stack to the router's history. Safe to call repeatedly. */
export function attachBackStack(next: BackStackHistory) {
  if (history) return;
  history = next;
  next.subscribe(onHistoryChange);
  // A reload can restore a position deep inside layers that no longer exist.
  if (currentToken() !== null) rewindStaleEntry();
}

export function createBackGroup(onPop: () => void): BackGroup {
  return { count: 0, pushed: 0, onPop };
}

/**
 * Declare how many back-steps a layer owns. `onPop` fires once per entry that
 * Back takes away, so a layer with its own stack can pass its length and
 * unwind one level per press.
 */
export function setBackGroupDepth(group: BackGroup, depth: number) {
  group.count = Number.isFinite(depth) ? Math.max(0, Math.trunc(depth)) : 0;
  sync(group);
}

/** The layer is gone (its component unmounted) — hand its entries back. */
export function releaseBackGroup(group: BackGroup) {
  setBackGroupDepth(group, 0);
}

/** Test-only: drop all module state so cases start from a clean slate. */
export function resetBackStack() {
  if (popTimer !== null) clearTimeout(popTimer);
  history = null;
  layers = [];
  queue = [];
  draining = false;
  awaitingPop = false;
  popTimer = null;
  autoRewinds = 0;
  nextToken = 1;
}
