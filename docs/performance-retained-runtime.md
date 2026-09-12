# Completed offscreen run retention

One P1 renderer finding: full completed output remained in the global run store for the renderer's lifetime when a background, scheduled, phone-started or navigated-away thread was never opened. The global listeners in `desktop/src/runs.ts` collect every delta and tool step, and `reconcile` lands foreign completions. Previously only the mounted `ThreadView` cached and settled that output. Neither the per-thread landed history nor the number of completed thread entries had a cleanup path for offscreen completions.

The existing block cache limits did not protect this RAM state. `rememberBlocks` caps cached turns at 40, clips tool input/output to 8 KiB, and normally keeps a thread's serialized cache under 512 KiB. It also evicts other block caches when localStorage quota is reached. Those rules remain unchanged. The fix runs the same pairing, cache and verified settlement path for completed unmounted runs. It clears only transient blocks, landed arrays and the persisted pending turn; held prompts, live output and unsaved drafts remain intact.

## Reachability and persistence

`AgentRuntime.finish` publishes a completed agent before `recordHarnessTurn` has finished saving its message. Foreign completion therefore adds its thread ID to a pending set; the next existing persisted-store change consumes that set once. Local sends settle after their acknowledged send request. The existing run subscription map identifies mounted ownership, including `ThreadView` and `AgentTranscript`. Mounted runs keep their current display path; the final unsubscribe tries settlement when navigation removes their last view.

Foreign adoption first reads the saved thread and captures its message count while that generation is still live. Completion reads may pair only messages at or beyond that boundary; identical older replies cannot authorize cleanup or receive the new tool cache. The earliest known boundary is retained across unsettled landed turns. Failed or late adoption reads leave the boundary unknown, so automatic cleanup conservatively retains RAM. Local acknowledged sends reuse their existing pending message count.

Settlement reads the persisted thread through the existing request API, checks the run generation and landed-array identity, then uses `pairBlocks`, `rememberBlocks`, `cachedBlocks` and `settleRun`. An unmatched persisted reply retries on the next store change. A store-change revision also triggers one fresh read if the actual save arrived while a stale read was in flight. No timer polls are added. Successful settlement, failed history reads and failed cache writes do not retry on unrelated store changes; these failures retain RAM and the existing mounted path remains available. In-flight reads are deduplicated. Because the store event has no thread ID, an unresolved unmatched completion can incur one additional read per subsequent unrelated store event until it can be matched; this is the explicit persistence-safety tradeoff.

## Actual-source A/B

`desktop/test/run-retention.test.mjs` transpiles the actual `runs.ts` module and uses the real compiled context/cache helpers. It drives the global delta, step, agents and store-change callbacks without mounting a view. The fixture completes 100 distinct threads with 20 tool steps apiece and 16 KiB of ASCII output per step. This payload is within existing tool output limits. A 5 MiB localStorage quota mock exercises existing cache eviction rather than permitting unlimited cache storage.

| Retained state after 100 completions | Before | After |
| --- | ---: | ---: |
| Full tool-step references in landed arrays | 2,000 | 0 |
| Characters reachable through those output fields | 32,768,000 | 0 |
| Saved-thread reads | 0 | 200 |

The before state retains 31.25 MiB of ASCII output content, plus block/string overhead. This is a deterministic reachable-content metric, not a V8 heap/RSS estimate; string representation and garbage collection are not inferred. The after state retains the existing bounded/evicting local cache and compact idle run records. Reading each newly observed foreign run at adoption and completion adds host I/O and temporary decoding work; no wall-clock speedup is claimed.

Pre-edit source copies are in `/tmp/shinbo-perf-retained-runtime/before/`. Exact commands:

```sh
SHINBO_RUN_RETENTION_SOURCE=/tmp/shinbo-perf-retained-runtime/before/runs.ts node --test --test-name-pattern='offscreen completed' desktop/test/run-retention.test.mjs > /tmp/shinbo-perf-retained-runtime/before.txt
node --test --test-name-pattern='offscreen completed' desktop/test/run-retention.test.mjs > /tmp/shinbo-perf-retained-runtime/after.txt
```

The before command intentionally fails the zero-retained-reference assertion and reports the baseline above. The after command passes. The test imports unchanged runtime dependencies from `desktop/dist-main`, so build main before running it in a fresh checkout.

## Regression checks

The new tests additionally cover 60 successive offscreen turns on one thread, held prompt preservation, saved-history failure, localStorage failure, relevant retries, a fresh run racing an old read, mounted ownership, unmount cleanup and zero extra reads across ten unrelated updates. Existing settlement, queue, composer, recovered-trace and activity tests remain intact; their IPC mocks now distinguish the saved-thread read from send requests.

```sh
desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-retained-runtime/after
node --test /tmp/shinbo-perf-retained-runtime/after/test/runs.test.js /tmp/shinbo-perf-retained-runtime/after/test/run-settlement.test.js /tmp/shinbo-perf-retained-runtime/after/test/run-activity-events.test.js /tmp/shinbo-perf-retained-runtime/after/test/composer-send.test.js desktop/test/run-retention.test.mjs > /tmp/shinbo-perf-retained-runtime/focused.txt
desktop/node_modules/.bin/eslint desktop/src/runs.ts desktop/test/run-retention.test.mjs desktop/test/runs.test.ts desktop/test/run-settlement.test.ts desktop/test/run-activity-events.test.ts desktop/test/composer-send.test.ts
```

