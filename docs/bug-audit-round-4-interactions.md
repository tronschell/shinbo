# Desktop interaction reliability audit — round 4

Scope: composer drafts, editor launchers, browser tabs, terminal panels and process lifecycle. Existing queue, microphone and artifact findings are excluded. Two reproducible roots fixed: one P1 and one P2. No quota is used.

| ID | Severity | Production trigger and user impact | A: original source | B: fixed source |
| --- | --- | --- | --- | --- |
| D1 | P1 | Renderer storage fills while editing another task. Saving that draft deletes previously saved, unsent drafts from other tasks. | Existing task's serialized draft disappears; new draft is also unavailable when storage remains full. | Existing serialized draft preserved byte-for-byte; unsaved current draft available on task revisit, save reports failure, and composer displays a persistent copy-before-quitting warning. Successful retry persists and clears fallback. |
| T1 | P2 | User opens the terminal pane, then hides it or switches tasks before the terminal-list IPC settles. | Obsolete lookup starts one hidden shell after cleanup. | Obsolete lookup starts zero shells; remounted pane starts exactly one. Rejected obsolete lookup also starts zero. |

## D1 — draft quota eviction

`desktop/src/context.ts` used the cache eviction helper for unsent drafts. On any storage write failure, the helper deleted every other key with the draft prefix, then retried the same write. Those drafts are original user work, not reconstructible cache data.

Draft persistence now preserves other records and returns success/failure. Only failed writes are retained in a module-local map so navigating among tasks does not discard the current draft. A successful write or clear removes that fallback. `desktop/src/App.tsx` consumes the result and keeps a visible alert while persistence is failing.

This fallback does not survive an application restart; the alert explicitly tells the user to copy the draft before quitting. It does not pretend to solve unavailable physical storage. Existing durable drafts remain intact.

The regression uses an enumerable synthetic Storage implementation, seeds one saved draft, then throws the same `QuotaExceededError` shape returned by browser storage. It invokes the actual imported production functions and checks durable bytes, failure reporting, task revisits, successful retry and clearing. The original snapshot loses the seeded draft and fails that byte-preservation assertion; the fixed source passes.

## T1 — abandoned terminal startup

`desktop/src/terminal-implementation.tsx` launched `start()` from both success and failure continuations of `listTerminals` without checking whether that effect still belonged to a mounted pane. Its `started` ref also made a naive cleanup fix skip the replacement effect under React effect replay.

The lookup now has an effect-local lifetime check and cleanup; the obsolete ref gate is removed. Existing shells still intentionally keep running when the user hides their pane. The fix prevents a new shell from being launched by an already abandoned lookup.

The regression extracts and executes the actual TypeScript effect from the source, controls the IPC promise boundary, invokes cleanup before settlement, replays the effect, and exercises both fulfilled and rejected obsolete lookups. It measures requested shell starts, not a duplicated implementation.

## Verification

A uses product files extracted from `/private/tmp/shinbo-bug-audit/source-before.tgz`, with the two new regressions copied into an isolated test tree. Both new regression tests fail on A with the claimed behavior: lost draft bytes and one shell started after cleanup. B runs the full composer-draft and terminal suites: 17/17 pass. Main TypeScript compilation, renderer typecheck and focused lint pass.

Isolated output directories: `/private/tmp/shinbo-round4-before/build` and `/private/tmp/shinbo-round4-interactions/build`. A output is retained at `/private/tmp/shinbo-round4-before/results.txt`.

Real-app visual verification of the draft warning and terminal navigation is assigned to the root investigator. This round did not verify VoiceOver or non-macOS behavior.

## Other inspected leads

Editor discovery, browser navigation/tab selection, terminal replay and shutdown were inspected. No additional issue is counted on source suspicion alone. The terminal control-pipe error lead was not changed: a previous investigator's real-process reproduction did not establish the proposed failure. Normal Unix shutdown kills the native PTY relay immediately, so a hypothetical delayed helper shutdown did not establish another production bug.
