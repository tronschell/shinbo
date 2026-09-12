# Account and session lifecycle reliability

Four confirmed roots were fixed in this bounded round: two P1 and two P2. Fixtures use temporary files, fake credentials and local model responses. Measurements are failure/recovery counts, not speed claims.

| ID | Severity | Normal trigger and user impact | A | B |
| --- | --- | --- | --- | --- |
| R7-1 | P2 | A key replacement/removal fails to persist. Saving an unrelated key later silently commits that rejected change, changing or removing the original account connection. | Original account retained in 0/2 replacement/removal scenarios, both in memory and after reopening. | Original account retained in 2/2 scenarios, both in memory and after reopening. |
| R7-2 | P1 | A session-index write runs out of space after truncating the destination. Every previous conversation loses its durable harness association, and new model work still starts. | 0/12 prior session mappings remain parseable; 1 prompt starts; operation reports no failure. | 12/12 retained; 0 prompts start; failure is reported. A subsequent successful retry saves the thirteenth mapping. |
| R7-3 | P1 | Launch with an explicit `CODEX_HOME` containing a different signed-in account from the default home. ChatGPT turns read the default account instead of the configured account used by sign-in and model discovery. | Chosen `work-account`, actual `personal-account`: 0/1 correct. | Chosen and actual `work-account`: 1/1 correct. |
| R7-4 | P2 | Reopen the app, then Clear context before a harness starts. Both desktop and phone report success while retaining the old session. The desktop also marks context cleared before persistence succeeds. | Old mapping retained in 2/2 desktop/phone fixtures; clear marker appears before persistence in 2/2 renderer fixtures. | Old mapping removed in 2/2 while unrelated mapping survives; marker waits for success and remains absent on failure. |

## R7-1: failed credential transactions stay failed

Both desktop `shinbo:save-credential` and phone `saveCredential` call `CredentialStore.set`/`remove`, then refresh process credentials. Those store methods mutated Maps before encryption and disk persistence. When save failed, the caller received an error but the rejected change stayed in memory. An unrelated subsequent save wrote the entire mutated Map to disk and applied it to the process environment.

`CredentialStore` now calculates proposed readable/unreadable Maps, encrypts and atomically saves them, then commits those Maps only after the rename succeeds. Existing unreadable ciphertext preservation remains intact. This is a separate credential-store transaction boundary from the earlier task-context persistence fix.

The fixture injects a rename failure, then saves an unrelated key and reopens the store. It covers replacement and removal using fake account keys. No actual Keychain state was changed.

Changed source: `desktop/main/credentials.ts`. Regression: R7-1 tests in `desktop/test/credentials.test.ts`.

## R7-2: session-index durability gates model work

`shinbo-sessions.json` links desktop task IDs to the harness's persisted conversations. `saveSessionIndex` wrote directly to this file and swallowed write errors. A partial write destroys the whole JSON index; after process restart the loader sees no mappings. The desktop transcript remains on disk, but subsequent harness turns start without the prior conversational state, including tool history and compacted context.

The index now uses the existing `writeAtomicSync` helper. A proposed Map becomes current only after persistence succeeds, and session creation propagates failure before sending a model prompt. Deletion follows the same boundary. No new storage framework or duplicate conversation format was added.

The controlled ENOSPC fixture performs a real four-byte write before throwing. It is a simulation of partial disk failure, not a claim that the machine's disk was full. Twelve original mappings survive after the fix. Successful retry confirms the failed in-memory insertion did not prevent later recovery.

Changed source: `desktop/main/harness.ts`. Regression: R7-2 test in `desktop/test/harness.test.ts`. The shared atomic writer was already present and did not change in this round.

## R7-3: use the configured sign-in location

CLI model discovery already reads `CODEX_HOME` when set; the sign-in terminal inherits the process environment. `chatgptAuth`, used when selecting a ChatGPT model and again for every relay request, instead hardcoded `~/.codex/auth.json`. With a custom profile this could reject a valid sign-in or silently use another account that happened to exist in the default location.

Authentication now resolves the same environment override, falling back to the existing default path. Read errors identify the actual selected file. The fixture creates two fake profiles and reads only the selected account ID in a child process; it sends no upstream request.

Changed source: `desktop/main/chatgpt.ts`. Regression: R7-3 test in `desktop/test/chatgpt.test.ts`. Existing fake relay fixtures explicitly set their temporary `CODEX_HOME` so tests remain isolated from any real account configured in the parent environment; their cancellation/backpressure assertions are unchanged.

## R7-4: Clear context reaches saved sessions

Both native clear handlers iterated `harnesses.values()`. This Map is initially empty after startup, while the durable index still holds previous sessions. The renderer's `/clear` action immediately added its cleared marker before awaiting the IPC result.

A narrow exported `forgetHarnessSession(home, threadId)` updates the shared durable index independently of instantiated clients. Both desktop and phone clear boundaries invoke it before clearing queued compaction state; existing clients still clear their transient trial options. The renderer adds its marker after successful completion and displays the existing error message on failure. Unrelated task mappings are preserved.

