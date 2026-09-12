# Investigator 2: turn execution, harness routing, cancellation

Initial audit snapshot, 2026-09-12. Existing edits were preserved. Nine consequential findings are supported below; a tenth lower-priority observation is separated rather than counted as urgent. Implementation and measured verification are recorded at the end. No quota was filled with speculative bugs.

The deterministic baseline probe is `/tmp/shinbo-investigator-2-probe.cjs`, run with `node /tmp/shinbo-investigator-2-probe.cjs`. It uses the built desktop modules, the repository's fake ACP agent, and the existing TypeScript AST-lifting test pattern. Baseline output is recorded below. Proposed B measurements are acceptance criteria, not measurements already obtained. App-level verification is still required after fixes.

## I2-01 — P1: agent-to-agent steering always fails

Trigger: a model calls `agents` with `agent` and `message`, or calls `threads message` against an already running thread. Both tools explicitly advertise steering a live turn.

Impact: delegated work cannot receive corrections or follow-up information through the advertised tools. Every such attempt fails, even while the destination is healthy.

Root cause: `AgentRuntime.runAgentsTool` and `messageThread` invoke `this.steer`; `AgentRuntime.steer` in `desktop/main/agent-loop.ts` unconditionally throws. The functional implementation is `steerThread` in `desktop/main/main.ts:404`, which is wired only to UI/mobile entry points. The harness tool definitions in `harness/src/builtins/shinbo/threads.zig` explicitly promise this behavior.

Minimum fix: add an asynchronous steering dependency and route both agent-tool callers through the existing main-process steering implementation. Preserve the failure fallback when the destination is actually gone.

Runnable regression: extend `desktop/test/agent.test.ts` or `runtime-cancellation.test.ts` with two live agents and a recorded steering dependency; run both tool forms and assert delivery once each and an appropriate missing-agent error.

A: 2 attempts, 2 failures. B target: 2 delivered messages, 0 failures. User metric: corrections reach an in-flight worker without requiring manual UI intervention.

## I2-02 — P1: the agents Stop tool does not cancel native work

Trigger: a model uses `agents {agent, stop:true}` while the target harness is streaming or executing a native terminal/file tool.

Impact: the tool claims the target and its descendants stopped, but the provider request and already executing native commands continue. Runtime suppression can hide subsequent output while the work still consumes tokens or changes files. The live row also remains `running` until the harness happens to finish.

Root cause: `runAgentsTool` calls `AgentRuntime.stop`, whose `stopRun` only invokes the `stopped` dependency. The dependency in `desktop/main/main.ts:4260` aborts only `computerRuntime`. Actual harness cancellation exists separately in `stopThread` at `main.ts:386` and is never reached from this tool path. This is distinct from I2-04, which concerns a cancellation race even on the correctly wired UI path.

Minimum fix: route actual harness/child cancellation through the common runtime stopped callback, or add a stop dependency used by the tool. Avoid recursion between `stopThread` and `agents.stop`; preserve descendant cancellation and goal-stop state.

Runnable regression: lift the real stopped callback and combine it with AgentRuntime and a fake harness recording `cancel`/`cancelChild`; invoke the agents stop tool and assert cancellation messages for every affected live run. Follow with a fake process that stops emitting only on cancellation.

A: stop callback called once; runtime reports `isLive=false` but status remains `running`; source callback sends 0 harness cancellations. B target: correct harness cancellation dispatched once per affected run and no work after cancellation acknowledgment.

## I2-03 — P1: child app tools execute with their parent's identity

Trigger: a harness child invokes an app-owned tool such as `goal`, `context`, `cli`, `browser`, or `advisor`; also reproducible after that child has ended while its parent remains live.

Impact: a child acts on the parent's goal/context/browser/CLI ownership and passes the parent's authorization checks. Stopping the child does not prevent a delayed child RPC from executing. Child app tools also stop working after the parent finishes, even if the child is still running.

Root cause: `harness/src/acp/prompt.zig:1096` sets child `tool_call_id` to the child ID. `shinboToolParamsJson` sends it to Electron. `Harness.handleToolRequest` resolves only `sessionId` to the parent and sends every non-computer request to `onToolRequest(parent,...)`. It already maintains a `children` map and special-cases computer restrictions, but does not use child ownership for other tools. `runShinboTool` then reads `harnessTurns` and authorization for that parent. Child turns are never entered into `harnessTurns` by `onChildStart` either, so routing alone is insufficient.

