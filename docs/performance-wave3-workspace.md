# Wave three: workspace and process audit

One new P1 resource/latency issue is fixed: phone note and memory readers allocated and synchronously read entire files before applying their advertised 256 KiB response limit. This is distinct from earlier folder discovery, Git output, and terminal batching work.

## Bounded phone file reads

`readNote` and `readMemory` accepted validated paths, checked that the target was a regular file, then called `readFileSync(file).subarray(0, limit)`. The limit applied only after disk I/O and allocation. An externally edited or imported large note therefore caused a full-file allocation on Electron's main thread even though the phone received only a short prefix. The same issue affected externally enlarged memory files. Repeated requests amplified unnecessary disk traffic and temporary memory use. P1 reflects this unbounded resource exposure behind an explicitly bounded API, rather than treating the small-file case as urgent.

Both handlers now use one local `readLimitedText` helper after their existing path validation. It opens the file asynchronously, verifies the opened handle is a regular file, reads only the permitted prefix, completes short reads, and closes the handle in `finally`. Small text, including an existing UTF-8 BOM, is preserved. If the byte budget splits a UTF-8 character, that incomplete trailing character is omitted instead of returning a replacement character. The response still reports `truncated`.

The matched fixture is a 256 MiB sparse regular file with a 256 KiB ASCII prefix. It represents an externally enlarged note; it is not a claim about typical note size. Both variants execute the actual `readNote` handler extracted from their source and return identical text.

| Median of five reads | Before | After |
| --- | ---: | ---: |
| File bytes read per request | 268,435,456 | 262,144 |
| Returned UTF-8 bytes | 262,144 | 262,144 |
| Handler completion | 26.155 ms | 0.268 ms |
| Scheduled timer delay | 26.202 ms | 1.436 ms |

The byte count falls by 1,024×. The old call necessarily allocated its full 256 MiB read buffer; the new payload buffer is at most 256 KiB. These are payload allocation bounds and measured read counts, not a claim that process RSS changed by exactly that amount. Filesystem metadata/path checks in the existing validation helpers remain unchanged. Timing is local warm-filesystem behavior, not a mobile network or rendering benchmark.

## Reproduction and checks

Before editing, exact copies of `desktop/main/main.ts`, `background.ts`, and `browser.ts` were saved under `/tmp/shinbo-perf-wave3-workspace/desktop/main`. Only narrow `main.ts` imports, the two handlers, and their helper were changed. Other concurrent edits were preserved.

```sh
node desktop/scripts/phone-read-perf.mjs
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-agent4/desktop/dist-main
node --test /tmp/shinbo-agent4/desktop/dist-main/test/phone-read-performance.test.js /tmp/shinbo-agent4/desktop/dist-main/test/memory.test.js /tmp/shinbo-agent4/desktop/dist-main/test/vault.test.js
cd desktop
./node_modules/.bin/eslint main/main.ts test/phone-read-performance.test.ts scripts/phone-read-perf.mjs
```

Raw paired results: `/tmp/shinbo-perf-wave3-workspace/phone-read-results.json`. The benchmark accepts baseline and current `main.ts` filenames as its first two arguments. It uses real temporary files and cleans them afterward. Only the exact relevant handler and helper are extracted; unrelated concurrent `main.ts` changes do not enter the measurement.

Compilation, ESLint, and all 34 focused tests passed. The new tests cover both actual handlers, the byte limit on large files, unchanged small text/BOM, empty files, Unicode cutoffs, path traversal refusal, directory refusal, partial reads, read failures, and handle cleanup.

## Remaining audit coverage

- `background.ts`: inspected start, rolling output, retention, stop, and stop-all, plus every desktop/mobile caller. A real child emitted 100,000 separate 64-byte writes through `setImmediate`; Node delivered 93,833 callbacks over 2,632.787 ms. Collection callbacks occupied 501.444 ms of measured wall time, with a worst callback of 1.871 ms and maximum measured timer gap of 3.055 ms. This establishes a bounded copying cost under a very high output rate, but not an urgent UI stall in the observed workload. The probe is `/tmp/shinbo-perf-wave3-workspace/background-probe.cjs`. No background code was changed. Its full two-second shutdown grace remains a P2 candidate, already identified by the coordinator.
- `browser.ts`: traced tab/session creation, hide/show, explicit close, app shutdown, CLI capture, and timeout cleanup. Command capture already bounds retained output. `stopAll` destroys views without calling the session-close command used by `forget`; installed agent-browser documentation describes persistent attached daemons. Actual orphan-process behavior after Electron disconnect was not measured, so no daemon leak or fix is claimed.
- Preview paths: traced file grant checks, text size checks, image preview conversion, and renderer mounting. Ordinary text preview already checks its size before reading. Large native image decoding remains a potential platform-specific profiling topic; no measured new P1 was established.
- Also inspected editor discovery, voice helper capture, CLI output/stop paths, foreground Windows probing, and watcher references. No repository filesystem watcher implementation exists in these workspace files; the `watch` references found are bridge polling outside this assignment's ownership. One-time editor discovery and existing bounded helper-output paths were not promoted into urgent findings without evidence.

This bounded audit is complete with one confirmed fix. Further browser-daemon or native-image work requires targeted lifecycle/platform measurements. Final integrated checks and real-app/mobile verification belong to the coordinator. Native Windows execution, VoiceOver, privacy permissions, global shortcuts, alternate display geometries, and signing were not exercised here. The mobile wire format and authorization rules did not change.
