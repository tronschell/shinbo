import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(new URL("../dist-main/main/secret.js", import.meta.url));
const secretSource = readFileSync(process.env.SHINBO_SECRET_CANCEL_SOURCE || new URL("../main/secret.ts", import.meta.url), "utf8");
const code = ts.transpileModule(secretSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function("exports", "require", code)(exports, require);
const { readSecret } = exports;
const settings = { model: "fixture/reader", endpoint: "https://unused.invalid", credentialEnv: "", system: "Fixture reader" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function tool(runCommand, signal, read = readSecret) {
  const main = ts.createSourceFile("main.ts", readFileSync(process.env.SHINBO_SECRET_MAIN_SOURCE || new URL("../main/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const execute = main.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "executeTool");
  const clause = execute.body.statements.find(ts.isSwitchStatement).caseBlock.clauses.find((node) => ts.isCaseClause(node) && node.expression.text === "secret");
  const body = clause.statements.map((node) => node.getText(main)).join("\n");
  const bindings = { runCommand, readSecret: read, agents: { signalFor: (id) => { assert.equal(id, "fixture-thread"); return signal; } }, toolSettings: { secret: settings }, args: { command: "fixture-output", question: "Is the fixture set?" }, turn: { threadId: "fixture-thread" }, threadFolder: () => undefined, homedir: () => "/fixture", MAX_COMMAND_MS: 60_000 };
  return new Function(...Object.keys(bindings), `return (async () => { ${ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText} })();`)(...Object.values(bindings));
}

test("the foreground secret command receives the run signal and Stop prevents reader dispatch", { timeout: 2000 }, async (t) => {
  const controller = new AbortController();
  let commandSignal;
  let release;
  let readers = 0;
  const result = tool(async (_cwd, _command, _timeout, signal) => {
    commandSignal = signal;
    await new Promise((resolve) => { release = resolve; });
    return "DISPOSABLE_FIXTURE=present";
  }, controller.signal, (...args) => readSecret(...args.slice(0, 4), async () => { readers++; return "Fixture is present."; }, args[5])).catch((error) => error);
  controller.abort(new Error("stopped during command"));
  release();
  const answer = await result;
  t.diagnostic(JSON.stringify({ commandSignalForwarded: commandSignal === controller.signal, readerRequestsAfterStop: readers }));
  assert.equal(commandSignal, controller.signal);
  assert.equal(readers, 0);
  assert.match(answer.message, /stopped during command/);
});

test("already-stopped secret reads do not invoke the model or prepare its messages", { timeout: 2000 }, async () => {
  let reads = 0;
  const configured = { ...settings, get model() { reads++; return "fixture/reader"; } };
  await assert.rejects(readSecret(configured, "fixture", "DISPOSABLE_FIXTURE=present", "q", async () => { throw new Error("reader invoked"); }, AbortSignal.abort(new Error("stopped before reader"))), /stopped before reader/);
  assert.equal(reads, 0);
});

test("Stop aborts the shared reader fetch while preserving its original cancellation reason", { timeout: 2000 }, async (t) => {
  const controller = new AbortController();
  let seen;
  let release;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    seen = init.signal;
    await new Promise((resolve, reject) => {
      release = () => reject(new Error("fixture timeout"));
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  });
  const result = readSecret(settings, "fixture", "DISPOSABLE_FIXTURE=present", "q", undefined, controller.signal).catch((error) => error);
  controller.abort(new Error("stopped during reader"));
  await tick();
  const abortedAtStop = seen.aborted;
  release();
  const error = await result;
  t.diagnostic(JSON.stringify({ readerFetchAbortedAtStop: abortedAtStop }));
  assert.equal(abortedAtStop, true);
  assert.match(error.message, /stopped during reader/);
});

test("Stop while the reader body is pending rejects without returning its late answer", { timeout: 2000 }, async (t) => {
  const controller = new AbortController();
  let began;
  const reading = new Promise((resolve) => { began = resolve; });
  t.mock.method(globalThis, "fetch", async (_url, init) => ({ ok: true, json: () => new Promise((resolve, reject) => {
    began();
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }) }));
  const result = readSecret(settings, "fixture", "DISPOSABLE_FIXTURE=present", "q", undefined, controller.signal);
  await reading;
  controller.abort(new Error("stopped during reader body"));
  await assert.rejects(result, /stopped during reader body/);
});

test("a reader which finishes after Stop cannot publish its answer", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let release;
  const result = readSecret(settings, "fixture", "DISPOSABLE_FIXTURE=present", "q", () => new Promise((resolve) => { release = resolve; }), controller.signal);
  controller.abort(new Error("stopped before reader settled"));
  release("Late fixture answer");
  await assert.rejects(result, /stopped before reader settled/);
});

test("ordinary reader errors and bounded fake-output handling remain unchanged", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const failure = new Error("fixture provider unavailable");
  await assert.rejects(readSecret(settings, "fixture", "DISPOSABLE_FIXTURE=present", "q", async () => { throw failure; }, controller.signal), (error) => error === failure);
  await assert.rejects(readSecret(settings, "fixture", "DISPOSABLE_FIXTURE=present", "q", async () => "  ", controller.signal), /returned nothing/);
  let sent;
  const answer = await readSecret(settings, "fixture", `${"x".repeat(32_000)}SHOULD_BE_CLIPPED`, "q", async (_settings, messages, key, options) => {
    sent = messages;
    assert.equal(key, "");
    assert.equal(options.signal, controller.signal);
    assert.equal(options.timeoutMs, 60_000);
    return "The disposable fixture is present.";
  }, controller.signal);
  assert.doesNotMatch(JSON.stringify(sent), /SHOULD_BE_CLIPPED/);
  assert.match(answer, /The disposable fixture is present/);
  assert.doesNotMatch(answer, /x{100}/);
});
