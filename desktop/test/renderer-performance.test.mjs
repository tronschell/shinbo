import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const source = (file, baseline = false) => readFileSync(path.join(baseline ? process.env.SHINBO_RENDERER_BASELINE : root, "src", file), "utf8");
const compile = (text, globals = {}, dependencies = {}) => {
  const exports = {};
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => dependencies[name] ?? {}, ...globals });
  return exports;
};
const hooks = () => {
  const values = [];
  let cursor = 0;
  let effects = [];
  let changes = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, at) => Object.is(value, b[at]));
  const react = {
    useRef: (value) => values[cursor++] ??= { current: value },
    useState: (value) => {
      const at = cursor++;
      values[at] ??= typeof value === "function" ? value() : value;
      return [values[at], (next) => { const made = typeof next === "function" ? next(values[at]) : next; if (!Object.is(made, values[at])) changes += 1; values[at] = made; }];
    },
    useMemo: (make, deps) => {
      const at = cursor++;
      if (!same(values[at]?.deps, deps)) values[at] = { deps, value: make() };
      return values[at].value;
    },
    useCallback: (value, deps) => react.useMemo(() => value, deps),
    useEffect: (run, deps) => {
      const at = cursor++;
      if (same(values[at]?.deps, deps)) return;
      effects.push(() => { values[at]?.cleanup?.(); values[at] = { deps, cleanup: run() }; });
    },
    memo: (render) => {
      let props;
      let value;
      return (next) => {
        if (!props || !same(Object.keys(props), Object.keys(next)) || Object.keys(next).some((key) => !Object.is(props[key], next[key]))) { props = next; value = render(next); }
        return value;
      };
    },
  };
  return { react, begin: () => { cursor = 0; effects = []; }, commit: () => effects.forEach((run) => run()), changes: () => changes, cleanup: () => values.forEach((value) => value?.cleanup?.()) };
};
const variants = () => process.env.SHINBO_RENDERER_BASELINE ? [true, false] : [false];

function streamed(baseline) {
  const scheduled = [];
  let delta;
  const subscribers = [];
  let notified = 0;
  const shinbo = new Proxy({
    request: async () => ({ messages: [] }),
    onDelta: (listen) => { delta = listen; },
    listAgents: () => Promise.resolve([]),
    listSpans: () => Promise.resolve({}),
    livePartial: () => Promise.resolve({}),
  }, { get: (object, name) => object[name] ?? (() => undefined) });
  const react = { useCallback: (callback) => callback, useSyncExternalStore: (subscribe) => { subscribers.push(subscribe(() => notified++)); } };
  const runs = compile(source("runs.ts", baseline), { window: { shinbo }, setTimeout: (run) => { scheduled.push(run); return scheduled.length; } }, { react });
  for (let at = 0; at < 20; at++) runs.useRun(`thread-${at}`);
  for (let at = 0; at < 1000; at++) delta({ threadId: "thread-0", delta: "x" });
  assert.equal(runs.runOf("thread-0").blocks[0].text, "x".repeat(1000));
  scheduled.splice(0).forEach((run) => run());
  subscribers.forEach((stop) => stop());
  return notified;
}

test("stream notifications are batched and only wake the changed thread", () => {
  for (const baseline of variants()) {
    const count = streamed(baseline);
    if (!baseline) assert.equal(count, 1);
    console.log(JSON.stringify({ issue: "run-notifications", baseline, count }));
  }
});

test("partial recovery preserves longest overlap with bounded work", () => {
  const current = compile(source("runs.ts"));
  const reference = (a, b) => { for (let size = Math.min(a.length, b.length); size; size--) if (a.endsWith(b.slice(0, size))) return a + b.slice(size); return a + b; };
  const strings = [""];
  for (let at = 0; at < 63; at++) strings.push(strings[Math.floor(at / 2)] + (at % 2 ? "a" : "b"));
  for (const a of strings) for (const b of strings) assert.equal(current.joinPartial(a, b), reference(a, b));
  const size = Number(process.env.SHINBO_RENDERER_OVERLAP_SIZE ?? 20_000);
  const a = "a".repeat(size) + "b";
  const b = "a".repeat(size);
  for (const baseline of variants()) {
    const { joinPartial } = compile(source("runs.ts", baseline));
    joinPartial("abc", "bcd");
    const times = [];
    for (let at = 0; at < 5; at++) { const start = performance.now(); assert.equal(joinPartial(a, b), a + b); times.push(performance.now() - start); }
    console.log(JSON.stringify({ issue: "partial-overlap", baseline, chars: a.length + b.length, medianMs: times.sort((a, b) => a - b)[2] }));
  }
});

