import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, getEventListeners } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import ts from "typescript";
import { AgentRuntime } from "../main/agent-loop";
import { withoutCredentials } from "../main/credentials";
import * as platform from "../main/platform";
import { shellQuoted, type ToolArgs } from "../main/tools";

const file = process.env.SHINBO_WRITTEN_TOOL_SOURCE ?? path.join(__dirname, "../../main/main.ts");
const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const names = ["runCommand", "runWrittenTool", "runDirectCommand", "executeTool"];
const code = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? "")).map((node) => node.getText(source)).join("\n");
const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function load(overrides: Record<string, unknown> = {}) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const deps = {
    ...platform, spawn, path, readFileSync, shellQuoted, withoutCredentials, MAX_COMMAND_MS: 2000, MAX_COMMAND_OUTPUT: 16384,
    setTimeout: (callback: () => void, ms: number) => { const timer = setTimeout(callback, ms); timers.add(timer); return timer; },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); clearTimeout(timer); },
    ...overrides,
  };
  return {
    timers,
    ...Function(...Object.keys(deps), ts.transpile(`${code}\nreturn { runCommand, runWrittenTool, runDirectCommand, executeTool };`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(deps)) as {
      runWrittenTool: (cwd: string, file: string, input: string, signal?: AbortSignal) => Promise<string>;
      runCommand: (cwd: string, command: string, timeoutMs?: number, signal?: AbortSignal) => Promise<string>;
      runDirectCommand: (cwd: string, binary: string, args: string[], timeoutMs?: number, raw?: boolean, env?: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<string>;
      executeTool: (args: ToolArgs, turn: { threadId: string }) => Promise<string>;
    },
  };
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("Stop terminates the owned foreground written-tool process tree", { skip: platform.isWindows }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "shinbo-written-stop-"));
  const script = path.join(directory, "tool");
  const pidfile = path.join(directory, "pids.json");
  const worker = path.join(directory, "worker.cjs");
  writeFileSync(worker, "const fs=require('node:fs');const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e','while(true){}'],{stdio:'inherit'});fs.writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));console.log('started');setInterval(()=>{},1000);");
  writeFileSync(script, `#!/bin/sh\n${shellQuoted(process.execPath)} ${shellQuoted(worker)} "$1"\n`, { mode: 0o700 });
  const agents = new AgentRuntime({ request: async () => ({}), ask: () => {}, answered: () => {}, verify: async () => ({ model: "", prompt: "", reply: "", attempts: 0 }), advise: async () => ({ model: "", text: "" }), spawnTurn: () => {}, changed: () => {}, step: () => {} });
  agents.adopt({ threadId: "owned", content: "Run tool", title: "Tool", mode: "ask" });
  const signal = agents.signalFor("owned")!;
  let child: ChildProcess | undefined;
  const runner = load({
    spawn: (...args: Parameters<typeof spawn>) => { child = spawn(...args); return child; },
    agents, app: { getPath: () => directory }, toolSettings: { disabledTools: [] },
    listShinboTools: async () => [{ name: "owned", description: "Owned test tool", run: script }],
    threadFolder: () => undefined,
  });
  const result = runner.executeTool({ name: "run_tool", tool: "owned", input: pidfile }, { threadId: "owned" }).then((output) => ({ output, error: undefined }), (error: Error) => ({ output: undefined, error }));
  try {
    for (let at = 0; !existsSync(pidfile) && at < 100; at += 1) await wait(10);
    const pids = [child!.pid!, ...JSON.parse(readFileSync(pidfile, "utf8")) as number[]];
    assert.equal(pids.filter(alive).length, 3);
    agents.stop("owned");
    await wait(200);
    assert.equal(pids.filter(alive).length, 0);
    assert.equal((await result).error?.name, "AbortError");
    assert.equal(getEventListeners(signal, "abort").length, 0);
    assert.equal(runner.timers.size, 0);
  } finally {
    if (child?.pid) await platform.terminateProcessTree(child.pid, "SIGKILL");
    await result;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Stop during tool listing retains the original signal and prevents the later spawn", async () => {
  const controller = new AbortController();
  let current = controller.signal;
  let release: (value: unknown[]) => void = () => undefined;
  let launches = 0;
  const runner = load({
    agents: { signalFor: () => current }, app: { getPath: () => "/fixture" }, toolSettings: { disabledTools: [] },
    listShinboTools: () => new Promise<unknown[]>((resolve) => { release = resolve; }),
    threadFolder: () => undefined,
    spawn: () => { launches += 1; throw new Error("Must not launch"); },
    spawnCommand: () => { launches += 1; throw new Error("Must not launch"); },
  });
  const result = runner.executeTool({ name: "run_tool", tool: "held" }, { threadId: "owned" });
  controller.abort();
  current = new AbortController().signal;
  release([{ name: "held", run: "/fixture/tool" }]);
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(launches, 0);
  assert.equal(runner.timers.size, 0);
});

