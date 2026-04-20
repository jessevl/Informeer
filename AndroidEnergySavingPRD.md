PRD: Informeer Android E-Ink Power Wrapper

1. Summary

Objective:
Build a Capacitor-based Android wrapper for Informeer that reduces battery drain on Boox and similar E-ink Android devices by hibernating the WebView between user actions when the app is in a safe, idle reading state.

Validation summary:
- The core approach is technically viable on Android WebView.
- `WebView.onPause()` only pauses best-effort processing such as animations and geolocation.
- `WebView.pauseTimers()` is the critical mechanism because it pauses JavaScript timers.
- The approach is not safe as a blanket app-wide behavior because `pauseTimers()` is global for all WebViews in the process.
- The approach should be used only in explicitly eligible modes and only when no media, sync, generation, download, or active gesture stream is in progress.

Expected outcome:
- Significant savings are plausible in static reading modes, especially EPUB and PDF/magazine reading where interaction happens in bursts separated by long idle periods.
- Savings will be limited or negligible in audio, video, active TTS, downloads, or continuous scrolling modes because hibernation must be disabled there.
- Near-native reader efficiency is possible only in the narrowest case: offline paginated reading with no media and no background work. It should not be promised as a general app-wide result.

2. Product Goal

Primary goal:
Reduce idle drain while Informeer is open on an E-ink Android device and the user is reading static content.

Secondary goals:
- Preserve fast page-turn feel on E-ink hardware.
- Avoid truncating progress sync or offline queue writes.
- Avoid wake/resume bugs in EPUB, PDF, and fullscreen reader overlays.
- Keep audio, video, and TTS modes fully functional by excluding them from hibernation.

Non-goals:
- Do not attempt to hibernate during podcast playback, video playback, or TTS generation/playback.
- Do not freeze the app during active downloads, uploads, or content extraction.
- Do not require a second WebView or a multi-process renderer architecture in phase 1.

3. Why The Original PRD Is Incomplete

The original design is directionally correct but too narrow for Informeer.

Problems in the original version:
- It assumes one reader mode with one simple “page turn then sync” lifecycle.
- Informeer has persistent audio, video, and TTS players mounted at the app shell level.
- Informeer also runs focus-refresh and offline sync behavior from the root shell.
- EPUB reading uses an iframe with direct touch listeners inside the iframe document.
- Magazine reading has a PDF viewer with wake/sleep resilience requirements already visible in the codebase.
- Generic `addJavascriptInterface` exposure is risky because WebView injects it into all frames, including iframes, and Informeer renders untrusted article content and EPUB content.

Conclusion:
The wrapper must be mode-aware, policy-driven, and Capacitor-native rather than a single raw `window.AndroidBridge.onWorkComplete()` bridge.

4. Current Informeer Mode Map

Relevant app modes in scope:
- Home/feed list and article reading
- Books library and EPUB reader
- Magazines library and PDF viewer
- Audio/podcast playback
- Video playback
- TTS generation and playback
- Offline sync queue, focus-refresh, and reconnect flows

Important codebase constraints:
- Audio syncs progress periodically and on pause/stop.
- Video syncs progress periodically and tracks local YouTube position.
- TTS generates chunks incrementally in a worker and streams audio.
- EPUB reader handles swipe gestures inside an iframe document.
- PDF viewer already re-renders on visibility return to survive mobile sleep/backgrounding.
- Focus refresh and offline queue flushing run from the root shell after visibility/focus changes.

5. Decision

Decision:
Proceed with a Capacitor Android wrapper, but scope hibernation to eligible reading states only.

Phase 1 eligible surfaces:
- EPUB reader
- PDF/magazine viewer
- Book reader fullscreen surfaces

Phase 2 optional surfaces:
- Article reader when settled and not actively scrolling
- Static library/list views on E-ink devices

Explicitly ineligible surfaces:
- Audio playback active
- Video playback active
- TTS model loading, generation, waiting-for-chunk, or playback active
- Any file upload/download in progress
- Any unresolved API sync required before suspend
- Search modal, login form, text input, or software keyboard visible
- Drag, pinch, or scroll gestures in progress

6. Feasibility Assessment

Will it work?
Yes, with constraints.

What definitely works:
- Android WebView can be paused and resumed.
- JavaScript timers can be globally paused and resumed.
- Capacitor supports custom Android plugins and custom activity code.
- MainActivity can intercept touch and key events before the WebView handles them.

