import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const compiled = (directory) => ts.transpileModule(readFileSync(path.join(directory, "src/markdown-parse.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const load = (directory) => {
  const exports = {};
  vm.runInNewContext(compiled(directory), { exports, URL });
  return exports;
};

test("padded table lookahead stays linear and preserves table recognition", () => {
  const current = load(root);
  const input = "| Header |\n" + " ".repeat(12000) + "| ordinary text";
  const variants = process.env.SHINBO_MARKDOWN_BASELINE ? [process.env.SHINBO_MARKDOWN_BASELINE, root] : [root];
  for (const directory of variants) {
    const baseline = directory !== root;
    const { parseBlocks } = load(directory);
    const times = [];
    for (let trial = 0; trial < 5; trial++) {
      const start = performance.now();
      const blocks = parseBlocks(input);
      times.push(performance.now() - start);
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0].kind, "paragraph");
      assert.equal(blocks[0].spans[0].text, "| Header |\n| ordinary text");
    }
    if (baseline) {
      const alphabet = [" ", "|", "-", ":", "\t", "x", "\u2028", "\u2029"];
      let candidates = [""];
      for (let length = 0; length < 4; length++) candidates = ["", ...candidates.flatMap((text) => alphabet.map((letter) => text + letter))];
      for (const line of candidates) {
        const markdown = `| Header |\n${line}\n| Cell |`;
        assert.equal(JSON.stringify(current.parseBlocks(markdown)), JSON.stringify(parseBlocks(markdown)), JSON.stringify(line));
      }
    }
    console.log(JSON.stringify({ issue: "markdown-table-lookahead", baseline, inputBytes: input.length, indentationSpaces: 12000, medianMs: times.sort((a, b) => a - b)[2] }));
  }
  for (const delimiter of ["| --- | :---: |", "--- | ---", " :-- | --: ", "\u2028\t| --- |\u2029"]) {
    const block = current.parseBlocks(`| Header |\n${delimiter}\n| Cell |`)[0];
    assert.equal(block.kind, "table", delimiter);
    assert.equal(block.rows[0][0][0].text, "Cell");
  }
  const checked = spawnSync(process.execPath, ["-e", `${compiled(root)}\nconst input = "| Header |\\n" + " ".repeat(60000) + "| ordinary text"; require("node:assert/strict").equal(exports.parseBlocks(input)[0].kind, "paragraph");`], { timeout: 2000, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.error?.message ?? checked.stderr);
});
