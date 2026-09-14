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
    window: { shinbo: { request: (method: string, params: unknown) => { calls.push({ method, params }); return new Promise<void>((resolve) => { done = resolve; }); } } },
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
  let shown = "";
  const change = load<(next: unknown) => Promise<void>>("changeThreadModel", {
    thread: { id: "a" },
    window: { shinbo: { request: async () => { throw new Error("Unavailable model"); } } },
    onModelChanged: () => { changed = true; },
    setRunError: (text: string) => { shown = text; },
    reasonText: (reason: unknown) => String(reason instanceof Error ? reason.message : reason),
  });
  await assert.rejects(change({ selectedModel: "provider:missing", thinkingLevel: "" }), /Unavailable model/);
  assert.equal(changed, false);
  assert.equal(shown, "Unavailable model");
});

test("thinking uses the thread model without selecting or persisting a workspace model", async () => {
  const workspace = { selectedModel: "openrouter:workspace", thinkingLevel: "low" };
  const calls: unknown[] = [];
  const useThinking = load<(act: unknown, changed: (next: unknown) => void, model: string) => { setLevel(next: string): Promise<void> }>("useThinking", {
    useState: () => [undefined, () => undefined], useEffect: () => undefined,
    loadSettings: () => workspace,
    reasoningFor: (_catalog: unknown, model: string) => { assert.equal(model, "provider:thread"); return {}; },
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
    setLoadedThread: (value: unknown) => loaded.push(typeof value === "function" ? value(undefined) : value), setLoadedSubthread: () => undefined,
    sameMessages: () => false,
    isCurrentThreadLoad: (parent: string, selected: string, request: string, current: string) => parent === selected && request === current,
    window: { shinbo: {
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
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), [{ id: "b", messages: [], context: { model: "provider:b", effort: "high" } }]);
});

test("mounting a thread does not write any model selection", () => {
  const view = declaration("ThreadView");
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "window.shinbo.setThreadContext") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(view);
  assert.equal(calls.length, 1);
  const value = calls[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(value));
  assert.ok(!value.properties.some((property) => property.name?.getText(source) === "model"));
});

test("opening a remote task hydrates context without changing its permissions", () => {
  const view = declaration("ThreadView") as ts.FunctionDeclaration;
  const choices = new Set(["[mode, setMode]", "[review, setReview]", "[folderIds, setFolderIds]", "[context, setContext]"]);
  const statements = view.body!.statements.flatMap((node) => {
    if (ts.isVariableStatement(node)) {
      const declarations = node.declarationList.declarations.filter((item) => choices.has(item.name.getText(source)) || ["context", "{ mode, review, folderIds }"].includes(item.name.getText(source)));
      return declarations.map((item) => `const ${item.getText(source)};`);
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === "useEffect" && /setThreadFolders|setContext\(thread.context\)/.test(node.getText(source))) return [node.getText(source)];
    return [];
  });
  const context = { folderIds: ["remote-project"], mode: "ask", review: true };
  const writes: unknown[] = [];
  const cached: Record<string, unknown> = {};
  const scope = {
    thread: { id: "remote-task", context }, threadId: "remote-task", defaultMode: "full",
    useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => undefined],
    useEffect: (effect: () => void) => effect(),
    threadMode: () => "full", threadReview: () => false, threadFolders: () => ["stale-project"],
    setThreadFolders: (_id: string, value: unknown) => { cached.folderIds = value; },
    setThreadMode: (_id: string, value: unknown) => { cached.mode = value; },
    setThreadReview: (_id: string, value: unknown) => { cached.review = value; },
    window: { shinbo: { setThreadContext: async (value: unknown) => { writes.push(value); } } },
  };
  runInNewContext(ts.transpileModule(statements.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  assert.deepEqual(writes, []);
  assert.deepEqual(cached, context);
});

test("explicit context changes update the selected task only after native acceptance", async () => {
  for (const refuse of [false, true]) {
    const context = { folderIds: ["remote-project"], mode: "ask", review: true, model: "provider:pinned", effort: "high" };
    const changes: unknown[] = [];
    const writes: unknown[] = [];
    const errors: string[] = [];
    const change = load<(patch: unknown) => Promise<void>>("changeContext", {
      context, contextBusy: false, thread: { id: "remote-task" }, setContextBusy: () => undefined,
      window: { shinbo: { setThreadContext: async (value: unknown) => { writes.push(value); if (refuse) throw new Error("save failed"); } } },
      onContextChanged: (value: unknown) => { changes.push(value); },
      setRunError: (value: string) => { errors.push(value); }, reasonText: (reason: Error) => reason.message,
    });
    await change({ mode: "acceptEdits" });
    assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ threadId: "remote-task", folderIds: ["remote-project"], mode: "acceptEdits", review: true }]);
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), refuse ? [] : [{ ...context, mode: "acceptEdits" }]);
    assert.deepEqual(errors, refuse ? ["save failed"] : []);
  }
});

test("new desktop tasks persist their chosen folder and default permission before opening", async () => {
  const writes: unknown[] = [];
  const opened: string[] = [];
  const create = load<(folder: string) => Promise<void>>("createThread", {
    thread: undefined, settings: { defaultPermissionMode: "acceptEdits" },
    act: async () => ({ id: "new-task" }),
    window: { shinbo: { setThreadContext: async (value: unknown) => { writes.push(value); assert.deepEqual(opened, []); } } },
    setThreadFolders: () => undefined, setThreadId: (id: string) => { opened.push(id); },
    setView: () => undefined, load: async () => undefined, setError: (reason: string) => { throw new Error(reason); },
    reasonText: (reason: Error) => reason.message,
  });
  await create("chosen-project");
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ threadId: "new-task", folderIds: ["chosen-project"], mode: "acceptEdits" }]);
  assert.deepEqual(opened, ["new-task"]);
});
