# Rust store and host performance fixes

Measured on the shared macOS development machine, September 12, 2026. Eight independent hot paths were fixed. Six warrant P1 attention for large histories; the two smaller scheduled-job wins are P2 and should not be counted as high-priority fixes without additional production-scale evidence.

The baseline is the original dirty checkout preserved in `/tmp/shinbo-perf-baseline/source.tar`, extracted into `/tmp/shinbo-perf-host-before`. No reset, commit, or protocol change was used. The baseline receives only the identical benchmark functions, not the fixes. Measurements below are medians of five batches from optimized Rust builds. Baseline and changed runs were sequential; other agents were working on this machine, so these are local synthetic workload measurements, not production latency claims. Both builds use the same fixtures.

| Issue | Priority | Fixture / batch | Before | After | User impact |
| --- | --- | --- | ---: | ---: | --- |
| 1. Annual cron search reparses fields for every candidate minute | P2 | 5 annual bookings | 159.245 ms | 0.067 ms | Removes about 32 ms of synchronous runtime work per rare booking in this fixture. |
| 2. Scheduled polling reparses every unchanged Markdown record | P2 | 20 lists of 50 jobs, 8 KB prompt + 32 KB graph each | 62.264 ms | 5.192 ms | Reduces recurring filesystem/validation work during snapshots and the 30-second scheduler tick. |
| 3. Opening a stored thread deep-copies its complete cached history | P1, memory pressure | 10 cached reads of 60 MB messages + 6.4 MB traces | 12.878 ms | 0.075 ms | Removes 66.4 MB of payload copying per read, including traces excluded from thread JSON. |
| 4. Reading traces first copies the entire conversation | P1, memory pressure | 10 trace reads beside the same 60 MB conversation | 13.167 ms | 1.082 ms | Copies only returned traces; eliminates 60 MB of unrelated message copying per request. |
| 5. Sidebar summaries normalize large first prompts unnecessarily | P1, large library refresh | 1,000 summaries, 60 KB first prompt | 110.906 ms | 1.559 ms | Avoids a roughly 100 ms summary-construction stall in this fixture. Renamed main threads improve from 70.635 ms to 0.086 ms. |
| 6. Every compact snapshot discards the selected thread cache | P1, large active thread | 5 compact snapshots after selecting a 66.4 MB thread | 438.818 ms | 0.154 ms | Avoids repeatedly rereading and reparsing the active conversation while refreshing sidebar data. |

The conversation fixture contains 1,000 messages of 60,000 ASCII bytes and 64 traces of 100,000 ASCII bytes. These fit the record-count and individual host-request limits. It is deliberately a large supported history, not a claim about typical histories. Copies in issues 3 and 4 are calculated from those actual fixture payloads and the removed clone paths; they are not measured process RSS.

## 1. Cron booking

`ScheduledJob::new`, `book_next_run`, and `claim_run` reach `next_run`. Previously the search allocated and reparsed five fields on each of up to 527,040 minutes. It now builds five integer masks once and advances over rejected days and hours. The performance change preserves the one-year search horizon, strict "after" boundary, UTC interpretation, and Sunday 0/7 equivalence. A concurrent task subsequently changed the day/weekday matching contract; that semantic change is not part of this performance fix or its A/B credit.

Regression: `cron_skips_preserve_calendar_and_field_semantics` covers year boundaries, stepped ranges, alternatives, impossible February dates, leap days, and both Sunday encodings. Existing scheduled-job tests also pass.

## 2. Scheduled store reads

`run_due_jobs`, runtime snapshots, manual execution, event triggers, edits, and completion all reach `ScheduledJobStore::load/list`. A metadata-stamped parsed-record cache now reuses unchanged records. Save and delete invalidate entries; listing removes vanished or malformed entries. Every read still checks file metadata, and changed records still pass the original parser and trust-boundary validation.

Regression: `scheduled_cache_reuses_records_and_observes_external_changes` verifies object reuse, external edits, malformed replacements, saving, and deletion. This retains parsed scheduled records in memory in exchange for reduced repeated I/O; the fixture retains about 2 MB of prompt/graph payloads. It is not a new durable index.

## 3. Selected thread reads

