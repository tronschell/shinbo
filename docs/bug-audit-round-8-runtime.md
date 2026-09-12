# Buffered ChatGPT completion reliability

One P2 root was confirmed and fixed. The live-turn Clear follow-up remains grouped under R7-4 in the previous report and adds no finding count.

## R8-1: interrupted buffered responses manufacture successful completion

The ChatGPT relay converts Responses SSE into Chat Completions. Its buffered assembler initialized `finish_reason` to `stop`, so upstream EOF after a partial text delta produced HTTP 200 with an invented successful finish. The real localhost fixture reproduced this with `Partial summary`, without any terminal event.

This is distinct from H3-2's auxiliary-caller checks. The native gateway compaction summarizer builds a request with `stream:false` and validates its returned completion. When routed through the ChatGPT endpoint, the manufactured `stop` makes that partial summary pass an otherwise correct classifier. This can replace context with an unfinished summary. Ordinary streaming main turns already reject a missing terminal reason through the native provider classifier; no new streaming failure root is claimed.

The buffered assembler now requires an observed finish reason. Assembly occurs before sending the HTTP 200 headers, allowing the existing error boundary to return HTTP 502 with an actionable message. Explicit successful completion and explicit output-length termination preserve their existing `stop` and `length` results.

| Measurement | Before | After |
| --- | --- | --- |
| Abrupt EOF after a text delta | HTTP 200, `finish_reason: stop` | HTTP 502, no fabricated completion |
| Explicit `response.completed` | Valid successful control | HTTP 200, `stop` |
| Explicit max-output termination | Valid length control | HTTP 200, `length` |

Changed source: `desktop/main/chatgpt.ts`. Regression: `R8-1 an upstream EOF cannot become a successful buffered completion` in `desktop/test/chatgpt.test.ts`. No native provider parser, compaction policy or external API contract was changed.

The isolated regression uses a temporary fake account, the actual localhost relay and a stubbed upstream fetch. It performs three requests to compare missing, completed and length endings. It makes no external provider calls. This directly verifies the relay contract; the resulting compaction effect is traced through the existing native caller/classifier rather than claimed as a separately measured compaction run.

Before snapshot: `/private/tmp/shinbo-runtime-round8-before/chatgpt.ts`. A log: `/private/tmp/shinbo-runtime-round8-a/results.log` (0/1). B log: `/private/tmp/shinbo-runtime-round8-b/relay-results.log` (30/30 including existing account, relay cancellation and backpressure checks).

The combined focused suite also passes 96 core/session/credential/profile tests and one bridge-clear test, for 127/127 tests in the round-8 verification. Main TypeScript compilation and scoped ESLint pass. The renderer TypeScript check passed in round 7 and renderer source did not change afterward. No new GUI behavior was introduced by R8-1; root owns full integrated and desktop verification.

Commands from `desktop`:

```sh
./node_modules/.bin/tsc -p tsconfig.main.json --outDir /private/tmp/shinbo-runtime-round8-b/dist-main
NODE_PATH="$PWD/node_modules" node --test /private/tmp/shinbo-runtime-round8-b/dist-main/test/chatgpt.test.js /private/tmp/shinbo-runtime-round8-b/dist-main/test/runtime-performance.test.js test/chatgpt-backpressure.test.mjs
NODE_PATH="$PWD/node_modules" node --test /private/tmp/shinbo-runtime-round8-b/dist-main/test/session-clear.test.js /private/tmp/shinbo-runtime-round8-b/dist-main/test/credentials.test.js /private/tmp/shinbo-runtime-round8-b/dist-main/test/harness.test.js /private/tmp/shinbo-runtime-round8-b/dist-main/test/runtime-controls.test.js /private/tmp/shinbo-runtime-round8-b/dist-main/test/profile.test.js
NODE_PATH="$PWD/node_modules" node --test --test-name-pattern='clearThreadContext' /private/tmp/shinbo-runtime-round8-b/dist-main/test/bridge.test.js
./node_modules/.bin/eslint main/chatgpt.ts main/harness.ts test/chatgpt.test.ts test/harness.test.ts --max-warnings 0
```
