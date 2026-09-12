import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(new URL("../dist-main/src/runs.js", import.meta.url));
const code = ts.transpileModule(readFileSync(process.env.SHINBO_RUN_RETENTION_SOURCE || new URL("../src/runs.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fixture() {
  const callbacks = { Changed: () => {} };
  const stored = new Map();
  const histories = new Map();
  const reads = [];
  let read = async (id) => histories.get(id);
  let save = (key, value) => {
    const chars = [...stored.values()].reduce((sum, text) => sum + text.length, 0) - (stored.get(key)?.length ?? 0) + value.length;
    if (chars > 5 * 1024 * 1024) throw new Error("quota");
    stored.set(key, value);
  };
  const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { save(key, value); storage[key] = value; }, removeItem: (key) => { stored.delete(key); delete storage[key]; } };
  globalThis.localStorage = storage;
  const shinbo = {
    request: async (method, { threadId }) => { assert.equal(method, "thread"); reads.push(threadId); return read(threadId); },
    listAgents: async () => [], listSpans: async () => ({}), livePartial: async () => ({}),
  };
  for (const event of ["Agents", "Changed", "Activity", "Delta", "Step", "Compacted", "ContextExperiment", "RoutedModel", "ContextBreakdown"]) {
    shinbo[`on${event}`] = (callback) => { callbacks[event] = callback; return () => {}; };
  }
  globalThis.window = { shinbo };
  const exports = {};
  new Function("exports", "require", code)(exports, require);
  exports.wire();
  const complete = async (id, calls = 1, body = "answer") => {
    await tick();
    if (!histories.has(id)) histories.set(id, { messages: [] });
    callbacks.Delta({ threadId: id, delta: body });
    for (let at = 0; at < calls; at++) callbacks.Step({ threadId: id, toolCallId: `${id}:${at}`, title: "read_file", kind: "read", status: "completed", at, output: `${id}:${at}:`.padEnd(16 * 1024, "x") });
    await tick();
    const messages = histories.get(id)?.messages ?? [];
    histories.set(id, { messages: [...messages, { role: "assistant", content: body, timestamp: messages.length ? `${id}-${messages.length}` : id, generation: null }] });
    callbacks.Agents([]);
    callbacks.Changed();
  };
  return { ...exports, callbacks, complete, histories, stored, reads, setRead: (next) => { read = next; }, setSave: (next) => { save = next; } };
}

test("offscreen completed runs release full output only after saved history and cache confirmation", async (t) => {
  const f = fixture();
  for (let at = 0; at < 100; at++) { await f.complete(`offscreen-${at}`, 20); await tick(); }
  const blocks = Array.from({ length: 100 }, (_, at) => f.runOf(`offscreen-${at}`).landed.flat());
  const retained = blocks.flat().filter((block) => block.kind === "step");
  const outputChars = retained.reduce((sum, block) => sum + block.step.output.length, 0);
  t.diagnostic(JSON.stringify({ completed: 100, retainedSteps: retained.length, retainedOutputChars: outputChars, historyReads: f.reads.length }));
  assert.equal(retained.length, 0);
  assert.equal(outputChars, 0);
  assert.ok(f.stored.size > 0 && f.stored.size < 100);
  assert.equal(JSON.parse(f.stored.get("shinbo.threadBlocks.v1.offscreen-99"))["offscreen-99"].filter((block) => block.kind === "step").length, 20);
});

test("missing history and cache failures preserve completed output and retry after persistence", async () => {
  const f = fixture();
  let reads = 0;
  f.setRead(async () => { if (reads++ === 0) return { messages: [] }; throw new Error("not saved yet"); });
  await f.complete("unsaved");
  await tick();
  assert.ok(f.runOf("unsaved").blocks.length);
  f.setRead(async (id) => f.histories.get(id));
  f.setSave(() => { throw new Error("quota"); });
  f.callbacks.Changed();
  await tick();
  assert.equal(f.reads.length, 2);
  f.subscribeRun("unsaved", () => {})();
  await tick();
  assert.ok(f.runOf("unsaved").blocks.length);
  f.setSave((key, value) => f.stored.set(key, value));
  f.subscribeRun("unsaved", () => {})();
  await tick();
  assert.deepEqual(f.runOf("unsaved").blocks, []);
});

test("a delayed completed-thread read cannot settle a fresh live turn", async () => {
  const f = fixture();
  let release;
  let reads = 0;
  f.setRead(() => reads++ === 0 ? Promise.resolve({ messages: [] }) : new Promise((resolve) => { release = resolve; }));
  await f.complete("restarted");
  await tick();
  const old = f.histories.get("restarted");
  f.callbacks.Delta({ threadId: "restarted", delta: "fresh live output" });
  release(old);
  await tick();
  assert.equal(f.runOf("restarted").sending, true);
  assert.equal(f.runOf("restarted").blocks[0].text, "fresh live output");
  assert.equal(f.runOf("restarted").landed.length, 1);
});


test("repeated offscreen turns settle without discarding held prompts or accumulating landed history", async () => {
  const f = fixture();
  for (let at = 0; at < 60; at++) {
    await f.complete("scheduled", 2, `reply ${at}`);
    f.runOf("scheduled").held = [{ content: "unsent prompt", after: 0, params: {} }];
    await tick();
    assert.deepEqual(f.runOf("scheduled").landed, []);
    assert.equal(f.runOf("scheduled").held[0].content, "unsent prompt");
  }
  assert.equal(f.histories.get("scheduled").messages.length, 60);
  assert.ok(Object.keys(JSON.parse(f.stored.get("shinbo.threadBlocks.v1.scheduled"))).length <= 40);
});


test("mounted runs retain display ownership and release on unmount without unrelated history reads", async () => {
  const f = fixture();
  const unwatch = f.subscribeRun("mounted", () => {});
  await f.complete("mounted");
  await tick();
  assert.equal(f.reads.length, 1);
  assert.ok(f.runOf("mounted").blocks.length);
  for (let at = 0; at < 10; at++) f.callbacks.Changed();
  await tick();
  assert.equal(f.reads.length, 1);
  unwatch();
  await tick();
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.runOf("mounted").landed, []);
  for (let at = 0; at < 10; at++) f.callbacks.Changed();
  await tick();
  assert.equal(f.reads.length, 2);
});

