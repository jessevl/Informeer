/**
 * FilterBar Component
 * Reusable pill-style filter/sort bar used across Books, Podcasts, Magazines.
 * Visual style: small rounded pills, accent-muted highlight on active item.
 */

import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export interface FilterBarGroup<T extends string = string> {
  /** Optional leading icon for this group */
  icon?: LucideIcon;
  /** Pill options */
  options: { value: T; label: string; icon?: LucideIcon }[];
  /** Currently active value */
  value: T;
  /** Called when user clicks a pill */
  onChange: (value: T) => void;
}

interface FilterBarProps {
  groups: FilterBarGroup<any>[];
  /** Optional trailing element (e.g. count label) */
  trailing?: React.ReactNode;
  className?: string;
}

export function FilterBar({ groups, trailing, className }: FilterBarProps) {
  return (
    <div className={cn('flex items-center gap-2 px-6 pt-4 pb-1 flex-wrap', className)}>
      {groups.map((group, gi) => (
        <div key={gi} className="contents">
          {gi > 0 && (
            <div className="w-px h-4 bg-[var(--color-border-default)]" />
          )}
          <div className="flex items-center gap-1">
            {group.icon && (
              <group.icon size={12} className="text-[var(--color-text-tertiary)]" />
            )}
            {group.options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => group.onChange(opt.value)}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors',
                  group.value === opt.value
                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)] font-medium'
                    : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]',
                )}
              >
                {opt.icon && <opt.icon size={11} />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {trailing && (
        <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">
          {trailing}
        </span>
      )}
    </div>
  );
}
