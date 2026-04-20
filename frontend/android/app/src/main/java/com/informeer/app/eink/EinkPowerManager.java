package com.informeer.app.eink;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;

import java.lang.ref.WeakReference;
import java.util.HashSet;
import java.util.Set;

/**
 * Manages E-ink power optimisation by hibernating the WebView when eligible
 * (reader surface, no media, no pending work, visual-stable and interactive-ready).
 *
 * <h3>Design goals</h3>
 * <ul>
 *   <li>Reader components should know almost nothing about sleep — they report surface
 *       eligibility and critical work, nothing else.</li>
 *   <li>Touch wake is <b>transparent</b>: on ACTION_DOWN the WebView is resumed
 *       synchronously and the event is passed through to normal dispatch. No
 *       buffering, replaying or synthetic command translation.</li>
 *   <li>Hardware page keys during hibernation are queued as wake commands and
 *       delivered after the JS side reports interactive-ready.</li>
 * </ul>
 */
public final class EinkPowerManager {

    // ─── Singleton ───────────────────────────────────────────────────
    private static final EinkPowerManager INSTANCE = new EinkPowerManager();

    public static EinkPowerManager getInstance() {
        return INSTANCE;
    }

    private EinkPowerManager() {}

    // ─── Constants ───────────────────────────────────────────────────
    private static final long WAKE_TIMEOUT_MS = 450L;

    // ─── External references ─────────────────────────────────────────
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WeakReference<Bridge> bridgeRef = new WeakReference<>(null);
    private WeakReference<EinkPowerPlugin> pluginRef = new WeakReference<>(null);

    // ─── Surface / power state ───────────────────────────────────────
    private String state = "active";
    private String mode = "none";
    private String reason = "uninitialized";
    private String gestureModel = "none";
    private boolean eligible = false;
    private boolean mediaActive = false;
    private boolean visualStable = false;
    private boolean interactiveReady = false;
    private boolean hibernating = false;
    private boolean waitingForInteractiveReady = false;
    private int pendingCriticalWork = 0;
    private final Set<String> criticalWorkTags = new HashSet<>();

    // ─── Profiling counters ──────────────────────────────────────────
    private long sessionStartedAtMs = SystemClock.elapsedRealtime();
    private long lastStateChangedAtMs = sessionStartedAtMs;
    private long wakeStartedAtMs = 0L;
    private long activeMs = 0L;
    private long busyMs = 0L;
    private long readyToHibernateMs = 0L;
    private long hibernatingMs = 0L;
    private long wakingMs = 0L;
    private long totalWakeReadyLatencyMs = 0L;
    private int hibernateCount = 0;
    private int wakeResumeCount = 0;
    private int wakeTimeoutCount = 0;
    private int wakeCommandQueuedCount = 0;
    private int wakeCommandDispatchedCount = 0;
    private int criticalWorkStartedCount = 0;
    private int criticalWorkCompletedCount = 0;
    private int completedWakeCount = 0;

    // ─── Wake command queue (hardware keys only) ─────────────────────
    private WakeCommand pendingWakeCommand = null;

    private final Runnable wakeTimeoutRunnable = () -> {
        synchronized (EinkPowerManager.this) {
            if (!waitingForInteractiveReady) return;
            waitingForInteractiveReady = false;
            wakeTimeoutCount++;
            wakeStartedAtMs = 0L;
            reason = "wake-timeout";
            dispatchPendingWakeCommandLocked(true);
            recomputeStateLocked();
            emitStateLocked();
            maybeHibernateLocked();
        }
    };

    // ─── WakeCommand (hardware keys only) ────────────────────────────
    private static final class WakeCommand {
        final String type;
        WakeCommand(String type) { this.type = type; }

        JSObject toJsObject() {
            JSObject o = new JSObject();
            o.put("type", type);
            return o;
        }
    }

    // ════════════════════════════════════════════════════════════════════
    //  Public API — called from Plugin / Activity
    // ════════════════════════════════════════════════════════════════════

    public synchronized void attachBridge(Bridge bridge) {
        bridgeRef = new WeakReference<>(bridge);
    }

    public synchronized void attachPlugin(EinkPowerPlugin plugin) {
        pluginRef = new WeakReference<>(plugin);
        emitStateLocked();
    }

    public synchronized void detachPlugin(EinkPowerPlugin plugin) {
        if (pluginRef.get() == plugin) {
            pluginRef = new WeakReference<>(null);
        }
    }

