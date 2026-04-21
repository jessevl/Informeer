import { Capacitor, WebPlugin, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { useAudioStore } from '@/stores/audio';
import { useSettingsStore } from '@/stores/settings';
import { useTTSStore } from '@/stores/tts';
import { useVideoStore } from '@/stores/video';

/**
 * Frontend facade for the native E-ink bridge.
 *
 * Readers report when layout, paint, and interaction work is still in flight, and the Android
 * bridge is the only place that is allowed to actually hibernate the panel. Keeping that contract
 * centralized here makes the reader surfaces responsible for declaring state, not for guessing how
 * the device should power-manage itself.
 */

export type ReaderMode =
  | 'none'
  | 'feed-list'
  | 'article-reader'
  | 'epub-reader'
  | 'pdf-reader'
  | 'books-library'
  | 'magazines-library'
  | 'audio'
  | 'video'
  | 'tts';

export type GestureModel = 'paginated' | 'scroll' | 'none';

export interface SetPowerStateOptions {
  mode: ReaderMode;
  eligible: boolean;
  reason?: string;
  mediaActive: boolean;
  pendingCriticalWork: number;
  gestureModel?: GestureModel;
}

export interface MediaStateOptions {
  audio: boolean;
  video: boolean;
  tts: boolean;
}

export interface WakeCommand {
  type: 'next-page' | 'prev-page';
}

interface WakeCommandHandlers {
  nextPage?: () => void;
  prevPage?: () => void;
}

export interface EinkProfilingDurations {
  activeMs: number;
  busyMs: number;
  readyToHibernateMs: number;
  hibernatingMs: number;
  wakingMs: number;
}

export interface EinkProfilingStats {
  sessionStartedAtMs: number;
  sessionAgeMs: number;
  hibernateCount: number;
  wakeResumeCount: number;
  wakeTimeoutCount: number;
  wakeCommandQueuedCount: number;
  wakeCommandDispatchedCount: number;
  criticalWorkStartedCount: number;
  criticalWorkCompletedCount: number;
  completedWakeCount: number;
  avgWakeReadyLatencyMs: number | null;
  awakeMs: number;
  awakeSharePercent: number;
  hibernatingSharePercent: number;
  durations: EinkProfilingDurations;
}

export interface HibernateStateChangedEvent {
  state: 'active' | 'busy' | 'ready_to_hibernate' | 'hibernating' | 'waking';
  mode: ReaderMode;
  eligible: boolean;
  reason?: string;
  pendingCriticalWork: number;
  mediaActive: boolean;
  gestureModel?: GestureModel;
  visualStable?: boolean;
  interactiveReady?: boolean;
  hibernating?: boolean;
  waitingForInteractiveReady?: boolean;
  stats?: EinkProfilingStats;
}

interface EinkPowerPlugin {
  setPowerState(options: SetPowerStateOptions): Promise<void>;
  beginCriticalWork(options: { tag: string }): Promise<void>;
  endCriticalWork(options: { tag: string }): Promise<void>;
  markVisualStable(): Promise<void>;
  notifyInteractiveReady(): Promise<void>;
  setMediaState(options: MediaStateOptions): Promise<void>;
  getState(): Promise<HibernateStateChangedEvent>;
  resetStats(): Promise<HibernateStateChangedEvent>;
  setLauncherIcon(options: { eink: boolean }): Promise<void>;
  addListener(
    eventName: 'wakeCommand',
    listenerFunc: (event: WakeCommand) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'hibernateStateChanged',
    listenerFunc: (event: HibernateStateChangedEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const EMPTY_EINK_STATS: EinkProfilingStats = {
  sessionStartedAtMs: 0,
  sessionAgeMs: 0,
  hibernateCount: 0,
  wakeResumeCount: 0,
  wakeTimeoutCount: 0,
  wakeCommandQueuedCount: 0,
  wakeCommandDispatchedCount: 0,
  criticalWorkStartedCount: 0,
  criticalWorkCompletedCount: 0,
  completedWakeCount: 0,
  avgWakeReadyLatencyMs: null,
  awakeMs: 0,
  awakeSharePercent: 0,
  hibernatingSharePercent: 0,
  durations: {
    activeMs: 0,
    busyMs: 0,
    readyToHibernateMs: 0,
    hibernatingMs: 0,
    wakingMs: 0,
  },
};

class EinkPowerWeb extends WebPlugin implements EinkPowerPlugin {
  private state: HibernateStateChangedEvent = {
    state: 'active',
    mode: 'none',
    eligible: false,
    reason: 'web-fallback',
    pendingCriticalWork: 0,
    mediaActive: false,
    gestureModel: 'none',
    visualStable: false,
    interactiveReady: false,
    hibernating: false,
    waitingForInteractiveReady: false,
    stats: { ...EMPTY_EINK_STATS, sessionStartedAtMs: Date.now() },
  };

  async setPowerState(options: SetPowerStateOptions): Promise<void> {
    this.state = {
      state: options.pendingCriticalWork > 0 ? 'busy' : options.eligible ? 'ready_to_hibernate' : 'active',
      mode: options.mode,
      eligible: options.eligible,
      reason: options.reason,
      pendingCriticalWork: options.pendingCriticalWork,
      mediaActive: options.mediaActive,
      gestureModel: options.gestureModel,
      visualStable: this.state.visualStable,
      interactiveReady: this.state.interactiveReady,
      hibernating: false,
      waitingForInteractiveReady: false,
      stats: {
        ...(this.state.stats ?? EMPTY_EINK_STATS),
        sessionAgeMs: Date.now() - ((this.state.stats?.sessionStartedAtMs) ?? Date.now()),
      },
    };
    this.notifyListeners('hibernateStateChanged', this.state);
  }

  async beginCriticalWork(): Promise<void> {}

  async endCriticalWork(): Promise<void> {}

  async markVisualStable(): Promise<void> {
    this.state = {
      ...this.state,
      visualStable: true,
    };
  }

  async notifyInteractiveReady(): Promise<void> {
    this.state = {
      ...this.state,
      interactiveReady: true,
    };
  }

  async setMediaState(options: MediaStateOptions): Promise<void> {
    this.state = {
      ...this.state,
      mediaActive: options.audio || options.video || options.tts,
    };
  }

  async getState(): Promise<HibernateStateChangedEvent> {
    return this.state;
  }

  async resetStats(): Promise<HibernateStateChangedEvent> {
    this.state = {
      ...this.state,
      stats: { ...EMPTY_EINK_STATS, sessionStartedAtMs: Date.now() },
    };
    return this.state;
  }

  async setLauncherIcon(_options: { eink: boolean }): Promise<void> {
    // no-op on web
  }
}

const EinkPower = registerPlugin<EinkPowerPlugin>('EinkPower', {
  web: async () => new EinkPowerWeb(),
});

interface SurfaceState {
  mode: ReaderMode;
  eligible: boolean;
  reason?: string;
  gestureModel: GestureModel;
}

interface ControllerSnapshot {
  mode: ReaderMode;
  eligible: boolean;
  reason?: string;
  mediaActive: boolean;
  pendingCriticalWork: number;
  gestureModel: GestureModel;
}

class EinkPowerController {
  private surface: SurfaceState = {
    mode: 'none',
    eligible: false,
    reason: 'surface-unset',
    gestureModel: 'none',
  };

  private mediaState: MediaStateOptions = {
    audio: false,
    video: false,
    tts: false,
  };

  private pendingCriticalWork = new Set<string>();
  private deferHibernation = false;
  private einkEnabled = false;
  private visualStable = false;
  private interactiveReady = false;
  private lastSyncKey: string | null = null;
  private wakeHandlers: WakeCommandHandlers | null = null;

  isAvailable(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  isHardwareSupported(): boolean {
    return this.isAvailable();
  }

  setEinkEnabled(enabled: boolean): void {
    this.einkEnabled = enabled;
    void this.syncState();
    if (this.isAvailable()) {
      void EinkPower.setLauncherIcon({ eink: enabled }).catch(() => {
        // non-fatal — icon switch is best-effort
      });
    }
  }

  getSurfaceMode(): ReaderMode {
    return this.surface.mode;
  }

  /**
   * Temporarily prevents the device from entering hibernation even if all
   * eligibility criteria are met. Useful when UI state transitions (like
   * hiding toolbars) need a chance to commit a frame before the CPU is
   * powered down.
   */
  setDeferHibernation(deferred: boolean): void {
    const wasDeferred = this.deferHibernation;
    this.deferHibernation = deferred;
    if (wasDeferred && !deferred) {
      void this.syncState().then(() => {
        if (this.getSnapshot().eligible) {
          void this.markVisualStable();
          void this.notifyInteractiveReady();
        }
      });
    } else {
      void this.syncState();
    }
  }

  setSurface(surface: Partial<SurfaceState> & Pick<SurfaceState, 'mode'>): void {
    const wasEligible = this.getSnapshot().eligible;
    this.surface = {
      ...this.surface,
      ...surface,
      eligible: surface.eligible ?? false,
      gestureModel: surface.gestureModel ?? this.surface.gestureModel,
    };
    
    // If the surface mode changed OR we are still not eligible, reset the flags.
    // If we were ineligible and just became eligible (e.g. toolbar hidden),
    // we DON'T reset visualStable/interactiveReady manually here, so that 
    // the call to markVisualStable() below can actually move us to ready.
    const isNowEligible = this.getSnapshot().eligible;
    if (surface.mode !== this.surface.mode || !isNowEligible) {
      this.visualStable = false;
      this.interactiveReady = false;
    }

    void this.syncState().then(() => {
      // If we just became eligible (e.g. toolbar hidden), ensure we commit a frame
      // so the last visual state of the reader is what gets frozen in hibernate.
      if (!wasEligible && isNowEligible) {
        void this.markVisualStable();
        void this.notifyInteractiveReady();
      }
    });
  }

  setMediaState(mediaState: Partial<MediaStateOptions>): void {
    this.mediaState = { ...this.mediaState, ...mediaState };
    void this.syncState();
  }

  beginCriticalWork(tag: string): void {
    this.pendingCriticalWork.add(tag);
    this.visualStable = false;
    this.interactiveReady = false;
    void this.syncState();
    if (!this.isAvailable()) return;
    void EinkPower.beginCriticalWork({ tag });
  }

  endCriticalWork(tag: string): void {
    this.pendingCriticalWork.delete(tag);
    void this.syncState();
    if (!this.isAvailable()) return;
    void EinkPower.endCriticalWork({ tag });
  }

  async markVisualStable(): Promise<void> {
    this.visualStable = true;
    if (!this.isAvailable()) return;
    await EinkPower.markVisualStable();
  }

  async waitForPaintCommit(): Promise<void> {
    if (!this.einkEnabled || !this.isHardwareSupported() || typeof window === 'undefined') return;

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  async notifyInteractiveReady(): Promise<void> {
    this.interactiveReady = true;
    if (!this.isAvailable()) return;
    await EinkPower.notifyInteractiveReady();
  }

  async addWakeCommandListener(
    listener: (event: WakeCommand) => void,
  ): Promise<PluginListenerHandle> {
    return EinkPower.addListener('wakeCommand', listener);
  }

  async addStateListener(
    listener: (event: HibernateStateChangedEvent) => void,
  ): Promise<PluginListenerHandle> {
    return EinkPower.addListener('hibernateStateChanged', listener);
  }

  async getState(): Promise<HibernateStateChangedEvent> {
    return EinkPower.getState();
  }

  async resetStats(): Promise<HibernateStateChangedEvent> {
    return EinkPower.resetStats();
  }

  setWakeHandlers(handlers: WakeCommandHandlers | null): void {
    this.wakeHandlers = handlers;
  }

  handleWakeCommand(command: WakeCommand): void {
    if (!this.wakeHandlers) return;

    if (command.type === 'next-page') {
      this.wakeHandlers.nextPage?.();
      return;
    }

    if (command.type === 'prev-page') {
      this.wakeHandlers.prevPage?.();
    }
  }

  private getSnapshot(): ControllerSnapshot {
    const mediaActive = this.mediaState.audio || this.mediaState.video || this.mediaState.tts;
    const pendingCriticalWork = this.pendingCriticalWork.size;
    const effectiveMode = this.mediaState.audio
      ? 'audio'
      : this.mediaState.video
        ? 'video'
        : this.mediaState.tts
          ? 'tts'
          : this.surface.mode;

    let reason = this.surface.reason;
    if (!this.einkEnabled) reason = 'eink-mode-disabled';
    else if (mediaActive) reason = 'media-active';
    else if (pendingCriticalWork > 0) reason = 'critical-work-pending';
    else if (!this.surface.eligible) reason = reason ?? 'surface-ineligible';
    else reason = undefined;

    return {
      mode: effectiveMode,
      eligible: this.einkEnabled && this.surface.eligible && !mediaActive && pendingCriticalWork === 0 && !this.deferHibernation,
      reason: this.deferHibernation ? 'hibernation-deferred' : reason,
      mediaActive,
      pendingCriticalWork,
      gestureModel: this.surface.gestureModel,
    };
  }

  private async syncState(): Promise<void> {
    const snapshot = this.getSnapshot();
    const syncKey = JSON.stringify({
      ...snapshot,
      mediaState: this.mediaState,
      visualStable: this.visualStable,
      interactiveReady: this.interactiveReady,
    });

    if (syncKey === this.lastSyncKey) return;
    this.lastSyncKey = syncKey;

    if (!this.isAvailable()) return;

    try {
      await EinkPower.setMediaState(this.mediaState);
      await EinkPower.setPowerState(snapshot);

      if (snapshot.eligible && this.visualStable) {
        await EinkPower.markVisualStable();
      }

      if (snapshot.eligible && this.interactiveReady) {
        await EinkPower.notifyInteractiveReady();
      }
    } catch (error) {
      console.error('Failed to sync E-ink power state', error);
    }
  }
}

export const einkPower = new EinkPowerController();

let removeBridgeSubscriptions: (() => void) | null = null;
let wakeCommandListenerHandle: PluginListenerHandle | null = null;

export function initializeEinkPowerBridge(): () => void {
  if (removeBridgeSubscriptions) return removeBridgeSubscriptions;

  const settingsState = useSettingsStore.getState();
  einkPower.setEinkEnabled(settingsState.einkMode && settingsState.einkPowerSavingEnabled);
  einkPower.setMediaState({
    audio: Boolean(useAudioStore.getState().isPlaying && useAudioStore.getState().currentEnclosure),
    video: Boolean(
      useVideoStore.getState().isPlaying
        && (useVideoStore.getState().currentEnclosure || useVideoStore.getState().currentYouTubeId)
    ),
    tts: Boolean(useTTSStore.getState().isPlaying && useTTSStore.getState().currentEntry),
  });

  const unsubscribeSettings = useSettingsStore.subscribe((state) => {
    einkPower.setEinkEnabled(state.einkMode && state.einkPowerSavingEnabled);
  });

  const unsubscribeAudio = useAudioStore.subscribe((state) => {
    einkPower.setMediaState({
      audio: Boolean(state.isPlaying && state.currentEnclosure),
    });
  });

  const unsubscribeVideo = useVideoStore.subscribe((state) => {
    einkPower.setMediaState({
      video: Boolean(state.isPlaying && (state.currentEnclosure || state.currentYouTubeId)),
    });
  });

  const unsubscribeTTS = useTTSStore.subscribe((state) => {
    einkPower.setMediaState({
      tts: Boolean(
        state.currentEntry
          && (state.isPlaying || state.generationStatus === 'generating' || state.modelStatus === 'loading')
      ),
    });
  });

  if (einkPower.isHardwareSupported()) {
    void einkPower.addWakeCommandListener((command) => {
      einkPower.handleWakeCommand(command);
    }).then((handle) => {
      wakeCommandListenerHandle = handle;
    }).catch((error) => {
      console.error('Failed to subscribe to E-ink wake commands', error);
    });
  }

  // Global orientation-change wake: keep the device awake for 3 s whenever the
  // screen rotates so all surfaces (lists, article, epub, pdf, etc.) have time
  // to reflow and repaint before the bridge re-evaluates hibernation eligibility.
  let orientationWorkTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const handleOrientationChange = () => {
    if (!einkPower.isHardwareSupported()) return;
    if (orientationWorkTimeoutId !== null) clearTimeout(orientationWorkTimeoutId);
    einkPower.beginCriticalWork('global-orientation-change');
    orientationWorkTimeoutId = setTimeout(() => {
      einkPower.endCriticalWork('global-orientation-change');
      orientationWorkTimeoutId = null;
    }, 3000);
  };
  window.addEventListener('orientationchange', handleOrientationChange);

  removeBridgeSubscriptions = () => {
    unsubscribeSettings();
    unsubscribeAudio();
    unsubscribeVideo();
    unsubscribeTTS();
    window.removeEventListener('orientationchange', handleOrientationChange);
    if (orientationWorkTimeoutId !== null) {
      clearTimeout(orientationWorkTimeoutId);
      einkPower.endCriticalWork('global-orientation-change');
      orientationWorkTimeoutId = null;
    }
    if (wakeCommandListenerHandle) {
      void wakeCommandListenerHandle.remove();
      wakeCommandListenerHandle = null;
    }
    removeBridgeSubscriptions = null;
  };

  return removeBridgeSubscriptions;
}
