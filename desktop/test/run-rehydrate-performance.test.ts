import assert from "node:assert/strict";
import test from "node:test";
import { restoreBlocks, runOf, wire } from "../src/runs";
import type { LiveAgent, ThreadStep } from "../shared/agents";
import type { TraceSpan } from "../shared/trace";

type Spans = Record<string, TraceSpan[]>;
type Partials = Record<string, { text: string; thinking: string }>;
const wait = () => new Promise<void>((resolve) => setImmediate(resolve));
const live = (threadId: string): LiveAgent => ({ threadId, prompt: `Prompt ${threadId}`, title: threadId, color: "#000", status: "running", mode: "auto", model: "", activity: "", tool: false, startedAt: 0, steps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, generationMs: 0 });
let pushAgents: (value: LiveAgent[]) => void = () => undefined;
let pushDelta: (value: { threadId: string; delta: string }) => void = () => undefined;
let pushStep: (value: ThreadStep) => void = () => undefined;
let spans: Spans = {};
let partials: Partials = {};
let spansCalls = 0;
let partialCalls = 0;
let readSpans = () => Promise.resolve(spans);
let readPartials = () => Promise.resolve(partials);

(globalThis as unknown as { window: unknown }).window = { shinbo: {
  request: async () => ({ messages: [] }),
  onAgents: (listener: typeof pushAgents) => { pushAgents = listener; },
  onDelta: (listener: typeof pushDelta) => { pushDelta = listener; },
  onStep: (listener: typeof pushStep) => { pushStep = listener; },
  onActivity: () => () => undefined,
  onCompacted: () => () => undefined,
  onContextExperiment: () => () => undefined,
  onRoutedModel: () => () => undefined,
  onContextBreakdown: () => () => undefined,
  onChanged: () => 0,
  listAgents: () => new Promise<LiveAgent[]>(() => undefined),
  listSpans: () => { spansCalls += 1; return readSpans(); },
  livePartial: () => { partialCalls += 1; return readPartials(); },
} };
wire();

test("eight adopted runs share one complete recovery read and retain every thread's blocks", async () => {
  const agents = Array.from({ length: 8 }, (_, at) => live(`batch-${at}`));
  spans = Object.fromEntries(agents.map(({ threadId }) => [threadId, Array.from({ length: 128 }, (_, at): TraceSpan => ({ id: `call:${at}`, name: `${threadId}-${at}`, kind: "read", startedAt: at, status: "ok", output: `${threadId}-${at}:` + "界".repeat(5000) }))]));
  partials = Object.fromEntries(agents.map(({ threadId }) => [threadId, { text: `Answer ${threadId}`, thinking: `Thought ${threadId}` }]));
  const expected = agents.map(({ threadId }) => restoreBlocks(threadId, spans[threadId], partials[threadId]));
  pushAgents(agents);
  await wait();
  assert.equal(spansCalls, 1);
  assert.equal(partialCalls, 1);
  assert.deepEqual(agents.map(({ threadId }) => runOf(threadId).blocks), expected);
  assert.deepEqual(agents.map(({ threadId }) => runOf(threadId).pending?.content), agents.map((agent) => agent.prompt));
  pushAgents(agents);
  await wait();
  assert.equal(spansCalls, 1);
  assert.equal(partialCalls, 1);
});

test("later adoption starts a fresh read while another batch is still pending", async () => {
  let release: (value: Spans) => void = () => undefined;
  readSpans = () => new Promise<Spans>((resolve) => { release = resolve; });
  partials = { older: { text: "older answer", thinking: "" } };
  pushAgents([live("older")]);
  const before = spansCalls;
  readSpans = () => Promise.resolve({});
  partials = { newer: { text: "newer answer", thinking: "" } };
  pushAgents([live("older"), live("newer")]);
  await wait();
  assert.equal(spansCalls, before + 1);
  assert.deepEqual(runOf("newer").blocks, [{ kind: "text", text: "newer answer" }]);
  release({});
  await wait();
  assert.deepEqual(runOf("older").blocks, [{ kind: "text", text: "older answer" }]);
});

test("new generations discard stale snapshots and keep deltas and tool updates received during recovery", async () => {
  let release: (value: Spans) => void = () => undefined;
  readSpans = () => new Promise<Spans>((resolve) => { release = resolve; });
  partials = { generation: { text: "obsolete answer", thinking: "" } };
  pushAgents([live("generation")]);
  pushAgents([]);
  readSpans = () => Promise.resolve({ generation: [{ id: "call:tool", name: "Read", kind: "read", startedAt: 1, status: "running" }] });
  partials = { generation: { text: "Fresh answer", thinking: "" } };
  pushAgents([live("generation")]);
  pushDelta({ threadId: "generation", delta: "answer continues" });
  const step: ThreadStep = { threadId: "generation", toolCallId: "tool", title: "Read", kind: "read", status: "completed", at: 1, output: "final tool output" };
  pushStep(step);
  await wait();
  const expected = [{ kind: "text", text: "Fresh answer continues" }, { kind: "step", step }];
  assert.deepEqual(runOf("generation").blocks, expected);
  release({});
  await wait();
  assert.deepEqual(runOf("generation").blocks, expected);
});

for (const failed of ["spans", "partials"] as const) {
  test(`a failed ${failed} read does not poison the next adoption batch`, async () => {
    spans = {};
    partials = {};
    readSpans = () => failed === "spans" ? Promise.reject(new Error("Unavailable")) : Promise.resolve(spans);
    readPartials = () => failed === "partials" ? Promise.reject(new Error("Unavailable")) : Promise.resolve(partials);
    const ids = [`failed-${failed}-1`, `failed-${failed}-2`];
    const beforeSpans = spansCalls;
    const beforePartials = partialCalls;
    pushAgents(ids.map(live));
    await wait();
    assert.equal(spansCalls, beforeSpans + 1);
    assert.equal(partialCalls, beforePartials + 1);
    assert.ok(ids.every((id) => runOf(id).blocks.length === 0));
    pushAgents([]);
    readSpans = () => Promise.resolve(spans);
    readPartials = () => Promise.resolve(partials);
    partials = Object.fromEntries(ids.map((id) => [id, { text: `Recovered ${id}`, thinking: "" }]));
    pushAgents(ids.map(live));
    await wait();
    assert.equal(spansCalls, beforeSpans + 2);
    assert.equal(partialCalls, beforePartials + 2);
    assert.deepEqual(ids.map((id) => runOf(id).blocks), ids.map((id) => [{ kind: "text", text: `Recovered ${id}` }]));
  });
}