What does not work as originally written:
- Raw hibernation after every generic interaction is unsafe.
- A single JS callback is not enough to know whether the app is safe to freeze.
- Relying on raw touch replay alone is not enough for EPUB because its important gesture handlers live inside an iframe.
- Raw `addJavascriptInterface` is not an ideal interface for this app because it is exposed to all frames.

Security note:
- Prefer a local Capacitor plugin for JS-to-native calls.
- Do not expose a powerful raw JS interface to every frame unless there is no practical alternative.

7. Battery Savings Assessment

How meaningful are the savings likely to be?

Reader modes:
- Likely meaningful.
- On E-ink devices, users spend long periods on a static page after a short burst of JS activity.
- If timers, polling, animations, progress checks, and idle callbacks stop between page turns, the WebView process should wake less often.
- A reduction on the order of 30% to 70% in idle reader-mode drain is plausible.

Audio, video, and TTS modes:
- Little to no benefit because hibernation must stay disabled.

Realistic expectation:
- Pure offline EPUB/PDF reading: strong improvement, potentially close to native-reader behavior.
- Online article/feed reading: moderate improvement, but less than offline readers due to network and scroll-heavy behavior.
- Mixed app usage across readers, feeds, and media: modest overall improvement, not native parity.

Metric guidance:
- The target of “under 2% per hour while app is open” is plausible only for static eligible reader modes.
- Do not use that number as a global product promise across all app modes.

8. Product Requirements

8.1 Platform Scope

Required:
- Android only in phase 1
- Capacitor shell around the existing frontend
- Optimized primarily for Boox Android 11/12+ devices

Optional later:
- Bigme, Meebook, and other E-ink Android vendors after validation

8.2 Eligibility Engine

The wrapper must hibernate only when all of the following are true:
- Device is Android and detected as an E-ink-target build or E-ink mode is enabled
- Current surface is marked hibernation-eligible
- No audio, video, or TTS playback or generation is active
- No pending “must-complete-before-sleep” work exists
- No gesture is currently in progress
- No text field is focused and no IME is open
- App is foregrounded and visible

The wrapper must not hibernate when any of the following are true:
- Current mode is audio, video, or active TTS
- A page-turn-triggered sync request is still unresolved
- Offline queue flush is actively writing
- Download, upload, or parsing work is active
- The user is actively scrolling or pinching

8.3 Native Wake Interception

The native layer must:
- Resume the WebView immediately on the first wake event
- Buffer the wake gesture until the JS layer is ready
- Convert recognized page-turn gestures into explicit commands when needed
- Support both touch events and hardware page-turn keys where available

Wake sources to support:
- Touch down
- Horizontal swipe
- Tap
- Page-up/page-down hardware buttons
- D-pad left/right if present on device

8.4 JS Coordination

The frontend must explicitly tell native:
- what mode it is currently in
- whether hibernation is allowed
- whether work has started
- whether work has fully completed
- whether the first stable frame after work is ready

This must be a stateful controller, not a single callback.

9. Proposed Architecture

9.1 Native Layer

Build a Capacitor plugin, for example:
- `EinkPowerPlugin`

Responsibilities:
- Maintain hibernation state
- Pause and resume the WebView on the UI thread
- Intercept touch and key events in MainActivity
- Detect swipe vs tap vs hardware page-turn
- Buffer wake commands during engine warm-up
- Dispatch wake commands back to JS after resume

MainActivity responsibilities:
- Extend `BridgeActivity`
- Register the plugin
- Override `dispatchTouchEvent`
- Override `dispatchKeyEvent` for Boox page buttons and similar hardware keys

9.2 JS Layer

Build a frontend controller, for example:
- `frontend/src/services/einkPower.ts`

Responsibilities:
- Track current mode
- Track active media state
- Track pending required work count
- Track whether current surface is eligible
- Expose `beginCriticalWork()` and `endCriticalWork()` helpers
- Expose mode-specific hooks for readers and players
- Notify native only when the app is truly safe to hibernate

9.3 App State Machine

States:
- `ACTIVE`
- `BUSY`
- `READY_TO_HIBERNATE`
- `HIBERNATING`
- `WAKING`
- `RESUMED_WAITING_FOR_JS_READY`

