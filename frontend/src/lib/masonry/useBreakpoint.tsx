/**
 * Responsive breakpoint hook for masonry columns
 */

import { useState, useEffect, useCallback } from 'react';

export interface BreakpointColumn {
  name?: string;
  minWidth: number;
  nCol: number;
}

export interface UseBreakpointResult {
  currentBreakpoint: BreakpointColumn;
  breakpoints: BreakpointColumn[];
}

const DEFAULT_BREAKPOINTS: BreakpointColumn[] = [
  { name: 'mobile', minWidth: 0, nCol: 1 },
  { name: 'tablet', minWidth: 640, nCol: 2 },
  { name: 'desktop', minWidth: 1024, nCol: 3 },
  { name: 'wide', minWidth: 1280, nCol: 4 },
];

export function useBreakpoint(
  breakpoints: BreakpointColumn[] = DEFAULT_BREAKPOINTS
): UseBreakpointResult {
  const getBreakpoint = useCallback(() => {
    if (typeof window === 'undefined') {
      return breakpoints[0] || { minWidth: 0, nCol: 1 };
    }

    const width = window.innerWidth;
    
    // Sort breakpoints by minWidth descending and find the first that matches
    const sorted = [...breakpoints].sort((a, b) => b.minWidth - a.minWidth);
    const match = sorted.find((bp) => width >= bp.minWidth);
    
    return match || breakpoints[0] || { minWidth: 0, nCol: 1 };
  }, [breakpoints]);

  const [currentBreakpoint, setCurrentBreakpoint] = useState<BreakpointColumn>(getBreakpoint);

  useEffect(() => {
    const handleResize = () => {
      const newBreakpoint = getBreakpoint();
      setCurrentBreakpoint((prev) => {
        if (prev.nCol !== newBreakpoint.nCol || prev.minWidth !== newBreakpoint.minWidth) {
          return newBreakpoint;
        }
        return prev;
      });
    };

    // Set initial value
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getBreakpoint]);

  return {
    currentBreakpoint,
    breakpoints,
  };
}
