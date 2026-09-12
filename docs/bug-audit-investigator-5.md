# Harness audit, investigator 5

Audit-only findings against the current working tree on 2026-09-12. No harness source was edited. Existing source changes were preserved. The built production executable exercised was `harness/zig-out/bin/shinbo-cli`, confirmed by the coordinator to contain the current source baseline. All network reproductions used localhost, dummy credentials and temporary home/workspace directories.

Two supported P1 root-cause groups were found. Related parsing/serialization omissions are grouped rather than counted separately to fill a quota. No P0 is claimed.

## H5-1: Accepted image attachments fail before reaching vision models (P1)

User impact: ordinary screenshots and photos can be accepted, stored and displayed as attachments, then fail the entire turn. The error incorrectly suggests pruning old conversation context even for a brand-new conversation with one image. Retrying or compacting cannot reduce this image payload.

Production path: image input -> `image_attachments.captureImageSnapshotFromOpenFileWithBudget` -> native image projection -> `shinbo_openai.build` -> unconditional 1 MiB request-body limit. Image snapshots explicitly permit 5 MiB of base64 per image, and ACP allows eight images, so accepted inputs substantially exceed the transport's unrelated limit.

Root locations:

- `harness/src/gateway/shinbo_openai.zig:20`: `max_request_bytes = 1024 * 1024`.
- `harness/src/gateway/shinbo_openai.zig:275`: rejects the full serialized request, including inline images.
- `harness/src/core/images/image_attachments.zig:18`: the accepted encoded-image limit is 5 MiB.
- `harness/src/core/images/image_attachments.zig:537`: normalization happens only beyond that 5 MiB limit.

Measured A result from a freshly launched real CLI for each fixture:

| PNG fixture | Accepted input bytes | Provider calls | Exit | Result |
| --- | ---: | ---: | ---: | --- |
| 100 x 100 RGB control | 30,173 | 1 | 0 | Finished |
| 640 x 640 RGB | 1,229,883 | 0 | 1 | RequestTooLarge |

The fixture returns a catalog entry advertising image input for `openai/gpt-5.5`. Both files are valid PNGs, generated deterministically with seed 123. The larger file remains below the snapshot normalization threshold. The command is the actual `ask --json --yolo --no-save --image PATH` entry point; the model mock returns a terminal successful answer for any received request.

Reproduction: `/private/tmp/shinbo-bug-audit/harness-images-a.py`.
Captured result: `/private/tmp/shinbo-bug-audit/harness-images-a.json`.

Minimal repair: align request serialization limits with the image payloads that image capture accepts. Prefer a bounded total that accounts for the supported image count and encoded-image budget, or a separate text versus image budget. Preserve the existing image validation and cancellation checks. A fresh 1.2 MiB image must be sent successfully without disabling request bounds.

Regression and B measurement: run the same script unchanged against the rebuilt binary. Both fixtures should exit 0 and each should reach the provider exactly once. Add a focused serializer test using verified image snapshots large enough to exceed the old 1 MiB body cap, including a multiple-image case and an over-budget rejection. Exercise the visible attachment interaction in Shinbo before declaring the product behavior verified.

## H5-2: Provider reasoning is lost across tool round trips (P1)

User impact: reasoning models lose their required reasoning/signature state after a tool call. OpenRouter routes that require complete signed or encrypted reasoning can reject the next model call; Z.AI preserved thinking loses continuity despite Shinbo explicitly enabling `clear_thinking:false`. This affects the agent's central multi-step tool workflow.

The same adapter has four related preservation defects:

1. `harness/src/gateway/shinbo_openai.zig:330`: `writeMessage` serializes `reasoning_details` only when `isLoopback(chat_url)` is true. The actual OpenRouter HTTPS endpoint therefore receives no reasoning details even when the history contains them.
2. `harness/src/gateway/shinbo_openai.zig:779`: `captureReasoningDetails` replaces the previous array on every SSE delta. Earlier indexes and fragments vanish.
3. `harness/src/gateway/shinbo_openai.zig:1033`: nonstream `parseCompletion` reads only `reasoning`; it ignores Z.AI's `reasoning_content`, unlike the SSE parser.
4. The same nonstream parser never stores `message.reasoning_details` at all.

Measured A result from three production CLI tool loops, each with two actual HTTP calls and one successful `read_file` tool execution:

