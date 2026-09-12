# Timeline render audit

## Confirmed fix

P1: an open timeline with a large saved trace recreated every row on unrelated parent renders, including composer updates. `ContextWidgets` renders `Widget` and `WidgetContent`, which pass primitive thread ID, sending state, carried token count, and an ordinarily absent sample into `Timeline`. The existing row-layout memo avoided relayout when inputs were unchanged, but the component still rendered `Rows`, recreating all row controls, labels, and bars.

The fix wraps `Timeline` in React's normal memo boundary. Unchanged external props reuse the subtree. Local selection, collapse, axis, expansion, fetched/live spans, and timer state still invalidate the component normally. Existing source comments were removed as required by `AGENTS.md`; no CSS was changed in this fix.

## Measured evidence

Exact pre-edit source and CSS are in `/tmp/shinbo-timeline-render-audit/`. The fixture `spans.json` there contains one completed agent root and 8,000 sequential tool siblings, each 80 ms long, spaced 100 ms apart, with 10 tokens and small payloads.

The actual component's server rendering creates 8,002 rows including Overall, about 80,031 HTML tags, and 24,007 duration calculations. Its five-run initial-render median was 276.56 ms in the first local probe, before browser DOM insertion/layout. That number establishes workload size; server rendering is not a browser interaction latency claim.

The dedicated `desktop/test/timeline-performance.test.mjs` executes the actual compiled Timeline and child component functions with a deterministic hook/reconciliation runner. Twenty unchanged-prop renders of that fixture:

| Work | Before | After |
| --- | ---: | ---: |
| Duration calculations | 480,140 | 24,007 |
| Five-run median | 1,557.17 ms | 46.08 ms |

Reproduce against the exact baseline:

```sh
SHINBO_TIMELINE_BASELINE=/tmp/shinbo-timeline-render-audit/timeline.tsx node --test desktop/test/timeline-performance.test.mjs
```

The regression check keeps all 8,002 rows, selects the first tool and verifies its detail, closes that detail, and supplies a replacement sample whose four expected rows render. No row truncation or new dependency is involved.

The paired regression test, renderer TypeScript check, and scoped ESLint check passed. Full Electron interaction validation is owned by the coordinating audit; changing the exported component from a function to a memo wrapper required a full development reload after hot refresh.

## Remaining scope

Memoization does not reduce the initial DOM size or updates when timeline inputs really change. Opening the expanded dialog currently mounts a second complete row list. Compact rows and expanded rows have different sizes, and a selected row adds variable-height details, so fixed-height virtualization would require more behavior changes than this fix.

## Confirmed offscreen layout fix

P1: changing a timeline's axis still makes the browser lay out thousands of offscreen row descendants. This is separate from unchanged-prop React rendering: the axis changes legitimately require new row positions even after the memo fix.

The coordinating agent ran balanced native Electron trials on the 8,002-row saved fixture after the memo fix. Temporary CSS enabled `content-visibility: auto` on rows, with remembered intrinsic size estimates of 24 px in the compact list and 29 px in the expanded dialog. The compact row measured 23.796875 px with a 6 px list gap. Each of three rounds measured both axis directions in both modes, alternated mode order, and removed temporary styles between modes. The timer began before the native button click and ended after two animation frames.

| Axis change | Before median | Containment median |
| --- | ---: | ---: |
| Time → Context | 1,559.8 ms | 1,023.2 ms |
| Context → Time | 1,474.8 ms | 1,049.0 ms |

Sorted raw milliseconds: before Context `[1361.7, 1559.8, 1897.5]`; before Time `[1373.6, 1474.8, 1761.3]`; containment Context `[960.9, 1023.2, 1030.2]`; containment Time `[952.9, 1049, 1078.7]`. An earlier trial confounded the direction and mode and is excluded.

`desktop/src/styles/timeline.css` now contains those same two rules. `auto` lets the browser remember measured row heights, and rows retain automatic height for expanded details. The change keeps every row in the DOM and does not truncate, replace, or implement custom scrolling. The exact CSS baseline is `/tmp/shinbo-timeline-render-audit/timeline-before-containment.css`. Existing CSS comments were removed as required by repository policy.

The CSS parses successfully with PostCSS; focused assertions verify the two intrinsic sizes and absence of fixed row heights. The coordinating agent will verify production CSS with late-row scrolling, keyboard focus, collapse/expand, inline details, and both axes. Axis completion remains approximately one second at 8,000 tool spans: the change improves offscreen layout work but does not eliminate the full DOM or React update cost.

## Frozen production-renderer confirmation

Root repeated the balanced native test in an isolated Electron app loading a frozen production renderer from `file:///tmp/shinbo-perf-ui/desktop/dist-renderer/index.html`. This removes development React overhead and concurrent hot reload from the measurement. The saved fixture contains 8,001 spans in a 948,780-byte trace; the timeline renders 8,002 rows including its synthetic Overall row. Each baseline trial overrides `content-visibility` to `visible` and intrinsic size to `none`; each fixed trial removes that temporary override to use production CSS. Both axis directions run in each mode, and mode order alternates across three rounds. Completion is measured from click to the second animation frame, so it includes scheduling and browser work rather than measuring a pure parser.

| Axis change | Baseline samples, ms | Fixed samples, ms | Baseline median | Fixed median |
| --- | --- | --- | ---: | ---: |
| Time to Context | 677.3, 754.9, 782.8 | 462.9, 518.7, 603.2 | 754.9 ms | 518.7 ms |
| Context to Time | 344.1, 615.4, 737.9 | 228.5, 301.8, 435.8 | 615.4 ms | 301.8 ms |

These production measurements are preferred over the development measurements above. They still show a substantial roughly half-second delay for switching this extreme fixture to the context axis; all 8,002 row elements remain allocated. This is not a universal frame-time guarantee. Sorted raw samples are retained in `/tmp/shinbo-perf-round2/timeline-production-ab.json`; the fixture generator is `/tmp/shinbo-perf-round2/seed-timeline.py`. All temporary browser style overrides were cleared after measurement.