Rules:
- Enter `BUSY` when a page turn or other tracked user action starts.
- Enter `READY_TO_HIBERNATE` only after rendering, progress persistence, and required async work are complete.
- Enter `HIBERNATING` only from `READY_TO_HIBERNATE`.
- On touch or key wake, enter `WAKING`, call `resumeTimers()` and `onResume()`, and buffer any page-turn command.
- JS sends `interactiveReady` after it can process the next command; native then replays the buffered command if one exists.

10. Native/JS Interface

Do not use a single `window.AndroidBridge.onWorkComplete()` interface as the primary design.

Preferred interface:
- Capacitor plugin methods from JS to native
- Native listener events or targeted JS injection from native back to the main frame

Suggested plugin surface:

```ts
type ReaderMode =
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

interface SetPowerStateOptions {
    mode: ReaderMode;
    eligible: boolean;
    reason?: string;
    mediaActive: boolean;
    pendingCriticalWork: number;
    gestureModel?: 'paginated' | 'scroll' | 'none';
}

interface WakeCommand {
    type: 'next-page' | 'prev-page' | 'tap' | 'raw-pass-through';
    x?: number;
    y?: number;
}

setPowerState(options: SetPowerStateOptions): Promise<void>;
beginCriticalWork(tag: string): Promise<void>;
endCriticalWork(tag: string): Promise<void>;
markVisualStable(): Promise<void>;
notifyInteractiveReady(): Promise<void>;
setMediaState(options: { audio: boolean; video: boolean; tts: boolean }): Promise<void>;
```

Native events back to JS:
- `wakeCommand`
- `hibernateStateChanged`

11. Reader-Mode Behavior

11.1 EPUB Reader

Status:
- Highest-value target.
- Strong candidate for phase 1.

Why special handling is required:
- EPUB gestures are attached inside an iframe document.
- The native layer cannot assume a plain outer WebView swipe is enough.

Required design:
- Native intercept resumes the WebView on `ACTION_DOWN`.
- If a page-turn swipe is recognized during wake, native buffers `next-page` or `prev-page`.
- After JS reports `interactiveReady`, native dispatches the buffered command.
- JS command targets must call the same internal page-turn functions already used by the reader.

Frontend requirement:
- Expose stable main-frame functions for page turn commands, for example through a controlled registry object such as `window.__INFORMEER_EINK__`.
- These functions must delegate to the current live `nextPage` and `prevPage` handlers.

11.2 PDF / Magazine Viewer

Status:
- Highest-value target.
- Strong candidate for phase 1.

Why it fits:
- PDF reading is strongly paginated and has long idle windows.
- Existing viewer already has visibility-return logic, which suggests suspend/resume is manageable.

Required design:
- Same wake buffering model as EPUB.
- Native swipe detection can safely map to `next-page` and `prev-page` commands.
- JS must report visual stability only after the page canvas render settles.

11.3 Article Reader

Status:
- Conditional.
- Better as phase 2.

Why lower priority:
- This surface is scroll-based, not page-based.
- Users may interact continuously with vertical scrolling.
- Waking on every small scroll reduces benefit.

Allowed phase 2 design:
- Only hibernate after a short idle timeout once scrolling has fully stopped.
- Wake on `ACTION_DOWN` and pass raw touch through after resume.
- Do not synthesize page-turn commands here.

11.4 Feed Lists / Libraries

Status:
- Optional.
- Low-value compared with readers.

Design:
- Only hibernate when completely idle.
- Wake on touch down and let the raw gesture continue after resume.
- No synthetic swipe-to-next-page semantics.

12. Media-Mode Behavior

12.1 Audio / Podcasts

Required:
- Hibernation disabled whenever audio is playing, buffering, or syncing playback state.
- Sleep timer logic must continue to function.
- Progress sync intervals must not be frozen during playback.

12.2 Video

Required:
- Hibernation disabled whenever video is active.
- Applies to enclosure video and embedded YouTube playback.
- Do not attempt partial support in phase 1.

12.3 TTS

Required:
- Hibernation disabled whenever the TTS model is loading, generating, waiting for chunk, or playing.
- This includes worker-backed chunk generation and queue transitions.

13. Critical Work Definition

The app may hibernate only after all critical work completes.

Critical work includes:
- Reader render completion
- Required progress persistence
- Required API sync for current action if online
- Offline queue write if offline fallback is used
- Any JS callback chain required to settle the current view state

