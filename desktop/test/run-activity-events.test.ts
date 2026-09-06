import assert from "node:assert/strict";
import test from "node:test";
import { runOf, wire } from "../src/runs";
import type { ThreadStep } from "../shared/agents";

type Event = Record<string, unknown> & { threadId: string };
const listeners = new Map<string, (value: Event) => void>();
const subscribe = (name: string) => (listener: (value: Event) => void) => {
  listeners.set(name, listener);
  return () => undefined;
};
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
(globalThis as unknown as { window: unknown }).window = {
  emma: {
    onActivity: subscribe("activity"),
    onDelta: subscribe("delta"),
    onStep: subscribe("step"),
    onCompacted: subscribe("compacted"),
    onContextExperiment: subscribe("experiment"),
    onRoutedModel: subscribe("model"),
    onContextBreakdown: subscribe("breakdown"),
    onAgents: () => () => undefined,
    listAgents: async () => [],
    listSpans: async () => ({}),
    livePartial: async () => ({}),
  },
};
wire();

for (const toolName of ["visualize", "advisor", "artifact", "read_file", "write_file", "terminal", "browser", "subagent", "unknown_plugin"]) {
  test(`${toolName} textless updates refresh activity without inventing output`, (t) => {
    t.mock.method(Date, "now", () => 1000);
    const threadId = `tool-${toolName}`;
    const step: ThreadStep = { threadId, toolCallId: "call", toolName, title: toolName, kind: "other", status: "pending", at: 1000 };
    listeners.get("step")!(step);
    assert.equal(runOf(threadId).activeAt, 1000);
    runOf(threadId).activeAt = 1;
    listeners.get("step")!({ ...step, status: "in_progress" });
    assert.equal(runOf(threadId).activeAt, 1000);
    assert.equal(runOf(threadId).blocks.length, 1);
    assert.equal(runOf(threadId).blocks[0].kind, "step");
    const block = runOf(threadId).blocks[0];
    assert.ok(block.kind === "step");
    assert.equal(block.step.output, undefined);
    assert.equal(block.step.input, undefined);
    t.mock.method(Date, "now", () => 2000);
    assert.equal(runOf(threadId).activeAt, 1000);
  });
}

test("generation activity preserves the entire response and does not adopt an idle run", (t) => {
  t.mock.method(Date, "now", () => 4000);
  const threadId = "generation-after-answer";
  listeners.get("delta")!({ threadId, delta: "Keep this answer" });
  listeners.get("step")!({ threadId, toolCallId: "finished", title: "Read", kind: "read", status: "completed", at: 1 });
  const run = runOf(threadId);
  run.sending = false;
  run.activeAt = 1;
  const before = { ...run };
  listeners.get("activity")!({ threadId });
  assert.deepEqual(runOf(threadId), { ...before, activeAt: 4000 });
});

for (const [name, payload] of [
  ["activity", {}],
  ["delta", { delta: "Retrying provider", recovery: true }],
  ["compacted", { removedTurns: 1, modelWritten: true }],
  ["experiment", { prunedResults: 0, reinjected: false, savedTokens: 0, addedTokens: 0 }],
  ["model", { model: "model", fellBack: false }],
  ["breakdown", {}],
] as const) {
  test(`${name} events refresh activity even without new answer text`, (t) => {
    t.mock.method(Date, "now", () => 3000);
    const threadId = `event-${name}`;
    listeners.get("delta")!({ threadId, delta: "Existing answer" });
    runOf(threadId).activeAt = 1;
    listeners.get(name)!({ threadId, ...payload });
    assert.equal(runOf(threadId).activeAt, 3000);
    assert.deepEqual(runOf(threadId).blocks[0], { kind: "text", text: "Existing answer" });
    runOf(threadId).activeAt = 1;
    listeners.get(name)!({ threadId, ...payload });
    assert.equal(runOf(threadId).activeAt, 3000);
  });
}
