# Performance integration review

Reviewed the performance hunks against the frozen pre-task working tree at `/tmp/shinbo-perf-baseline/tree`, alongside `performance-agent-1.md`, `performance-agent-2.md`, `performance-agent-3.md`, and `performance-agent-5.md`. Unrelated concurrent edits were preserved. This review adds one distinct P1 performance fix; the integration correction below is not another counted performance finding.

## Integration correction: tail-scroll geometry

The persistent observer optimization stopped calling the scroll-state reconciler after content resized. An unpinned transcript could shrink until its bottom was visible while `atEnd` remained false. The jump button could remain visible and subsequent content growth would not follow.

`desktop/src/cli.tsx` now reconciles geometry after resize and direct-child mutation, retaining the previous unchanged-state guard. The observation also records the stable `onScroll` callback, so a reset-key change replaces its observers and callbacks instead of capturing a previous thread's key. Scrolling up still stays unpinned when content grows. Observers continue to survive ordinary streaming renders.

The new regression in `desktop/test/renderer-performance.test.mjs` covers resize shrinkage, repinning before subsequent growth, child mutation shrinkage, reset-key changes, and disconnect cleanup. The existing performance fixture still records 501 registrations including one added child across 100 updates, one final disconnect, and zero unchanged pin-state writes.

## Additional P1: unchanged context ledgers rebuild on every render

`ThreadView` calls `threadUses`, `threadExperiments`, and `threadBreakdown` on streaming updates and composer keystrokes. Each getter previously parsed and normalized its entire cross-thread localStorage map, returning new objects that invalidated the existing `useContextLedger` memo. That also repeatedly scanned the selected thread's full message history to rebuild its ledger.

`desktop/src/context.ts` now retains each of those three validated maps alongside the exact serialized value it read. Each read still checks localStorage. A changed value runs the original parsing and normalization; unchanged values retain their object identity. The empty uses array is stable too. Existing writes remain synchronous, and direct storage changes, clearing, malformed input, and corrected input remain observable. The current callers only read these records or create new records when updating them; they do not mutate cached values.

The regression executes the actual three getters, actual `buildLedger`, and the existing `useContextLedger` function using the renderer test's deterministic React-hook double. The corrected fixture contains 5,000 stored thread ledgers totaling **1,356,673 ASCII bytes**, a selected conversation of **1,024 messages**, and **100 unchanged renders**. Messages alternate user/assistant with valid timestamps; only the 512 assistant messages carry generation metadata. It verifies message, reply, and token totals and exercises local writes, direct storage replacement, empty storage, malformed data, and numeric normalization.

| Measurement | Frozen baseline | Fixed |
| --- | ---: | ---: |
| Storage JSON parses | 300 | 3 |
| Full ledger builds | 100 | 1 |
| Median elapsed time for 100 renders, five batches | 1,657.465 ms | 20.801 ms |

This is a P1 large-library interaction stall: the corrected baseline fixture averaged about 16.57 ms of synchronous work per render from this path alone. These are local synthetic execution timings, not measured Electron frame times. Storage reads and string comparison remain, and valid changes still rebuild the ledger. The cache retains three raw strings and their parsed maps; no additional durable index or delayed persistence was introduced.

The initial result was 1,812.252 → 35.292 ms with 10,000 messages and generation metadata on user messages. That synthetic fixture exceeded the core's 1,024-message limit and violated assistant-only generation validation, so its latency is superseded by the supported-shape rerun above. The map size is under ordinary localStorage capacity, there is no 5,000-thread library cap, and message text and generation values fit their existing bounds. `/tmp/shinbo-ledger-supported-review/renderer-performance.before.test.mjs` retains the original test; `paired.log` contains the corrected before/fixed result. The production baseline remains the original pre-task `context.ts`, and production source was not changed for this correction. Five baseline batches then five fixed batches ran after the other agent released the measurement lane; these are paired fixture results, not alternated rounds.

```sh
SHINBO_RENDERER_BASELINE=/tmp/shinbo-perf-baseline/tree/desktop node --test --test-name-pattern='unchanged ledger storage' desktop/test/renderer-performance.test.mjs
```

## Other reviewed paths

- `runs.ts`: writes remain synchronous, notifications are keyed by changed thread and scheduled once per batch, and the changed set is cleared before listeners run so reentrant writes schedule the next batch. Stable subscriptions and unsubscribe cleanup are preserved. No verified integration regression found.
- Rust summaries: summary-only listing retains compact projections and at most the most recently explicitly read full thread. Save/delete invalidation, changed metadata, malformed replacements, deletion, selected-thread retention, and archive retention passed the targeted tests. No source changes were needed. Modification-time/length stamps cannot distinguish an external edit that deliberately preserves both values; that stamp limitation already existed for parsed thread caching.
- Async catalogs: the production main process constructs one cache instance for each catalog. Forced refresh callers share the existing in-flight promise through asynchronous persistence, preventing overlapping writes by that instance. Age-valid callers may consume the already updated in-memory catalog while its disk write is pending. Cache write failures retain the prior best-effort behavior. Existing catalog and metadata concurrency/persistence tests pass; no verified race requiring another change was found.

## Validation and reproduction

Eight renderer performance/lifecycle regressions passed with frozen-baseline A/B enabled. Seventy-five existing context, ledger, runs, catalog, and metadata tests passed. Renderer and main TypeScript checks and scoped ESLint passed. Five targeted Rust tests passed: three summary tests, selected-thread cache retention, and archive retention.

```sh
SHINBO_RENDERER_BASELINE=/tmp/shinbo-perf-baseline/tree/desktop node --test desktop/test/renderer-performance.test.mjs
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.renderer.json --noEmit
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-integration-review/dist-main
mkdir -p /tmp/shinbo-integration-review/src
ln -sf "$PWD/desktop/src/App.tsx" /tmp/shinbo-integration-review/src/App.tsx
NODE_PATH="$PWD/desktop/node_modules" node --test /tmp/shinbo-integration-review/dist-main/test/context-clear.test.js /tmp/shinbo-integration-review/dist-main/test/ledger.test.js /tmp/shinbo-integration-review/dist-main/test/runs.test.js /tmp/shinbo-integration-review/dist-main/test/catalog.test.js /tmp/shinbo-integration-review/dist-main/test/model-metadata.test.js
cargo test --workspace --locked summary
cargo test --workspace --locked compact_snapshot_keeps_only_the_last_explicitly_read_thread
cargo test --workspace --locked summaries_preserve_snapshot_metadata_and_archive_retention
cd desktop
./node_modules/.bin/eslint src/cli.tsx src/context.ts test/renderer-performance.test.mjs --max-warnings 0
```

This subtask did not launch Electron or modify `dist-main`. Real-app interaction remains with the coordinating agent, including the scroll-up → shrink-to-fit → grow sequence and the same sequence after switching threads. VoiceOver, display geometry, shortcuts, privacy permissions, signing, and non-macOS execution were not verified here.

Owned edits: the geometry/callback hunks in `desktop/src/cli.tsx`, the three cached storage readers and empty-use constant in `desktop/src/context.ts`, two new regression cases in `desktop/test/renderer-performance.test.mjs`, and this report. Other hunks in those files belong to the original performance agents or concurrent work.
