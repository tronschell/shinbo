import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("App.tsx", readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string, root: ts.Node = source): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(source) === name) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(root);
  assert.ok(found, name);
  return found;
}
function load<T>(name: string, globals: Record<string, unknown>, root: ts.Node = source): T {
  const node = declaration(name, root);
  const text = `${ts.isVariableDeclaration(node) ? "const " : ""}${node.getText(source)};\n${name};`;
  return runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { ...globals }) as T;
}

test("thread picker saves the selected thread only and updates UI after persistence", async () => {
  const calls: unknown[] = [];
  let done!: () => void;
  const change = load<(next: unknown) => Promise<void>>("changeThreadModel", {
    thread: { id: "a" },
    window: { emma: { request: (method: string, params: unknown) => { calls.push({ method, params }); return new Promise<void>((resolve) => { done = resolve; }); } } },
    onModelChanged: (next: unknown) => calls.push(next),
  });
  const next = { selectedModel: "provider:one", thinkingLevel: "high" };
  const saving = change(next);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { method: "setThreadModel", params: { threadId: "a", modelId: "provider:one", effort: "high" } });
  done();
  await saving;
  assert.equal(calls[1], next);
});

test("failed model persistence does not change the displayed selection", async () => {
  let changed = false;
  const change = load<(next: unknown) => Promise<void>>("changeThreadModel", {
    thread: { id: "a" },
    window: { emma: { request: async () => { throw new Error("Unavailable model"); } } },
    onModelChanged: () => { changed = true; },
  });
  await assert.rejects(change({ selectedModel: "provider:missing", thinkingLevel: "" }), /Unavailable model/);
  assert.equal(changed, false);
});

test("thinking uses the thread model without selecting or persisting a workspace model", async () => {
  const workspace = { selectedModel: "openrouter:workspace", thinkingLevel: "low" };
  const calls: unknown[] = [];
  const useThinking = load<(act: unknown, changed: (next: unknown) => void, model: string) => { setLevel(next: string): Promise<void> }>("useThinking", {
    useState: () => [undefined, () => undefined], useEffect: () => undefined,
    readSettings: () => workspace,
    reasoningFor: (_settings: unknown, _catalog: unknown, model: string) => { assert.equal(model, "provider:thread"); return {}; },
    thinkingStops: () => ["", "high"],
    selectModelKey: () => { throw new Error("Global selection must not change"); },
    persistSettings: () => { throw new Error("Global settings must not change"); },
  });
  await useThinking(undefined, (next) => { calls.push(next); }, "provider:thread").setLevel("high");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ selectedModel: "provider:thread", thinkingLevel: "high" }]);
  assert.equal(workspace.thinkingLevel, "low");
});

test("thread navigation restores model and thread together and ignores stale loads", async () => {
  const pending = new Map<string, (value: unknown) => void>();
  const loaded: unknown[] = [];
  const selectedIdRef = { current: "a" };
  const globals = {
    selectedId: "a", selectedIdRef, loadSequence: { current: 0 }, parentRequest: { current: "" }, subthreadRequest: { current: "" },
    useCallback: (callback: unknown) => callback,
    setThreadLoadError: () => undefined,
    setLoadedThread: (value: unknown) => loaded.push(value), setLoadedSubthread: () => undefined,
    isCurrentThreadLoad: (parent: string, selected: string, request: string, current: string) => parent === selected && request === current,
    window: { emma: {
      request: async (_method: string, { threadId }: { threadId: string }) => ({ id: threadId, messages: [] }),
      getThreadContext: (id: string) => new Promise((resolve) => pending.set(id, resolve)),
    } },
  };
  const first = load<(id: string) => Promise<void>>("loadThread", globals)("a");
  selectedIdRef.current = "b";
  globals.selectedId = "b";
  const second = load<(id: string) => Promise<void>>("loadThread", globals)("b");
  pending.get("b")!({ model: "provider:b", effort: "high" });
  await second;
  pending.get("a")!({ model: "provider:a", effort: "low" });
  await first;
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), [{ id: "b", messages: [], modelSelection: { model: "provider:b", effort: "high" } }]);
});

test("mounting a thread does not write any model selection", () => {
  const view = declaration("ThreadView");
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "window.emma.setThreadContext") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(view);
  assert.equal(calls.length, 1);
  const value = calls[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(value));
  assert.ok(!value.properties.some((property) => property.name?.getText(source) === "model"));
});
