import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { asPermissionMode, DEFAULT_PERMISSION_MODE } from "../shared/permissions";
import { CODEX_MODEL_ID, CODEX_PREFIX, isThinkingLevel } from "../shared/settings";
import { packVariables, parseVariables, parseWorkflow, runWorkflow } from "../shared/workflow";

const source = ts.createSourceFile("main.ts", readFileSync(path.join(process.cwd(), "main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const lift = (name: string) => source.statements.find((node) =>
  ts.isFunctionDeclaration(node) ? node.name?.text === name : ts.isVariableStatement(node) && node.declarationList.declarations.some((one) => one.name.getText(source) === name))!.getText(source);
let getter = "";
function findGetter(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "ipcMain.handle" && node.arguments[0]?.getText(source) === '"shinbo:get-thread-context"') getter = node.getText(source);
  ts.forEachChild(node, findGetter);
}
findGetter(source);
const program = ts.transpileModule([
  ...["threadContextsFile", "loadThreadContexts", "rememberThreadContext", "threadContext", "threadModel", "threadEffort", "threadContextRequest", "keepThreadContext", "subagentRoute", "thinkingLevel", "selectModel", "answerRequest", "runTurn", "driveTurn", "runScheduledWorkflow"].map(lift),
  `${getter};`,
  "({ loadThreadContexts, rememberThreadContext, threadContextRequest, keepThreadContext, selectModel, answerRequest, runTurn, runScheduledWorkflow });",
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type Selection = { model: string; effort: string };
type Context = Selection & { folderIds: string[]; mode: string };
type Turn = { threadId: string; model?: string; effort?: string };
function setup(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "shinbo-thread-model-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const threadContexts = new Map<string, Context>();
  let getContext: (event: unknown, value: unknown) => Selection;
  const frame = {};
  const sender = { mainFrame: frame };
  const event = { sender, senderFrame: frame };
  const state = {
    app: { getPath: () => dir }, path, readFileSync, writeFileSync, renameSync, rmSync, randomUUID, threadContexts, AbortController, workflowRuns: new Map(), runtimeReady: Promise.resolve(),
    asPermissionMode, DEFAULT_PERMISSION_MODE, isThinkingLevel, MAX_AGENT_STEP_LIMIT: 10_000,
    selectedModel: "openrouter:alpha", selectedEffort: "high",
    CODEX_PREFIX, CODEX_MODEL_ID,
    chatgptAuth: async () => ({}), catalogued: (id: string) => {
      if (!["alpha", "beta"].includes(id)) throw new Error("Unknown model");
      return id;
    },
    routedModelKey: (key: string) => key,
    ipcMain: { handle: (_name: string, handler: typeof getContext) => { getContext = handler; } },
    overlay: { webContents: sender },
    mainWindowSender: () => { throw new Error("Untrusted sender"); },
    boundedCapabilityId: (id: unknown) => {
      if (typeof id !== "string" || !id || id.length > 128) throw new Error("Invalid thread");
      return id;
    },
    host: { request: async (_request: unknown): Promise<unknown> => ({ id: "new" }) },
    inheritBench: () => false, stopThread: () => undefined,
    harnessRuns: new Map(), pendingTurns: new Set(), goalStopped: new Set(), agents: { forget: () => undefined, isLive: () => false, list: () => [] },
    threadSubagent: () => undefined, threadStepLimit: () => undefined,
    recordUse: () => undefined, modelKey: (key: string) => key, modelName: (key: string) => key,
    activeGoal: () => undefined, harnessCwd: () => dir, turnRoute: async () => undefined,
    harnessKey: () => "key", harnessClient: () => ({}),
    withGoal: (turn: Turn) => turn, withTrialArm: (turn: Turn) => turn,
    runOnHarness: async (_client: unknown, _cwd: string, turn: Turn) => turn,
    changed: () => undefined, refuseBenchTurn: () => undefined, benchThread: () => undefined,
    threadNames: new Map(), runDrivenTurn: async (turn: Turn): Promise<unknown> => turn,
    parseWorkflow, parseVariables, runWorkflow, packVariables,
    resolveMentions: async (content: string) => ({ content }), lastAssistantMessage: () => "done",
  };
  const api = runInNewContext(program, state) as {
    loadThreadContexts(): void;
    rememberThreadContext(id: string, context: Context): void;
    threadContextRequest(value: unknown): { threadId: string } & Context;
    keepThreadContext(id: string, context: Context): void;
    selectModel(method: string, params: Record<string, string>): Promise<unknown>;
    answerRequest(method: string, params?: Record<string, string>): Promise<unknown>;
    runTurn(turn: Turn): Promise<Turn>;
    runScheduledWorkflow(job: Record<string, unknown>): Promise<void>;
  };
  state.runDrivenTurn = api.runTurn;
  return { api, state, get: (threadId: string) => { const { model, effort } = getContext(event, { threadId }); return { model, effort }; }, fullContext: (threadId: string) => getContext(event, { threadId }), rawGet: (value: unknown) => getContext(event, value), foreignGet: () => getContext({ sender, senderFrame: {} }, { threadId: "new" }) };
}

test("creation snapshots selection before awaiting the host and restores it after restart", async (t) => {
  const { api, state, get } = setup(t);
  let resolve!: (value: unknown) => void;
  state.host.request = () => new Promise((done) => { resolve = done; });
  const creating = api.answerRequest("createThread");
  state.selectedModel = "openrouter:beta";
  state.selectedEffort = "low";
  resolve({ id: "new" });
  await creating;
  assert.deepEqual(get("new"), { model: "openrouter:alpha", effort: "high" });
  state.threadContexts.clear();
  api.loadThreadContexts();
  assert.deepEqual(get("new"), { model: "openrouter:alpha", effort: "high" });
  assert.equal(state.selectedModel, "openrouter:beta");
});

test("thread model updates support every route and leave global and other threads alone", async (t) => {
  const { api, state, get } = setup(t);
  await api.answerRequest("createThread");
  for (const [modelId, model] of [["beta", "openrouter:beta"], ["openrouter:beta", "openrouter:beta"], ["provider:p", "provider:p"], ["router:r", "router:r"], ["codex:gpt-5", "codex:gpt-5"], ["", "fallback"], ["fallback", "fallback"]]) {
    await api.selectModel("setThreadModel", { threadId: "other", modelId, effort: "low" });
    assert.deepEqual(get("other"), { model, effort: "low" });
    assert.deepEqual(get("new"), { model: "openrouter:alpha", effort: "high" });
    assert.equal(state.selectedModel, "openrouter:alpha");
  }
  await assert.rejects(api.selectModel("setThreadModel", { threadId: "other", modelId: "codex:bad model" }));
  await assert.rejects(api.selectModel("setThreadModel", { threadId: "other", modelId: "unknown" }));
});

test("default and empty effort remain pinned across later global changes and turns", async (t) => {
  const { api, state, get } = setup(t);
  state.selectedModel = "";
  state.selectedEffort = "";
  await api.answerRequest("createThread");
  state.selectedModel = "provider:p";
  state.selectedEffort = "high";
  await api.runTurn({ threadId: "new" });
  assert.deepEqual(get("new"), { model: "fallback", effort: "" });
  await api.selectModel("setThreadModel", { threadId: "new", modelId: "provider:p", effort: "" });
  const turn = await api.runTurn({ threadId: "new", model: "provider:p" });
  assert.equal(turn.effort, "");
  await api.runTurn({ threadId: "new", model: "openrouter:beta", effort: "low" });
  state.threadContexts.clear();
  api.loadThreadContexts();
  assert.deepEqual(get("new"), { model: "openrouter:beta", effort: "low" });
});

test("workflow graph pins its assigned model before async work and visiting cannot change it", async (t) => {
  const { api, state, get } = setup(t);
  await api.answerRequest("createThread");
  const models: string[] = [];
  state.resolveMentions = async (content) => {
    assert.deepEqual(get("workflow"), { model: "openrouter:beta", effort: "" });
    get("new");
    state.selectedModel = "provider:elsewhere";
    return { content };
  };
  state.runOnHarness = async (_client, _cwd, turn) => {
    models.push(turn.model!);
    return turn;
  };
  await api.runScheduledWorkflow({ threadId: "workflow", jobId: "job", title: "Workflow", permissionMode: "default", model: "openrouter:beta", variables: "", depth: 0, prompt: "", nodes: JSON.stringify([{ id: "a", kind: "agent", text: "first" }, { id: "b", kind: "agent", text: "second" }]) });
  assert.deepEqual(models, ["openrouter:beta", "openrouter:beta"]);
  assert.deepEqual(get("new"), { model: "openrouter:alpha", effort: "high" });
  state.threadContexts.clear();
  api.loadThreadContexts();
  assert.deepEqual(get("workflow"), { model: "openrouter:beta", effort: "" });
});

test("child creation inherits its parent's durable context instead of unrelated global selection", async (t) => {
  const { api, state, get } = setup(t);
  api.rememberThreadContext("parent", { folderIds: ["folder"], mode: "acceptEdits", model: "router:r", effort: "low" });
  await api.answerRequest("createThread", { parentThreadId: "parent" });
  assert.deepEqual(get("new"), { model: "router:r", effort: "low" });
  assert.equal(state.threadContexts.get("new")?.folderIds[0], "folder");
  assert.equal(state.selectedModel, "openrouter:alpha");
});

test("visiting a thread or editing folders preserves its model and effort", async (t) => {
  const { api, get } = setup(t);
  await api.selectModel("setThreadModel", { threadId: "workflow", modelId: "openrouter:beta", effort: "low" });
  const { threadId, ...context } = api.threadContextRequest({ threadId: "workflow", folderIds: ["folder"], mode: "auto", review: true });
  api.keepThreadContext(threadId, context);
  assert.deepEqual(get("workflow"), { model: "openrouter:beta", effort: "low" });
  assert.throws(() => api.threadContextRequest({ threadId: "workflow", model: 42 }));
});

test("a refused overlapping turn cannot replace the saved selection", async (t) => {
  const { api, state, get } = setup(t);
  await api.answerRequest("createThread");
  state.harnessRuns.set("new", {});
  await assert.rejects(api.runTurn({ threadId: "new", model: "openrouter:beta" }), /still running/);
  assert.deepEqual(get("new"), { model: "openrouter:alpha", effort: "high" });
});

test("legacy threads pin the workspace default once and the getter rejects invalid callers", (t) => {
  const { state, get, rawGet, foreignGet } = setup(t);
  assert.deepEqual(get("legacy"), { model: "openrouter:alpha", effort: "high" });
  state.selectedModel = "openrouter:beta";
  assert.deepEqual(get("legacy"), { model: "openrouter:alpha", effort: "high" });
  assert.equal(state.threadContexts.size, 1);
  for (const value of [null, {}, { threadId: 1 }, { threadId: "" }]) assert.throws(() => rawGet(value));
  assert.throws(foreignGet, /Untrusted sender/);
});


test("native task context reads preserve remote folders and permission choices", (t) => {
  const { state, fullContext } = setup(t);
  const held = { folderIds: ["remote-project"], mode: "ask", model: "openrouter:alpha", effort: "high", review: true };
  state.threadContexts.set("remote-task", held);
  assert.deepEqual(JSON.parse(JSON.stringify(fullContext("remote-task"))), held);
  assert.equal(state.threadContexts.get("remote-task"), held);
});
