import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const compile = (source, globals = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, ...globals });
  return exports;
};
const trace = compile(readFileSync(path.join(root, "shared/trace.ts"), "utf8"));
const spans = [{ id: "agent", name: "Agent", kind: "agent", startedAt: 0, endedAt: 800000, status: "ok" }, ...Array.from({ length: 8000 }, (_, index) => ({ id: `tool-${index}`, parentId: "agent", name: `Read file ${index}`, kind: "read", startedAt: index * 100, endedAt: index * 100 + 80, status: "ok", tokens: 10, output: `Output ${index}` }))];

function mount(file, shinbo) {
  let instance;
  let cursor = 0;
  let calls = 0;
  let mappedRows = 0;
  const effects = [];
  const instances = new Map();
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const equal = (a, b) => a && same(Object.keys(a), Object.keys(b)) && Object.keys(b).every((key) => Object.is(a[key], b[key]));
  const jsx = (type, props, key) => { if (type?.component?.name === "TimelineRow") mappedRows++; return { type, props, key }; };
  const useMemo = (run, deps) => {
    const index = cursor++;
    if (!same(instance.hooks[index]?.deps, deps)) instance.hooks[index] = { deps, value: run() };
    return instance.hooks[index].value;
  };
  const react = {
    memo: (component) => ({ component }),
    useMemo,
    useCallback: (fn, deps) => useMemo(() => fn, deps),
    useEffect: (callback, deps) => {
      const owner = instance;
      const index = cursor++;
      if (!same(owner.hooks[index]?.deps, deps)) {
        const previous = owner.hooks[index];
        owner.hooks[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); owner.hooks[index].cleanup = callback(); });
      }
    },
    useState: (initial) => {
      const owner = instance;
      const index = cursor++;
      if (!(index in owner.hooks)) {
        const state = { value: typeof initial === "function" ? initial() : initial };
        state.set = (next) => { const value = typeof next === "function" ? next(state.value) : next; owner.dirty ||= !Object.is(state.value, value); state.value = value; };
        owner.hooks[index] = state;
      }
      return [owner.hooks[index].value, owner.hooks[index].set];
    },
  };
  const { Timeline } = compile(readFileSync(file, "utf8"), { window: { shinbo }, setInterval: () => 0, clearInterval: () => undefined, setTimeout: (run) => { void Promise.resolve().then(run); return 1; }, clearTimeout: () => undefined, require: (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "../shared/trace") return { ...trace, formatDuration: (value) => { calls++; return trace.formatDuration(value); } };
    if (name === "../shared/usage") return { charLabel: String };
    if (name === "./icons") return { ExpandIcon: "svg", ToolIcon: "svg" };
    throw new Error(name);
  } });
  const expand = (node, location) => {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${location}/${child?.key ?? index}`));
    if (!node || typeof node !== "object") return node;
    const component = typeof node.type === "function" ? node.type : node.type?.component;
    if (!component) return { ...node, props: { ...node.props, children: expand(node.props.children, `${location}/children`) } };
    let entry = instances.get(location);
    if (!entry || entry.type !== node.type) { entry = { type: node.type, hooks: [], dirty: true }; instances.set(location, entry); }
    if (node.type.component && !entry.dirty && equal(entry.props, node.props)) return entry.result;
    instance = entry; cursor = 0; entry.dirty = false; entry.props = node.props;
    entry.result = expand(component(node.props), `${location}/result`);
    return entry.result;
  };
  return {
    render: (props) => { const tree = expand(jsx(Timeline, props), "root"); for (const effect of effects.splice(0)) effect(); return tree; },
    calls: () => calls,
    mappedRows: () => mappedRows,
    unmount: () => { for (const instance of instances.values()) for (const hook of instance.hooks) hook?.cleanup?.(); },
  };
}

const rows = (tree) => tree.props.children[1].props.children.props.children;
const name = (row) => row.props.children[0].props.children[3];
const detail = (row) => row.props.children[3];

test("large timeline selections rerender only the affected keyed row", () => {
  const current = path.join(root, "src/timeline.tsx");
  const variants = process.env.SHINBO_TIMELINE_SELECTION_BASELINE ? [process.env.SHINBO_TIMELINE_SELECTION_BASELINE, current] : [current];
  for (const file of variants) {
    const baseline = file !== current;
    const times = [];
    let finalCalls;
    for (let trial = 0; trial < 5; trial++) {
      const view = mount(file);
      let props = { threadId: "thread", sending: false, carriedTokens: 80000, sample: { label: "Saved turn", spans } };
      let tree = view.render(props);
      assert.equal(rows(tree).length, 8002);
      const initialCalls = view.calls();
      const start = performance.now();
      for (let click = 0; click < 20; click++) {
        name(rows(tree)[2]).props.onClick();
        tree = view.render(props);
        assert.equal(name(rows(tree)[2]).props["aria-pressed"], click % 2 === 0);
        if (click % 2 === 0) assert.equal(detail(rows(tree)[2]).props.children.at(-1).props.children, "Output 0");
        else assert.equal(detail(rows(tree)[2]), false);
      }
      times.push(performance.now() - start);
      finalCalls = view.calls() - initialCalls;
      if (!baseline) assert.equal(finalCalls, 90);
      name(rows(tree)[2]).props.onClick(); tree = view.render(props);
      name(rows(tree)[3]).props.onClick(); tree = view.render(props);
      assert.equal(detail(rows(tree)[2]), false);
      assert.equal(detail(rows(tree)[3]).props.children.at(-1).props.children, "Output 1");
      rows(tree)[1].props.children[0].props.children[0].props.onClick();
      tree = view.render(props); assert.equal(rows(tree).length, 2);
      rows(tree)[1].props.children[0].props.children[0].props.onClick();
      tree = view.render(props); assert.equal(rows(tree).length, 8002);
      tree.props.children[0].props.children[0].props.children[1].props.children[1].props.onClick();
      tree = view.render(props); assert.match(name(rows(tree)[2]).props.title, /tok$/);
      props = { ...props, sample: { ...props.sample, spans: spans.map((span, index) => index === 1 ? { ...span, name: "Changed tool", output: "Changed output", tokens: 20 } : span) } };
      tree = view.render(props); assert.equal(name(rows(tree)[2]).props.children, "Changed tool");
      name(rows(tree)[2]).props.onClick(); tree = view.render(props); assert.equal(detail(rows(tree)[2]).props.children.at(-1).props.children, "Changed output");
    }
    console.log(JSON.stringify({ issue: "timeline-local-selection", baseline, spans: spans.length, selections: 20, formattedDurations: finalCalls, medianMs: times.sort((a, b) => a - b)[2] }));
  }
});

test("foreign span broadcasts preserve an idle saved timeline without rebuilding rows", async () => {
  const current = path.join(root, "src/timeline.tsx");
  const variants = process.env.SHINBO_TIMELINE_SUBSCRIPTION_BASELINE ? [process.env.SHINBO_TIMELINE_SUBSCRIPTION_BASELINE, current] : [current];
  const saved = [{ timestamp: "2026-09-12T01:00:00Z", text: trace.encodeSpans(spans.map((span) => ({ ...span, output: undefined, tokens: undefined }))) }];
  const settle = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
  for (const file of variants) {
    const baseline = file !== current;
    const times = [];
    let finalRows;
    for (let trial = 0; trial < 5; trial++) {
      const listeners = new Set();
      let trees = {};
      const view = mount(file, {
        listSpans: async () => trees, threadTraces: async () => saved,
        onSpans: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      });
      const emit = async (next) => { trees = next; for (const listener of listeners) listener(); await settle(); };
      let props = { threadId: "saved", sending: false, carriedTokens: 80000 };
      view.render(props); await settle();
      let tree = view.render(props);
      assert.equal(rows(tree).length, 8002);
      assert.equal(listeners.size, 1);
      const before = view.mappedRows();
      const start = performance.now();
      for (let update = 0; update < 40; update++) {
        await emit(update % 2 ? { foreign: [{ ...spans[0], name: `Foreign ${update}` }], saved: [] } : { foreign: [{ ...spans[0], name: `Foreign ${update}` }] });
        tree = view.render(props);
      }
      times.push(performance.now() - start);
      finalRows = view.mappedRows() - before;
      if (!baseline) assert.equal(finalRows, 0);
      assert.equal(rows(tree).length, 8002);
      const live = [{ ...spans[0], id: "live-agent", name: "Live root", endedAt: undefined, status: "running" }];
      await emit({ saved: live }); tree = view.render(props); assert.equal(rows(tree).length, 8003);
      const own = view.mappedRows(); await emit({ saved: live }); view.render(props); assert.equal(view.mappedRows(), own);
      await emit({ saved: live.map((span) => ({ ...span, endedAt: 20, status: "ok" })) }); tree = view.render(props);
      assert.equal(rows(tree)[1].props["data-status"], "ok"); assert.match(name(rows(tree)[1]).props.title, /20ms$/);
      await emit({ saved: [] }); tree = view.render(props); assert.equal(rows(tree).length, 8002);
      await emit({}); tree = view.render(props); assert.equal(rows(tree).length, 8002);
      await emit({ saved: live }); tree = view.render(props); assert.equal(rows(tree).length, 8003);
      props = { ...props, threadId: "other" }; view.render(props); await settle(); tree = view.render(props);
      assert.equal(rows(tree).length, 8002); assert.equal(listeners.size, 1);
      view.unmount(); assert.equal(listeners.size, 0);
    }
    console.log(JSON.stringify({ issue: "timeline-foreign-span-broadcasts", baseline, savedSpans: spans.length, broadcasts: 40, mappedRows: finalRows, medianMs: times.sort((a, b) => a - b)[2] }));
  }
});
