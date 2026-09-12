# Cancellation of ranked web search

One P1 finding: the shared `web_search` tool continued network work after the user stopped its owning turn. `stopThread` calls `AgentRuntime.stop`, which aborts that run's controller; `runShinboTool` checks run ownership before invoking `executeTool`. But the web-search branch did not pass the existing signal, and `web-search.ts` used only an independent 20-second request timeout. A stopped search could keep its current request alive and then start the alternate fourget endpoint and subsequent ranked providers.

The sole production `webSearch` caller now forwards its existing run signal. Search requests combine that signal with the unchanged provider timeout through `AbortSignal.any`. Cancellation is checked before cached work, after awaited results, and before both levels of fallback handling. The original cancellation reason escapes instead of becoming a provider failure or rate-limit notice. Ordinary network failures and provider timeouts still follow the configured fallback order; existing cache, limits and credentials behavior remain intact. No dependencies or protocol changes were added.

## Actual-source A/B

`desktop/test/web-search-cancel.test.mjs` transpiles the actual web-search module and supplies a deterministic Electron `net.fetch` fixture. The first provider request stays pending, the owning run is aborted, and the fixture then releases the old request as a simulated timeout. Remaining mocked providers fail immediately. The configured sequence is a primary fourget endpoint, its existing alternate endpoint, and ranked SearXNG.

| Metric | Before | After |
| --- | ---: | ---: |
| Active request's signal aborted when Stop fires | false | true |
| Total provider requests | 3 | 1 |
| New fallback requests after Stop | 2 | 0 |

This measures cancelled work and request count, not elapsed provider latency. The unchanged timeout is 20 seconds per request, so a real failing three-endpoint chain has up to three independent timeout waits; no measured 60-second speedup is claimed. Preventing abandoned provider requests avoids unnecessary quota use and retained in-flight work during repeated stop/retry flows. No external provider was contacted.

Pre-edit source is saved under `/tmp/shinbo-perf-cancel-runtime/before/`. The baseline regression intentionally fails its cancellation assertion:

```sh
SHINBO_SEARCH_CANCEL_SOURCE=/tmp/shinbo-perf-cancel-runtime/before/web-search.ts node --test --test-name-pattern='active search' desktop/test/web-search-cancel.test.mjs > /tmp/shinbo-perf-cancel-runtime/before.txt
node --test --test-name-pattern='active search' desktop/test/web-search-cancel.test.mjs > /tmp/shinbo-perf-cancel-runtime/after.txt
```

## Verification

Six new tests cover the active request, an already-aborted cached or uncached search, abort during JSON/body reading, abort during the alternate fourget request, ordinary timeout fallback, and the actual `executeTool` caller's signal identity. All have a two-second test timeout so a regression cannot stall the suite for the production request timeout. Eight existing web-search tests preserve ranking, provider shape, credentials, caching and rate-limit behavior.

```sh
desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-cancel-runtime/after
node --test /tmp/shinbo-perf-cancel-runtime/after/test/web-search.test.js desktop/test/web-search-cancel.test.mjs > /tmp/shinbo-perf-cancel-runtime/focused.txt
desktop/node_modules/.bin/eslint desktop/main/web-search.ts desktop/main/main.ts desktop/test/web-search-cancel.test.mjs
```

All 14 focused tests, TypeScript and targeted ESLint passed. The test uses compiled unchanged dependencies in `desktop/dist-main`; a fresh checkout must build main first. The temporary output has a `node_modules` symlink to the desktop dependencies. Root integration owns the full-suite and real-app Stop verification. Native Electron network cancellation on Windows was not exercised by this worker.

## Bounded audit coverage