Non-critical work examples:
- Cosmetic animations
- Lazy image loads not required for current page stability
- Prefetching future content
- Best-effort analytics

14. Visual Stability Rule

Do not hibernate immediately after React state updates.

Required:
- The frontend must call `markVisualStable()` only after the user-visible frame is actually ready.

Mode-specific guidance:
- EPUB: after the rendition location settles and any immediate progress write is queued
- PDF: after canvas render completes for the visible page or spread
- Article and list views: after the DOM commit and any required scroll restoration complete

Optional native enhancement:
- Use `WebView.postVisualStateCallback()` as an additional confirmation before entering hibernation.

15. Gesture Model

15.1 Native Intercept Rules

On wake:
- On `ACTION_DOWN`, immediately call `resumeTimers()` and `onResume()` on the UI thread.
- Set `isHibernating = false`.
- Start a short warm-up window.
- Feed the event into a native gesture detector.

If a paginated swipe is recognized during the warm-up window:
- Consume the raw event stream.
- Buffer `next-page` or `prev-page`.
- Replay the command into JS once `interactiveReady` arrives or a small timeout elapses.

If a tap is recognized:
- If the JS layer is ready, pass through coordinates.
- If not ready, buffer a tap command.

15.2 Hardware Keys

Required for Boox-targeted implementation:
- Intercept `KEYCODE_PAGE_DOWN` and `KEYCODE_PAGE_UP` if present.
- Optionally intercept D-pad left and right for reader surfaces.
- Map these to the same buffered wake command path.

16. Failure Handling

Required safeguards:
- If resume fails or JS readiness never arrives, do not drop the user input silently.
- If wake command replay times out, fall back to passing the next raw event through.
- If the WebView renderer dies, recover gracefully and disable hibernation until the page reloads cleanly.
- If any media mode is detected unexpectedly during hibernation, resume immediately and disable hibernation for that session.

17. Metrics

17.1 Success Metrics

Battery:
- Measure battery drain by mode, not globally.
- Target offline EPUB or PDF idle-open drain reduction of at least 30% from baseline.
- Stretch target for offline paginated reading: under 2% per hour on Boox Go 10.3-class hardware.

Latency:
- Wake-to-page-turn under 100 ms median
- Wake-to-page-turn under 150 ms p95

Integrity:
- Zero truncated progress sync operations in eligible reader modes
- Zero dropped page-turn commands during wake

17.2 Telemetry

Record:
- current mode
- whether hibernation was entered
- reason hibernation was denied
- wake latency
- buffered command type
- replay success or failure
- renderer crash count while feature enabled

18. Test Plan

Required device validation:
- Boox Go 10.3
- One additional Android E-ink device if available

Required scenarios:
- EPUB page turns online
- EPUB page turns offline
- PDF or magazine page turns online
- PDF or magazine page turns offline
- Open app and leave on a static page for 30 to 60 minutes
- Wake with tap
- Wake with swipe
- Wake with hardware page buttons
- Switch from reader to audio and confirm hibernation disables
- Start TTS and confirm hibernation disables
- Return from OS sleep and confirm reader state is preserved

Battery validation method:
- Establish baseline with current web app behavior on device
- Compare with wrapper build using `adb shell dumpsys batterystats`, Android Studio profiler, and long-session real-device measurements
- Report results separately for EPUB, PDF, article reader, feed list, and media modes

19. Implementation Phases

Phase 1:
- Capacitor Android shell
- `EinkPowerPlugin`
- Native wake interception
- Hibernation eligibility engine
- EPUB integration
- PDF or magazine integration
- Hardware page key support

Phase 2:
- Article reader idle hibernation
- Static list or library hibernation
- Additional device compatibility work
- Refinement of warm-up thresholds and heuristics

Phase 3:
- Explore renderer priority tuning only if phase 1 is stable
- Explore device-specific optimizations for Boox refresh modes and key layouts

20. Final Recommendation

Recommendation:
Implement this feature, but do it as a constrained reader-mode optimization, not as a global app suspension mechanism.

Best initial scope:
- EPUB reader
- PDF or magazine viewer
- Boox hardware page buttons

Do not promise:
- universal NeoReader battery parity
- meaningful gains during audio, video, or TTS modes

Do promise:
- substantial improvement for static paginated reading on supported E-ink Android devices when the app is otherwise idle