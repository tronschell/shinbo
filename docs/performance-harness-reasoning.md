# Harness structured reasoning performance audit

One additional P1 issue, independent of the desktop/Rust findings. This is a bounded audit of the actual native provider path, not a claim that all Zig hot paths are exhausted.

## 1. Structured reasoning streaming repeatedly processes the complete accumulated history

**Priority: P1 for long reasoning turns.** OpenRouter is the default native provider, and structured `reasoning.text` / `reasoning.summary` deltas are explicitly supported and replayed on subsequent requests. A 256 KiB reasoning result is within the 4 MiB structured-response cap and the 1 MiB ordinary request cap. With 4,096 small updates, the old implementation revisited 536,739,840 bytes of preceding text, before counting JSON parsing and serialization. This adds growing synchronous processing delays in the provider stream reader and unnecessary processor work throughout long thinking turns. Ordinary short responses do not receive the same absolute improvement.

**Reachable call chain:** `builtins/gateway.zig:agent_stream_provider` → `gateway/shinbo_openai.zig:stream` → HTTP SSE reader → `SseSink.consume` → `captureReasoningDetails` → `SseSink.finish` → `GatewayCompletion.reasoning_details_json` → assistant message replay in `writeMessage`.

Previously, each delta parsed the saved JSON, copied the accumulated text into concatenated strings, serialized the whole merged array, and freed the previous JSON. The replacement holds ordered JSON fields in owned buffers. Text, summary, and signature fields append only the incoming encoded string contents. Other fields retain their replacement semantics. Final JSON is written once into an exactly sized buffer. The existing block matching rules, field order, encrypted blocks, null/empty behavior, escaping, metadata replacement, and exact serialized-size limit are retained. No provider, tool, ACP, or mobile schema changed.

## Paired measurement

Fixture: the real `SseSink.consume` receives 4,096 OpenAI-compatible JSON deltas, each with one indexed `reasoning.text` fragment containing 64 ASCII bytes, followed by a completed answer. Timing includes delta parsing, merge processing, and `finish`; it excludes fixture construction and post-timing output verification. Both variants use Zig 0.16.0, ReleaseFast and `std.heap.c_allocator`, the allocator selected by the libc-linked native entrypoint. These are local elapsed-processing measurements, not model/network latency or promises for other machines.

| Measurement | Before | After |
| --- | ---: | ---: |
| Run 1 | 1,391.648 ms | 4.672 ms |
| Run 2 | 1,383.019 ms | 4.064 ms |
| Run 3 | 1,304.306 ms | 4.313 ms |
| Run 4 | 1,211.540 ms | 4.002 ms |
| Run 5 | 1,390.135 ms | 4.353 ms |
| Median | **1,383.019 ms** | **4.313 ms** |
| Completed JSON bytes | 262,191 | 262,191 |

Median processing time decreased 99.69% (about 321×). The new allocation-count regression measures 3,179,506 cumulative allocated bytes for the accumulator plus its final output, excluding incoming JSON parsing. It enforces a generous 8 MiB ceiling; the old history-copy work alone is approximately 512 MiB. These are distinct metrics, not a claim that copied bytes equal allocated bytes.

An earlier exploratory pair used `page_allocator` (median 1,328.264 → 54.781 ms). The table above is the allocator-matched native pair; the exploratory pair is not added as another finding.

## Reproduction and baseline

Exact pre-edit production file: `/tmp/shinbo-perf-harness-reasoning-before/shinbo_openai.zig`. It includes all preexisting dirty changes. The before benchmark source tree is `/tmp/shinbo-reasoning-benchmark-before/src`, with that exact production implementation and the same benchmark fixture appended. No checkout reset or commit was used.

From `harness/`, the exact paired commands were:

```sh
zig test -O ReleaseFast -lc --global-cache-dir /tmp/shinbo-zig-global-cache --dep build_options -Mroot=/tmp/shinbo-reasoning-benchmark-before/src/reasoning_perf_test.zig -Mbuild_options=/Users/tronschell/Documents/shinbo/harness/.zig-cache/c/956eebb97bfa598e73956c17f18eed0f/options.zig --test-filter 'structured reasoning performance fixture'
zig test -O ReleaseFast -lc --global-cache-dir /tmp/shinbo-zig-global-cache --dep build_options -Mroot=src/reasoning_perf_test.zig -Mbuild_options=.zig-cache/c/956eebb97bfa598e73956c17f18eed0f/options.zig --test-filter 'structured reasoning performance fixture'
zig test -O ReleaseFast src/gateway/reasoning_details.zig --global-cache-dir /tmp/shinbo-zig-global-cache --test-filter 'append allocation'
```

The focused entrypoint also runs without generated build options: `zig test -O ReleaseFast -lc src/reasoning_perf_test.zig --global-cache-dir /tmp/shinbo-zig-global-cache --test-filter 'structured reasoning performance fixture'`.

Raw timing logs are `/tmp/shinbo-reasoning-before-c-allocator.txt` and `/tmp/shinbo-reasoning-after-c-allocator.txt`. The benchmark executes only in ReleaseFast; normal debug suites skip it. `src/reasoning_perf_test.zig` is a small focused test entrypoint, not part of the production executable.

## Verification

