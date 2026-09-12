# Subscription spending history selection

## Confirmed P1 and minimal fix

Opening Settings → Subscriptions mounted `ModelPlans`, which requested every complete transcript to extract only generation timestamps, models, and input/output tokens. On a supported 64-thread library with 128 roughly 8 KiB messages per thread, this moved 68,380,427 NDJSON bytes before publishing two small spending totals. A long-lived library made opening subscription settings wait seconds and parsed unrelated old bodies in both the main process and renderer.

The existing complete `threadSummaries` response already includes every message timestamp. `desktop/src/model-plans.tsx` now records collection start time, requests summaries, and skips only histories whose message dates are all strictly older than seven days before that start. It reads each remaining complete thread, then uses the unchanged generation extraction, provider mapping, and `planSpend` at completion time. There is no new host method, schema, cache, dependency, or sister-client protocol change.

Old-created threads with recent messages remain included. Exactly-on-cutoff and future timestamps remain included. Missing dates and invalid date strings conservatively trigger a full thread read. Required read errors reject, retaining the existing UI failure behavior rather than publishing partial totals. Malformed on-disk records are skipped through the same store parser/warnings as a snapshot. If completion wall time precedes collection start, the code falls back to the original full snapshot so now-eligible older usage is retained. The completion timestamp is captured once for the normal path.

## Paired fixture

Exact baseline: `/tmp/shinbo-perf-model-plans/model-plans.before.tsx`. Probe and disposable library: `/tmp/shinbo-perf-model-plans/probe.cjs` and `library/`. It loads the actual before/current `ModelPlans` effect and helpers, runs their actual host requests through the real NDJSON parser/assembly and same debug host binary, and captures the ledger passed to React state. Hook plumbing and non-history credential/CLI/balance calls are fixtures. V8 serialize/deserialize models payload copying; this is controlled real-host collection latency, not measured native UI frame time.

The 64 valid threads have 128 messages each and measured generation records on assistant messages. All were created well before the week; 61 contain only older activity and three have recent assistant turns. The host summary index is warmed as in the normal open-app sidebar. Both variants report exactly three turns, 600 input tokens, and 300 output tokens in each window. Actual stdout traffic is 68,380,427 → 3,429,535 bytes. Neither token values nor transcript content is truncated.

Three alternating pairs ran after the parent confirmed the full desktop check had completed and heavy native profiling had stopped:

```sh
node /tmp/shinbo-perf-model-plans/probe.cjs /tmp/shinbo-perf-model-plans/model-plans.before.tsx
node /tmp/shinbo-perf-model-plans/probe.cjs desktop/src/model-plans.tsx
```

Raw results: `/tmp/shinbo-perf-model-plans/paired.jsonl`. Pair order is before/after, after/before, before/after. Fixed time for exact spending comparison is 2026-09-12 08:00 UTC; latency uses the monotonic clock.

Median collection latency was **4,411.782 → 231.116 ms**. All six spending outputs matched SHA-256 `6abd03bd7e3e7b644f6029b8a0524a88421fbae163c39f698a22b481218bf040`.

The improvement excludes old histories; a library where every thread has recent activity still transfers all relevant bodies and adds per-thread request overhead. A first cold summary enumeration still parses uncached records. This change does not claim to solve that different workload or introduce a metadata aggregation protocol to optimize it. Snapshot and summary-plus-read collection are both nontransactional with respect to newly saved records.

## Checks and ownership

