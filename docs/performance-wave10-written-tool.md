# Foreground written-tool cancellation — 2026-09-12

## Implemented finding: P1 stopped turns leave owned CPU processes running

A locally written tool is foreground work: `run_tool` returns its printed result and has no background option. The actual path is `runShinboTool` → `executeTool` → `runWrittenTool` → `runCommand` on POSIX or `runDirectCommand` on Windows. `runShinboTool` checks run authorization before calling the tool. Stop reaches `stopThread` → `AgentRuntime.stop` → the owning run's AbortController. The subprocess runners did not receive that controller's signal, so authorization checks did not cancel execution already underway.

Both private runners had only a timeout. The actual production limit is 120 seconds, not ten minutes. A stopped local script could keep its shell, worker, CPU work, and inherited descriptors alive until that timeout. The process-tree helper already existed and was used for timeout termination.

The fix captures the existing run signal before asynchronous tool listing, passes it through the written-tool runner, checks it before spawning, and terminates the owned process tree on abort. Windows interpreter discovery checks again through the direct runner before execution. Cancellation rejects with the signal's reason after the child closes. Every successful, failed, timed-out, or cancelled launch removes its abort listener and timeout; later aborts cannot kill a completed launch's PID.

Only the `run_tool` case and its three private runner functions in main.ts changed. The second `runCommand` caller, the secret tool, is outside this finding and its cancellation is audited separately. No other callers use `runDirectCommand`. Explicit background commands and terminal/CLI managers remain untouched. Tool persistence (`write_tool`), completed filesystem writes, credential handling, interpreter selection, shell quoting, literal Windows argv, output bounds, and normal failure text remain intact. No new protocol or sibling-repository change was needed.

## Reproduction and paired measurement

The disposable fixture runs the actual source-extracted `runWrittenTool` functions with the existing platform helpers. It starts a dedicated shell script, a Node worker, and a Node child performing a busy loop. The worker writes only fixture PIDs into its temporary directory. A real `AgentRuntime` owns the run, and its real `stop` method aborts it. Only those fixture processes are killed or inspected; no user process, account, provider, browser, or phone is involved.

The timeout is injected as 1,500 ms for the paired test instead of waiting two minutes per sample. Abort occurs after the fixture reports its three PIDs. Five alternating baseline/fixed pairs produced:

| Observation | Baseline | Fixed |
|---|---:|---:|
| Owned processes before Stop | 3 | 3 |
| Owned processes alive 200 ms after Stop, every pair | 3 | 0 |
| Median Stop-to-runner-settlement | 1,247.839 ms | 3.430 ms |
| Why execution settled | Shortened timeout | Owning AbortSignal |

The baseline's approximately 1.25-second post-Stop delay is the remainder of the injected 1.5-second timeout after process startup. It is not a measurement of the 120-second production timeout. Fixed settlement ranged from 2.438 to 4.540 ms. The resource result is removal of all three foreground processes after Stop, including the busy child; no CPU-percentage or battery-life estimate is claimed. The P1 impact is ongoing unwanted CPU/process work after the user explicitly stops its owning turn.

## Validation and exact commands

The pre-edit main.ts is preserved at `/tmp/shinbo-perf-wave10-written-tool/main.baseline.ts`. The disposable benchmark is `/tmp/shinbo-perf-wave10-written-tool/probe.cjs`; five paired measurements are in `baseline.log` and `fixed.log`. Baseline and fixed probe invocations were alternated five times:

```sh
node /tmp/shinbo-perf-wave10-written-tool/probe.cjs /tmp/shinbo-perf-wave10-written-tool/main.baseline.ts
node /tmp/shinbo-perf-wave10-written-tool/probe.cjs desktop/main/main.ts
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave10-written-tool/compiled
ln -s /Users/tronschell/Documents/shinbo/desktop/node_modules /tmp/shinbo-perf-wave10-written-tool/compiled/node_modules
ln -s /Users/tronschell/Documents/shinbo/desktop/main /tmp/shinbo-perf-wave10-written-tool/main
node --test /tmp/shinbo-perf-wave10-written-tool/compiled/test/written-tool-cancellation.test.js /tmp/shinbo-perf-wave10-written-tool/compiled/test/platform.test.js /tmp/shinbo-perf-wave10-written-tool/compiled/test/capabilities.test.js
SHINBO_WRITTEN_TOOL_SOURCE=/tmp/shinbo-perf-wave10-written-tool/main.baseline.ts node --test /tmp/shinbo-perf-wave10-written-tool/compiled/test/written-tool-cancellation.test.js
cd desktop
./node_modules/.bin/eslint main/main.ts test/written-tool-cancellation.test.ts --max-warnings 0
```

