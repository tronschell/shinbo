# Runtime image performance — 2026-09-12

## P1: Large attachment preparation stalls Electron's main process

A supported 8,000 × 6,000 JPEG occupies 6,138,293 bytes, below the 12 MiB attachment ceiling. Attachment preview creation (`held`), uncached model preparation (`AttachmentStore.forModel`), file previews, vision-tool images, and phone image responses decoded and resized its entire 48-megapixel bitmap synchronously in Electron's main process. The file picker processes multiple selections in one handler; the renderer rejects excess images only after those thumbnails are returned. Even a supported eight-image selection can therefore freeze application interactions for seconds. This is one shared root cause across preview and model preparation, not two counted fixes.

`attachmentImage` now runs macOS's `/usr/bin/sips` asynchronously to create a resized temporary PNG. Electron decodes only that small result for thumbnails and model images, retaining its existing thumbnail serialization and JPEG quality-80/quality-45 model encoding. File previews reuse the PNG bytes already encoded off-process, avoiding another main-process PNG encode. Vision and phone responses retain their existing `compressScreenFrame` JPEG loop and use the same helper with its existing 1440-pixel maximum width. The helper queries dimensions before model resizing so small images are not enlarged. It preserves originals, removes temporary directories, and retains the original decoder on conversion failure. Each subprocess has a 10-second timeout and bounded stdout/stderr capture. Attachment processing remains ordered; model preparation stops at eight valid images. Cancellation during preparation prevents further image work and model dispatch.

The native asynchronous thumbnail API was tested first and rejected: it returned a generic JPEG document icon, not photo content. Electron's utility process exposes no `nativeImage`. The existing Windows native helpers contain no reusable image resize/encode implementation. No worker, package, or dependency was added.

## Paired actual-source measurement

The saved script creates a deterministic photo fixture, uses actual before/after attachment modules in the installed Electron, and observes a 1 ms timer. Each mode runs once for warmup followed by three interleaved measurements. Every model preparation has a fresh store/cache. The reported main-loop gap is the largest timer gap during the operation, and total time includes awaiting the operation. It does not include fixture creation or the later output-verification decode.

| Operation | Metric, median of three measured runs | Before | After |
| --- | --- | ---: | ---: |
| Attachment thumbnail | Largest main-loop gap | 237.85 ms | 5.46 ms |
| Attachment thumbnail | Total operation time | 236.54 ms | 125.92 ms |
| Model image | Largest main-loop gap | 221.60 ms | 38.10 ms |
| Model image | Total operation time | 220.30 ms | 338.07 ms |

Thumbnail dimensions remain 149 × 112. Model dimensions remain 1568 × 1176. Model JPEG output was 353,269 bytes before and 338,628 bytes after, both below the existing 1 MiB threshold. The native resampling algorithm differs, so output bytes are not identical. The existing final JPEG quality levels remain unchanged; dimensions, corner content/orientation, transparency, and original bytes are checked.

The tradeoff is deliberate: model preparation takes about 118 ms longer per fixture while keeping the main process responsive between subprocess work and its remaining small-image JPEG encode. This is a responsiveness improvement, not a claim that every operation finishes sooner. Eight-image pauses are motivated by the actual supported call loop; no eight-image wall-clock speedup is inferred from this single-image benchmark.

Raw paired output is at `/tmp/shinbo-perf-wave3-runtime/ab-results.jsonl`. Pre-edit source copies are at `/tmp/shinbo-perf-wave3-runtime/before/`. The no-sibling copy used for app interaction checks is `/tmp/shinbo-perf-ui-photos/large-photo.jpg`. The original fixture directory also contains a Retina sibling from compatibility verification, so that original path selects the compatibility fallback.

Commands used:

```sh
desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave3-runtime/after
SHINBO_IMAGE_MODULE=/tmp/shinbo-perf-wave3-runtime/after/main/attachments.js SHINBO_IMAGE_BASELINE=/tmp/shinbo-perf-wave3-runtime/baseline/main/attachments.js ./desktop/node_modules/.bin/electron desktop/scripts/attachment-image-perf.mjs > /tmp/shinbo-perf-wave3-runtime/ab-results.jsonl
```

