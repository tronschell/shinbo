import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import ts from "typescript";

const current = path.resolve(import.meta.dirname, "../src/context-bar.tsx");
const compile = (file) => {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "SubagentRail");
  assert.ok(component);
  const code = ts.transpileModule(`${component.getText(tree)}\nexport { SubagentRail };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const api = {};
  const jsx = (type, props) => ({ type: typeof type === "string" ? type : "icon", props });
  new Function("exports", "require", "alive", "railColumns", "BrandIcon", "brandForModel", "CaretIcon", code)(api, () => ({ jsx, jsxs: jsx }), (agent) => agent && (agent.status === "running" || agent.status === "waiting"), (count) => ({ "--cols": Math.max(1, Math.ceil(Math.sqrt(count))) }), () => null, () => undefined, () => null);
  return api.SubagentRail;
};
const row = (threadId, parentThreadId, status = "done") => ({ threadId, parentThreadId, status, title: threadId, activity: "Finished", color: "#123" });
const props = (agents, all = []) => ({ agents, all, active: "", onPick: () => undefined, orientation: "vertical" });
const nodes = (node, type) => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodes(child, type));
  return [...(node.type === type ? [node] : []), ...nodes(node.props?.children, type)];
};
const serial = (value) => JSON.stringify(value);
const render = compile(current);

test("subagent roots preserve missing parents, self parents, deep chains, status groups, and order", () => {
  const cases = [[], [row("solo")], [row("self", "self")], [row("empty", "")], [row(""), row("child", "")],
    [row("first", "absent"), row("second", "absent"), row("third")],
    [row("child", "root"), row("root"), row("grandchild", "child")],
    [row("running", "done", "running"), row("done"), row("waiting", "running", "waiting")],
    Array.from({ length: 100 }, (_, i) => row(`deep-${i}`, i ? `deep-${i - 1}` : undefined))];
  for (const agents of cases) {
    const actual = render(props(agents, agents));
    assert.equal(nodes(actual, "button").length, agents.filter((agent) => agent.parentThreadId !== agent.threadId).length);
    for (const detail of nodes(actual, "details")) assert.equal(detail.props.open, undefined);
    const roots = (list) => list.filter((agent) => !list.some((other) => other.threadId === agent.parentThreadId));
    const live = agents.filter((agent) => agent.status === "running" || agent.status === "waiting");
    const done = agents.filter((agent) => !live.includes(agent));
    const lists = nodes(actual, "ul");
    if (live.length) assert.deepEqual(lists[0].props.children.map((item) => item.props.children[0].props.children[1].props.children), roots(live).map((agent) => agent.title));
    const details = nodes(actual, "details");
    if (done.length) assert.deepEqual(nodes(details[0], "ul")[0].props.children.map((item) => item.props.children[0].props.children[1].props.children), roots(done).map((agent) => agent.title));
  }
});

test("collapsed historical subagents require linear root lookups", () => {
  let reads = 0;
  const agents = Array.from({ length: 4096 }, (_, i) => ({ ...row(`child-${i}`, "parent"), get threadId() { reads += 1; return `child-${i}`; } }));
  for (const all of [[], agents]) {
    reads = 0;
    const result = render(props(agents, all));
    assert.equal(nodes(result, "li").length, agents.length);
    assert.ok(reads <= agents.length * 8, `${reads} thread identifiers read`);
    assert.equal(nodes(result, "details")[0].props.open, undefined);
  }
});

if (process.env.SUBAGENT_BASELINE) {
  const before = compile(process.env.SUBAGENT_BASELINE);
  const agents = Array.from({ length: 4096 }, (_, i) => row(`child-${i}`, "parent"));
  for (const retained of [false, true]) {
    const input = props(agents, retained ? agents : []);
    assert.equal(serial(before(input)), serial(render(input)));
    const results = new Map([["before", []], ["after", []]]);
    if (!process.env.SUBAGENT_COUNTS_ONLY) {
      for (let trial = 0; trial < 3; trial += 1) {
        for (const [label, component] of trial % 2 ? [["after", render], ["before", before]] : [["before", before], ["after", render]]) {
          const start = performance.now();
          for (let update = 0; update < 20; update += 1) component(input);
          results.get(label).push(performance.now() - start);
        }
      }
    }
    for (const [label, component] of [["before", before], ["after", render]]) {
      let reads = 0;
      const counted = agents.map((agent) => ({ ...agent, get threadId() { reads += 1; return agent.threadId; } }));
      component(props(counted, retained ? counted : []));
      console.log(JSON.stringify({ label, retained, children: agents.length, renders: 20, medianMs: results.get(label).sort((a, b) => a - b)[1], threadIdReadsPerRender: reads }));
    }
  }
}
