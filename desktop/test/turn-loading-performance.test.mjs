import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const current = path.join(root, "src/AgentView.tsx");
const same = (left, right) => left && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const settle = async () => { for (let index = 0; index < 200; index += 1) await Promise.resolve(); };
const loadShared = () => {
  const modules = new Map();
  const load = (file) => {
    if (modules.has(file)) return modules.get(file);
    const api = {};
    modules.set(file, api);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("exports", "require", code)(api, (id) => load(path.resolve(path.dirname(file), `${id}.ts`)));
    return api;
  };
  return { ...load(path.join(root, "shared/improvement.ts")), ...load(path.join(root, "shared/trace.ts")) };
};
const api = loadShared();
const snapshot = (count = 64) => ({ threads: Array.from({ length: count }, (_, index) => ({ id: `thread-${index}`, title: `Thread ${index}`, updatedAt: new Date(Date.UTC(2026, 8, 12, 0, index)).toISOString() })) });
const traces = Array.from({ length: 8 }, (_, index) => ({ timestamp: new Date().toISOString(), text: api.encodeSpans([
  { id: "agent:root", kind: "agent", name: "Root", startedAt: index, endedAt: index + 1, status: "ok" },
  ...Array.from({ length: 36 }, (_, call) => ({ id: `call:${call}`, parentId: "agent:root", kind: "read", name: "Read", startedAt: index, endedAt: index + 1, status: "ok", output: "x".repeat(16000) })),
]) }));
const bytesPerHistory = Buffer.byteLength(JSON.stringify(traces));
assert.ok(bytesPerHistory < 8 * 1024 * 1024);
assert.ok(traces.every((trace) => Buffer.byteLength(trace.text) < 1024 * 1024));

