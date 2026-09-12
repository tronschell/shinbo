# Multi-agent turn grouping

P1 under the supported large-trace workload: the Agent activity loader calls `readTurns` for saved traces. The helper builds an owner map, then filters the entire span array separately for every agent. A trace containing 4,096 agent spans therefore performs 16,777,216 owner lookups before producing its statistics.

`AgentRuntime.flushTrace` deliberately stores subtree agent spans in a parent's trace. The measured trace is generated with the actual `encodeSpans`, contains 4,096 root/child agent spans, and occupies 593,589 bytes, below the one-MiB stored-trace limit and eight-MiB per-thread reply limit. This is a large stress case, not a typical turn-size claim.

`desktop/shared/improvement.ts` now builds groups once from the existing owner map, in original span order, and reads each group's array directly. It still computes owners using the same traversal and duplicate-ID map behavior. It still uses `encodeSpans` and `readTurn` for normalization, stored-text truncation and trace-size clamping. Dates, model attribution, the first-agent header, child context, repeated agent IDs, and `distinctTurns` ordering are unchanged. Only redundant group scans were removed.

| Actual-source workload | Before | After |
| --- | ---: | ---: |
| 4,096-agent trace, median of three balanced pairs | 400.618 ms | 22.090 ms |
| Owner-map lookups | 16,777,216 | 4,096 |
| Returned agent turns | 4,096 | 4,096 |
| Encoded input bytes | 593,589 | 593,589 |

The benchmark loads and transpiles the actual shared modules and their dependencies. The baseline is `/tmp/shinbo-native-subagent-fixture/improvement-before.ts`. Complete returned Turn arrays compare equal, not merely counts. A custom Map counts actual string-valued owner lookups separately from timings. Group arrays add linear temporary memory. Owner ancestry traversal, JSON normalization, host transfer, and renderer paint remain separate costs.

```sh
TURN_GROUP_BASELINE=/tmp/shinbo-native-subagent-fixture/improvement-before.ts node --test desktop/test/turn-groups-performance.test.mjs
node --test desktop/test/turn-groups-performance.test.mjs
(cd desktop && npx eslint shared/improvement.ts test/turn-groups-performance.test.mjs --max-warnings 0)
```

Two focused tests and lint passed. Coverage includes nearest-agent ownership, orphan and cyclic parent links, duplicate span and agent identifiers, original group order, child model/token/failure attribution, legacy traces with no agent span, 16-KiB output truncation, invalid and pre-epoch dates, retained duplicate ordering across the 90-day boundary, and linear owner lookups for a 1,024-agent trace. The optional baseline run verifies complete output equality on all these shapes and the 4,096-agent fixture. Coordinator owns integrated TypeScript/tests and native UI verification.

The original expired-trace early-filter idea was not applied. Filtering before `distinctTurns` would change Map insertion order when an expired trace first introduces an identity later updated by a retained trace. AgentView remains unchanged, so loading very old histories can still perform avoidable work; preserving exact ordering takes precedence over silently changing that behavior. This report counts only the independently measured span-group lookup fix.

## Production Electron verification

The real host stored and read back one 593,635-byte native fixture trace with exactly 4,096 successful agent runs. After opening Self improvement in the checked app, its LOCAL/FIXTURE model selector reported “0 of 4096 ended badly”; Every model showed 4,103 runs including seven other existing fixtures. Trace grouping and existing runs were preserved through the actual storage, IPC, parser and view path. The grouping fixture has synthetic child span identifiers without separate durable child threads, so their Open thread links were not used.
