# Renderer bug audit — investigator 1

Audited the current working tree without changing source. Existing edits were preserved. Read repository AGENTS.md and the ponytail skill. Four high-priority findings and five consequential P2 findings below; these are distinct root causes, not a claim of twelve findings. No real-app interaction has yet been performed. Runtime reproductions use current production TypeScript transpiled in memory with mocked boundaries, not copied implementations.

## R1 — P1 — Opening a task can change its permission mode and remove its working folder

Trigger: create a task or change its folder/permission mode from mobile; then open it in desktop. An equally concrete case is a task previously used with Full access on desktop, then restricted to Ask from mobile, and reopened on desktop.

Impact: simply reading the task overwrites the runtime context. The stale desktop Full access choice can replace the user's newer Ask choice, and a mobile-created task loses its connected folder. The main process immediately applies the replaced permission mode to the live agent.

Root cause: App.tsx:2092 initializes mode from renderer localStorage, 2115 initializes folderIds there, and 2223–2228 unconditionally writes those values on mount. Workspace loads native context at 822, but the native getThreadContext handler (main.ts:4383–4387) returns only model/effort, so the renderer cannot adopt native folders/mode/review. main.ts:4389–4393 stores the stale values and calls agents.setMode. Native thread-contexts.json is already durable and mobile updates that native record.

Minimal fix: expose the complete native thread context through the existing getter and initialize/synchronize ThreadView from it before any context write. Preserve the explicitly chosen folder on newly created desktop tasks by writing that choice to native context during creation. Do not solve this with a second independent context store.

A/B check: seed native context with folder B, Ask, review true; seed stale local context with folder A, Full, review false. Open task. Before: native becomes A/Full/false. Required after: B/Ask/true remains, zero unsolicited permission changes. Add executable mount/IPC coverage and exercise a real mobile-to-desktop switch. Native/renderer flow is traced; this A/B has not yet been run.

## R2 — P1 — Sending during refresh starts two queue drainers

Trigger: send a second prompt immediately after the prior request completes while the snapshot refresh is still pending.

Impact: the same prompt gets submitted twice. A duplicate rejected by the main-process active-run guard still executes the renderer failure path, clears the real run's pending/blocks, dequeues its item, and can consume later queued prompts while the real request is running. If both reach an asynchronous startup boundary before the backend guard is occupied, duplicate execution is also possible; that latter case is not needed to establish the bug.

Root cause: runs.ts:474–511 drain publishes sending=false before awaiting reload(). sendTurn:392–395 treats sending=false as permission to start another drain. The original loop resumes against the same queue head without checking ownership.

Measured before: `node /tmp/shinbo-renderer-audit.cjs` transpiles the current runs.ts and yields `sent=["first","second","second"]`, concurrentSecondRequests=2. The first reload is deliberately deferred; the second send occurs during it. No model or network is involved.

Minimal fix: retain exclusive per-thread drain ownership across refresh and only release it when the queue is empty, or keep sending/ownership set until the refresh finishes. Ensure a rejected/throwing reload cannot strand ownership.

Required after: exactly one request for second; a third queued prompt is sent once after second; no interval reports the thread idle while its owned request remains unresolved. Put the reproduction in desktop/test/runs.test.ts, then exercise rapid follow-up submission in the app.

## R3 — P1 — Consecutive send failures irreversibly lose earlier user prompts and their context

Trigger: queue multiple prompts, then have their requests fail before acceptance (for example unavailable model configuration, IPC/persistence failure, or connection failure).

Impact: only the final failed prompt remains recoverable. Earlier submitted text is gone from composer/local draft and the queue, and attachments/skill context cannot be restored by the retry button. This is loss of user-entered work, not merely an error display issue.

Root cause: App.tsx:2453–2456 consumes the composer text/picks/skill immediately. runs.ts:495–500 stores only `draft: next.content`, replacing the prior failure, and 505 shifts each failed turn off the queue. No failed-turn collection preserves params/prepare/attachments. `takeDraft` returns a string; App.tsx:2667 restores only that string. Attachment history stores display metadata, not a retryable ContextPick/skill record.

