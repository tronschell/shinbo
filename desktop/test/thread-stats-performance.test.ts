import assert from "node:assert/strict";
import test from "node:test";
import { collectStats, statsFiles, threadStatsSheets } from "../src/thread-stats";
import type { Thread } from "../src/types";

const timestamp = "2026-09-12T07:00:00Z";
const thread = (id: string, parentThreadId?: string): Thread => ({ id, title: `Title ${id}`, parentThreadId, kind: parentThreadId ? "subagent" : "main", createdAt: timestamp, updatedAt: timestamp, messages: [{ role: "user", content: `Question ${id}`, timestamp }, { role: "assistant", content: `Complete answer ${id} 日本語\n` + "kept content ".repeat(100), timestamp, generation: { model: "fixture", outputTokens: 100, inputTokens: 200, durationMilliseconds: 1000 } }] });
const target = thread("parent");
const second = thread("child-second", target.id);
const first = thread("child-first", target.id);
const grandchild = thread("grandchild", first.id);
const unrelated = Array.from({ length: 200 }, (_, index) => thread(`unrelated-${index}`));
const library = [second, ...unrelated, target, grandchild, first];
let listed = library;
let fail = "";
let optionalFailures = false;
const calls: { method: string; threadId?: string }[] = [];

(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
(globalThis as unknown as { window: unknown }).window = { shinbo: {
  request: async (method: string, params: { threadId?: string } = {}) => {
    calls.push({ method, ...params });
    if (method === fail || params.threadId === fail) throw new Error(`Failed ${fail}`);
    if (method === "snapshot") return { threads: listed, scheduledJobs: [], warnings: [] };
    if (method === "threadSummaries") return { threads: listed.map((item) => ({ ...item, messages: item.messages.length })), scheduledJobs: [], warnings: ["Skipped malformed unrelated thread"] };
    if (method === "thread") {
      const found = listed.find((item) => item.id === params.threadId);
      if (!found) throw new Error("Thread is missing");
      return found;
    }
    throw new Error(`Unexpected request ${method}`);
  },
  threadTraces: async () => { if (optionalFailures) throw new Error("Traces unavailable"); return []; },
  listAgents: async () => { if (optionalFailures) throw new Error("Agents unavailable"); return []; },
  listPlans: async () => { if (optionalFailures) throw new Error("Plans unavailable"); return []; },
} };

test("thread export reads only the selected thread and every direct child in library order", async (t) => {
  t.mock.method(Date, "now", () => Date.parse(timestamp));
  calls.length = 0;
  const sources = await collectStats(target.id, 131072);
  assert.ok(sources);
  assert.deepEqual(calls, [{ method: "threadSummaries" }, { method: "thread", threadId: target.id }, { method: "thread", threadId: second.id }, { method: "thread", threadId: first.id }]);
  assert.deepEqual(sources.thread, target);
  assert.deepEqual(sources.subthreads, [second, first]);
  assert.equal(sources.thread.messages[1].content, target.messages[1].content);
  const children = threadStatsSheets(sources).find((sheet) => sheet.name === "sub-threads")!;
  assert.deepEqual(children.rows.slice(1), [second, first].map((item) => [item.id, item.title, "subagent", timestamp, timestamp, "", 2, 100, 1000, 100, "idle", "", ""]));
  assert.equal(statsFiles(sources).length, 10);
  assert.ok(!statsFiles(sources).some((file) => file.text.includes("unrelated-") || file.text.includes("grandchild")));
});

test("a missing selected thread returns undefined without history reads", async () => {
  calls.length = 0;
  assert.equal(await collectStats("missing", 131072), undefined);
  assert.deepEqual(calls, [{ method: "threadSummaries" }]);
});

test("unavailable optional telemetry retains empty fallbacks", async () => {
  optionalFailures = true;
  try {
    const sources = await collectStats(target.id, 131072);
    assert.ok(sources);
    assert.deepEqual([sources.traces, sources.agents, sources.plans], [[], [], []]);
  } finally { optionalFailures = false; }
});

for (const failing of ["threadSummaries", target.id, first.id]) {
  test(`failure reading ${failing} rejects rather than silently exporting incomplete data`, async () => {
    fail = failing;
    try { await assert.rejects(collectStats(target.id, 131072), new RegExp(`Failed ${failing}`)); }
    finally { fail = ""; }
  });
}

test("direct children beyond a small result page remain included", async () => {
  const children = Array.from({ length: 130 }, (_, index) => thread(`many-child-${index}`, target.id));
  listed = [target, ...children];
  calls.length = 0;
  try {
    const sources = await collectStats(target.id, 131072);
    assert.ok(sources);
    assert.deepEqual(sources.subthreads, children);
    assert.equal(calls.length, 132);
    assert.ok(calls.every((call) => call.method !== "snapshot"));
  } finally { listed = library; }
});