Compilation, lint, and all 18 focused tests passed. The eight new regression checks cover:

- Real `executeTool` → `run_tool` execution with actual `AgentRuntime.stop`, asserting all three fixture processes exit, AbortError settles, and listeners/timers are gone.
- Stop during asynchronous saved-tool listing, followed by replacement of the available run signal, asserting the original aborted signal prevents a late launch.
- Windows interpreter argv with quotes, spaces, and shell metacharacters preserved as literal input; success, launch error, timeout, and cancellation retain cleanup and expected process-tree-helper arguments.
- Cancellation during Windows interpreter lookup, preventing a subsequent spawn.
- Successful written output, persisted file contents after completion, and unchanged unsignaled command results.

Running the new test against baseline source fails four cancellation checks as expected: the three processes remain alive, cancellation during listing still launches, Windows abort waits for timeout instead of rejecting, and cancellation during interpreter lookup still launches. The other four compatibility checks pass baseline and fixed. Output is retained in `baseline-regression.log` and `checks.log`.

macOS process cleanup was exercised with real disposable processes. Windows uses deterministic launch/termination adapters plus existing platform tests; native Windows process-tree behavior and clicking Stop in the real app remain for the root's integrated/platform verification. Completed writes are not rolled back, and deliberately detached child process groups are outside this existing owned-tree mechanism.

## Independent review and native fixture preparation

The independent reviewer identified exit-before-close ordering in the Windows/direct runner. Abort and timeout now skip termination when `exitCode` or `signalCode` shows that the parent has already exited, and a skipped timeout does not falsely label successful output as killed. POSIX group cancellation remains active when descendants hold inherited output open. The reviewer added `desktop/test/written-tool-exit-race.test.ts` for normal/signal exit followed by abort/timeout.

A real-app fixture was prepared without launching any UI or changing the root-owned provider server. The existing `writeShinboTool` function seeded only `/tmp/shinbo-dev-profile-5176/tools/native-written-stop`; the actual tool listing confirmed it. Instructions, worker, status reader, and provider mode snippet are under `/tmp/shinbo-native-written-stop/`. Root owns provider restart and the actual CUA Stop interaction. The fixture has three owned processes, bounded CPU bursts, a 90-second watchdog, and no network or user-data access.

The later secret-tool integration also exercises the shell runner on Windows. Its shared abort/timeout callback now applies the exited-PID guard on Windows only. Nine additional deterministic shell checks cover abort/timeout after normal/signal exit on both platforms plus a live Windows shell abort: Windows never targets an exited shell PID, while POSIX still targets the owned group so descendants with inherited output remain cancellable. This extends the same cancellation correctness fix, not a separate performance finding. Native fixture files were unchanged.

The final shared-caller integration also forwards the run signal through the secret tool's command and reader-model phases; its synthetic-output checks are in `performance-cancel-runtime.md`. This extends finding 61, without counting another command-runner issue. The earlier statement that the secret caller remained unsignaled describes the initial scope only. Windows shell execution now uses the same exited-child guard as direct execution; POSIX retains owned-group cancellation after its leader exits.

## Real app custom-tool Stop

The coordinator rebuilt the isolated production Electron app from the wave-thirteen green check, selected the loopback fixture provider, and sent `[written-stop]` through the real composer and Zig harness. The model selected `run_tool`; the coordinator allowed the known disposable `native-written-stop` tool once. The fixture reported all three owned processes alive (shell 77245, worker 77248, child 77249). Clicking the app's Stop control displayed “You stopped this run,” and the next process probe found all three gone. The probe validates cleanup, not millisecond cancellation latency; the paired timings above remain the latency measurement. Only the isolated profile's tool and `/tmp/shinbo-native-written-stop` data were used.
