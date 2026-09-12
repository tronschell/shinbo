import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const load = (directory, globals = {}, file = "shared/trace.ts") => {
  const exports = {};
  const source = readFileSync(path.join(directory, file), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, ...globals });
  return exports;
};

test("large flat traces build sibling lists without recopying prior siblings", () => {
  const count = 8000;
  const spans = [
    { id: "agent:root", name: "Long turn", kind: "agent", status: "running", startedAt: 0 },
    ...Array.from({ length: count }, (_, index) => ({ id: `call:${index}`, parentId: "agent:root", name: `Tool ${index}`, kind: "read", status: "ok", startedAt: index, endedAt: index + 1, tokens: 1 })),
  ];
  const variants = process.env.SHINBO_RENDERER_WAVE3_BASELINE ? [process.env.SHINBO_RENDERER_WAVE3_BASELINE, root] : [root];
  let before;
  for (const directory of variants) {
    const baseline = directory !== root;
    let copied = 0;
    class CountedMap extends Map {
      set(key, value) {
        if (this.has(key) && Array.isArray(value) && this.get(key) !== value) copied += this.get(key).length;
        return super.set(key, value);
      }
    }
    const counted = load(directory, { Map: CountedMap });
    const laid = counted.layoutSpans(spans, count + 1);
    if (!baseline) assert.equal(copied, 0);
    assert.equal(laid.length, count + 1);
    assert.equal(laid[0].children, count);
    assert.equal(laid[0].durationMs, count + 1);
    assert.equal(laid.at(-1).span, spans.at(-1));
    assert.equal(laid.at(-1).depth, 1);
    const actual = load(directory);
    const times = [];
    for (let trial = 0; trial < 5; trial++) {
      const start = performance.now();
      actual.layoutSpans(spans, count + 1);
      times.push(performance.now() - start);
    }
    const closed = actual.layoutSpans(spans, count + 1, new Set(["agent:root"]));
    assert.equal(closed.length, 1);
    assert.equal(closed[0].children, count);
    const axis = actual.tokenAxis(spans);
    assert.equal(axis[0].endedAt, count);
    assert.equal(axis.at(-1).endedAt, count);
    const normalized = JSON.stringify(laid);
    if (baseline) before = normalized;
    else if (before) assert.equal(normalized, before);
    console.log(JSON.stringify({ issue: "trace-sibling-layout", baseline, childSpans: count, recopiedSiblingReferences: copied, medianMs: times.sort((a, b) => a - b)[2] }));
  }
});

test("padded Markdown headings parse without catastrophic whitespace backtracking", () => {
  const file = "src/markdown-parse.ts";
  const current = load(root, {}, file);
  const body = "x" + " ".repeat(1000) + "x";
  const variants = process.env.SHINBO_RENDERER_WAVE3_BASELINE ? [process.env.SHINBO_RENDERER_WAVE3_BASELINE, root] : [root];
  for (const directory of variants) {
    const baseline = directory !== root;
    const { parseBlocks } = load(directory, {}, file);
    const times = [];
    for (let trial = 0; trial < 5; trial++) {
      const start = performance.now();
      const blocks = parseBlocks(`# ${body}`);
      times.push(performance.now() - start);
      assert.equal(blocks[0].kind, "heading");
      assert.equal(blocks[0].level, 1);
      assert.equal(blocks[0].spans[0].text, body);
    }
    if (baseline) {
      const alphabet = ["x", " ", "#", "\t", "\u2028", "\u2029"];
      let bodies = [""];
      for (let length = 0; length < 4; length++) bodies = ["", ...bodies.flatMap((body) => alphabet.map((letter) => body + letter))];
      for (const prefix of ["# ", "   ###\t", "####### "]) for (const text of bodies) {
        const markdown = prefix + text;
        assert.equal(JSON.stringify(current.parseBlocks(markdown)), JSON.stringify(parseBlocks(markdown)), JSON.stringify(markdown));
      }
    }
    console.log(JSON.stringify({ issue: "markdown-heading", baseline, paddingSpaces: 1000, medianMs: times.sort((a, b) => a - b)[2] }));
  }
  const source = readFileSync(path.join(root, file), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const checked = spawnSync(process.execPath, ["-e", `${code}\nconst body = "x" + " ".repeat(60000) + "x"; const block = exports.parseBlocks("# " + body)[0]; require("node:assert/strict").equal(block.spans[0].text, body);`], { timeout: 3000, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.error?.message ?? checked.stderr);
  for (const [text, expected] of [["# title ### ", "title"], ["## \t", ""], ["# x\u2028##\u2029", "x"]]) {
    const parsed = current.parseBlocks(text);
    assert.equal(parsed[0].kind, "heading");
    assert.equal(parsed[0].spans[0].text, expected);
  }
});
