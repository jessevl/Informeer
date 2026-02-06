/**
 * PullToRefreshIndicator Component
 * Displays a visual indicator during pull-to-refresh gesture.
 * Shows progress spinner that fills as user pulls, then spins during refresh.
 */

import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  isRefreshing: boolean;
  isPulling: boolean;
  progress: number;
}

export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  isPulling,
  progress,
}: PullToRefreshIndicatorProps) {
  if (!isPulling && !isRefreshing) return null;

  const rotation = isPulling ? progress * 270 : 0;
  const scale = Math.min(1, 0.5 + progress * 0.5);
  const opacity = Math.min(1, progress * 1.5);

  return (
    <div
      className="absolute left-0 right-0 z-30 flex items-center justify-center pointer-events-none"
      style={{
        top: 48, // Below the floating header
        height: pullDistance,
        transition: isPulling ? 'none' : 'height 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div
        className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center',
          'bg-[var(--color-surface-base)] shadow-lg border border-[var(--color-border-subtle)]',
          isRefreshing && 'animate-bounce-in'
        )}
        style={{
          opacity,
          transform: `scale(${scale})`,
          transition: isPulling ? 'none' : 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <RefreshCw
          size={16}
          className={cn(
            'text-[var(--color-accent-fg)]',
            isRefreshing && 'animate-spin'
          )}
          style={{
            transform: isRefreshing ? undefined : `rotate(${rotation}deg)`,
            transition: isPulling ? 'none' : 'transform 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
