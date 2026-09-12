# Runtime audit, second wave

Five distinct P1 failures reproduced and fixed. This batch does not count the eight first-wave runtime causes again. No model requests or external side effects were needed for these measurements. Root owns integrated checks and real-app verification.

| ID | Severity | User impact | Measured A | Measured B |
| --- | --- | --- | --- | --- |
| T1 | P1 | Tightening a task from Full to Ask could appear saved but revert to Full after restart when its settings write failed. | Injected ENOSPC: 0 errors reported; memory becomes Ask while the durable file remains Full. | 1 error reported; both memory and durable file retain the last successful Full value. Existing restart tests confirm successful saves restore the chosen mode. |
| T2 | P1 | Stop did not stop the workflow: later nodes could still run tools or scripts; running scripts had no runtime ownership or cancellation. | Stopping node one still executes 2 of 2 agent nodes and completes the job. Abort of a real 250 ms script is ignored; it emits its delayed output. | Only node one starts; 0 completion/chaining requests. The real script rejects after Stop, before its delayed output. One focused observation took 45 ms rather than 299 ms; this is cancellation behavior, not a performance benchmark. |
| T3 | P1 | A failed script was passed to later nodes as successful data and could trigger downstream publication or dependent jobs. | Real script exits 7 with `database unavailable`: 1 downstream agent starts and 1 completion request succeeds. | 0 downstream agents and 0 completion requests; failure notice includes the script error. |
| T4 | P1 | Jobs arriving during startup could use default model, privacy and tool settings before the saved configuration had loaded. | 1 model turn starts while configuration is unresolved; it uses fallback instead of the subsequently restored local provider. | 0 starts before readiness, then 1 turn using the restored provider. Failed initialization produces a notice and 0 model work; a later successful restoration allows the next job. |
| T5 | P1 | A task pinned to a deleted local/custom provider silently fell back to another provider, potentially sending its content outside the intended endpoint. This also occurs after startup. | 1 fallback harness turn starts when `provider:removed` has no profile. | 0 harness turns; the task receives a provider-unavailable error before execution. |

## T1: durable permission context falsely acknowledges save

`rememberThreadContext` in `desktop/main/main.ts` updated the shared Map before writing `thread-contexts.json`, then swallowed every write error. Both desktop `set-thread-context` and phone context updates call this function and therefore treated a failed save as successful. `loadThreadContexts` later restores the older file. Successful writes now replace the file atomically before committing the Map; failed writes clean up the temporary file and propagate to the caller. This also prevents an interrupted write from truncating unrelated task contexts.

The focused failure fixture injects ENOSPC at the filesystem boundary and verifies both durable state and in-memory state. It does not claim to simulate an actual full user disk.

## T2: workflow has no cancellation owner

`runScheduledWorkflow` previously existed outside the stopped-agent state. `cancelThreadWork` cancelled the active harness only, and each following `driveTurn` cleared the previous stop marker. A script did not appear as a live run at all.

A workflow now holds an AbortController until settlement. Thread Stop, Stop all and app shutdown abort that controller. Every awaited transition checks cancellation, scripts accept the signal and kill their process group on macOS, and scripts adopt/finish an AgentRuntime run so the UI can display Stop. Cancellation never invokes `finishScheduledJob`. The running-script and multi-node cases are one root cause.

## T3: failed node values masquerade as success

`runWorkflowScript` resolved strings for launch failure, timeout, signal exit and nonzero status. The orchestration callback additionally caught path and launch errors and returned another success string. The shared workflow runner legitimately continued after that callback resolved.

Script failure now rejects with captured output and exit detail. The orchestrator records a visible failure notice and skips later nodes and dependent-job completion. A failed/stopped agent node is likewise treated as a failed workflow transition. Existing successful script input/output and workflow branching tests remain intact.

## T4: scheduled dispatch outruns configuration restoration

`Host.receive` immediately dispatches `dueJob`, including startup/launch jobs. `startHost` runs before renderer initialization. Providers, routers, disabled tools, prompts, privacy preferences and selected model are restored later through renderer IPC; there was no readiness boundary.

`runScheduledWorkflow` now awaits a trusted main-window initialization result. The renderer awaits settings, zero-retention configuration and model restoration before acknowledging readiness. Overlay/system-prompt settings now use an acknowledged invoke rather than a fire-and-forget send. Configuration failure is reported to waiting workflows without any paid/model work. Startup waiting is bounded to 30 seconds, and late successful initialization replaces the failed gate. The app always opens its workspace during startup, and no native full-settings persistence boundary exists to reuse.

A failed renderer initialization resets its restoration guard so changing model/settings in the same window retries initialization. Tests cover both the renderer guard and execution after subsequent success. A timeout does not silently drop a job: its scheduled thread receives a failure notice and can be run again. Root should verify the real UI recovery flow and startup jobs with an isolated profile.

## T5: missing pinned provider silently falls back

`providerFor` returns undefined for absent profiles, and `providerRoute` previously interpreted this identically to a route that intentionally needs no custom provider. `runTurn` could then construct the default harness and send content through it. The route now rejects an explicit `provider:` key without a profile. The test uses the real lifted `runTurn` and routing function to count harness starts; this is independent of startup readiness.

## Changes and checks

Source changes in this wave:

- `desktop/main/main.ts`: atomic context save, workflow cancellation/settlement, startup readiness, missing-provider guard, acknowledged prompt restoration.
- `desktop/main/workflow-script.ts`: AbortSignal support and rejected script failures.
- `desktop/main/preload.ts`, `desktop/src/types.ts`: local readiness and acknowledged settings IPC.
- `desktop/src/App.tsx`: await initial settings/model restore, signal initialization result, permit retry after settings change.
- New tests: `desktop/test/workflow-runtime.test.ts`, `desktop/test/runtime-startup.test.ts`.
- Existing AST fixtures adapted narrowly in `thread-model-main.test.ts`, `schedule-ipc.test.ts`, `runtime-controls.test.ts`; original assertions remain.

A artifacts:

- `/private/tmp/shinbo-runtime-round2-before/main/main.ts` and `workflow-script.ts`: source immediately before T1–T3.
- `/private/tmp/shinbo-runtime-round2-a/results.log`: 0/4 regression tests pass before T1–T3.
- `/private/tmp/shinbo-runtime-round2-before/main/main-pre-readiness.ts`: source before T4/T5.
- `/private/tmp/shinbo-runtime-round2-pre-ready/results.log`: 0/2 regression tests pass before T4/T5.

B compiled output and test log: `/private/tmp/shinbo-runtime-round2-final/dist-main` and `/private/tmp/shinbo-runtime-round2-final/results.log`. The focused suite includes workflow runtime, renderer startup restoration, script execution, task model persistence, earlier runtime controls, schedule IPC and shared workflow behavior. Final counts are recorded below after the run completes.

These are local desktop IPC changes; no phone bridge fields were added. Windows process-tree cancellation, packaged startup, permissions/UI behavior and actual scheduled-job interaction remain for integrated/platform verification. Existing first-wave Zig/Rust changes are outside this wave.

Final focused result: **48/48 pass, 0 failures, 0 skips**. Main TypeScript compilation to the isolated output passed; renderer TypeScript check passed; ESLint on all touched source/test files passed. No shared distribution output or user profile was rebuilt by this investigator.

Next uncounted lead from root: automatic review inherits a parent's Full mode; current explicit review edit rejection appears limited to native `kind === "edit"`, while shell execution and app-owned mutation tools may bypass the read-only review promise. This has not been reproduced or fixed in this batch. Trace review creation through native and app-tool permissions using harmless temporary files before classifying it.
