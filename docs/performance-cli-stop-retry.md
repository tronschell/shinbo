# CLI Stop after an immediate retry

A preexisting shutdown-ownership bug lets a user stop one CLI turn, send a new turn on the same run, and receive a successful second Stop response while the new process keeps working. The CLI panel enables its composer as soon as the old child closes. However, CliRuns previously retained its stop promise under the reusable run ID for a fixed two-second grace wait. Stop on the replacement child reused that old promise. Its final escalation could also target the previous PID when the entry was running again.

This affects the actual CLI panel Stop/composer, main preload stopCliRun/sendCliRun, and phone equivalents. It is distinct from foreground written-tool cancellation: these explicit CLI runs have their own process lifecycle.

## Paired evidence

The source baseline was copied before editing to /tmp/shinbo-cli-stop-race/before-cli.ts. Both tests transpile the selected actual cli.ts source and exercise CliRuns.start, stop, and send. No provider or credential is required.

| Measurement | Before | After |
| --- | ---: | ---: |
| Second Stop reports accepted | true | true |
| Real retried process alive 250 ms after second Stop | 1 | 0 |
| Termination calls targeting replacement child before grace expiry, deterministic fixture | 0 | 1 |
| Termination calls targeting previous PID after grace expiry, deterministic fixture | 2 | 1 |

The native fixture uses a disposable executable that waits and exits 80 ms after SIGTERM. After the first child closes, the fixture immediately sends the next turn, waits for its READY output, and stops it. The baseline leaves that second process alive; the test explicitly kills it after measuring. The fixed source terminates it. These are owned-process/operation counts; test-runner elapsed time is not claimed as a performance benchmark.

A second real POSIX fixture preserves group termination: the leader exits on SIGTERM while a descendant ignores it and keeps inherited output pipes open. Both before and after retain the grace escalation and kill that descendant. When a process closes completely, the previous implementation already skipped escalation unless the same mutable entry had started running again; the fix removes that accidental reuse, not legitimate open-pipe group ownership.

From repository root:

```sh
CLI_SOURCE=/tmp/shinbo-cli-stop-race/before-cli.ts node --test desktop/test/cli-stop-lifecycle.test.mjs
CLI_SOURCE=/tmp/shinbo-cli-stop-race/before-cli.ts node --test desktop/test/cli-native-stop.test.mjs
node --test desktop/test/cli-stop-lifecycle.test.mjs desktop/test/cli-native-stop.test.mjs
```

Before deterministic suite: 4 expected failures, 2 passes. Before native suite: 1 expected Stop/retry failure, 1 preserved-group pass. After: 8 tests pass. Raw evidence: /tmp/shinbo-cli-stop-race/lifecycle-before.txt, native-before.txt, native-after.txt, before.json and after.json. The compact measure.cjs fixture is also saved there.

## Root fix

The shutdown map now keys ChildProcess rather than the reusable run ID. Every shutdown captures its owned child and checks that exact identity before escalation. Old cleanup only deletes its own child's promise. A standard-library close wait releases the shutdown as soon as the child closes, retaining the existing two-second timeout for stuck children. POSIX groups remain eligible after leader exit while descendant pipes are still open. On Windows, an already exited direct child is never targeted by PID during initial or forced termination.

Output collection, per-turn exit status, source handoff, model/effort selection, permissions, and CLI spawning remain unchanged. No new dependency or shutdown framework was added.

Regression coverage includes rapid Stop/retry/Stop, delayed old stop completion, deduplication of repeated Stop on one child, shutdown settlement on close, final buffered output, timeout escalation, Windows exit-before-pipe-close simulation, and actual POSIX descendant escalation. Ten existing CLI/options tests also pass, including model/effort preservation across resume and handoff.

Focused checks from desktop:

```sh
./node_modules/.bin/tsc -p tsconfig.main.json --outDir /tmp/shinbo-cli-stop-race/compiled
ln -sfn /Users/tronschell/Documents/shinbo/desktop/node_modules /tmp/shinbo-cli-stop-race/compiled/node_modules
node --test /tmp/shinbo-cli-stop-race/compiled/test/cli-options.test.js /tmp/shinbo-cli-stop-race/compiled/test/cli.test.js
./node_modules/.bin/eslint main/cli.ts test/cli-stop-lifecycle.test.mjs test/cli-native-stop.test.mjs --max-warnings 0
```

TypeScript and targeted ESLint pass. Full integrated checks and native Electron interaction belong to the parent audit. A fake pi executable, private BASH_ENV discovery setup, loopback provider, and actual-preload Stop/retry script are prepared in /tmp/shinbo-cli-native-fixture/README.md. They are not launched by preparation. Native Windows behavior remains unverified; its child-liveness branch has deterministic coverage. No external provider, account, microphone, or credential content was accessed.

## Completion ownership integration

Independent review reproduced one additional event ordering in the same child-ownership root: the old child emits error, which permits a retry; after the new child starts, the old child's later close event previously saw the shared entry running and cleared the replacement. Stop then returned false and the replacement turn promise remained unsettled. The shared finish callback now requires exact child identity before changing the entry or resolving its turn.

The permanent regression checks that the replacement stays running and attached, accepts Stop, resolves its own promise on close, and clears its 30-minute deadline. Its pre-guard source copy and expected failure are saved at /tmp/shinbo-cli-stop-race/before-finish-ownership.ts and finish-ownership-before.txt. Reproduce with `CLI_SOURCE=/tmp/shinbo-cli-stop-race/before-finish-ownership.ts node --test --test-name-pattern='old close after spawn error' desktop/test/cli-stop-lifecycle.test.mjs`. The current seven-case deterministic suite passes. This is integration of the existing CLI finding, not another issue count.

## Production Electron verification

The coordinator launched the checked production app with a private test-only Bash environment that resolves `pi` to a harmless local fixture. A loopback provider requested the existing CLI tool in the connected disposable workspace. The normal permission UI displayed Running Pi and was approved once. The actual preload then exercised Stop → immediate retry on the same run ID → Stop. Both calls returned true, the run reached two turns, and the second process was idle at the 300 ms observation. Fixture logs show two different owned PIDs, 16804 and 16848, each receiving SIGTERM and exiting. A subsequent process-table check found neither PID alive. The fixture deliberately exits about 80 ms after SIGTERM; that interval is not a measured product cancellation-latency claim. The app's normal tool result completed through the local provider. No external model, real coding CLI account, or user shell startup file was used or changed.
