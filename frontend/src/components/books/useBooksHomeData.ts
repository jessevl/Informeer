/**
 * useBooksHomeData
 * Derives the Reading-tab data (hero, secondary in-progress, recently added)
 * and reading stats from the persisted client state.
 *
 * Purely a memoized selector — no backend calls.
 */

import { useMemo } from 'react';
import type { Book, BookProgress } from '@/types/api';
import { getBookPercentage } from './libraryFilters';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENTLY_ADDED_WINDOW_DAYS = 30;
const SHELF_LIMIT = 12;
const SECONDARY_IN_PROGRESS_LIMIT = 4;

interface UseBooksHomeDataArgs {
  books: Book[];
  progressCache: Record<number, BookProgress>;
  recentBookActivity: Record<number, string>;
  highlightsCount: number;
  yearlyBooksGoal: number;
}

export interface BooksHomeData {
  hero: Book | null;
  secondaryInProgress: Book[];
  recentlyAdded: Book[];
  stats: {
    streakDays: number;
    finishedThisYear: number;
    totalBooks: number;
    highlightsCount: number;
    yearlyBooksGoal: number;
  };
}

function toEpoch(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function startOfLocalDay(epoch: number): number {
  const d = new Date(epoch);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function computeStreak(activityDays: Set<number>): number {
  if (activityDays.size === 0) return 0;
  let cursor = startOfLocalDay(Date.now());
  // Grace: if today has no activity but yesterday does, start the count there.
  if (!activityDays.has(cursor)) {
    cursor -= DAY_MS;
    if (!activityDays.has(cursor)) return 0;
  }
  let streak = 0;
  while (activityDays.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

export function useBooksHomeData({
  books,
  progressCache,
  recentBookActivity,
  highlightsCount,
  yearlyBooksGoal,
}: UseBooksHomeDataArgs): BooksHomeData {
  return useMemo(() => {
    const getActivityTime = (book: Book) =>
      Math.max(
        toEpoch(recentBookActivity[book.id]),
        toEpoch(progressCache[book.id]?.updated_at)
      );

    const inProgress = books
      .filter((b) => {
        const pct = getBookPercentage(progressCache, b.id);
        return pct > 0 && pct < 1;
      })
      .sort((a, b) => getActivityTime(b) - getActivityTime(a));

    const hero = inProgress[0] ?? null;
    const secondaryInProgress = inProgress.slice(
      1,
      1 + SECONDARY_IN_PROGRESS_LIMIT
    );

    const now = Date.now();
    const recentlyAdded = books
      .filter(
        (b) =>
          now - new Date(b.created_at).getTime() <
          RECENTLY_ADDED_WINDOW_DAYS * DAY_MS
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, SHELF_LIMIT);

    const currentYear = new Date().getFullYear();
    const bookIds = new Set(books.map((b) => b.id));
    let finishedThisYear = 0;
    for (const [idStr, p] of Object.entries(progressCache)) {
      const id = Number(idStr);
      if (!bookIds.has(id)) continue;
      if ((p.percentage ?? 0) < 1) continue;
      const t = toEpoch(p.updated_at);
      if (t === 0) continue;
      if (new Date(t).getFullYear() !== currentYear) continue;
      finishedThisYear += 1;
    }

    const activityDays = new Set<number>();
    for (const iso of Object.values(recentBookActivity)) {
      const t = toEpoch(iso);
      if (t > 0) activityDays.add(startOfLocalDay(t));
    }
    for (const p of Object.values(progressCache)) {
      const t = toEpoch(p.updated_at);
      if (t > 0) activityDays.add(startOfLocalDay(t));
    }
    const streakDays = computeStreak(activityDays);

    return {
      hero,
      secondaryInProgress,
      recentlyAdded,
      stats: {
        streakDays,
        finishedThisYear,
        totalBooks: books.length,
        highlightsCount,
        yearlyBooksGoal,
      },
    };
  }, [books, progressCache, recentBookActivity, highlightsCount, yearlyBooksGoal]);
}
