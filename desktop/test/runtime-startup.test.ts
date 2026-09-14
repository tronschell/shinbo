import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("App.tsx", readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let restore: ts.ArrowFunction | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("restoredModel.current")) {
    const find = (child: ts.Node) => {
      if (ts.isArrowFunction(child) && child.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) restore = child;
      ts.forEachChild(child, find);
    };
    find(node.arguments[0]);
  }
  ts.forEachChild(node, visit);
}
visit(source);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("T4 the workspace acknowledges readiness only after settings, privacy and model restoration", async () => {
  assert.ok(restore);
  const config = deferred();
  const model = deferred();
  const calls: string[] = [];
  const scope = {
    restoredModel: { current: true },
    settings: { selectedModel: "fallback", requireZeroRetention: true },
    syncMainPreferences: (settings: { requireZeroRetention: boolean }) => Promise.all([config.promise, scope.window.shinbo.setZeroRetention(settings.requireZeroRetention)]),
    SETTINGS_KEY: "settings", localStorage: { getItem: () => '{"selectedModel":"fallback"}' },
    reasonText: String, setError: (reason: string) => { throw new Error(reason); },
    window: { shinbo: {
      setZeroRetention: async (_value: boolean) => { calls.push("privacy"); },
      request: async () => { calls.push("model"); await model.promise; },
      runtimeReady: async () => { calls.push("ready"); },
    } },
  };
  const run = Function(...Object.keys(scope), ts.transpile(`return (${restore.getText(source)});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope))();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["privacy"]);
  config.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["privacy", "model"]);
  model.resolve();
  await run;
  assert.deepEqual(calls, ["privacy", "model", "ready"]);
});

test("T4 restoring preferences waits for the actual tool-settings operation", async () => {
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "syncMainPreferences");
  assert.ok(declaration);
  const tools = deferred();
  const api = new Proxy({}, { get: (_target, name) => name === "setToolSettings" ? () => tools.promise : async () => undefined });
  const sync = Function("window", "syncImprovements", "syncOverlayPreferences", ts.transpile(`${declaration.getText(source)}\nreturn syncMainPreferences;`, { target: ts.ScriptTarget.ES2022 }))({ shinbo: api }, () => {}, async () => undefined);
  let ready = false;
  const run = Promise.resolve(sync({})).then(() => { ready = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ready, false);
  tools.resolve();
  await run;
  assert.equal(ready, true);
});

test("T4 failed initialization reports the error and permits restoration after settings change", async () => {
  assert.ok(restore);
  const restoredModel = { current: true };
  const errors: string[] = [];
  const notices: string[] = [];
  const scope = {
    restoredModel, settings: {}, syncMainPreferences: async () => { throw new Error("Cannot restore tool settings"); },
    reasonText: String, setError: (error: string) => errors.push(error),
    window: { shinbo: { runtimeReady: async (error: string) => { notices.push(error); } } },
  };
  await Function(...Object.keys(scope), ts.transpile(`return (${restore.getText(source)});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope))();
  assert.equal(restoredModel.current, false);
  assert.match(notices[0], /Cannot restore tool settings/);
  assert.equal(errors.length, 1);
});
