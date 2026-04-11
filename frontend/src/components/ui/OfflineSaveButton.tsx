/**
 * OfflineSaveButton
 *
 * Small icon button for saving/removing offline content.
 * Used on grid covers (books, magazines).
 */

import { cn } from '@/lib/utils';
import { CloudOff, Check, Loader2 } from 'lucide-react';

interface OfflineSaveButtonProps {
  saved: boolean;
  saving: boolean;
  onToggle: () => void;
  /** Position style — default top-left over a cover */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export function OfflineSaveButton({
  saved,
  saving,
  onToggle,
  className,
  size = 'sm',
}: OfflineSaveButtonProps) {
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      disabled={saving}
      className={cn(
        'flex items-center justify-center rounded-full backdrop-blur-sm transition-all',
        size === 'sm' ? 'w-6 h-6' : 'w-7 h-7',
        saved
          ? 'bg-emerald-500/80 text-white hover:bg-emerald-600/90'
          : 'bg-black/40 text-white hover:bg-black/60',
        'opacity-0 group-hover:opacity-100',
        // Always show if saved (so user can see which are cached)
        saved && 'opacity-100',
        className,
      )}
      title={saved ? 'Remove offline copy' : 'Save for offline'}
    >
      {saving ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : saved ? (
        <Check size={iconSize} />
      ) : (
        <CloudOff size={iconSize} />
      )}
    </button>
  );
}

/**
 * Small badge shown on covers that are saved offline.
 * Non-interactive — just a visual indicator.
 */
export function OfflineBadge({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'absolute bottom-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded',
        'bg-emerald-500/80 text-white text-[9px] font-medium',
        'pointer-events-none backdrop-blur-sm',
        className,
      )}
    >
      <Check size={8} />
      Saved
    </div>
  );
}