All 79 focused tests, TypeScript compilation and targeted ESLint passed. The temporary compiled directory uses a `node_modules` symlink to `desktop/node_modules`; its sibling `src` symlink points to `desktop/src` for the existing composer source-extraction test. No provider requests, production data mutations, dependencies or protocol changes were used. Root integration owns the full suite and real-app background-completion/navigation interaction.

## Other lifecycle coverage and limits

The main-process runtime is `desktop/main/agent-loop.ts`; there is no `desktop/main/agents.ts`. Its run map retains the latest run per thread until `forget`, which is invoked when starting a new same-thread turn and in relevant recovery/deletion paths. Tool maps reference the same span objects rather than independent copies. Child spans are used to compose ancestor traces; changes retain before/after content for the user's undo/review flow. `flushTrace` sends bounded encoded data to `recordTrace` asynchronously, and the live span getter skips traced runs. No main-process record or change snapshots were blindly evicted by this fix.

Small idle renderer records and generation IDs still persist; they are not the demonstrated large-output retention. Failed persistence deliberately retains output. Deleting unrelated thread state, changing trace durability, discarding unreviewed file changes, Windows execution and platform accessibility behavior are outside this focused renderer change.


## Integration review correction

This corrects finding 55; it is not another counted performance issue. The original offscreen cleanup used the first generic store-change event after completion as its only persistence trigger. Two actual-source fixtures demonstrated failures:

1. An unrelated store change before the completed answer was saved consumed the pending completion; the actual later save never retried cleanup.
2. An older identical assistant reply could be mistaken for the new saved answer, attaching the new tool blocks to the old timestamp and clearing transient output prematurely.

The adoption message-count boundary and relevant-change retry described above address both. Wall-clock timestamps are deliberately not used: core timestamps have second precision and can advance monotonically beyond the wall clock during quick turns. An unknown boundary, a stale adoption generation, or a late baseline that may already include the answer conservatively retains output. Unknown older landed turns cannot acquire a newer boundary that would discard them.

The measured 100-thread output release remains 2,000 → 0 retained tool references / 32,768,000 → 0 reachable output characters, but history reads increase from the initial fix's 100 to **200**. Initial reads also occur when a foreign run is mounted, preserving a safe boundary if it later becomes offscreen. The test fixture now allows the initial live adoption read to complete before emitting completion, rather than synthesizing the entire run in one synchronous callback stack.

The integration tests cover both failures, a save during an in-flight stale read, initial read failure, late initial response, generation races, double identical replies, the earliest boundary across multiple unsettled turns, cache failure, held prompts and mounted/unmounted ownership. Successful cleanup still performs zero further reads across ten unrelated changes. Failed initial boundaries and cache writes likewise avoid generic-event retry loops.

Exact pre-correction copies: `/tmp/shinbo-integration-retention/runs.before.ts`, `run-retention.before.mjs`, and `run-activity-events.before.ts`. This snapshot already contains the concurrent recovery-sharing change; the review preserves its `adoptForeign(snapshot)` parameter and `rehydrate` implementation.

```sh
SHINBO_RUN_RETENTION_SOURCE=/tmp/shinbo-integration-retention/runs.before.ts node --test --test-name-pattern='foreign completion' desktop/test/run-retention.test.mjs
node --test desktop/test/run-retention.test.mjs
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-integration-retention/compiled
node --test /tmp/shinbo-integration-retention/compiled/test/runs.test.js /tmp/shinbo-integration-retention/compiled/test/run-settlement.test.js /tmp/shinbo-integration-retention/compiled/test/run-activity-events.test.js /tmp/shinbo-integration-retention/compiled/test/composer-send.test.js /tmp/shinbo-integration-retention/compiled/test/bridge-backpressure.test.js
node --test desktop/test/web-search-cancel.test.mjs desktop/test/timeline-selection-performance.test.mjs desktop/test/markdown-image-performance.test.mjs
```

The before command fails both new correctness assertions. The current source passes all 11 retention tests, 76 compiled run/settlement/activity/composer/bridge tests and 10 cancellation/timeline/image integration tests. Main TypeScript compilation and targeted lint pass. The activity fixture now implements the existing saved-thread request API used at adoption. Temporary compiled tests use links to the repository's desktop node_modules, src and main directories.

The scoped review found no additional concrete correctness regression in the 4 MiB bridge backlog change, the web-search caller's signal propagation, keyed timeline row memoization, or the cancellable Markdown image dwell. Their exact-source integration fixtures pass. Root owns the paired native UI checks and integrated full suite. Only runs.ts settlement/adoption bookkeeping, retention regressions, the activity request mock and this report were edited by this review; main.ts and recovery snapshot sharing were left untouched.

The subsequent full-suite run exposed six older IPC mocks that omitted `request`: five recovery-sharing cases and the renderer streaming helper. `run-rehydrate-performance.test.ts` and `renderer-performance.test.mjs` now return an empty saved message list from that mock; all original assertions remain unchanged. The five recovery cases and eight renderer performance cases pass. These are fixture corrections for the additional adoption read, not production changes or extra findings. Both main and renderer TypeScript checks pass.
