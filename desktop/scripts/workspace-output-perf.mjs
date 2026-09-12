import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: file,
}).outputText, file);
const roots = [path.resolve(process.argv[2] ?? "/tmp/shinbo-perf-round2/tree"), path.resolve(process.argv[3] ?? path.join(import.meta.dirname, "../.."))];
const variants = roots.map((root) => ({ git: require(path.join(root, "desktop/main/git.ts")), terminal: require(path.join(root, "desktop/main/terminal.ts")) }));
const repo = fs.mkdtempSync(path.join(tmpdir(), "shinbo-output-perf-"));
const run = (...args) => childProcess.execFileSync("git", args, { cwd: repo, stdio: "pipe" });
run("init", "-qb", "main");
run("config", "user.email", "benchmark@example.com");
run("config", "user.name", "Benchmark");
fs.writeFileSync(path.join(repo, "tracked.txt"), "before\n");
run("add", ".");
run("commit", "-qm", "initial");
for (let index = 0; index < 20; index++) fs.writeFileSync(path.join(repo, `generated-${String(index).padStart(2, "0")}.txt`), "generated output line\n".repeat(200_000));
const results = {};
const originalExec = childProcess.execFile;
try {
  let expectedDiff;
  for (const [index, variant] of variants.entries()) {
    const rows = [];
    for (let sample = 0; sample < 3; sample++) {
      let patchBytes = 0;
      let patchProcesses = 0;
      let active = 0;
      let peak = 0;
      childProcess.execFile = (...args) => {
        const patch = args[1].includes("diff");
        if (patch) { patchProcesses++; peak = Math.max(peak, ++active); }
        const callback = args.pop();
        return originalExec(...args, (...values) => {
          if (patch) { active--; patchBytes += Buffer.byteLength(values[1]); }
          callback(...values);
        });
      };
      const start = performance.now();
      const snapshot = await variant.git.gitSnapshot(repo);
      const ms = performance.now() - start;
      assert.equal(snapshot.files.length, 20);
      assert.equal(snapshot.truncated, true);
      expectedDiff ??= snapshot.diff;
      assert.equal(snapshot.diff, expectedDiff);
      if (index) { assert.ok(patchBytes <= 4 * (512 * 1024 + 1)); assert.equal(patchProcesses, 5); }
      rows.push({ ms, patchBytes, patchProcesses, peakPatchProcesses: peak, displayedBytes: Buffer.byteLength(snapshot.diff) });
    }
    results[`${index ? "fixed" : "baseline"}.largeUntrackedDiff`] = Object.fromEntries(Object.keys(rows[0]).map((key) => [key, [...rows.map((row) => row[key])].sort((a, b) => a - b)[1]]));
  }
} finally { childProcess.execFile = originalExec; fs.rmSync(repo, { recursive: true, force: true }); }
const originalSpawn = childProcess.spawn;
try {
  for (const [index, variant] of variants.entries()) {
    const children = [];
    childProcess.spawn = () => {
      const child = Object.assign(new EventEmitter(), { stdin: new EventEmitter(), stdout: new EventEmitter(), stderr: new EventEmitter() });
      children.push(child);
      return child;
    };
    const output = [];
    const terminals = new variant.terminal.Terminals(() => "pty", (id, data, at) => output.push({ id, data, at }), () => undefined);
    const tabs = Array.from({ length: 8 }, () => terminals.open({ threadId: "bench", cwd: tmpdir(), columns: 80, rows: 24 }));
    const chunk = Buffer.alloc(64, 97);
    for (const child of children) for (let count = 0; count < 1000; count++) child.stdout.emit("data", chunk);
    await new Promise((resolve) => setTimeout(resolve, 25));
    for (const tab of tabs) {
      const events = output.filter((entry) => entry.id === tab.id);
      assert.deepEqual(Buffer.concat(events.map((entry) => entry.data)), Buffer.alloc(64_000, 97));
      assert.equal(events.at(-1).at, 64_000);
      terminals.close(tab.id);
    }
    if (index) assert.equal(output.length, 8);
    results[`${index ? "fixed" : "baseline"}.terminalBurst`] = { chunks: 8000, broadcasts: output.length, bytes: output.reduce((sum, entry) => sum + entry.data.length, 0) };
  }
} finally { childProcess.spawn = originalSpawn; }
console.log(JSON.stringify({ roots, results }, null, 2));