Seven new tests in `desktop/test/model-plan-history-performance.test.ts` cover exact five-hour/week totals, old-created but recent threads, future times, exact boundary inclusion, missing/invalid dates, completion time advancing, backward-clock fallback, empty summaries, and required read failures. Eighteen existing model-plan/provider tests pass unchanged.

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-model-plans/compiled
(cd desktop && node --test /tmp/shinbo-perf-model-plans/compiled/test/model-plan-history-performance.test.js /tmp/shinbo-perf-model-plans/compiled/test/model-plans.test.js)
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.renderer.json --noEmit
./desktop/node_modules/.bin/eslint desktop/src/model-plans.tsx desktop/test/model-plan-history-performance.test.ts --max-warnings 0
```

All 25 tests, both TypeScript checks, and scoped lint pass. The isolated test output directory links the existing desktop dependencies and source paths; the first invocation lacked that source symlink and was corrected without changing tests. Production ownership is limited to the ModelPlans history request, the small `readPlanLedger` helper, and narrowing `planGenerations`' input type to its consumed `threads` field. Parent owns full integration and real-app validation.


## All-recent upper-bound follow-up

A separate library at `/tmp/shinbo-perf-model-plans-all-recent/library` keeps the same 64 × 128 × roughly 8 KiB shape, but every message is recent. All 4,096 assistant generations must count. Run the same exact-hook probe with:

```sh
SHINBO_PLANS_ALL_RECENT=1 node /tmp/shinbo-perf-model-plans/probe.cjs /tmp/shinbo-perf-model-plans/model-plans.before.tsx
SHINBO_PLANS_ALL_RECENT=1 node /tmp/shinbo-perf-model-plans/probe.cjs desktop/src/model-plans.tsx
```

The first alternating batch overlapped another agent's renderer benchmark. Its timing is excluded and retained in `all-recent-overlap.jsonl`. Three fresh alternating pairs were run after the parent confirmed that work stopped. `all-recent-clean.jsonl` contains these accepted samples.

Before samples were 4,407.202, 4,514.935, 4,450.221 ms; after samples were 4,714.664, 4,428.962, 4,472.461 ms. Medians: **4,450.221 → 4,472.461 ms**, a **0.50%** change. Requests increased from one snapshot to one summary plus 64 transcripts; traffic increased **68,380,427 → 68,608,707 bytes (+0.33%)**. Every sample reports exactly 4,096 turns, 819,200 input tokens, and 409,600 output tokens in both windows, SHA-256 `d2f221a2e21168751ee03fcd38214699d80e5b9c9aefdd267421a177f7c83594`.

This establishes no useful speedup when every history is eligible, and only a small measured overhead relative to the paired variation. A precise crossover fraction was not established by these two endpoint workloads: 3/64 eligible gives the measured large gain; 64/64 is approximately neutral. No additional full-snapshot fast path or source change was added from this follow-up.

## Integration: bound retained targeted histories

The bounded follow-up audit found that the new sequential-read path exposed a cache retention problem: `ThreadStore::read` set `last_read` but kept every previously targeted full record in `parsed`. Only a later compact/full-uncached listing removed the others. Thus the all-recent subscription sequence could leave the entire library cached in Rust after the renderer discarded transcript bodies. This is an integration correction to this issue, not an additional issue count.

One retain operation in the shared `ThreadStore::read` now keeps only the successfully read ID before updating `last_read`. Repeated reads and compact refreshes still reuse that last record. Failed reads leave the last successful cache intact. Existing returned `Arc<Thread>` values remain valid after eviction. File metadata invalidation, malformed-file handling, summary cache contents, saves, and the explicitly cached full-list API retain their existing semantics. Alternating targets may now require reparsing when revisited; retaining a whole bulk-read library indefinitely is avoided without adding a cache policy framework.

The actual-store regression creates 64 valid records, each containing 16 KiB of message text and 8 KiB of trace text. It warms summaries, drops each targeted reply, and inspects retained cache entries: **64 records / 1,572,864 payload bytes → 1 record / 24,576 payload bytes**. These are measured retained message/trace string lengths, excluding object overhead, allocator capacity, and process RSS. The test also checks same-Arc reuse across a summary refresh, still-valid earlier replies, and failed-read cache preservation.

Exact pre-edit store source: `/tmp/shinbo-perf-targeted-cache/thread.before.rs`. Failing/passing logs: `before.log` and `after.log` in that directory. Reproduce with:

```sh
cargo test -p shinbo-core --locked targeted_library_reads_retain_only_the_last_full_record -- --nocapture
```

All required Rust formatting, workspace check, workspace tests, and warnings-denied clippy pass after the change. Only `crates/core/src/thread.rs` was edited for this correction: the single production retain line and its meaningful inline test. No protocol changes. Parent owns rebuilding the app's host binary and final native validation.

## Integration: release processed renderer histories

Independent review identified the matching renderer retention: `readPlanLedger` accumulated every selected full `Thread` until its final extraction pass. On the all-recent library, this kept all selected transcript bodies reachable across the sequence even though the result needs only generation metadata. This is another integration correction to issue 68, not a new counted issue.

The helper now extracts `planGenerations` immediately after each awaited thread and appends those small rows using a loop. It retains no array of full histories. Collection order, timestamp parsing, final completion time, backward-clock complete-snapshot fallback, and all-or-nothing error publication are unchanged. No argument spread, queue, cache, host protocol, or storage format was introduced.

Exact pre-edit source and test are under `/tmp/shinbo-perf-plan-retention/`. The new actual-function regression supplies 64 distinct supported 16-KiB transcript bodies and uses generation getters to count bodies not yet consumed by extraction. Before the fix, all 64 bodies remain necessary and reachable until the final pass: **1,048,576 pending payload bytes**. After the fix, each body is consumed before the next request: **16,384 pending payload bytes**, with exact ordered generation output. These counts describe unprocessed payload ownership, not GC timing, allocator capacity, process RSS, or immediate memory reclamation. Source inspection confirms the accumulated result contains only primitive generation fields and no transcript references. The separate backward-clock fallback deliberately retains the original complete-snapshot behavior.

The regression fails against the saved baseline with `1048576 !== 16384`; `before.log` preserves the failure. All eight history tests and eighteen existing provider tests pass against the final source, recorded in `after.log`. Both TypeScript configurations and scoped ESLint pass. The isolated test output initially lacked the source symlink needed by the existing provider suite; adding that test-environment link resolved it without a product change. No CPU benchmark or native app interaction was performed for this integration correction.

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-plan-retention/compiled
(cd desktop && node --test /tmp/shinbo-perf-plan-retention/compiled/test/model-plan-history-performance.test.js /tmp/shinbo-perf-plan-retention/compiled/test/model-plans.test.js)
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.renderer.json --noEmit
./desktop/node_modules/.bin/eslint desktop/src/model-plans.tsx desktop/test/model-plan-history-performance.test.ts --max-warnings 0
```

## Production-app display verification

The coordinator added a disposable loopback-only `plan-deepseek` mapping with bare model ID `fixture-deepseek-plan`, without credentials or changing the selected local model. A locally recorded generation supplied exactly 321 input tokens and 123 output tokens. In the checked production app, Settings → Models → Subscriptions → DeepSeek displayed `321 in · 123 out · 5h` and `321 in · 123 out · 7d`, with one turn in each window. This verifies the actual aggregation/display path without a paid request or external balance API.
