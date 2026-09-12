import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime, type LoopDeps, type TurnRequest } from "../main/agent-loop";
import { parseToolArgs } from "../main/tools";

const turn: TurnRequest = { threadId: "root", title: "Root", content: "Help", mode: "full" };
const timestamp = "2026-09-12T07:00:00Z";
const messages = Array.from({ length: 25 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Message ${index} 日本語`, timestamp }));
const root = { id: "root", title: "Root", kind: "main", updatedAt: timestamp, messages };
const child = { id: "child", title: "Child", kind: "subagent", parentThreadId: "root", archivedAt: timestamp, updatedAt: timestamp, messages: [] };

function fixture() {
  let library = [child, root];
  const calls: { method: string; params: Record<string, string> }[] = [];
  const advised: string[] = [];
  const deps: LoopDeps = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "threadSummaries") return { threads: library.map((thread) => ({ ...thread, messages: thread.messages.length })) };
      if (method === "thread") return library.find((thread) => thread.id === params.threadId);
      throw new Error(`Unexpected ${method}`);
    },
    ask() {}, answered() {}, changed() {}, step() {}, spawnTurn() {},
    verify: async () => ({ model: "", prompt: "", reply: "", attempts: 0 }),
    advise: async (text) => { advised.push(text); return { model: "fixture", text: "Advice" }; },
  };
  const runtime = new AgentRuntime(deps);
  return { runtime, calls, advised, deps, replace: (threads: typeof library) => { library = threads; }, call: (action: string, thread?: string) => runtime.runThreadTool(parseToolArgs("threads", JSON.stringify({ action, thread, limit: 2 })), turn) };
}

test("thread listing uses complete fresh summaries with exact message counts and order", async () => {
  const f = fixture();
  assert.equal(await f.call("list"), `child · subagent under root · archived · 0 messages · updated ${timestamp}\n  Child\nroot · main · 25 messages · updated ${timestamp}\n  Root`);
  f.replace([{ ...root, title: "Renamed", messages: [...messages, messages[0]] }]);
  assert.equal(await f.call("list"), `root · main · 26 messages · updated ${timestamp}\n  Renamed`);
  assert.deepEqual(f.calls.map((call) => call.method), ["threadSummaries", "threadSummaries"]);
});

test("thread reads fetch one selected history and preserve the exact tail output", async () => {
  const f = fixture();
  assert.equal(await f.call("read", "root"), `Root · main · 25 messages, the 23 oldest not shown\n\n--- assistant · ${timestamp}\nMessage 23 日本語\n\n--- user · ${timestamp}\nMessage 24 日本語`);
  assert.deepEqual(f.calls, [{ method: "threadSummaries", params: {} }, { method: "thread", params: { threadId: "root" } }]);
  assert.equal(await f.call("read", "child"), "Child · subagent · 0 messages\nNothing has been said in it yet.");
});

test("missing IDs keep the existing error without a history request", async () => {
  const f = fixture();
  await assert.rejects(f.call("read", "missing"), { message: "Shinbo has no thread with the ID missing. Call threads with action list to see the ones it does have." });
  assert.equal(f.calls.length, 1);
  f.replace([]);
  assert.equal(await f.call("list"), "Shinbo has no threads yet.");
});

test("advisor receives only the selected thread's last twenty messages", async () => {
  const f = fixture();
  f.runtime.adopt(turn);
  assert.equal(await f.runtime.runThreadTool(parseToolArgs("advisor", "{}"), turn), "Advice from fixture:\n\nAdvice");
  assert.ok(f.advised[0].includes("Message 5 日本語"));
  assert.ok(!f.advised[0].includes("Message 4 日本語"));
  assert.deepEqual(f.calls.map((call) => call.method), ["threadSummaries", "thread"]);
});

test("malformed library envelopes and failed selected reads reject", async () => {
  const f = fixture();
  f.deps.request = async () => ({ threads: null });
  await assert.rejects(f.call("list"), /invalid library/);
  f.deps.request = async (method) => { if (method === "threadSummaries") return { threads: [{ ...root, messages: 25 }] }; throw new Error("Thread removed"); };
  await assert.rejects(f.call("read", "root"), /Thread removed/);
});
