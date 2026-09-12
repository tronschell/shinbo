import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import * as runtime from "react/jsx-runtime";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const current = path.join(root, "src/AgentView.tsx");
const modules = new Map();
const load = (file) => {
  if (modules.has(file)) return modules.get(file);
  const api = {};
  modules.set(file, api);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "require", code)(api, (id) => load(path.resolve(path.dirname(file), `${id}.ts`)));
  return api;
};
const api = load(path.join(root, "shared/improvement.ts"));
const { encodeSpans } = load(path.join(root, "shared/trace.ts"));
const { day } = load(path.join(root, "src/dates.ts"));
const { plural } = load(path.join(root, "src/plural.ts"));
const short = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fixture = (count) => {
  const text = encodeSpans(Array.from({ length: count }, (_, index) => ({ id: `agent:${index}`, kind: "agent", parentId: index ? "agent:0" : undefined, name: `Agent ${index}`, startedAt: index, endedAt: index + 1, status: "ok", model: "local/fixture" })), { model: "local/fixture" });
  assert.ok(Buffer.byteLength(text) < 1024 * 1024);
  return api.readTurns({ timestamp: "2026-09-12T00:00:00Z", text }, { id: "root", title: "Root" });
};

function mount(file) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let element;
  let state;
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "className" && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "repairs-evidence")) element = node;
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => ts.isArrayBindingPattern(declaration.name) && declaration.name.elements.some((item) => ts.isBindingElement(item) && item.name.getText(tree) === "evidenceOpened"))) state = node;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(element);
  let opened;
  let elements = 0;
  const useState = (initial) => {
    if (opened === undefined) opened = initial;
    return [opened, (next) => { opened = next; }];
  };
  const jsx = (type, props, key) => { elements += 1; return runtime.jsx(type, props, key); };
  const globals = { useState, day, plural, short, ScopeMark: () => null, toolOf: api.toolOf };
  const code = ts.transpileModule(`function render(windowed, openThread) { ${state?.getText(tree) ?? ""} return ${element.getText(tree)}; }\nexport { render };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const result = {};
  new Function("exports", "require", ...Object.keys(globals), code)(result, () => ({ jsx, jsxs: jsx }), ...Object.values(globals));
  return {
    render(turns, openThread = () => undefined) {
      elements = 0;
      const tree = result.render(turns, openThread);
      return { tree, elements };
    },
  };
}
const nodes = (tree, type) => {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((node) => nodes(node, type));
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
};
const serialized = (tree) => JSON.stringify(tree);

const turns = fixture(4096);
test("closed run evidence builds no run or tool elements before first opening", () => {
  const mounted = mount(current);
  const closed = mounted.render(turns);
  assert.equal(closed.elements, 3);
  assert.equal(nodes(closed.tree, "details").length, 1);
  assert.equal(nodes(closed.tree, "button").length, 0);
  assert.equal(closed.tree.props.open, undefined);
  closed.tree.props.onToggle({ currentTarget: { open: false } });
  assert.equal(mounted.render(turns).elements, 3);
});

test("first expansion retains exact run keys, contents, navigation, and children after closing", () => {
  const mounted = mount(current);
  const selected = [];
  const input = [
    { ...turns[0], at: 10, context: { systemPrompt: "Prompt" }, spans: [...turns[0].spans, { id: "call", kind: "read", name: "Read", status: "ok", input: "input", output: "output" }] },
    { ...turns[1], at: 20 },
    { ...turns[2], at: 20 },
  ];
  mounted.render(input).tree.props.onToggle({ currentTarget: { open: true } });
  const open = mounted.render(input, (id) => selected.push(id));
  const keys = open.tree.props.children[2].map((child) => child.key);
  assert.deepEqual(keys, ["1:20:0", "2:20:1", "0:10:2"]);
  for (const button of nodes(open.tree, "button")) button.props.onClick();
  assert.deepEqual(selected, ["1", "2", "0"]);
  assert.deepEqual(nodes(open.tree, "pre").map((node) => node.props.children), ["Prompt", "input", "output"]);
  open.tree.props.onToggle({ currentTarget: { open: false } });
  assert.equal(serialized(mounted.render(input).tree), serialized(open.tree));
  const filtered = mounted.render(input.slice(1));
  assert.equal(nodes(filtered.tree, "button").length, 2);
  filtered.tree.props.onToggle({ currentTarget: { open: true } });
  assert.equal(serialized(mounted.render(input.slice(1)).tree), serialized(filtered.tree));
  if (process.env.TURN_EVIDENCE_BASELINE) assert.equal(serialized(mount(process.env.TURN_EVIDENCE_BASELINE).render(input).tree), serialized(open.tree));
});

if (process.env.TURN_EVIDENCE_BASELINE) {
  test("paired actual React element construction for the supported 4096-agent trace", () => {
    const before = mount(process.env.TURN_EVIDENCE_BASELINE);
    const after = mount(current);
    const counts = { before: before.render(turns).elements, after: after.render(turns).elements };
    const timings = { before: [], after: [] };
    for (let trial = 0; trial < 3; trial += 1) {
      for (const [name, view] of trial % 2 ? [["after", after], ["before", before]] : [["before", before], ["after", after]]) {
        const start = performance.now();
        for (let render = 0; render < 20; render += 1) view.render(turns);
        timings[name].push(performance.now() - start);
      }
    }
    after.render(turns).tree.props.onToggle({ currentTarget: { open: true } });
    assert.equal(serialized(after.render(turns).tree), serialized(before.render(turns).tree));
    for (const name of ["before", "after"]) console.log(JSON.stringify({ name, turns: turns.length, renders: 20, elementsPerRender: counts[name], medianMs: timings[name].sort((a, b) => a - b)[1] }));
  });
}
