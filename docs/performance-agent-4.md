# Workspace performance fixes, 2026-09-12

Eight distinct bottlenecks were fixed. Three merit P1 because they repeatedly occupy the application process or amplify repository refreshes across open surfaces; five are P2. The counts below do not turn the P2 fixes into P1 claims.

| Priority | Trigger and root cause | Change | Baseline → fixed |
| --- | --- | --- | --- |
| P1 | Sidebar badges, dashboard cards, and mobile metadata requests generated complete patches before discarding them. | Pass the existing request's need for a diff through to the Git reader; metadata requests never launch patch commands. | 337.259 → 93.292 ms; 27 → 5 Git processes; 524,280 → 0 patch bytes. |
| P1 | Concurrent consumers each launched an entire Git scan for the same folder. | Share only the pending scan, keyed by folder and diff mode; discard it immediately on settlement. | Eight readers: 1,762.276 → 220.916 ms; 216 → 27 Git processes. |
| P1 | Folder picker and mention discovery synchronously walked and statted directories on Electron's main thread. | Read directories asynchronously and inspect at most 32 files concurrently, consuming results in original directory order. | Main event-loop timer delay: 171.390 → 0.446 ms on 24,000 oversized files. |
| P2 | A full Git snapshot awaited unrelated metadata and patch subprocesses one by one. | Run independent reads concurrently after validating the repository status. | 389.454 → 270.117 ms for one full snapshot; identical 27 processes and patch size. |
| P2 | Folder traversal's old cap counted only acceptable text files, so directories, binary files, and oversized text files could bypass it indefinitely. | Keep the 2,000 accepted-file cap and also stop after 16,000 inspected entries. Mark partial listings as capped. | Oversized-file metadata reads: 24,000 → 15,946; uncapped → capped. |
| P2 | Resolving each additional `@mention` rescanned the same folder and note collection. | Reuse these listings within one prompt, loading them only when needed; the next prompt starts fresh. | Eight mentions in a 1,000-file folder: 70.482 → 14.937 ms; folder scans 8 → 1 and note-list calls 8 → 1; identical attached context. |
| P2 | Terminal shutdown slept for the full two-second kill grace period after its child had already exited. | Resolve on the child's exit and remove the grace-period listener and timer. Retain forced termination for children that remain alive. | Real child shutdown: 2,003.000 → 1.422 ms. |
| P2 | Typing in the Git file filter reparsed the entire patch on each keystroke. | Memoize patch parsing independently of filename filtering. | Seven edits across a 50,000-line patch: 25.529 → 7.287 ms; parses 7 → 1. |

The folder responsiveness fix has a measured tradeoff: total listing time on the oversized-file fixture increased from 171.444 to 191.066 ms, while the application event loop remained available. The separate traversal budget can omit later entries; the response explicitly sets `capped`. Directory reads still materialize one directory's entries, matching the old ordering and avoiding a regression in which files appeared inside the existing 400-file display limit.

## Reproduction and verification

Run from the repository root:

```sh
node desktop/scripts/workspace-perf.mjs /tmp/shinbo-perf-baseline/tree .
```

The script loads the frozen and current TypeScript directly, creates isolated temporary fixtures, exercises actual Git commands, filesystem metadata reads, and child processes, and removes the fixtures afterward. It uses the actual `GitPage` memo expressions and `resolveMentions` implementation extracted from both source trees. Assertions verify command counts, omitted patch work, capped traversal, parse reuse, and unchanged resolved attachment text. The note-list count is instrumented with an empty note-list stub; the folder work uses real files.

Reported values are medians of five samples, except eight concurrent Git readers, oversized folders, and terminal shutdown, which use three. Git executable discovery is warmed before timing. These are local Node v24.19.0 measurements in the agent environment, with other work running; absolute subprocess times varied across repetitions. They are backend and computation measurements, not claims about rendered frame times. Process, byte, scan, and parse counts provide the deterministic evidence.

The main TypeScript compilation passed. All 63 focused Git, folder, terminal, and scheduled-IPC tests passed. Regression coverage checks summary/full snapshot separation, simultaneous metadata reads, coalescing, a fresh scan after settlement, traversal limits and event-loop availability, per-prompt listing reuse with fresh files on the next prompt, terminal exit cleanup, and existing path/symlink trust boundaries. Focused ESLint passed. The benchmark assertions additionally verify the filter memo behavior against the source.

The parent agent owns the final whole-repository checks and real-app interaction checks. This agent did not verify rendered interactions, Windows process-tree termination, shortcuts, privacy permissions, VoiceOver, display geometry, or signing. The desktop Git API's added boolean is optional and validated at IPC; the mobile wire format is unchanged because its `diff` option already existed.
