/**
 * ReadingStatsStrip
 * Tiles for reading streak, yearly books goal, library total, and
 * highlights collected (when relevant). Responsive across mobile, tablet,
 * and desktop with tone-coloured icon chips.
 */

import type { LucideIcon } from 'lucide-react';
import { Flame, Library, Highlighter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { YearlyGoalTile } from './YearlyGoalTile';

type Tone = 'default' | 'warning' | 'accent' | 'info' | 'success';

interface ReadingStatsStripProps {
  streakDays: number;
  yearlyGoal: number;
  finishedThisYear: number;
  totalBooks: number;
  highlightsCount: number;
  onSetGoal: (n: number) => void;
}

export function ReadingStatsStrip({
  streakDays,
  yearlyGoal,
  finishedThisYear,
  totalBooks,
  highlightsCount,
  onSetGoal,
}: ReadingStatsStripProps) {
  const tiles: React.ReactNode[] = [];

  if (streakDays > 0) {
    tiles.push(
      <StatTile
        key="streak"
        icon={Flame}
        value={streakDays}
        label={streakDays === 1 ? 'day streak' : 'day streak'}
        tone="warning"
      />
    );
  }

  tiles.push(
    <YearlyGoalTile
      key="goal"
      finished={finishedThisYear}
      goal={yearlyGoal}
      onSetGoal={onSetGoal}
    />
  );

  tiles.push(
    <StatTile
      key="library"
      icon={Library}
      value={totalBooks}
      label={totalBooks === 1 ? 'book' : 'books'}
      tone="info"
    />
  );

  if (highlightsCount > 0) {
    tiles.push(
      <StatTile
        key="highlights"
        icon={Highlighter}
        value={highlightsCount}
        label={highlightsCount === 1 ? 'highlight' : 'highlights'}
        tone="success"
      />
    );
  }

  if (tiles.length === 0) return null;

  return (
    <section className="px-4 sm:px-6 pt-1 pb-3">
      <div
        className={cn(
          'grid gap-3 sm:gap-4',
          // Mobile: 2-up. Tablet: spread across the row evenly.
          'grid-cols-2',
          tiles.length === 2 && 'sm:grid-cols-2',
          tiles.length === 3 && 'sm:grid-cols-3',
          tiles.length === 4 && 'sm:grid-cols-4'
        )}
      >
        {tiles}
      </div>
    </section>
  );
}

const TONE_STYLES: Record<Tone, { chip: string; halo: string }> = {
  default: {
    chip: 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-fg)]',
    halo: 'from-[var(--color-accent-subtle)]/40',
  },
  warning: {
    chip: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    halo: 'from-amber-500/15',
  },
  accent: {
    chip: 'bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)]',
    halo: 'from-[var(--color-accent-muted)]/40',
  },
  info: {
    chip: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
    halo: 'from-sky-500/15',
  },
  success: {
    chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    halo: 'from-emerald-500/15',
  },
};

function StatTile({
  icon: Icon,
  value,
  label,
  tone = 'default',
}: {
  icon: LucideIcon;
  value: number | string;
  label: string;
  tone?: Tone;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div
      className={cn(
        'relative overflow-hidden flex items-center gap-3 sm:gap-4',
        'p-3 sm:p-4 rounded-2xl',
        'bg-[var(--color-surface-secondary)]',
        'border border-[var(--color-border-default)]',
        'hover:border-[var(--color-border-emphasis)] transition-colors'
      )}
    >
      <div
        aria-hidden
        className={cn(
          'absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-70 pointer-events-none',
          'bg-gradient-to-br to-transparent',
          styles.halo
        )}
      />
      <span
        className={cn(
          'shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center',
          styles.chip
        )}
      >
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-2xl sm:text-[1.6rem] font-semibold text-[var(--color-text-primary)] tabular-nums leading-none tracking-tight">
          {value}
        </span>
        <span className="text-[11px] sm:text-xs text-[var(--color-text-tertiary)] mt-1.5 truncate">
          {label}
        </span>
      </span>
    </div>
  );
}
