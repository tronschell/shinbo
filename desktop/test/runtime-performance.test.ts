import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { AgentRuntime, type LoopDeps } from "../main/agent-loop";
import { Harness, recoveredSessionTraces, type HarnessDeps } from "../main/harness";
import { readUsage, recordUse } from "../main/invocations";
import { usageDay } from "../shared/invocations";
import * as trace from "../shared/trace";

const runtime = (deps: Partial<LoopDeps> = {}) => new AgentRuntime({
  request: async () => ({}), ask: () => {}, answered: () => {}, verify: async () => ({ model: "", prompt: "", reply: "", attempts: 0 }),
  advise: async () => ({ model: "", text: "" }), spawnTurn: () => {}, changed: () => {}, step: () => {}, ...deps,
});
const turn = { threadId: "performance", content: "hi", title: "Performance", mode: "ask" as const };

test("streaming and tool updates do not traverse historical spans", (t) => {
  const agents = runtime();
  agents.adopt(turn);
  for (let i = 0; i < 1000; i++) agents.noteTool(turn.threadId, String(i), "read");
  agents.noteDelta(turn.threadId, "hello");
  const run = (agents as unknown as { runs: Map<string, { spans: trace.TraceSpan[] }> }).runs.get(turn.threadId)!;
  let reads = 0;
  run.spans = new Proxy(run.spans, { get(target, property, receiver) {
    if (typeof property === "string" && /^\d+$/.test(property)) reads += 1;
    return Reflect.get(target, property, receiver);
  } });
  for (let i = 0; i < 1000; i++) {
    agents.noteDelta(turn.threadId, "hello");
    agents.noteTool(turn.threadId, "999", "read");
  }
  t.diagnostic(`historical span reads: ${reads}`);
  assert.equal(reads, 0);
  assert.equal(agents.list()[0].toolCalls, 1000);
  assert.equal(run.spans.at(-1)?.tokens, 2002);
  agents.finish(turn.threadId);
  assert.ok(run.spans.every((span) => span.endedAt !== undefined));
});

test("reading a thread transfers summaries once and only the selected history", async (t) => {
  const requests: string[] = [];
  const thread = { id: "target", title: "Target", messages: [{ role: "assistant", content: "answer", timestamp: "today" }] };
  const agents = runtime({ request: async (method) => {
    requests.push(method);
    return method === "threadSummaries" ? { threads: [{ ...thread, messages: thread.messages.length }] } : thread;
  } });
  const text = await agents.runThreadTool({ name: "threads", action: "read", thread: "target", limit: 10 }, turn);
  assert.match(text, /answer/);
  t.diagnostic(`host requests: ${requests.join(", ")}`);
  assert.deepEqual(requests, ["threadSummaries", "thread"]);
});