test("large fenced output stays exact without creating thousands of token spans", () => {
  const text = "const answer = 42;\n".repeat(20_000);
  for (const baseline of variants()) {
    const { tokenize } = compile(source("highlight.ts", baseline));
    const tokens = tokenize(text, "ts");
    assert.equal(tokens.map((token) => token.text).join(""), text);
    if (!baseline) assert.equal(tokens.length, 1);
    console.log(JSON.stringify({ issue: "code-nodes", baseline, chars: text.length, nodes: tokens.length }));
  }
});

function tail(baseline) {
  const runtime = hooks();
  let observed = 0;
  let disconnected = 0;
  let resize;
  let mutation;
  class Element {}
  const children = Array.from({ length: 500 }, () => new Element());
  const element = { children, scrollHeight: 10_000, scrollTop: 9800, clientHeight: 200 };
  const { useTailScroll } = compile(source("cli.tsx", baseline), {
    Element,
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() { observed++; } unobserve() {} disconnect() { disconnected++; } },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} disconnect() {} },
  }, { react: runtime.react });
  let result;
  for (let at = 0; at < 100; at++) {
    runtime.begin(); result = useTailScroll([at], "thread"); result.ref.current = element; runtime.commit();
  }
  for (let at = 0; at < 100; at++) result.onScroll();
  const changes = runtime.changes();
  element.scrollTop = 0;
  result.onScroll();
  resize();
  assert.equal(element.scrollTop, 0);
  if (!baseline) { mutation([{ addedNodes: [new Element()], removedNodes: [] }]); assert.equal(observed, 501); }
  runtime.cleanup();
  return { observed, disconnected, changes };
}

test("streaming retains resize observers and scrolling only updates changed pin state", () => {
  for (const baseline of variants()) {
    const counts = tail(baseline);
    if (!baseline) assert.deepEqual(counts, { observed: 501, disconnected: 1, changes: 0 });
    console.log(JSON.stringify({ issue: "tail-scroll", baseline, ...counts }));
  }
});

test("tail scroll reconciles shrinking content and reset keys with persistent observers", () => {
  const runtime = hooks();
  let resize;
  let mutation;
  let disconnected = 0;
  const element = { children: [], scrollHeight: 1000, scrollTop: 0, clientHeight: 200 };
  const { useTailScroll } = compile(source("cli.tsx"), {
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} unobserve() {} disconnect() { disconnected++; } },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} disconnect() {} },
  }, { react: runtime.react });
  const render = (key) => {
    runtime.begin();
    const result = useTailScroll([key], key);
    result.ref.current = element;
    runtime.commit();
    return result;
  };
  for (const key of ["first", "second"]) {
    const result = render(key);
    element.scrollTop = 0;
    result.onScroll();
    assert.equal(render(key).atEnd, false);
    element.scrollHeight = 200;
    resize();
    assert.equal(render(key).atEnd, true);
    element.scrollHeight = 1000;
    resize();
    assert.equal(element.scrollTop, 1000);
    element.scrollTop = 0;
    result.onScroll();
    element.scrollHeight = 200;
    mutation([]);
    assert.equal(render(key).atEnd, true);
    element.scrollHeight = 1000;
  }
  assert.equal(disconnected, 1);
  runtime.cleanup();
  assert.equal(disconnected, 2);
});

const variable = (text, name) => {
  const tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = (node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => entry.name.getText(tree) === name)) found ??= node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(found, name);
  return found;
};