Measured before: the same current-production repro queues two failures. Output: draft="second failed", retainedQueue=[], held=[], pending=null. Two submitted prompts become one recoverable prompt; the first turn's image and skill parameters become zero recoverable parameters.

Minimal fix: keep failed turns with their full delivery context in the existing held queue, or stop draining and retain the failed queue head plus all following prompts. Retry should resend the complete saved turn. Avoid creating another parallel queue abstraction.

Required after: two failed submissions leave two recoverable turns; image/skill IDs and original order survive retry; the current unsent composer draft remains untouched. A/B metrics: recovered prompts 1→2, recovered first-turn context parameters 0→2. Add a regression to runs/composer-send tests.

## R4 — P1 — Microphone capture can start after cancellation or component teardown

Trigger: begin dictation while getUserMedia is pending (especially the first macOS microphone permission prompt), then cancel/blur/release Space or unmount before permission resolves.

Impact: granting permission later starts recording after the user's cancellation; on unmount there is no remaining UI owner to stop it. The audio track remains live.

Root cause: voice.ts:94–110 only checks recording.current before awaiting record(). cancel and the unmount cleanup can cancel only an already-created Recording. The pending promise later assigns recording.current and marks listening=true without an operation token or cancellation check. useSpaceHold also only stops on key release if the captured listening value is already true.

Measured before: `node /tmp/shinbo-voice-audit.cjs` evaluates current production useDictation with deferred getUserMedia and a fake native track. Both cancel-before-grant and unmount-before-grant leave liveTracks=1. The first case has stoppedTracks=0.

Minimal fix: track the start attempt with a ref/token, invalidate it on cancel and unmount, and immediately cancel the returned Recording when the token is stale. Prevent concurrent starts while a start is pending. Space release must cancel the pending start as well as stop active capture.

Required after: liveTracks=0 for cancel, blur, Space release and unmount during startup; one start for repeated activation; ordinary dictation still transcribes. Native privacy prompt/real microphone exercise remains required.

## R5 — P2 — Quick-action answers are not the context for their visible follow-ups

Trigger: invoke one of the overlay quick-action buttons/shortcuts, get an answer, then type “make that shorter” or another follow-up in the same visible conversation.

Impact: follow-up runs in a new thread, or an older unrelated thread if one was already present, without the quick-action answer it appears to reference.

Root cause: Overlay.runAction (App.tsx:5355–5374) creates and answers a thread but never calls setThread(created/answered). Normal Overlay.send uses `thread` (5310) to select continuation context, whereas both routes append to the same visible `turns` transcript.

Minimal fix: make the completed quick-action thread the overlay's current thread, or explicitly present quick actions as isolated conversations with a corresponding switch. Existing conversation design favors setThread(answered).

A/B: quick action returns task Q; follow-up request threadId before is new/old O, after must be Q. Add a production-handler regression and exercise the visible quick-action→follow-up flow.

## R6 — P2 — Cmd/Ctrl+Enter bypasses attached context

Trigger: while an agent is running, attach an image/file/skill, write “use this instead”, then press Cmd/Ctrl+Enter.

Impact: the instruction is sent immediately without its attachment. The attachment remains in the composer and may later be sent with a different prompt. Queued-message steering correctly disables attached turns, but direct composer steering bypasses that rule.

Root cause: App.tsx:2433–2441 directly calls steerRunning(thread.id, message.trim()) without considering picks or skill. The normal send path captures both. canSteer and the queue button explicitly prohibit attached turns.

Minimal fix: when picks/skill exist, route the shortcut through ordinary queue submission (or leave the draft intact with a clear indication that it must be queued). Reuse the same eligibility decision used by queued turns.

