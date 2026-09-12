import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(new URL("../dist-main/main/cli.js", import.meta.url));
const source = readFileSync(process.env.CLI_SOURCE || new URL("../main/cli.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function("exports", "require", code)(exports, require);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (ready) => { for (let at = 0; at < 300; at++) { if (ready()) return; await pause(10); } throw new Error("Disposable CLI did not reach its expected state"); };
const running = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const directoryFor = (script) => {
  const directory = mkdtempSync(path.join(tmpdir(), "shinbo-cli-stop-native-"));
  const binary = path.join(directory, "pi");
  writeFileSync(binary, `#!${process.execPath}\n${script}\n`, { mode: 0o700 });
  const runs = new exports.CliRuns(() => {});
  runs.paths.set("pi", binary);
  return { directory, runs, start: () => runs.start({ threadId: "fixture", cli: "pi", prompt: "Disposable process test", cwd: directory, folder: "fixture", unattended: false }) };
};

test("a real retried CLI process exits after its own accepted Stop", { skip: process.platform === "win32", timeout: 10_000 }, async (t) => {
  const f = directoryFor('process.on("SIGTERM", () => setTimeout(() => process.exit(0), 80)); process.stdout.write("READY\\n"); setTimeout(() => process.exit(0), 6000);');
  let child;
  let first;
  let retry;
  try {
    first = f.start();
    await until(() => f.runs.list()[0] && f.runs.output(f.runs.list()[0].id, 1000).result.includes("READY"));
    const id = f.runs.list()[0].id;
    assert.equal(f.runs.stop(id), true);
    await first;
    retry = f.runs.send(id, "Retry disposable process");
    await until(() => f.runs.get(id).turns === 2 && f.runs.runs.get(id).child && f.runs.output(id, 1000).result.includes("READY"));
    child = f.runs.runs.get(id).child;
    const accepted = f.runs.stop(id);
    await pause(250);
    const aliveAfterStop = running(child.pid);
    t.diagnostic(JSON.stringify({ accepted, aliveAfterStop }));
    if (aliveAfterStop) child.kill("SIGKILL");
    await retry;
    assert.equal(accepted, true);
    assert.equal(aliveAfterStop, false);
  } finally {
    child?.kill("SIGKILL");
    for (const entry of f.runs.runs.values()) entry.child?.kill("SIGKILL");
    await Promise.allSettled([first, retry]);
    await f.runs.stopAll();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("CLI Stop escalates its detached POSIX group when a descendant keeps pipes open after leader exit", { skip: process.platform === "win32", timeout: 10_000 }, async (t) => {
  const descendant = 'process.on("SIGTERM", () => {}); process.stdout.write(`DESC ${process.pid}\\n`); setTimeout(() => process.exit(0), 6000);';
  const f = directoryFor(`const {spawn}=require("node:child_process"); process.on("SIGTERM",()=>process.exit(0)); spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:["ignore","inherit","inherit"]});`);
  let pending;
  let child;
  try {
    pending = f.start();
    await until(() => f.runs.list()[0] && /DESC \d+/.test(f.runs.output(f.runs.list()[0].id, 1000).result));
    const id = f.runs.list()[0].id;
    const descendantPid = Number(f.runs.output(id, 1000).result.match(/DESC (\d+)/)[1]);
    child = f.runs.runs.get(id).child;
    f.runs.stop(id);
    await until(() => child.exitCode !== null);
    assert.equal(f.runs.get(id).status, "running");
    assert.equal(running(descendantPid), true);
    await pending;
    await until(() => !running(descendantPid));
    t.diagnostic(JSON.stringify({ leaderExitedBeforePipeClose: true, descendantAliveAfterStop: running(descendantPid) }));
    assert.equal(f.runs.get(id).status, "idle");
  } finally {
    if (child && [...f.runs.runs.values()].some((entry) => entry.child === child)) { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { void error; } }
    await Promise.allSettled([pending]);
    await f.runs.stopAll();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
