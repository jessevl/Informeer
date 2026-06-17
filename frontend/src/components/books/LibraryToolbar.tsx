/**
 * LibraryToolbar
 * Compact toolbar for the Books library section: search input, sort dropdown,
 * filter pills, and a result-count indicator. Sticks to the top of the scroll
 * container while the grid is scrolled.
 */

import { useEffect, useState } from 'react';
import {
  Search,
  X,
  ArrowUpDown,
  ChevronDown,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FILTER_OPTIONS,
  SORT_LABELS,
  type LibrarySortMode,
  type LibraryFilterMode,
} from './libraryFilters';

export type { LibrarySortMode, LibraryFilterMode };

interface LibraryToolbarProps {
  search: string;
  onSearchChange: (s: string) => void;
  sortBy: LibrarySortMode;
  onSortChange: (s: LibrarySortMode) => void;
  filterBy: LibraryFilterMode;
  onFilterChange: (f: LibraryFilterMode) => void;
  isOffline: boolean;
  filteredCount: number;
  totalCount: number;
}

export function LibraryToolbar({
  search,
  onSearchChange,
  sortBy,
  onSortChange,
  filterBy,
  onFilterChange,
  isOffline,
  filteredCount,
  totalCount,
}: LibraryToolbarProps) {
  const showCount =
    search.trim() !== '' || (filterBy !== 'all' && !isOffline) || isOffline;

  return (
    <div className="sticky top-2 z-20 mx-4 sm:mx-6 mb-3">
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 sm:gap-2.5',
          'rounded-2xl border border-[var(--color-border-default)]',
          'bg-[var(--color-surface-secondary)]/92 backdrop-blur-md',
          'shadow-[0_4px_16px_-8px_rgba(0,0,0,0.18)]',
          'px-3 sm:px-3.5 py-2'
        )}
      >
        <SearchInput value={search} onChange={onSearchChange} />

        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <SortDropdown value={sortBy} onChange={onSortChange} />

          <div className="h-4 w-px bg-[var(--color-border-default)]" />

          <div className="flex items-center gap-1 flex-wrap">
            {FILTER_OPTIONS.map((opt) => {
              const isActive =
                filterBy === opt.value || (isOffline && opt.value === 'offline');
              const isDisabled = isOffline && opt.value !== 'offline';
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onFilterChange(opt.value)}
                  disabled={isDisabled}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-full transition-colors',
                    isActive
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)] font-medium'
                      : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                    isDisabled &&
                      'opacity-40 cursor-not-allowed hover:bg-transparent'
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {showCount && (
          <span className="ml-auto text-xs text-[var(--color-text-tertiary)] tabular-nums">
            {filteredCount === totalCount
              ? `${filteredCount} books`
              : `${filteredCount} of ${totalCount}`}
          </span>
        )}
      </div>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-[220px] sm:flex-shrink-0">
      <Search
        size={13}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search title or author…"
        className={cn(
          'w-full pl-7 pr-7 py-1.5 text-xs rounded-full',
          'bg-[var(--color-surface-inset)]/70 border border-[var(--color-border-default)]',
          'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
          'outline-none focus:border-[var(--color-accent-fg)] focus:ring-1 focus:ring-[var(--color-accent-fg)]/30',
          'transition-colors'
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className={cn(
            'absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded',
            'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]'
          )}
          aria-label="Clear search"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

function SortDropdown({
  value,
  onChange,
}: {
  value: LibrarySortMode;
  onChange: (v: LibrarySortMode) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full',
          'text-[var(--color-text-secondary)]',
          'hover:bg-[var(--color-surface-hover)] transition-colors'
        )}
      >
        <ArrowUpDown size={12} />
        <span className="hidden sm:inline">Sort:</span>
        <span className="font-medium text-[var(--color-text-primary)]">
          {SORT_LABELS[value]}
        </span>
        <ChevronDown
          size={12}
          className={cn(
            'transition-transform text-[var(--color-text-tertiary)]',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              'absolute top-full left-0 mt-1 z-50 min-w-[180px] py-1',
              'bg-[var(--color-surface-primary)]',
              'border border-[var(--color-border-default)]',
              'rounded-lg shadow-xl animate-fade-in'
            )}
          >
            {(Object.keys(SORT_LABELS) as LibrarySortMode[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-3 px-3 py-1.5 text-sm',
                  'text-[var(--color-text-secondary)]',
                  'hover:bg-[var(--color-surface-hover)]'
                )}
              >
                <span>{SORT_LABELS[key]}</span>
                {value === key && (
                  <Check
                    size={14}
                    className="text-[var(--color-accent-fg)]"
                  />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
