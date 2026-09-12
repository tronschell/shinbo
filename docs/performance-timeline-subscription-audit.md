# Idle timeline span subscriptions

P1: an idle saved timeline rerendered on every global span broadcast from other threads. The runtime's live refresh interval is 250 ms; `main.ts` sends the aggregate `agents.spans()` tree map to the renderer, and Timeline's subscribed `take` callback selects its own thread. Previously, a missing thread entry produced a new empty array every time. Explicit fresh empty arrays had the same effect. Those identity changes forced local Timeline state updates despite the external-prop memo boundary.

The row memo boundary avoided rebuilding unchanged row interiors, but each local update still mapped and reconciled all 8,002 row elements. The fix changes the existing `setLive` call to a functional update that keeps an already empty state when the incoming thread entry is absent or empty. A real nonempty snapshot is accepted normally; when an existing live run disappears, state becomes empty once. No subscription framework or content comparison is introduced.

## Actual callback evidence

The exact pre-edit source is `/tmp/shinbo-timeline-subscription-audit/timeline.tsx`. The subscription test added to `desktop/test/timeline-selection-performance.test.mjs` executes the real Timeline effects and the callback registered through `onSpans`. Its fixture contains 8,001 saved spans, round-tripped through actual trace encoding/decoding within the one-MiB storage limit, yielding 8,002 timeline rows.

Forty foreign broadcasts model ten seconds at the runtime's 250 ms refresh cadence. Half omit the viewed thread, and half include a fresh empty array for it. Five-run paired medians:

| Work for 40 broadcasts | Before | After |
| --- | ---: | ---: |
| Recreated keyed row elements | 320,080 | 0 |
| Component/reconciliation time | 265.694 ms | 0.045 ms |

The harness drives updates synchronously for deterministic measurement; the elapsed timing excludes the ten-second event spacing and native DOM/layout. The important invariant is that foreign events no longer schedule row work.

```sh
SHINBO_TIMELINE_SUBSCRIPTION_BASELINE=/tmp/shinbo-timeline-subscription-audit/timeline.tsx node --test desktop/test/timeline-selection-performance.test.mjs
```

## Correctness and boundaries

The regression verifies preservation of every saved row; receipt of a new live run; a no-op for the same nonempty array; acceptance of a fresh changed nonempty snapshot; clearing through missing and explicit-empty entries; clearing on thread switch; exactly one active subscription; and cleanup on unmount. The existing detail-selection regression, scoped lint, and renderer typecheck also passed.

Fresh nonempty snapshots still rerender the viewed active run, even when some records are unchanged. That is intentional: host IPC produces new snapshot objects, and suppressing their updates would require a separately justified comparison or protocol change. This fix only removes the demonstrated empty-state invalidation. It is distinct from unchanged parent props and local detail selection because the update originated from an unrelated global subscription event.
