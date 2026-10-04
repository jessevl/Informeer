/**
 * Runtime patches for epubjs 0.3.93 position bugs.
 *
 * epubjs' Mapping.splitTextNodeIntoRanges computes word offsets on the
 * *trimmed* text but applies them to the untrimmed node. For text nodes that
 * start with whitespace (very common: any text following an inline element,
 * e.g. `</em> and then…`), the page-start CFI reported by `relocated` points at
 * the whitespace *before* the first visible word — which sits at the end of
 * the previous page's last line.
 *
 * Restoring such a CFI then lands on the wrong page:
 * - WebKit measures the whitespace + next char, whose rect starts on the
 *   previous page → one page back. Every save/restore cycle can lose another
 *   page.
 * - Chromium measures a collapsed range (offset 0 in a whitespace-led node),
 *   whose rect is all zeros → jump to the start of the chapter.
 *
 * The fix is applied on the restore side (Contents.locationOf) so CFIs that
 * were already saved locally or on the server resolve correctly too: when a
 * CFI points at whitespace inside a text node, advance it to the first
 * non-whitespace character before measuring.
 */

import { Contents, EpubCFI } from 'epubjs';

let patched = false;

export function applyEpubjsPatches(): void {
  if (patched) return;
  patched = true;

  const proto = (Contents as any).prototype;
  const originalLocationOf = proto.locationOf;
  if (typeof originalLocationOf !== 'function') return;

  proto.locationOf = function patchedLocationOf(this: any, target: unknown, ignoreClass?: string) {
    const doc = this.document as Document | undefined;
    if (doc && typeof target === 'string' && target.startsWith('epubcfi(')) {
      try {
        const cfi = new EpubCFI(target) as any;
        const range = cfi.toRange(doc, ignoreClass) as Range | null;
        const node = range?.startContainer;
        if (range && node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent || '';
          let offset = range.startOffset;
          while (offset < text.length && /\s/.test(text[offset])) offset++;
          if (offset < text.length && offset !== range.startOffset) {
            const adjusted = doc.createRange();
            adjusted.setStart(node, offset);
            adjusted.setEnd(node, offset);
            target = new (EpubCFI as any)(adjusted, cfi.base, ignoreClass).toString();
          }
        }
      } catch {
        // Fall through to the original implementation with the untouched target.
      }
    }
    return originalLocationOf.call(this, target, ignoreClass);
  };
}
