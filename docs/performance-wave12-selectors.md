# Timeline interaction and relational selectors — 2026-09-12

## One shared style-invalidation finding

Root native profiling of the existing 8,002-row timeline fixture found roughly 440 ms of style recalculation and 348 ms of layout across a two-click recording. Controlled stylesheet isolation identified the expensive header-spacing, project-count hover/focus, and unchecked-skill label rules. Removing only the modal or agent-tabs rules did not help. The context-widget/footer adjacency rules were individually benign and remain unchanged.

The fix replaces only those profiled selector groups with sibling relationships already guaranteed by the rendered markup. It is one shared style-invalidation issue, not a finding per CSS rule. No React state, DOM structure, renderer data, timeline row geometry, or content changed.

| Affected behavior | Replacement structure | Preserved cases |
|---|---|---|
| Collapsed sidebar spacing for the first content header | Actual direct `.sidebar.collapsed` preceding sibling of `.content` | Expanded sidebar, absent/custom navbar, and Region error fallback |
| Project count hidden while its new-thread button is shown | Count is a following sibling of the direct `.project-new` button in hovered/focused summary | Pinned and scheduled groups lack the button and retain counts |
| Unchecked skill/server name and count muted | Name/container and count follow the actual unchecked input | Checked state, busy/disabled checkbox, name and count colors |

All replacement arms preserve original specificity. The skill-name arm uses `:where(div)` so the structural qualifier adds no specificity. The sidebar replacement depends on actual emitted sidebar markup rather than `layout.sidebarCollapsed` alone; this preserves the custom `Region name="navbar"` case when it omits the built-in sidebar. Region renders its component or fallback as a fragment before `main.content`.

Only `desktop/src/styles/sidebar.css` and `desktop/src/styles/plugins.css` changed. Other `:has` rules remain, including sidebar grid state, agent tabs, modal state, color-menu stacking, and context-footer adjacency.

## Native paired evidence supplied by root

Root owns the real Electron instance, CUA interactions, stylesheet instrumentation, and final clean production-bundle repeat. Three alternating baseline/candidate pairs each measured 20 timeline detail clicks, with unchanged row geometry. Root reported upper-middle medians:

| Pair | Baseline | Equivalent selectors |
|---|---:|---:|
| 1 | 538.5 ms | 256.3 ms |
| 2 | 568.7 ms | 257.7 ms |
| 3 | 531.9 ms | 231.9 ms |

These were click-to-second-animation-frame measurements in the real app. Concurrent host benchmark activity was present. The direction held in all three pairs, with approximately 52–56% lower latency. The candidate preserved declarations and geometry; blanket removal of all relational selectors was diagnostic only and was not committed.

After the other agent benchmarks stopped, a second balanced set of three pairs retained the same 8,002 rows and included two harmless component fixtures. Normal desktop applications remained active. The conventional medians (mean of the two middle samples) were:

| Pair | Baseline | Equivalent selectors |
|---|---:|---:|
| 1 | 686.25 ms | 431.65 ms |
| 2 | 676.70 ms | 418.50 ms |
| 3 | 660.35 ms | 433.70 ms |

The median of the three trial medians fell **676.70 → 431.65 ms (36.2%)**. Every trial retained a 240,043.640625-pixel list height and identical first-four-row positions. [All 120 samples and measurement details](performance-timeline-css-samples.json) are retained. The desktop remained under load from ordinary applications, and this later set is slower in both conditions than the isolation run; neither set is a universal latency forecast. This is a scripted detail-toggle-to-second-animation-frame measurement in production Electron, not a field INP metric. The approximately 432 ms residual delay at this extreme size remains material; this CSS change does not make the timeline fully smooth.

Root's single-rule isolation also found that the content-header arm alone raised the approximately 220 ms isolated baseline to about 464 ms, project hover/focus arms to approximately 346/341 ms, and the unchecked-skill group to approximately 347 ms. The individually benign context adjacency rule stayed around 220 ms. These isolation timings describe this fixture and Chromium build, not a general claim that all `:has` selectors are slow.

## Source and checks

Pre-edit copies are `/tmp/shinbo-perf-wave12-selectors/sidebar.baseline.css` and `plugins.baseline.css`. Both CSS files compiled successfully with the already-installed Lightning CSS engine. No source-matching regression test is retained for this reversible CSS change. Meaningful validation is the production stylesheet build plus native old/new selector matching and interaction checks for pinned/scheduled groups, the custom Region boundary, hover/focus, checkboxes, and collapsed navigation. Root owns those real-app checks.

```sh
diff -u /tmp/shinbo-perf-wave12-selectors/sidebar.baseline.css desktop/src/styles/sidebar.css
diff -u /tmp/shinbo-perf-wave12-selectors/plugins.baseline.css desktop/src/styles/plugins.css
```

The production stylesheet build and native supported-state verification remain pending with root, alongside final profiling artifacts. No dependency or production JavaScript was added.

## Checked-bundle interaction verification

The coordinator exercised the compiled wave-sixteen selectors in the real isolated app. Turning the disposable skill checkbox off dimmed its name and count to rgba(232, 230, 223, 0.55); turning it on restored the name to rgb(232, 230, 223) and count alpha 0.68. The old and new selector matches agreed in both states. Collapsing navigation preserved the header's 117 px window-control allowance. The project summary displayed its new-thread button on hover, kept the count hidden while that button retained keyboard focus after the pointer moved away, and restored the count when focus moved to Skills. Navigation and the checkbox were restored afterward. Native VoiceOver, alternate display geometry, and every custom-region/pinned/scheduled combination were not exercised.
