# Investigator 4: Electron persistence and phone bridge

Four P1 findings reproduced and fixed against current TypeScript source. No P0 found. Runtime loading transpiles the actual source using the installed TypeScript compiler, avoiding stale build output. The Electron credential/image APIs are stubbed where necessary. Bridge B2 uses real WebSocket traffic on isolated loopback port 38473, actual FrameCodec encryption, and temporary pairing storage; only address discovery and keychain encryption are mocked.

Reproduce the A measurements:

```sh
node /private/tmp/shinbo-bug-audit/investigator4/repro.cjs
node /private/tmp/shinbo-bug-audit/investigator4/bridge-repro.cjs
```

The loopback repro required sandbox escalation for network listening; it completed successfully after approval. No user's profile, vault, keys, or phone was used. Measured B results and saved regression coverage are recorded below.

## P1 V1: Filing a screenshot allows a later screenshot to overwrite its image

Production trigger: keep a screenshot, file its note into a knowledge folder, and keep a second screenshot with the same title. Repeated generated screenshot titles are normal. Moving the Markdown note frees its original basename.

Root cause: `desktop/main/vault.ts` `freeNotePath` checks only root Markdown names; `writeAttachment` derives the image name from that reused stem and unconditionally replaces the existing attachment. `moveNote` leaves attachments shared under the knowledge root. The first note still points at the now-replaced image.

Executed A: original bytes `original screenshot` became `replacement screenshot`; the archived note still referenced the exact overwritten `attachments/repeated-screenshot.png` path. One prior screenshot lost from two keeps, with no error.

Minimum fix: reserve an unused attachment filename independently of Markdown filenames, with a unique suffix or collision check, and embed that exact name. Preserve existing attachment references.

Runnable regression: keep two screenshots with the same title, moving the first note between keeps; assert two distinct image paths and unchanged original bytes. Expected B: 0 prior images changed.

Impact: irreversible corruption of user knowledge-base screenshots during ordinary filing and capture.

## P1 A1: Adding an attachment deletes old conversation files

Production trigger: paste/drop a file or screenshot into a conversation, wait seven days, then paste/drop another file anywhere in the app.

Root cause: `desktop/main/attachments.ts` `save` calls `sweep`; `sweep` removes every file older than seven days solely by filesystem mtime. It ignores the persistent `held.json` index and conversation references. Neither the user nor the conversation is told that the file is being deleted. `held` retains the stale capability for this launch.

Executed A: after aging a saved fixture by eight days and saving a new fixture, the original path no longer existed while `holds(originalPath)` still returned true. One of two user attachments irreversibly deleted by an unrelated upload.

Minimum fix: stop age-based deletion of held user attachments. Only disposable derived files with a provable safe lifecycle can be cleaned. Do not add an expiry framework; removing the unsafe sweep is sufficient.

Runnable regression: save a held file, set its mtime to eight days ago, save another file; verify the original exists, its bytes are unchanged, and it remains readable after reconstructing AttachmentStore. Expected B: 0 referenced files deleted.

Impact: persisted conversation images and attached files silently disappear after a week. No documented seven-day attachment retention promise was found; `docs/data.md` describes these files as persisted attachments.

## P1 B1: Phone request retries execute a mutation twice

Production trigger: a phone retries an outstanding send/steer request with the same `clientId` while the first request is still resolving. Network reconnects and delayed attachment/mention preparation make the requests overlap.

Root cause: `desktop/main/main.ts` `onlyOnce` checks its map, awaits `run()`, and only then records the result. Both simultaneous requests see an empty map. Both `sendMessage` and `steerAgent` route through this helper. This is separate from renderer send-queue ordering.

Executed A: extracted and transpiled the exact `onlyOnce` definition from source, then invoked it twice for the same thread/client ID while holding the first callback outstanding. Two requests caused two callback executions instead of one.

Minimum fix: place the in-flight promise in the existing cache before another invocation can enter; delete a failed entry so a later intentional retry can succeed. Apply existing cache bounds without evicting the active request prematurely.

Runnable regression: two simultaneous identical IDs must share one callback; different IDs execute separately; a rejection must permit a subsequent retry. Expected B: one mutation from two matching requests.

Impact: duplicate user messages/model runs and repeated steer instructions; resulting agent actions or charges can be repeated. Investigator 1 owns renderer queue issues, so root should deduplicate only if another report names this exact main-process cache root cause.

## P1 B2: Regenerating a pairing QR leaves the old unverified socket authorized to finish

Production trigger: one phone scans a pairing QR and connects without entering its PIN. The desktop starts another pairing, replacing the QR/PIN. The first connected phone continues sending unlock requests.

Root cause: `desktop/main/bridge.ts` `pair` calls `unstage()` (timer cleanup only) and overwrites `staged`, leaving the old staged socket and codec alive. The PIN-attempt limit applies only when `session.peer === staged`, so the old peer now has unlimited attempts. After its original PIN succeeds, `commit()` appends the *new* staged peer, although the old peer was the one verified. The old socket becomes verified and can invoke the privileged dispatcher; the new persisted peer remains `verified:false` and fails to load after restart.