function fakeChild() {
  return Object.assign(new EventEmitter(), { pid: 123456, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
}

for (const finish of ["success", "error", "timeout", "abort"] as const) {
  test(`Windows interpreter execution preserves literal arguments and cleans up on ${finish}`, async () => {
    const child = fakeChild();
    const controller = new AbortController();
    const killed: unknown[][] = [];
    const input = 'literal "input" & $(never execute)';
    let launch: unknown[] = [];
    const runner = load({
      isWindows: true,
      readFileSync: () => "#!/usr/bin/env node\n",
      findExecutable: async () => "C:\\Program Files\\node.exe",
      MAX_COMMAND_MS: 20,
      spawnCommand: (...args: unknown[]) => { launch = args; return child; },
      terminateProcessTree: (...args: unknown[]) => { killed.push(args); queueMicrotask(() => child.emit("close", null)); return Promise.resolve(true); },
    });
    const result = runner.runWrittenTool("C:\\work", "C:\\tools\\saved tool", input, controller.signal);
    await wait();
    assert.equal(launch[0], "C:\\Program Files\\node.exe");
    assert.deepEqual(launch[1], ["C:\\tools\\saved tool", input]);
    assert.deepEqual(launch[2], { cwd: "C:\\work", env: withoutCredentials(process.env), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout.write("kept output 日本語\n");
    if (finish === "abort") {
      controller.abort();
      await assert.rejects(result, { name: "AbortError" });
    } else {
      if (finish === "success") child.emit("close", 0);
      if (finish === "error") child.emit("error", new Error("cannot spawn"));
      const output = await result;
      assert.equal(output, finish === "success" ? "kept output 日本語" : finish === "error" ? "That tool could not start: cannot spawn" : "kept output 日本語\n[killed after 0.02s]");
    }
    assert.deepEqual(killed, finish === "abort" || finish === "timeout" ? [[child.pid, "SIGKILL", false]] : []);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal(runner.timers.size, 0);
    controller.abort();
    await wait();
    assert.equal(killed.length, finish === "abort" || finish === "timeout" ? 1 : 0);
  });
}

test("abort during Windows interpreter lookup prevents execution", async () => {
  const controller = new AbortController();
  let launches = 0;
  const runner = load({ isWindows: true, readFileSync: () => "#!/usr/bin/env python3\n", findExecutable: async () => { controller.abort(); return "C:\\python.exe"; }, spawnCommand: () => { launches += 1; throw new Error("Must not launch"); } });
  await assert.rejects(runner.runWrittenTool("C:\\work", "C:\\tool", "", controller.signal), { name: "AbortError" });
  assert.equal(launches, 0);
});

test("completed writes and unsignaled commands retain their existing results", { skip: platform.isWindows }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "shinbo-written-complete-"));
  const output = path.join(directory, "output.txt");
  const script = path.join(directory, "tool");
  const controller = new AbortController();
  writeFileSync(script, '#!/bin/sh\nprintf "%s" "$1" > output.txt\nprintf "saved 日本語"\n', { mode: 0o700 });
  const runner = load();
  try {
    assert.equal(await runner.runWrittenTool(directory, script, "complete contents", controller.signal), "saved 日本語");
    controller.abort();
    assert.equal(readFileSync(output, "utf8"), "complete contents");
    assert.equal(await runner.runCommand(directory, 'printf "unchanged"'), "unchanged");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal(runner.timers.size, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const isWindows of [true, false]) {
  for (const action of ["abort", "timeout"] as const) {
    for (const exited of ["success", "signal"] as const) {
      test(`${isWindows ? "Windows" : "POSIX"} shell ${action} after ${exited} exit preserves the correct process-tree target`, async () => {
        const child = fakeChild();
        const controller = new AbortController();
        const killed: unknown[][] = [];
        const runner = load({ isWindows, spawn: () => child, terminateProcessTree: (...args: unknown[]) => { killed.push(args); return Promise.resolve(true); } });
        const result = runner.runCommand("fixture", "fixture", 20, controller.signal);
        child.stdout.write("completed output");
        const code = exited === "success" ? 0 : null;
        const signal = exited === "signal" ? "SIGTERM" : null;
        Object.assign(child, { exitCode: code, signalCode: signal });
        child.emit("exit", code, signal);
        if (action === "abort") controller.abort();
        else await wait(30);
        assert.deepEqual(killed, isWindows ? [] : [[child.pid, "SIGKILL"]]);
        child.emit("close", code, signal);
        if (action === "abort") await assert.rejects(result, { name: "AbortError" });
        else assert.equal(await result, exited === "success" ? "completed output" : "completed output\n[killed after 0.02s]");
        assert.equal(getEventListeners(controller.signal, "abort").length, 0);
        assert.equal(runner.timers.size, 0);
      });
    }
  }
}

test("Windows shell abort still terminates a live process tree and releases its resources", async () => {
  const child = fakeChild();
  const controller = new AbortController();
  const killed: unknown[][] = [];
  const runner = load({ isWindows: true, spawn: () => child, terminateProcessTree: (...args: unknown[]) => { killed.push(args); queueMicrotask(() => child.emit("close", null, "SIGKILL")); return Promise.resolve(true); } });
  const result = runner.runCommand("fixture", "fixture", 1000, controller.signal);
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.deepEqual(killed, [[child.pid, "SIGKILL"]]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(runner.timers.size, 0);
});
