import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { AgentRuntime, type LoopDeps, type TurnRequest } from "../main/agent-loop";
import { advise } from "../main/advisor";
import { look } from "../main/vision";

const settings = { model: "fixture", endpoint: "http://fixture.invalid", credentialEnv: "", system: "" };
const turn: TurnRequest = { threadId: "task", title: "Fixture", content: "Explain a harmless example", mode: "ask" };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function runtime(overrides: Partial<LoopDeps> = {}) {
  const agents = new AgentRuntime({ request: async (method, params) => method === "threadSummaries" ? { threads: [turn.threadId, "other"].map((id) => ({ id, title: turn.title, messages: 0 })) } : { id: params.threadId, title: turn.title, messages: [] }, ask() {}, answered() {}, verify: async () => ({ model: "local", prompt: "", reply: "", attempts: 1 }), advise: (transcript, signal) => advise(settings, transcript, undefined, signal), spawnTurn() {}, changed() {}, step() {}, ...overrides });
  agents.adopt(turn);
  return agents;
}

for (const tool of ["advisor", "vision"] as const) {
  test(`R4-C1 stopping aborts ${tool} without cancelling another task`, async () => {
    const original = globalThis.fetch;
    const pending: { signal: AbortSignal; release: () => void }[] = [];
    const agents = runtime();
    agents.adopt({ ...turn, threadId: "other" });
    try {
      globalThis.fetch = async (_url, init) => new Promise<Response>((resolve, reject) => {
        const signal = init!.signal!;
        pending.push({ signal, release: () => resolve(new Response(JSON.stringify({ choices: [{ message: { content: "A harmless reply" } }] }))) });
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      let execute: (thread: TurnRequest) => Promise<string>;
      if (tool === "advisor") execute = (thread) => agents.runThreadTool({ name: "advisor", question: "What next?" }, thread);
      else {
        const source = readFileSync(process.env.SHINBO_SECONDARY_TEST_SOURCE ?? path.join(process.cwd(), "main/main.ts"), "utf8");
        const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
        const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "executeTool");
        assert.ok(declaration);
        const run = runInNewContext(ts.transpileModule(`(${declaration.getText(parsed)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { toolSettings: { vision: settings }, folderImage: () => "data:image/png;base64,fixture", look, agents }) as (args: unknown, thread: TurnRequest) => Promise<string>;
        execute = (thread) => run({ name: "vision", question: "What is shown?", path: "synthetic.png" }, thread);
      }
      const result = execute(turn).catch(() => "cancelled");
      const other = execute({ ...turn, threadId: "other" }).catch(() => "cancelled");
      for (let i = 0; i < 20 && pending.length < 2; i++) await tick();
      assert.equal(pending.length, 2);
      agents.stop(turn.threadId);
      const cancelled = pending.map((call) => call.signal.aborted);
      for (const call of pending) call.release();
      await Promise.all([result, other]);
      assert.deepEqual(cancelled, [true, false]);
    } finally { agents.stopAll(); for (const call of pending) call.release(); await tick(); globalThis.fetch = original; }
  });
}

for (const method of ["threadSummaries", "thread"]) {
  test(`R4-C1 stopping during advisor ${method} loading starts no paid request`, async () => {
    let release!: (value: unknown) => void;
    let calls = 0;
    const agents = runtime({ request: (requested) => requested === method ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(requested === "threadSummaries" ? { threads: [{ id: turn.threadId, title: turn.title, messages: 0 }] } : { id: turn.threadId, title: turn.title, messages: [] }), advise: async () => { calls++; return { model: "fixture", text: "reply" }; } });
    const advice = agents.runThreadTool({ name: "advisor", question: "What next?" }, turn).catch(() => "cancelled");
    await tick();
    agents.stop(turn.threadId);
    release(method === "threadSummaries" ? { threads: [{ id: turn.threadId, title: turn.title, messages: 0 }] } : { id: turn.threadId, title: turn.title, messages: [] });
    await advice;
    assert.equal(calls, 0);
  });
}