    /** Called from JS via plugin when the reader surface updates its power state. */
    public synchronized void setPowerState(
            String nextMode, boolean nextEligible, String nextReason,
            boolean nextMediaActive, int nextPendingCriticalWork,
            String nextGestureModel) {
        mode = nextMode;
        eligible = nextEligible;
        reason = nextReason != null ? nextReason : reason;
        mediaActive = nextMediaActive;
        pendingCriticalWork = Math.max(nextPendingCriticalWork, criticalWorkTags.size());
        gestureModel = nextGestureModel;

        if (shouldForceWakeLocked()) {
            resumeWebViewLocked(reason != null ? reason : "surface-ineligible");
        }
        recomputeStateLocked();
        emitStateLocked();
        maybeHibernateLocked();
    }

    public synchronized void setMediaState(boolean audio, boolean video, boolean tts) {
        mediaActive = audio || video || tts;
        if (mediaActive && (hibernating || waitingForInteractiveReady)) {
            resumeWebViewLocked("media-active");
        }
        reason = mediaActive ? "media-active" : reason;
        recomputeStateLocked();
        emitStateLocked();
        maybeHibernateLocked();
    }

    public synchronized void beginCriticalWork(String tag) {
        if (criticalWorkTags.add(tag)) criticalWorkStartedCount++;
        pendingCriticalWork = criticalWorkTags.size();
        visualStable = false;
        interactiveReady = false;
        setStateLocked("busy");
        reason = "critical-work";
        emitStateLocked();
    }

    public synchronized void endCriticalWork(String tag) {
        if (criticalWorkTags.remove(tag)) criticalWorkCompletedCount++;
        pendingCriticalWork = criticalWorkTags.size();
        recomputeStateLocked();
        emitStateLocked();
        maybeHibernateLocked();
    }

    public synchronized void markVisualStable() {
        visualStable = true;
        if (!waitingForInteractiveReady) {
            recomputeStateLocked();
            emitStateLocked();
            maybeHibernateLocked();
        } else {
            emitStateLocked();
        }
    }

    public synchronized void notifyInteractiveReady() {
        interactiveReady = true;

        if (waitingForInteractiveReady) {
            waitingForInteractiveReady = false;
            mainHandler.removeCallbacks(wakeTimeoutRunnable);
            if (wakeStartedAtMs > 0L) {
                totalWakeReadyLatencyMs += SystemClock.elapsedRealtime() - wakeStartedAtMs;
                completedWakeCount++;
                wakeStartedAtMs = 0L;
            }
            reason = "wake-ready";
            dispatchPendingWakeCommandLocked(true);
            recomputeStateLocked();
            emitStateLocked();
            return;
        }

        recomputeStateLocked();
        emitStateLocked();
        maybeHibernateLocked();
    }

    // ─── Touch event handling ────────────────────────────────────────
    //
    // Called from MainActivity.dispatchTouchEvent BEFORE the event reaches
    // the WebView. Returns true to consume the event, false to let it
    // pass through normally.
    //
    // Strategy: when hibernating the WebView is paused. On any ACTION_DOWN
    // we resume it synchronously on the main thread and then return false
    // so the same MotionEvent flows through the normal dispatch chain into
    // the now-awake WebView. No buffering, no replay.
    //
    public synchronized boolean handleTouchEvent(MotionEvent event) {
        if (!supportsTouchWakeLocked()) return false;

        if (hibernating && event.getActionMasked() == MotionEvent.ACTION_DOWN) {
            resumeWebViewImmediateLocked("touch-down");
            return false;
        }

        return false;
    }

    // ─── Key event handling ──────────────────────────────────────────
    public synchronized boolean handleKeyEvent(KeyEvent event) {
        if (!isPaginatedLocked()) return false;

        int keyCode = event.getKeyCode();
        if (!isSupportedPageKey(keyCode)) return false;

        if (event.getAction() != KeyEvent.ACTION_DOWN) {
            return hibernating || waitingForInteractiveReady;
        }

        WakeCommand command = wakeCommandForKey(keyCode);
        if (command == null) return false;

        if (hibernating) {
            resumeWebViewLocked("hardware-key");
            queueWakeCommandLocked(command);
            return true;
        }

        if (waitingForInteractiveReady) {
            queueWakeCommandLocked(command);
            return true;
        }

        wakeCommandDispatchedCount++;
        emitWakeCommandLocked(command, true);
        reason = "hardware-key";
        setStateLocked("active");
        emitStateLocked();
        return true;
    }

    // ════════════════════════════════════════════════════════════════════
    //  State machine internals
    // ════════════════════════════════════════════════════════════════════

