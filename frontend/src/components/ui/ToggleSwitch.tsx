/**
 * ToggleSwitch Component
 * Reusable toggle switch matching the settings modal style.
 * Used in sidebar offline toggle, settings toggles, etc.
 */

import { cn } from '@/lib/utils';

interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function ToggleSwitch({ enabled, onChange, size = 'md', className }: ToggleSwitchProps) {
  const isSm = size === 'sm';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative rounded-full border transition-all duration-200 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-base)]',
        isSm ? 'w-8 h-[18px]' : 'w-11 h-6',
        enabled
          ? 'border-[var(--color-control-checked-border)] bg-[var(--color-control-checked-bg)]'
          : 'border-[var(--color-control-unchecked-border)] bg-[var(--color-control-unchecked-bg)]',
        className,
      )}
    >
      <span
        className={cn(
          'absolute rounded-full transition-transform duration-200',
          enabled
            ? 'bg-[var(--color-control-checked-fg)]'
            : 'bg-[var(--color-text-primary)]',
          isSm
            ? 'top-[2px] w-[14px] h-[14px]'
            : 'top-1 w-4 h-4',
          isSm
            ? (enabled ? 'left-[16px]' : 'left-[2px]')
            : (enabled ? 'left-6' : 'left-1'),
        )}
      />
    </button>
  );
}
