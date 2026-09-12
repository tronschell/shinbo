# Timeline detail selection

P1: opening or closing a detail in the 8,002-row timeline rebuilt every row, despite only the selected row changing. The whole-Timeline memo boundary applies to unchanged external props; local selection state correctly bypasses it. Browser content visibility skips some offscreen layout, but does not avoid this React row work.

The fix extracts `TimelineRow` with React's default memoization and makes the existing collapse toggle callback stable. Row layout records and original spans already keep their identities during selection changes. Each row receives primitive selected/collapsed flags, so opening or closing a detail updates that row and selecting a different row updates both old and new selections. Changed axis, trace data, row layout, or clock values remain normal invalidations. No custom comparator, row truncation, or new dependency was introduced.

The exact pre-edit source is `/tmp/shinbo-timeline-selection-audit/timeline.tsx`. The fixture is one completed root and 8,000 tool siblings, producing 8,002 visible list rows including Overall. `desktop/test/timeline-selection-performance.test.mjs` invokes the actual rendered name-button handlers for 20 alternating detail-open/detail-close clicks. Its hook/reconciliation runner has stable state setters and separate memo instances by component type and keyed tree location.

| Work for 20 clicks | Before | After |
| --- | ---: | ---: |
| Duration calculations | 480,150 | 90 |
| Five-run component/reconciliation median | 415.50 ms | 116.09 ms |

The timing excludes native DOM/layout work and should not be presented as end-to-end click latency. The row list still performs a lightweight keyed map on each selection; the large unaffected row subtrees are reused.

Reproduce:

```sh
SHINBO_TIMELINE_SELECTION_BASELINE=/tmp/shinbo-timeline-selection-audit/timeline.tsx node --test desktop/test/timeline-selection-performance.test.mjs
```

Regression coverage retains all rows, verifies selected/unselected buttons and correct original output, switches selected rows, collapses/restores the whole turn, changes to the token axis, replaces a tool's name/output/tokens, and verifies updated details. Renderer typecheck, scoped lint, and the five combined renderer interaction/image tests passed.

The coordinating agent also measured 20 alternating detail open/close clicks in the frozen native app, on the Time axis with 8,002 rows and consistent viewport/DevTools state. Before the row change, click-to-second-animation-frame times were `[530.2, 575.7, 576.4, 612.8, 541.8, 466.4, 444.5, 512.5, 464.8, 535.5, 486.9, 463.7, 501.5, 494.3, 464.6, 515.3, 497.4, 459.6, 491, 539]` ms, confirming a visible half-second interaction delay. The coordinating agent owns the paired fixed native measurement and full app verification.

The paired frozen-production after run measured the same 20 alternating Tool 0 detail clicks on 8,002 rows: median click-to-second-animation-frame 499.45 → 445.40 ms (10.8% lower). Raw timings are `/tmp/shinbo-perf-round2/timeline-selection-native.json`. The native improvement is substantially smaller than the component-only improvement; browser rendering remains expensive in this extreme timeline. These runs used the same open DevTools/viewport, and native accessibility observation may add overhead. This does not establish fluid frame-rate detail interaction.
