import { useEffect, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { einkPower } from '@/services/eink-power';
import type { EinkProfilingDurations, HibernateStateChangedEvent } from '@/services/eink-power';
import { useSettingsStore } from '@/stores/settings';

const STORAGE_KEY = 'informeer-eink-profiler-open';
const POLL_INTERVAL_MS = 1000;
const LIVE_TIMER_INTERVAL_MS = 200;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatLiveDuration(ms: number): string {
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return formatDuration(ms);
}

function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

function projectDurations(
  durations: EinkProfilingDurations | undefined,
  state: HibernateStateChangedEvent['state'] | undefined,
  elapsedMs: number,
): EinkProfilingDurations | null {
  if (!durations) return null;

  const projected = { ...durations };

  switch (state) {
    case 'busy':
      projected.busyMs += elapsedMs;
      break;
    case 'ready_to_hibernate':
      projected.readyToHibernateMs += elapsedMs;
      break;
    case 'hibernating':
      projected.hibernatingMs += elapsedMs;
      break;
    case 'waking':
      projected.wakingMs += elapsedMs;
      break;
    default:
      projected.activeMs += elapsedMs;
      break;
  }

  return projected;
}

function statePillClass(state: string | undefined, einkMode: boolean): string {
  if (einkMode) {
    switch (state) {
      case 'hibernating':
        return 'bg-stone-950 text-stone-50 border-stone-950';
      case 'waking':
        return 'bg-stone-300 text-stone-950 border-stone-500';
      case 'busy':
        return 'bg-stone-700 text-stone-50 border-stone-900';
      case 'ready_to_hibernate':
        return 'bg-stone-100 text-stone-950 border-stone-400';
      default:
        return 'bg-white text-stone-950 border-stone-400';
    }
  }

  switch (state) {
    case 'hibernating':
      return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30';
    case 'waking':
      return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
    case 'busy':
      return 'bg-rose-500/15 text-rose-700 border-rose-500/30';
    case 'ready_to_hibernate':
      return 'bg-sky-500/15 text-sky-700 border-sky-500/30';
    default:
      return 'bg-stone-500/15 text-stone-700 border-stone-500/30';
  }
}

export function EinkProfilingPanel() {
  const einkMode = useSettingsStore((s) => s.einkMode);
  const einkPowerSavingEnabled = useSettingsStore((s) => s.einkPowerSavingEnabled);
  const debugPanelEnabled = useSettingsStore((s) => s.einkDebugPanelEnabled);
  const debugAllowed = einkMode && einkPowerSavingEnabled && debugPanelEnabled && einkPower.isHardwareSupported();
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  });
  const [snapshot, setSnapshot] = useState<HibernateStateChangedEvent | null>(null);
  const [snapshotUpdatedAtMs, setSnapshotUpdatedAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, String(open));
  }, [open]);

  useEffect(() => {
    if (!debugAllowed || !open) return;

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, LIVE_TIMER_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [debugAllowed, open]);

  useEffect(() => {
    if (!debugAllowed) return;

    let disposed = false;
    let intervalId: number | null = null;
    let stateHandle: PluginListenerHandle | null = null;

    const load = async () => {
      try {
        const next = await einkPower.getState();
        if (!disposed) {
          setSnapshot(next);
          setSnapshotUpdatedAtMs(Date.now());
          setNowMs(Date.now());
          setError(null);
        }
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load E Ink state');
        }
      }
    };

    void load();

    void einkPower.addStateListener((event) => {
      if (!disposed) {
        setSnapshot(event);
        setSnapshotUpdatedAtMs(Date.now());
        setNowMs(Date.now());
        setError(null);
      }
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      stateHandle = handle;
    }).catch((listenerError) => {
      if (!disposed) {
        setError(listenerError instanceof Error ? listenerError.message : 'Failed to subscribe to E Ink state');
      }
    });

    if (open) {
      intervalId = window.setInterval(() => {
        void load();
      }, POLL_INTERVAL_MS);
    }

    return () => {
      disposed = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      if (stateHandle) {
        void stateHandle.remove();
      }
    };
  }, [debugAllowed, open]);

  useEffect(() => {
    if (debugAllowed) return;
    setOpen(false);
  }, [debugAllowed]);

  if (!debugAllowed) {
    return null;
  }

  const stats = snapshot?.stats;
  const durations = stats?.durations;
  const projectedElapsedMs = snapshot ? Math.max(0, nowMs - snapshotUpdatedAtMs) : 0;
  const projectedAwakeMs = stats
    ? stats.awakeMs + (snapshot?.state === 'hibernating' ? 0 : projectedElapsedMs)
    : null;
  const projectedDurations = projectDurations(durations, snapshot?.state, projectedElapsedMs);
  const wakeResumesPerMinute = stats && stats.sessionAgeMs > 0
    ? stats.wakeResumeCount / (stats.sessionAgeMs / 60000)
    : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={einkMode
          ? 'fixed right-4 bottom-4 z-[140] rounded-full border border-stone-950 bg-[var(--color-surface-base)] px-3 py-2 text-xs font-semibold tracking-wide text-stone-950 shadow-[0_4px_12px_rgba(0,0,0,0.12)]'
          : 'fixed right-4 bottom-4 z-[140] rounded-full border border-stone-300/80 bg-white/90 px-3 py-2 text-xs font-semibold tracking-wide text-stone-800 shadow-lg backdrop-blur'}
      >
        {open ? 'Hide E Ink Profiler' : 'Show E Ink Profiler'}
      </button>

      {open && (
        <div className={einkMode
          ? 'fixed right-4 bottom-18 z-[139] w-[min(28rem,calc(100vw-2rem))] max-h-[min(80vh,48rem)] overflow-auto rounded-3xl border border-stone-950 bg-[var(--color-surface-base)] p-4 text-stone-950 shadow-[0_12px_32px_rgba(0,0,0,0.18)]'
          : 'fixed right-4 bottom-18 z-[139] w-[min(28rem,calc(100vw-2rem))] max-h-[min(80vh,48rem)] overflow-auto rounded-3xl border border-stone-300/80 bg-[rgba(255,252,247,0.96)] p-4 shadow-2xl backdrop-blur-md'}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">E Ink Profiling</div>
              <div className="mt-1 text-sm text-stone-700">
                Lower awake time and fewer wake resumes are the signals that the hibernation path is working.
              </div>
            </div>
            <div className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statePillClass(snapshot?.state, einkMode)}`}>
              {snapshot?.state ?? 'unknown'}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
            <StatCard label="Awake Share" value={stats ? `${formatNumber(stats.awakeSharePercent, 1)}%` : '...'} hint="Lower is better" />
            <StatCard label="Awake Time" value={projectedAwakeMs == null ? '...' : formatLiveDuration(projectedAwakeMs)} hint="Time not hibernating" />
            <StatCard label="Wake Resumes" value={stats ? formatNumber(stats.wakeResumeCount) : '...'} hint="Lower is better" />
            <StatCard label="Hibernate Cycles" value={stats ? formatNumber(stats.hibernateCount) : '...'} hint="Should climb while awake share drops" />
            <StatCard label="Wake Timeouts" value={stats ? formatNumber(stats.wakeTimeoutCount) : '...'} hint="Should stay near zero" />
            <StatCard label="Wake Ready Latency" value={stats ? (stats.avgWakeReadyLatencyMs == null ? 'n/a' : `${formatNumber(stats.avgWakeReadyLatencyMs, 0)} ms`) : '...'} hint="Average resume to interactive-ready" />
          </div>

          <div className={einkMode
            ? 'mb-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-stone-300 bg-white p-3 text-xs text-stone-800'
            : 'mb-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-stone-200 bg-white/70 p-3 text-xs text-stone-700'}>
            <KeyValue label="Mode" value={snapshot?.mode ?? 'unknown'} />
            <KeyValue label="Reason" value={snapshot?.reason ?? 'n/a'} />
            <KeyValue label="Gesture" value={snapshot?.gestureModel ?? 'n/a'} />
            <KeyValue label="Eligible" value={snapshot?.eligible ? 'yes' : 'no'} />
            <KeyValue label="Visual Stable" value={snapshot?.visualStable ? 'yes' : 'no'} />
            <KeyValue label="Interactive Ready" value={snapshot?.interactiveReady ? 'yes' : 'no'} />
            <KeyValue label="Media Active" value={snapshot?.mediaActive ? 'yes' : 'no'} />
            <KeyValue label="Pending Work" value={String(snapshot?.pendingCriticalWork ?? 0)} />
            <KeyValue label="Session Age" value={stats ? formatDuration(stats.sessionAgeMs) : '...'} />
            <KeyValue label="Wake/Min" value={stats ? formatNumber(wakeResumesPerMinute, 2) : '...'} />
          </div>

          <div className={einkMode
            ? 'mb-4 rounded-2xl border border-stone-300 bg-white p-3'
            : 'mb-4 rounded-2xl border border-stone-200 bg-white/70 p-3'}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Time In State</div>
            <div className="grid grid-cols-2 gap-2 text-xs text-stone-700">
              <KeyValue label="Active" value={projectedDurations ? formatLiveDuration(projectedDurations.activeMs) : '...'} />
              <KeyValue label="Busy" value={projectedDurations ? formatLiveDuration(projectedDurations.busyMs) : '...'} />
              <KeyValue label="Ready" value={projectedDurations ? formatLiveDuration(projectedDurations.readyToHibernateMs) : '...'} />
              <KeyValue label="Hibernating" value={projectedDurations ? formatLiveDuration(projectedDurations.hibernatingMs) : '...'} />
              <KeyValue label="Waking" value={projectedDurations ? formatLiveDuration(projectedDurations.wakingMs) : '...'} />
              <KeyValue label="Hibernate Share" value={stats ? `${formatNumber(stats.hibernatingSharePercent, 1)}%` : '...'} />
            </div>
          </div>

          <div className={einkMode
            ? 'mb-4 rounded-2xl border border-stone-300 bg-white p-3'
            : 'mb-4 rounded-2xl border border-stone-200 bg-white/70 p-3'}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Event Counters</div>
            <div className="grid grid-cols-2 gap-2 text-xs text-stone-700">
              <KeyValue label="Commands Queued" value={stats ? formatNumber(stats.wakeCommandQueuedCount) : '...'} />
              <KeyValue label="Commands Dispatched" value={stats ? formatNumber(stats.wakeCommandDispatchedCount) : '...'} />
              <KeyValue label="Critical Work Start" value={stats ? formatNumber(stats.criticalWorkStartedCount) : '...'} />
              <KeyValue label="Critical Work End" value={stats ? formatNumber(stats.criticalWorkCompletedCount) : '...'} />
              <KeyValue label="Completed Wakes" value={stats ? formatNumber(stats.completedWakeCount) : '...'} />
              <KeyValue label="State Waiting" value={snapshot?.waitingForInteractiveReady ? 'yes' : 'no'} />
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-2xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void einkPower.getState().then((next) => {
                  setSnapshot(next);
                  setSnapshotUpdatedAtMs(Date.now());
                  setNowMs(Date.now());
                  setError(null);
                }).catch((refreshError) => {
                  setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh E Ink state');
                });
              }}
              className={einkMode
                ? 'rounded-full border border-stone-400 bg-white px-3 py-1.5 text-xs font-medium text-stone-950 hover:bg-stone-100'
                : 'rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-100'}
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={resetting}
              onClick={() => {
                setResetting(true);
                void einkPower.resetStats().then((next) => {
                  setSnapshot(next);
                  setSnapshotUpdatedAtMs(Date.now());
                  setNowMs(Date.now());
                  setError(null);
                }).catch((resetError) => {
                  setError(resetError instanceof Error ? resetError.message : 'Failed to reset E Ink stats');
                }).finally(() => {
                  setResetting(false);
                });
              }}
              className={einkMode
                ? 'rounded-full border border-stone-950 bg-stone-950 px-3 py-1.5 text-xs font-medium text-stone-50 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60'
                : 'rounded-full border border-stone-800 bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60'}
            >
              {resetting ? 'Resetting…' : 'Reset Counters'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white/80 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-stone-900">{value}</div>
      <div className="mt-1 text-[11px] text-stone-500">{hint}</div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</div>
      <div className="mt-0.5 font-medium text-stone-900">{value}</div>
    </div>
  );
}