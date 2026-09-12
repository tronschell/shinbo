# Model transition and tool result reliability

This bounded wave fixes one P1 root and two previously documented P2 findings. Measurements count incorrect routing, stale configuration and status delivery; they are not performance claims. All provider work used local fake responses and temporary profiles.

| ID | Severity | Trigger and user impact | Before | After |
| --- | --- | --- | --- | --- |
| M1 / I2-08 | P2 | Switch an existing conversation from a model with a known context limit to one whose limit is unknown. The harness retains the old limit and uses another model's compaction budget. | Two prompts send only the first `context_window=200000`; no reset. | Two prompts send `200000` then `0`, restoring the harness's unknown-window behavior. |
| M2 / I2-10 | P2 | An app-owned tool throws, such as a failed memory write. The trace labels the failed operation completed, making recovery and user inspection misleading. | Failure reply has no failure flag; the native bridge treats its diagnostic as successful output. | Reply has `isError: true`; a real ACP run emits one failed tool update and preserves the exact diagnostic in the next model request. |
| M3 | P1 | Change the task model while a goal turn or reviewer is running. Automatic continuation reuses the original model and subagent snapshot, overwrites the saved choice and can continue spending on the provider the user just left. | Goal: 2 old-provider starts, 0 chosen-provider starts. Review revision: 1 old, 0 chosen. Both persist the old model again. | Goal: 0 old, 2 chosen. Review revision: 0 old, 1 chosen. Both retain the chosen model and effort. |

## M1: clear stale model metadata

`Harness.runPrompt` previously sent context-window configuration only for truthy metadata. Sessions are reused across model selection, so an unknown next model inherited a known previous limit. It now always sends the current value, using zero for unknown. The existing native handler accepts zero; the harness's existing session and compaction code treats it as unknown/default rather than inheriting another model's override.

The regression drives two real desktop Harness prompts through the fake ACP process and examines outbound configuration. The native interaction additionally accepts both 200000 and zero. This establishes metadata clearing, not a measured reduction in provider context-limit errors.

Changed boundary: `desktop/main/harness.ts`. Regression: `desktop/test/harness.test.ts`, test beginning `M1 switching to a model`.

## M2: retain app-tool failure status and diagnostic

`Harness.handleToolRequest` caught exceptions and put the message in an ordinary result. `tools/shinbo/bridge.zig` wrapped every such output in `ToolResult.success`. Error text remained readable, which limits this finding to P2, but the native tool trace reported success.

The desktop now includes a boolean failure flag. The narrow native responder returns the existing `ToolResult` union, preserving the diagnostic as failure output. Missing flags remain successful for compatibility with older result envelopes, and malformed flags are rejected. The `_model_context` consumer checks failure before parsing its JSON. This is an internal desktop-to-harness boundary; it adds no phone bridge method or field.

Changed paths: `desktop/main/harness.ts`, `harness/src/acp/prompt.zig`, `harness/src/core/tooling/tool_dispatch.zig`, `harness/src/tools/shinbo/bridge.zig`, `harness/FORK.md`. Regressions: the M2 desktop harness test and native `Shinbo app tool failures preserve their diagnostic and failed status` test.

A freshly built native binary was also driven over ACP against a temporary localhost model server. The model requested the memory tool, the fixture returned `ENOSPC: memory could not be written` with its failure flag, and the harness completed the next model request. Results: 1 app-tool call, 2 model requests, 1 failed tool update, exact diagnostic present in the second model request, `end_turn`, process exit 0, empty stderr. No actual memory write or paid request occurred.

## M3: resolve current task settings for automatic follow-up

Both `continueGoal` and `reviewWork` copied `model` and `subagent` from the original turn into later `driveTurn` requests. `runTurn` then preferred these fields to durable task context and persisted the old model again. Desktop model selection remains usable while a turn is running, and the phone's existing model-selection request also updates that context; this is an ordinary supported transition.

The two callers now omit those stale overrides. The shared `runTurn` boundary resolves current model, effort and subagent settings. Current permission mode, folder and step limit already resolve at continuation time and remain covered. Goal objective, original user prompt, revision content and review markers are preserved. The separate review child's explicit reviewer model remains intentional and unchanged.

The regression invokes the actual extracted `selectModel`, `runTurn`, `continueGoal` and `reviewWork` functions. The review fixture selects the new model during the awaited reviewer call. Both paths assert chosen model/effort, current helper model, current permission mode, current folder and current step limit. It also verifies that the original request content remains intact.

Changed paths: four deleted forwarding lines in `desktop/main/main.ts`; new `desktop/test/model-continuation.test.ts`.

## Evidence and checks

Before snapshots are in `/private/tmp/shinbo-models-round6-before`. The M1/M2 failing run is `/private/tmp/shinbo-models-round6-a/results.log` (0/2 pass). The M3 failing run is `/private/tmp/shinbo-models-round6-a-goal/results.log` (0/2 pass).

The final focused desktop run is `/private/tmp/shinbo-models-round6-b/final-results.log`: 109 tests pass, zero fail. TypeScript compilation and scoped ESLint pass. An initial isolated run had two fixture path failures because existing goal tests expect source relative to the output tree; linking the source directory into the temporary tree resolves that environmental issue without changing source tests.

Commands, from `desktop`:

```sh
./node_modules/.bin/tsc -p tsconfig.main.json --outDir /private/tmp/shinbo-models-round6-b/dist-main
NODE_PATH="$PWD/node_modules" node --test /private/tmp/shinbo-models-round6-b/dist-main/test/model-continuation.test.js /private/tmp/shinbo-models-round6-b/dist-main/test/goal.test.js /private/tmp/shinbo-models-round6-b/dist-main/test/review.test.js /private/tmp/shinbo-models-round6-b/dist-main/test/thread-model-main.test.js /private/tmp/shinbo-models-round6-b/dist-main/test/runtime-controls.test.js /private/tmp/shinbo-models-round6-b/dist-main/test/harness.test.js
./node_modules/.bin/eslint main/main.ts main/harness.ts test/harness.test.ts test/model-continuation.test.ts --max-warnings 0
```

The native build used an isolated prefix and cache. Fourteen selected native tests passed, including the new output-envelope parser test; the bridge test declarations are not all imported into this filtered root, so the real ACP interaction supplies the end-to-end bridge check.

Commands, from `harness`:

```sh
zig build --prefix /private/tmp/shinbo-models-round6-harness --cache-dir /private/tmp/shinbo-models-round6-zig-cache --global-cache-dir /private/tmp/shinbo-runtime-zig-global
zig test -lc --dep build_options -Mroot=src/main.zig -Mbuild_options=/private/tmp/shinbo-models-round6-zig-cache/c/eab1bc09e9289d5dfce7ebed9e27379b/options.zig --test-filter 'Shinbo app tool' --test-filter 'a tool called outside Shinbo' --test-filter 'arguments reach the client untouched' --cache-dir /private/tmp/shinbo-models-round6-zig-cache --global-cache-dir /private/tmp/shinbo-runtime-zig-global
python3 /private/tmp/shinbo-models-round6-acp.py
```

Native interaction evidence is `/private/tmp/shinbo-models-round6-b/acp-results.json`. Root owns integrated checks and real desktop interaction verification. This wave does not claim GUI, Windows, signing, privacy-permission or accessibility verification.
