/**
 * ViewTransition Component
 * Provides smooth cross-fade + subtle slide transitions when switching between views.
 * Uses a key-based approach: when the transitionKey changes, the old content fades out
 * and new content fades in with a slight vertical shift.
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ViewTransitionProps {
  /** Key that triggers a transition when it changes */
  transitionKey: string;
  /** The content to render */
  children: React.ReactNode;
  /** Additional className for the wrapper */
  className?: string;
  /** Duration in ms (default: 200) */
  duration?: number;
}

export function ViewTransition({
  transitionKey,
  children,
  className,
  duration = 200,
}: ViewTransitionProps) {
  const [displayedChildren, setDisplayedChildren] = useState(children);
  const [phase, setPhase] = useState<'idle' | 'exit' | 'enter'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  const prevKeyRef = useRef(transitionKey);
  // Refs to avoid stale closures in setTimeout callbacks
  const latestChildrenRef = useRef(children);
  const latestKeyRef = useRef(transitionKey);

  // Always keep refs up to date with the latest props
  latestChildrenRef.current = children;
  latestKeyRef.current = transitionKey;

  useEffect(() => {
    // Skip animation on first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevKeyRef.current = transitionKey;
      setDisplayedChildren(children);
      return;
    }

    if (transitionKey !== prevKeyRef.current) {
      // Key changed — start transition
      prevKeyRef.current = transitionKey;

      // Clear any pending transitions
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      // Phase 1: exit (fade out current content)
      setPhase('exit');

      timeoutRef.current = setTimeout(() => {
        // Phase 2: swap to the LATEST children (read from ref, not closure)
        setDisplayedChildren(latestChildrenRef.current);
        setPhase('enter');

        timeoutRef.current = setTimeout(() => {
          setPhase('idle');
        }, duration);
      }, duration * 0.6);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [transitionKey, duration]);

  // Update children without animation when the key stays the same
  useEffect(() => {
    if (transitionKey === prevKeyRef.current && phase === 'idle') {
      setDisplayedChildren(children);
    }
  }, [children, transitionKey, phase]);

  return (
    <div
      className={cn('w-full h-full', className)}
      style={{
        opacity: phase === 'exit' ? 0 : 1,
        transform: phase === 'exit'
          ? 'translateY(-4px)'
          : phase === 'enter'
            ? 'translateY(0)'
            : undefined,
        transition: phase !== 'idle'
          ? `opacity ${duration * 0.6}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
          : 'none',
        willChange: phase !== 'idle' ? 'opacity, transform' : undefined,
      }}
    >
      {displayedChildren}
    </div>
  );
}
