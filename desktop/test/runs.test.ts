import assert from "node:assert/strict";
import test from "node:test";

import { appendText, arrived, dropQueued, fallbackNotice, groupBlocks, joinPartial, mergeStep, pairBlocks, releaseHeld, restoreBlocks, runOf, sendTurn, turnToRetry, stopTurn, thinkingOf, tracedBlocks, wire, withoutThinking, wrote, type Block } from "../src/runs";
import type { LiveAgent, ThreadStep } from "../shared/agents";
import { compactionNotice, decodeSpans, type TraceSpan } from "../shared/trace";
import { cachedBlocks, rememberBlocks, setThreadFolders, threadFolders, threadBreakdown, recordBreakdown } from "../src/context";
import type { Message } from "../src/types";

const stored = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value); },
  removeItem: (key: string) => { stored.delete(key); },
};
(globalThis as unknown as { dispatchEvent: unknown }).dispatchEvent = () => true;

const sent: string[] = [];
let release: (() => void) | null = null;
let request: (method: string, params: { content: string }) => Promise<unknown> = (_method, params) => {
  sent.push(params.content);
  return new Promise<void>((resolve) => { release = resolve; });
};
const stopped: string[] = [];
let savedThread: { messages: unknown[] } | null = null;
let liveSpans: Record<string, TraceSpan[]> = {};
let livePartials: Record<string, { text: string; thinking: string }> = {};
let pushDelta: (value: { threadId: string; delta: string; thinking?: boolean; recovery?: boolean }) => void = () => undefined;
let pushCompacted: Parameters<Window["shinbo"]["onCompacted"]>[0] = () => undefined;
let pushAgents: (value: LiveAgent[]) => void = () => undefined;
(globalThis as unknown as { window: unknown }).window = {
  shinbo: {
    request: (method: string, params: { content: string }) => method === "thread" ? (savedThread ? Promise.resolve(savedThread) : Promise.reject(new Error("No saved thread"))) : request(method, params),
    onDelta: (listener: typeof pushDelta) => { pushDelta = listener; return () => undefined; },
    onActivity: () => () => undefined,
    onStep: () => () => undefined,
    onCompacted: (listener: typeof pushCompacted) => { pushCompacted = listener; return () => undefined; },
    onContextExperiment: () => () => undefined,
    onRoutedModel: () => () => undefined,
    onContextBreakdown: () => () => undefined,
    onChanged: () => 0,
    onAgents: (listener: typeof pushAgents) => { pushAgents = listener; return () => undefined; },
    listAgents: () => Promise.resolve([]),
    listSpans: () => Promise.resolve(liveSpans),
    livePartial: () => Promise.resolve(livePartials),
    stopAgent: (threadId?: string) => { stopped.push(threadId ?? ""); },
  },
};

