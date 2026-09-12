import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import ts from "typescript";

const shared = path.resolve(import.meta.dirname, "../shared");
const improvement = path.join(shared, "improvement.ts");
const compile = (before, MapType = Map) => {
  const modules = new Map();
  const load = (file) => {
    if (modules.has(file)) return modules.get(file);
    const api = {};
    modules.set(file, api);
    const source = readFileSync(file === improvement && before ? before : file, "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("exports", "require", "Map", code)(api, (id) => load(path.resolve(path.dirname(file), `${id}.ts`)), MapType);
    return api;
  };
  return { ...load(improvement), ...load(path.join(shared, "trace.ts")) };
};
const api = compile();
const span = (id, kind, parentId, extra = {}) => ({ id, kind, parentId, name: id, startedAt: 1, endedAt: 2, status: "ok", ...extra });
const read = (spans, header = {}, timestamp = "2026-09-12T00:00:00Z", reader = api) => reader.readTurns({ timestamp, text: api.encodeSpans(spans, header) }, { id: "root", title: "Root" });
const fixture = (count) => ({ timestamp: "2026-09-12T00:00:00Z", text: api.encodeSpans(Array.from({ length: count }, (_, index) => span(`agent:${index}`, "agent", index ? "agent:0" : undefined, { name: `Agent ${index}`, startedAt: index, endedAt: index + 1, model: "local/fixture" })), { model: "local/fixture" }) });

const cases = [[], [span("legacy", "read")], [
  span("agent:root", "agent"), span("agent:child", "agent", "agent:root", { context: { model: "glm-5.3-flash", in: "100", out: "20" } }),
  span("call:child", "read", "agent:child", { status: "failed" }), span("call:nested", "read", "call:child"),
  span("orphan", "read", "missing"), span("cycle-a", "read", "cycle-b"), span("cycle-b", "read", "cycle-a"),
  span("duplicate", "read", "agent:child"), span("duplicate", "read", "agent:root"),
  span("long", "read", "agent:child", { output: "x".repeat(17000) }),
], [span("agent:same", "agent"), span("agent:same", "agent", undefined, { context: { model: "glm-5.3-flash" } })]];

test("turn groups retain exact ownership, normalization, dates, and duplicate ordering", () => {
  const [root, child] = read(cases[2], { model: "gpt-5.6-luna" });
  assert.deepEqual(root.spans.map((item) => item.id), ["agent:root", "orphan", "cycle-a", "cycle-b", "duplicate", "duplicate"]);
  assert.deepEqual(child.spans.map((item) => item.id), ["agent:child", "call:child", "call:nested", "long"]);
  assert.equal(child.tokens, 120);
  assert.equal(child.failures, 1);
  assert.equal(child.family, "glm");
  assert.equal(child.spans.at(-1).output.length, 16385);
  assert.equal(read(cases[2], {}, "invalid")[0].at, 0);
  assert.equal(read(cases[3]).length, 2);
  const legacy = { timestamp: "invalid", text: api.encodeSpans(cases[1]) };
  assert.deepEqual(api.readTurns(legacy, { id: "root", title: "Root" }), [api.readTurn(legacy, { id: "root", title: "Root" })]);
  const turns = [
    ...read([span("agent:root", "agent")], {}, "2026-01-01T00:00:00Z"),
    ...read([span("agent:other", "agent", undefined, { startedAt: 2 })], {}, "2026-09-11T00:00:00Z"),
    ...read([span("agent:root", "agent")], {}, "2026-09-12T00:00:00Z"),
  ];
  assert.deepEqual(api.distinctTurns(turns).filter((turn) => turn.at >= Date.parse("2026-06-14T00:00:00Z")).map((turn) => turn.threadId), ["root", "other"]);
});

test("each parsed span is assigned to its group once", () => {
  let lookups = 0;
  const measured = compile(undefined, class extends Map {
    get(key) { const value = super.get(key); if (typeof value === "string") lookups += 1; return value; }
  });
  lookups = 0;
  const trace = fixture(1024);
  const turns = measured.readTurns(trace, { id: "root", title: "Root" });
  assert.equal(turns.length, 1024);
  assert.equal(lookups, 1024);
  assert.ok(trace.text.length < 1024 * 1024);
});

if (process.env.TURN_GROUP_BASELINE) {
  const before = compile(process.env.TURN_GROUP_BASELINE);
  for (const spans of cases) for (const timestamp of ["invalid", "1969-12-01T00:00:00Z", "2026-09-12T00:00:00Z"]) assert.deepEqual(read(spans, { model: "gpt-5.6-luna" }, timestamp, before), read(spans, { model: "gpt-5.6-luna" }, timestamp));
  const trace = fixture(4096);
  assert.ok(trace.text.length < 1024 * 1024);
  assert.deepEqual(before.readTurns(trace, { id: "root", title: "Root" }), api.readTurns(trace, { id: "root", title: "Root" }));
  const timings = { before: [], after: [] };
  for (let run = 0; run < 3; run += 1) {
    for (const [name, reader] of run % 2 ? [["after", api], ["before", before]] : [["before", before], ["after", api]]) {
      const start = performance.now();
      reader.readTurns(trace, { id: "root", title: "Root" });
      timings[name].push(performance.now() - start);
    }
  }
  for (const [name, source] of [["before", process.env.TURN_GROUP_BASELINE], ["after", undefined]]) {
    let lookups = 0;
    const measured = compile(source, class extends Map {
      get(key) { const value = super.get(key); if (typeof value === "string") lookups += 1; return value; }
    });
    lookups = 0;
    measured.readTurns(trace, { id: "root", title: "Root" });
    console.log(JSON.stringify({ name, agentSpans: 4096, bytes: trace.text.length, medianMs: timings[name].sort((a, b) => a - b)[1], ownerLookups: lookups }));
  }
}
