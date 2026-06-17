/**
 * SegmentedTabBar
 * Reusable glass-pill segmented control for switching between sub-views of
 * a page. Visually mirrors `glass-panel-nav` so it stacks naturally with
 * other floating chrome (UnifiedHeader actions, FloatingNavBar, etc.).
 *
 * Implements the WAI-ARIA tabs pattern:
 *   - role="tablist" container, role="tab" buttons, aria-selected
 *   - Roving tabindex (only the active tab is in the natural tab order)
 *   - ArrowLeft / ArrowRight to move focus + activate
 *   - Home / End to jump to the first / last tab
 *
 * Positioning (fixed-bottom, sticky, in-flow, etc.) is the caller's
 * concern — this component just renders the pill.
 */

import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SegmentedTab<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Optional trailing badge (e.g. a count). Hidden when undefined / 0. */
  badge?: string | number;
}

interface SegmentedTabBarProps<T extends string> {
  value: T;
  onChange: (tab: T) => void;
  tabs: ReadonlyArray<SegmentedTab<T>>;
  /** Screen reader label for the tablist. */
  ariaLabel?: string;
  className?: string;
}

export function SegmentedTabBar<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
  className,
}: SegmentedTabBarProps<T>) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  // When the active tab changes via keyboard navigation, move DOM focus
  // along with it. Skipped when focus is outside the tablist (so a parent
  // re-render doesn't yank focus away from elsewhere on the page).
  useEffect(() => {
    const idx = tabs.findIndex((t) => t.value === value);
    if (idx < 0) return;
    const el = buttonsRef.current[idx];
    if (el && document.activeElement?.closest('[role="tablist"]')) {
      el.focus();
    }
  }, [value, tabs]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const idx = tabs.findIndex((t) => t.value === value);
    if (idx < 0) return;

    let nextIdx: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
        nextIdx = (idx + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIdx = (idx - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIdx = 0;
        break;
      case 'End':
        nextIdx = tabs.length - 1;
        break;
      default:
        return;
    }
    if (nextIdx !== null && nextIdx !== idx) {
      e.preventDefault();
      onChange(tabs[nextIdx].value);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'glass-panel-nav flex items-center gap-0.5 p-1',
        'shadow-[0_6px_22px_-10px_rgba(0,0,0,0.22)]',
        className
      )}
    >
      {tabs.map((tab, idx) => {
        const Icon = tab.icon;
        const isActive = value === tab.value;
        const badge = tab.badge;
        const showBadge =
          badge !== undefined && badge !== '' && badge !== 0;

        return (
          <button
            key={tab.value}
            ref={(el) => {
              buttonsRef.current[idx] = el;
            }}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              'group/tab inline-flex items-center gap-1.5',
              'px-3 sm:px-3.5 py-1.5 rounded-full',
              'text-sm font-medium transition-all duration-200',
              isActive
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/10 dark:hover:bg-white/10'
            )}
          >
            {Icon && (
              <Icon
                size={14}
                strokeWidth={2}
                className={cn(
                  'transition-transform duration-200',
                  isActive && 'scale-[1.05]'
                )}
              />
            )}
            <span>{tab.label}</span>
            {showBadge && (
              <span
                className={cn(
                  'ml-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full tabular-nums leading-none',
                  isActive
                    ? 'bg-[var(--color-accent-fg)]/15 text-[var(--color-accent-fg)]'
                    : 'bg-[var(--color-surface-inset)] text-[var(--color-text-tertiary)]'
                )}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
