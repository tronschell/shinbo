# Final renderer sweep: subagent relationship lookups

## P1 finding

The context bar's `SubagentRail` finds roots with `list.filter(...list.some(...))` and finds each branch's children by scanning the entire global agent array. These lookups run while the native Finished details element is closed. Thousands of historical subagents therefore make unrelated parent renders perform millions of comparisons before React or browser layout work begins.

The actual caller is `App.tsx` → `ContextWidgets` → `WidgetContent` → `SubagentRail`. `subagentRows` in `src/threads.ts` combines saved child-thread summaries with current agent records. The eight-live-subagent limit does not cap saved children. The global `all` prop is also not restricted to eight records: `AgentRuntime.list()` returns the complete `runs` map, and `forget(threadId)` removes completed records only for that particular root and its direct children when another turn starts. Completed records from unrelated threads remain until their own lifecycle clears them or the app restarts. Both empty-after-restart and large-retained-array states are reachable.

The change in `desktop/src/context-bar.tsx` indexes identifiers with a Set and children with a Map once per render. Status grouping, input order, recursive rendering, missing/self-parent behavior, selection callbacks, and native collapsed Finished behavior remain unchanged. This is one fix for repeated relationship scans, not two separately counted issues.

## Measurements

Baseline source was copied before the edit to `/tmp/shinbo-final-context-bar-before.tsx`. The checked-in test extracts and transpiles the actual `SubagentRail` declaration from baseline and current source. JSX creation and imported presentation helpers are stubbed consistently; component logic and complete returned element structure are real. These timings measure component construction, not browser paint or full React reconciliation.

The fixture has 4,096 completed direct children and either an empty `all` array (restored saved history) or 4,096 retained records. The historical count is a supported stress case, for example eight children across 512 historical turns; it is not a claim that typical users have this many children. A long session can also retain a large global agent array independently of historical child count.

After the coordinator's host benchmark ended, each state ran three balanced before/after pairs of 20 stable-prop parent renders, reversing order for the middle pair. The earlier overlapping timing was discarded. Returned JSX was serialized and compared exactly in both states, including closed Finished details.

| State | Before median, 20 renders | After median, 20 renders | Before identifier reads/render | After identifier reads/render |
| --- | ---: | ---: | ---: | ---: |
| Restored history; empty global agent list | 500.27 ms | 23.82 ms | 16,785,408 | 16,384 |
| Retained global agent list | 2,563.06 ms | 22.56 ms | 33,562,624 | 16,384 |

Counts come from instrumented getters in the actual component. Indexing uses linear temporary memory; every existing list item still renders. There is no claim that large DOM trees become free or that arbitrary cyclic live data becomes supported.

```sh
SUBAGENT_BASELINE=/tmp/shinbo-final-context-bar-before.tsx node --test desktop/test/subagent-roots-performance.test.mjs
```

## Checks and final-sweep exclusions

```sh
node --test desktop/test/subagent-roots-performance.test.mjs
(cd desktop && npx eslint src/context-bar.tsx test/subagent-roots-performance.test.mjs --max-warnings 0)
npm --prefix desktop run typecheck
```

Two focused tests passed. Cases cover missing and self parents, empty identifiers, live/waiting/done grouping, input ordering, a 100-level chain, closed Finished details, and linear lookup counts in both large-array states. Focused lint passed. Renderer typecheck passed after the root Set change; the coordinator's final full check covers the subsequent child Map addition.

Other inspected paths did not justify a high-priority change: bench data is capped at 24 runs × 12 cases; machine charts retain 60 samples and already stop polling while hidden; context-rate buckets grow by powers of two rather than by conversation length. The actual composer highlighter took approximately 1.73 ms per plain-text keystroke with 16,000 available files, and history preparation took 2.35 ms across 100 renders of 1,024 messages. Those measurements did not justify expanding this final urgent-work scope, so those paths were left alone.

Native interaction validation belongs to the coordinator. This subtask did not operate the real app, test VoiceOver or alternate display geometries, or run native non-macOS checks.

## Production-app verification

The coordinator seeded durable records through the real host into the disposable profile. The small parent showed “4 finished”; expanding it displayed Alpha, Beta, Gamma and Delta in the existing stored ordering. Selecting Alpha opened its saved response, “Verified Alpha child navigation.” The large parent showed “4096 finished”; expanding the context-bar list produced exactly 4,096 real child buttons, including labels 0001 and 4096. The native accessibility snapshot explicitly capped its representation at 500 items, so the full count was checked in the actual renderer DOM through DevTools. Activating the real 4096 button opened “Subagent: Native historical child 4096.” This is a functional native-app check, not a measured full-app latency comparison. Restored grandchildren are not automatically included in the runtime `all` list, so nested runtime branches remain covered by focused tests rather than this saved-only native fixture.
