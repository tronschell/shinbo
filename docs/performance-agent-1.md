# Renderer performance fixes

Six distinct renderer hot paths fixed. The A/B baseline is the user's dirty working tree captured in `/tmp/shinbo-perf-baseline/source.tar`, not Git HEAD. Existing changes were preserved.

The benchmark transpiles the actual source with the installed TypeScript compiler. It uses deterministic React-hook, scheduler and observer test doubles, including shallow memo comparison. Counters measure function work/observer registrations, not Electron paint latency. The overlap number is actual Node wall time (median of five runs); it does not predict every user's message. Real app interaction verification belongs to the coordinating agent and was not performed in this subtask.

| # | Priority and user impact | Fix | A/B result and fixture |
| --- | --- | --- | --- |
| 1 | P1 under concurrent streaming: every delta synchronously wakes every conversation/subagent subscriber, amplifying work across the interface. | Keep synchronous run state, coalesce notifications for 16 ms and notify only subscribers to changed thread IDs. Stable subscriptions survive parent renders. | 20,020 → 1 notification callbacks for 1,000 deltas, 20 thread subscriptions, one scheduler batch. Full 1,000-character answer preserved before notification. |
| 2 | P1 recovery freeze: reconnecting/reopening a live turn searches successively shorter suffixes. Repetitive tool/model text produces quadratic comparisons on the renderer thread. | Prefix-function overlap search runs in linear time; returns the same longest-overlap concatenation. | 422.835 → 0.280 ms median for 40,001 input characters (`20,000 a + b` restored, `20,000 a` held), five iterations. Exhaustive 4,096 small string pairs agree with the old algorithm. |
| 3 | P1 large-output freeze: fenced source/logs make one React span per syntax token, creating an unbounded subtree during streaming. | Blocks over 32,768 characters render as one plain token. All text remains visible/copyable/runnable. | 120,000 → 1 token spans for a 380,000-character JavaScript fixture. Byte-for-byte reconstructed text is unchanged. |
| 4 | P1 long-transcript streaming/scrolling: every update disconnects the resize observer and re-observes every transcript child; every scroll writes an identical state object. | Retain observers for the mounted element, observe added/removed direct children, and avoid unchanged pin-state writes. Cleanup also supports StrictMode effect replay. | 50,000 → 500 initial/repeated registrations for 500 children over 100 updates; the final fixture adds one child, so the measured fixed total is 501. Disconnects 100 → 1; unchanged scroll state writes 100 → 0. Scrolling up stays unpinned when content resizes. |
| 5 | P2: unchanged composer inventories are rebuilt on each token update and keystroke. | Memoize inventories by folders/files/artifacts/notes; memoize highlighting by draft and commands. | 80,000 → 800 actual command rows constructed for two inventories, 400 files, 100 parent renders. The test executes the actual inventory helpers. |
| 6 | P1 long-history streaming: every completed turn reruns body/thinking parsing, block grouping, tool rows and metadata while a new turn streams or the composer changes. | Memoize completed `Turn` components and completed block pairing using existing stable message/block props. Changed content still renders. | 100 → 1 completed-turn body evaluations across 100 equal-prop parent updates. A subsequent changed message increments the counter and renders normally. |

## Reproduce

```sh
mkdir -p /tmp/shinbo-renderer-baseline
tar xf /tmp/shinbo-perf-baseline/source.tar -C /tmp/shinbo-renderer-baseline desktop/src/runs.ts desktop/src/highlight.ts desktop/src/cli.tsx desktop/src/App.tsx
SHINBO_RENDERER_BASELINE=/tmp/shinbo-renderer-baseline/desktop node --test desktop/test/renderer-performance.test.mjs
node --test desktop/test/renderer-performance.test.mjs
```

An additional 400,001-character overlap run measured 34,759.381 → 1.997 ms (median of five). Reproduce that deliberately slow baseline with `SHINBO_RENDERER_OVERLAP_SIZE=200000` alongside the baseline variable. The regular regression keeps the smaller fixture to stay fast.

The baseline environment variable is optional; ordinary `npm test` discovers and runs all six regression tests against current source. Context inventory helpers are unchanged and read from current source for both A/B variants.

## Supported composer fixture correction

The initial inventory fixture supplied 10,000 files in one folder and measured 2,000,000 → 20,000 rows. That was a synthetic over-limit inventory: `FolderStore.files` returns at most `MAX_FOLDER_FILES = 400` records, independently of its 2,000 accepted-file traversal budget. It does not establish urgent performance in the actual caller. Item 5 is therefore P2, and the test now uses 400 files with no inflated note/artifact dimension. The memo fix remains correct and unchanged. The supported run preserves exactly two 400-entry inventories while reducing construction over 100 parent renders to 800 rows. One before/fixed run measured **25.279 → 0.647 ms for all 100 renders**, approximately 0.253 ms per baseline render. This is a single controlled computation timing, not a median or native frame measurement, and supports keeping P2. `/tmp/shinbo-ledger-supported-review/composer-paired.log` contains the result; the pre-correction test is preserved beside the ledger review fixture.

## Validation

- Six new runnable regressions pass, both with A/B enabled and against current code only.
- Renderer TypeScript check passed: `./desktop/node_modules/.bin/tsc -p desktop/tsconfig.renderer.json --noEmit`.
- Main/test TypeScript compilation passed without changing shared build output: `./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-renderer-tests`.
- Existing targeted tests passed, 45 total: `NODE_PATH=/Users/tronschell/Documents/shinbo/desktop/node_modules node --test /tmp/shinbo-renderer-tests/test/runs.test.js /tmp/shinbo-renderer-tests/test/highlight.test.js /tmp/shinbo-renderer-tests/test/context.test.js`.
- Owned-file lint passed: `cd desktop && ./node_modules/.bin/eslint src/runs.ts src/highlight.ts src/cli.tsx src/App.tsx test/renderer-performance.test.mjs --max-warnings 0`.

Changed files: `desktop/src/runs.ts`, `desktop/src/highlight.ts`, `desktop/src/cli.tsx`, `desktop/src/App.tsx`, `desktop/test/renderer-performance.test.mjs`, this report. No protocol changes or dependencies added. Large code blocks deliberately forgo coloring; notification batching adds at most one scheduled 16 ms interval before ordinary foreground delivery, subject to browser timer scheduling.

Unverified in this subtask: real Electron interaction/paint timing, VoiceOver, display geometry and non-macOS execution. No shortcuts, privacy permissions or signing behavior were changed.
