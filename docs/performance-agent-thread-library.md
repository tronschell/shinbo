# Agent thread-tool library reads

## Confirmed P1

`AgentRuntime.library()` fetched the full `snapshot` for thread listing, selected-thread reading (including the advisor's last twenty messages), messaging metadata, and bench replay ancestry checks. A supported library of 64 threads with 128 roughly 8 KiB messages each transferred 68,032,061 NDJSON bytes for every call. Listing emitted only 6,127 bytes. These synchronous tool waits repeatedly stall ordinary agent coordination and put unrelated history parsing onto the Electron main process.

`desktop/main/agent-loop.ts` now uses the existing complete `threadSummaries` request for this shared library boundary. Listings use its exact numeric message count. Explicit thread reads first retain the existing summary lookup and missing-ID error, then request that one full thread. Advisor reads share that path. Message dispatch and bench safety retain the existing ancestry walk, sender selection, cycle guard, and behavior. There is no retained cache, pagination, concurrency framework, tool/schema change, or new dependency. `modelPlans` was not changed because that path consumes generation metadata.

This is one root-cause fix shared by these callers, not separate listing, advisor, and messaging issues.

## Baseline and measurement

Exact pre-edit source: `/tmp/shinbo-perf-agent-library/agent-loop.before.ts`; existing test baselines are adjacent. The runnable probe is `/tmp/shinbo-perf-agent-library/probe.cjs`. It reuses the valid on-disk 64-thread fixture from `/tmp/shinbo-perf-wave11-exports/library`, launches the same `target/debug/shinbo-host`, loads the actual before/current `AgentRuntime`, and routes its real tool calls through the actual NDJSON assembly/parser. It warms summaries first, then performs list, read (20 messages from one selected child), and message in order. Spawn is stubbed to avoid starting model work; message measurement covers real lookup, ancestry metadata, formatting, and dispatch selection. V8 serialize/deserialize models the existing probe's IPC clone boundary; this is a controlled host/component fixture, not native UI latency. No live model request occurs.

The preliminary pair overlapped unrelated native profiling and is excluded from timing claims. Three subsequent alternating pairs ran after the parent confirmed native stress had stopped. Commands:

```sh
node /tmp/shinbo-perf-agent-library/probe.cjs /tmp/shinbo-perf-agent-library/agent-loop.before.ts
node /tmp/shinbo-perf-agent-library/probe.cjs desktop/main/agent-loop.ts
```

Pair order was before/after, after/before, before/after. Raw results: `/tmp/shinbo-perf-agent-library/paired.jsonl`.


| Tool | Median before | Median after | NDJSON bytes before → after |
| --- | ---: | ---: | ---: |
| list | 4189.077 ms | 17.393 ms | 68,032,061 → 240,877 |
| read | 4391.485 ms | 83.151 ms | 68,032,061 → 1,303,839 |
| message | 4263.987 ms | 17.398 ms | 68,032,061 → 240,877 |

All six outputs for each action match byte-for-byte by SHA-256: list `9a88d418a77ae5f105c01ca9b2429ec0e2fe8f798b84b126dafda390ca44e521`, read `3ae8be617bfa7b5b14dad39e0627826fb5568e25addd8d7c00ea96855d8c74c3`, message `6764b82e14a95ff368e948cf5c743d4b611c0eb378faff519963bfbc1cc55ae3`. Output sizes remain 6,127, 164,780, and 160 bytes respectively.

## Correctness and limits

Five new tests in `desktop/test/agent-library-performance.test.ts` exercise exact output/order/counts, fresh renames and appended messages, selected tail/empty transcript formatting, missing-ID text, the advisor's twenty-message boundary, malformed library envelopes, and failed selected reads. Existing `agent.test.ts` and `bench-boundary.test.ts` mocks now return summary projections and targeted histories; their original assertions remain, including deep ancestry, own-thread protection, forbidden unrelated messaging/stopping, and cancellation.

Summary and full listing share the store's parser, filtering, file invalidation, and ordering. Neither old snapshots nor this sequence provide a transactionally frozen library. A record deleted after its summary was listed can make the selected read reject; advisor retains its existing unavailable-history fallback. Cold first summary enumeration still parses uncached records once. The measured repeated-call workload has a warm summary index, as the sidebar maintains in normal app use. Histories for a specifically requested thread remain complete before applying the existing tail limit.

Validation:

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-agent-library/compiled
(cd desktop && node --test /tmp/shinbo-perf-agent-library/compiled/test/agent-library-performance.test.js /tmp/shinbo-perf-agent-library/compiled/test/agent.test.js /tmp/shinbo-perf-agent-library/compiled/test/bench-boundary.test.js)
./desktop/node_modules/.bin/eslint desktop/main/agent-loop.ts desktop/test/agent-library-performance.test.ts desktop/test/agent.test.ts desktop/test/bench-boundary.test.ts --max-warnings 0
```

Main TypeScript and scoped lint pass. All 41 focused tests pass. An initial test invocation from the repository root failed two fake-harness tests because their fixture path is relative to `desktop`; rerunning from that intended directory passed. Parent owns full integration and native validation.

## Independent review of preceding fixes 63/64

Compared `components.tsx` and `thread-stats.ts` against the exact source baselines documented in `performance-preview-lifecycle-audit.md` and `performance-wave11-exports.md`. No concrete regression found. The component memo's JSON key preserves ordered declaration values, distinguishes real changes, and captures only the component ID; requests still read and validate saved declarations/disabled state and current credentials in the main process. Module version and ID changes remain effect dependencies. The shared region runtime is unchanged, including its hooks and `shinbo` bridge; no custom-region API was removed or changed.

Export summaries remain complete and ordered through the same store listing implementation. Every direct child is read fully, unrelated threads/grandchildren stay excluded, required read errors reject, and optional telemetry retains prior empty fallbacks. Eight focused component lifecycle and export regressions pass, including identity-preserving metadata broadcasts, changed declarations/version, teardown, missing target, required failures, and 130 children. No source change resulted from that review.

The subsequent full desktop check exposed two additional stale fixture owners: `runtime-performance.test.ts` still returned a library for its selected read, and `secondary-cancellation.test.ts` returned only one of its two tasks and deferred every request indefinitely. These mocks now distinguish summaries and targeted histories. Cancellation tests cover both asynchronous read boundaries and preserve the assertion that Stop starts no paid request. All twelve focused runtime/secondary tests pass with isolated localhost fixtures permitted; the sandbox initially rejected those servers. No production cancellation behavior changed. Parent subsequently reported the full desktop check passing 1,384 tests with two skips.

## Production-app verification

A bounded loopback model fixture drove the actual agent's `select_tool`, `threads(action=list, limit=20)`, and `threads(action=read, limit=3)` sequence in the checked production app. The list returned 4,379 characters; the selected persisted thread returned 2,238 characters with the expected “New thread · main · 2 messages” header and its saved background-stream answer. The selected thread was correctly absent from the first 20 list results because the separate 4,096-child native fixture had just added newer records. The final answer and fixture event both reported that distinction: list target false, selected read success true. No external provider, paid request, or mutation of the selected history was involved.
