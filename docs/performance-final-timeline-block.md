# Expanded timeline row layout

Priority: P1. The expanded timeline's outer list used a one-column grid to stack thousands of independently gridded rows. Native detail selection in an 8,002-row production-app fixture improved from 740.20 to 617.40 ms, using the median of two trial medians per variant. The remaining delay is material.

The change adds `display: block` to the existing `.trace-dialog-rows .trace-rows` rule in `desktop/src/styles/timeline.css`. Expanded rows already have zero gap. Each row keeps its own three-column grid, detail placement, intrinsic-size containment, width and border. The outer list keeps its maximum height and scrolling. The smaller timeline card remains a grid.

## Native comparison

The parent measured two interleaved grid/block pairs, 12 detail clicks per trial, in the same production app and 8,002-row saved fixture. Each sample runs from `button.click()` through two animation frames. CSSOM changed only the expanded list's display mode. DevTools and ordinary desktop applications remained active. This is a local controlled UI experiment, not field INP or a packaged-build end-to-end timing comparison.

| Trial median | Grid | Block |
| --- | ---: | ---: |
| Pair 1 | 716.20 ms | 589.10 ms |
| Pair 2 | 764.20 ms | 645.70 ms |
| Median of trial medians | 740.20 ms | 617.40 ms |

The baseline already includes prior timeline fixes. This within-trial comparison has different conditions from audit row 66; its savings must not be multiplied or combined with earlier measurements.

Both modes had a 239,997-pixel closed-detail scroll height and identical first-four-row positions, widths and heights. With a tall detail open, both had scroll height 240,186. The first five row top/height/width measurements were `258/29/731`, `287/29/731`, `316/218/731`, `534/29/731`, and `563/29/731`; the final row top/height was `240414/30` in both modes. This checks that the local detail grid and long-list geometry survive the outer display change. No CSS-text mirror test was added; native geometry and interaction checks validate the layout.

The coordinator also verified the applied CSSOM block layout in the real app: Tool 0's tall detail displayed correctly, and scrolling 300 pages reached Tool 7999 correctly at full app width after closing DevTools. Full desktop check wave 21 failed on a harness test initialization idle timeout of 254 ms while the large native timeline remained open; this was not a CSS assertion failure. The parent stopped the owned app and server cleanly and started wave 22, logged in `/tmp/shinbo-perf-round2/desktop-check-wave22.log`. That retry's final result remains the parent's validation responsibility; these native interactions do not substitute for it.

## Raw samples

All values are milliseconds, in measured order. Trial execution order was grid 1, block 1, grid 2, block 2.

```json
{
  "grid1": [842.9, 902.7, 703.1, 801.8, 647.4, 679.6, 741.1, 663.7, 814.8, 658.4, 729.3, 695.5],
  "block1": [556.4, 764.8, 566, 671, 542.8, 703.3, 567.4, 588.8, 589.4, 589.8, 596.8, 586],
  "grid2": [1074.1, 731, 785.3, 720, 754.1, 711.2, 891.4, 749.8, 787.3, 774.3, 741.2, 843.9],
  "block2": [596.9, 774.8, 578.9, 741.3, 611.2, 757, 584.7, 666.4, 698.2, 625.4, 666, 621.7]
}
```

The exact pre-edit stylesheet is `/tmp/shinbo-native-subagent-fixture/timeline-block-before.css`. Repeating the native comparison requires the saved 8,002-row fixture, expanded timeline, and matching viewport; retain all rows and toggle the same span details while alternating only the expanded list between `grid` and `block`.

Final validation: the complete wave-22 desktop check passed 1,412 tests with two skips, TypeScript, ESLint and production build after the disposable app/server were stopped. Log: `/tmp/shinbo-perf-round2/desktop-check-wave22.log`. This supersedes the pending retry checkpoint above. Native testing used the production renderer with the exact CSSOM display change; the final rebuilt bundle was not separately relaunched.