- A temporary differential fixture compares the old and new implementations after each of 1,408 mixed deltas (11 starting orders × 128 updates), including null/empty input, indexed/unindexed blocks, IDs, signatures, metadata and encrypted blocks. Every intermediate serialized output matches exactly. Reproducer: `zig test -lc --global-cache-dir /tmp/shinbo-zig-global-cache /tmp/shinbo-reasoning-benchmark-before/src/reasoning_perf_test.zig --test-filter 'reasoning differential baseline output'`.
- Four new accumulator regressions pass, including exact fragmented output through every allocation failure, supplementary Unicode/escaping, signatures, opaque encrypted data, nested metadata replacement, null versus empty arrays, exact size boundaries, invalid inputs, noninteger indices and cumulative allocation growth.
- Focused native reasoning suite: 14 passed, one benchmark skipped in Debug. Existing completion-to-wire replay tests pass.
- `zig fmt --check` passes for the three touched Zig files.
- `zig build test --global-cache-dir /tmp/shinbo-zig-global-cache` passes when local socket/process fixtures are permitted (exit zero; `/tmp/shinbo-reasoning-zig-test-unrestricted.txt`). The initial sandboxed run reached 8,495/8,580 passing tests, with 37 skipped, 47 failures and one crash; its output primarily reports restricted socket/process fixtures and also a presentation assertion. The unrestricted rerun resolves those failures.
- Freshly built `harness/zig-out/bin/shinbo-cli ask --json --no-save` was run against a local HTTP SSE provider with all 4,096 reasoning deltas. It issued one provider request, returned `reasoning-stream-ok`, exited zero and produced no stderr. The temporary workspace was removed. Reproducer: `python3 /tmp/shinbo-reasoning-live.py`; result files: `/tmp/shinbo-reasoning-live-stdout.json`, `/tmp/shinbo-reasoning-live-stderr.txt`. Local listening required sandbox escalation and succeeded. No external model or account was called.
- Remote CI, non-macOS execution and the Electron visual path were not exercised by this bounded harness pass.

## Ownership and bounded coverage

Owned changes: the new `ReasoningDetails` import and SseSink field/deinit/capture/finish substitutions in `src/gateway/shinbo_openai.zig`, its appended benchmark, new `src/gateway/reasoning_details.zig`, new `src/reasoning_perf_test.zig`, and this report. All other preexisting or concurrent changes remain untouched.

Also inspected the shared `SseEventReader`, native content/reasoning/tool-argument accumulation, tool-fragment lookup, ACP JSON-string/output framing, assistant-stream callbacks, request conversation serialization, and the host-stream reader. Native content and tool argument buffers already append through amortized ArrayLists. Tool-call lookup is capped at 16 calls. No additional high-priority claim is made for the other inspected paths without a supported measured workload.

## Bounded followup: no additional measured P1

A second pass traced the other requested boundaries and ran five-repeat ReleaseFast/c_allocator probes against a temporary copy of the actual current source. These are observed current costs, not invented before/after improvements. They exclude provider/network delays and OS pipe backpressure.

| Actual function path | Smaller fixture, median | Larger fixture, median |
| --- | ---: | ---: |
| `SseSink.consume` + `finish`, content | 1,024 × 64-byte deltas: 0.528 ms | 4,095 × 64-byte deltas: 2.023 ms |
| `SseSink.consume` + `finish`, tool arguments | 1,024 × 64-byte deltas: 0.792 ms | 4,095 × 64-byte deltas: 2.883 ms |
| Native provider `build`, alternating user/assistant messages | 128 × 1 KiB, 135,196 wire bytes: 0.083 ms | 768 × 1 KiB, 810,716 wire bytes: 0.429 ms |
| ACP `writeJsonStr` + `Writer.writeNotification` | 64 KiB: 0.088 ms | 1 MiB: 0.903 ms |
| `prepareModelOutput`, sanitize + mask + cap | 64 KiB input, 64 KiB cap: 1.043 ms | 1 MiB input, 64 KiB cap: 16.444 ms |

The content and tool fixtures finish inside the 256 KiB content/argument cap; tool arguments include a valid JSON string wrapper. Request fixtures remain below the 1 MiB ordinary request cap. ACP serialization uses its real callback transport to count and validate completed NDJSON frames, excluding kernel I/O; the framing path performs one output write under its mutex. The 1 MiB ACP frame remains below the reader's 8 MiB resource boundary. Tool fixtures are printable output without secrets; they exercise the actual whole-output sanitization/redaction scan and the 64 KiB final cap. These measurements do not certify all text patterns or all possible tools.

Source inspection agrees with the observed scaling: SSE uses amortized byte buffers; tool calls are capped at 16; conversation serialization writes each message once; ACP appends raw params once; UTF-8 truncation checks the cut boundary rather than rescanning the full result. Tool output redaction intentionally precedes truncation, and the managed-result branch also preserves sanitized/redacted full output. No redaction, retention, cap, protocol or tool behavior was changed to improve these probe numbers.

Reproducer:

```sh
zig test -O ReleaseFast -lc --global-cache-dir /tmp/shinbo-zig-global-cache /tmp/shinbo-harness-bounded-probes/src/reasoning_perf_test.zig --test-filter 'bounded harness hot path probes'
```

Fixture implementation is appended only to `/tmp/shinbo-harness-bounded-probes/src/gateway/shinbo_openai.zig`; raw log is `/tmp/shinbo-harness-bounded-probes.txt`. The temporary probe does not enter the repository's production or regression code. No further production edit was justified by this bounded followup.