The actual extracted desktop and phone handlers run against temporary persisted mappings with an empty harness Map. Separate extracted renderer callbacks exercise deferred success and failure. This is one Clear operation lifecycle root across its callers, not four findings.

Changed source: `desktop/main/harness.ts`, the two clear handlers/import in `desktop/main/main.ts`, and the `pickCommand` Clear branch in `desktop/src/App.tsx`. Regressions: new `desktop/test/session-clear.test.ts`; existing clear bridge fixture adapted in `desktop/test/bridge.test.ts`. No phone protocol shape changed.

## Validation

A snapshots: `/private/tmp/shinbo-runtime-round7-before`.

A logs:

- `/private/tmp/shinbo-runtime-round7-a/results.log`: four regression scenarios fail, covering R7-1 through R7-3.
- `/private/tmp/shinbo-runtime-round7-a-clear/results.log`: both native Clear boundaries fail.
- `/private/tmp/shinbo-runtime-round7-a-clear/renderer-results.log`: both deferred renderer cases fail because the marker appears before persistence.

B logs:

- `/private/tmp/shinbo-runtime-round7-b/core-results.log`: 94/94 pass across credential, session-clear, harness, runtime-control and profile tests.
- `/private/tmp/shinbo-runtime-round7-b/relay-results.log`: 29/29 pass across ChatGPT, runtime-performance and backpressure tests.
- `/private/tmp/shinbo-runtime-round7-b/bridge-clear.log`: 1/1 targeted bridge test passes.

Total focused result: 124 tests pass, zero fail. Main and renderer TypeScript checks and scoped ESLint pass. A temporary source link supplies the relative source path required by existing extracted-function fixtures; shared build output was not used.

Commands from `desktop`:

```sh
./node_modules/.bin/tsc -p tsconfig.main.json --outDir /private/tmp/shinbo-runtime-round7-b/dist-main
./node_modules/.bin/tsc -p tsconfig.renderer.json --noEmit
NODE_PATH="$PWD/node_modules" node --test /private/tmp/shinbo-runtime-round7-b/dist-main/test/session-clear.test.js /private/tmp/shinbo-runtime-round7-b/dist-main/test/credentials.test.js /private/tmp/shinbo-runtime-round7-b/dist-main/test/harness.test.js /private/tmp/shinbo-runtime-round7-b/dist-main/test/runtime-controls.test.js /private/tmp/shinbo-runtime-round7-b/dist-main/test/profile.test.js
NODE_PATH="$PWD/node_modules" node --test /private/tmp/shinbo-runtime-round7-b/dist-main/test/chatgpt.test.js /private/tmp/shinbo-runtime-round7-b/dist-main/test/runtime-performance.test.js test/chatgpt-backpressure.test.mjs
NODE_PATH="$PWD/node_modules" node --test --test-name-pattern='clearThreadContext' /private/tmp/shinbo-runtime-round7-b/dist-main/test/bridge.test.js
./node_modules/.bin/eslint main/credentials.ts main/harness.ts main/chatgpt.ts main/main.ts src/App.tsx test/credentials.test.ts test/harness.test.ts test/chatgpt.test.ts test/runtime-performance.test.ts test/chatgpt-backpressure.test.mjs test/session-clear.test.ts test/bridge.test.ts --max-warnings 0
```

Only the localhost relay suite needed sandbox escalation to bind temporary loopback ports. Its upstream fetches are stubbed; no external paid calls occurred. Root owns integrated checks and real desktop `/clear` verification. This report does not claim live Keychain failure, Windows, signing, privacy permissions or accessibility verification.

## R7-4 live-turn follow-up

Tracing the same Clear operation also found that deleting its durable mapping disconnected Stop and Steer from an already running turn. The current turn's streaming updates still used `threadsBySession`, but these two controls looked in the now-cleared persistence Map and returned without sending ACP controls. This is grouped into R7-4, with no additional root count.

Both controls now resolve the active session and verify its existing live owner. Clearing the next conversation context does not remove current-turn control ownership. Unrelated task steering remains refused.

Two real fake-ACP process regressions clear context during a permission wait, then call Stop or Steer. A forwarded zero cancellation requests and zero steering requests; B forwards one of each. The fake process deliberately does not implement steering, so the measurement is correct control delivery, not a claim that this fixture executes a real model steering operation. Existing mid-turn output routing and Stop tests still pass.

A: `/private/tmp/shinbo-runtime-round7-a-liveclear/results.log` (0/2). B: `/private/tmp/shinbo-runtime-round7-b/liveclear-results.log` (4/4 including neighboring regressions). The combined round-8 verification reruns this complete scope: 96 core tests, 30 relay/performance tests and one bridge-clear test pass, 127/127 in total. These are the same prior tests plus the two live-control regressions and the separate R8-1 relay regression; counts should not be added to the earlier 124 as if disjoint.
