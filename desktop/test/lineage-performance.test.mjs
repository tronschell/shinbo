import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import ts from "typescript";

const current = path.resolve(import.meta.dirname, "../src/activity.ts");
const compile = (file, MapType = Map) => {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "lineage");
  assert.ok(declaration);
  const api = {};
  const code = ts.transpileModule(`${declaration.getText(tree)}\nexport { lineage };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "Map", code)(api, MapType);
  return api.lineage;
};
const thread = (id, parentThreadId, updatedAt = "2026-09-12T00:00:00Z") => ({ id, parentThreadId, updatedAt });
const fixture = (count) => [thread("root"), ...Array.from({ length: count }, (_, index) => thread(`child-${index}`, "root"))];
const copies = (file, rows) => {
  let copied = 0;
  const lineage = compile(file, class extends Map {
    set(key, value) {
      const previous = super.get(key);
      if (Array.isArray(previous) && Array.isArray(value) && previous !== value) copied += previous.length;
      return super.set(key, value);
    }
  });
  const result = lineage(rows, 60);
  return { copied, result };
};
const lineage = compile(current);

test("activity lineage keeps stable hierarchy and input data while grouping large sibling lists", () => {
  const rows = [thread("root"), thread("same-time-first", "root"), thread("same-time-second", "root"), thread("newest", "root", "2026-09-13T00:00:00Z"), thread("grandchild", "same-time-first"), thread("orphan", "missing"), thread("self", "self")];
  const saved = JSON.stringify(rows);
  const result = lineage(rows, 60);
  assert.deepEqual(result.map((row) => [row.thread.id, row.depth]), [["root", 0], ["newest", 1], ["same-time-first", 1], ["grandchild", 2], ["same-time-second", 1], ["orphan", 0]]);
  assert.equal(JSON.stringify(rows), saved);
  assert.equal(lineage(rows, 0).length, 0);
  assert.deepEqual(lineage(rows, 3), result.slice(0, 3));
  const large = copies(current, fixture(4096));
  assert.equal(large.result.length, 60);
  assert.equal(large.copied, 0);
  assert.deepEqual(large.result.slice(0, 3).map((row) => row.thread.id), ["root", "child-0", "child-1"]);
});

if (process.env.LINEAGE_BASELINE) {
  const before = compile(process.env.LINEAGE_BASELINE);
  for (const count of [4096, 16000]) {
    const rows = fixture(count);
    assert.deepEqual(before(rows, 60), lineage(rows, 60));
    const timings = { before: [], after: [] };
    for (let run = 0; run < 3; run += 1) {
      for (const [name, render] of run % 2 ? [["after", lineage], ["before", before]] : [["before", before], ["after", lineage]]) {
        const start = performance.now();
        render(rows, 60);
        timings[name].push(performance.now() - start);
      }
    }
    for (const [name, source] of [["before", process.env.LINEAGE_BASELINE], ["after", current]]) console.log(JSON.stringify({ name, children: count, shown: 60, medianMs: timings[name].sort((a, b) => a - b)[1], redundantCopies: copies(source, rows).copied }));
  }
}