    private boolean isPaginatedLocked() {
        return "paginated".equals(gestureModel);
    }

    private boolean supportsTouchWakeLocked() {
        return !"none".equals(gestureModel);
    }

    private boolean shouldForceWakeLocked() {
        return (!eligible || mediaActive || !supportsTouchWakeLocked())
                && (hibernating || waitingForInteractiveReady);
    }

    private boolean canHibernateLocked() {
        return eligible && supportsTouchWakeLocked() && !mediaActive
                && pendingCriticalWork == 0
                && visualStable && interactiveReady
                && !hibernating && !waitingForInteractiveReady;
    }

    private void maybeHibernateLocked() {
        if (!canHibernateLocked()) return;
        hibernating = true;
        hibernateCount++;
        setStateLocked("hibernating");
        reason = "hibernating";
        emitStateLocked();
        pauseWebView();
    }

    private void recomputeStateLocked() {
        if (hibernating)                     { setStateLocked("hibernating"); return; }
        if (waitingForInteractiveReady)      { setStateLocked("waking");      return; }
        if (pendingCriticalWork > 0)         { setStateLocked("busy");        return; }
        setStateLocked(eligible ? "ready_to_hibernate" : "active");
    }

    /**
     * Resume after hibernate via async post. Used for hardware-key wake
     * where the key event is consumed anyway.
     */
    private void resumeWebViewLocked(String wakeReason) {
        hibernating = false;
        waitingForInteractiveReady = true;
        visualStable = false;
        interactiveReady = false;
        wakeResumeCount++;
        wakeStartedAtMs = SystemClock.elapsedRealtime();
        setStateLocked("waking");
        reason = wakeReason;
        emitStateLocked();
        mainHandler.removeCallbacks(wakeTimeoutRunnable);
        mainHandler.postDelayed(wakeTimeoutRunnable, WAKE_TIMEOUT_MS);
        resumeWebViewOnMainThread();
    }