Minimum fix: carry explicit validated child identity on RPC, resolve it to the actual child thread, reject ended/cancelled children, and create the child turn context needed by app tools. Keep computer disallowed for children. This is one root cause; its many affected tools should not be counted as separate bugs.

Runnable regression: use the fake ACP child flow, issue app-tool calls as live/stopped/ended children, assert real child IDs reach execution, stopped calls never execute, and parent state remains unchanged. Assert the parent can still run its own calls.

A: 1 RPC from an ended child executed; execution thread was `parent`, including `goal clear`. B target: 0 ended-child executions; live-child execution receives the child ID.

## I2-04 — P1: Stop during UserPromptSubmit hooks still starts a model request

Trigger: press Stop while a plugin's `UserPromptSubmit` lifecycle hook awaits completion.

Impact: the model starts generating after the user stopped the turn. It consumes tokens and may execute native work despite the displayed stop action.

Root cause: `Harness.runPrompt` in `desktop/main/harness.ts` consumes/checks the cancelled marker before awaiting `lifecycle("UserPromptSubmit",...)`. Cancellation during that await sends `session/cancel` while no prompt is active; after the hook resolves, the code sends `session/prompt` without checking again.

Minimum fix: retain or recheck the cancellation state after the hook immediately before the prompt RPC; do not clear an earlier cancellation before all awaited setup is complete.

Runnable regression: use the existing fake ACP peer with a deferred `onLifecycle`; cancel during UserPromptSubmit, release the hook, and assert rejection plus no subsequent `session/prompt` in the wire log.

A: one `session/prompt` was sent after `session/cancel`. B target: zero post-cancel prompts. This was reproduced with the actual Harness and fake ACP process, not only an extracted function.

## I2-05 — P1: selecting No model chosen keeps the previous paid model

Trigger: run an explicit OpenRouter model in a thread, then select `No model chosen`/fallback and send another message.

Impact: the UI promises the agent's own free route (`desktop/src/App.tsx:3492`), but the existing session retains the previous explicit, potentially paid model. The same stale model can be resumed after a restart.

Root cause: `harnessModel("fallback")` returns undefined; the per-thread harness key remains unchanged for OpenRouter. `Harness.runPrompt` only sends the model config option when `model` is truthy. The durable ACP session model is consequently never reset. Session model selection is persisted in `harness/src/acp/server.zig:1500`.

Minimum fix: explicitly send the ACP-supported empty/default model preference when the selection is fallback. Verify the harness's empty preference validation and default route behavior instead of just clearing the UI setting.

Runnable regression: use a stateful fake ACP peer that holds model configuration. Run paid model then fallback in the same session and assert that the second request uses the default/free route; repeat after session resume.

A: fallback turn sends 0 model-reset config requests after a prior explicit model. B target: one reset and no paid-model selection retained.

## I2-06 — P1: settings changed during a turn never reach later turns on that harness

Trigger: change Zero data retention, provider endpoint, credentials, or vision routing while a harness is busy; wait for completion and send another turn in the same thread/provider.

Impact: later turns continue using old process-environment credentials, endpoints, and privacy settings. In particular, enabling zero retention during a run does not enforce it on subsequent turns, despite the settings UI showing it enabled.

Root cause: `recycleHarnesses` (`desktop/main/main.ts:2276`) skips busy clients and records no invalidation. `harnessClient` subsequently returns any running cached client without checking its route/settings. Callers include credential and zero-retention changes at `main.ts:3255-3263` and providers at `4683-4687`. Harness.start captures the relevant environment only at process launch.

Minimum fix: mark busy harnesses for replacement after settlement, or compare the current configuration on reuse. Preserve the active turn while ensuring the next turn starts with current configuration.

Runnable regression: apply the real recycle function to a busy fake harness, change routing/privacy settings, finish it, and request another harness. Assert old client is closed/replaced and the next spawn sees the updated environment. Confirm an idle client still recycles immediately.