test("foreign completion retries after an unrelated store change precedes persistence", async () => {
  const f = fixture();
  await tick();
  f.histories.set("late", { messages: [] });
  f.callbacks.Delta({ threadId: "late", delta: "new completed answer" });
  await tick();
  f.callbacks.Agents([]);
  f.callbacks.Changed();
  await tick();
  assert.ok(f.runOf("late").landed.length);
  f.histories.set("late", { messages: [{ role: "assistant", content: "new completed answer", timestamp: "new", generation: null }] });
  f.callbacks.Changed();
  await tick();
  assert.deepEqual(f.runOf("late").landed, []);
  assert.equal(f.reads.length, 3);
  for (let at = 0; at < 10; at++) f.callbacks.Changed();
  await tick();
  assert.equal(f.reads.length, 3);
});

test("foreign completion never caches a new turn against an older identical reply", async () => {
  const f = fixture();
  await tick();
  const old = { role: "assistant", content: "The requested task is complete.", timestamp: "old", generation: null };
  f.histories.set("repeat", { messages: [old] });
  f.callbacks.Delta({ threadId: "repeat", delta: old.content });
  f.callbacks.Step({ threadId: "repeat", toolCallId: "new-tool", title: "read_file", kind: "read", status: "completed", at: 1, output: "new output" });
  await tick();
  f.callbacks.Agents([]);
  f.callbacks.Changed();
  await tick();
  assert.ok(f.runOf("repeat").landed.length);
  assert.equal(f.stored.has("shinbo.threadBlocks.v1.repeat"), false);
  f.histories.set("repeat", { messages: [old, { ...old, timestamp: "new" }] });
  f.callbacks.Changed();
  await tick();
  const cache = JSON.parse(f.stored.get("shinbo.threadBlocks.v1.repeat"));
  assert.deepEqual(Object.keys(cache), ["new"]);
  assert.equal(cache.new[1].step.toolCallId, "new-tool");
  assert.deepEqual(f.runOf("repeat").landed, []);
});

