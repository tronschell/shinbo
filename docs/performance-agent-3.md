# Agent runtime performance fixes

Six independent defects were fixed in `desktop/main/agent-loop.ts`, `desktop/main/harness.ts`, `desktop/main/chatgpt.ts`, and `desktop/main/invocations.ts`. The measurements below execute the actual application modules with deterministic fixtures. They are operation counts, not estimated production latency. The baseline is the pre-task working tree archived at `/tmp/shinbo-perf-baseline/source.tar`; existing unrelated edits were preserved.

| # | Priority and defect | Baseline → fixed | User impact and scope |
| --- | --- | --- | --- |
| 1 | P1: Every streamed token and tool update scans historical trace spans. | With 1,000 historical tools followed by 1,000 deltas and 1,000 updates: **3,005,000 → 0 historical span reads**. | Long agent runs accumulate increasing main-process work while their answers stream. Retaining the current model span and mapping tool IDs to existing spans keeps each update constant-time. Final trace contents, token accounting, and completion remain intact. |
| 2 | P2: Reading another thread or consulting the advisor fetches the entire library twice. | **2 → 1 snapshot requests** per thread read. | Removes one complete host round trip and one transfer of the library before the model receives thread history. The gain grows with library size; this does not introduce a new targeted host query. |
| 3 | P1: Completed ACP requests retain their idle timers and captured request state until the 30-minute timeout. | After 100 completed requests: **100 → 0 live idle timers**. | Repeated turn setup and control calls retain less memory during long desktop sessions. Resolve, reject, process failure, and synchronous send failure now clear the same timer. Active requests retain the existing permission/tool liveness behavior. |
| 4 | P1 for large recovered sessions: Restoring tool traces decodes every stored trace again for every checkpoint turn. | With 25 stored traces and 25 recovered turns, each containing one missing call: **625 → 50 trace decodes**; **92% fewer**. | Opening a recovered long-running task avoids repeated synchronous JSON deserialization on Electron's main thread. Existing traces decode once; only changed traces decode again, preserving the serializer's text/trace limits. Timestamp matching still scans candidate traces. |
| 5 | P2: A burst of usage events queues a full read/rewrite/rename of usage.json for every event. | A same-tick burst of 100 events across five models: **100 → 1 writes** and **100 → 1 atomic renames**, with all 100 uses retained. | Parallel tool activity produces less disk work and less backlog for usage charts. Events arriving during a write go into the next ordered batch; awaited calls still wait for their persistence. Sequential awaited events intentionally remain separate writes. |
| 6 | P1: Stopping a ChatGPT caller leaves the upstream request running. | Caller disconnect during connection establishment and during streaming: **0 → 1 upstream abort notifications** in both cases. | A cancelled/restarted harness stops consuming the abandoned upstream response and releases its local resources. The relay passes its AbortSignal to fetch, aborts on downstream close, and cleans up on every terminal path. Provider-side billing cancellation is not claimed or measured. |

## Regressions and reproduction

Final validation: **122/122 focused tests passed**, TypeScript compilation passed, and ESLint passed. Logs are saved at `/tmp/shinbo-runtime-perf-before.log` and `/tmp/shinbo-runtime-perf-after.log`.

`desktop/test/runtime-performance.test.ts` covers each measurement plus usage arriving during an outstanding write. Existing agent, harness, invocation, and ChatGPT tests exercise lifecycle and compatibility behavior. The cancellation fixtures use loopback HTTP and a mocked upstream; they do not contact ChatGPT or use real credentials.

Compile the current tree into an isolated output directory, then run the focused checks from the desktop directory:

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-runtime-perf-after
cd desktop
NODE_PATH="$PWD/node_modules" node --test /tmp/shinbo-runtime-perf-after/test/runtime-performance.test.js /tmp/shinbo-runtime-perf-after/test/agent.test.js /tmp/shinbo-runtime-perf-after/test/harness.test.js /tmp/shinbo-runtime-perf-after/test/chatgpt.test.js /tmp/shinbo-runtime-perf-after/test/invocations.test.js
./node_modules/.bin/eslint main/agent-loop.ts main/harness.ts main/chatgpt.ts main/invocations.ts test/runtime-performance.test.ts
```

The A/B baseline was compiled separately by extracting `desktop/main`, `desktop/shared`, and `desktop/tsconfig.main.json` from the source archive into `/tmp/shinbo-runtime-perf-baseline`, copying the same performance test into its `desktop/test`, and linking its `desktop/node_modules` to the existing installation:

```sh
./desktop/node_modules/.bin/tsc -p /tmp/shinbo-runtime-perf-baseline/desktop/tsconfig.main.json --outDir /tmp/shinbo-runtime-perf-before
NODE_PATH="$PWD/desktop/node_modules" node --test /tmp/shinbo-runtime-perf-before/test/runtime-performance.test.js
```

The original baseline fails every performance assertion and prints the baseline counts above. The additional usage-during-write correctness test also passes on the baseline. Loopback tests require an execution environment that permits listening on 127.0.0.1; the initial sandbox-only attempt returned EPERM, and the authorized rerun succeeded.

This agent did not run the real desktop app. App launch and changed-interaction verification belong to the coordinating agent; no claim is made here about visual interaction, VoiceOver, platform permissions, display geometry, signing, or Windows behavior. P2 items are reported honestly and should not be presented as independently verified high-priority defects solely to reach a requested count.