| Provider response | Required preserved data | Data in second request |
| --- | --- | --- |
| Nonstream Z.AI-compatible response | One `reasoning_content` string | Missing; 0 of 1 |
| Nonstream structured reasoning | One encrypted reasoning block | Missing; 0 of 1 |
| Two SSE reasoning-detail events | Text at index 0 and encrypted data at index 1 | Only index 1; 1 of 2 |

All three mocks intentionally accepted the faulty second request to capture its exact shape. Exit 0 in these fixtures means the mock accepted it; it does not prove that a real provider accepts missing reasoning. The first omission, production OpenRouter versus loopback serialization, is established by the explicit URL predicate and should receive a focused serializer regression; no real credentialed OpenRouter request was made.

Reproduction: `/private/tmp/shinbo-bug-audit/harness-reasoning-a.py`.
Captured result: `/private/tmp/shinbo-bug-audit/harness-reasoning-a.json`.

Provider contracts were checked against primary documentation:

- [OpenRouter reasoning preservation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens): preserve full structured reasoning, particularly for encrypted/summarized blocks and tool calls.
- [Z.AI preserved thinking](https://docs.z.ai/guides/capabilities/thinking-mode): preserve complete, correctly ordered `reasoning_content` when preserved thinking is enabled.

Minimal repair: preserve the same reasoning fields across both response formats; serialize structured reasoning for the actual supporting provider; accumulate streaming reasoning blocks with correct index/type handling, concatenating textual fragments where the provider emits deltas and preserving opaque signed/encrypted blocks. Reuse any existing accumulation logic already in the gateway client rather than creating a second general abstraction.

Regression and B measurement: the same three CLI fixture cases should retain 1/1, 1/1 and 2/2 fields respectively. Add checks for multiple text fragments at the same index and signed/encrypted blocks, plus actual `https://openrouter.ai/api/v1/chat/completions` serialization without making external network calls. A strict mock should reject incomplete replay so this becomes a functional pass/fail check. Record real-provider validation separately if credentials are available.

## Excluded or lower-priority observations

- Initial suspicion that SSE EOF could execute an unterminated tool call was disproven: `types.classifyProviderCompletion` classifies missing finish as interrupted. Do not count this.
- `allow_acp_mcp=false` is checked in `session/new` but not native `session/load` or `session/resume`. This is relevant to the N-API SDK, whose configuration sets the flag false, but the desktop executable permits ACP MCP by design. Not counted as a desktop P1 without a demonstrated supported product path.
- ACP `session/prompt`, `session/cancel` and `session/set_mode` do not consistently validate the supplied session ID against the active session. The desktop creates a dedicated harness per task, so a normal user trigger was not established; do not count as P1.
- Nonstream `parseCompletion` rejects empty content before reading a `length` or `content_filter` finish reason. This creates format-dependent recovery behavior, but no frequent supported user trigger was established; classify separately as P2 if pursued.
- Nonstream HTTP bodies are bounded only after reading them completely. This is a defensive resource-limit issue without a demonstrated normal-provider user trigger; not included in P1 count.

No B results are claimed: this phase was explicitly audit-only. Full Zig test execution remained owned by the coordinator; no competing complete suite was launched.

## Implemented fixes and measured B results

Both P1 groups are now repaired in `harness/src/gateway/shinbo_openai.zig`. No other harness source file was edited by this investigator. The earlier audit-only statements describe phase A; this section records the subsequently authorized implementation.

H5-1 keeps the 1 MiB limit for text-only requests and allows a bounded 41 MiB for image-bearing requests: eight accepted 5 MiB encoded images plus the original text allowance. Existing attachment validation, normalization and cancellation remain in force. Focused tests exercise two 1,229,883-byte verified snapshots, rejection beyond the image request ceiling, and the unchanged text request ceiling.

H5-2 replays structured reasoning to OpenRouter as well as the local relay. Plaintext reasoning also replays to OpenRouter when structured details are absent. Nonstream completions retain both `reasoning_content` and `reasoning_details`. Streaming text, summary and signature fragments merge using their block indexes and IDs; distinct encrypted blocks remain intact. A malformed or over-limit structured block fails rather than silently replacing preserved reasoning. No new dependency or cross-module abstraction was introduced.

### Identical executable A/B checks

The baseline executable was preserved at `/private/tmp/shinbo-bug-audit/h5-binary-a`. The fixed executable was independently built at `/private/tmp/shinbo-bug-audit/h5-build/bin/shinbo-cli`; neither the normal build output nor its caches were overwritten.

The strict probes use the same fixtures and assertions for A and B, switching only the executable through `HARNESS_BINARY`. Both probes exited 1 with an assertion failure on A and exited 0 on B. They exercise real CLI entry points, actual HTTP requests to localhost and real tool execution. They contain no real credentials.

| Functional measure | A | B |
| --- | --- | --- |
| 30,173-byte PNG | Exit 0; 1 provider call | Exit 0; 1 provider call |
| 1,229,883-byte PNG | Exit 1; 0 provider calls | Exit 0; 1 provider call |
| Two 1,229,883-byte PNG attachments | Exit 1; 0 provider calls | Exit 0; 1 provider call |
| Nonstream Z.AI reasoning preserved | 0/1 string | 1/1 string |
| Nonstream encrypted reasoning preserved | 0/1 block | 1/1 block |
| Streaming reasoning details preserved | 1/2 blocks | 2/2 blocks |

Reasoning probes each complete one `read_file` call and make two provider requests. The assertions inspect the second request, so a successful dummy answer cannot conceal reasoning loss.

Reproduction commands:

```sh
HARNESS_BINARY=/private/tmp/shinbo-bug-audit/h5-binary-a python3 /private/tmp/shinbo-bug-audit/harness-images-b.py
HARNESS_BINARY=/private/tmp/shinbo-bug-audit/h5-binary-a python3 /private/tmp/shinbo-bug-audit/harness-reasoning-b.py
python3 /private/tmp/shinbo-bug-audit/harness-images-b.py
python3 /private/tmp/shinbo-bug-audit/harness-reasoning-b.py
```

The first two commands are expected to fail. Their logs are `h5-strict-images-a.log` and `h5-strict-reasoning-a.log` under `/private/tmp/shinbo-bug-audit`. B logs use the corresponding `-b.log` names. The final structured captures are `harness-images-b.json` and `harness-reasoning-b.json` in the same directory.

Build and focused verification, from `harness`:

```sh
zig build --prefix /private/tmp/shinbo-bug-audit/h5-build --cache-dir /private/tmp/shinbo-bug-audit/h5-build-cache --global-cache-dir /private/tmp/shinbo-bug-audit/h5-global-cache
zig test -fno-stack-check -fno-stack-protector --dep build_options -Mroot=src/main.zig -Mbuild_options=.zig-cache/c/eab1bc09e9289d5dfce7ebed9e27379b/options.zig -lc --cache-dir /private/tmp/shinbo-bug-audit/h5-local-cache --global-cache-dir /private/tmp/shinbo-bug-audit/h5-global-cache --test-filter reasoning --test-filter 'image requests' -femit-bin=/private/tmp/shinbo-bug-audit/h5-provider-tests
zig fmt --check src/gateway/shinbo_openai.zig
```

The build and format check passed. The focused command passed all 34 selected tests, including every newly added regression. New tests cover same-index text and summary reconstruction, signature retention, multiple distinct encrypted blocks, both response formats and serialization for the actual OpenRouter HTTPS URL without external network access. Unit tests use Zig's leak-checking allocator.

Remaining product validation: the actual CLI was launched and exercised successfully, but the desktop attachment interaction, credentialed provider behavior, Windows behavior and exact-commit remote CI remain unverified by this investigator. The coordinator owns the full repository checks and desktop UI verification. No release-readiness claim is made from the focused checks alone.

A final adapter-wide focused run also passed: `python3 /private/tmp/shinbo-bug-audit/h5-test-provider.py` selected every one of this adapter's 42 named tests plus the import-reaching reasoning tests, for 68 passing tests total. This includes localhost streaming, timeout, cancellation, request serialization and completion parsing checks. The log is `/private/tmp/shinbo-bug-audit/h5-all-provider-tests.log`. The script uses the same isolated caches and emits `/private/tmp/shinbo-bug-audit/h5-all-provider-tests`. An exact source diff against the coordinator's saved A tarball is `/private/tmp/shinbo-bug-audit/h5-source.diff` (163 added lines, 11 removed, including regressions; zero source comment lines).
