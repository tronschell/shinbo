import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gitSnapshot } from "../main/git";
import { Terminals } from "../main/terminal";

const PATCH_LIMIT = 512 * 1024;

async function writeWhenReleased(file: string, text: string) {
  for (let attempt = 0; ; attempt++) {
    try { return writeFileSync(file, text); } catch (error) {
      if (attempt >= 40 || process.platform !== "win32") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

test("Git patch collection bounds bytes and stops scheduling files after the visible patch fills", async (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), "shinbo-patch-budget-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  run("init", "-qb", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  run("config", "core.autocrlf", "false");
  writeFileSync(path.join(repo, "tracked.txt"), "before\n");
  run("add", ".");
  run("commit", "-qm", "initial");
  const large = "generated output line\n".repeat(100_000);
  for (let index = 0; index < 20; index++) writeFileSync(path.join(repo, `generated-${String(index).padStart(2, "0")}.txt`), large);
  const original = childProcess.execFile;
  let patchBytes = 0;
  const calls = t.mock.method(childProcess, "execFile", ((...args: unknown[]) => {
    const argv = args[1] as string[];
    const callback = args.pop() as (...values: unknown[]) => void;
    return Reflect.apply(original, childProcess, [...args, (...values: unknown[]) => {
      if (argv.includes("diff")) patchBytes += Buffer.byteLength(String(values[1]));
      callback(...values);
    }]);
  }) as typeof childProcess.execFile);
  const created = await gitSnapshot(repo);
  assert.ok(created);
  assert.equal(created.files.length, 20);
  assert.equal(created.truncated, true);
  assert.ok(created.diff.length <= PATCH_LIMIT);
  assert.match(created.diff, /generated-00.txt/);
  assert.match(created.diff, /\+generated output line/);
  assert.ok(patchBytes <= 4 * (PATCH_LIMIT + 1));
  assert.equal(calls.mock.calls.filter((call) => (call.arguments[1] as string[]).includes("--no-index")).length, 4);

  await writeWhenReleased(path.join(repo, "tracked.txt"), large);
  calls.mock.resetCalls();
  patchBytes = 0;
  const tracked = await gitSnapshot(repo);
  assert.ok(tracked);
  assert.equal(tracked.files.length, 21);
  assert.equal(tracked.truncated, true);
  assert.match(tracked.diff, /tracked.txt/);
  assert.ok(patchBytes <= PATCH_LIMIT + 1);
  assert.equal(calls.mock.calls.filter((call) => (call.arguments[1] as string[]).includes("--no-index")).length, 0);

  for (let index = 0; index < 20; index++) rmSync(path.join(repo, `generated-${String(index).padStart(2, "0")}.txt`));
  await writeWhenReleased(path.join(repo, "tracked.txt"), "after\n");
  writeFileSync(path.join(repo, "a.txt"), "small 🦄 patch\n");
  writeFileSync(path.join(repo, "b.txt"), "second patch\n");
  const expected = [run("diff", "--no-color", "HEAD").toString(), ...["a.txt", "b.txt"].map((file) =>
    childProcess.spawnSync("git", ["diff", "--no-color", "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", file], { cwd: repo, encoding: "utf8" }).stdout)].join("\n");
  const small = await gitSnapshot(repo);
  assert.equal(small!.diff, expected);
  assert.equal(small!.truncated, false);

  await writeWhenReleased(path.join(repo, "tracked.txt"), `readable prefix\n${"🦄".repeat(200_000)}\n`);
  const unicode = await gitSnapshot(repo);
  assert.equal(unicode!.truncated, true);
  assert.match(unicode!.diff, /\+readable prefix/);
  assert.doesNotMatch(unicode!.diff, /\uFFFD|[\uD800-\uDBFF]$/);
  assert.ok(Buffer.byteLength(unicode!.diff) <= PATCH_LIMIT);
});

test("terminal output batches preserve replay boundaries, final bytes, and flush reentrancy", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scheduled = t.mock.method(globalThis, "setTimeout");
  const cleared = t.mock.method(globalThis, "clearTimeout");
  const children: ReturnType<typeof makeChild>[] = [];
  function makeChild() {
    return Object.assign(new EventEmitter(), {
      stdin: new EventEmitter(), stdout: new EventEmitter(), stderr: new EventEmitter(),
    });
  }
  t.mock.method(childProcess, "spawn", () => {
    const child = makeChild();
    children.push(child);
    return child;
  });
  const output: { id: string; data: Buffer; at: number }[] = [];
  let emitDuringFlush = false;
  const terminals = new Terminals(() => "pty", (id, data, at) => {
    output.push({ id, data, at });
    if (emitDuringFlush) { emitDuringFlush = false; children[0].stdout.emit("data", Buffer.from("later")); }
  }, () => undefined);
  const open = () => terminals.open({ threadId: "thread", cwd: process.cwd(), columns: 80, rows: 24 });
  const tab = open();
  for (let index = 0; index < 1000; index++) children[0].stdout.emit("data", Buffer.from("x"));
  assert.equal(output.length, 0);
  t.mock.timers.tick(15);
  assert.equal(output.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(output, [{ id: tab.id, data: Buffer.from("x".repeat(1000)), at: 1000 }]);

  children[0].stdout.emit("data", Buffer.from("before"));
  emitDuringFlush = true;
  const replay = terminals.buffer(tab.id);
  assert.equal(replay.at, 1006);
  assert.equal(replay.data.toString(), `${"x".repeat(1000)}before`);
  children[0].stderr.emit("data", Buffer.from("after"));
  t.mock.timers.tick(16);
  const afterReplay = output.filter((chunk) => chunk.at > replay.at);
  assert.deepEqual(afterReplay.map(({ data, at }) => [data.toString(), at]), [["laterafter", 1016]]);

  children[0].stdout.emit("data", Buffer.from("final"));
  children[0].emit("exit", 0);
  assert.match(output.at(-1)!.data.toString(), /^final\r\n\[session ended\]/);
  assert.equal(terminals.list()[0].running, false);
  children[0].stdout.emit("data", Buffer.from("drained after exit"));
  children[0].emit("close", 0);
  assert.equal(output.at(-1)!.data.toString(), "drained after exit");
  const afterExit = output.length;
  t.mock.timers.tick(1000);
  assert.equal(output.length, afterExit);

  const closing = open();
  children[1].stdout.emit("data", Buffer.from("closing"));
  terminals.close(closing.id);
  const afterClose = output.length;
  children[1].stdout.emit("data", Buffer.from("discarded after close"));
  t.mock.timers.tick(1000);
  assert.equal(output.length, afterClose);
  assert.equal(output.at(-1)!.data.toString(), "closing");

  open();
  children[2].stdout.emit("data", Buffer.alloc(64 * 1024, 97));
  assert.equal(output.at(-1)!.data.length, 64 * 1024);
  children[2].stdout.emit("data", Buffer.from("stop"));
  await terminals.stopAll();
  assert.equal(output.at(-1)!.data.toString(), "stop");
  const afterStop = output.length;
  t.mock.timers.tick(1000);
  assert.equal(output.length, afterStop);
  assert.equal(terminals.list().length, 0);
  for (const timer of scheduled.mock.calls) assert.ok(cleared.mock.calls.some((call) => call.arguments[0] === timer.result));
});