The baseline module was generated without edits by TypeScript `transpileModule` (ES2022/CommonJS) from `before/attachments.ts` to `baseline/main/attachments.js`, with `baseline/shared` linked to `after/shared`. The script can also run against an ordinary current build without a baseline:

```sh
npm --prefix desktop run build:main
./desktop/node_modules/.bin/electron desktop/scripts/attachment-image-perf.mjs
```

## Checks and compatibility

```sh
node --test desktop/test/attachment-flow.test.mjs /tmp/shinbo-perf-wave3-runtime/after/test/attachment-image.test.js /tmp/shinbo-perf-wave3-runtime/after/test/attachments.test.js
desktop/node_modules/.bin/eslint desktop/main/attachments.ts desktop/main/main.ts desktop/test/attachment-flow.test.mjs desktop/test/attachment-image.test.ts desktop/scripts/attachment-image-perf.mjs
```

Nine focused tests, TypeScript compilation and targeted ESLint passed. The actual Electron script additionally passed image dimensions, final JPEG size, original preservation, cached model output, EXIF fixture corner orientation, no model upscaling, portrait width limits, Retina representations, PNG transparency, corrupt-image fallback and temporary-file cleanup assertions. Fixtures and profiles are disposable; no provider calls or production data were used.

Electron supports filename-based scale factors and adjacent Retina representations and currently ignores EXIF metadata. The helper preserves the original decoder for explicit scaled filenames or adjacent supported representations; these paths remain synchronous. That avoids changing output density or dropping extra representations. See [Electron's nativeImage documentation](https://www.electronjs.org/docs/latest/api/native-image#high-resolution-image) for the scaling contract. The generated EXIF orientation fixture checks equivalence with existing Electron decoding, not a new EXIF correction feature.

Windows remains on the existing synchronous decoder. Windows execution, signing, privacy permissions, shortcuts, VoiceOver, and display geometry were not exercised by this worker. Root integration owns the real-app attachment interaction and full repository checks.

## Additional audited paths

Editor discovery is cached once per process. Its macOS icon path selects the smallest embedded PNG at or above the 40-pixel mark before trimming. No demonstrated urgent macOS editor-discovery finding was identified; editor code is unchanged. The Windows discovery path was inspected but not run on Windows.

The follow-up traced and fixed the same full-image decode in `previewImage` (file preview IPC), `folderImage` (vision tool), and the phone bridge's `readImage` request. Their existing width policies and encoding formats are preserved. File previews still produce PNG at a maximum width of 1600; vision and phone responses still enter the existing JPEG compression loop at a maximum width of 1440. Width limits preserve portrait aspect ratios rather than substituting a longest-edge cap.

The initial preview offload still blocked for about 209 ms while `toDataURL()` re-encoded the small PNG on the main process. Reusing the already encoded native PNG removed that redundant work. This extension is part of the same one root cause, not three additional counted findings.

| Operation | Median main-loop gap, before → after | Median total time, before → after |
| --- | ---: | ---: |
| File preview | 435.16 → 1.91 ms | 435.05 → 299.67 ms |
| Vision tool image preparation | 193.42 → 45.68 ms | 192.19 → 285.01 ms |
| Phone image response | 155.68 → 36.95 ms | 154.46 → 241.97 ms |

These are actual before/after main-function bodies, selected by the TypeScript parser, using the real `compressScreenFrame` and native image implementations. Only path grants are fixture bindings. The script checks unchanged 1600 × 1200 preview and 1440 × 1080 compressed output, plus missing-preview, invalid-vision-image and ungranted-phone-path rejection behavior. One warmup and three interleaved measured runs were used, on the no-sibling fixture copied into `/tmp/shinbo-perf-ui-photos/large-photo.jpg`.

```sh
SHINBO_IMAGE_MODULE=/tmp/shinbo-perf-wave3-runtime/after/main/attachments.js SHINBO_IMAGE_BASELINE_SOURCE=/tmp/shinbo-perf-wave3-runtime/before/main.ts SHINBO_IMAGE_FIXTURE=/tmp/shinbo-perf-ui-photos/large-photo.jpg ./desktop/node_modules/.bin/electron desktop/scripts/preview-image-perf.mjs > /tmp/shinbo-perf-wave3-runtime/preview-ab-results.jsonl
```

All native assertions, nine focused tests, TypeScript and targeted ESLint passed after this extension. Width-limited paths still decode an original whose width already fits the current limit, including unusually tall narrow images. Windows, Retina representations and conversion failures also retain the original decoder; their synchronous work is not claimed fixed. No new image-size limit or quality policy was introduced.


## Asynchronous integration review

This review is part of the same image-preparation root cause and adds no finding count. The existing busy-thread guards retain `pendingTurns` and `harnessRuns` until the original run finishes, so a new same-thread run cannot normally overlap the old run's cleanup. However, a rejected retry clears `goalStopped` before its busy check. A deferred preparation could then dispatch a previously stopped turn. `runOnHarness` now captures the existing agent run's `AbortSignal` before preparation and checks that captured signal before dispatch. Ordered preparation also stops scheduling further attachments when that signal is aborted. The regression executes the actual busy check and rejected-retry sequence while preparation is deferred.

Concurrent model preparation also exposed an older conversion overwriting a newer cached result after an external same-size file edit. Publication now compares the captured source's modification time, change time, size and inode with its current stat before writing. Stale conversions return the original path. Cache publication reuses `writeAtomicSync`, whose content type now also accepts `Uint8Array`; its existing temporary-file rename prevents partial publication. A deferred old/new conversion test verifies the fresh result survives, and an injected rename failure verifies the prior cache survives and the temporary file is removed.

Asynchronous preview requests could otherwise launch one full-size native decoder per mounted historical picture. A module-level Promise chain, matching the existing queue pattern in the repository, now serializes native image preparation across callers. An actual-source deterministic subprocess mock issued 100 simultaneous previews: the archived pre-queue source reached 100 active conversions; the final source held at one. Both completed 100 conversion attempts, including a simulated failure; the final queue continued and all other outputs matched. This bounds decoder concurrency and memory pressure, not aggregate completion time. Requests wait behind preceding conversions, and the active subprocess retains its existing timeout.

```sh
SHINBO_IMAGE_CONCURRENCY_SOURCE=/tmp/shinbo-image-lifecycle-before/attachments-prequeue.ts node --test --test-name-pattern='concurrent image previews' desktop/test/attachment-flow.test.mjs
node --test --test-name-pattern='concurrent image previews' desktop/test/attachment-flow.test.mjs
```

The first command fails the one-conversion assertion as expected, reporting `activeWhileBlocked: 100` and `peakConversions: 100`. The second passes with both values equal to 1. The remaining flow tests check the turn cap, ordering, invalid attachments, stop behavior, rejected retry, stale source and atomic failure paths. The phone and vision integration fixtures now await their asynchronous image helpers while preserving all allowed-path, outside-path and symlink grant assertions.

Final focused verification: 15 attachment/flow tests plus two phone/vision grant tests passed; TypeScript compilation and targeted ESLint passed. The actual Electron image script was rerun against the final queue/cache implementation and all native compatibility assertions passed. Its final output is `/tmp/shinbo-perf-wave3-runtime/final-native-check.jsonl`; that after-only verification is not a replacement paired timing comparison.

```sh
desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave3-runtime/after
node --test desktop/test/attachment-flow.test.mjs /tmp/shinbo-perf-wave3-runtime/after/test/attachment-image.test.js /tmp/shinbo-perf-wave3-runtime/after/test/attachments.test.js
node --test --test-name-pattern='readImage reads|vision tool is bound' /tmp/shinbo-perf-wave3-runtime/after/test/bridge.test.js /tmp/shinbo-perf-wave3-runtime/after/test/folders.test.js
desktop/node_modules/.bin/eslint desktop/main/attachments.ts desktop/main/main.ts desktop/main/write-atomic.ts desktop/test/attachment-flow.test.mjs desktop/test/bridge.test.ts desktop/test/folders.test.ts
SHINBO_IMAGE_MODULE=/tmp/shinbo-perf-wave3-runtime/after/main/attachments.js ./desktop/node_modules/.bin/electron desktop/scripts/attachment-image-perf.mjs > /tmp/shinbo-perf-wave3-runtime/final-native-check.jsonl
```
