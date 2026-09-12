import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { AgentRuntime, type LoopDeps, type TurnRequest } from "../main/agent-loop";
import { Harness, type HarnessDeps } from "../main/harness";

const source = ts.createSourceFile("main.ts", readFileSync(path.join(process.cwd(), "main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const turn: TurnRequest = { threadId: "parent", title: "Audit", content: "Read the files", mode: "full" };

function compiled(code: string, globals: Record<string, unknown>) {
  return runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}

function lifted(name: string, globals: Record<string, unknown>) {
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name);
  return compiled(node.getText(source), globals);
}

function callback(name: string, globals: Record<string, unknown>) {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, name);
  return compiled(found.getText(source), globals);
}

function runtime(deps: Partial<LoopDeps> = {}) {
  return new AgentRuntime({
    request: async () => ({ threads: [{ id: "target", title: "Target" }] }), ask() {}, answered() {},
    verify: async () => ({ model: "", prompt: "", reply: "", attempts: 0 }), advise: async () => ({ model: "", text: "" }),
    spawnTurn() {}, changed() {}, step() {}, ...deps,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(extra: Partial<HarnessDeps> = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "shinbo-runtime-control-"));
  const messages: { method?: string; params?: Record<string, unknown> }[] = [];
  const client = new Harness({
    binaryPath: process.execPath, args: [path.join(process.cwd(), "test/fake-acp-agent.mjs")], home, cwd: tmpdir(),
    mcpServers: async () => [], onDelta() {}, onThought() {}, onToolCall() {}, onUsage() {}, onPlan() {},
    onCompacted() {}, onContextExperiment() {}, onRoutedModel() {}, onContextBreakdown() {},
    onChildStart: async () => "child-thread", onChildEnd() {}, onToolRequest: async () => "ok", onPermission: async () => "allow_once",
    onLog: (line) => { if (line.flow === "out") messages.push(JSON.parse(line.body)); }, ...extra,
  });
  return { client, home, messages, dispose: async () => { await client.close(); rmSync(home, { recursive: true, force: true }); } };
}

test("I2-01 both live-agent messaging tools deliver through the steering dependency", async () => {
  const sent: { threadId: string; text: string }[] = [];
  const agents = runtime({ steer: async (threadId, text) => { sent.push({ threadId, text }); } });
  agents.adopt(turn);
  agents.adopt({ ...turn, threadId: "target" });
  await agents.runThreadTool({ name: "agents", agent: "target", message: "First correction", stop: false }, turn);
  await agents.runThreadTool({ name: "threads", action: "message", thread: "target", prompt: "Second correction", limit: 20 }, turn);
  assert.deepEqual(sent, [{ threadId: "target", text: "First correction" }, { threadId: "target", text: "Second correction" }]);
  await assert.rejects(agents.runThreadTool({ name: "agents", agent: "target", message: "Bench correction", stop: false }, { ...turn, bench: true }), /replay/);
  await assert.rejects(agents.runThreadTool({ name: "threads", action: "message", thread: "target", prompt: "Bench correction", limit: 20 }, { ...turn, bench: true }), /replay/);
  assert.equal(sent.length, 2);
  agents.stop("target");
  assert.throws(() => agents.steer("target", "Too late"), /no longer running/);
});

test("I2-02 the agents stop tool cancels parent and child harness work", async () => {
  const cancelled: string[] = [];
  const goalStopped = new Set<string>();
  const cancelThreadWork = source.statements.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === "cancelThreadWork") ? lifted("cancelThreadWork", {
    goalStopped, workflowRuns: new Map(), computerRuntime: undefined, benchThread: () => false,
    harnessChildren: new Map([["child", { childId: "child-1", client: { cancelChild: async (id: string) => { cancelled.push(id); } } }]]),
    harnesses: new Map([["parent", { cancel: async (id: string) => { cancelled.push(id); } }]]),
  }) : undefined;
  const stopped = callback("stopped", { cancelThreadWork, computerRuntime: undefined });
  const agents = runtime({ stopped });
  agents.adopt(turn);
  agents.adopt({ ...turn, threadId: "child", parentThreadId: "parent" });
  await agents.runThreadTool({ name: "agents", agent: "parent", stop: true }, turn);
  assert.deepEqual(cancelled, ["parent", "child-1"]);
  assert.deepEqual([...goalStopped], ["parent", "child"]);
});

test("I2-03 app tool RPCs use the live child's identity and reject stopped or unknown children", async () => {
  const executed: string[] = [];
  const f = harness({ onToolRequest: async (threadId) => { executed.push(threadId); return "ok"; } });
  const peer = f.client as unknown as {
    threadsBySession: Map<string, string>;
    children: Map<string, { thread: Promise<string>; ended: boolean }>;
    send(value: unknown): void;
    request(): Promise<unknown>;
    handleToolRequest(id: number, params: Record<string, unknown>): Promise<void>;
  };
  peer.threadsBySession.set("session", "parent");
  const child = { thread: Promise.resolve("child-thread"), ended: false };
  peer.children.set("parent/child-1", child);
  peer.send = () => {};
  peer.request = async () => ({});
  const request = (childId?: unknown) => peer.handleToolRequest(1, { sessionId: "session", toolCallId: childId ?? "parent-call", childId, name: "context", arguments: {} });
  try {
    await request("child-1");
    child.ended = true;
    await request("child-1");
    child.ended = false;
    await f.client.cancelChild("child-1");
    await request("child-1");
    await request("missing");
    await request(123);
    await peer.handleToolRequest(1, { sessionId: "session", toolCallId: "child-1", name: "context", arguments: {} });
    await request();
    assert.deepEqual(executed, ["child-thread", "parent"]);
  } finally { await f.dispose(); }
});

test("I2-03 a child's app context is created with its own thread and removed at settlement", async () => {
  const agents = runtime();
  agents.adopt(turn);
  const harnessTurns = new Map([["parent", turn]]);
  const harnessChildren = new Map();
  const harnessText = new Map();
  const harnessThought = new Map();
  const harnessUsage = new Map();
  const contexts = new Map<string, unknown>();
  const globals = {
    agents, harnessTurns, harnessChildren, harnessText, harnessThought, harnessUsage,
    threadContext: () => ({ folderIds: ["folder"], mode: "full", model: "openrouter:model" }),
    rememberThreadContext: (id: string, value: unknown) => contexts.set(id, value),
    host: { request: async () => ({ id: "child-thread" }) }, reviewThreads: new Set(), agentName: () => "Worker",
    client: {}, modelName: (value: string) => value, harnessRouted: new Map(), threadModel: () => "openrouter:model",
    recordedCacheUsage: () => ({}), recordTurn: async () => ({}),
  };
  const childId = await callback("onChildStart", globals)({ parentThreadId: "parent", childId: "child-1", title: "Read files" });
  assert.equal(harnessTurns.get(childId)?.parentThreadId, "parent");
  assert.equal(harnessTurns.get(childId)?.threadId, childId);
  assert.equal(agents.authorization(childId)(), true);
  assert.equal(JSON.stringify(contexts.get(childId)), JSON.stringify({ folderIds: ["folder"], mode: "full", model: "openrouter:model" }));
  callback("onChildEnd", globals)(childId);
  assert.equal(harnessTurns.has(childId), false);
  assert.equal(agents.authorization(childId)(), false);
});

test("I2-03 a child can read but cannot mutate its parent's goal", async () => {
  const goals = new Map([["parent", { objective: "Keep this" }]]);
  let writes = 0;
  const goalTool = lifted("goalTool", { goals, goalResult: (_action: string, id: string) => id, goalRequest: async () => { writes++; } });
  const child = { ...turn, threadId: "child", parentThreadId: "parent" };
  assert.equal(await goalTool({ action: "get" }, child), "parent");
  await assert.rejects(goalTool({ action: "clear" }, child), /subagent cannot change/);
  assert.equal(writes, 0);
});

test("I2-04 cancelling during UserPromptSubmit prevents the prompt RPC", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const f = harness({ onLifecycle: async (event) => { if (event === "UserPromptSubmit") { entered.resolve(); await release.promise; } } });
  try {
    const pending = f.client.prompt("parent", tmpdir(), "slow", "full");
    const rejected = assert.rejects(pending, /stopped before it reached the model/);
    await entered.promise;
    await f.client.cancel("parent");
    release.resolve();
    await rejected;
    assert.equal(f.messages.filter((message) => message.method === "session/prompt").length, 0);
  } finally { await f.dispose(); }
});