const turn = (content: string) => ({ content, after: 0, params: {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a turn typed while one is running waits for it, in order", async () => {
  sendTurn("thread", turn("first"), () => undefined);
  sendTurn("thread", turn("second"), () => undefined);
  sendTurn("thread", turn("third"), () => undefined);
  assert.deepEqual(sent, ["first"]);
  release!();
  await settle();
  assert.deepEqual(sent, ["first", "second"]);
  release!();
  await settle();
  assert.deepEqual(sent, ["first", "second", "third"]);
  release!();
  await settle();
});

test("a stop sends what you typed next and holds the rest", async () => {
  sent.length = 0;
  stopped.length = 0;
  sendTurn("interrupt", turn("running"), () => undefined);
  sendTurn("interrupt", turn("queued behind it"), () => undefined);
  stopTurn("interrupt", undefined, () => undefined);
  sendTurn("interrupt", turn("no, do this instead"), () => undefined);
  assert.deepEqual(stopped, ["interrupt"]);
  release!();
  await settle();
  assert.deepEqual(sent, ["running", "no, do this instead"]);
  release!();
  await settle();
  assert.deepEqual(sent, ["running", "no, do this instead"]);
  releaseHeld("interrupt", 0, () => undefined);
  await settle();
  assert.deepEqual(sent, ["running", "no, do this instead", "queued behind it"]);
  release!();
  await settle();
});

test("swapping the model mid-turn stops it and sends the same prompt again", async () => {
  sent.length = 0;
  stopped.length = 0;
  const marked: string[] = [];
  sendTurn("stalled", turn("render the map"), () => undefined);
  assert.deepEqual(sent, ["render the map"]);
  stopTurn("stalled", {
    ...turn("render the map"),
    notice: "Model changed to Opus — Stealth answered nothing for 4m",
    prepare: async () => { marked.push("switched"); return { params: {} }; },
  }, () => undefined);
  assert.deepEqual(stopped, ["stalled"]);
  assert.deepEqual(sent, ["render the map"]);
  assert.deepEqual(marked, []);
  release!();
  await settle();
  assert.deepEqual(sent, ["render the map", "render the map"]);
  assert.deepEqual(marked, ["switched"]);
  release!();
  await settle();
});

test("dropping a queued turn counts past the one already running", async () => {
  sent.length = 0;
  sendTurn("drop", turn("running"), () => undefined);
  sendTurn("drop", turn("keep"), () => undefined);
  sendTurn("drop", turn("drop me"), () => undefined);
  dropQueued("drop", 1);
  release!();
  await settle();
  release!();
  await settle();
  assert.deepEqual(sent, ["running", "keep"]);
});

const step = (toolCallId: string, status: ThreadStep["status"]): ThreadStep =>
  ({ threadId: "t", toolCallId, title: "read", kind: "read", status, at: 0 });

test("a turn is blocks in arrival order, not one buffer with the calls under it", () => {
  let blocks: Block[] = [];
  blocks = appendText(blocks, "text", "Scaffold");
  blocks = appendText(blocks, "text", " files:");
  blocks = mergeStep(blocks, step("a", "in_progress"));
  blocks = appendText(blocks, "text", "One write hiccuped");
  blocks = mergeStep(blocks, step("a", "completed"));
  assert.deepEqual(blocks.map((block) => block.kind), ["text", "step", "text"]);
  assert.equal(blocks[0].kind === "text" && blocks[0].text, "Scaffold files:");
  assert.equal(blocks[1].kind === "step" && blocks[1].step.status, "completed");
});

test("reasoning keeps its own block instead of merging into the answer", () => {
  const blocks = appendText(appendText([], "thinking", "hm"), "text", "done");
  assert.deepEqual(blocks.map((block) => block.kind), ["thinking", "text"]);
});

test("a turn's reasoning is one train of thought, and the calls either side of it are one list", () => {
  const blocks: Block[] = [
    { kind: "thinking", text: "first " },
    { kind: "step", step: step("a", "completed") },
    { kind: "thinking", text: " second" },
    { kind: "step", step: step("b", "completed") },
    { kind: "text", text: "<think>third</think>the answer" },
  ];
  assert.equal(thinkingOf(blocks), "first\n\nsecond\n\nthird");
  assert.deepEqual(groupBlocks(withoutThinking(blocks), 0), [
    { kind: "steps", steps: [step("a", "completed"), step("b", "completed")], keep: 0 },
    { kind: "text", text: "the answer" },
  ]);
  assert.deepEqual(withoutThinking([{ kind: "text", text: "<think>all of it</think>" }]), []);
});

const liveAgent = (threadId: string, prompt = ""): LiveAgent =>
  ({ threadId, prompt, title: "t", color: "#000", status: "running", mode: "auto", model: "", activity: "", tool: false, startedAt: 0, steps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, generationMs: 0 });

test("a turn the notch started owns its thread here too, and hands it back when it ends", async () => {
  sent.length = 0;
  request = (_method, params) => { sent.push(params.content); return new Promise<void>((resolve) => { release = resolve; }); };
  wire();
  pushDelta({ threadId: "notch", delta: "working" });
  sendTurn("notch", turn("typed in the workspace"), () => undefined);
  assert.deepEqual(sent, []);
  pushAgents([liveAgent("elsewhere")]);
  await settle();
  assert.deepEqual(sent, ["typed in the workspace"]);
  release!();
  await settle();
});

test("a run main is still driving is picked back up after this window loses its state", async () => {
  sent.length = 0;
  request = (_method, params) => { sent.push(params.content); return new Promise<void>((resolve) => { release = resolve; }); };
  wire();
  pushAgents([liveAgent("reloaded")]);
  sendTurn("reloaded", turn("typed after the reload"), () => undefined);
  assert.deepEqual(sent, []);
  pushAgents([]);
  await settle();
  assert.deepEqual(sent, ["typed after the reload"]);
  release!();
  await settle();
});

test("a recovered run draws the prompt main is still working on", async () => {
  wire();
  pushAgents([liveAgent("recovered-echo", "port the old ledger")]);
  assert.equal(runOf("recovered-echo").sending, true);
  assert.equal(runOf("recovered-echo").pending?.content, "port the old ledger");
  pushAgents([]);
  await settle();
  assert.equal(runOf("recovered-echo").sending, false);
});

test("a reloaded window puts the running turn's calls and answer back", async () => {
  liveSpans = {
    "recovered-blocks": [
      { id: "agent:recovered-blocks", name: "This thread", kind: "agent", startedAt: 0, status: "running" },
      { id: "call:2", name: "read runs.ts", kind: "read", startedAt: 2, status: "ok", output: "…" },
      { id: "call:1", name: "grep adoptForeign", kind: "search", startedAt: 1, status: "ok" },
    ],
  };
  livePartials = { "recovered-blocks": { text: "Found it: ", thinking: "where does the state live" } };
  wire();
  pushAgents([liveAgent("recovered-blocks", "why is the transcript empty")]);
  await settle();
  const blocks = runOf("recovered-blocks").blocks;
  assert.deepEqual(blocks.map((block) => block.kind === "step" ? block.step.title : block.text),
    ["where does the state live", "grep adoptForeign", "read runs.ts", "Found it: "]);
  pushDelta({ threadId: "recovered-blocks", delta: "here" });
  await settle();
  const text = runOf("recovered-blocks").blocks.filter((block) => block.kind === "text");
  assert.deepEqual(text.map((block) => block.text), ["Found it: here"]);
  liveSpans = {};
  livePartials = {};
  pushAgents([]);
  await settle();
});

test("a turn main has said nothing about yet restores as nothing", () => {
  assert.deepEqual(restoreBlocks("quiet", [], undefined), []);
});

test("a parent's restore leaves its subagents' calls to the subagent", () => {
  const spans: TraceSpan[] = [
    { id: "agent:parent", name: "Parent", kind: "agent", startedAt: 0, status: "running" },
    { id: "call:own", name: "read runs.ts", kind: "read", startedAt: 1, status: "ok", parentId: "agent:parent" },
    { id: "call:spawn", name: "subagent", kind: "subagent", startedAt: 2, status: "running", parentId: "agent:parent" },
    { id: "agent:child", name: "Child", kind: "agent", startedAt: 3, status: "running", parentId: "call:spawn" },
    { id: "call:theirs", name: "grep in the child", kind: "search", startedAt: 4, status: "ok", parentId: "agent:child" },
  ];
  const calls = (threadId: string) => restoreBlocks(threadId, spans).map((block) => block.kind === "step" ? block.step.toolCallId : block.kind);
  assert.deepEqual(calls("parent"), ["own", "spawn"]);
  assert.deepEqual(calls("child"), ["theirs"]);
});

test("a delta that beat the restore is folded into the answer, not left standing alone", async () => {
  liveSpans = {};
  livePartials = { "recovered-overlap": { text: "The answer is 42, because ", thinking: "" } };
  wire();
  pushDelta({ threadId: "recovered-overlap", delta: "of the mice" });
  await settle();
  const blocks = runOf("recovered-overlap").blocks.filter((block) => block.kind === "text");
  assert.deepEqual(blocks.map((block) => block.text), ["The answer is 42, because of the mice"]);
  livePartials = {};
  pushAgents([]);
  await settle();
});

test("a restore that lands after its run ended is dropped", async () => {
  liveSpans = { "stale-restore": [{ id: "call:9", name: "read old.ts", kind: "read", startedAt: 1, status: "ok" }] };
  livePartials = { "stale-restore": { text: "the previous answer", thinking: "" } };
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const spansOf = window.shinbo.listSpans;
  window.shinbo.listSpans = () => held.then(() => liveSpans);
  wire();
  pushAgents([liveAgent("stale-restore", "the old prompt")]);
  await settle();
  pushAgents([]);
  await settle();
  release?.();
  await settle();
  assert.deepEqual(runOf("stale-restore").blocks, []);
  window.shinbo.listSpans = spansOf;
  liveSpans = {};
  livePartials = {};
});

test("overlapping text keeps whichever stream ran longer", () => {
  assert.equal(joinPartial("abcdef", "def"), "abcdef");
  assert.equal(joinPartial("abcdef", "defgh"), "abcdefgh");
  assert.equal(joinPartial("abcdef", ""), "abcdef");
  assert.equal(joinPartial("abc", "xyz"), "abcxyz");
});

test("a turn's tool calls are drawn where they happened, and a burst of them is one list", () => {
  const alternating: Block[] = [{ kind: "text", text: "reading" }];
  for (const id of ["a", "b", "c", "d"]) alternating.push({ kind: "step", step: step(id, "completed") }, { kind: "text", text: `did ${id}` });
  assert.deepEqual(groupBlocks(alternating, 0).map((block) => block.kind),
    ["text", "steps", "text", "steps", "text", "steps", "text", "steps", "text"]);

  const burst: Block[] = [
    { kind: "text", text: "reading" },
    ...["a", "b", "c"].map((id): Block => ({ kind: "step", step: step(id, "completed") })),
    { kind: "text", text: "done" },
  ];
  const grouped = groupBlocks(burst, 0);
  assert.deepEqual(grouped.map((block) => block.kind), ["text", "steps", "text"]);
  assert.equal(grouped[1].kind === "steps" && grouped[1].steps.length, 3);
});

const said = (role: Message["role"], content: string, timestamp: string): Message =>
  ({ role, content, timestamp, generation: null });

test("landed turns are kept against the message each one wrote, and read back after a restart", () => {
  const messages = [
    said("user", "one", "2026-08-22T10:00:00Z"), said("assistant", "the first answer", "2026-08-22T10:00:01Z"),
    said("user", "two", "2026-08-22T10:01:00Z"), said("assistant", "answered in the notch", "2026-08-22T10:01:01Z"),
    said("user", "three", "2026-08-22T10:02:00Z"), said("assistant", "the third answer", "2026-08-22T10:02:01Z"),
  ];
  const third: Block[] = [{ kind: "text", text: "the third answer" }, { kind: "step", step: step("a", "completed") }];
  rememberBlocks("kept", Object.fromEntries(pairBlocks(messages, [third], {})
    .flatMap((blocks, index) => blocks && wrote(messages[index].content, blocks) ? [[messages[index].timestamp, blocks]] : [])));

  const paired = pairBlocks(messages, [], cachedBlocks("kept"));
  assert.deepEqual(paired[5], third);
  assert.equal(paired[3], undefined);
});

test("a thread keeps one folder, and one stored before that was true collapses onto its project", () => {
  setThreadFolders("bound", ["project", "beside-it", "and-another"]);
  assert.deepEqual(threadFolders("bound"), ["project"]);
  stored.set("shinbo.threadFolders.v1", JSON.stringify({ legacy: ["first", "second"] }));
  assert.deepEqual(threadFolders("legacy"), ["first"]);
  assert.deepEqual(threadFolders("never-opened"), []);
});

test("a turn whose reply has not landed yet is not painted over an older one", () => {
  const messages = [said("assistant", "the first answer", "2026-08-22T10:00:01Z"), said("user", "two", "2026-08-22T10:01:00Z")];
  const blocks: Block[] = [{ kind: "text", text: "the answer to the second prompt" }];
  assert.equal(pairBlocks(messages, [blocks], {})[0], undefined);
});

test("a reload empties the landed runs, and the next answer still lands on its own message", () => {
  const messages = [
    said("user", "reply APPLE", "2026-08-22T10:00:00Z"), said("assistant", "APPLE", "2026-08-22T10:00:01Z"),
    said("user", "reply BANANA", "2026-08-22T10:01:00Z"),
  ];
  const banana: Block[] = [{ kind: "text", text: "BANANA" }];
  assert.equal(pairBlocks(messages, [banana], {})[1], undefined);

  const answered = [...messages, said("assistant", "BANANA", "2026-08-22T10:01:01Z")];
  const paired = pairBlocks(answered, [banana], {});
  assert.equal(paired[1], undefined);
  assert.deepEqual(paired[3], banana);
});

test("a finished turn stays drawn where it happened until the reply it wrote arrives", () => {
  const messages = [
    said("user", "one", "2026-08-22T10:00:00Z"), said("assistant", "the first answer", "2026-08-22T10:00:01Z"),
    said("user", "two", "2026-08-22T10:01:00Z"),
  ];
  const first: Block[] = [{ kind: "text", text: "the first answer" }];
  const second: Block[] = [{ kind: "text", text: "the answer to the second prompt" }];
  assert.equal(arrived(messages, second), false);
  const paired = pairBlocks(messages, [first, second], {});
  assert.deepEqual(paired[1], first);
  const held = pairBlocks(messages, [first, second].slice(0, -1), {});
  assert.deepEqual(held[1], first);

  const answered = [...messages, said("assistant", "the answer to the second prompt, at length", "2026-08-22T10:01:01Z")];
  assert.equal(arrived(answered, second), true);
  assert.deepEqual(pairBlocks(answered, [first, second], {})[3], second);
});

test("a turn's notice takes the tool calls of a run that said nothing", () => {
  const messages = [
    said("user", "do it", "2026-08-22T10:00:00Z"),
    said("system", "You stopped this run before anything was said.", "2026-08-22T10:00:01Z"),
  ];
  const steps: Block[] = [{ kind: "step", step: step("a", "cancelled") }];
  assert.deepEqual(pairBlocks(messages, [steps], {})[1], steps);
});

test("a run that said nothing waits for its own notice instead of claiming an earlier one", () => {
  const messages = [
    said("user", "sleep 70", "2026-09-02T23:58:15Z"),
    said("system", "You stopped this run.", "2026-09-02T23:58:17Z"),
    said("user", "sleep 70 again", "2026-09-02T23:59:48Z"),
  ];
  const steps: Block[] = [{ kind: "step", step: step("one", "failed") }];
  assert.deepEqual(pairBlocks(messages, [steps], {}, 2), [undefined, undefined, undefined]);
  const notice = said("system", "You stopped this run.", "2026-09-02T23:59:50Z");
  assert.deepEqual(pairBlocks([...messages, notice], [steps], {}, 2), [undefined, undefined, undefined, steps]);
});

test("a repeated short answer lands on the turn that just ran, not the first that said it", () => {
  const messages = [
    said("user", "Reply with exactly the single word pong", "2026-09-02T23:39:37Z"),
    said("assistant", "pong", "2026-09-02T23:39:37Z"),
    said("user", "Reply with exactly the single word pong", "2026-09-03T00:42:24Z"),
    said("assistant", "pong", "2026-09-03T00:42:24Z"),
  ];
  const blocks: Block[] = [{ kind: "text", text: "pong" }];
  assert.deepEqual(pairBlocks(messages, [blocks], {}, 2), [undefined, undefined, undefined, blocks]);
});

test("a turn that waited behind another is sent against the messages that exist by then", async () => {
  sent.length = 0;
  savedThread = { messages: [] };
  sendTurn("queued", { content: "first", after: 2, params: {} }, () => undefined);
  sendTurn("queued", { content: "second", after: 2, params: {} }, () => undefined);
  assert.equal(runOf("queued").pending?.after, 2);
  savedThread = { messages: [1, 2, 3, 4] };
  release!();
  await settle();
  await settle();
  assert.deepEqual(sent, ["first", "second"]);
  assert.equal(runOf("queued").pending?.after, 4);
  release!();
  await settle();
  savedThread = null;
});

test("the stall swap only resends a turn that is still running", async () => {
  sendTurn("stalling", turn("PING-F"), () => {});
  await settle();
  assert.equal(turnToRetry("stalling")?.content, "PING-F");

  release?.();
  await settle();
  assert.equal(runOf("stalling").sending, false);
  assert.equal(turnToRetry("stalling"), null);
});

test("a turn the host refuses holds its text for retry", async () => {
  let reloaded = 0;
  request = () => Promise.reject(new Error("host is down"));
  sendTurn("failed", turn("lost prompt"), () => { reloaded += 1; });
  await settle();
  assert.equal(reloaded, 1);
  assert.equal(runOf("failed").held[0].content, "lost prompt");
});

test("a refused turn keeps the reason beside the text it held back", async () => {
  request = () => Promise.reject(new Error("host is down"));
  sendTurn("refused", turn("lost prompt"), () => {});
  await settle();
  assert.equal(runOf("refused").held[0].content, "lost prompt");
  assert.equal(runOf("refused").held[0].failure, "host is down");
});

const traceOf = (thread: string, startedAt: number, calls: [string, string, number?][], recovered = false) => [
  JSON.stringify({ v: 1, thread, model: "z-ai/glm-5.3-flash", ...(recovered ? { recovered: "session" } : {}) }),
  JSON.stringify({ id: `agent:${thread}`, name: "This thread", kind: "agent", startedAt, endedAt: startedAt + 500, status: "ok" }),
  ...calls.map(([id, name, said], index) => JSON.stringify({
    id: `call:${id}`, parentId: `agent:${thread}`, name, kind: "read", startedAt: startedAt + index + 1, endedAt: startedAt + index + 2, status: "ok", input: "{}", output: "done", said,
  })),
].join("\n");

test("a turn nothing cached is rebuilt from the trace the host kept", () => {
  const messages: Message[] = [
    { role: "user", content: "restyle the app", timestamp: "2026-08-27T21:11:28Z" },
    { role: "assistant", content: "<think>reading the styles</think>Done — it wears the new palette.", timestamp: "2026-08-27T21:11:28Z" },
    { role: "user", content: "and the tests?", timestamp: "2026-08-27T21:12:37Z" },
    { role: "assistant", content: "They pass.", timestamp: "2026-08-27T21:12:37Z" },
  ];
  const traces = [
    { timestamp: "2026-08-27T19:50:59Z", text: traceOf("dither", 1787860252951, [["orphan", "a turn that never landed"]]) },
    { timestamp: "2026-08-27T21:11:29Z", text: traceOf("dither", 1787865075384, [["one", "read index.css"], ["two", "write index.css"]]) },
    { timestamp: "2026-08-27T21:12:37Z", text: traceOf("dither", 1787865143697, [["three", "npm test"]]) },
  ];
  const turns = tracedBlocks("dither", messages, traces);
  assert.deepEqual(turns["2026-08-27T21:11:28Z"].map((block) => block.kind === "step" ? block.step.title : block.kind), ["thinking", "read index.css", "write index.css", "text"]);
  assert.deepEqual(turns["2026-08-27T21:12:37Z"].map((block) => block.kind === "step" ? block.step.title : block.kind), ["npm test", "text"]);
  assert.equal(Object.keys(turns).length, 2);
});

test("a message with no trace of its own keeps reading as the stored string", () => {
  const messages: Message[] = [{ role: "assistant", content: "no tools were used", timestamp: "2026-08-27T21:11:28Z" }];
  const traces = [{ timestamp: "2026-08-27T19:50:59Z", text: traceOf("dither", 1787860252951, [["far", "an hour earlier"]]) }];
  assert.deepEqual(tracedBlocks("dither", messages, traces), {});
});

test("a recovered session trace tolerates the delay before its stopped message was saved", () => {
  const messages: Message[] = [{ role: "assistant", content: "Recovered.", timestamp: "2026-08-27T21:11:28Z" }];
  const traces = [{ timestamp: "2026-08-27T21:10:17Z", text: traceOf("dither", 1787865017000, [["old", "read old trace"]], true) }];
  assert.equal(tracedBlocks("dither", messages, traces)[messages[0].timestamp][0].kind, "step");
});

test("a rebuilt turn puts each call back where the answer had reached", () => {
  const content = "Reading the styles now.\nThen writing them.\nDone.";
  const messages: Message[] = [{ role: "assistant", content, timestamp: "2026-08-27T21:11:28Z" }];
  const traces = [{
    timestamp: "2026-08-27T21:11:28Z",
    text: traceOf("dither", 1787865075384, [["one", "read index.css", 23], ["two", "write index.css", 42]]),
  }];
  const blocks = tracedBlocks("dither", messages, traces)[messages[0].timestamp];
  assert.deepEqual(blocks.map((block) => block.kind === "step" ? block.step.title : block.text), [
    "Reading the styles now.",
    "read index.css",
    "\nThen writing them.",
    "write index.css",
    "\nDone.",
  ]);
});

test("a call recorded before the answer was measured still reads in clock order", () => {
  const messages: Message[] = [{ role: "assistant", content: "One answer, no offsets.", timestamp: "2026-08-27T21:11:28Z" }];
  const traces = [{ timestamp: "2026-08-27T21:11:28Z", text: traceOf("dither", 1787865075384, [["one", "read"], ["two", "write"]]) }];
  const blocks = tracedBlocks("dither", messages, traces)[messages[0].timestamp];
  assert.deepEqual(blocks.map((block) => block.kind === "step" ? block.step.title : block.text), ["read", "write", "One answer, no offsets."]);
});

test("a stopped run keeps its interrupted step on the notice that closed it", () => {
  const messages: Message[] = [
    { role: "user", content: "sleep 40", timestamp: "2026-08-27T00:20:21Z" },
    { role: "system", content: "This run stopped: you stopped it", timestamp: "2026-08-27T00:20:21Z" },
    { role: "user", content: "Reply with exactly the single word pong", timestamp: "2026-08-27T00:20:45Z" },
    { role: "system", content: compactionNotice(1, true), timestamp: "2026-08-27T00:20:40Z" },
    { role: "assistant", content: "pong", timestamp: "2026-08-27T00:20:45Z" },
  ];
  const stopped = [
    JSON.stringify({ v: 1, thread: "dither", model: "z-ai/glm-5.3-flash" }),
    JSON.stringify({ id: "agent:dither", name: "This thread", kind: "agent", startedAt: 1787876421000, endedAt: 1787876421500, status: "failed" }),
    JSON.stringify({ id: "call:one", parentId: "agent:dither", name: "Running sleep 40; echo finished", kind: "execute", startedAt: 1787876421001, endedAt: 1787876421400, status: "cancelled", input: "{}" }),
  ].join("\n");
  const turns = tracedBlocks("dither", messages, [
    { timestamp: "2026-08-27T00:20:21Z", text: stopped },
    { timestamp: "2026-08-27T00:20:45Z", text: traceOf("dither", 1787876445000, [["two", "read notes"]]) },
  ]);
  assert.deepEqual(turns["2026-08-27T00:20:21Z"].map((block) => block.kind === "step" ? `${block.step.title} ${block.step.status}` : block.kind), ["Running sleep 40; echo finished cancelled"]);
  assert.deepEqual(turns["2026-08-27T00:20:45Z"].map((block) => block.kind === "step" ? block.step.title : block.kind), ["read notes", "text"]);
  assert.deepEqual(Object.keys(turns), ["2026-08-27T00:20:21Z", "2026-08-27T00:20:45Z"]);
});

test("a trace lands on the turn it was recorded with, not on an earlier answer that has none", () => {
  const messages: Message[] = [
    { role: "assistant", content: "pong", timestamp: "2026-09-03T00:35:41Z" },
    { role: "assistant", content: "The first entry printed was Applications.", timestamp: "2026-09-03T00:36:02Z" },
  ];
  const turns = tracedBlocks("dither", messages, [{ timestamp: "2026-09-03T00:36:02Z", text: traceOf("dither", 1788395762000, [["one", "Running ls / | head -5"]]) }]);
  assert.equal(turns["2026-09-03T00:35:41Z"], undefined);
  assert.deepEqual(turns["2026-09-03T00:36:02Z"].map((block) => block.kind === "step" ? block.step.title : block.kind), ["Running ls / | head -5", "text"]);
});

test("a compaction says how much history became a summary, and whether the model wrote it", () => {
  assert.equal(compactionNotice(12, true), "Context compacted — 12 turns became a summary");
  assert.equal(compactionNotice(14, true, true), "Fresh context — 14 turns dropped, handoff written by the model");
  assert.equal(compactionNotice(1, false, true), "Fresh context — 1 turn dropped, handoff recorded automatically");
  assert.equal(compactionNotice(1, false), "Context compacted — 1 turn became a rough summary the model did not write");
});

test("a call the turn never finished comes back as not executed, not as still working", () => {
  const span = (status: TraceSpan["status"]): TraceSpan => ({ id: "call:c1", name: "bash", kind: "execute", startedAt: 1, status });
  const statusOf = (status: TraceSpan["status"]) => {
    const [block] = restoreBlocks("thread", [span(status)]);
    return block.kind === "step" ? block.step.status : "";
  };
  assert.equal(statusOf("cancelled"), "cancelled");
  assert.equal(statusOf("running"), "in_progress");
  assert.equal(statusOf("ok"), "completed");
});

test("a steer is rebuilt from the trace at the point it cut into the answer", () => {
  const content = "Reading the styles now.\nThen writing them.";
  const messages: Message[] = [{ role: "assistant", content, timestamp: "2026-08-27T21:11:28Z" }];
  const text = [
    JSON.stringify({ v: 1, thread: "dither", model: "z-ai/glm-5.3-flash" }),
    JSON.stringify({ id: "agent:dither", name: "This thread", kind: "agent", startedAt: 1787865075384, endedAt: 1787865075884, status: "ok" }),
    JSON.stringify({ id: "steer:dither:1", parentId: "agent:dither", name: "steer", kind: "steer", startedAt: 1787865075385, endedAt: 1787865075385, status: "ok", input: "use the other palette", said: 23 }),
  ].join("\n");
  const blocks = tracedBlocks("dither", messages, [{ timestamp: "2026-08-27T21:11:28Z", text }])[messages[0].timestamp];
  assert.deepEqual(blocks.map((block) => block.kind === "step" ? block.step.title : block.kind === "notice" ? `steer:${block.text}` : block.text), [
    "Reading the styles now.",
    "steer:use the other palette",
    "\nThen writing them.",
  ]);
  assert.equal(blocks.every((block) => block.kind !== "notice" || block.steer), true);
});

test("both compaction modes publish content and refresh context without a tool event", async () => {
  wire();
  for (const fresh of [false, true]) {
    const threadId = `compacted-${fresh}`;
    sendTurn(threadId, turn("continue"), () => undefined);
    await settle();
    pushCompacted({ threadId, removedTurns: 3, summaryChars: 14, modelWritten: false, fresh, handoff: "Actual content", historyChars: 800 });
    assert.deepEqual(runOf(threadId).blocks.at(-1), { kind: "notice", text: compactionNotice(3, false, fresh), plain: true, compact: true, handoff: "Actual content" });
    assert.ok(runOf(threadId).blocks.every((block) => block.kind !== "step"));
    assert.equal(threadBreakdown(threadId).compacted?.historyChars, 800);
    recordBreakdown(threadId, { systemPromptBytes: 400, systemToolsBytes: 0, mcpToolsBytes: 0, skillsBytes: 0, memoryBytes: 0 });
    assert.equal(threadBreakdown(threadId).compacted?.historyChars, 800);
    release!();
    await settle();
  }
});

test("a compaction is rebuilt from the trace as a plain notice, not as a steer", () => {
  const text = [
    JSON.stringify({ v: 1, thread: "dither", model: "z-ai/glm-5.3-flash" }),
    JSON.stringify({ id: "agent:dither", name: "This thread", kind: "agent", startedAt: 1787865075384, endedAt: 1787865075884, status: "ok" }),
    JSON.stringify({ id: "compact:dither:1", parentId: "agent:dither", name: "compact", kind: "compact", startedAt: 1787865075385, endedAt: 1787865075385, status: "ok", input: compactionNotice(3, true), output: "Actual summary" }),
  ].join("\n");
  const [block] = restoreBlocks("dither", decodeSpans(text));
  assert.deepEqual(block, { kind: "notice", text: "Context compacted — 3 turns became a summary", plain: true, compact: true, handoff: "Actual summary" });
  const fresh = [
    JSON.stringify({ v: 1, thread: "dither", model: "z-ai/glm-5.3-flash" }),
    JSON.stringify({ id: "agent:dither", name: "This thread", kind: "agent", startedAt: 1787865075384, endedAt: 1787865075884, status: "ok" }),
    JSON.stringify({ id: "compact:dither:1", parentId: "agent:dither", name: "compact", kind: "compact", startedAt: 1787865075385, endedAt: 1787865075385, status: "ok", input: compactionNotice(3, true, true), output: "Goal: ship" }),
  ].join("\n");
  const [rolled] = restoreBlocks("dither", decodeSpans(fresh));
  assert.deepEqual(rolled, { kind: "notice", text: "Fresh context — 3 turns dropped, handoff written by the model", plain: true, compact: true, handoff: "Goal: ship" });
});

test("a turn that ends refetches the thread, so the answer it wrote is drawn", async () => {
  let reloads = 0;
  request = (_method, params) => { sent.push(params.content); return new Promise<void>((resolve) => { release = resolve; }); };
  sendTurn("quiet", turn("PING-G"), () => { reloads += 1; });
  await settle();
  assert.equal(reloads, 0);

  release?.();
  await settle();
  assert.equal(runOf("quiet").sending, false);
  assert.equal(reloads, 1);
});

test("a retry notice refreshes activity without becoming the model's answer", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  sent.length = 0;
  request = (_method, params) => { sent.push(params.content); return new Promise<void>((resolve) => { release = resolve; }); };
  wire();
  sendTurn("retrying", turn("summarise the log"), () => undefined);
  await settle();
  assert.equal(runOf("retrying").activeAt, 1000);
  now = 2000;
  pushDelta({ threadId: "retrying", delta: "The model sent nothing (attempt 2 of 5), retrying in 4s\n", thinking: true, recovery: true });
  assert.equal(runOf("retrying").activeAt, 2000);
  assert.match(runOf("retrying").recovery, /attempt 2 of 5/);
  assert.deepEqual(runOf("retrying").blocks.at(-1), { kind: "notice", text: "The model sent nothing (attempt 2 of 5), retrying in 4s", plain: true });
  pushDelta({ threadId: "retrying", delta: "The model sent nothing (attempt 2 of 5), retrying in 4s\n", thinking: true, recovery: true });
  assert.equal(runOf("retrying").blocks.filter((block) => block.kind === "notice").length, 1);
  pushDelta({ threadId: "retrying", delta: "here it is" });
  assert.equal(runOf("retrying").recovery, "");
  assert.equal(runOf("retrying").activeAt, 2000);
  release!();
  await settle();
});

