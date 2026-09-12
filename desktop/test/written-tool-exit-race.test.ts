import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import ts from "typescript";

const file = process.env.SHINBO_WRITTEN_EXIT_SOURCE ?? path.join(__dirname, "../../main/main.ts");
const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "runDirectCommand")!.getText(source);

for (const stop of ["abort", "timeout"] as const) {
  for (const exit of ["success", "signal"] as const) {
    test(`direct command ${stop} never targets a PID after ${exit} exit while pipes drain`, async () => {
      const child = Object.assign(new EventEmitter(), {
        pid: 123456,
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      const controller = new AbortController();
      const killed: unknown[][] = [];
      let timeout = () => undefined;
      let cleared = 0;
      const run = Function("spawnCommand", "terminateProcessTree", "setTimeout", "clearTimeout", "MAX_COMMAND_MS", "MAX_COMMAND_OUTPUT", ts.transpile(`${declaration}\nreturn runDirectCommand;`, { target: ts.ScriptTarget.ES2022 }))(
        () => child,
        (...args: unknown[]) => { killed.push(args); return Promise.resolve(true); },
        (callback: () => undefined) => { timeout = callback; return { unref: () => undefined }; },
        () => { cleared += 1; },
        2000,
        16384,
      ) as (cwd: string, binary: string, args: string[], timeoutMs: number, raw: boolean, env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<string>;
      const result = run("C:\\work", "node.exe", [], 2000, false, {}, controller.signal).then((output) => ({ output }), (error: unknown) => ({ error }));
      child.stdout.write("completed output");
      child.exitCode = exit === "success" ? 0 : null;
      child.signalCode = exit === "signal" ? "SIGTERM" : null;
      child.emit("exit", child.exitCode, child.signalCode);
      if (stop === "abort") controller.abort();
      else timeout();
      child.emit("close", child.exitCode, child.signalCode);
      const completion = await result;
      assert.deepEqual(killed, []);
      if (stop === "timeout" && exit === "success") assert.deepEqual(completion, { output: "completed output" });
      assert.equal(cleared, 1);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      controller.abort();
      assert.deepEqual(killed, []);
    });
  }
}
