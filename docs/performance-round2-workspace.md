# Round two: workspace output limits

Two new P1 issues are fixed. Neither repeats the previous Git metadata/coalescing fixes, terminal shutdown fix, or folder traversal work.

## Git patch collection retained far more than the visible limit

Opening the changes view, generating a commit message, or requesting a full desktop/mobile Git snapshot routes through `gitSnapshot` and `readGitDiff`. The visible patch is limited to 512 KiB, but collection previously started up to 20 untracked-file diffs concurrently with a 16 MiB output buffer each. Their strings remained alive in `Promise.all` before being joined and then truncated. Large generated text files could therefore produce hundreds of megabytes of temporary application strings and a large simultaneous Git process workload merely to display the first 512 KiB. This is P1 memory and responsiveness pressure on a supported workspace workload.

Patch subprocesses now collect at most 512 KiB plus one byte. Untracked patches run in groups of four, and no later group starts once the visible patch is full. Output-limit termination retains the available prefix and reports `truncated`; it does not retry the same oversized tracked patch as if Git had failed. Ordinary small patches retain their exact bytes and file order. Real Git errors still use the existing tracked-diff fallback.

Measured with 20 untracked files, each containing 200,000 copies of `generated output line\n`, plus a clean tracked file:

| Measurement | Baseline | Fixed |
| --- | ---: | ---: |
| Median full snapshot duration, three samples | 407.404 ms | 115.363 ms |
| Patch bytes returned to Node callbacks | 92,003,020 | 2,097,156 |
| Patch subprocesses launched | 21 | 5 |
| Peak simultaneously pending patch subprocesses | 20 | 4 |
| Displayed patch bytes | 524,274 | 524,274 |

The displayed patch was asserted byte-for-byte identical across variants. The old untracked callback collection allowed `20 × 16 MiB = 320 MiB`, before the tracked patch and joined string. The new pending untracked batch allows `4 × (512 KiB + 1) = 2,097,156` bytes. The accumulated visible prefix and temporary concatenation add a few bounded strings; this is not a measurement of total process RSS or Git's internal file/diff memory. Limiting concurrency also limits the number of simultaneous native Git readers. On many tiny changed files, groups of four may finish later than twenty simultaneous children; the bounded resource use is intentional.

## Terminal output flooded the shared IPC channel

`Terminals.take` previously called `onData` for every stdout/stderr chunk. Its main-process caller immediately broadcasts that payload over `shinbo:terminal-data` to renderer windows. Every terminal surface receives that channel and filters by terminal id. Busy CLI output or several terminals could therefore create thousands of IPC messages and renderer callbacks from small chunks. This is a separate P1 event-queue issue; scrollback storage already had its prior fix.

Terminal bytes now accumulate for at most one scheduled 16 ms interval or 64 KiB, whichever triggers a flush first. The flush keeps absolute byte offsets. Replay reads flush pending data at the snapshot boundary so a later batch cannot replay old bytes. Exit, stdout/stderr closure, explicit close, and stop-all flush pending data and clear their timers. Output emitted during a flush forms the next batch. Data arriving after the tab has been explicitly removed is discarded.

A deterministic fixture sends 1,000 separate 64-byte stdout chunks to each of eight terminals:

| Measurement | Baseline | Fixed |
| --- | ---: | ---: |
| Incoming chunks | 8,000 | 8,000 |
| Main-process broadcast callbacks | 8,000 | 8 |
| Output bytes delivered | 512,000 | 512,000 |
| Final offset per terminal | 64,000 | 64,000 |

Every terminal's output is checked byte-for-byte. These are actual `Terminals` callback counts with controlled child streams, not claimed measurements of OS pipe chunking, Electron frame time, or native PTY throughput. The main-process callback has one broadcast call per measured callback. The 16 ms scheduling interval is a latency tradeoff; event-loop load can delay a timer beyond its requested interval.

## Reproduction and validation

Baseline: the current dirty checkout frozen at the beginning of round two in `/tmp/shinbo-perf-round2/source.tar`, extracted under `/tmp/shinbo-perf-round2/tree`.

Run the paired source benchmark from the repository root:

```sh
node desktop/scripts/workspace-output-perf.mjs /tmp/shinbo-perf-round2/tree .
```

Raw results: `/tmp/shinbo-perf-round2/workspace-output-results.json`. The benchmark loads both actual TypeScript implementations, runs real Git over temporary files, measures three samples for each Git variant, verifies equivalent visible output, and exercises deterministic terminal byte streams. Temporary repository files are deleted afterward.

Focused validation commands:

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-agent4/desktop/dist-main
node --test /tmp/shinbo-agent4/desktop/dist-main/test/workspace-output.test.js /tmp/shinbo-agent4/desktop/dist-main/test/terminal.test.js /tmp/shinbo-agent4/desktop/dist-main/test/git.test.js
cd desktop
./node_modules/.bin/eslint main/git.ts main/terminal.ts test/workspace-output.test.ts scripts/workspace-output-perf.mjs scripts/workspace-perf.mjs
```

Compilation and focused lint passed. All 40 focused tests passed; the two new regressions were rerun successfully after adding oversized Unicode/single-line and post-exit stdout-drain cases. Tests check byte limits, stopping later patch scheduling, ordinary patch equivalence, truncation flags, UTF-8-safe tails, the 16 ms/64 KiB batch triggers, replay boundaries, reentrant output, exit/close/stop flushing, and cancellation of every scheduled output timer.

The existing first-round benchmark's concurrent-reader assertion now accepts fewer than 27 subprocesses because this fix stops creating patches after the display limit. It still rejects additional duplicate work. Its historical measurements remain historical.

The coordinator owns the final integrated checks and real-app verification. This agent did not exercise native Windows PTYs, signed packaging, VoiceOver, display geometry, privacy permissions, or global shortcuts. No dependency, wire-format, or permission changes were added.
