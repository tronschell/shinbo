# Shared line diff: round 2

## Finding and change

P1: completing an agent file edit can freeze or exhaust the Electron main process before its completion step is broadcast. `main.ts` calls `editStat` synchronously from `onToolCall`; `editStat` previously built the complete LCS matrix twice. The renderer calls the same algorithm for change counts and full diffs. Two edits at opposite ends of a file leave the entire interior in the matrix, despite changing only two lines. The 200-line hunk limit applies after all this work.

`desktop/shared/agents.ts` now finds an exact shortest line edit script with bidirectional Myers splitting, linear frontier storage, and an explicit work stack. After 64 frontier depths, dense regions switch to exact bit-parallel LCS rows and a Hirschberg midpoint. BigInt masks cache at most 64 bytes per right-side line, and position lists use linear storage. An exact set intersection shortcut handles replacements with no shared lines. `editStat` reuses one diff for its counts and hunks. No file limits, input validation, IPC, dependency, or persistence behavior changed. Both texts reconstruct exactly; ambiguous repeated-line alignments can differ while counts remain optimal. Hunk context, numbering, and the 200-line ceiling remain intact.

## Paired measurements

Actual baseline source: `/tmp/shinbo-perf-round2/tree/desktop/shared/agents.ts`. Actual changed source: `desktop/shared/agents.ts`. The checked-in test script transpiles the entire chosen source with the installed TypeScript and invokes its exported `editStat`. Each row ran baseline then changed in separate Node processes, five measured calls per process, explicit GC before each call, and the median wall time. Peak RSS is the whole process, including Node and TypeScript, so it is not an isolated heap measurement. Other audit work was active on this machine; timings are local evidence, not release performance guarantees.

| 4,000-line fixture | Before ms | After ms | Before peak RSS MiB | After peak RSS MiB | Added / removed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unique lines, only first and last changed | 287.42 | 1.42 | 479.05 | 133.42 | 2 / 2 |
| Complete replacement, no common lines | 243.98 | 3.62 | 491.30 | 135.45 | 4000 / 4000 |
| Alternating repeated lines shifted by one | 158.37 | 0.94 | 481.53 | 133.66 | 1 / 1 |
| Unchanged | 1.21 | 0.84 | 133.23 | 133.14 | 0 / 0 |
| Dense rearrangement of a 31-line alphabet | 248.89 | 23.56 | 514.75 | 145.42 | 2580 / 2580 |
| Reversed unique lines | 275.89 | 14.81 | 514.42 | 160.98 | 3999 / 3999 |

The sparse file is only 38,889 bytes before and 38,899 after. This is an ordinary supported file edit, not a multi-gigabyte input. Counts and hunk lengths matched baseline for all benchmark fixtures.

Exact reproduction from the repository root:

```sh
for fixture in sparse replacement repeated unchanged dense reversed; do
  for source in /tmp/shinbo-perf-round2/tree/desktop/shared/agents.ts desktop/shared/agents.ts; do
    DIFF_BENCH_SOURCE="$source" DIFF_BENCH_FIXTURE="$fixture" node --expose-gc desktop/test/diff-performance.test.mjs
  done
done
```

For a 30,000-line changed span, the old matrix requires 900,060,001 number slots, approximately 6.71 GiB of number storage before row/object overhead, per diff invocation. The largest new pair of frontier arrays requires 480,024 bytes. The dense fallback bounds cached mask payloads to 1,920,000 bytes at this size. Pending ranges, source lines, output lines, the intersection set, and position lists add linear storage. This is live algorithmic workspace, not a bound on process RSS or cumulative garbage allocations. The regression check intercepts both typed-array and numeric Array allocations, rejects a quadratic matrix before allocating it, and verifies 30,000-line fixtures including reversal. It also intercepts mask maps and rejects quadratic cached BigInt storage. The full baseline was deliberately not run at that size.

## Correctness and checks

```sh
node --test --test-timeout=60000 desktop/test/diff-performance.test.mjs
npm --prefix desktop run build:main
node --test desktop/dist-main/test/agent.test.js
npm --prefix desktop run typecheck
(cd desktop && npx eslint shared/agents.ts test/diff-performance.test.mjs --max-warnings 0)
```

Passed: two new regression tests, all 27 existing agent tests, main compilation, renderer typecheck, and focused lint. The exactness test covers all 3,969 pairs of binary-alphabet sequences up to five lines, Unicode, trailing/newline-only text, insertion/deletion, 2,000 seeded random pairs up to 79 lines, 120 larger random pairs up to 399 lines, and reverse/dense fixtures up to 511 lines that force the dense fallback. An independent LCS oracle checks optimal retained-line counts, and every result reconstructs both originals. The large-fixture test checks stats, bounded allocation, hunk limits, and `editStat` equivalence with the separate stats/hunk APIs.

## Dense-case validation and remaining limits

A Myers-only intermediate implementation still took 1,531.06 ms for a 12,000-line reversed unique file (120,889 bytes). That finding prompted the exact dense fallback; the final source takes 62.34 ms on the same fixture. Final 12,000-line dense rearrangements take 80.84 ms with a 31-line alphabet and 73.28 ms with a 257-line alphabet. Counts remain exact: reversed 11,999/11,999; dense 7,742/7,742; dense-wide 11,206/11,206. The final 12,000-line reversal peak process RSS is 238.77 MiB; BigInt temporaries and GC still matter even with bounded live caches.

```sh
for fixture in reversed dense dense-wide; do
  DIFF_BENCH_SOURCE=desktop/shared/agents.ts DIFF_BENCH_FIXTURE="$fixture" DIFF_BENCH_LINES=12000 node --expose-gc desktop/test/diff-performance.test.mjs
done
```

At 30,000 lines, observed final dense-wide median latency is 376.40 ms and peak RSS 284.44 MiB. A preceding run with the same algorithm but a smaller mask-cache allowance measured 298.15 ms for dense31 and 190.76 ms for reversed unique lines. The cache allowance was raised from 8 to 64 bytes per line after measuring repeated mask construction slowing the 257-symbol case; it remains linear in input length.

```sh
DIFF_BENCH_SOURCE=desktop/shared/agents.ts DIFF_BENCH_FIXTURE=dense-wide DIFF_BENCH_LINES=30000 node --expose-gc desktop/test/diff-performance.test.mjs
```

There is no fixed execution-time guarantee for arbitrary input. Dense reconstruction still performs exact LCS work, accelerated inside native BigInt operations; a sufficiently large or difficult file can still stall synchronous callers. This fixes the quadratic numeric matrix allocation and the measured multi-second 12,000-line reordering, while larger dense files remain a limitation. UI rendering of very large full diffs is outside this subtask. No async tool-step ordering was introduced.

Real-app interaction validation is assigned to the coordinator and has not been performed by this subagent. This subtask does not exercise shortcuts, privacy permissions, VoiceOver, display geometry, signing, or non-macOS execution.