test("a store change during a stale settlement read gets one fresh read", async () => {
  const f = fixture();
  await tick();
  f.histories.set("during", { messages: [] });
  f.callbacks.Delta({ threadId: "during", delta: "finished while reading" });
  await tick();
  let release;
  const stale = f.histories.get("during");
  f.setRead(() => new Promise((resolve) => { release = resolve; }));
  f.callbacks.Agents([]);
  f.callbacks.Changed();
  await tick();
  f.histories.set("during", { messages: [{ role: "assistant", content: "finished while reading", timestamp: "saved", generation: null }] });
  f.setRead(async (id) => f.histories.get(id));
  f.callbacks.Changed();
  release(stale);
  await tick();
  assert.deepEqual(f.runOf("during").landed, []);
  assert.equal(f.reads.length, 3);
});

test("failed or late adoption history keeps output without pairing or repeated reads", async () => {
  for (const late of [false, true]) {
    const f = fixture();
    await tick();
    let release;
    f.setRead(late ? () => new Promise((resolve) => { release = resolve; }) : async () => { throw new Error("history unavailable"); });
    await f.complete("unknown");
    if (late) release(f.histories.get("unknown"));
    await tick();
    f.setRead(async (id) => f.histories.get(id));
    for (let at = 0; at < 10; at++) f.callbacks.Changed();
    f.subscribeRun("unknown", () => {})();
    await tick();
    assert.ok(f.runOf("unknown").landed.length);
    assert.equal(f.reads.length, 1);
    assert.equal(f.stored.has("shinbo.threadBlocks.v1.unknown"), false);
    await f.complete("unknown", 1, "another completed answer");
    await tick();
    assert.equal(f.runOf("unknown").landed.length, 2);
    assert.equal(f.reads.length, 1);
  }
});

test("unsettled identical turns retain the earliest saved-history boundary", async () => {
  const f = fixture();
  f.histories.set("earliest", { messages: [{ role: "assistant", content: "same answer", timestamp: "older", generation: null }] });
  f.setSave(() => { throw new Error("quota"); });
  await f.complete("earliest", 1, "same answer");
  await tick();
  assert.equal(f.runOf("earliest").landed.length, 1);
  f.setSave((key, value) => f.stored.set(key, value));
  await f.complete("earliest", 1, "same answer");
  await tick();
  const cache = JSON.parse(f.stored.get("shinbo.threadBlocks.v1.earliest"));
  assert.deepEqual(Object.keys(cache), ["earliest-1", "earliest-2"]);
  assert.deepEqual(f.runOf("earliest").landed, []);
  assert.equal(f.reads.length, 3);
});

test("an adoption read from an earlier generation cannot authorize a newer run", async () => {
  const f = fixture();
  await tick();
  let release;
  f.setRead(() => new Promise((resolve) => { release = resolve; }));
  await f.complete("generation", 1, "first reply");
  const old = { messages: [] };
  f.callbacks.Delta({ threadId: "generation", delta: "newer reply" });
  release(old);
  await tick();
  f.histories.get("generation").messages.push({ role: "assistant", content: "newer reply", timestamp: "newer", generation: null });
  f.callbacks.Agents([]);
  f.callbacks.Changed();
  await tick();
  assert.equal(f.runOf("generation").landed.length, 2);
  assert.equal(f.reads.length, 1);
  assert.equal(f.stored.has("shinbo.threadBlocks.v1.generation"), false);
});