test("a fallback notice names the links that failed and admits OpenRouter gives no reason", () => {
  assert.equal(fallbackNotice("b/two:free", ["a/one:free"]), "Fell back to b/two:free — a/one:free was rate-limited, down, over context, or refused the request; OpenRouter reports the switch but not which");
  assert.match(fallbackNotice("c/three:free", ["a/one:free", "b/two:free"]), /a\/one:free and b\/two:free were/);
  assert.match(fallbackNotice("b/two:free", []), /the model above it was/);
});

test("a send during refresh has one drainer and preserves following prompts", async () => {
  const sent: string[] = [];
  const completed = new Map<string, () => void>();
  request = async (_method, params) => {
    sent.push(params.content);
    if (params.content !== "first") await new Promise<void>((resolve) => { completed.set(params.content, resolve); });
  };
  let finishRefresh!: () => void;
  let refreshes = 0;
  const refresh = () => ++refreshes === 1 ? new Promise<void>((resolve) => { finishRefresh = resolve; }) : undefined;
  sendTurn("refresh-race", turn("first"), refresh);
  await settle();
  sendTurn("refresh-race", turn("second"), refresh);
  sendTurn("refresh-race", turn("third"), refresh);
  finishRefresh();
  await settle();
  assert.deepEqual(sent, ["first", "second"]);
  assert.equal(runOf("refresh-race").sending, true);
  completed.get("second")!();
  await settle();
  assert.deepEqual(sent, ["first", "second", "third"]);
  completed.get("third")!();
  await settle();
  assert.equal(runOf("refresh-race").sending, false);
  assert.deepEqual(runOf("refresh-race").queue, []);
});

