# Activity lineage grouping

P1 under the supported large-library workload: opening the Agent activity dashboard builds the thread lineage for only 60 visible rows, but first copies every previously grouped sibling for each next child. With 16,000 direct children, `activity.ts` performed 127,992,000 redundant reference copies before drawing those rows.

The only renderer caller is `ActivityView.tsx`'s memoized `Lineage`, which calls `lineage(threads, LINEAGE_ROWS)` with `LINEAGE_ROWS = 60`. The helper now pushes onto its own per-parent arrays. It still sorts siblings and roots with the same stable comparator, follows the same traversal, and returns the same connector metadata. Caller data remains unchanged.

Actual baseline source was copied to `/tmp/shinbo-native-subagent-fixture/activity-before.ts`. The regression extracts and transpiles the real helper from baseline and current source. Each timing is the median of three balanced before/after calls; an instrumented Map counts the previous array lengths discarded during replacement. Full returned rows compare equal.

| Fixture | Before | After | Redundant reference copies |
| --- | ---: | ---: | ---: |
| 4,096 direct children; 60 visible rows | 9.823 ms | 0.551 ms | 8,386,560 → 0 |
| 16,000 direct children; 60 visible rows | 245.185 ms | 1.336 ms | 127,992,000 → 0 |

The library has no 16,000-thread cap; this is a large supported stress fixture, not a typical usage claim. These measurements isolate grouping and traversal and do not measure host loading or browser paint. Sorting remains O(n log n), and traversal behavior for cyclic data is unchanged.

```sh
LINEAGE_BASELINE=/tmp/shinbo-native-subagent-fixture/activity-before.ts node --test desktop/test/lineage-performance.test.mjs
node --test desktop/test/lineage-performance.test.mjs
(cd desktop && npx eslint src/activity.ts test/lineage-performance.test.mjs --max-warnings 0)
```

Focused regression and lint passed. Coverage verifies stable ties, newer-child ordering, a grandchild, orphan/self parents, limits, unchanged inputs, identical complete baseline output, and zero redundant copies with 4,096 children. Coordinator owns integrated checks and native activity-dashboard verification; the disposable 4,096-child native fixture already exists in the current isolated profile.

A separate expired-trace early-filter idea was deferred: moving filtering before deduplication can change retained Map insertion order when expired and recent traces describe the same agent. No AgentView filtering change or additional counted fix was made for that idea.

## Production Electron verification

The checked Activity view rendered a thread tree of 60 out of 4,120 stored histories. The parent “Native subagent relationships — 4096 children” appeared with its correctly indented saved children in descending stored order (4096, 4095, and onward), alongside other root histories. The year/day chart and project totals remained visible. This checks the real capped tree layout and metadata path; the paired latency measurements above come from the actual lineage function, not this screenshot.
