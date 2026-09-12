# Dictation work after its window closes

A supported Quick Ask interaction can leave recognition running after the UI that requested it has gone away: record, release to transcribe, then dismiss the overlay before recognition finishes. `closeOverlay` destroys an idle overlay; dictation does not set `overlayBusy`. The transcription IPC handler previously never observed its sender's destruction. Each request could retain a native recognizer and temporary WAV for the existing 120-second timeout, or a local speech upload followed by up to 20 seconds of cleanup inference. Reopening and dismissing Quick Ask permits independent requests to accumulate. This is separate from previously repaired microphone permission/startup cleanup: recording has already stopped in this path.

## Paired result

The fixture transpiles the actual `shinbo:transcribe` handler, `main/voice.ts`, and renderer `src/voice.ts`. Eight independent sender objects submit valid one-MiB, mono 16-kHz, 16-bit silent WAVs (about 32.8 seconds each, below the 12-MiB boundary). A deterministic child-process mock holds recognition until signaled; actual filesystem writes and cleanup run against disposable temporary directories. The same fixture runs against source copies saved before editing and current source.

| Measured operation/reference count | Before | After |
| --- | ---: | ---: |
| Helpers still active after all eight senders are destroyed | 8 | 0 |
| Recording files held by those active helpers | 8 (8 MiB) | 0 |
| Transcription IPC submissions after cancellation during conversion | 1 | 0 |
| Transcription IPC submissions after unmount during conversion | 1 | 0 |
| Files remaining after requests finish | 0 | 0 |

These are deterministic lifecycle counts, not native CPU, memory-RSS, or recognition-time benchmarks. The before fixture explicitly releases remaining children after measuring, so it leaves no processes or recordings behind. Native helper execution is simulated; no microphone, camera, speech permission, external provider, credential, or personal recording was accessed.

From the repository root:

```sh
SHINBO_VOICE_MAIN_SOURCE=/tmp/shinbo-voice-cleanup/before/main.ts SHINBO_VOICE_HOST_SOURCE=/tmp/shinbo-voice-cleanup/before/main-voice.ts SHINBO_VOICE_RENDERER_SOURCE=/tmp/shinbo-voice-cleanup/before/renderer-voice.ts node --test --test-name-pattern='destroying dictation senders|during audio conversion' desktop/test/voice-teardown.test.mjs
node --test desktop/test/voice-teardown.test.mjs
```

Before: three expected regression failures. After: 14 tests pass. Saved output: `/tmp/shinbo-voice-cleanup/before-paired.txt` and `/tmp/shinbo-voice-cleanup/after.txt`. Source snapshots live in `/tmp/shinbo-voice-cleanup/before/`.

## Change and preservation

The existing IPC handler creates an AbortController tied only to its sender's `destroyed` event and removes the listener on completion. It validates inputs first and handles an already destroyed sender. `transcribe` accepts an optional signal and forwards it through temporary recording writes, Node's owned-child `spawn` cancellation, local speech upload, and optional cleanup inference. Abort is checked after asynchronous response/body boundaries and is not converted into a connectivity error or successful cleanup fallback. Original timeouts and ordinary fallback/error behavior remain.

On native-helper abort, the promise waits for the owned child's `close` event before its existing `finally` removes the recording. There is no PID-based process lookup or new process framework. Readiness probes and speech authorization calls retain their existing semantics.

Renderer dictation tracks the current processing attempt. Cancel or unmount prevents delayed conversion from submitting IPC and prevents an already submitted result from editing a departed composer. The attempt remains marked busy until its promise settles, preventing overlapping starts. Successful dictation still publishes once and permits a later recording.

The tests cover upload abort, late response bodies, cleanup request/body abort, already destroyed senders, helper close ordering, ordinary successful recognition, normal server errors, optional cleanup failure, late conversion, late result, and retry after successful completion. The eleven earlier microphone lifecycle tests also pass.

Focused compilation and checks, run in `desktop`:

```sh
./node_modules/.bin/tsc -p tsconfig.main.json --outDir /tmp/shinbo-voice-cleanup/compiled
ln -sfn /Users/tronschell/Documents/shinbo/desktop/node_modules /tmp/shinbo-voice-cleanup/compiled/node_modules
node --test /tmp/shinbo-voice-cleanup/compiled/test/voice-lifecycle.test.js
./node_modules/.bin/tsc -p tsconfig.renderer.json --noEmit
./node_modules/.bin/eslint main/voice.ts main/main.ts src/voice.ts test/voice-teardown.test.mjs test/voice-lifecycle.test.ts --max-warnings 0
```

Main and renderer TypeScript and targeted ESLint pass. Full application checks and actual UI verification are coordinated by the parent audit.

## Limits and adjacent coverage

An already submitted request in a persistent renderer cannot be canceled remotely by the existing IPC protocol when only the React component unmounts or a key-hold is canceled. Its late result is ignored, and it cannot overlap a new attempt in that hook. Sender destruction cancels the actual host work. This change adds no IPC method and does not interpret ordinary persistent-window blur as sender destruction.

Native microphone/recognizer behavior, Windows child behavior, privacy prompts, VoiceOver, and real overlay capture remain unverified. Fake process and transport tests establish signal propagation and cleanup ownership only. OfflineAudioContext decoding already underway is not forcibly interrupted; completed conversion is prevented from starting further work.

The adjacent screen capture path requests bounded 2560×1600 thumbnails, and model screen-context preparation caps width at 1440. The screen-context store keeps one attachment and clears it with the existing overlay lifecycle; annotation frames are cleared on annotation close. No additional urgent, measured issue was established in those paths, so they were not changed. Existing image offload work is not counted again here.

## Production Electron transport teardown

The coordinator submitted valid one-second silent WAV buffers (32,044 bytes, 32,418 bytes including multipart framing) through the actual Quick Ask preload and IPC handler to a loopback server that held its response for 20 seconds. Two control requests remained open and completed normally after about 20,002 ms. For the teardown case, the existing `openWorkspace` action was invoked 1.5 seconds after submission, destroying the overlay. The server observed `audio-uploaded` → `audio-aborted` → `audio-closed` with `completed:false` after 1,535 ms, before its response timer. The workspace returned and no completion event followed for that request. These are real Electron window/IPC/fetch lifecycle observations; the scheduled close interval is not a measured cancellation latency. No microphone, native speech recognizer, OS privacy grant, or external service was used.