test("a failed refresh cannot strand the queue's drainer", async () => {
  const sent: string[] = [];
  request = async (_method, params) => { sent.push(params.content); };
  const reload = async () => { throw new Error("refresh failed"); };
  sendTurn("refresh-failed", turn("one"), reload);
  sendTurn("refresh-failed", turn("two"), reload);
  await settle();
  sendTurn("refresh-failed", turn("three"), () => undefined);
  await settle();
  assert.deepEqual(sent, ["one", "two", "three"]);
  assert.equal(runOf("refresh-failed").sending, false);
});

test("failed queued turns retain every prompt and its prepared context for retry", async () => {
  request = async () => { throw new Error("model unavailable"); };
  const params = { attachedImages: '["image-one"]', skillAttachmentId: "skill-one" };
  sendTurn("failed-context", { ...turn("first"), attached: true, prepare: async () => ({ params }) }, () => undefined);
  sendTurn("failed-context", turn("second"), () => undefined);
  await settle();
  assert.deepEqual(runOf("failed-context").held.map((item) => item.content), ["first", "second"]);
  assert.deepEqual(runOf("failed-context").held[0].params, params);
  const retries: unknown[] = [];
  request = async (_method, params) => { retries.push(params); };
  releaseHeld("failed-context", 0, () => undefined);
  releaseHeld("failed-context", 0, () => undefined);
  await settle();
  assert.deepEqual(retries, [
    { threadId: "failed-context", content: "first", ...params },
    { threadId: "failed-context", content: "second" },
  ]);
  assert.deepEqual(runOf("failed-context").held, []);
});
