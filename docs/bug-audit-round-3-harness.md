# Harness reliability, round 3

This round adds one confirmed P1 root and one P2 root, and completes the persistence portion of H5-2 from `bug-audit-investigator-5.md`. The latter remains the same root, not a new finding. All observations use the actual freshly built `shinbo-cli`, isolated temporary profiles and workspaces, and a deterministic local HTTP provider with dummy credentials. No live paid provider or production user data was used.

## H3-1: P1, Fresh context discards the explicit handoff after reopening

The model-written handoff can contain the only concise record of completed work and the next required action after a context rollover. ACP saved the compacted history boundary but retained the handoff only in memory. It also freed the handoff after building the next context snapshot. Restarting the harness and loading the same session replaced that handoff with an automatically assembled record. Important completed-work instructions could disappear from subsequent model requests, leading to repeated work or lost constraints.

The executable reproduction creates an ACP session, runs two prompts, enables Fresh context, calls `session/compact` with an explicit handoff, runs another prompt, closes the process, and loads the same session in a new process. The mock handoff includes a unique completed-work marker absent from the original conversation.

| Measured behavior | A, pre-fix | B, fixed |
| --- | --- | --- |
| Explicit handoff in request before restart | Present | Present |
| Explicit handoff in request after restart | Absent | Present |
| Replacing the handoff removes the previous marker | Not separately measured | Yes |
| Replacement handoff survives a second restart | Not separately measured | Yes |
| Previous marker remains absent after the second restart | Not separately measured | Yes |

The original strict check fails against `/private/tmp/shinbo-bug-audit/h3-compaction-binary-a` and passes against `/private/tmp/shinbo-bug-audit/h3-build/bin/shinbo-cli`. A artifacts are `h3-compaction-resume-a.json` and `h3-compaction-resume-strict-a.log`; B is `h3-compaction-resume-b.json` and its matching log. The final script includes the additional replacement checks.

The fix stores a bounded optional `context_handoff` with durable session state, restores it on ACP activation, and updates or clears it transactionally when a different history prefix is compacted. A no-op compaction retains the existing handoff. Fresh context applies it only to its original canonical prefix so later projection compaction cannot reuse stale instructions. The terminal session snapshot preserves the field while its compacted boundary remains unchanged. Existing sessions omit the optional field and retain their existing format.

Changed production files: `harness/src/acp/prompt.zig`, `harness/src/acp/sessions.zig`, `harness/src/core/session/session_codec.zig`, `harness/src/core/session/fresh_context.zig`, and `harness/src/core/app/app_session_runtime.zig`. Earlier unrelated changes in these files are preserved.

## H5-2 follow-up: P1, structured reasoning disappears on saved-session replay

The first H5-2 repair retained structured provider reasoning within one tool loop. The durable execution-memory representation still stored only plaintext reasoning. After saving and reopening a session, the assistant tool-call message lost its structured reasoning blocks, including encrypted signatures that providers may require to accept the next request.

The executable reproduction runs one assistant tool call with two structured reasoning blocks, finishes the turn, exits, and continues through `ask --resume-id` in a second process. The provider records the actual outgoing assistant tool-call message.

| Structured blocks retained | A, first H5 build | B, round 3 build |
| --- | --- | --- |
| Following tool result within the first turn | 2 of 2 | 2 of 2 |
| Following saved-session restart | 0 of 2 | 2 of 2 |

Both processes exit successfully in the fixture; the measured defect is the outgoing replay payload. The fixed result preserves the structured JSON verbatim through execution-memory construction, duplication, durable encoding/decoding, and message projection. The codec accepts legacy, plaintext-only, details-only, and combined shapes, rejects malformed structured JSON, and continues rejecting unknown fields.

Changed production files: `harness/src/core/shared/types.zig`, `harness/src/core/agent/execution_memory.zig`, `harness/src/core/session/session.zig`, and `harness/src/core/session/session_codec.zig`. Reproduction: `/private/tmp/shinbo-bug-audit/h3-reasoning-resume.py`; results: `h3-reasoning-resume-a.json` and `h3-reasoning-resume-b.json`.

## Local verification

The isolated build passes:

```sh
cd harness
zig build --prefix /private/tmp/shinbo-bug-audit/h3-build --cache-dir /private/tmp/shinbo-bug-audit/h3-build-cache --global-cache-dir /private/tmp/shinbo-bug-audit/h3-global-cache
```

