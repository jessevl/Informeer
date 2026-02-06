/**
 * MediaProgressBar Component
 * Reusable progress bar for audio and video content
 */

import { cn } from '@/lib/utils';

interface MediaProgressBarProps {
  progress: number; // 0-100
  className?: string;
  color?: 'accent' | 'red';
}

export function MediaProgressBar({ 
  progress, 
  className,
  color = 'accent'
}: MediaProgressBarProps) {
  if (progress <= 0) return null;
  
  return (
    <div className={cn(
      "h-1 bg-black/30 rounded-full overflow-hidden",
      className
    )}>
      <div 
        className={cn(
          "h-full rounded-full transition-all",
          color === 'red' ? "bg-red-500" : "bg-[var(--color-accent-primary)]"
        )}
        style={{ width: `${Math.min(progress, 100)}%` }}
      />
    </div>
  );
}
