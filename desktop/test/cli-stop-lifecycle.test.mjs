import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(new URL("../dist-main/main/cli.js", import.meta.url));
const source = readFileSync(process.env.CLI_SOURCE || new URL("../main/cli.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ windows = false, delayedKill = false } = {}) {
  const timers = new Set();
  const children = [];
  const kills = [];
  const timeout = (callback, ms) => { const timer = { callback, ms, unref() {}, refresh() {} }; timers.add(timer); return timer; };
  const platform = { ...require("./platform"), isWindows: windows, windowsShimTarget: async () => undefined,
    spawnCommand: () => {
      const child = new EventEmitter();
      Object.assign(child, { pid: 2000 + children.length, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
      child.stdout.setEncoding = () => {};
      child.close = () => { child.signalCode = "SIGTERM"; child.emit("close", null, "SIGTERM"); };
      children.push(child);
      return child;
    },
    terminateProcessTree: (pid, signal = "SIGTERM") => {
      const call = { pid, signal };
      kills.push(call);
      return delayedKill ? new Promise((resolve) => { call.finish = resolve; }) : Promise.resolve(true);
    },
  };
  const exports = {};
  new Function("exports", "require", "setTimeout", "clearTimeout", "AbortSignal", code)(exports, (id) => id === "./platform" ? platform : require(id), timeout, (timer) => timers.delete(timer), {
    timeout: (ms) => { const controller = new AbortController(); timeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms); return controller.signal; },
  });
  const runs = new exports.CliRuns(() => {});
  runs.paths.set("claude", "/fake/claude");
  const start = () => runs.start({ threadId: "fixture", cli: "claude", prompt: "Disposable work", cwd: "/tmp", folder: "fixture", unattended: false });
  const expire = () => { for (const timer of [...timers]) if (timer.ms === 2000) { timers.delete(timer); timer.callback(); } };
  return { runs, children, kills, timers, start, expire };
}

test("Stop immediately after a CLI retry targets its new child and leaves the previous PID alone", { timeout: 2000 }, async (t) => {
  const f = fixture();
  const first = f.start();
  while (!f.children.length) await tick();
  const id = f.runs.list()[0].id;
  assert.equal(f.runs.stop(id), true);
  await tick();
  f.children[0].close();
  await first;
  const retry = f.runs.send(id, "Retry disposable work");
  while (f.children.length < 2) await tick();
  assert.equal(f.runs.stop(id), true);
  await tick();
  const newChildSignals = f.kills.filter((call) => call.pid === f.children[1].pid).length;
  f.expire();
  await tick();
  const oldChildSignals = f.kills.filter((call) => call.pid === f.children[0].pid).length;
  f.children[1].close();
  await retry;
  t.diagnostic(JSON.stringify({ newChildSignals, oldChildSignals }));
  assert.equal(newChildSignals, 1);
  assert.equal(oldChildSignals, 1);
});

test("old delayed stop cleanup cannot deduplicate or delete a replacement child's stop", { timeout: 2000 }, async () => {
  const f = fixture({ delayedKill: true });
  const first = f.start();
  while (!f.children.length) await tick();
  const id = f.runs.list()[0].id;
  f.runs.stop(id);
  f.children[0].close();
  await first;
  const retry = f.runs.send(id, "Retry disposable work");
  while (f.children.length < 2) await tick();
  f.runs.stop(id);
  const signals = f.kills.map((call) => call.pid);
  f.kills[0].finish(true);
  await tick();
  f.runs.stop(id);
  const signalsAfterOldCleanup = f.kills.map((call) => call.pid);
  f.children[1].close();
  for (const call of f.kills) call.finish(true);
  await retry;
  await tick();
  assert.deepEqual(signals, [2000, 2001]);
  assert.deepEqual(signalsAfterOldCleanup, [2000, 2001]);
  assert.equal(f.runs.stopping.size, 0);
});

for (const windows of [false, true]) {
  test(`${windows ? "Windows skips an exited child" : "POSIX keeps the owned group"} before pipe closure`, { timeout: 2000 }, async () => {
    const f = fixture({ windows });
    const pending = f.start();
    while (!f.children.length) await tick();
    const child = f.children[0];
    child.exitCode = 0;
    child.emit("exit", 0, null);
    f.runs.stop(f.runs.list()[0].id);
    await tick();
    const signals = f.kills.length;
    child.close();
    await pending;
    assert.equal(signals, windows ? 0 : 1);
  });
}

test("repeated Stop shares one child shutdown and escalates only after its grace period", { timeout: 2000 }, async () => {
  const f = fixture();
  const pending = f.start();
  while (!f.children.length) await tick();
  const id = f.runs.list()[0].id;
  f.runs.stop(id);
  f.runs.stop(id);
  await tick();
  assert.deepEqual(f.kills.map((call) => call.signal), ["SIGTERM"]);
  f.expire();
  await tick();
  assert.deepEqual(f.kills.map((call) => call.signal), ["SIGTERM", "SIGKILL"]);
  f.children[0].close();
  await pending;
  await tick();
  assert.equal(f.runs.stopping.size, 0);
});

test("shutdown settles on child close and preserves its final buffered output", { timeout: 2000 }, async () => {
  const f = fixture();
  const pending = f.start();
  while (!f.children.length) await tick();
  const id = f.runs.list()[0].id;
  const stopping = f.runs.stopAll();
  await tick();
  f.children[0].stdout.emit("data", "Final output before shutdown\n");
  f.children[0].close();
  await pending;
  let settled = false;
  void stopping.then(() => { settled = true; });
  await tick();
  const finishedOnClose = settled;
  f.expire();
  await stopping;
  assert.equal(finishedOnClose, true);
  assert.equal(f.runs.output(id, 1000).result, "Final output before shutdown\n");
  assert.equal(f.children[0].listenerCount("close"), 0);
  assert.equal(f.runs.stopping.size, 0);
});


test("an old close after spawn error cannot finish or detach a replacement child", { timeout: 2000 }, async () => {
  const f = fixture();
  const first = f.start();
  while (!f.children.length) await tick();
  const id = f.runs.list()[0].id;
  f.children[0].emit("error", new Error("Fixture spawn failure"));
  await first;
  const retry = f.runs.send(id, "Retry disposable work");
  while (f.children.length < 2) await tick();
  f.children[0].close();
  const stateAfterOldClose = f.runs.get(id);
  const heldChild = f.runs.runs.get(id).child;
  const accepted = f.runs.stop(id);
  f.children[1].close();
  assert.equal(stateAfterOldClose.status, "running");
  assert.equal(heldChild, f.children[1]);
  assert.equal(accepted, true);
  await retry;
  assert.equal(f.runs.get(id).status, "failed");
  assert.equal([...f.timers].filter((timer) => timer.ms === 30 * 60 * 1000).length, 0);
});