test("I2-05 fallback explicitly resets the session model after an explicit selection and restart", async () => {
  const f = harness();
  try {
    await f.client.prompt("parent", tmpdir(), "slow", "full", "paid/model");
    await f.client.prompt("parent", tmpdir(), "slow", "full");
    const models = f.messages.filter((message) => message.params?.configId === "model").map((message) => message.params?.value);
    assert.deepEqual(models, ["paid/model", ""]);
    await f.client.close();
    const resumed = harness({ home: f.home });
    try {
      await resumed.client.prompt("parent", tmpdir(), "slow", "full");
      assert.equal(resumed.messages.find((message) => message.params?.configId === "model")?.params?.value, "");
    } finally { await resumed.dispose(); }
  } finally { await f.dispose(); }
});

test("I2-06 settings invalidation replaces a busy harness before its next turn", () => {
  let closed = 0;
  const old = { busy: true, running: true, close() { closed++; this.running = false; } };
  const harnesses = new Map<string, unknown>([["key", old]]);
  const staleHarnesses = new WeakSet();
  lifted("recycleHarnesses", { harnesses, staleHarnesses })();
  const spawned: Partial<HarnessDeps>[] = [];
  const harnessClient = lifted("harnessClient", {
    harnesses, staleHarnesses, binary: () => "shinbo-cli", existsSync: () => true, path,
    app: { getPath: () => "/tmp" }, process: { env: {} }, harnessPromptFile: () => "/tmp/prompt", visionRoute: () => undefined,
    reapHarnesses() {}, noteHarnessLog() {}, Harness: class { constructor(deps: HarnessDeps) { spawned.push(deps); } },
  });
  assert.throws(() => harnessClient("/tmp", "key", { apiKey: "new-key", chatUrl: "https://new.test/chat" }), /still finishing/);
  assert.equal(closed, 0);
  old.busy = false;
  assert.notEqual(harnessClient("/tmp", "key", { apiKey: "new-key", chatUrl: "https://new.test/chat" }), old);
  assert.equal(closed, 1);
  assert.equal(spawned[0].apiKey, "new-key");
  assert.equal(spawned[0].chatUrl, "https://new.test/chat");
});

