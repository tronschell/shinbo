# Runtime performance follow-up — 2026-09-12

## New P1: ChatGPT streaming ignores local consumer backpressure

`main.ts:turnRoute` routes ChatGPT plan models through `chatgptRoute`; `Harness.start` passes that local URL to the harness using `SHINBO_PROVIDER_CHAT_URL`. The relay reads the provider response and translates its events into the harness's chat-completion stream. Previously every `ServerResponse.write` result was ignored. When the harness stops reading or is slow, Electron continues consuming the provider and queues the translated output in its HTTP response. Long text, reasoning, and tool-argument streams can therefore consume memory proportional to the remaining response and spend main-process CPU translating output the consumer cannot currently receive. Multiple slow runs compound it. This is P1 because the provider relay shares Electron's main process with the whole application; the failure requires a slow/stalled caller and sustained output, rather than affecting every ordinary short turn.

The fix uses Node's `once(response, "drain", { signal })` after any streaming write returning false. The existing downstream-close abort signal also cancels a pending drain wait. The same helper covers liveness, content, tool arguments, failure endings, and DONE. No protocol, model selection, feature, or dependency changed. This is separate from original audit item 20: that fix cancelled disconnected callers; connected slow callers remained unbounded.

## Paired A/B

Both runs execute the actual `chatgpt.ts` source, transpiled with the installed TypeScript compiler, through the local HTTP route. Provider fetch is mocked; temporary fake credentials are isolated with HOME/USERPROFILE. A deterministic sink returns false from its first write and withholds drain. A WHATWG stream offers 1,000 ordered chunks, each carrying a 1,024-character delta. The sink records the output bytes the relay asks it to queue. Two event-loop turns allow the old implementation to consume all available chunks before measurement.

| Metric before drain | Archived round2 source | Fixed source |
| --- | ---: | ---: |
| Upstream chunks produced | 1,000 | 2 |
| Output bytes queued by relay | 1,229,014 | 3 |

The fixed two chunks are the current chunk and one `ReadableStream` prefetched chunk. The three queued bytes are the initial liveness heartbeat. This is a deterministic work/buffering metric, not measured RSS, wall-clock speedup, network throughput, or a claim that arbitrary provider chunk sizes are capped at three bytes. Native socket buffering has its own high-water mark; the test controls the blocked sink to make the causal comparison repeatable.

Exact commands, from the repository root:

```sh
SHINBO_PERF_SOURCE=/tmp/shinbo-perf-round2/tree/desktop/main/chatgpt.ts SHINBO_PERF_MEASURE=1 node --test --test-name-pattern='handles drain' desktop/test/chatgpt-backpressure.test.mjs
SHINBO_PERF_MEASURE=1 node --test --test-name-pattern='handles drain' desktop/test/chatgpt-backpressure.test.mjs
```

The first command produced `{"mode":"drain","produced":1000,"queuedBytes":1229014}`. The second produced `{"mode":"drain","produced":2,"queuedBytes":3}`. Measurement mode reports rather than enforcing the fixed bound so the same workload runs against both sources.

## Regression checks

```sh
desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --noEmit
desktop/node_modules/.bin/eslint desktop/main/chatgpt.ts desktop/test/chatgpt-backpressure.test.mjs
desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-runtime-round2-check
node --test /tmp/shinbo-runtime-round2-check/test/chatgpt.test.js desktop/test/chatgpt-backpressure.test.mjs
```

All passed: 20 tests. The three new cases verify the bounded read/queue counts, all 1,000 ordered deltas and DONE after drain, upstream abortion on downstream disconnect/error during a drain wait, and zero retained drain listeners. Each case reported exactly one upstream abort. Existing tests cover authorization parsing, text/tool/reasoning conversion, incomplete/error results, buffered non-streaming completion, prompt retention and cache headers.

The local HTTP tests required execution outside the filesystem sandbox because binding 127.0.0.1 initially returned EPERM. No real provider request was made. This worker did not launch the real application; root integration owns the required app exercise and full repository checks. Live provider buffering, OS-specific socket behavior, and provider billing cancellation remain unmeasured. No shortcut, privacy permission, VoiceOver, display geometry, signing, or non-macOS UI path was exercised here.