- The shared provider transport in `verifier.ts` already combines caller cancellation with its timeout. Advisor, permission approval and vision paths already propagate the live run signal. No duplicate fix was made there.
- `semantic-grep.ts`'s embedding proxy already aborts upstream fetch on downstream close and aborts again during final cleanup. Semantic indexing is separately owned project background work, stopped when its feature/model changes; a turn's Stop is not its ownership boundary. The zvec installer has its own cancellation controller propagated into downloads and extraction checks.
- Harness cancellation sends ACP `session/cancel`, marks permission checks cancelled and sweeps active tool calls. Harness close has a bounded grace period. The audit did not replace these paths or count them again.
- Native computer helper requests already use the computer run's signal. Its pacing wait is short and bounded; no new urgent finding was established there.
- Browser command capture has a 60-second process timeout but no per-turn signal. Its external `agent-browser` client/daemon ownership and cancellation semantics need an actual native fixture before a safe change; killing the client alone may not cancel work already sent to the daemon. This remains an unverified candidate, not a fixed finding.
- The later foreground-tool integration below covers the secret command and its reader model using the shared cancellation work owned by the workspace worker. Atomic persistence remains excluded from cancellation changes.

## Real app Stop check

The coordinator configured the isolated production Electron app with a disposable loopback provider and a single loopback SearXNG endpoint. Through the real composer and Zig harness, the model selected `web_search`, opened the held local request, and the coordinator clicked Stop. The app displayed “You stopped this run.” The local server immediately recorded `search-aborted` for that app request, before its 19-second fixture completion, and no later search/provider fallback started. The request lived 9,715 ms before the user action; that number is not cancellation latency. Events are in `/tmp/shinbo-stop-fixture/events.jsonl` (app request IDs5–7; earlier `protocol-probe` entries are separate self-checks). No external service or account was used.


## Foreground secret-tool integration

This is an integration extension of the shared foreground command cancellation finding (61), not an additional counted performance root. The secret tool is foreground work owned by the same agent run: it first awaits `runCommand`, then sends that command's bounded output to `readSecret`. The existing run authorization check occurs before `executeTool`, and the secret case had passed no cancellation signal to either phase. A stopped command could continue, and a deferred command result could begin a new reader request after Stop.

The secret case now captures the existing run signal before awaiting anything, passes it to the shared command runner's fourth argument, and forwards the same captured signal into `readSecret`. The reader accepts an optional final signal argument, checks it before model/credential setup, forwards it to the existing `chatCompletion` transport, and checks it after awaiting the answer. The transport already combines cancellation with its timeout; it was reused unchanged. An obsolete late answer cannot publish even if a test reader ignores cancellation. Output clipping, response wording, unconfigured-model handling for live calls, and ordinary provider/empty-response errors remain unchanged. There is no reader cache or atomic write in this path.

The actual-source deferred command fixture and shared-transport fetch fixture show:

| Metric | Before | After |
| --- | ---: | ---: |
| Command receives its owning run signal | false | true |
| Reader requests started after Stop during command preparation | 1 | 0 |
| Active reader fetch aborted when Stop fires | false | true |

The command fixture deliberately resolves fake output after cancellation to test the phase boundary, even though the shared runner normally rejects on abort. It executes the actual secret switch branch from `main.ts` and the actual `secret.ts` module. The provider fixture uses the real compiled `chatCompletion` with an injected fetch; no provider account, real credential or secret file is read. These are cancellation/reference operation metrics, not wall-clock or process-kill latency claims.

```sh
SHINBO_SECRET_MAIN_SOURCE=/tmp/shinbo-secret-cancel/before/main.ts SHINBO_SECRET_CANCEL_SOURCE=/tmp/shinbo-secret-cancel/before/secret.ts node --test --test-name-pattern='foreground secret|shared reader fetch' desktop/test/secret-cancellation.test.mjs > /tmp/shinbo-secret-cancel/before.txt
node --test desktop/test/secret-cancellation.test.mjs > /tmp/shinbo-secret-cancel/after.txt
desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-secret-cancel/after
node --test /tmp/shinbo-secret-cancel/after/test/secret.test.js desktop/test/secret-cancellation.test.mjs > /tmp/shinbo-secret-cancel/focused.txt
desktop/node_modules/.bin/eslint desktop/main/secret.ts desktop/main/main.ts desktop/test/secret-cancellation.test.mjs
```

The before command intentionally fails both cancellation assertions. Six new two-second-bounded regressions plus four existing secret tests passed, as did TypeScript and targeted ESLint. They cover cancellation before setup, during command output, during fetch and JSON/body reading, and after a late reader settles; ordinary errors and 32,000-character clipping are also checked. The workspace worker owns shared runner process termination and the Windows exited-child guard. No native Windows or real-app secret-tool execution is claimed by this worker.