    /**
     * Resume synchronously on the main thread (called from dispatchTouchEvent).
     * This ensures the WebView is running before the touch continues through
     * the normal dispatch chain.
     */
    private void resumeWebViewImmediateLocked(String wakeReason) {
        hibernating = false;
        visualStable = false;
        interactiveReady = false;
        wakeResumeCount++;
        wakeStartedAtMs = SystemClock.elapsedRealtime();
        setStateLocked("active");
        reason = wakeReason;
        emitStateLocked();

        WebView webView = getWebView();
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
        }
    }

    // ─── Wake commands ───────────────────────────────────────────────

    private void queueWakeCommandLocked(WakeCommand command) {
        pendingWakeCommand = command;
        wakeCommandQueuedCount++;
        emitStateLocked();
    }

    private void dispatchPendingWakeCommandLocked(boolean retainUntilConsumed) {
        if (pendingWakeCommand == null) return;
        WakeCommand command = pendingWakeCommand;
        pendingWakeCommand = null;
        visualStable = false;
        interactiveReady = false;
        wakeCommandDispatchedCount++;
        setStateLocked("active");
        reason = "wake-command-dispatched";
        emitWakeCommandLocked(command, retainUntilConsumed);
    }

    private static WakeCommand wakeCommandForKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_PAGE_DOWN:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return new WakeCommand("next-page");
            case KeyEvent.KEYCODE_PAGE_UP:
            case KeyEvent.KEYCODE_DPAD_LEFT:
                return new WakeCommand("prev-page");
            default:
                return null;
        }
    }

    private static boolean isSupportedPageKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_PAGE_DOWN
                || keyCode == KeyEvent.KEYCODE_PAGE_UP
                || keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT;
    }

    // ─── State tracking ──────────────────────────────────────────────

    private void setStateLocked(String nextState) {
        if (state.equals(nextState)) return;
        long now = SystemClock.elapsedRealtime();
        long elapsed = now - lastStateChangedAtMs;
        switch (state) {
            case "busy":                busyMs += elapsed;              break;
            case "ready_to_hibernate":  readyToHibernateMs += elapsed;  break;
            case "hibernating":         hibernatingMs += elapsed;       break;
            case "waking":              wakingMs += elapsed;            break;
            default:                    activeMs += elapsed;            break;
        }
        state = nextState;
        lastStateChangedAtMs = now;
    }

    // ─── WebView control ─────────────────────────────────────────────

    private void pauseWebView() {
        mainHandler.post(() -> {
            WebView wv = getWebView();
            if (wv != null) { wv.onPause(); wv.pauseTimers(); }
        });
    }

    private void resumeWebViewOnMainThread() {
        mainHandler.post(() -> {
            WebView wv = getWebView();
            if (wv != null) { wv.resumeTimers(); wv.onResume(); }
        });
    }

    private WebView getWebView() {
        Bridge b = bridgeRef.get();
        return b != null ? b.getWebView() : null;
    }

    // ─── Plugin event emission ───────────────────────────────────────

    private void emitStateLocked() {
        EinkPowerPlugin p = pluginRef.get();
        if (p != null) p.emitHibernateStateChanged();
    }

    private void emitWakeCommandLocked(WakeCommand command, boolean retainUntilConsumed) {
        EinkPowerPlugin p = pluginRef.get();
        if (p != null) p.emitWakeCommand(command.toJsObject(), retainUntilConsumed);
    }

    // ════════════════════════════════════════════════════════════════════
    //  Profiling / stats
    // ════════════════════════════════════════════════════════════════════

    public synchronized JSObject toJsObject() {
        long now = SystemClock.elapsedRealtime();
        long cActive = activeMs, cBusy = busyMs, cReady = readyToHibernateMs;
        long cHibernating = hibernatingMs, cWaking = wakingMs;
        long elapsed = now - lastStateChangedAtMs;
        switch (state) {
            case "busy":                cBusy += elapsed;        break;
            case "ready_to_hibernate":  cReady += elapsed;       break;
            case "hibernating":         cHibernating += elapsed; break;
            case "waking":              cWaking += elapsed;      break;
            default:                    cActive += elapsed;      break;
        }

        long sessionAge = now - sessionStartedAtMs;
        long awake = cActive + cBusy + cReady + cWaking;
        double awakePct = sessionAge > 0 ? awake * 100.0 / sessionAge : 0;
        double hibPct   = sessionAge > 0 ? cHibernating * 100.0 / sessionAge : 0;

        JSObject data = new JSObject();
        data.put("state", state);
        data.put("mode", mode);
        data.put("eligible", eligible);
        data.put("reason", reason);
        data.put("gestureModel", gestureModel);
        data.put("pendingCriticalWork", pendingCriticalWork);
        data.put("mediaActive", mediaActive);
        data.put("visualStable", visualStable);
        data.put("interactiveReady", interactiveReady);
        data.put("hibernating", hibernating);
        data.put("waitingForInteractiveReady", waitingForInteractiveReady);

        JSObject stats = new JSObject();
        stats.put("sessionStartedAtMs", sessionStartedAtMs);
        stats.put("sessionAgeMs", sessionAge);
        stats.put("hibernateCount", hibernateCount);
        stats.put("wakeResumeCount", wakeResumeCount);
        stats.put("wakeTimeoutCount", wakeTimeoutCount);
        stats.put("wakeCommandQueuedCount", wakeCommandQueuedCount);
        stats.put("wakeCommandDispatchedCount", wakeCommandDispatchedCount);
        stats.put("criticalWorkStartedCount", criticalWorkStartedCount);
        stats.put("criticalWorkCompletedCount", criticalWorkCompletedCount);
        stats.put("completedWakeCount", completedWakeCount);
        stats.put("avgWakeReadyLatencyMs",
                completedWakeCount > 0 ? (double) totalWakeReadyLatencyMs / completedWakeCount : null);
        stats.put("awakeMs", awake);
        stats.put("awakeSharePercent", awakePct);
        stats.put("hibernatingSharePercent", hibPct);

        JSObject durations = new JSObject();
        durations.put("activeMs", cActive);
        durations.put("busyMs", cBusy);
        durations.put("readyToHibernateMs", cReady);
        durations.put("hibernatingMs", cHibernating);
        durations.put("wakingMs", cWaking);
        stats.put("durations", durations);
        data.put("stats", stats);

        return data;
    }

    public synchronized void resetStats() {
        long now = SystemClock.elapsedRealtime();
        sessionStartedAtMs = now;
        lastStateChangedAtMs = now;
        wakeStartedAtMs = waitingForInteractiveReady ? now : 0L;
        activeMs = busyMs = readyToHibernateMs = hibernatingMs = wakingMs = 0L;
        totalWakeReadyLatencyMs = 0L;
        hibernateCount = wakeResumeCount = wakeTimeoutCount = 0;
        wakeCommandQueuedCount = wakeCommandDispatchedCount = 0;
        criticalWorkStartedCount = criticalWorkCompletedCount = completedWakeCount = 0;
        emitStateLocked();
    }
}
