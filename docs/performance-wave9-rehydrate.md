# Workspace recovery snapshot duplication — 2026-09-12

## Implemented finding: P1 repeated full-map IPC during parallel-run recovery

Opening or reloading the workspace while main is driving several runs invokes `wire` → `listAgents` → `reconcile` → `adoptForeign` → `rehydrate`. Each adopted run separately requested `listSpans` and `livePartial`, although both IPC methods return every live thread's map. Eight supported parallel runs therefore copied both complete maps eight times before recovering each thread's own blocks. This compounds startup work precisely when the workspace is rebuilding its visible state.

The fix creates one lazy snapshot promise per `reconcile` invocation and passes it to every run adopted by that invocation. It introduces no persistent cache and does not share across reconciliation events. A later event or new generation starts fresh reads even if an earlier snapshot is pending. Adoptions from delta, tool, or other individual events retain their independent reads. A reconciliation that adopts nothing requests nothing. Existing per-thread generation checks, partial-text overlap merging, newer tool updates, pending prompts, and failure handling remain intact.

This is separate from the preceding live-span broadcast destination fix: recovery uses explicit renderer-to-main request/reply IPC, including when the workspace is the only open window. Existing trace caches and event throttles do not deduplicate these calls.

## Measured A/B

The disposable probe uses actual `AgentRuntime` methods to create eight live runs with 128 completed tool spans apiece, each output approximately 16 KiB and within the existing tool-output allowance. It feeds the resulting actual live-agent list to the compiled renderer's real `wire`/`reconcile` path. The span map serializes to 16,939,901 bytes. The partial map adds 16,740 bytes, including distinct thread entries and multibyte thinking text. Stub IPC methods count calls and run Node V8 serialize/deserialize to model independent process-boundary copies.

Five alternating baseline/fixed process pairs produced:

| Observation per workspace recovery | Baseline | Fixed |
|---|---:|---:|
| Complete span-map reads | 8 | 1 |
| Complete partial-map reads | 8 | 1 |
| Aggregate V8-serialized reply bytes | 135,653,128 | 16,956,641 |
| Median clone-and-recovery time | 61.426 ms | 16.734 ms |
| Restored completed tool steps | 1,024 | 1,024 |
| Restored answer for each of eight threads | Identical | Identical |

The exact copy reduction is 87.5%, removing 118,696,487 serialized bytes from this one recovery. Measured clone-and-recovery time fell 72.8%. The P1 workload is workspace recovery during long parallel runs: redundant full histories create avoidable startup latency and large temporary copies. One active run has the same two requests as before. These are serialized payload totals, not measured peak RSS or Electron wire bytes. Timing includes the fixture's synchronous V8 cloning and actual block restoration, not native IPC scheduling, first paint, or a claim of typical user latency. Parent owns integrated real-app verification.

## Validation and exact local commands

Before editing, the current dirty `desktop/src/runs.ts` was copied to `/tmp/shinbo-perf-wave9-rehydrate/runs.baseline.ts`. Baseline and fixed trees were compiled separately; unrelated dirty edits were preserved. The actual benchmark program and all ten measurements are retained at `/tmp/shinbo-perf-wave9-rehydrate/probe.cjs`, `baseline.log`, and `fixed.log`.

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave9-rehydrate/baseline
ln -s /Users/tronschell/Documents/shinbo/desktop/node_modules /tmp/shinbo-perf-wave9-rehydrate/baseline/node_modules
node /tmp/shinbo-perf-wave9-rehydrate/probe.cjs /tmp/shinbo-perf-wave9-rehydrate/baseline
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave9-rehydrate/fixed
ln -s /Users/tronschell/Documents/shinbo/desktop/node_modules /tmp/shinbo-perf-wave9-rehydrate/fixed/node_modules
node /tmp/shinbo-perf-wave9-rehydrate/probe.cjs /tmp/shinbo-perf-wave9-rehydrate/fixed
node --test /tmp/shinbo-perf-wave9-rehydrate/fixed/test/run-rehydrate-performance.test.js /tmp/shinbo-perf-wave9-rehydrate/fixed/test/runs.test.js /tmp/shinbo-perf-wave9-rehydrate/fixed/test/run-settlement.test.js /tmp/shinbo-perf-wave9-rehydrate/fixed/test/run-activity-events.test.js
cd desktop
./node_modules/.bin/eslint src/runs.ts test/run-rehydrate-performance.test.ts --max-warnings 0
```

The first compilation ran before the source edit. Both compilations and lint passed. All 72 focused tests passed, including five new regression cases. The new test restores eight complete 128-tool histories with multibyte output and verifies full block equivalence and prompt retention; a repeated unchanged reconciliation performs no extra reads. It also checks a later adoption while earlier IPC is pending, a new generation before stale recovery resolves, incoming text/tool updates during recovery, and independent failures of either IPC followed by successful recovery. The freshness cases run a second reconciliation synchronously, without waiting for a microtask or the older read.

The new compiled regression was copied into the baseline test directory and run against the baseline renderer. It failed the eight-to-one read-count assertion and the two batch failure-recovery count assertions as expected; both freshness tests already passed on baseline and continue to pass after the fix. Output is retained in `baseline-regression.log`.

No main-process, mobile-protocol, sibling-repository, or settlement changes were required for this finding. The parallel settlement reviewer was notified of ownership before editing `runs.ts`.

The subsequent settlement-safety integration adds a separate initial saved-thread boundary read for each newly observed foreign run. The 16→2 count in this report refers specifically to the two complete live maps, not every IPC request made during adoption. Those saved-thread reads are documented in the retention report and are not included in this live-map payload benchmark.
