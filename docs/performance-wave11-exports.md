# Import and export path audit — 2026-09-12

## Implemented finding: P1 a single-thread stats export loads every conversation

The real user flow is the thread agent dialog's “Download stats & traces” button → `collectStats` → `statsFiles` → `exportThreadStats`. `collectStats` requested the full host `snapshot`, then retained only the selected thread and its direct children. Unrelated conversation bodies crossed the Rust NDJSON boundary, were parsed in the app process, and crossed the renderer IPC boundary before being discarded. Existing Rust record/summary caches do not remove these full response bodies.

The fix uses the existing complete `threadSummaries` response to find the selected thread and all direct children, then requests only those full records through the existing `thread` method. Child reads are sequential, preserving library order and avoiding an unbounded request queue for threads with many historical children. It includes every direct child, excludes grandchildren and unrelated threads, and preserves each requested record's full content and telemetry. The desktop host summary method is unpaginated; this does not use the paginated phone listing.

Only `desktop/src/thread-stats.ts` changed. No main-process handler, host protocol, Rust store, parser, persistence, or export writer changed. A missing selected ID still returns undefined. Optional trace/agent/plan failures retain their empty fallbacks; required read failures reject so the UI displays its existing error state rather than silently exporting incomplete data. Malformed records remain handled by the existing host summary parser and its warning behavior. As before, the filesystem is not transactionally frozen for an export; a record removed or made unreadable between summary and targeted read can cause a reported read failure.

## Actual-host paired measurement

The disposable library contains 64 valid Markdown threads, each with 128 messages of approximately 8 KiB. The selected thread has two direct children; the other 61 histories are unrelated. The fixture checks that the actual host accepts all 64 records without warnings. Each sample starts the existing `target/debug/shinbo-host` with only this disposable `SHINBO_DATA_DIR`, warms the summary cache as an already-open workspace does, then invokes the actual baseline or fixed `collectStats` function.

The probe uses the app's real `BoundedLines`, `HostResponses`, and `parseHostLine` code for host responses. It counts actual stdout wire bytes. Node V8 serialize/deserialize models the subsequent renderer IPC copy and counts those payload bytes; that second boundary is not native Electron IPC. A one-millisecond timer measures responsiveness in the Node process running the real response parser and collection code. Both variants run against the same host binary and library. Five alternating process pairs produced:

| Observation per export | Baseline | Fixed |
|---|---:|---:|
| Host requests | 1 full snapshot | 1 summary + 3 targeted threads |
| Actual host stdout bytes | 68,032,061 | 3,429,741 |
| V8-serialized reply payload bytes | 67,789,402 | 3,389,451 |
| Median collection and CSV-generation time | 4,520.139 ms | 235.429 ms |
| Median largest event-loop gap | 82.166 ms | 4.533 ms |
| Selected messages | 128 | 128 |
| Direct children, original order | 2 | 2 |
| Serialized ten-file CSV export size | 10,780 bytes | 10,780 bytes |

Actual host traffic fell 95.0% and measured total time fell 94.8%. The complete serialized CSV result was byte-identical across all ten samples, SHA-256 `f22c2b62aee72d3c1e4f54bb1fac4670a228a57086991a7faf11b8d97769c0a9`. Export timestamps were fixed for this equality check; performance timing used the monotonic clock.

This is a supported-library latency/copy finding, not a claim about typical conversation length, release-host speed, measured RSS, or native UI frame time. The tradeoff is one targeted host request per selected/direct-child record instead of one library request. A small library consisting entirely of that family may gain little; the improvement comes from excluding unrelated bodies. No child-count cap or text truncation was introduced.

## Import, migration, and other export coverage

`desktop/main/imports.ts` imports skill/MCP source registrations, not session histories. It has a fixed table of eight source applications, uses asynchronous filesystem calls, and writes a small manifest through temporary-file rename. Actual callers validate selections before the write and refresh tool lists afterward. No separate desktop bulk session-import/migration flow was found; legacy thread-format compatibility is handled in the already-audited Rust codec and was not changed or recounted.

A disposable source library with 2,304 skill directories across the nine configured roots completed discovery in 16.006 ms with a largest event-loop gap of 1.513 ms. Saving and rereading all eight source registrations produced a 2,193-byte manifest in 2.506 ms, maximum gap 2.069 ms. No urgent main-thread stall was established in these paths.

The thread-stats CSV writer validates at most 24 named sheets and 64 MiB, then writes asynchronously. Bench XLSX generation is synchronous, but the actual Bench store retains at most 12 cases, 24 runs, and 24 results per run, with 4,096-character answers. A maximum-result, ordinary-text fixture generated the same three renderer sheet shapes (577, 13, and 577 rows) into a 3,468,470-byte workbook. Five runs had median generation time 69.606 ms and median maximum event-loop gap 69.671 ms. This bounded, explicit export operation is documented as lower priority; no urgent fix, worker framework, or speculative source-limit increase was added. Existing workbook escaping, CRC/ZIP, numeric-cell, and export-validation tests were run unchanged.

## Commands and regression checks

The exact pre-edit renderer source is `/tmp/shinbo-perf-wave11-exports/thread-stats.baseline.ts`. Disposable source/library fixtures, benchmark programs, and logs are under `/tmp/shinbo-perf-wave11-exports/`. The library is populated by `probe.cjs`; no production data is read or changed. The following baseline/fixed probe pair was run five times in alternating order:

```sh
node /tmp/shinbo-perf-wave11-exports/probe.cjs /tmp/shinbo-perf-wave11-exports/thread-stats.baseline.ts
node /tmp/shinbo-perf-wave11-exports/probe.cjs desktop/src/thread-stats.ts
node /tmp/shinbo-perf-wave11-exports/coverage.cjs
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave11-exports/compiled
node --test /tmp/shinbo-perf-wave11-exports/compiled/test/thread-stats-performance.test.js /tmp/shinbo-perf-wave11-exports/compiled/test/bench-board.test.js /tmp/shinbo-perf-wave11-exports/compiled/test/ipc.test.js
cd desktop
./node_modules/.bin/eslint src/thread-stats.ts test/thread-stats-performance.test.ts --max-warnings 0
```

The isolated compiled directory's node_modules links to the existing desktop dependency tree. The probe imports unchanged runtime dependencies from the preceding wave's compiled directory and `statsFiles` from this wave's compiled directory. `baseline.log`, `fixed.log`, `coverage.log`, and `checks.log` retain results.

Compilation, lint, and all 80 focused tests passed. The seven new tests cover exclusion of 200 unrelated threads, selected/direct-child content and ordering, exact subthread metric rows, missing target, optional telemetry failures, required read failures, and completeness with 130 direct children. The baseline renderer was transpiled into an isolated module directory and run against the same compiled regression; request-count/selection and new targeted-read failure checks fail as expected. `baseline-regression.log` preserves that output. The actual-host CSV hash comparison independently verifies output equivalence rather than relying only on test expectations.

Root owns the final real-app export interaction and full integrated checks.

## Production-app verification

The coordinator opened the completed local background-stream thread, selected Show thread details → Download stats and traces, and saved through the native dialog to `/tmp/shinbo-performance-thread-stats-wave16`. The app confirmed the saved directory. All ten CSV files were inspected: the summary reported two messages and one model request; the assistant turn contained 2,070 characters with a 20,658 ms duration; agent and model spans completed successfully. The stored title remains “New thread” while the sidebar derives a display label from the prompt, matching existing behavior. This exercised the actual export UI and filesystem path; it is not an additional latency benchmark.
