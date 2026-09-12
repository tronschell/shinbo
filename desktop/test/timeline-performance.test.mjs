import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const compile = (source, globals) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, ...globals });
  return exports;
};
const trace = compile(readFileSync(path.join(root, "shared/trace.ts"), "utf8"));
const spans = [{ id: "agent", name: "Agent", kind: "agent", startedAt: 0, endedAt: 800000, status: "ok" }, ...Array.from({ length: 8000 }, (_, index) => ({ id: `tool-${index}`, parentId: "agent", name: `Read file ${index}`, kind: "read", startedAt: index * 100, endedAt: index * 100 + 80, status: "ok", tokens: 10, output: "Read complete" }))];

test("unchanged timeline props reuse rows while selection and changed props update", () => {
  const variants = process.env.SHINBO_TIMELINE_BASELINE ? [process.env.SHINBO_TIMELINE_BASELINE, path.join(root, "src/timeline.tsx")] : [path.join(root, "src/timeline.tsx")];
  for (const file of variants) {
    const baseline = file !== path.join(root, "src/timeline.tsx");
    const times = [];
    let finalCalls;
    for (let trial = 0; trial < 5; trial++) {
      const slots = [];
      let cursor = 0;
      let dirty = false;
      let calls = 0;
      const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
      const useMemo = (run, deps) => {
        const index = cursor++;
        if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: run() };
        return slots[index].value;
      };
      const hooks = {
        useState: (initial) => {
          const index = cursor++;
          if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
          return [slots[index].value, (next) => { const value = typeof next === "function" ? next(slots[index].value) : next; dirty ||= !Object.is(slots[index].value, value); slots[index].value = value; }];
        },
        useMemo,
        useCallback: (fn, deps) => useMemo(() => fn, deps),
        useEffect: () => undefined,
        memo: (component) => {
          let previous;
          let result;
          return (props) => {
            if (dirty || !previous || !same(Object.keys(props), Object.keys(previous)) || Object.keys(props).some((key) => !Object.is(props[key], previous[key]))) {
              dirty = false;
              previous = props;
              result = component(props);
            }
            return result;
          };
        },
      };
      const jsx = (type, props) => ({ type, props });
      const { Timeline } = compile(readFileSync(file, "utf8"), { require: (name) => {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "../shared/trace") return { ...trace, formatDuration: (value) => { calls++; return trace.formatDuration(value); } };
        if (name === "../shared/usage") return { charLabel: String };
        if (name === "./icons") return { ExpandIcon: "svg", ToolIcon: "svg" };
        throw new Error(name);
      } });
      const cache = new WeakMap();
      const expand = (node) => {
        if (Array.isArray(node)) return node.map(expand);
        if (!node || typeof node !== "object") return node;
        if (cache.has(node)) return cache.get(node);
        const value = typeof node.type === "function" ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props.children) } };
        cache.set(node, value);
        return value;
      };
      let props = { threadId: "thread", sending: false, carriedTokens: 80000, sample: { label: "Saved turn", spans } };
      const render = () => { cursor = 0; return expand(Timeline(props)); };
      const start = performance.now();
      let tree;
      for (let update = 0; update < 20; update++) tree = render();
      times.push(performance.now() - start);
      finalCalls = calls;
      if (!baseline) assert.equal(calls, 24007);
      const find = (node, className) => Array.isArray(node) ? node.flatMap((entry) => find(entry, className)) : node && typeof node === "object" ? [...(node.props.className === className ? [node] : []), ...find(node.props.children, className)] : [];
      assert.equal(find(tree, "trace-row").length, 8002);
      find(tree, "trace-name")[2].props.onClick();
      const detail = find(render(), "trace-detail");
      assert.equal(detail.length, 1);
      assert.equal(detail[0].props.children[0].props.children[0].props.children, "Read file 0");
      detail[0].props.children[0].props.children[1].props.onClick();
      assert.equal(find(render(), "trace-detail").length, 0);
      props = { ...props, sample: { ...props.sample, spans: spans.slice(0, 3) } };
      assert.equal(find(render(), "trace-row").length, 4);
    }
    console.log(JSON.stringify({ issue: "timeline-unchanged-props", baseline, spans: spans.length, renders: 20, formattedDurations: finalCalls, medianMs: times.sort((a, b) => a - b)[2] }));
  }
});