The `thread` NDJSON method calls `LiveClient::thread`, which previously called `ThreadStore::load` and cloned the cached `Thread`. That copied every message and trace even though trace fields are omitted from serialization. The runtime now sends an `Arc<Thread>` already owned by the cache. Mutation paths retain their owned copies. `serde` already supports `Arc`, so the JSON stays identical.

Regression: `targeted_thread_load_reads_only_the_requested_record` now asserts pointer identity across reads; the compiled-host large-snapshot integration test still verifies exact thread JSON and subsequent request health.

## 4. Trace reads

The desktop trace panel, phone trace endpoint, and agent `read_trace` tool reach `read_trace` in the runtime. It now borrows the cached thread, selects the newest traces under the existing 8 MiB reply budget, and clones only that selection. It no longer clones messages or traces that will be discarded.

Regression: `a_thread_of_huge_traces_answers_with_the_newest_that_fit` preserves ordering, the budget boundary, and the existing behavior of returning at least the newest trace. The benchmark isolates this path from selected-thread JSON serialization.

## 5. Sidebar prompt normalization

`threadSummaries` constructs a `ThreadSummary` for every thread. Previously it normalized the entire first user message even for a renamed main thread, then retained only the 48-unit display title and 200-unit search label. Main-thread normalization now stops at the searchable prefix, and renamed main threads skip it entirely. Subagent briefs keep their complete normalized text. Unicode whitespace normalization, thread-message markers, and UTF-16 title rules remain unchanged.

Regressions: `summary_normalization_bounds_main_prompts_and_preserves_subagent_briefs` and `thread_summary_keeps_renderer_label_rules` cover Unicode, the title/search boundary, named threads, sender markers, and full subagent briefs.

## 6. Compact snapshots

Both `snapshot` and `threadSummaries` use the compact runtime path. It formerly reparsed all files and cleared all parsed entries, including the active conversation. The store now records the most recently explicitly loaded thread ID, retains only that cached thread across compact snapshots, and reuses its validated metadata stamp. Other library records remain uncached. External changes and deletions still invalidate the retained record.

Regression: `compact_snapshot_keeps_only_the_last_explicitly_read_thread` verifies pointer reuse, a one-thread retained cache, no library-wide cache growth, and deletion handling. Cold library parsing remains; this fix does not claim to make every large historical library refresh constant time. The tradeoff is retaining one complete selected thread in memory instead of clearing every record.

## 7. Repeated summary refresh reparses the entire unselected library

Priority: P1. The selected-thread optimization in issue 6 could not help a large library of other conversations. Each `threadSummaries` request still parsed and retained every full transcript and trace before projecting metadata. The summary projection now lives in core, and `ThreadStore::list_summaries` caches only `ThreadSummary` values by file modification time and length. Cold projection processes one transcript at a time; subsequent unchanged refreshes stat files and reuse compact records. Thread creation, save, removal, malformed replacement, and external edits invalidate the corresponding metadata. The most recently selected full thread remains the only full record retained across summary requests.

The real compiled-host fixture in `crates/host/tests/library_performance.rs` creates 32 conversations, each with 512 alternating user/assistant messages of 60,000 bytes and four 100,000-byte traces. It writes **997,169,862 bytes** and receives **385,976 bytes** of summary JSON. No selected thread warms the transcript cache. Compared with the stage-one implementation containing fixes 1–6, five repeated summary requests have median **2,367.824 ms before → 6.154 ms after**. Every response verifies all 32 conversations, message counts, and user counts.

The first request still reads the library: the final run measured 1,812.067 ms before and 2,890.857 ms after while other work ran concurrently. No cold-start latency improvement is claimed. The improvement is removing full rereads on subsequent sidebar refreshes. A peak-RSS attempt with `/usr/bin/time -l` could not run because the sandbox denies `sysctl kern.clockrate`; no measured RSS figure is claimed. The retained-state guarantee is covered structurally by the regression rather than inferred from timing.

Regressions: `summary_cache_keeps_projection_and_observes_every_file_change` checks exact projected values, pointer reuse, zero retained full transcripts for summary-only reads, same-length external content edits with a new timestamp, saves, malformed replacement, and deletion. `summaries_preserve_snapshot_metadata_and_archive_retention` checks the existing archive expiration behavior. The compiled-host large-snapshot test continues to verify protocol content. The desktop `thread-state` source-contract test now reads the projection from its new core owner; all ten tests in that file pass.

