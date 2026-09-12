import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { PLAN_WEEK_MS, PLAN_WINDOW_MS, defaultSettings, planFor, planSpend, withPlanProfile, type PlanGeneration } from "../shared/settings";

const now = Date.parse("2026-09-12T08:00:00Z");
const providers = withPlanProfile(defaultSettings, planFor("kimi")!, "k3").providers;
const message = (at: number, model = "k3") => ({ timestamp: new Date(at).toISOString(), generation: { model, inputTokens: 200, outputTokens: 100 } });
const source = readFileSync(path.join(process.cwd(), "src/model-plans.tsx"), "utf8");
const tree = ts.createSourceFile("model-plans.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && ["readPlanLedger", "planGenerations"].includes(node.name?.text ?? "")).map((node) => node.getText(tree)).join("\n");
const threads = [
  { id: "old", messages: [message(now - PLAN_WEEK_MS - 1)] },
  { id: "boundary", messages: [message(now - PLAN_WEEK_MS), message(now - PLAN_WINDOW_MS)] },
  { id: "old-created-recent", messages: [message(now - PLAN_WEEK_MS * 2), message(now)] },
  { id: "future", messages: [message(now + PLAN_WEEK_MS)] },
  { id: "router", messages: [message(now, "moonshotai/k3"), message(now, "")] },
];
const summaries = threads.map((thread) => ({ id: thread.id, createdAt: new Date(now - PLAN_WEEK_MS * 10).toISOString(), messageDates: thread.messages.map((message) => message.timestamp) }));

function fixture(list: { id: string; messageDates?: string[] }[] = summaries, clocks = [now, now]) {
  const calls: string[] = [];
  let fail = "";
  const request = async (method: string, params?: { threadId: string }) => {
    calls.push(`${method}:${params?.threadId ?? ""}`);
    if (method === fail) throw new Error("Unavailable");
    if (method === "threadSummaries") return { threads: list, warnings: ["Malformed unrelated record skipped"] };
    if (method === "thread") return threads.find((thread) => thread.id === params?.threadId);
    if (method === "snapshot") return { threads };
    throw new Error(`Unexpected ${method}`);
  };
  const read = vm.runInNewContext(ts.transpileModule(`${functions}\nreadPlanLedger;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { PLAN_WEEK_MS, Date: { now: () => clocks.shift() ?? now, parse: Date.parse }, window: { shinbo: { request } } }) as () => Promise<{ at: number; generations: PlanGeneration[] }>;
  return { read, calls, fail: (method: string) => { fail = method; } };
}

const totals = (generations: PlanGeneration[], at: number) => JSON.stringify([PLAN_WINDOW_MS, PLAN_WEEK_MS].map((window) => [...planSpend(generations, providers, at - window)]));
const all = threads.flatMap((thread) => thread.messages.filter((message) => message.generation.model).map((message) => ({ at: Date.parse(message.timestamp), ...message.generation })));

test("subscription history skips only old threads and preserves both exact spending windows", async () => {
  const f = fixture();
  const result = await f.read();
  assert.equal(totals(result.generations, result.at), totals(all, now));
  assert.deepEqual(f.calls, ["threadSummaries:", "thread:boundary", "thread:old-created-recent", "thread:future", "thread:router"]);
  assert.equal(result.generations.length, 6);
});

test("missing or unparseable summary dates conservatively fetch histories", async () => {
  const f = fixture([{ id: "old" }, { id: "boundary", messageDates: ["invalid"] }]);
  await f.read();
  assert.deepEqual(f.calls, ["threadSummaries:", "thread:old", "thread:boundary"]);
});

test("forward clock movement retains completion-time window semantics", async () => {
  const f = fixture(summaries, [now, now + 1]);
  const result = await f.read();
  assert.equal(result.at, now + 1);
  assert.equal(totals(result.generations, result.at), totals(all, now + 1));
});

test("a backward wall-clock adjustment falls back to complete history", async () => {
  const f = fixture(summaries, [now, now - 10, now - 10]);
  const result = await f.read();
  assert.equal(f.calls.at(-1), "snapshot:");
  assert.equal(result.at, now - 10);
  assert.equal(totals(result.generations, result.at), totals(all, now - 10));
  assert.ok(result.generations.some((generation) => generation.at === now - PLAN_WEEK_MS - 1));
});

test("empty summaries request no transcript", async () => {
  const f = fixture([]);
  assert.equal((await f.read()).generations.length, 0);
  assert.deepEqual(f.calls, ["threadSummaries:"]);
});

for (const method of ["threadSummaries", "thread"]) {
  test(`required ${method} failures reject instead of publishing partial spending`, async () => {
    const f = fixture(); f.fail(method);
    await assert.rejects(f.read(), /Unavailable/);
  });
}

test("subscription collection consumes each full transcript before requesting the next", async () => {
  const count = 64;
  const bodyBytes = 16 * 1024;
  let pendingBytes = 0;
  let peakBytes = 0;
  let requests = 0;
  const request = async (method: string, params?: { threadId: string }) => {
    if (method === "threadSummaries") return { threads: Array.from({ length: count }, (_, index) => ({ id: `${index}`, messageDates: [new Date(now).toISOString()] })) };
    assert.equal(method, "thread");
    requests++;
    const content = `${requests}`.padEnd(bodyBytes, "x");
    pendingBytes += content.length;
    peakBytes = Math.max(peakBytes, pendingBytes);
    const index = Number(params?.threadId);
    let consumed = false;
    return { messages: [{ content, timestamp: new Date(now + index).toISOString(), get generation() {
      if (!consumed) { consumed = true; pendingBytes -= content.length; }
      return { model: "k3", inputTokens: index, outputTokens: index + 1 };
    } }] };
  };
  const read = vm.runInNewContext(ts.transpileModule(`${functions}\nreadPlanLedger;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { PLAN_WEEK_MS, Date: { now: () => now, parse: Date.parse }, window: { shinbo: { request } } }) as () => Promise<{ at: number; generations: PlanGeneration[] }>;
  const result = await read();
  assert.equal(requests, count);
  assert.equal(pendingBytes, 0);
  assert.equal(peakBytes, bodyBytes);
  assert.deepEqual(Array.from(result.generations, (generation) => [generation.at, generation.inputTokens, generation.outputTokens]), Array.from({ length: count }, (_, index) => [now + index, index, index + 1]));
});
