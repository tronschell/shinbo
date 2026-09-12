import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import ts from "typescript";

const source = process.env.DIFF_BENCH_SOURCE ?? path.resolve(import.meta.dirname, "../shared/agents.ts");
const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {};
new Function("exports", compiled)(api);
const { diffLines, diffStat, diffHunks, editStat } = api;
const lines = (text) => text ? text.split("\n") : [];
const verify = (before, after) => {
  const result = diffLines(before, after);
  assert.deepEqual(result.filter((line) => line.kind !== "+").map((line) => line.text), lines(before));
  assert.deepEqual(result.filter((line) => line.kind !== "-").map((line) => line.text), lines(after));
  const a = lines(before);
  const b = lines(after);
  let row = new Uint32Array(b.length + 1);
  for (const line of a) {
    const next = new Uint32Array(b.length + 1);
    for (let j = 0; j < b.length; j += 1) next[j + 1] = line === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]);
    row = next;
  }
  assert.equal(result.filter((line) => line.kind === " ").length, row[b.length]);
};
const fixture = (name, count) => {
  const before = Array.from({ length: count }, (_, i) => `line ${i}`).join("\n");
  if (name === "sparse") return [before, before.replace("line 0", "first changed").replace(`line ${count - 1}`, "last changed")];
  if (name === "reversed") return [before, lines(before).reverse().join("\n")];
  if (name === "replacement") return [before, Array.from({ length: count }, (_, i) => `replacement ${i}`).join("\n")];
  if (name === "repeated") return ["a\nb\n".repeat(count / 2), "b\na\n".repeat(count / 2)];
  if (name === "dense" || name === "dense-wide") {
    const alphabet = name === "dense" ? 31 : 257;
    return [Array.from({ length: count }, (_, i) => `line ${i % alphabet}`).join("\n"), Array.from({ length: count }, (_, i) => `line ${(i * 17) % alphabet}`).join("\n")];
  }
  return [before, before];
};

if (process.env.DIFF_BENCH_SOURCE) {
  const name = process.env.DIFF_BENCH_FIXTURE ?? "sparse";
  const count = Number(process.env.DIFF_BENCH_LINES ?? 4000);
  const [before, after] = fixture(name, count);
  const timings = [];
  let result;
  for (let i = 0; i < 5; i += 1) {
    global.gc?.();
    const start = performance.now();
    result = api.editStat({ folderId: "f", path: "large.txt", before, after, at: 0 });
    timings.push(performance.now() - start);
  }
  console.log(JSON.stringify({ source, fixture: name, count, bytes: [before.length, after.length], medianMs: timings.sort((a, b) => a - b)[2], maxRssMiB: process.resourceUsage().maxRSS / 1024, added: result.added, removed: result.removed, hunkLines: result.hunks.length }));
} else {
  test("line diffs reconstruct both texts and retain exact shortest edit counts", () => {
    const texts = [""];
    for (let n = 1; n <= 5; n += 1) {
      for (let bits = 0; bits < 2 ** n; bits += 1) texts.push(Array.from({ length: n }, (_, i) => bits & 2 ** i ? "a" : "b").join("\n"));
    }
    for (const before of texts) for (const after of texts) verify(before, after);
    for (const before of ["", "α\n🦊\n", "\n", "a\n\nb", "same", "same\n"]) {
      for (const after of ["", "β\n🦊", "\n\n", "b\n\na", "same", "same\n"]) verify(before, after);
    }
    let seed = 42;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (const name of ["reversed", "dense", "dense-wide"]) {
      for (const size of [128, 256, 511]) verify(...fixture(name, size));
    }
    for (let run = 0; run < 120; run += 1) {
      const text = () => Array.from({ length: 100 + random() % 300 }, () => `line ${random() % 127}`).join("\n");
      verify(text(), text());
    }
    for (let run = 0; run < 2000; run += 1) {
      const text = () => Array.from({ length: random() % 80 }, () => `line ${random() % 12}`).join("\n");
      verify(text(), text());
    }
  });

  test("large separated edits and replacements keep exact stats with bounded diff workspace", () => {
    let allocated = 0;
    const measured = {};
    new Function("exports", "Int32Array", "Array", "Map", compiled)(measured, class extends Int32Array {
      constructor(length) { super(length); allocated += this.byteLength; }
    }, class extends Array {
      constructor(...args) {
        if (args.length === 1 && typeof args[0] === "number") {
          allocated += args[0] * 8;
          assert.ok(allocated < 30000 * 256, "diff allocated a quadratic matrix");
        }
        super(...args);
      }
    }, class extends Map {
      bytes = 0;
      set(key, value) {
        if (typeof value === "bigint") {
          this.bytes += Math.ceil(value.toString(2).length / 8);
          assert.ok(this.bytes <= 30000 * 64, "diff cached quadratic bigint masks");
        }
        return super.set(key, value);
      }
    });
    for (const name of ["sparse", "replacement", "repeated", "unchanged", "reversed"]) {
      const [before, after] = fixture(name, 30000);
      allocated = 0;
      const result = measured.diffLines(before, after);
      assert.ok(allocated < 30000 * 256, `${name} allocated ${allocated} frontier bytes`);
      assert.deepEqual(result.filter((line) => line.kind !== "+").map((line) => line.text), lines(before));
      assert.deepEqual(result.filter((line) => line.kind !== "-").map((line) => line.text), lines(after));
      const expected = name === "sparse" ? 2 : name === "replacement" ? 30000 : name === "repeated" ? 1 : name === "reversed" ? 29999 : 0;
      assert.deepEqual(diffStat([{ before, after }]), { added: expected, removed: expected, files: 1 });
      assert.ok(diffHunks(before, after).length <= 200);
      assert.deepEqual(editStat({ path: "large.txt", before, after }), { path: "large.txt", added: expected, removed: expected, hunks: diffHunks(before, after) });
    }
  });
}
