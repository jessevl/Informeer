/**
 * SyncPositionToast — "Continue from another device" notification
 *
 * A subtle, non-blocking toast similar to Kindle's Whispersync prompt.
 * Shows when the server has a further reading position from another device.
 * User can tap to jump or swipe/dismiss.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { MonitorSmartphone } from 'lucide-react';
import type { ProgressPosition } from '@/hooks/useRemoteProgressSync';

interface SyncPositionToastProps {
  visible: boolean;
  position: ProgressPosition | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export function SyncPositionToast({
  visible,
  position,
  onAccept,
  onDismiss,
}: SyncPositionToastProps) {
  // Animate in/out with a slight delay
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => setShow(true), 100);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [visible]);

  if (!visible && !show) return null;

  return (
    <div
      className={cn(
        'absolute bottom-20 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-2.5',
        'pl-3 pr-1.5 py-1.5 rounded-full',
        'bg-[var(--color-surface-primary)]/95 backdrop-blur-md',
        'border border-[var(--color-accent)]/30',
        'shadow-lg shadow-black/20',
        'transition-all duration-300 ease-out',
        'reader-overlay-surface',
        show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      )}
    >
      <MonitorSmartphone size={14} className="text-[var(--color-accent)] flex-shrink-0" />
      <button
        onClick={onAccept}
        className={cn(
          'text-xs text-[var(--color-text-primary)]',
          'hover:text-[var(--color-accent)] transition-colors',
          'whitespace-nowrap',
        )}
      >
        Continue at {position?.label}
        <span className="ml-1 text-[var(--color-text-tertiary)]">from another device</span>
      </button>
      <button
        onClick={onDismiss}
        className={cn(
          'text-[10px] text-[var(--color-text-tertiary)]',
          'hover:text-[var(--color-text-secondary)]',
          'px-2 py-1 rounded-full',
          'hover:bg-[var(--color-surface-hover)] transition-colors',
        )}
      >
        ✕
      </button>
    </div>
  );
}
