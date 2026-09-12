# Startup and idle lifecycle audit — 2026-09-12

## Outcome

No new measured urgent performance defect was established in this bounded pass. No production source or tests were changed. Existing fixes and intended background behavior are not counted again.

## Traced lifetimes

- Startup is gated by the single-instance lock and `app.whenReady`. Main-window opening reuses the current window, restores it when minimized, and creates a replacement only after its closed handler clears the reference. React startup routes lightweight overlay/hotspot/run/cursor surfaces before constructing the full workspace.
- Machine sampling has one shared renderer timer, one visibility listener, an in-flight guard, a bounded sample history, and teardown when its last consumer unmounts. Hidden windows stop the timer; becoming visible restarts it once. The main process also coalesces concurrent probes. Machine facts retain completed results and coalesce initialization.
- `HarnessStatus` clears its interval and visibility listener on cleanup, pauses while hidden, and bounds concurrent report loads with one queued follow-up. Background output inspection polls only an expanded task and clears its interval when the task exits or the selection unmounts. Its existing two-second cadence and bounded output were not established as a new urgent bottleneck.
- The hotspot replaces its timer when display geometry changes, avoids rebuilding on unchanged geometry, creates its window only when the pointer is near, and destroys it when the pointer leaves. Application shutdown clears its timer. The native hotkey helper starts once during primary-instance startup and is killed on quit; retaining it while the main window is closed supports Quick Ask and is intentional.
- Update checking starts once during primary-instance startup. Focus, resume, and the five-minute timer share the same thirty-minute throttle. A downloaded update disables further automatic checks. No navigation path calls `startUpdates` again.
- Broadcasts enumerate live Electron windows and skip destroyed ones. The mobile conversion path runs only while the bridge has an active sender. The broad changed event already has a 150 ms coalescing window. No new unbounded queue or listener registration was found here; event payload costs already addressed in prior waves are not recounted.
- Notifications are created only when the main window exists and is not focused. Their click handlers reopen/focus the main window; the JavaScript code does not accumulate them in a collection. This code inspection does not establish native notification-center retention behavior.
- Paint fallback and resize-resync timers have finite two-second and fifty-millisecond lifetimes. The resize path has an in-flight guard. Quit flushing has a single-entry guard and a ten-second outer deadline. Existing process shutdown fixes are excluded from this pass.

## Operation-count checks

`/tmp/shinbo-perf-wave6-idle/audit.cjs` extracts the actual current main-window and hotspot functions, transpiles them, and injects fake windows, timers, geometry, and lifecycle events. It separately executes the actual updater module with injected Electron lifecycle objects and clock. It does not create a window, drive UI, access a user browser, or contact an update service. Its temporary update settings directory is removed in a finally block.

| Fixture | Observed behavior |
|---|---|
| 100 opens with the same live main window | 1 window created |
| Close, then open again | 2 creations total; first window destroyed |
| 100 unchanged hotspot geometry requests | 1 poll and 1 pending timer; no window while pointer is far |
| 100 warm-pointer timer callbacks | 1 hotspot window created; exactly 1 timer retained after each callback |
| Pointer leaves, then notch is removed | 1 window destroyed; 0 timers remain |
| 100 focus + 100 resume + 100 update timer events within the gap | 1 update check total and 1 interval |
| Next focus after thirty minutes | 1 additional update check |
| Further resume/timer after download | No additional checks; 1 ready announcement |

The existing machine tests additionally confirm that two concurrent main-process requests launch one probe, two mounted renderer consumers share one timer/listener, hiding delivers no new samples, restoring visibility restarts once, and removing the last consumer leaves no timer/listener. These are checks of existing correct behavior, not before/after improvements.

```sh
node /tmp/shinbo-perf-wave6-idle/audit.cjs
node --test /tmp/shinbo-perf-wave5-notes/compiled/test/machine.test.js /tmp/shinbo-perf-wave5-notes/compiled/test/update.test.js
```

All operation-count assertions and all 13 existing machine/update tests passed. The isolated compiled modules were available from the preceding wave; the renderer sampling test reads the current renderer source through that wave's source-directory links.

## Limits

This is bounded lifecycle inspection and deterministic execution, not a whole-application energy profile. Native notification retention, macOS occlusion behavior, Windows-specific probe timings, and display-hotplug storms were not measured. `readNotchGeometry` starts a short helper on display changes; ordinary repeated display-event work was not shown to cause an urgent stall. No speculative cleanup was applied based on that observation. The parent audit owns integrated app/UI verification.