function mount(file, readTrace, parse = api.readTurns) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useTurns");
  assert.ok(declaration);
  const values = [];
  const effects = [];
  let cursor = 0;
  const globals = {
    READ_DAYS: 90, DAY_MS: 86400000, benchKin: () => new Set(["bench"]), readBench: () => ({ runs: [] }),
    readTurns: parse, distinctTurns: api.distinctTurns, window: { shinbo: { threadTraces: readTrace } },
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = { value: initial };
      return [values[index].value, (next) => { values[index].value = next; }];
    },
    useMemo(run, deps) {
      const index = cursor++;
      if (!same(values[index]?.deps, deps)) values[index] = { deps, value: run() };
      return values[index].value;
    },
    useEffect(run, deps) {
      const index = cursor++;
      if (!same(values[index]?.deps, deps)) {
        const old = values[index];
        values[index] = { deps };
        effects.push(() => { old?.cleanup?.(); values[index].cleanup = run(); });
      }
    },
  };
  const code = ts.transpileModule(`${declaration.getText(tree)}\nreturn useTurns;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const hook = new Function(...Object.keys(globals), code)(...Object.values(globals));
  return {
    render(data, enabled) {
      cursor = 0;
      const result = hook(data, enabled);
      for (const effect of effects.splice(0)) effect();
      return result;
    },
    unmount() { for (const value of values) value?.cleanup?.(); },
  };
}

const loadCount = async (file, enabled) => {
  const data = snapshot();
  const counts = { requests: 0, responseBytes: 0, parsedTraces: 0 };
  const hook = mount(file, async () => { counts.requests += 1; counts.responseBytes += bytesPerHistory; return traces; }, () => { counts.parsedTraces += 1; return []; });
  hook.render(data, enabled);
  await settle();
  const result = hook.render(data, enabled);
  hook.unmount();
  return { ...counts, ready: result.ready };
};

test("hidden activity, worktrees, and bench tabs do not request or parse retained traces", async () => {
  const after = await loadCount(current, false);
  assert.deepEqual(after, { requests: 0, responseBytes: 0, parsedTraces: 0, ready: false });
  const enabled = await loadCount(current, true);
  assert.deepEqual(enabled, { requests: 64, responseBytes: 64 * bytesPerHistory, parsedTraces: 512, ready: true });
  if (process.env.TURN_LOADING_BASELINE) {
    const before = await loadCount(process.env.TURN_LOADING_BASELINE, false);
    assert.deepEqual(before, enabled);
    console.log(JSON.stringify({ histories: 64, tracesPerHistory: 8, bytesPerHistory, before, after }));
  }
});

test("leaving stops unresolved parsing and future batches, reentry and changed history reset readiness", async () => {
  const data = snapshot(9);
  const pending = [];
  let parsed = 0;
  const hook = mount(current, (id) => new Promise((resolve) => pending.push({ id, resolve })), () => { parsed += 1; return []; });
  assert.equal(hook.render(data, true).ready, false);
  assert.equal(pending.length, 4);
  hook.render(data, false);
  for (const item of pending.splice(0)) item.resolve(traces);
  await settle();
  assert.equal(parsed, 0);
  assert.equal(pending.length, 0);
  assert.equal(hook.render(data, true).ready, false);
  for (let batch = 0; batch < 3; batch += 1) {
    assert.equal(pending.length, batch < 2 ? 4 : 1);
    for (const item of pending.splice(0)) item.resolve(traces);
    await settle();
  }
  assert.equal(parsed, 72);
  assert.equal(hook.render(data, true).ready, true);
  hook.render(data, false);
  assert.equal(hook.render(data, true).ready, false);
  hook.render(data, false);
  for (const item of pending.splice(0)) item.resolve(traces);
  await settle();
  const changed = { threads: data.threads.map((thread, index) => index ? thread : { ...thread, updatedAt: "2026-09-13T00:00:00Z" }) };
  assert.equal(hook.render(changed, true).ready, false);
  hook.unmount();
  for (const item of pending.splice(0)) item.resolve(traces);
  await settle();
  assert.equal(parsed, 72);
  assert.equal(pending.length, 0);
});

test("enabled loading preserves actual trace turns, ordering, failed reads, and bench exclusion", async () => {
  const data = snapshot(6);
  data.threads.push({ id: "bench", title: "Bench", updatedAt: "2026-09-12T00:00:00Z" });
  const small = traces.map((trace, index) => ({ ...trace, text: api.encodeSpans([{ id: "agent:root", kind: "agent", name: "Root", startedAt: index, endedAt: index + 1, status: "ok" }]) }));
  const run = async (file) => {
    const requested = [];
    const hook = mount(file, async (id) => { requested.push(id); if (id === "thread-3") throw new Error("missing"); return small; });
    hook.render(data, true);
    await settle();
    const result = hook.render(data, true);
    hook.unmount();
    return { result: { turns: result.turns, ready: result.ready, read: result.read }, requested };
  };
  const after = await run(current);
  assert.equal(after.result.ready, true);
  assert.equal(after.result.read, 6);
  assert.deepEqual(after.requested, ["thread-5", "thread-4", "thread-3", "thread-2", "thread-1", "thread-0"]);
  assert.equal(after.result.turns.length, 8);
  if (process.env.TURN_LOADING_BASELINE) assert.deepEqual(after, await run(process.env.TURN_LOADING_BASELINE));
});

function tabControls(file, tab, clear, setTab) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let pick;
  let element;
  const visit = (node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(tree) === "pickTab")) pick = node;
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "role" && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "tablist")) element = node;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(element);
  const code = ts.transpileModule(`${pick?.getText(tree) ?? ""}\nexport const tabs = ${element.getText(tree)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const result = {};
  const jsx = (type, props) => ({ type, props });
  new Function("exports", "require", "tab", "clear", "setTab", "setMemories", code)(result, () => ({ jsx, jsxs: jsx }), tab, clear, setTab, () => undefined);
  return result.tabs.props.children.filter((child) => child.props.role === "tab");
}

test("actual tab clicks release completed turn payloads, retain same-tab data, and reload on reentry", async () => {
  const data = snapshot(1);
  const history = traces.map((trace) => ({ ...trace, text: api.encodeSpans(api.decodeSpans(trace.text), { systemPrompt: "p".repeat(16000) }) }));
  const historyJsonBytes = Buffer.byteLength(JSON.stringify(history));
  assert.ok(historyJsonBytes < 8 * 1024 * 1024);
  assert.ok(history.every((trace) => Buffer.byteLength(trace.text) < 1024 * 1024));
  const run = async (file, destination) => {
    let requests = 0;
    let tab = "improvement";
    const hook = mount(file, async () => { requests += 1; return history; });
    hook.render(data, true);
    await settle();
    let result = hook.render(data, true);
    const original = result.turns;
    assert.equal(original.length, 8);
    const spanCount = original.reduce((count, turn) => count + turn.spans.length, 0);
    assert.equal(spanCount, 296);
    assert.equal(original.reduce((count, turn) => count + turn.context.systemPrompt.length, 0), 128000);
    const click = (index) => tabControls(file, tab, result.clear, (next) => { tab = next; })[index].props.onClick();
    click(1);
    result = hook.render(data, true);
    assert.equal(result.turns, original);
    assert.equal(result.ready, true);
    assert.equal(requests, 1);
    click(destination);
    result = hook.render(data, false);
    const hidden = { turns: result.turns.length, spans: result.turns.reduce((count, turn) => count + turn.spans.length, 0), contextChars: result.turns.reduce((count, turn) => count + turn.context.systemPrompt.length, 0), ready: result.ready };
    click(1);
    result = hook.render(data, true);
    assert.equal(result.ready, false);
    assert.equal(requests, 2);
    await settle();
    result = hook.render(data, true);
    assert.equal(result.ready, true);
    assert.deepEqual(result.turns, original);
    hook.unmount();
    return hidden;
  };
  for (const destination of [0, 2, 3]) assert.deepEqual(await run(current, destination), { turns: 0, spans: 0, contextChars: 0, ready: false });
  if (process.env.TURN_RETENTION_BASELINE) {
    const before = await run(process.env.TURN_RETENTION_BASELINE, 0);
    assert.deepEqual(before, { turns: 8, spans: 296, contextChars: 128000, ready: false });
    console.log(JSON.stringify({ before, after: { turns: 0, spans: 0, contextChars: 0, ready: false }, historyJsonBytes }));
  }
});
