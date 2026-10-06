import { useEffect, useState } from 'react';

/**
 * Tracks whether the viewport is at least `minWidth` CSS pixels wide.
 *
 * Width rather than orientation, because the two are not interchangeable on a
 * foldable: a book-style phone can be taller than it is wide both folded and
 * unfolded, so an orientation test reads the same in either state and cannot
 * tell a narrow screen from a wide one.
 *
 * Backed by a media query, so it only re-renders when the threshold is actually
 * crossed instead of on every resize frame while a device is being unfolded.
 */
export function useIsViewportAtLeast(minWidth: number): boolean {
  const [isAtLeast, setIsAtLeast] = useState(() => (
    typeof window === 'undefined' ? false : window.innerWidth >= minWidth
  ));

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setIsAtLeast(query.matches);

    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [minWidth]);

  return isAtLeast;
}