## 8. Host envelopes copy already serialized large responses

Priority: P1, memory pressure. `serve` previously wrapped its existing `serde_json::Value` result using `json!`. The installed serde_json macro calls `to_value(&result)`, which deep-copies all strings and collections before transport encoding. `successful_response` now moves that existing value into the response object. Framing, success fields, error fields, and chunk sizes are unchanged.

The 60 MB fixture measures ten envelope constructions, median of five batches: **19.928 ms before → 0.012 ms after**. It reuses the payload between iterations, so fixture creation is excluded. This removes one additional 60 MB payload copy for such a response, distinct from the core thread-copy removal in issue 3. `response_envelope_moves_the_existing_payload` verifies identity of the payload allocation through wrapping; existing chunk/Unicode and compiled-host tests verify the wire format.

## Reproduction and validation

The original store fixture lives in `crates/core/tests/performance.rs`; `benchmark_thread_summary_prompts` moved with its projection into `crates/core/src/thread.rs`. The host now also contains `benchmark_large_response_envelope`, and `crates/host/tests/library_performance.rs` measures real library requests. These workloads are ignored during ordinary test runs.

```sh
cargo test --manifest-path /tmp/shinbo-perf-host-before/Cargo.toml --workspace --release --locked benchmark_ -- --ignored --nocapture --test-threads=1
cargo test --workspace --release --locked benchmark_ -- --ignored --nocapture --test-threads=1
cargo test --manifest-path /tmp/shinbo-perf-summary-before/Cargo.toml --workspace --release --locked benchmark_ -- --ignored --nocapture --test-threads=1
cargo test --release --locked --test library_performance -- --ignored --nocapture --test-threads=1
cargo fmt --all -- --check
cargo check --workspace --locked --all-targets
cargo test --workspace --locked
cargo clippy --workspace --locked --all-targets -- -D warnings
```

After fixes 7–8, the Rust checks passed with 39 core tests, 7 host tests, and 2 compiled-host integration tests. A later concurrent task changed cron day/weekday semantics and unfinished-goal replacement behavior in the shared files; the final integration run then reported three old-expectation failures in those areas. The coordinating agent was notified to reconcile that separate work. The summary, envelope, and archive regressions pass. The integration fixture transfers more than 16 MiB through the real compiled NDJSON host and verifies content and subsequent requests. Original measurements are in `/tmp/shinbo-host-before.txt` and `/tmp/shinbo-host-after.txt`. Stage-two isolation uses `/tmp/shinbo-perf-summary-before`, containing fixes 1–6 but not 7–8. Additional measurements are in `/tmp/shinbo-summary-before.txt`, `/tmp/shinbo-summary-after.txt`, `/tmp/shinbo-library-before.txt`, and `/tmp/shinbo-library-after.txt`. The final two library logs exclude the unsupported RSS instrumentation.

The real Electron app interaction is assigned to the coordinating agent and is not claimed as verified by this Rust-only agent. Windows and non-macOS behavior were not exercised here. No phone protocol or visible feature was added.

## Integration correction and ownership

The concurrently added `audit_regression_due_dispatch_keeps_failed_booking` exposed an existing early-save error: `run_due_jobs` persisted the advanced booking before thread storage succeeded. Removing that premature save leaves the existing save inside `hand_out_run`, after thread creation and before dispatch. The regression now passes and a redundant fsync is removed. This correctness fix is not counted as another P1 performance item.

Owned production hunks: cron search and scheduled cache in `crates/core/src/scheduled.rs`; read-only Arc replies, limited trace cloning, summary command/snapshot projection, and premature scheduled save removal in `crates/core/src/live.rs`; last-read retention, compact summary cache, generic listing reuse, and the moved summary projection in `crates/core/src/thread.rs`; summary dispatch and moved response envelope in `crates/host/src/main.rs`. Owned test files are `crates/core/tests/performance.rs`, `crates/host/tests/library_performance.rs`, and the one source-path change in `desktop/test/thread-state.test.ts`. The concurrent DOM/DOW cron semantic change, unfinished-goal restriction, and separately added persistence regressions are not part of this agent's work.

Latest targeted validation after the concurrent changes: summary projection/cache tests, response envelope/chunk tests, failed-booking regression, all ten desktop thread-state tests, cargo check, clippy, and formatting checks pass.