test("settled ACP requests release every idle timer", async (t) => {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  t.mock.method(globalThis, "setTimeout", (...args: Parameters<typeof setTimeout>) => {
    const timer = realSet(...args);
    timers.add(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => {
    timers.delete(timer);
    realClear(timer);
  });
  const client = new Harness({ idleMs: 60_000 } as HarnessDeps);
  const inner = client as unknown as {
    child: unknown;
    request(method: string, params: Record<string, unknown>): Promise<unknown>;
    receive(line: string): void;
    fail(error: Error): void;
  };
  inner.child = { stdin: { write() {} } };
  try {
    for (let id = 1; id <= 100; id++) {
      const pending = inner.request("session/set_mode", {});
      inner.receive(JSON.stringify({ id, result: {} }));
      await pending;
    }
    t.diagnostic(`timers after 100 completed requests: ${timers.size}`);
    assert.equal(timers.size, 0);
    const failed = inner.request("session/prompt", {});
    inner.fail(new Error("stopped"));
    await assert.rejects(failed, /stopped/);
    assert.equal(timers.size, 0);
    const offline = new Harness({ idleMs: 60_000 } as HarnessDeps) as unknown as typeof inner;
    await assert.rejects(offline.request("initialize", {}), /not running/);
    assert.equal(timers.size, 0);
  } finally {
    for (const timer of timers) realClear(timer);
  }
});

test("checkpoint recovery only redecodes traces changed by recovery", (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "shinbo-recovery-perf-"));
  const session = path.join(home, ".fx", "sessions", "session");
  mkdirSync(session, { recursive: true });
  writeFileSync(path.join(home, "shinbo-sessions.json"), JSON.stringify({ thread: "session" }));
  const turns = Array.from({ length: 25 }, (_, i) => ({ execution: { tool_steps: [{ tool_results: [
    { tool_call_id: `known-${i}`, tool_name: "read_file", created_at_ms: 1_000_000 + i * 100_000, output: "known" },
    { tool_call_id: `missing-${i}`, tool_name: "read_file", created_at_ms: 1_000_000 + i * 100_000, output: "restored" },
  ] }] } }));
  writeFileSync(path.join(session, "checkpoint.json"), JSON.stringify({ state: { history: turns } }));
  const stored = turns.map((_, i) => ({ timestamp: new Date(1_000_000 + i * 100_000).toISOString(), text: trace.encodeSpans([
    { id: "agent:thread", name: "Thread", kind: "agent", startedAt: 1_000_000 + i * 100_000, status: "ok" },
    { id: `call:known-${i}`, name: "read", kind: "read", startedAt: 1_000_000 + i * 100_000, status: "ok" },
  ]) }));
  const decode = trace.decodeSpans;
  const decoder = t.mock.method(trace, "decodeSpans", decode);
  try {
    const recovered = recoveredSessionTraces(home, "thread", stored);
    t.diagnostic(`trace decodes for 25 recovered turns: ${decoder.mock.callCount()}`);
    assert.equal(decoder.mock.callCount(), 50);
    const calls = recovered.flatMap((item) => decode(item.text)).filter((span) => span.id.startsWith("call:"));
    assert.equal(calls.length, 50);
    assert.equal(calls.filter((call) => call.output === "restored").length, 25);
    assert.deepEqual(recoveredSessionTraces(home, "thread", recovered), recovered);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a burst of usage events shares one atomic write without losing counts", async (t) => {
  const home = await fs.mkdtemp(path.join(tmpdir(), "shinbo-usage-perf-"));
  const write = fs.writeFile;
  const rename = fs.rename;
  const writes = t.mock.method(fs, "writeFile", write);
  const renames = t.mock.method(fs, "rename", rename);
  try {
    await Promise.all(Array.from({ length: 100 }, (_, i) => recordUse(home, `model/test-${i % 5}`)));
    const usage = await readUsage(home);
    assert.deepEqual(Object.values(usage).map((days) => days[usageDay(new Date())]), [20, 20, 20, 20, 20]);
    t.diagnostic(`writes for 100 usage events: ${writes.mock.callCount()}; atomic renames: ${renames.mock.callCount()}`);
    assert.equal(writes.mock.callCount(), 1);
    assert.equal(renames.mock.callCount(), 1);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

for (const stage of ["connecting", "streaming"]) {
  test(`disconnecting the ChatGPT caller cancels upstream while ${stage}`, (t) => {
    const home = mkdtempSync(path.join(tmpdir(), "shinbo-relay-perf-"));
    mkdirSync(path.join(home, ".codex"));
    writeFileSync(path.join(home, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: "fixture", account_id: "fixture" } }));
    const script = `
      import { request } from "node:http";
      import { setTimeout as delay } from "node:timers/promises";
      const { chatgptRoute } = await import(${JSON.stringify(pathToFileURL(path.join(__dirname, "../main/chatgpt.js")).href)});
      let started;
      const beginning = new Promise(resolve => { started = resolve; });
      let cancelled;
      const cancellation = new Promise(resolve => { cancelled = resolve; });
      let aborted = 0;
      globalThis.fetch = async (_url, options) => {
        started();
        if (${JSON.stringify(stage)} === "connecting") return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => { aborted++; cancelled(); reject(new Error("cancelled")); }, { once: true });
        });
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.in_progress"}\\n\\n'));
          options.signal?.addEventListener("abort", () => { aborted++; cancelled(); controller.error(new Error("cancelled")); }, { once: true });
        } }));
      };
      const route = await chatgptRoute();
      const client = request(route.chatUrl, { method: "POST", headers: { authorization: "Bearer " + route.apiKey } });
      client.on("error", () => {});
      client.end(JSON.stringify({ model: "fixture", messages: [] }));
      await beginning;
      client.destroy();
      await Promise.race([cancellation, delay(300)]);
      process.stdout.write(JSON.stringify({ aborted }));
      process.exit(0);
    `;
    try {
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000, env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex") } });
      assert.equal(result.status, 0, result.stderr);
      const { aborted } = JSON.parse(result.stdout) as { aborted: number };
      t.diagnostic(`upstream aborts after caller disconnect (${stage}): ${aborted}`);
      assert.equal(aborted, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}

test("usage arriving during a write is persisted in the following batch", async (t) => {
  const home = await fs.mkdtemp(path.join(tmpdir(), "shinbo-usage-queued-"));
  const write = fs.writeFile;
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const beginning = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  t.mock.method(fs, "writeFile", async (...args: Parameters<typeof fs.writeFile>) => {
    if (++calls === 1) { started(); await held; }
    return write(...args);
  });
  try {
    const first = recordUse(home, "model/queued");
    await beginning;
    const second = recordUse(home, "model/queued");
    release();
    await Promise.all([first, second]);
    assert.equal((await readUsage(home))["model/queued"][usageDay(new Date())], 2);
    assert.equal(calls, 2);
  } finally {
    release();
    await fs.rm(home, { recursive: true, force: true });
  }
});