A/B: one image + one prompt + shortcut; before steer calls=1, attachment delivery=0; after steer calls=0 and the queued turn carries the image once. Add to composer-send.test.ts.

## R7 — P2 — Removing the last selected weekday silently enables every day

Trigger: in Weekly on…, click the only selected weekday to deselect it.

Impact: an automation intended to have no selected run day becomes a daily automation. Its expensive or mutating work can execute on six extra days.

Root cause: schedule.tsx:weekly button handler permits an empty weekdays array. shared/workflow.ts:248 buildTrigger emits `*` when that array is empty; parseTrigger then interprets the resulting expression as daily. The UI switches kind immediately, removing the weekday choices.

Minimal fix: disallow deselecting the last weekday (smallest change), or preserve an explicitly invalid empty selection until a day is chosen. Do not map “none selected” to every day.

A/B: buildTrigger({...weekly, weekdays:[]}) currently produces daily cron. Exercise the real picker: final-day click must leave one selected day and identical schedule, with executions/week 1→1 instead of 1→7.

## R8 — P2 — “Every N days” is actually a day-of-month cron step

Trigger: choose Every 2 days or Every 7 days across a month boundary.

Impact: recurrence intervals differ from the displayed promise. Every 2 days can run on Jan 31 and Feb 1, only one day apart; Every 7 days can run Jan 29 and Feb 1, three days apart.

Root cause: shared/workflow.ts:247 maps daily.every to day-of-month `*/N`; describeTrigger:295 labels it an elapsed interval. crates/core/src/scheduled.rs:457–477 evaluates cron steps relative to the field start, so the cadence restarts monthly.

Minimal fix: make the picker/description accurately describe calendar-day stepping, or offer only daily cadence until true anchored intervals exist. Avoid introducing a new scheduler solely to preserve a misleading label.

A/B: compare advertised interval with actual adjacent executions at a month boundary. Before: label 2 days, actual minimum 1 day. After must either keep intervals at two days or accurately disclose the calendar schedule. No performance claim.

## R9 — P2 — Queued/held prompts vanish on renderer restart

Trigger: queue follow-up work or stop a run with queued prompts moved into Held, then reload/restart the app.

Impact: unsent user work disappears despite the separate normal composer draft surviving restart. Only currently executing work can be reconstructed from agent state.

Root cause: runs.ts stores queue/held solely in the module Map. App.tsx consumes the persisted composer draft on enqueue. wire/rehydrate restore live traces/partial output, but never queued/held turns.

Minimal fix: persist serializable pending delivery records and restore them as held (never silently auto-execute them on boot), including context payloads. If full callback serialization is impossible, prepare/retain stable context data before persistence. This needs more design than R2/R3 and should not be conflated with them.

A/B: one queued and one held prompt before module reload; before recoverable count=0, after=2 held prompts with context. Add a module-reload regression and restart the real app.

## Verification state

- Executed production-function reproductions: R2, R3, R4.
- Traced concrete native/renderer call flow: R1.
- Consequential P2 findings are source-traced with exact proposed behavioral checks; not counted as measured fixed outcomes.
- No fixes, commits, native UI changes, or external writes were performed.
- Full checks and real macOS interactions remain for the implementation phase. VoiceOver, privacy prompt behavior, shortcuts, and non-macOS paths are unverified.

# Implementation and measured A/B results

Completed R1, R2, R3, R4 and the specifically approved P2 R7. Other P2 findings remain unchanged. This is five distinct fixes, four classified P1 and one P2; twelve failing assertions are not twelve bugs.

