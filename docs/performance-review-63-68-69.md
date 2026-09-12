# Independent final renderer correctness review

Reviewed fixes 63, 68, and 69 against their exact saved baselines and implementation reports, following their current application callers. No concrete defect was found. Production source and tests remain unchanged.

## 68: subscription histories

The prior review in `performance-model-plan-history-review.md` still applies to the final source. `App.tsx` mounts `ModelPlans` in the Subscriptions settings surface. Collection preserves summary order, thread message order, exact inclusive five-hour and seven-day cutoffs, and current provider mapping. Missing or invalid summary dates request the corresponding full history. A backward completion clock triggers the complete-snapshot fallback; forward completion only narrows eligibility.

The multiple reads remain nontransactional. A new message saved to an excluded old thread after summary collection is outside that collected view, just as a snapshot need not include later writes. A selected thread deleted or made unreadable before its body is fetched rejects the collection; no partial totals are published. The unchanged component catch retains its initial empty ledger on failure. No claim of transactional consistency or live spending refresh is justified.

The report now also measures the all-recent endpoint: 64 selected bodies incur 65 requests and approximately neutral measured latency, with 0.33% extra transferred bytes. That result supports retaining the documented workload limitation rather than claiming a universal improvement or adding an unmeasured crossover heuristic.

## 69: subagent relationship indexes

Compared `context-bar.tsx` with `/tmp/shinbo-final-context-bar-before.tsx` and traced `App.tsx` through `ContextWidgets`, `WidgetContent`, and `subagentRows`. The Set replaces strict identifier membership over string identifiers; the Map appends child references in exactly the original global-array order. Branches still filter the same live/done status class. Root ordering, missing parents, self-parent exclusion, nested children, selected button behavior, and closed Finished details remain unchanged.

The indexes are local to each render, so changed statuses, parents, input order, and global agent arrays cannot leave a stale relationship cache. They do not mutate either input array. Arbitrary cyclic global live data and deep recursive rendering retain their prior limitations; this change does not introduce those paths or claim to support them.

## 63: component API lifetime

Compared `components.tsx` with `/tmp/shinbo-preview-lifecycle-audit/components.tsx`. `Built` keys mounted instances by component ID; `Frame` passes a stable reporting callback. The memo keys the bounded declaration list by its ordered string contents and retains ID as a dependency. The module effect additionally depends on module version and the reporting callback. Real declaration changes and new versions still load; fresh equal metadata arrays preserve the existing component and its state.

The module import continuation and rejection handler retain their existing `alive` guards and effect cleanup. No additional synchronous callback or subscription is introduced, so the memo change does not create a reentrancy path. The API contains declaration names, not secret values: main-process component requests reread component metadata and receive current credentials for each request. Stable renderer API identity does not cache old credentials or bypass current request validation. Existing authored effects continue until their component actually unmounts or their own dependencies change, which is the intended correction to unrelated metadata-triggered remounts.

## Validation

Twenty-eight focused tests passed:

```sh
node --test desktop/test/subagent-roots-performance.test.mjs desktop/test/component-lifecycle-performance.test.mjs
(cd desktop && node --test /tmp/shinbo-perf-model-plans/compiled/test/model-plan-history-performance.test.js /tmp/shinbo-perf-model-plans/compiled/test/model-plans.test.js)
```

The renderer extraction tests read current source. The eighteen existing provider tests used the available isolated compilation. No baseline benchmark mode, full build, native UI, external service, or privacy permission was invoked. The coordinator owns native validation and the full integration check.
