import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { goalDrivesAgain, goalPursuing, goalTokensLeft, type Goal } from "../shared/goal";
import { recordedTurn } from "../main/ndjson";

const source = ts.createSourceFile("main.ts", readFileSync(process.env.SHINBO_LIFECYCLE_SOURCE ?? path.join(process.cwd(), "main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);

function lifted(name: string, globals: Record<string, unknown>) {
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name);
  return runInNewContext(ts.transpileModule(`(${node.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}

function callback(name: string, globals: Record<string, unknown>) {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, name);
  return runInNewContext(ts.transpileModule(`(${found.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}

function harnessRecord(globals: Record<string, unknown>) {
  const recordTurn = lifted("recordTurn", globals);
  return source.statements.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === "recordHarnessTurn")
    ? lifted("recordHarnessTurn", { ...globals, recordTurn }) : recordTurn;
}

const goal = (extra: Partial<Goal> = {}): Goal => ({ objective: "Finish fixture", status: "active", evidence: "", blockedReason: "", blockedStreak: 0, blockedAtTurn: 0, tokenBudget: 40000, tokensUsed: 0, timeUsedSeconds: 0, turns: 0, createdAt: "2026-09-12T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z", ...extra });

test("R6-G1 Resume does not drive an exhausted or forty-turn goal", async () => {
  for (const current of [goal({ tokensUsed: 40000 }), goal({ turns: 40 }), goal()]) {
    let starts = 0;
    const update = lifted("updateGoal", {
      isGoalStatus: () => true, wholeGoalNumber: () => undefined, boundedGoalText: () => "",
      MAX_GOAL_EVIDENCE_CHARS: 4000, MAX_GOAL_REASON_CHARS: 1000,
      goalRequest: async () => ({ id: "task", goal: current }), goalStopped: new Set(), agents: { forget() {} },
      goals: new Map([["task", current]]), goalPursuing, goalDrivesAgain, goalHalted: () => false,
      driveTurn: async () => { starts++; }, GOAL_CONTINUATION: "Continue", threadMode: () => "ask", threadModel: () => "fixture",
    });
    await update({ threadId: "task", status: "active" });
    assert.equal(starts, current.turns >= 40 || current.tokensUsed >= current.tokenBudget ? 0 : 1);
  }
});

test("R6-G2 a multistep turn persists the usage total used by its live budget guard", async () => {
  const turnSpend = new Map();
  const noteTurnSpend = lifted("noteTurnSpend", { turnSpend });
  const current = goal();
  const stopped: string[] = [];
  const onUsage = callback("onUsage", { turnSpend, noteTurnSpend, harnessUsage: new Map(), agents: { noteUsage() {} }, goals: new Map([["task", current]]), goalPursuing, goalTokensLeft, noteGoalOverspent: (id: string) => stopped.push(id) });
  onUsage("task", { inputTokens: 10000, outputTokens: 200 });
  onUsage("task", { inputTokens: 20000, outputTokens: 500 });
  current.status = "complete";
  onUsage("task", { inputTokens: 5000, outputTokens: 600 });
  const requests: { params: Record<string, string> }[] = [];
  const record = harnessRecord({ turnSpend, recordedTurn, goals: new Map([["task", current]]), goalPursuing, host: { request: async (request: { params: Record<string, string> }) => { requests.push(request); } } });
  await record({ threadId: "task", prompt: "Work", answer: "Finished", inputTokens: "5000", outputTokens: "600", durationMilliseconds: "1000", model: "fixture" });
  const params = requests[0].params;
  assert.equal(Number(params.goalTokens ?? Number(params.inputTokens) + Number(params.outputTokens)), 35600);
  assert.equal(params.inputTokens, "5000");
  assert.deepEqual(stopped, []);
  turnSpend.delete("task");
  current.status = "active";
  current.tokensUsed = 35600;
  onUsage("task", { inputTokens: 5000, outputTokens: 100 });
  assert.deepEqual(stopped, ["task"]);
});

test("R6-G3 a completed goal counts its settling turn but excludes later conversation", async () => {
  const turnSpend = new Map();
  const current = goal();
  const goalRequest = lifted("goalRequest", {
    turnSpend, goalPursuing, harnessTurns: new Map([["task", {}]]), changed() {},
    host: { request: async () => ({ id: "task", goal: current }) }, noteThread: (thread: unknown) => thread,
  });
  await goalRequest("setGoal", { threadId: "task" });
  current.status = "complete";
  await goalRequest("updateGoal", { threadId: "task" });
  const requests: { params: Record<string, string> }[] = [];
  const record = harnessRecord({ turnSpend, goals: new Map([["task", current]]), goalPursuing, recordedTurn, host: { request: async (request: { params: Record<string, string> }) => { requests.push(request); } } });
  const turn = { threadId: "task", prompt: "Work", answer: "Finished", inputTokens: "100", outputTokens: "0", durationMilliseconds: "1000", model: "fixture" };
  await record(turn);
  assert.equal(requests[0].params.goalTurn ?? "true", "true");
  turnSpend.delete("task");
  await record({ ...turn, prompt: "Explain another topic", inputTokens: "500" });
  assert.equal(requests[1].params.goalTurn ?? "true", "false");
});

test("R6-G2 integration isolates concurrent council spend from the harness counter", async () => {
  const requests: { params: Record<string, string> }[] = [];
  const turnSpend = new Map([["task", { output: 500, total: 20000 }]]);
  const globals = { turnSpend, goals: new Map([["task", goal()]]), goalPursuing, recordedTurn, host: { request: async (request: { params: Record<string, string> }) => { requests.push(request); } } };
  const recordTurn = lifted("recordTurn", globals);
  const land = callback("land", { recordTurn, turnSpend, noteThread: (thread: unknown) => thread, councilAnswer: () => "Council answer", changed() {} });
  await land({ threadId: "task", question: "Review the plan", startedAt: Date.now(), seats: [{}, {}], voices: [{ inputTokens: 200, outputTokens: 100, microDollars: 0 }] });
  await harnessRecord(globals)({ threadId: "task", prompt: "Work", answer: "Progress", inputTokens: "1000", outputTokens: "500", durationMilliseconds: "1000", model: "fixture" });
  const charged = requests.map(({ params }) => Number(params.goalTokens ?? Number(params.inputTokens) + Number(params.outputTokens)));
  assert.deepEqual(charged, [300, 20000]);
  assert.equal(charged.reduce((total, tokens) => total + tokens, 0), 20300);
});

test("goal guard observes committed council spend without stopping unrelated conversation", async () => {
  for (const [spent, participating, expectedStops] of [[900, true, 1], [1100, true, 1], [1100, false, 0]] as const) {
    const goals = new Map([["task", goal({ tokenBudget: 1000 })]]);
    const turnSpend = new Map(participating ? [["task", { output: 0, total: 100 }]] : []);
    const stopped: string[] = [];
    const globals = { goals, turnSpend, goalPursuing, goalTokensLeft, noteGoalOverspent: (id: string) => { stopped.push(id); goals.get(id)!.status = "budgetLimited"; } };
    const updated = goal({ tokenBudget: 1000, tokensUsed: spent, status: spent >= 1000 ? "budgetLimited" : "active" });
    const land = callback("land", {
      ...globals, noteThread: lifted("noteThread", { goals }), changed() {}, councilAnswer: () => "Council answer",
      recordTurn: async () => ({ id: "task", goal: updated }),
    });
    await land({ threadId: "task", question: "Plan", startedAt: Date.now(), seats: [{}, {}], voices: [{ inputTokens: spent, outputTokens: 0, microDollars: 0 }] });
    callback("onUsage", { ...globals, harnessUsage: new Map(), agents: { noteUsage() {} }, noteTurnSpend: lifted("noteTurnSpend", { turnSpend }) })("task", { inputTokens: 200, outputTokens: 0 });
    assert.equal(goals.get("task")!.tokensUsed, spent);
    assert.equal(stopped.length, expectedStops);
  }
});