Executed A over real encrypted WebSocket traffic:

```json
{"wrongAttemptsAccepted":6,"oldQRStillOpen":true,"oldPinUnlock":true,"dispatches":1,"snapshot":true,"persistedVerified":[false]}
```

Minimum fix: retire the previous staged pairing through the existing cancellation path before publishing another staged peer, and ensure verification/commit operates on the same currently staged peer. Audit the async `pairingHost()` gap so overlapping pairing requests cannot resurrect an older staged socket.

Runnable regression: connect using QR1, regenerate QR2, assert socket1 closes and cannot unlock or dispatch, then connect QR2 with its PIN and verify one persisted `verified:true` peer. Expected B: zero old-pair dispatches and exactly one valid new peer. Wire protocol need not change; sibling mobile/docs review still follows the repository contract.

Impact: replaced QR sessions retain access beyond intended cancellation, lose PIN brute-force protection, can read conversations/control the computer, and corrupt newly saved pairing state. All these symptoms share one staged-peer replacement root cause; count once.

## P2 findings, excluded from the P1 count

C1: a valid-JSON `null` credentials file causes `Object.entries(stored)` to throw in CredentialStore.load. Constructor is called before host/UI startup in main.ts. Executed A: `Cannot convert undefined or null to object`. This is a total startup failure for a damaged profile, but no normal app writer of `null` was found, so treat as P2 hardening, not an inflated P1. Validate an object before iteration and preserve unreadable bytes.

C2: CredentialStore.set/remove mutate their in-memory maps before save succeeds. A secure-store/filesystem failure leaves a failed change visible to list/applyToEnv, and a later successful unrelated save can persist it. Existing test covers untouched disk but not map rollback. Static evidence only; do not count until a normal failure trigger and runnable persistence regression are established.

## Boundaries and limitations

No actual GUI interaction was exercised by investigator 4. Root owns final real-app interaction verification. The application launch/interaction requirement remains for the fixing phase, especially knowledge-base filing/capture, composer attachment history, and phone re-pairing. Keychain privacy prompts, real mobile radio reconnects, macOS/Windows signing, non-macOS behavior, accessibility, and display geometry are unverified. Profile compatibility work was left to investigator 3; no separate Electron compatibility finding was fabricated.


## Implemented fixes and measured B

| Finding | Executed A on original source | Executed B on fixed source | User impact |
|---|---|---|---|
| V1 | 1 existing screenshot overwritten after moving its note | 0 overwritten; original bytes identical, separate second image | Filing notes no longer risks screenshot loss |
| A1 | 1 held attachment deleted by the next upload after eight days | 0 deleted; original readable before and after reconstructed store | Conversation files remain available beyond one week |
| B1 | 2 executions for 2 simultaneous requests with one client ID | 1 execution; same result shared | Retries no longer repeat agent mutations |
| B2 | Old socket remained open, accepted 6 wrong PINs and its original PIN, dispatched a snapshot, and stored the new peer unverified | Old socket closed; only the new PIN session dispatched, exactly 1 new peer stored verified; canceled and superseded address lookups reject | Replaced pairings cannot retain authorization or bypass PIN attempt limits |

V1 preserves ordinary attachment names and adds an unused numeric suffix on collision. A1 removes the unsafe age sweep. B1 stores an in-flight promise before executing the mutation, discards failed entries for retry, and evicts only completed entries/threads. B2 retires the old staged session before address lookup, invalidates canceled/superseded lookup generations, and commits only the exact verified staged peer.

Regressions are in `desktop/test/vault.test.ts`, `desktop/test/attachments.test.ts`, and `desktop/test/bridge.test.ts`. Tests cover cache pressure without active-request eviction, failed-request retry, real encrypted WebSocket re-pairing, and canceled/inverted address-lookup completion. Six new tests: five failed on the original source and one compatibility check (retry after rejection) already passed; all six pass after fixes. The five failures represent four root causes, because both replacement socket and lookup cancellation checks cover B2.

Original source was extracted from `/private/tmp/shinbo-bug-audit/source-before.tgz` into `/private/tmp/shinbo-bridge-fixes/before`. Only the three new test files were copied into that isolated tree. The baseline compiled successfully; targeted A run reported **6 tests, 1 pass, 5 fail**. Fixed source was compiled into `/private/tmp/shinbo-bridge-fixes/build`, preserving shared `dist-main`; the complete three-suite B run reported **65 tests, 65 pass, 0 fail**, including real loopback traffic. Main TypeScript compilation passes. Focused ESLint covers the four source files and their tests.

At root's explicit request, also added only an `unknown` parameter annotation to the concurrent performance test's `desktop/test/folders.test.ts` mocked `readdir` callback; this fixes its implicit-any compile error without changing behavior or counting as a bug fix.

P2 credential findings remain untouched and excluded from the fixed count. Root owns full repository checks, UI exercise, and sibling documentation review. No wire-format change was made.