A: 1 stale cached client remains after busy becomes false; 0 closes. B target: 0 stale clients reused on the next turn. No claim about retroactively changing an in-flight provider request.

## I2-07 — P1: concurrent sends bypass the same-thread exclusion guard

Trigger: desktop and mobile send to the same thread concurrently, or two callers submit before asynchronous provider/auth routing resolves.

Impact: both calls enter runOnHarness. The second clears the first turn's text/usage and overwrites turn maps before `AgentRuntime.adopt` throws. This can erase streamed output or make subsequent tools observe the wrong turn content/configuration.

Root cause: `runTurn` (`desktop/main/main.ts:2788`) checks `harnessRuns.has(threadId)` before `await turnRoute(...)`, but does not reserve the thread until `runOnHarness` after that await. `runOnHarness` resets maps and only then adopts the runtime agent, outside its try/finally.

Minimum fix: reserve the thread synchronously for the entire start/settlement interval, before any await, and release in finally. Reuse the existing state if practical; ensure failed setup also releases it. Move destructive initialization after an ownership check.

Runnable regression: lift runTurn as existing tests do, hold two requests on a deferred turnRoute promise, then release both. Assert one runOnHarness invocation, one busy error, and the first turn's state unchanged. Test setup rejection releases the reservation.

A: 2 simultaneous calls produced 2 runOnHarness starts. B target: exactly 1 start, with the other safely rejected.

## I2-08 — consequential P2: unknown context metadata inherits the previous model's window

Trigger: switch a thread from a model with a published context window to one without available metadata, such as a newly added catalog model while metadata has not loaded.

Impact: compaction thresholds use the previous model's larger window, causing preventable context-limit failures, or its smaller window, prematurely discarding history. Model changes reset reasoning and image flags but leave this setting untouched.

Root cause: `Harness.runPrompt` sends context_window only when `extra.contextWindow` is truthy. `handleSetConfigOption` in `harness/src/acp/server.zig:1500-1571` does not clear `session_rt.context_window_tokens` on model change. The value feeds child context experiments in `prompt.zig:1236` and the session runtime.

Minimum fix: define and send an explicit unknown/default reset for context_window on every applicable model change, allowing the harness to resolve its own model default. Confirm zero's semantics before using it.

Runnable regression: stateful fake ACP configuration tracks a known 200000-token window, then switches models with absent metadata; assert the old override is cleared and the new model default applies.

A: subsequent unknown-metadata model sends 0 context-window reset requests. B target: stale override removed, verified against harness runtime behavior.

## I2-09 — P1: transient resume errors silently replace conversation history

Trigger: session/resume fails for a reason other than a genuinely missing session, such as transient MCP attachment or session-access failure.

Impact: Shinbo deletes the durable thread-to-session link and starts an empty agent session. The UI still shows the conversation, but the model no longer has it; the old on-disk session is orphaned from the thread.

Root cause: `Harness.activeSession` in `desktop/main/harness.ts:728` catches every resume error, deletes the mapping, persists that deletion, and creates a new session. It makes no distinction between missing session and retriable failure. There is no transcript replay into the fresh session in runOnHarness.

Minimum fix: create a new session only for a specific missing/unrecoverable-session response with explicit recovery behavior. Preserve the mapping and surface/retry transient resume failures. Preserve structured ACP error codes as needed for classification.

Runnable regression: inject a transient resume rejection for an existing valuable session; assert rejection and unchanged session index, then verify a later retry resumes it. Separately test the truly missing-session recovery behavior.

A: transient error produced `empty-session`; previous session mapping was not preserved. B target: valuable mapping survives and no fresh session is created for transient failures.

## Additional observation, not included in the urgent count

I2-10: `Harness.handleToolRequest` catches app tool exceptions and returns `{result:{output:errorText}}`; `harness/src/tools/shinbo/bridge.zig` interprets every output as success. A failed write/denied operation is marked completed in the tool trace. Probe confirms `Write failed` returns a JSON-RPC success result. Use a structured failed result or error response if fixing, while retaining actionable failure text for the model. This is real but has weaker urgency because the model can read the error text; do not inflate it to P1 solely to meet the requested count.

## Implemented fixes and measured B results

