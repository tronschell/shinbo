# Final persistence and trusted IPC sweep

No additional urgent performance issue was established in this bounded read-only sweep. Production sources were not changed, and the finding count is unchanged.

The audit traced thread-context persistence, provider/tool settings updates, connected-folder and vault metadata persistence, permission request settlement, host IPC request cleanup, window loading, and harness edit snapshot ownership. It excluded credentials, native privacy calls, production data, and external network access.

## Measured remaining synchronous path

`rememberThreadContext` copies the compact context map, serializes it, writes a temporary file, and renames it before updating the live map. This is still synchronous and grows with thread count. The actual function was extracted with TypeScript and run against disposable synthetic contexts and actual temporary filesystem writes. Seven saves alternated a thread's permission mode at each size.

| Compact contexts | Saved JSON bytes | Median blocking duration | Maximum observed duration |
| --- | ---: | ---: | ---: |
| 1,000 | 132,891 | 0.822 ms | 4.453 ms |
| 10,000 | 1,338,891 | 6.345 ms | 12.809 ms |

Command: `node /tmp/shinbo-final-persistence/measure.cjs`. Raw results: `/tmp/shinbo-final-persistence/results.jsonl`. The disposable directory is removed in `finally`. These local timings do not establish a supported urgent stall, and no change was made. Larger maps, slower storage, and network-mounted application data were not measured; this is not a universal latency bound.

## Lifecycle and sizing coverage

- Permission settlement deletes its pending ask, clears its timeout, removes its AbortSignal listener, and resolves once. Stop dismisses asks belonging to the stopped run; the run-identity check prevents an old approval from authorizing a replacement. The active Auto review implementation is a local prohibited-action screen, so its callback without a signal does not hide an abandoned provider request.
- Host requests remove their pending entry on response and clear their per-call timer on resolve or reject. Failure rejects and clears pending requests and clears response assembly. Compact snapshot reuse expires after five seconds. No new completed-request timer leak was found.
- Window loading has a two-second paint fallback and checks destruction before showing. Listeners belong to their window or WebContents. No unbounded pending load was demonstrated.
- Harness edit snapshots are removed after completion/failure and also in the run's final cleanup. Their synchronous full-file read remains a possible large-workspace cost, but this sweep did not establish a new supported urgent workload beyond existing file/diff findings.
- Connected-folder metadata is bounded to 16 grants. Single folder file access is bounded to 256 KiB, and note reads have a 256-KiB body plus 16-KiB metadata cap. Vault configuration writes contain one normalized choice. These paths retain synchronous I/O; none produced a new demonstrated urgent finding here.
- Main provider, verifier, mode, review, and similar settings handlers validate and update runtime values. Provider saves recycle affected harnesses by design; the renderer's ordinary model-settings save compares provider values before requesting a recycle. Tool changes reuse the earlier unchanged-skill-mirror fix. No extra settings transport or subprocess loop was established.

The existing permission and thread-context regression suites were run from the isolated compiled desktop output. They cover late replies, canceled requests, stopped descendants, replacement-run ownership, permission timeout, grants, persisted mode/folder restoration, and invalid stored records. All 19 passed with `node --test /tmp/shinbo-voice-cleanup/compiled/test/permission.test.js /tmp/shinbo-voice-cleanup/compiled/test/thread-context.test.js` from `desktop`. This read-only sweep required no new application interaction, privacy permission, or platform claim; full integrated checks remain with the parent audit.
