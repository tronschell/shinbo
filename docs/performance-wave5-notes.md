# Artifact, memory, and note audit — 2026-09-12

## Implemented finding: P1 note listing blocks Electron

`listNotes` synchronously read and parsed each note body before returning. The regular desktop loads this list through `App.useNotes` at startup and refreshes it after notes-changed events. The same function supplies the phone's note list, command suggestions, and `@note` resolution before sending a prompt. A supported library of 1,000 ordinary notes, each about 33 KiB and well below the existing per-note size limit, blocked the main thread for hundreds of milliseconds.

The fix uses asynchronous file reads and fallback file-date stats in `readNote`, then awaits each note in `listNotes`. Sequential processing keeps only one note body under active parsing at a time. Existing main-process callers now await the resulting list wherever they inspect it, including the phone's response-budget wrapper, `notesOrNone`, and the prompt-local note cache. IPC handlers that already return the list return its Promise directly. The renderer and phone protocol continue receiving the same array.

No size policy, path checks, directory selection, sorting, frontmatter interpretation, excerpt logic, image resolution, or response budget changed. No cache, worker, dependency, or parallel read expansion was introduced.

## Measured A/B

The reproducible harness `desktop/scripts/note-list-perf.mjs` creates an isolated library containing 1,000 valid notes totaling 33,471,890 bytes. Five baseline/fixed pairs alternate execution order. A 1 ms interval measures opportunities for other main-thread work. Every result is compared deeply, including ordered note metadata and excerpts. The fixture is removed in a finally block.

| Median across five runs | Baseline | Fixed |
|---|---:|---:|
| Listing completion time | 275.247 ms | 327.270 ms |
| Largest heartbeat gap during listing and immediate drain | 275.349 ms | 3.007 ms |
| Heartbeats delivered before listing completed | 0 | 323 |
| Notes returned | 1,000 | 1,000 |
| Complete result equivalence | Identical | Identical |

This is a responsiveness fix, not a total-latency speedup. Total completion took 52.023 ms longer (18.9%) in the paired fixture. The uninterrupted main-thread stall fell by 98.9%. An initial separate-process baseline also measured 408.5 ms median completion with no heartbeat progress, but the table uses the alternating paired run rather than combining those measurements.

The P1 rating rests on a routine startup/list refresh blocking the whole application for roughly a quarter second with supported data. It does not depend on malformed files, oversized notes, artificial filesystem delays, or counting the same read as separate defects.

## Reproduction

Exact pre-edit source copies are under `/tmp/shinbo-perf-wave5-notes/`: `artifacts.baseline.ts`, `memory.baseline.ts`, `vault.baseline.ts`, `main.baseline.ts`, and `vault.test.baseline.ts`. Only vault, its narrow main call sites, and tests were edited. Concurrent attachment work in main.ts was preserved.

The baseline compiled module under the previous wave's isolated build predates this change and matches the frozen vault source. The fixed build uses a separate output directory so it cannot race the shared dist-main directory.

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave5-notes/compiled
node desktop/scripts/note-list-perf.mjs /tmp/shinbo-perf-wave4-browser/compiled/main/vault.js /tmp/shinbo-perf-wave5-notes/compiled/main/vault.js > /tmp/shinbo-perf-wave5-notes/ab.log
node --test /tmp/shinbo-perf-wave5-notes/compiled/test/vault.test.js /tmp/shinbo-perf-wave5-notes/compiled/test/note-list-performance.test.js
node --test --test-name-pattern='one prompt|mentioned skill' /tmp/shinbo-perf-wave5-notes/compiled/test/folders.test.js /tmp/shinbo-perf-wave5-notes/compiled/test/schedule-ipc.test.js
node --test --test-name-pattern='a list a phone asks|a list that was trimmed' /tmp/shinbo-perf-wave5-notes/compiled/test/bridge.test.js
cd desktop
./node_modules/.bin/eslint main/vault.ts main/main.ts test/vault.test.ts test/note-list-performance.test.ts scripts/note-list-perf.mjs --max-warnings 0
```

The isolated build's node_modules link points at desktop/node_modules. The source-reading caller tests use `/tmp/shinbo-perf-wave5-notes/main` and `src` links to the repository's corresponding directories.

Main compilation, all 26 vault/performance tests, focused caller checks, and lint passed. The new regression checks that the event loop progresses before the list completes and that no synchronous body read occurs; it also covers ordered Unicode metadata, tags, sources, nested folders, an image embedded after 33 KiB of body text, malformed frontmatter, externally changed notes, and unavailable vault folders. Existing tests retain coverage of symlink refusal, image containment, saved-date fallback, and file moves.

Transpiling the frozen baseline into only the isolated build's vault module makes the dedicated regression fail with exit 1 because the scheduled event-loop callback cannot execute before listing completes. The fixed module was restored immediately afterward. The result is recorded in `/tmp/shinbo-perf-wave5-notes/baseline-regression.log`.

## Other audited paths and limits

- Artifact listing reads metadata asynchronously and returns at most 512 entries. Surface conflict checks share it. Repeated callers and serial metadata reads may add latency, but this audit did not establish another urgent defect there.
- Artifact reads and edits validate names and enforce their existing content/file limits. Mutations are serialized per user-data root. Query execution uses a child process with a two-second deadline, a four-query concurrency ceiling, SQL authorizer restrictions, database/heap/row/output budgets, and child termination on completion. These boundaries were left intact.
- Artifact renderer callers were traced through `ArtifactsView`, `GridCard`, `GridPreview`, `ArtifactFrame`, the app count hook, region loading, and scheduled-task selection. Existing viewport deferral was already implemented and is not recounted.
- Memory commands and listing already perform asynchronous filesystem work and enforce existing file/list/depth constraints. Context statistics, the agent editor, and phone listing consume that API. No additional measured urgent defect was established in this bounded pass; these files were left unchanged.
- Directory enumeration and individual note parsing still run synchronously. The fix removes the measured accumulation of synchronous body reads; it does not claim to bound an externally created enormous single markdown file or a pathological directory tree. File acceptance and complete metadata behavior were deliberately preserved.
- Native UI validation and the integrated full suite belong to the parent audit. This focused pass did not drive user UI or change visible controls. Windows-specific filesystem latency was not measured.