Implemented I2-01 through I2-07 and I2-09: eight root causes in this initial wave. I2-08 and I2-10 were subsequently fixed as P2 findings M1/M2 in [round 6](bug-audit-round-6-models.md), with separate before/after evidence. Also integrated investigator 3's capacity preflight before provider/model work. No published performance-speedup claim is made: these measurements count prevented failures and correctly delivered actions.

| Finding | Before A | After B | User impact |
| --- | --- | --- | --- |
| I2-01 | 2/2 live steering attempts failed | Both tool forms deliver; 0 stopped-target or unrelated bench-target deliveries | Corrections reach workers already running |
| I2-02 | 0 native cancellations from the runtime callback | 2 cancellations for the parent/child fixture | Stop reaches the work that is actually running |
| I2-03 | An ended child's app RPC executed as its parent | Live child executes as child; ended, stopped, unknown, malformed and unattributed child calls are rejected | Child cancellation and thread ownership remain enforced |
| I2-04 | 1 prompt RPC sent after cancellation during a hook | 0 prompt RPCs after the same cancellation | Stop prevents new model work and spend |
| I2-05 | 0 reset requests; prior explicit model persisted | Empty reset sent on fallback and resume; real ACP changed paid selection back to its free default | Fallback no longer silently retains a paid model |
| I2-06 | 1 stale busy client remained reusable after settings changes | Old client closed once and replaced; new endpoint/key received by next client | Later turns use current routing/privacy configuration |
| I2-07 | 2 same-thread model-run starts | 1 start, second rejected; reservation released after setup failure | Concurrent sends cannot replace another turn's state |
| I2-09 | Transient failure replaced the valuable session mapping | Transient failure preserves it; genuine missing session still recovers | Conversation context survives transient resume problems |
| I3-05 integration | Full-thread fixture reached provider/model work once | 0 provider routes and 0 model starts | A conversation-capacity error is reported before paid work |

`desktop/test/runtime-controls.test.ts` contains 11 regression cases covering these eight runtime causes and the capacity integration. The identical compiled test was run against the saved pre-fix `agent-loop.ts`/`harness.ts` and the pre-fix main source from `/private/tmp/shinbo-bug-audit/source-before.tgz`: **0 passed, 11 failed, 0 cancelled**. Corrected sources pass all 11. The larger focused suite with existing agent, harness, runtime cancellation and turn admission checks passed **160/160** before the final additional bench-isolation assertions; the final targeted rerun passed **47/47** including those assertions.

Evidence:

- A log: `/private/tmp/shinbo-runtime-before/results.log`.
- B focused log: `/private/tmp/shinbo-runtime-fixes/focused-b.log`.
- Final routing/bench regression log: `/private/tmp/shinbo-runtime-fixes/final-regressions-b.log`.
- Built main/test output: `/private/tmp/shinbo-runtime-fixes`; TypeScript compiled there without touching shared dist output. Relevant ESLint checks passed.
- Zig build output: `/private/tmp/shinbo-runtime-harness/bin/shinbo-cli`. The unique-prefix build passed. Focused Zig tests passed **14/14**, including explicit child RPC ownership and distinguishing missing sessions from access failures.
- Real native ACP run: `/private/tmp/shinbo-runtime-acp.py`, output `/private/tmp/shinbo-runtime-fixes/acp-model-reset.json`. It initialized the freshly built process, selected `audit/paid-model`, then reset to `nvidia/nemotron-3-super-120b-a12b:free`. Process exit was 0 and stderr was empty. No remote model request or paid API call was used.

Implementation notes needed for verification: child app RPCs now carry explicit `childId`; the desktop records/removes each child's app-tool turn context and rejects stopped/ended children. A child may read the parent's goal but cannot mutate it. Re-enabled steering preserves measured-replay isolation. Busy harnesses invalidated by changed settings are retained only for ongoing work; a new turn waits for remaining work to finish before creating its replacement. The ACP empty-model config resolves to `state.configured_model` before normal validation and durable commit. Session-load failures report missing only for actual missing-file/session errors.

Native GUI interactions, complete integrated checks, platform checks and sibling-repository documentation are coordinated by the root agent; this report does not claim those were verified by this investigator.