137 focused tests pass, including every session-codec test, reasoning, compaction, handoff lifecycle, and prefix-scoping tests. Two fuzz test seed corpora also execute. Log: `/private/tmp/shinbo-bug-audit/h3-codec-tests.log`. The test command uses `zig test -fno-stack-check -fno-stack-protector --dep build_options -Mroot=src/main.zig -Mbuild_options=.zig-cache/c/eab1bc09e9289d5dfce7ebed9e27379b/options.zig -lc`, isolated caches, `--test-filter reasoning`, `--test-filter compaction`, `--test-filter handoff`, and each exact test name extracted from `session_codec.zig`; output binary is `/private/tmp/shinbo-bug-audit/h3-codec-tests`.

Strict real-process checks:

```sh
CHECK_FIXED=1 RESULT_PATH=/private/tmp/shinbo-bug-audit/h3-compaction-resume-b.json python3 /private/tmp/shinbo-bug-audit/h3-compaction-resume.py
CHECK_FIXED=1 HARNESS_BINARY=/private/tmp/shinbo-bug-audit/h3-build/bin/shinbo-cli RESULT_PATH=/private/tmp/shinbo-bug-audit/h3-reasoning-resume-b.json python3 /private/tmp/shinbo-bug-audit/h3-reasoning-resume.py
```

Both pass. The mock server requires localhost access outside the restricted sandbox. The binaries are built from this checkout into a unique prefix to avoid colliding with concurrent work. No speed improvement is claimed. Exact-commit remote CI, Electron UI verification, Windows, and live-provider acceptance remain outside this focused round; the parent audit owns overall integration checks.


## H3-2: P2, unsuccessful auxiliary model completions become trusted evidence

Vision and the model-based context summarizer checked HTTP status but ignored the model completion status. A provider could return valid-looking text followed by `length`, `content_filter`, `error`, or no terminal reason. Vision marked that response successful and forwarded its image claims to the main model. Compaction accepted a partial summary and removed the original constraint from the projected request. This is one root group covering two auxiliary callers of the same completion contract.

| Real-process observation across four unsuccessful endings | A | B |
| --- | --- | --- |
| Vision forwards the unsuccessful response as image evidence | 4 of 4 | 0 of 4 |
| Compaction uses the unsuccessful model summary | 4 of 4 | 0 of 4 |
| Compaction fallback retains the original test constraint | 0 of 4 | 4 of 4 |
| Successful `stop` control accepted by each caller | Yes | Yes |

Both callers now reuse `types.classifyProviderCompletion`. Vision reports a provider failure for error/filter endings and uses its existing bounded invalid-response retry for interrupted or length-limited output. Thus the two invalid-response fixtures make two Vision requests instead of one; this is an intentional bounded recovery attempt, not a speed or cost reduction. The error/filter cases remain one request. Compaction uses its existing local fallback and makes one summary request in every case.

Changed files: `harness/src/core/agent/runtime/image_provider.zig`, `harness/src/builtins/gateway/compaction_summarizer.zig`; two explicit imports in the test block of `harness/src/main.zig` ensure these regression tests are registered even when filtering narrowly. There are no new production abstractions or dependencies.

The isolated build and formatting pass. All 19 selected tests pass, including the seven substantive image-provider and compaction-summarizer tests plus module test registrations. Image inspection checks both callback-streamed and nonstream content for all five endings. Test log: `/private/tmp/shinbo-bug-audit/h3-auxiliary-tests.log`. The command uses the same `zig test` module/build-option arguments documented above, filters `image inspection`, `shared image provider`, and `gateway compaction`, and emits `/private/tmp/shinbo-bug-audit/h3-auxiliary-tests` with its own cache.

Both strict real-process probes fail against `/private/tmp/shinbo-bug-audit/h3-auxiliary-binary-a` and pass against the rebuilt round 3 binary:

```sh
CHECK_FIXED=1 RESULT_PATH=/private/tmp/shinbo-bug-audit/h3-vision-finish-b.json python3 /private/tmp/shinbo-bug-audit/h3-vision-finish.py
CHECK_FIXED=1 RESULT_PATH=/private/tmp/shinbo-bug-audit/h3-summary-finish-b.json python3 /private/tmp/shinbo-bug-audit/h3-summary-finish.py
```

The matching `-a.json`, `-b.json`, and `-strict-a.log` files retain requests, tool results, or projected messages. All tests use a temporary generated PNG and dummy localhost provider. The same integration limitations listed above apply.
