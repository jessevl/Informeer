/**
 * BooksHomeSection
 * Section wrapper with a small header (title + optional count + optional action)
 * for the Books home view.
 */

import { cn } from '@/lib/utils';

interface BooksHomeSectionProps {
  title: string;
  count?: number | string;
  action?: { label: string; onClick: () => void };
  className?: string;
  headerClassName?: string;
  children: React.ReactNode;
}

export function BooksHomeSection({
  title,
  count,
  action,
  className,
  headerClassName,
  children,
}: BooksHomeSectionProps) {
  return (
    <section className={cn('pt-5 pb-1', className)}>
      <div
        className={cn(
          'px-6 mb-3 flex items-center justify-between gap-3',
          headerClassName
        )}
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text-primary)] truncate">
            {title}
          </h2>
          {count !== undefined && count !== '' && (
            <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums shrink-0">
              {count}
            </span>
          )}
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className="text-xs font-medium text-[var(--color-accent-fg)] hover:underline shrink-0"
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
