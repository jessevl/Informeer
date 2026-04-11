import { useEffect, useState } from 'react';

export function useIsLandscapeViewport(minWidth = 0): boolean {
  const getValue = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth > window.innerHeight && window.innerWidth >= minWidth;
  };

  const [isLandscape, setIsLandscape] = useState(getValue);

  useEffect(() => {
    const update = () => setIsLandscape(getValue());

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [minWidth]);

  return isLandscape;
}