test("unchanged ledger storage keeps the existing hook memo effective and observes writes", () => {
  const usage = compile(readFileSync(path.join(root, "shared/usage.ts"), "utf8"));
  const keys = ["shinbo.threadContextUses.v2", "shinbo.threadExperiments.v1", "shinbo.threadContextBreakdown.v1"];
  const entries = [
    [{ kind: "messages", label: "attachment", chars: 40, turns: 1 }],
    { savedTokens: 2, addedTokens: 1, prunedResults: 1, reinjections: 1 },
    { systemPromptBytes: 20, systemToolsBytes: 30, mcpToolsBytes: 0, skillsBytes: 0, memoryBytes: 0 },
  ];
  const initial = keys.map((key, index) => [key, JSON.stringify(Object.fromEntries(Array.from({ length: 5000 }, (_, at) => [`thread-${at}`, entries[index]])))]);
  const thread = { id: "thread-0", messages: Array.from({ length: 1024 }, (_, at) => ({ role: at % 2 ? "assistant" : "user", content: "message", timestamp: "2026-09-12T00:00:00Z", ...(at % 2 ? { generation: { model: "fixture-model", outputTokens: 20, durationMilliseconds: 100, inputTokens: 100 } } : {}) })) };
  const hook = source("context-bar.tsx").split("export function useContextLedger")[1].split("export function useThreadCalls")[0];
  for (const baseline of variants()) {
    const times = [];
    let counts;
    for (let trial = 0; trial < 5; trial++) {
      const stored = new Map(initial);
      const runtime = hooks();
      let parses = 0;
      let builds = 0;
      const context = compile(source("context.ts", baseline), {
        localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
        JSON: { parse: (text) => { parses++; return JSON.parse(text); }, stringify: JSON.stringify },
      }, { "../shared/usage": usage, "./plural": { plural: (n, word) => n === 1 ? word : `${word}s` } });
      const { useContextLedger } = compile(`export function useContextLedger${hook}`, { ...context, useMemo: runtime.react.useMemo, buildLedger: (...args) => { builds++; return context.buildLedger(...args); } });
      const inFlight = [];
      const render = () => { runtime.begin(); return useContextLedger(thread, context.threadUses(thread.id), 100000, inFlight, context.threadExperiments(thread.id), 3, context.threadBreakdown(thread.id)); };
      const start = performance.now();
      let ledger;
      for (let at = 0; at < 100; at++) ledger = render();
      times.push(performance.now() - start);
      counts = { parses, builds };
      if (!baseline) assert.deepEqual(counts, { parses: 3, builds: 1 });
      assert.equal(ledger.messages, 1024);
      assert.equal(ledger.replies, 512);
      assert.equal(ledger.tokens, 10240);
      context.recordExperiment(thread.id, { savedTokens: 3, addedTokens: 0, prunedResults: 0, reinjected: false });
      assert.equal(render().experiments.savedTokens, 5);
      stored.set(keys[2], JSON.stringify({ [thread.id]: { ...entries[2], systemToolsBytes: 999 } }));
      assert.equal(render().rows.find((row) => row.source === "tools").chars > 0, true);
      assert.equal(context.threadBreakdown(thread.id).systemToolsBytes, 999);
      stored.set(keys[0], "{}");
      assert.equal(render().attachments, 0);
      if (!baseline) assert.equal(context.threadUses("missing"), context.threadUses("missing"));
      stored.set(keys[1], "{ invalid");
      assert.equal(context.threadExperiments(thread.id).savedTokens, 0);
      stored.set(keys[1], JSON.stringify({ [thread.id]: { savedTokens: -1, addedTokens: 8 } }));
      assert.equal(render().experiments.savedTokens, 0);
      assert.equal(render().experiments.addedTokens, 8);
    }
    console.log(JSON.stringify({ issue: "context-ledger", baseline, storageBytes: initial.reduce((sum, [, value]) => sum + value.length, 0), ...counts, medianMs: times.sort((a, b) => a - b)[2] }));
  }
});

test("composer inventories are rebuilt only when their source data changes", () => {
  for (const baseline of variants()) {
    const text = source("App.tsx", baseline);
    const runtime = hooks();
    let rows = 0;
    const context = compile(source("context.ts"), {}, {
      "../shared/folders": { pickKey: (pick) => JSON.stringify(pick), slashName: (value) => value.replaceAll("/", "-") },
      "../shared/slash": { pathName: (value) => value.split("/").at(-1) },
    });
    const inventory = (name) => (...args) => { const made = context[name](...args); rows += made.length; return made; };
    const code = `${variable(text, "localContext")}\n${variable(text, "atItems")}`;
    const { render } = compile(`export function render() { ${code} return [localContext, atItems]; }`, {
      folders: [{ id: "repo", name: "repo" }], folderIds: ["repo"], folderFiles: { repo: Array.from({ length: 400 }, (_, at) => ({ path: `src/file-${at}.ts` })) }, artifacts: [], notes: [], useMemo: runtime.react.useMemo, contextCommands: inventory("contextCommands"), atCommands: inventory("atCommands"),
    });
    const start = performance.now();
    for (let at = 0; at < 100; at++) { runtime.begin(); render(); }
    const elapsedMs = performance.now() - start;
    if (!baseline) assert.equal(rows, 800);
    console.log(JSON.stringify({ issue: "composer-inventory", baseline, rows, elapsedMs }));
  }
});

test("completed turns skip body work on parent stream updates", () => {
  for (const baseline of variants()) {
    const text = source("App.tsx", baseline);
    const begin = baseline ? text.indexOf("function Turn(") : text.indexOf("const Turn = memo(");
    const end = text.indexOf("\nfunction Blocks(", begin);
    const runtime = hooks();
    let parsed = 0;
    const { render } = compile(`${text.slice(begin, end)}\nexport const render = Turn;`, {
      memo: runtime.react.memo, sentByThread: (content) => { parsed++; return { body: content }; }, splitThinking: (answer) => ({ answer, thinking: "" }), Body: "Body", CopyTurn: "CopyTurn", MessageTray: "Tray", time: (stamp) => stamp,
    }, { "react/jsx-runtime": { jsx: () => null, jsxs: () => null } });
    const props = { item: { role: "user", content: "hello", timestamp: "2026-09-12" } };
    for (let at = 0; at < 100; at++) render(props);
    if (!baseline) assert.equal(parsed, 1);
    console.log(JSON.stringify({ issue: "completed-turn", baseline, parsed }));
    const before = parsed;
    render({ item: { ...props.item, content: "updated" } });
    assert.equal(parsed, before + 1);
  }
});
