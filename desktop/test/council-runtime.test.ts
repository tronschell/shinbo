import test from "node:test";
import assert from "node:assert/strict";
import { adoptCouncil, closeCouncil, configureCouncil, councilState, startCouncil, stopCouncil } from "../main/council";
import type { CouncilState, CouncilStart } from "../shared/council";

const request = (threadId: string, mode: CouncilStart["mode"] = "ask"): CouncilStart => ({ threadId, mode, question: "Compare two harmless approaches", seats: [{ id: "a", name: "A", model: "a" }, { id: "b", name: "B", model: "b" }] });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await tick(); assert.ok(check(), "the council settled"); }
const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: "TAKE: Keep the simpler approach\nA useful answer" } }] }));
function setup(options: { carried?: () => Promise<string>; land?: (state: CouncilState) => Promise<void>; emit?: (state: CouncilState) => void } = {}) {
  configureCouncil({ route: (model) => ({ settings: { model, endpoint: "http://fixture.invalid", credentialEnv: "", system: "" }, apiKey: "", modelId: model, plan: "" }), rates: () => ({ input: 0, output: 0 }), emit: options.emit ?? (() => undefined), carried: options.carried ?? (async () => ""), land: options.land ?? (async () => undefined) });
}

test("R4-C1 stop and close prevent paid drafts after delayed context arrives", async () => {
  const original = globalThis.fetch;
  try {
    for (const action of [stopCouncil, closeCouncil]) {
      let release!: (value: string) => void;
      const pending = new Promise<string>((resolve) => { release = resolve; });
      let calls = 0;
      globalThis.fetch = async () => { calls++; return reply(); };
      setup({ carried: () => pending });
      const id = `delayed-${action.name}`;
      await startCouncil(request(id));
      action(id);
      release("Saved context");
      await tick();
      closeCouncil(id);
      assert.equal(calls, 0);
    }
  } finally { globalThis.fetch = original; }
});

test("R4-C1 stopping aborts every pending council request", async () => {
  const original = globalThis.fetch;
  const pending: { signal: AbortSignal; release: () => void }[] = [];
  try {
    globalThis.fetch = async (_url, init) => new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!;
      pending.push({ signal, release: () => resolve(reply()) });
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    setup();
    await startCouncil(request("pending"));
    await until(() => pending.length === 2);
    stopCouncil("pending");
    assert.equal(pending.filter((call) => call.signal.aborted).length, 2);
    assert.equal(councilState("pending")?.phase, "stopped");
  } finally { closeCouncil("pending"); for (const call of pending) call.release(); await tick(); globalThis.fetch = original; }
});

test("R4-C1 late context failure cannot replace a stopped council with failure", async () => {
  let reject!: (error: Error) => void;
  const states: CouncilState[] = [];
  setup({ carried: () => new Promise<string>((_resolve, fail) => { reject = fail; }), emit: (state) => { states.push(state); } });
  await startCouncil(request("late-error"));
  stopCouncil("late-error");
  reject(new Error("Storage unavailable"));
  await tick();
  closeCouncil("late-error");
  assert.equal(states.at(-1)?.phase, "stopped");
});

test("R4-C2 a failed manual or automatic save remains retryable without new model calls", async () => {
  const original = globalThis.fetch;
  try {
    for (const mode of ["ask", "auto"] as const) {
      const id = `retry-${mode}`;
      let calls = 0;
      let writes = 0;
      let saved = 0;
      globalThis.fetch = async () => { calls++; return reply(); };
      setup({ land: async () => { if (++writes === 1) throw new Error("Disk temporarily unavailable"); saved++; } });
      await startCouncil(request(id, mode));
      await until(() => ["waiting", "failed"].includes(councilState(id)?.phase ?? ""));
      if (mode === "ask") await assert.rejects(adoptCouncil(id, ""), /Disk temporarily unavailable/);
      const completeCalls = calls;
      assert.equal(councilState(id)?.phase, "waiting");
      assert.match(councilState(id)?.error ?? "", /Disk temporarily unavailable/);
      assert.equal((await adoptCouncil(id, "")).phase, "done");
      assert.equal(saved, 1);
      assert.equal(calls, completeCalls);
      closeCouncil(id);
    }
  } finally { globalThis.fetch = original; }
});

test("R4-C2 completion is emitted only after one durable adoption finishes", async () => {
  const original = globalThis.fetch;
  let release!: () => void;
  let writes = 0;
  const states: CouncilState[] = [];
  try {
    globalThis.fetch = async () => reply();
    setup({ emit: (state) => { states.push(state); }, land: () => { writes++; return new Promise<void>((resolve) => { release = resolve; }); } });
    await startCouncil(request("single-save"));
    await until(() => councilState("single-save")?.phase === "waiting");
    const saving = adoptCouncil("single-save", "a");
    await assert.rejects(adoptCouncil("single-save", "b"));
    const completedBeforeCommit = states.filter((state) => state.phase === "done").length;
    release();
    await saving;
    assert.equal(completedBeforeCommit, 0);
    assert.equal(writes, 1);
    assert.equal(councilState("single-save")?.winnerId, "a");
  } finally { release?.(); closeCouncil("single-save"); globalThis.fetch = original; }
});
