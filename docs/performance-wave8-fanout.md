# Cross-window live trace fanout — 2026-09-12

## Implemented finding: P1 unused windows receive complete live histories

`AgentRuntime.noteDelta` already throttles its shared changed callback to 250 ms during streaming. That callback nevertheless builds the complete live span tree and sends `shinbo:spans` through the generic broadcaster. The broadcaster sent the tree separately to every Electron window, including Quick Ask, run banner, cursor, hotspot, annotation, and radial windows that have no live-span subscriber.

The only `onSpans` subscriber is `Timeline`, reached through the main workspace's context widgets. `runs.ts` requests the initial span map explicitly but does not subscribe to span broadcasts. The initial `shinbo:list-spans` handler already requires `mainWindowSender`. Preload validates the event shape and invokes its listener; it does not avoid the earlier native IPC transfer when a destination has no listener.

The fix routes only `shinbo:spans` to the existing live main window after the unchanged mobile bridge path. It preserves the entire payload and every other broadcast channel. It does not filter active threads, modify the mobile protocol, add subscription infrastructure, throttle more aggressively, or change timeline behavior.

This is independent of prior terminal batching, cached trace decoding, renderer memo boundaries, changed-event coalescing, and historical span indexing. Those fixes did not remove whole-tree IPC sends to windows without consumers.

## Measured A/B

The fixture uses the actual `AgentRuntime` to create eight live runs, the supported simultaneous-thread ceiling. Each has 128 completed tool spans with roughly 16 KiB output, within the normal tool-output allowance, plus its active model span. Their live tree serializes to 16,939,901 bytes. It executes the actual `broadcast` function extracted from baseline or current main.ts against four destination adapters representing workspace, Quick Ask, run banner, and cursor. These windows can coexist; the latter three do not consume live-span events.

Each destination adapter runs Node's V8 serializer to model the unavoidable payload serialization at an IPC boundary. This is an operation-count and serialization-cost experiment, not a native Electron frame-time or IPC-wire-size measurement. The 20 updates are accelerated rather than waiting five seconds at the existing four-per-second cadence.

| Observation per 20 updates | Baseline | Fixed |
|---|---:|---:|
| Send invocations | 80 | 20 |
| V8-serialized payload bytes across destinations | 1,355,192,080 | 338,798,020 |
| Median serialization-loop time, five runs | 304.434 ms | 60.372 ms |
| Workspace receives complete live tree | Yes | Yes |
| Auxiliary windows receive unused live tree | 60 times | 0 times |

The exact work reduction is 75% fewer sends and serialized payload bytes in this four-window fixture: just over 1 GB of redundant serialization across 20 updates. At the existing four-per-second cadence, the removed copies correspond to about 203 MB/s of V8-serialized payload for this supported long-run workload. This is not a claim of typical user traffic or measured resident-memory reduction. The P1 impact is sustained unnecessary main-process/IPC work while long parallel runs and auxiliary windows are active; one main window alone receives the same work as before.

## Validation and commands

Exact baseline: `/tmp/shinbo-perf-wave8-fanout/main.baseline.ts`.

The fixture is `/tmp/shinbo-perf-wave8-fanout/probe.cjs`; it imports the actual runtime compiled into the preceding wave's isolated directory and extracts `broadcast` from the requested source. Source setup is outside its timed serialization loop.

```sh
node /tmp/shinbo-perf-wave8-fanout/probe.cjs > /tmp/shinbo-perf-wave8-fanout/baseline.log
node /tmp/shinbo-perf-wave8-fanout/probe.cjs /Users/tronschell/Documents/shinbo/desktop/main/main.ts > /tmp/shinbo-perf-wave8-fanout/fixed.log
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave8-fanout/compiled
node --test /tmp/shinbo-perf-wave8-fanout/compiled/test/window-fanout.test.js
SHINBO_BROADCAST_SOURCE=/tmp/shinbo-perf-wave8-fanout/main.baseline.ts node --test /tmp/shinbo-perf-wave8-fanout/compiled/test/window-fanout.test.js > /tmp/shinbo-perf-wave8-fanout/baseline-regression.log 2>&1
cd desktop
./node_modules/.bin/eslint main/main.ts test/window-fanout.test.ts --max-warnings 0
```

The isolated compiled directory has a node_modules link to desktop dependencies and a sibling main link to current desktop/main for the source-reading regression. Main compilation, the focused regression, and lint passed. The frozen baseline intentionally fails the regression because auxiliary windows receive all 20 histories.

The regression verifies exact payload identity and complete content at the workspace, unchanged mobile conversion/delivery, no mobile conversion when disconnected, unchanged delivery of delta/step/agents/changed/computer-progress channels to all live windows, a destroyed or absent main window, and delivery to a newly created replacement workspace. No auxiliary window receives the filtered channel.

## Coverage and limits

The runtime's live-span getter already excludes traced runs; completed durable trace caches are not changed or recounted. Active histories still reach the main workspace in full, and multiple consumers within that workspace may still perform their own work. Mobile event conversion remains before the narrow desktop routing branch. No preload, renderer, timeline, or mobile schema change was needed.

The parent audit owns native app verification of the main timeline and auxiliary-window behavior. The focused fixture did not create or drive user UI. Its timing isolates V8 serialization and omits native IPC transport, receiving-process allocation, and rendering costs. Windows-specific IPC performance was not measured.
