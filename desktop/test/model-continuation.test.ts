import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { type TurnRequest } from "../main/agent-loop";

const source = ts.createSourceFile("main.ts", readFileSync(path.join(process.cwd(), "main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const lift = (name: string) => {
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node);
  return node.getText(source);
};

for (const continuation of ["goal", "review"] as const) test(`M3 automatic ${continuation} turns honor settings selected after the original turn began`, async (t) => {
  const contexts = new Map<string, { mode: string; model: string; effort: string; folderIds: string[]; subagent?: { model: string; effort: string } }>([["task", { mode: "ask", model: "provider:paid", effort: "high", folderIds: ["current-folder"], subagent: { model: "current-helper", effort: "low" } }]]);
  const starts: TurnRequest[] = [];
  const directories: string[] = [];
  const scope = {
    pendingTurns: new Set(), harnessRuns: new Map(), agents: { forget() {}, isLive: () => false, mode: () => "ask" }, goalStopped: new Set(), goalDriving: new Set(),
    host: { request: async () => undefined }, threadSubagent: (id: string) => contexts.get(id)?.subagent,
    threadModel: (id: string) => contexts.get(id)?.model, threadContexts: contexts, threadContext: (id: string) => contexts.get(id),
    rememberThreadContext: (id: string, context: NonNullable<ReturnType<typeof contexts.get>>) => contexts.set(id, context),
    threadStepLimit: () => 7, recordUse() {}, app: { getPath: () => "/tmp" }, modelKey: (value: string) => value,
    modelName: (value: string) => value, activeGoal() {}, harnessCwd: (id: string) => contexts.get(id)!.folderIds[0], harnessKey: () => "key",
    turnRoute: async () => undefined, runOnHarness: async (_client: unknown, _cwd: string, turn: TurnRequest) => { starts.push(turn); directories.push(_cwd); return { archivedAt: starts.length === 2 ? "done" : null }; }, harnessClient() {},
    withGoal: (value: unknown) => value, withTrialArm: (value: unknown) => value, changed() {},
    selectedModel: "fallback", selectedEffort: "", CODEX_PREFIX: "codex:", routedModelKey: (key: string) => key, thinkingLevel: (value: string) => value,
    noteThread: (value: unknown) => value, goals: new Map([["task", { objective: "Finish the work" }]]), goalHalted: () => false,
    goalDrivesAgain: () => starts.length < 2, GOAL_CONTINUATION: "Continue toward the goal.",
    reviewing: new Set(), MAX_REVIEW_ROUNDS: 1, lastAssistantMessage: () => "Response", reviewHalted: () => false,
    runReview: async () => { await api.selectModel("setThreadModel", { threadId: "task", modelId: "provider:free", effort: "low" }); return "Revise the response"; },
    reviewVerdict: () => "revise", revisionPrompt: () => "Revise the response", reviewSettings: { model: "reviewer" },
  };
  const api = runInNewContext(ts.transpile(`${["selectModel", "runTurn", "continueGoal", "reviewWork"].map(lift).join("\n")}\nconst driveTurn = runTurn; ({ selectModel, continueGoal, reviewWork });`, { target: ts.ScriptTarget.ES2022 }), scope);
  const original = { threadId: "task", title: "Goal", content: "Original request", mode: "full", model: "provider:paid", subagent: { model: "old-helper", effort: "high" } };
  if (continuation === "goal") {
    await api.selectModel("setThreadModel", { threadId: "task", modelId: "provider:free", effort: "low" });
    await api.continueGoal(original, undefined);
  } else await api.reviewWork(original, undefined);
  t.diagnostic(`oldModelStarts=${starts.filter((turn) => turn.model === "provider:paid").length}; chosenModelStarts=${starts.filter((turn) => turn.model === "provider:free").length}; persisted=${contexts.get("task")?.model}`);
  const count = continuation === "goal" ? 2 : 1;
  assert.deepEqual(starts.map((turn) => turn.model), Array(count).fill("provider:free"));
  assert.deepEqual(starts.map((turn) => turn.effort), Array(count).fill("low"));
  assert.deepEqual(starts.map((turn) => turn.mode), Array(count).fill("ask"));
  assert.deepEqual(starts.map((turn) => turn.subagent?.model), Array(count).fill("current-helper"));
  assert.deepEqual(starts.map((turn) => turn.stepLimit), Array(count).fill(7));
  assert.deepEqual(directories, Array(count).fill("current-folder"));
  assert.equal(original.content, "Original request");
  assert.equal(contexts.get("task")?.model, "provider:free");
});
