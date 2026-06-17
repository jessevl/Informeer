/**
 * YearlyGoalTile
 * Stat tile for the yearly books-read goal with an SVG progress ring and
 * an inline editor popover for adjusting the target.
 */

import { useEffect, useRef, useState } from 'react';
import { Target, Check, X, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

interface YearlyGoalTileProps {
  finished: number;
  goal: number;
  onSetGoal: (n: number) => void;
}

export function YearlyGoalTile({
  finished,
  goal,
  onSetGoal,
}: YearlyGoalTileProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(goal || 12));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(String(goal || 12));
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, goal]);

  const commit = () => {
    const n = Number.parseInt(draft, 10);
    if (Number.isFinite(n) && n > 0) {
      onSetGoal(n);
    }
    setOpen(false);
  };

  const cancel = () => setOpen(false);

  // Empty / unconfigured state
  if (!goal || goal <= 0) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl text-left',
            'bg-[var(--color-surface-secondary)]',
            'border border-dashed border-[var(--color-border-default)]',
            'hover:border-[var(--color-border-emphasis)] transition-colors'
          )}
        >
          <span
            className={cn(
              'shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center',
              'bg-[var(--color-accent-subtle)] text-[var(--color-accent-fg)]'
            )}
          >
            <Target size={20} strokeWidth={1.75} />
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-[var(--color-text-primary)] leading-tight">
              Set a yearly goal
            </span>
            <span className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
              Books to finish this year
            </span>
          </span>
        </button>
        {open && (
          <GoalEditor
            inputRef={inputRef}
            draft={draft}
            setDraft={setDraft}
            onCommit={commit}
            onCancel={cancel}
          />
        )}
      </div>
    );
  }

  const pct = Math.max(0, Math.min(1, finished / goal));
  const radius = 18;
  const stroke = 4;
  const c = 2 * Math.PI * radius;
  const offset = c * (1 - pct);
  const size = (radius + stroke) * 2;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'group relative overflow-hidden w-full flex items-center gap-3 sm:gap-4',
          'p-3 sm:p-4 rounded-2xl text-left',
          'bg-[var(--color-surface-secondary)]',
          'border border-[var(--color-border-default)]',
          'hover:border-[var(--color-border-emphasis)] transition-colors'
        )}
      >
        <div
          aria-hidden
          className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-70 pointer-events-none bg-gradient-to-br from-[var(--color-accent-muted)]/40 to-transparent"
        />
        <span
          className="relative shrink-0 flex items-center justify-center"
          style={{ width: size, height: size }}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="var(--color-surface-inset)"
              strokeWidth={stroke}
              fill="none"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="var(--color-accent-fg)"
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={c}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{
                transition:
                  'stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          </svg>
          <Pencil
            size={11}
            className={cn(
              'absolute text-[var(--color-text-tertiary)]',
              'opacity-0 group-hover:opacity-100 transition-opacity'
            )}
          />
        </span>
        <span className="flex flex-col min-w-0 relative">
          <span className="text-2xl sm:text-[1.6rem] font-semibold text-[var(--color-text-primary)] tabular-nums leading-none tracking-tight">
            {finished}
            <span className="text-[var(--color-text-tertiary)] font-normal text-sm sm:text-base">
              {' '}/ {goal}
            </span>
          </span>
          <span className="text-[11px] sm:text-xs text-[var(--color-text-tertiary)] mt-1.5">
            this year
          </span>
        </span>
      </button>
      {open && (
        <GoalEditor
          inputRef={inputRef}
          draft={draft}
          setDraft={setDraft}
          onCommit={commit}
          onCancel={cancel}
        />
      )}
    </div>
  );
}

function GoalEditor({
  inputRef,
  draft,
  setDraft,
  onCommit,
  onCancel,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  draft: string;
  setDraft: (s: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onCancel} />
      <div
        className={cn(
          'absolute top-full left-0 mt-2 z-50 min-w-[220px] p-3',
          'bg-[var(--color-surface-primary)] border border-[var(--color-border-default)]',
          'rounded-xl shadow-xl animate-fade-in'
        )}
      >
        <label className="block text-[11px] uppercase tracking-wider font-medium text-[var(--color-text-tertiary)] mb-1.5">
          Books per year
        </label>
        <input
          ref={inputRef}
          type="number"
          min={1}
          max={999}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit();
            } else if (e.key === 'Escape') {
              onCancel();
            }
          }}
          className={cn(
            'w-full px-2 py-1.5 text-sm rounded',
            'bg-[var(--color-surface-inset)] text-[var(--color-text-primary)]',
            'border border-[var(--color-border-default)]',
            'outline-none focus:ring-1 focus:ring-[var(--color-accent-fg)]'
          )}
        />
        <div className="flex items-center gap-1 mt-2">
          <button
            type="button"
            onClick={onCommit}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded font-medium',
              'bg-[var(--color-accent-fg)] text-[var(--color-surface-primary)]',
              'hover:opacity-90'
            )}
          >
            <Check size={12} />
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded',
              'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]'
            )}
          >
            <X size={12} />
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
