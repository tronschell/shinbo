import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { runWorkflowScript } from "../main/workflow-script";
import { asPermissionMode } from "../shared/permissions";
import { packVariables, parseVariables, parseWorkflow, runWorkflow } from "../shared/workflow";

const source = ts.createSourceFile("main.ts", readFileSync(path.join(process.cwd(), "main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
function lifted(name: string, scope: Record<string, unknown>) {
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration);
  return runInNewContext(ts.transpile(`${declaration.getText(source)}\n${name};`, { target: ts.ScriptTarget.ES2022 }), Object.assign(scope, { Error }));
}

test("T1 a failed permission save reports failure and preserves the last durable context", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "shinbo-context-failure-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "thread-contexts.json");
  const full = { folderIds: [], mode: "full", model: "fallback" };
  const threadContexts = new Map([["task", full]]);
  writeFileSync(file, JSON.stringify(Object.fromEntries(threadContexts)));
  const remember = lifted("rememberThreadContext", {
    threadContexts, threadContextsFile: () => file, randomUUID, renameSync, rmSync,
    writeFileSync: () => { throw new Error("ENOSPC: no space left on device"); },
  });
  assert.throws(() => remember("task", { ...full, mode: "ask" }), /ENOSPC/);
  assert.equal(threadContexts.get("task")?.mode, "full");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).task.mode, "full");
});

function workflow() {
  const requests: { method: string; params?: Record<string, unknown> }[] = [];
  const notices: Record<string, unknown>[] = [];
  const workflowRuns = new Map<string, AbortController>();
  const scope = {
    runtimeReady: Promise.resolve<string | undefined>(undefined),
    selectedModel: "fallback", selectedEffort: "", asPermissionMode, parseWorkflow, parseVariables, runWorkflow, packVariables,
    workflowRuns, AbortController, goalStopped: new Set<string>(), computerRuntime: undefined,
    harnessChildren: new Map(), harnesses: new Map(), benchThread: () => false,
    threadContext: () => ({ folderIds: [] }), rememberThreadContext: () => undefined,
    resolveMentions: async (content: string) => ({ content }), lastAssistantMessage: () => "done",
    runWorkflowScript, workflowScriptRoots: () => [tmpdir()],
    driveTurn: async (_turn: unknown) => {}, agents: { list: () => [], adopt: () => {}, noteActivity: () => {}, finish: () => {} },
    recordTurn: async (turn: Record<string, unknown>) => { notices.push(turn); },
    host: { request: async (request: typeof requests[number]) => { requests.push(request); } }, changed: () => {},
  };
  const stop = lifted("cancelThreadWork", scope);
  return { scope, stop, requests, notices, run: () => lifted("runScheduledWorkflow", scope) };
}

const job = (nodes: unknown[]) => ({ jobId: "job", threadId: "task", title: "Scheduled", prompt: "", nodes: JSON.stringify(nodes), variables: "", permissionMode: "full", model: "fallback", depth: 0 });

test("T2 Stop during a workflow turn prevents later nodes and completion chaining", async () => {
  const held = workflow();
  let turns = 0;
  held.scope.driveTurn = async () => { turns++; held.stop("task"); };
  await held.run()(job([{ id: "one", kind: "agent", text: "first" }, { id: "two", kind: "agent", text: "second" }]));
  assert.equal(turns, 1);
  assert.equal(held.requests.filter((request) => request.method === "finishScheduledJob").length, 0);
  assert.equal(held.scope.workflowRuns.size, 0);
});

test("T3 a failed script stops the workflow and records its error instead of chaining success", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "shinbo-workflow-failure-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "fail.cjs");
  writeFileSync(file, "process.stderr.write('database unavailable'); process.exitCode = 7;");
  const held = workflow();
  let turns = 0;
  held.scope.driveTurn = async () => { turns++; };
  await held.run()(job([{ id: "one", kind: "script", text: file }, { id: "two", kind: "agent", text: "publish {{last}}" }]));
  assert.equal(turns, 0);
  assert.equal(held.requests.filter((request) => request.method === "finishScheduledJob").length, 0);
  assert.match(String(held.notices[0]?.notice), /database unavailable/);
});

test("T2 a running script responds to Stop before performing its delayed side effect", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "shinbo-workflow-stop-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "wait.cjs");
  writeFileSync(file, "setTimeout(() => process.stdout.write('published'), 250);");
  const controller = new AbortController();
  const run = (runWorkflowScript as (file: string, input: string, roots: string[], signal?: AbortSignal) => Promise<string>)(file, "", [directory], controller.signal);
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(run, /stopped|abort/i);
});

test("T4 scheduled work waits for settings restoration and uses the restored model", async () => {
  const held = workflow();
  let ready!: (error?: string) => void;
  held.scope.runtimeReady = new Promise((resolve) => { ready = resolve; });
  const models: string[] = [];
  held.scope.driveTurn = async (turn) => { models.push((turn as { model: string }).model); };
  const run = held.run()({ ...job([{ id: "one", kind: "agent", text: "private task" }]), model: "" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const before = models.length;
  held.scope.selectedModel = "provider:local";
  ready();
  await run;
  assert.equal(before, 0);
  assert.deepEqual(models, ["provider:local"]);
});

test("T5 a deleted pinned provider cannot start a turn on the fallback provider", async () => {
  const providerRoute = lifted("providerRoute", { providerFor: () => undefined });
  let starts = 0;
  const run = lifted("runTurn", {
    pendingTurns: new Set(), harnessRuns: new Map(), agents: { forget() {}, isLive: () => false }, goalStopped: new Set(),
    host: { request: async () => undefined }, threadSubagent() {}, threadModel: () => "provider:removed", threadContext: () => ({ model: "provider:removed" }),
    rememberThreadContext() {}, threadStepLimit() {}, recordUse() {}, app: { getPath: () => "/tmp" }, modelKey: (value: string) => value,
    modelName: (value: string) => value, activeGoal() {}, harnessCwd: () => "/tmp", harnessKey: () => "key",
    turnRoute: async (key: string) => providerRoute(key), runOnHarness: async () => { starts++; }, harnessClient() {},
    withGoal: (value: unknown) => value, withTrialArm: (value: unknown) => value, changed() {},
  });
  await assert.rejects(run({ threadId: "task", title: "Private task", content: "Local data", mode: "ask", model: "provider:removed" }), /provider.*not set up/i);
  assert.equal(starts, 0);
});

test("T4 initialization failures remain visible and successful restoration allows later jobs", async () => {
  const held = workflow();
  let turns = 0;
  held.scope.driveTurn = async () => { turns++; };
  held.scope.runtimeReady = Promise.resolve("Settings could not be loaded");
  const run = held.run();
  await run(job([{ id: "one", kind: "agent", text: "private task" }]));
  assert.equal(turns, 0);
  assert.match(String(held.notices[0]?.notice), /Settings could not be loaded/);
  held.scope.runtimeReady = Promise.resolve(undefined);
  await run(job([{ id: "one", kind: "agent", text: "private task" }]));
  assert.equal(turns, 1);
});
