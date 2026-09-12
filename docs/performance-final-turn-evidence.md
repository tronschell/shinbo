# Closed run evidence construction

Priority: P1, confirmed in the native app. With Run evidence closed, changing model filters in the supported combined fixture improved from 425.55 to 16.65 ms. The Self improvement screen eagerly constructed every saved run's nested evidence while its outer Run evidence disclosure was closed. A single supported 593,589-byte trace containing 4,096 agent spans constructed 32,771 React elements in this section on every parent render, before anyone expanded it.

`AgentView` receives its parsed and windowed turns from `useTurns`. The evidence block is inside the Self improvement tab, but its native `<details>` being closed only hides the DOM; it does not prevent the `windowed` sort/map or nested context/span JSX. Other timeline and Markdown optimizations do not cover this block.

`desktop/src/AgentView.tsx` now latches the first opening of Run evidence and defers its run children until then. Its summary and explanatory text remain present. Closing after opening leaves the children mounted, preserving nested disclosure state when reopened. Filtering, sorting, stable keys, navigation, and all evidence text remain unchanged. No truncation or pagination was introduced.

## Actual-source comparison

Baseline: `/tmp/shinbo-native-subagent-fixture/AgentView-evidence-before.tsx`, which already contains the hidden-tab trace-loading fix.

```sh
NODE_ENV=production TURN_EVIDENCE_BASELINE=/tmp/shinbo-native-subagent-fixture/AgentView-evidence-before.tsx node --test desktop/test/turn-evidence-performance.test.mjs
```

The test finds the real evidence JSX and state declaration using the TypeScript AST, transpiles them, and runs the actual production React JSX constructors. Its 4,096 turns come from production `encodeSpans` and `readTurns`, using the same supported sub-MiB trace as the trace-grouping benchmark. Three trials alternate before/after order and each performs 20 parent renders. Other agent benchmarks and the root full check were stopped during timing.

| Closed evidence work | Before | After |
| --- | ---: | ---: |
| React elements constructed per render | 32,771 | 3 |
| Element construction, median per 20 renders | 127.142 ms | 0.013625 ms |

These timings cover this actual JSX expression and production formatting, not React reconciliation, DOM creation, layout, or the rest of AgentView. The elements include component references; the test does not claim that they are an exact DOM-node count. A preliminary run with the default development React runtime measured 689.855 → 0.057791 ms; the production result above is the reported comparison.

The focused checks assert the closed section contains no run entries, an initial close event does not open it, first opening produces the exact serialized baseline React tree, tied timestamps and keys retain order, navigation targets are unchanged, context and tool text survive, closing leaves the children present, and later filters update the evidence. Three tests and focused ESLint passed. Native first opening and nested disclosure close/reopen behavior remain the parent agent's validation responsibility.

## Limits

The first expansion still constructs the complete evidence tree, and subsequent renders retain its previous cost. This intentionally preserves nested state after closing. Switching tabs follows the existing component lifecycle. Browser search cannot find unmounted run evidence before its first expansion. The closed summary retains the exact run count and its native keyboard disclosure control.

## Native comparison fixture

The parent's native check uses the disposable profile `/tmp/shinbo-dev-data-5176`, whose production `readTurns`, `distinctTurns`, and 90-day filtering produce 4,103 turns: 4,096 `local/fixture` turns, six `fixture/stop` turns, and one turn with unknown model. The profile has eight trace-bearing histories, each with one retained trace, below the 64-trace cap. Every trace is below 1 MiB and every history is below the 8 MiB trace reply budget.

The two substantial histories are `Native trace grouping — 4096 agent runs` (`1789205183-11a6-18d488a267c66bd0-0`), with 4,096 agent spans in 593,635 bytes, and `Performance: 8000-span timeline` (`1789195875-6503-18d4802b5abc04b0-0`), with 8,001 spans in 948,780 bytes producing one unknown-model turn. The six remaining trace histories are 10,381–11,912 bytes each. The native model-filter comparison therefore includes both the large agent-group history and the existing tool-heavy timeline history; it is intentionally a different workload from the isolated 4,096-turn React-construction benchmark above.

Read-only fixture verification:

```sh
node /tmp/shinbo-native-subagent-fixture/verify-evidence.cjs
```

The exact inventory is saved in `/tmp/shinbo-native-subagent-fixture/native-evidence-inventory.json`.

## Native performance result

The parent measured three trials of 20 alternating Every model / local/fixture filter changes per version, with Run evidence closed. Each sample measures `button.click()` through two animation frames. The three before trials ran first, followed by the three after trials, using the same combined 4,103-turn fixture and DevTools viewport. No other agent benchmark or full check ran during these measurements; ordinary desktop applications remained active.

| Native measure | Before | After |
| --- | ---: | ---: |
| Trial medians | 425.55 / 512.45 / 415.55 ms | 16.65 / 16.65 / 16.70 ms |
| Median of trial medians | 425.55 ms | 16.65 ms |
| Closed evidence descendant elements, ending on local/fixture | 36,866 | 2 |
| Closed evidence run details, ending on local/fixture | 4,096 | 0 |

Both versions ended with the disclosure closed and its summary reporting 4,096 runs. The reduction removes hidden evidence DOM while retaining the visible count. These are grouped before/after native response measurements, not interleaved trials or field INP. The parent retains all 120 raw samples and owns the separate first-opening and nested disclosure state checks.

## Native disclosure behavior

The coordinator used the real keyboard disclosure control to open Run evidence and scrolled to the mounted run rows. The renderer then reported exactly 4,096 direct run disclosures. A real root-run disclosure and its nested Calls and outcomes disclosure were opened; the outer summary was closed and reopened with animation frames between actions. While closed, both nested disclosures remained open and their nodes stayed connected. On reopening, the same run DOM node remained, both nested open states were preserved, and all 4,096 run rows remained. Native VoiceOver and alternate display geometry were not exercised.
