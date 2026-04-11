/**
 * System Section
 * Account, storage stats, offline content, maintenance, advanced server settings
 */

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  LogOut,
  RefreshCw,
  Trash2,
  Database,
  HardDrive,
  CloudOff,
  Loader2,
  Check,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useConnectivityStore } from '@/stores/connectivity';
import { getOfflineStats, clearAllOffline, pruneRecentOfflineItems } from '@/lib/offline/blob-cache';
import { useSettingsStore } from '@/stores/settings';
import { getSyncQueueLength, flushSyncQueue } from '@/lib/offline/sync-queue';
import {
  SectionHeader,
  Separator,
  Card,
  StatusMessage,
  SaveButton,
  Collapsible,
  ActionButton,
  ToggleRow,
  SliderRow,
  formatBytes,
  NumberInput,
} from '../ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServerStats {
  database: { size_bytes: number; entry_count: number; feed_count: number };
  cache: { covers_bytes: number; pdfs_bytes: number; total_bytes: number };
}

// ── Offline Content Sub-section ───────────────────────────────────────────────

const OfflineContent: React.FC = () => {
  const [offlineStats, setOfflineStats] = useState<{
    count: number;
    totalBytes: number;
    byType: Record<string, { count: number; bytes: number }>;
  } | null>(null);
  const [syncQueueLen, setSyncQueueLen] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const recentOfflineBooksLimit = useSettingsStore((s) => s.recentOfflineBooksLimit);
  const recentOfflineMagazinesLimit = useSettingsStore((s) => s.recentOfflineMagazinesLimit);
  const setRecentOfflineBooksLimit = useSettingsStore((s) => s.setRecentOfflineBooksLimit);
  const setRecentOfflineMagazinesLimit = useSettingsStore((s) => s.setRecentOfflineMagazinesLimit);

  const refresh = () => {
    setOfflineStats(getOfflineStats());
    setSyncQueueLen(getSyncQueueLength());
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pruneRecent() {
      await Promise.all([
        pruneRecentOfflineItems('book', recentOfflineBooksLimit),
        pruneRecentOfflineItems('magazine', recentOfflineMagazinesLimit),
      ]);

      if (!cancelled) {
        refresh();
      }
    }

    pruneRecent().catch((err) => {
      console.error('[offline] prune failed:', err);
    });

    return () => {
      cancelled = true;
    };
  }, [recentOfflineBooksLimit, recentOfflineMagazinesLimit]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await flushSyncQueue();
    } catch (e) {
      console.error('[offline] sync failed:', e);
    } finally {
      setIsSyncing(false);
      refresh();
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Remove all offline-saved content? This cannot be undone.')) return;
    setIsClearing(true);
    try {
      await clearAllOffline();
    } catch (e) {
      console.error('[offline] clear failed:', e);
    } finally {
      setIsClearing(false);
      refresh();
    }
  };

  const books = offlineStats?.byType['book'] ?? { count: 0, bytes: 0 };
  const magazines = offlineStats?.byType['magazine'] ?? { count: 0, bytes: 0 };
  const podcasts = offlineStats?.byType['podcast'] ?? { count: 0, bytes: 0 };

  return (
    <div className="space-y-2.5">
      {/* Compact 3-col summary */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Books', count: books.count, bytes: books.bytes },
          { label: 'Magazines', count: magazines.count, bytes: magazines.bytes },
          { label: 'Podcasts', count: podcasts.count, bytes: podcasts.bytes },
        ].map((item) => (
          <div key={item.label} className="bg-[var(--color-surface-secondary)] rounded-lg p-2.5 text-center">
            <p className="text-base font-semibold text-[var(--color-text-primary)]">{item.count}</p>
            <p className="text-[10px] text-[var(--color-text-tertiary)]">{item.label}</p>
            {item.bytes > 0 && (
              <p className="text-[10px] text-[var(--color-text-tertiary)]">{formatBytes(item.bytes)}</p>
            )}
          </div>
        ))}
      </div>

      {/* Total + sync status */}
      <div className="flex items-center justify-between text-xs px-1">
        <div className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
          <CloudOff size={12} />
          <span>Total: {formatBytes(offlineStats?.totalBytes ?? 0)}</span>
        </div>
        {syncQueueLen > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {syncQueueLen} pending
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <ActionButton
          onClick={handleSync}
          disabled={syncQueueLen === 0 || !isOnline}
          loading={isSyncing}
          icon={<RefreshCw size={13} />}
          label="Sync Now"
        />
        <ActionButton
          onClick={handleClearAll}
          disabled={(offlineStats?.count ?? 0) === 0}
          loading={isClearing}
          icon={<Trash2 size={13} />}
          label="Clear All"
          variant="danger"
        />
      </div>

      <div className="space-y-2 rounded-lg bg-[var(--color-surface-secondary)] p-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Automatic recent offline cache</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Recently opened books and magazines stay available offline by default. Set a limit to control how many auto-cached items are kept.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--color-text-primary)]">Books</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">0 disables automatic EPUB caching</p>
          </div>
          <NumberInput value={recentOfflineBooksLimit} min={0} max={50} onChange={setRecentOfflineBooksLimit} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--color-text-primary)]">Magazines</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">0 disables automatic PDF caching</p>
          </div>
          <NumberInput value={recentOfflineMagazinesLimit} min={0} max={20} onChange={setRecentOfflineMagazinesLimit} />
        </div>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const SystemSection: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [stats, setStats] = useState<ServerStats | null>(null);

  // Maintenance state
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cleanupDays, setCleanupDays] = useState(30);

  // Force fetch state
  const [isForceFetching, setIsForceFetching] = useState(false);
  const [forceFetchSuccess, setForceFetchSuccess] = useState(false);

  // Advanced server settings
  const [advancedLoaded, setAdvancedLoaded] = useState(false);
  const [advancedSaving, setAdvancedSaving] = useState(false);
  const [advancedSaveSuccess, setAdvancedSaveSuccess] = useState(false);
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  // Advanced: scheduler
  const [schedulerInterval, setSchedulerInterval] = useState(60);
  const [schedulerConcurrency, setSchedulerConcurrency] = useState(4);
  const [activeFeedInterval, setActiveFeedInterval] = useState(15);
  const [slowFeedInterval, setSlowFeedInterval] = useState(360);
  const [errorMaxBackoff, setErrorMaxBackoff] = useState(1440);
  // Advanced: crawler
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [requestDelayMs, setRequestDelayMs] = useState(500);
  const [maxContentLengthKb, setMaxContentLengthKb] = useState(512);
  // Advanced: database
  const [cacheMaxSizeMb, setCacheMaxSizeMb] = useState(500);
  const [vacuumOnCleanup, setVacuumOnCleanup] = useState(true);

  // ── Load stats + advanced settings ──────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [serverSettings, serverStats] = await Promise.all([
          api.getSettings(),
          api.getStats(),
        ]);
        setStats(serverStats as unknown as ServerStats);

        const s = serverSettings as any;
        // Scheduler
        if (s.scheduler?.interval_minutes != null) setSchedulerInterval(Number(s.scheduler.interval_minutes));
        if (s.scheduler?.concurrency != null) setSchedulerConcurrency(Number(s.scheduler.concurrency));
        if (s.scheduler?.active_feed_interval != null) setActiveFeedInterval(Number(s.scheduler.active_feed_interval));
        if (s.scheduler?.slow_feed_interval != null) setSlowFeedInterval(Number(s.scheduler.slow_feed_interval));
        if (s.scheduler?.error_max_backoff != null) setErrorMaxBackoff(Number(s.scheduler.error_max_backoff));
        // Crawler
        if (s.crawler?.max_concurrent != null) setMaxConcurrent(Number(s.crawler.max_concurrent));
        if (s.crawler?.request_delay_ms != null) setRequestDelayMs(Number(s.crawler.request_delay_ms));
        if (s.crawler?.max_content_length_kb != null) setMaxContentLengthKb(Number(s.crawler.max_content_length_kb));
        // Database
        if (s.cache?.max_size_mb != null) setCacheMaxSizeMb(Number(s.cache.max_size_mb));
        if (s.database?.vacuum_on_cleanup != null) setVacuumOnCleanup(s.database.vacuum_on_cleanup === true || s.database.vacuum_on_cleanup === 'true' as any);

        setAdvancedLoaded(true);
      } catch (err) {
        console.error('[system] Failed to load:', err);
      }
    };
    load();
  }, []);

  // ── Action handlers ─────────────────────────────────────────────────────
  const refreshStats = async () => {
    try {
      setStats((await api.getStats()) as unknown as ServerStats);
    } catch { /* ignore */ }
  };

  const handleClearCache = async () => {
    if (!confirm('Delete all cached files (covers, PDFs)? This cannot be undone.')) return;
    setActionInProgress('cache');
    setActionResult(null);
    try {
      const result = await api.clearCache();
      setActionResult(`Cleared ${result.deleted} cached file(s)`);
      await refreshStats();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to clear cache');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRunCleanup = async () => {
    setActionInProgress('cleanup');
    setActionResult(null);
    try {
      await api.runCleanup();
      setActionResult('Retention cleanup completed');
      await refreshStats();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to run cleanup');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCleanupOlderThan = async () => {
    if (!confirm(`Delete articles older than ${cleanupDays} days? Starred will be preserved.`)) return;
    setActionInProgress('older');
    setActionResult(null);
    try {
      const result = await api.cleanupOlderThan(cleanupDays);
      setActionResult(`Deleted ${result.deleted} article(s)`);
      await refreshStats();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete old articles');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleForceFetch = async () => {
    setIsForceFetching(true);
    setForceFetchSuccess(false);
    try {
      await api.refreshAllFeeds();
      setForceFetchSuccess(true);
      setTimeout(() => setForceFetchSuccess(false), 3000);
    } catch (err) {
      console.error('[system] Force fetch failed:', err);
    } finally {
      setIsForceFetching(false);
    }
  };

  const handleHardRefresh = async () => {
    try {
      const registrations = await navigator.serviceWorker?.getRegistrations();
      if (registrations) await Promise.all(registrations.map((r) => r.unregister()));
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  // ── Save advanced server settings ───────────────────────────────────────
  const handleAdvancedSave = async () => {
    setAdvancedSaving(true);
    setAdvancedError(null);
    try {
      await api.updateSettings({
        'scheduler.interval_minutes': schedulerInterval,
        'scheduler.concurrency': schedulerConcurrency,
        'scheduler.active_feed_interval': activeFeedInterval,
        'scheduler.slow_feed_interval': slowFeedInterval,
        'scheduler.error_max_backoff': errorMaxBackoff,
        'crawler.max_concurrent': maxConcurrent,
        'crawler.request_delay_ms': requestDelayMs,
        'crawler.max_content_length_kb': maxContentLengthKb,
        'cache.max_size_mb': cacheMaxSizeMb,
        'database.vacuum_on_cleanup': vacuumOnCleanup,
      });
      setAdvancedSaveSuccess(true);
      setTimeout(() => setAdvancedSaveSuccess(false), 2000);
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setAdvancedSaving(false);
    }
  };

  // Clear action result after 3s
  useEffect(() => {
    if (actionResult || actionError) {
      const t = setTimeout(() => {
        setActionResult(null);
        setActionError(null);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [actionResult, actionError]);

  return (
    <div className="space-y-5">
      {/* ── Account ────────────────────────────────────────────── */}
      <SectionHeader title="Account" />

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-[var(--color-text-primary)]">{user?.username ?? 'User'}</span>
            <p className="text-xs text-[var(--color-text-tertiary)]">Logged in</p>
          </div>
          <button
            onClick={handleLogout}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              'bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]',
              'hover:bg-[var(--color-surface-hover)]',
            )}
          >
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </Card>

      <Separator />

      {/* ── Storage ────────────────────────────────────────────── */}
      <SectionHeader title="Storage" />

      {stats ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Database', value: formatBytes(stats.database.size_bytes), icon: <Database size={12} /> },
            { label: 'Entries', value: stats.database.entry_count.toLocaleString(), icon: null },
            { label: 'Feeds', value: String(stats.database.feed_count), icon: null },
            { label: 'Cache', value: formatBytes(stats.cache.total_bytes), icon: <HardDrive size={12} /> },
          ].map((item) => (
            <div key={item.label} className="bg-[var(--color-surface-secondary)] rounded-lg p-2 text-center">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.value}</p>
              <p className="text-[10px] text-[var(--color-text-tertiary)]">{item.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-[var(--color-surface-secondary)] rounded-lg p-3 text-center text-xs text-[var(--color-text-tertiary)]">
          Loading…
        </div>
      )}

      <Separator />

      {/* ── Offline Content ─────────────────────────────────────── */}
      <SectionHeader title="Offline Content" />
      <OfflineContent />

      <Separator />

      {/* ── Maintenance ─────────────────────────────────────────── */}
      <SectionHeader title="Maintenance" />

      {actionResult && <StatusMessage type="success" message={actionResult} />}
      {actionError && <StatusMessage type="error" message={actionError} />}

      <div className="grid grid-cols-2 gap-2">
        <ActionButton
          onClick={handleClearCache}
          disabled={!!actionInProgress}
          loading={actionInProgress === 'cache'}
          icon={<Trash2 size={13} />}
          label="Clear Cache"
        />
        <ActionButton
          onClick={handleRunCleanup}
          disabled={!!actionInProgress}
          loading={actionInProgress === 'cleanup'}
          icon={<RefreshCw size={13} />}
          label="Run Cleanup"
        />
      </div>

      {/* Delete old articles */}
      <Card className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-tertiary)] whitespace-nowrap">Delete older than</span>
        <NumberInput value={cleanupDays} min={1} max={730} onChange={setCleanupDays} />
        <span className="text-xs text-[var(--color-text-tertiary)]">days</span>
        <ActionButton
          onClick={handleCleanupOlderThan}
          disabled={!!actionInProgress}
          loading={actionInProgress === 'older'}
          icon={<Trash2 size={12} />}
          label="Delete"
          variant="danger"
          className="ml-auto text-xs px-2.5 py-1.5"
        />
      </Card>

      <Separator />

      {/* ── App ─────────────────────────────────────────────────── */}
      <SectionHeader title="App" />

      <div className="grid grid-cols-2 gap-2">
        <ActionButton
          onClick={handleHardRefresh}
          icon={<RefreshCw size={13} />}
          label="Hard Refresh"
        />
        <ActionButton
          onClick={handleForceFetch}
          disabled={isForceFetching}
          loading={isForceFetching}
          icon={forceFetchSuccess ? <Check size={13} /> : <RefreshCw size={13} />}
          label={forceFetchSuccess ? 'Queued!' : 'Fetch All Feeds'}
        />
      </div>

      <Separator />

      {/* ── Advanced Server Settings (collapsed by default) ───── */}
      <Collapsible
        title="Advanced Server Settings"
        description="Scheduler, crawler, and database tuning"
      >
        {advancedError && <StatusMessage type="error" message={advancedError} />}

        {/* Scheduler */}
        <SectionHeader title="Scheduler" description="How often feeds are checked" />

        <SliderRow
          label="Polling Interval"
          value={schedulerInterval}
          min={5}
          max={240}
          step={5}
          formatValue={(v) => `${v} min`}
          onChange={setSchedulerInterval}
        />

        <SliderRow
          label="Concurrent Feeds"
          description="Feeds fetched in parallel per batch"
          value={schedulerConcurrency}
          min={1}
          max={20}
          onChange={setSchedulerConcurrency}
        />

        <SliderRow
          label="Active Feed Interval"
          description="Minimum minutes between checks"
          value={activeFeedInterval}
          min={5}
          max={120}
          step={5}
          formatValue={(v) => `${v} min`}
          onChange={setActiveFeedInterval}
        />

        <SliderRow
          label="Slow Feed Interval"
          description="For infrequently updated feeds"
          value={slowFeedInterval}
          min={60}
          max={1440}
          step={30}
          formatValue={(v) => `${v} min`}
          onChange={setSlowFeedInterval}
        />

        <SliderRow
          label="Error Max Backoff"
          description="Max wait before retrying a failing feed"
          value={errorMaxBackoff}
          min={60}
          max={4320}
          step={60}
          formatValue={(v) => `${v} min`}
          onChange={setErrorMaxBackoff}
        />

        <Separator />

        {/* Crawler */}
        <SectionHeader title="Crawler" description="Full article content fetching" />

        <SliderRow
          label="Concurrent Requests"
          description="Max parallel fetches per feed"
          value={maxConcurrent}
          min={1}
          max={10}
          onChange={setMaxConcurrent}
        />

        <SliderRow
          label="Request Delay"
          description="Pause between fetch batches"
          value={requestDelayMs}
          min={0}
          max={5000}
          step={100}
          formatValue={(v) => `${v} ms`}
          onChange={setRequestDelayMs}
        />

        <SliderRow
          label="Max Content Size"
          description="Truncate stored content beyond this"
          value={maxContentLengthKb}
          min={64}
          max={2048}
          step={64}
          formatValue={(v) => `${v} KB`}
          onChange={setMaxContentLengthKb}
        />

        <Separator />

        {/* Database */}
        <SectionHeader title="Database" />

        <SliderRow
          label="Cache Size Limit"
          description="Maximum for file cache (covers, PDFs)"
          value={cacheMaxSizeMb}
          min={50}
          max={5000}
          step={50}
          formatValue={(v) => `${v} MB`}
          onChange={setCacheMaxSizeMb}
        />

        <ToggleRow
          label="Vacuum on Cleanup"
          description="Reclaim disk space after retention cleanup"
          enabled={vacuumOnCleanup}
          onChange={setVacuumOnCleanup}
        />

        <div className="pt-2">
          <SaveButton
            saving={advancedSaving}
            success={advancedSaveSuccess}
            onClick={handleAdvancedSave}
            label="Save Advanced Settings"
          />
        </div>
      </Collapsible>
    </div>
  );
};

export default SystemSection;
