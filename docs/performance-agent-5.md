# Discovery and startup performance fixes

This second independent audit assignment fixed seven defects in six production files: `catalog.ts`, `model-metadata.ts`, `cli-models.ts`, `capabilities.ts`, `semantic-grep.ts`, and `zvec-grep.ts`. Nine measured regression assertions and an installation-cancellation ordering check cover these seven defects; semantic indexing, proxy cancellation, and shutdown are grouped as one lifecycle defect instead of counted separately.

All A/B counts execute the real implementation against controlled fixtures. Baseline modules were extracted from the pre-task `/tmp/shinbo-perf-baseline/source.tar` working tree. These measurements describe operations and scheduling, not invented production latency or CPU savings.

| # | Priority and problem | Measured baseline → fixed | User impact |
| --- | --- | --- | --- |
| 1 | P1 with large imported skill libraries: Selecting or previewing one skill opens and validates every unrelated SKILL.md. | Selecting and previewing one of 64 skills: **130 → 4 SKILL.md opens**, 96.9% fewer. | The requested skill no longer waits behind metadata I/O for the entire library. Directory enumeration and the selected file's existing bounds and real-path checks remain. Installed/imported precedence is preserved by filtering every root to the requested name before validation. |
| 2 | P2: Every tool-settings change rewrites all managed skill mirrors even when their instructions have not changed. | A second sync of 32 unchanged skills: **64 → 0 writes**. | Tool toggles and plugin changes stop rewriting identical instruction and ownership-marker files. Changed instructions still propagate; disabled or removed managed skills are still removed. This trades a bounded destination read for avoided writes and preserves external edits. |
| 3 | P2: Explicit CLI model refresh bypasses the existing in-flight map. | Two overlapping forced refreshes: **2 → 1 resolver calls** in a held-discovery fixture. | Simultaneous refresh requests share discovery work instead of launching duplicate model-list commands or binary scans. A later explicit refresh still starts fresh discovery. The fixture measures resolver calls, not the duration of a real CLI scan. |
| 4 | P1 with slow provider endpoints: Provider setup waits for its model list before starting the independent tool-support probe. | Requests started before the model-list response is released: **1 → 2**. Total required requests remain two. | The model list and tool check overlap; neither waits for the other to begin. Each keeps its existing timeout, result handling, and model-list error precedence. No absolute network speedup is claimed. |
| 5 | P2: OpenRouter and models.dev refreshes synchronously persist their catalog files on Electron's main thread. | One refresh of each: **2 → 0 synchronous writes**, with **0 → 2 asynchronous writes**. | Filesystem persistence no longer blocks window/input processing while catalogs are saved. Refresh still waits for persistence and handles cache-write failure as before. JSON serialization and validation remain synchronous; this does not claim their cost disappeared. |
| 6 | P1: Disabling semantic search leaves active indexing workers running, disconnected embedding fetches continue, and quit synchronously waits for its shutdown command. | On disable: **0/4 → 4/4 workers stopped**. On embedding connection close: **0 → 1 upstream abort**. On shutdown: **1 → 0 synchronous process waits**. | Turning search off now stops its indexing work and releases abandoned embedding requests. Shutdown uses the existing asynchronous daemon command with a five-second process timeout. A pending restart cannot resurrect the daemon after stop. Completed folder indexes remain available for later re-enabling. Provider-side billing behavior was not measured. |
| 7 | P2: Constructing the search installer synchronously recursively deletes old installation trees before the window can finish starting. | Constructor with one old installation tree: **1 → 0 synchronous recursive deletions**; the old tree is still removed. | Startup returns while filesystem cleanup proceeds asynchronously. Installation waits for initial cleanup before creating staging files, preserving ordering. Final cleanup and replacement removal also use asynchronous filesystem operations. Total deletion work is unchanged. |

The integrity review downgraded items 5 and 7 from their initial P1 classifications. Catalog verification uses one model per catalog and measures API scheduling, not a large-catalog blocking duration. Startup cleanup verification uses one old one-MiB file and counts synchronous removal calls, not a measured urgent startup delay. These are valid improvements, but those fixtures establish P2 evidence rather than demonstrated P1 user impact. No new benchmark or source change was made for the reclassification.

## Verification

The new `desktop/test/discovery-performance.test.ts` has ten passing regression tests. Existing catalog, model-metadata, capability, plugin, semantic-search, and search-installation tests cover compatibility, bounds, skill removal, executable routing, and archive behavior. Final focused verification passed **69/69 tests**. TypeScript and scoped ESLint passed.

A/B output is saved in `/tmp/shinbo-discovery-perf-before.log` and `/tmp/shinbo-discovery-perf-after.log`. All nine measured performance assertions fail against the baseline and pass against the fixed implementation; the cancellation ordering check also passes after the cleanup change.

The tests can be compiled into a temporary directory without touching the app's `dist-main` build. The existing plugin source test expects the normal `dist-main`/`src` layout, so the temporary directory includes source-file symlinks:

```sh
mkdir -p /tmp/shinbo-discovery-perf-after/src
ln -s "$PWD/desktop/src/App.tsx" /tmp/shinbo-discovery-perf-after/src/App.tsx
ln -s "$PWD/desktop/src/ActivityView.tsx" /tmp/shinbo-discovery-perf-after/src/ActivityView.tsx
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-discovery-perf-after/dist-main
cd desktop
NODE_PATH="$PWD/node_modules" node --test /tmp/shinbo-discovery-perf-after/dist-main/test/discovery-performance.test.js /tmp/shinbo-discovery-perf-after/dist-main/test/catalog.test.js /tmp/shinbo-discovery-perf-after/dist-main/test/model-metadata.test.js /tmp/shinbo-discovery-perf-after/dist-main/test/capabilities.test.js /tmp/shinbo-discovery-perf-after/dist-main/test/plugins.test.js /tmp/shinbo-discovery-perf-after/dist-main/test/semantic-grep.test.js /tmp/shinbo-discovery-perf-after/dist-main/test/zvec-grep.test.js
./node_modules/.bin/eslint main/catalog.ts main/cli-models.ts main/model-metadata.ts main/capabilities.ts main/semantic-grep.ts main/zvec-grep.ts test/discovery-performance.test.ts
```

The baseline used `/tmp/shinbo-runtime-perf-baseline/desktop`, already extracted from the original archive for the runtime audit. Copy the same discovery test into its test directory and compile with its original tsconfig into `/tmp/shinbo-discovery-perf-before`; its node_modules points at the existing desktop installation. Then run:

```sh
NODE_PATH="$PWD/desktop/node_modules" node --test /tmp/shinbo-discovery-perf-before/test/discovery-performance.test.js
```

The first combined run passed 67 tests; one existing plugin test failed because the initial temporary output did not include its expected source directory. The corrected layout resolves that fixture issue without changing application or test behavior.

This agent did not launch the desktop app. Visible-interaction verification, macOS permissions, VoiceOver, geometry, signing, and non-macOS validation remain with the coordinator. The four P2 findings should retain that classification when counting high-priority defects.