test("I2-07 concurrent sends reserve the thread before provider routing and release on failure", async () => {
  const entered = deferred<void>();
  const route = deferred<void>();
  const pendingTurns = new Set<string>();
  let starts = 0;
  let fail = false;
  const runTurn = lifted("runTurn", {
    pendingTurns, harnessRuns: new Map(), agents: { forget() {}, isLive: () => false }, goalStopped: new Set(),
    host: { request: async () => ({}) }, threadSubagent() {}, threadModel: () => "openrouter:model", threadContext: () => ({ model: "openrouter:model" }),
    rememberThreadContext() {}, threadStepLimit() {}, recordUse() {}, app: { getPath: () => "/tmp" }, modelKey: (value: string) => value,
    modelName: (value: string) => value, activeGoal() {}, harnessCwd: () => "/tmp", harnessKey: () => "key",
    turnRoute: async () => { entered.resolve(); await route.promise; if (fail) throw new Error("Route unavailable"); },
    runOnHarness: async () => { starts++; }, harnessClient() {}, withGoal: (value: unknown) => value, withTrialArm: (value: unknown) => value, changed() {},
  });
  const first = runTurn({ ...turn });
  await entered.promise;
  const second = runTurn({ ...turn }).then(() => undefined, (error: Error) => error);
  route.resolve();
  await first;
  assert.equal(starts, 1);
  assert.match((await second)?.message ?? "", /still running/);
  assert.equal(pendingTurns.size, 0);
  fail = true;
  await assert.rejects(runTurn({ ...turn }), /Route unavailable/);
  assert.equal(pendingTurns.size, 0);
  fail = false;
  await runTurn({ ...turn });
  assert.equal(starts, 2);
});

test("I3-05 full conversations are rejected before provider routing or model work", async () => {
  let routes = 0;
  let starts = 0;
  const pendingTurns = new Set<string>();
  const runTurn = lifted("runTurn", {
    pendingTurns, harnessRuns: new Map(), agents: { forget() {}, isLive: () => false }, goalStopped: new Set(),
    host: { request: async () => { throw new Error("this conversation is full"); } },
    threadSubagent() {}, threadModel: () => "openrouter:model", threadContext: () => ({ model: "openrouter:model" }),
    rememberThreadContext() {}, threadStepLimit() {}, recordUse() {}, app: { getPath: () => "/tmp" }, modelKey: (value: string) => value,
    modelName: (value: string) => value, activeGoal() {}, harnessCwd: () => "/tmp", harnessKey: () => "key",
    turnRoute: async () => { routes++; }, runOnHarness: async () => { starts++; }, harnessClient() {},
    withGoal: (value: unknown) => value, withTrialArm: (value: unknown) => value, changed() {},
  });
  const result = runTurn({ ...turn });
  await assert.rejects(result, /conversation is full/);
  assert.equal(routes, 0);
  assert.equal(starts, 0);
  assert.equal(pendingTurns.size, 0);
});

test("I2-09 transient session resume errors preserve the durable session mapping", async () => {
  const f = harness();
  const peer = f.client as unknown as {
    sessions: Map<string, string>;
    activeSession(threadId: string, cwd: string): Promise<string>;
    request(method: string): Promise<unknown>;
  };
  peer.sessions.set("parent", "valuable-session");
  let missing = false;
  let failed = true;
  let created = 0;
  peer.request = async (method) => {
    if (method === "session/resume" && failed) throw Object.assign(new Error(missing ? "Session not found" : "Session is busy"), { code: missing ? -32602 : -32603 });
    if (method === "session/new") { created++; return { sessionId: "replacement-session" }; }
    return {};
  };
  try {
    await assert.rejects(peer.activeSession("parent", tmpdir()), /Session is busy/);
    assert.equal(peer.sessions.get("parent"), "valuable-session");
    assert.equal(created, 0);
    failed = false;
    assert.equal(await peer.activeSession("parent", tmpdir()), "valuable-session");
    peer.sessions.set("missing", "gone-session");
    failed = true;
    missing = true;
    assert.equal(await peer.activeSession("missing", tmpdir()), "replacement-session");
    assert.equal(created, 1);
  } finally { await f.dispose(); }
});