| Finding | Measured A: original source | Measured B: fixed source | User impact |
| --- | --- | --- | --- |
| R1 | Native getter omits folder/mode/review. Opening a remote task issues one write of stale-project / Full / review off. | Getter returns complete native context. Opening issues zero context writes and caches remote-project / Ask / review on. | Reading a task does not loosen permissions or remove its working folder. |
| R2 | Sending during refresh submits second twice. A rejected refresh escapes as an unhandled rejection. | Second submits once; third follows once; failed refresh does not strand the drainer. | No duplicate submissions or queue corruption during refresh. |
| R3 | Two rejected submissions leave zero complete retryable turns and only one text-only legacy draft. | Both turns remain held; the first retains its two image/skill parameters. Retrying sends both original prompts in order with original context. | Earlier user input and attachments survive failures. |
| R4 | Pending cancel/stop/unmount returns successful startup; Space release/blur leaves one live track; repeated activation requests two microphones. | Canceled starts return false and release the track; live tracks after release/blur are zero; repeated activation requests one microphone. Retry after cancellation still starts normally. | Microphone capture cannot outlive canceled startup. |
| R7 | Deselecting Monday emits `0 9 * * *` — seven days per week. | Deselecting the only day leaves `0 9 * * 1`; adding/removing other days still works. | A weekly workflow cannot accidentally become daily. |

## Final implementation

- R1: native `shinbo:get-thread-context` returns folders, mode and review along with model/effort. Workspace owns the loaded context; ThreadView reads it directly. Only explicit controls write native context, and the UI updates after acknowledgment. New desktop tasks persist their selected folder/default mode before opening. Local storage remains a presentation cache.
- R2: a per-thread Set owns the drainer through snapshot refresh. Refresh failure is reported without stranding the queue or dropping ownership.
- R3: failed and canceled turns use the existing held queue with their params/prepare callback intact. Each failure keeps its reason and retry sends that complete turn. Removed the lossy single string draft/failure slot and its text-only restore UI. Existing settlement/composer tests now assert held-turn preservation.
- R4: each pending microphone start has an invalidatable identity; cancellation, stop and teardown invalidate it. A late successful acquisition immediately closes its track. Repeated starts are excluded, and Space release/blur invalidate pending acquisition.
- R7: the existing weekday click handler refuses to remove the final selected day; no new schedule representation was added.

## Checks executed

The original source was extracted from `/private/tmp/shinbo-bug-audit/source-before.tgz` to `/private/tmp/shinbo-renderer-before/desktop` and compiled there. The same compiled regression test bodies were run against that original production output/source and the fixed production output/source.

Original A, selected bug reproductions: **12 tests, 0 pass, 12 fail**. Every failure was inspected and matches its reported behavior: duplicate request, unhandled refresh rejection, missing retained turns, daily instead of weekly cron, missing native context fields, stale permission write, late live microphone or concurrent acquisition.

Fixed B, full affected test files: **82 tests, 82 pass, 0 fail**, including the same twelve reproductions and additional accepted/rejected context save and new-task initialization checks.

Logs:

- `/private/tmp/shinbo-renderer-fixes/targeted-a.log`
- `/private/tmp/shinbo-renderer-fixes/targeted-b.log`

Targeted B command, from `desktop`:

```sh
node --test --test-timeout=60000 /private/tmp/shinbo-renderer-fixes/dist-main/test/{runs,run-settlement,composer-send,thread-model-main,thread-model-renderer,voice-lifecycle,schedule-weekdays}.test.js
```

A uses the same test files against the archived build, selecting:

```sh
node --test --test-timeout=60000 --test-name-pattern='one drainer|failed refresh cannot|failed queued turns|native task context|opening a remote|microphone startup|Space-hold|repeated activation|weekly schedule' dist-main/test/{runs,thread-model-main,thread-model-renderer,voice-lifecycle,schedule-weekdays}.test.js
```

Also passed: dedicated `tsc -p desktop/tsconfig.main.json --outDir /private/tmp/shinbo-renderer-fixes/dist-main`, renderer `tsc --noEmit`, and ESLint on all modified renderer/test files. No full integrated build was run by this investigator concurrently with other agents. Root owns integrated checks and real-app interaction; native microphone permission prompts, VoiceOver and non-macOS behavior remain unverified here. The renderer requires the updated native getter when the running development app is restarted.
