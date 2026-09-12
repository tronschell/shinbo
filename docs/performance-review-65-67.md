# Independent correctness review: voice cleanup and agent library reads

No concrete regression was found in this bounded review. No product source or tests were changed.

The reviewed baselines are the exact files documented by the originating audits: `/tmp/shinbo-voice-cleanup/before/main.ts`, `main-voice.ts`, and `renderer-voice.ts`; and `/tmp/shinbo-perf-agent-library/agent-loop.before.ts`. Reviewed current source includes the transcription IPC handler, both voice modules, the shared library/read/ancestry paths, and the host/core summary projection and filtering they rely on.

## Voice ownership and races

- The IPC request validates first and binds its AbortController to its own sender's destruction. It handles an already destroyed sender, never listens to unrelated windows, and removes its destruction listener in `finally` on every completion path.
- Temporary recordings have one owning async operation. Abort before/during writing or before spawn still reaches directory cleanup. An aborted spawned helper settles from the owned child's `close` event, so the WAV remains available until that child closes. The existing non-abort missing-helper error behavior is unchanged.
- Signals propagate to the local upload and optional cleanup request, with checks after response/body boundaries. Sender abort cannot silently turn into successful cleanup fallback or a late accepted transcript. Existing cleanup timeout fallback and ordinary recognition errors remain distinct from sender cancellation.
- Renderer processing retains its attempt marker until the operation settles. Cancel/unmount aborts that marker; conversion cannot later submit IPC, a late response cannot call the departed composer, and a new start is refused while the old attempt is still pending. The unconditional `processing.current = null` in `finally` cannot clear a newer attempt through the normal hook API because `start` refuses overlap and `cancel` retains the marker.

Known limits remain as documented: canceling a hook in a persistent renderer does not send a new remote-cancel IPC; already submitted host work runs to its existing timeout/completion unless the sender itself is destroyed. Offline audio decoding already underway is not interrupted. Native recognizer signal handling, Windows process behavior, and privacy UI are outside this non-native review. They are not represented by the mocked lifecycle results.

## Agent library consistency and ancestry

- Summary projection carries the same ID, title, kind, parent ID, archive state, updated timestamp, and exact message count needed by these callers. Core summary/full listing paths apply the same retention filtering and use the same snapshot record envelope. The summary request is complete rather than paginated.
- `startedBy` changed only its TypeScript input shape; its parent map, visited-set cycle guard, sender selection, and ancestor walk are unchanged. The same summary records reach message and bench steering/stopping checks. Deep descendants, unrelated threads, and own-thread protection remain covered.
- Selected reads retain the summary lookup and original missing-ID error before requesting one history. The explicit history response supplies the displayed title, kind, count, and tail. Advisor history still uses the same twenty-message limit and optional unavailable-history fallback.
- A deletion between summary lookup and targeted history read now rejects that read; this is documented and appropriate for the live two-request sequence. No request cache or transaction snapshot was introduced. Metadata-only listing/messaging no longer requires unrelated message arrays.

## Focused checks

After coordinating with the root agent, ran only existing focused checks against existing compiled fixtures; no rebuild, stress benchmark, CUA, microphone, or privacy work occurred:

```sh
node --test desktop/test/voice-teardown.test.mjs
cd desktop
node --test /tmp/shinbo-perf-agent-library/compiled/test/agent-library-performance.test.js /tmp/shinbo-perf-agent-library/compiled/test/agent.test.js /tmp/shinbo-perf-agent-library/compiled/test/bench-boundary.test.js /tmp/shinbo-voice-cleanup/compiled/test/voice-lifecycle.test.js
```

All 66 tests passed: 14 sender/processing teardown checks and 52 library, agent-boundary, and microphone-startup lifecycle checks. Existing tests establish the ordinary success/error paths, held child-close ordering, upload/body/cleanup cancellation, late conversion/results, subsequent restart, missing/malformed library handling, selected tails, deep ancestry, and bench protections. These results support the reviewed invariants; they do not replace native application verification or constitute exhaustive race testing.
