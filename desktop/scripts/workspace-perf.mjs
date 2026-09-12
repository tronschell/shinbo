import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, file) => {
  module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: file,
  }).outputText, file);
};
const baselineRoot = path.resolve(process.argv[2] ?? "/tmp/shinbo-perf-baseline/tree");
const candidateRoot = path.resolve(process.argv[3] ?? path.join(import.meta.dirname, "../.."));
const load = (root, file) => require(path.join(root, "desktop", file));
const variants = [baselineRoot, candidateRoot].map((root) => ({
  git: load(root, "main/git.ts"), folders: load(root, "main/folders.ts"), terminal: load(root, "main/terminal.ts"),
  sharedGit: load(root, "shared/git.ts"), root,
}));
const fixture = fs.mkdtempSync(path.join(tmpdir(), "shinbo-workspace-perf-"));
const repo = path.join(fixture, "repo");
const run = (...args) => childProcess.execFileSync("git", args, { cwd: repo, stdio: "pipe" });
fs.mkdirSync(repo);
run("init", "-qb", "main");
run("config", "user.email", "benchmark@example.com");
run("config", "user.name", "Benchmark");
fs.writeFileSync(path.join(repo, "tracked.txt"), "old\n".repeat(5000));
run("add", ".");
run("commit", "-qm", "initial");
fs.writeFileSync(path.join(repo, "tracked.txt"), "changed\n".repeat(5000));
for (let index = 0; index < 20; index++) fs.writeFileSync(path.join(repo, `${index}.txt`), "created\n".repeat(12000));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = {};
const measured = async (name, action, samples = 5) => {
  const rows = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    const extra = await action();
    rows.push({ ms: performance.now() - start, ...extra });
  }
  results[name] = Object.fromEntries(Object.keys(rows[0]).map((key) => [key, Number(median(rows.map((row) => row[key])).toFixed(3))]));
};
const originalExec = childProcess.execFile;
let commands = [];
childProcess.execFile = (...args) => { commands.push(args[1]); return originalExec(...args); };
try {
  for (const [index, variant] of variants.entries()) {
    const name = index ? "fixed" : "baseline";
    await variant.git.gitSnapshot(repo);
    await measured(`${name}.fullSnapshot`, async () => {
      commands = [];
      const snapshot = await variant.git.gitSnapshot(repo);
      assert.equal(snapshot.files.length, 21);
      return { processes: commands.length, diffBytes: Buffer.byteLength(snapshot.diff) };
    });
    await measured(`${name}.summarySnapshot`, async () => {
      commands = [];
      const snapshot = await variant.git.gitSnapshot(repo, false, false);
      assert.equal(snapshot.files.length, 21);
      if (index) { assert.equal(commands.length, 5); assert.equal(snapshot.diff, ""); }
      return { processes: commands.length, diffBytes: Buffer.byteLength(snapshot.diff) };
    });
    await measured(`${name}.eightReaders`, async () => {
      commands = [];
      await Promise.all(Array.from({ length: 8 }, () => variant.git.gitSnapshot(repo)));
      if (index) assert.ok(commands.length <= 27);
      return { processes: commands.length };
    }, 3);
  }
} finally { childProcess.execFile = originalExec; }
const folder = path.join(fixture, "folder");
fs.mkdirSync(folder);
for (let bucket = 0; bucket < 80; bucket++) {
  const directory = path.join(folder, `bucket${bucket}`);
  fs.mkdirSync(directory);
  for (let index = 0; index < 300; index++) {
    const file = path.join(directory, `${index}.ts`);
    fs.writeFileSync(file, "");
    fs.truncateSync(file, 262145);
  }
}
for (const [index, variant] of variants.entries()) {
  const name = index ? "fixed" : "baseline";
  const store = new variant.folders.FolderStore(path.join(fixture, name));
  const [grant] = store.add(folder);
  const originalStat = fs.statSync;
  const originalAsyncStat = fsPromises.stat;
  let calls = 0;
  fs.statSync = (...args) => { calls++; return originalStat(...args); };
  fsPromises.stat = (...args) => { calls++; return originalAsyncStat(...args); };
  try {
    await measured(`${name}.oversizedFolder`, async () => {
      calls = 0;
      const start = performance.now();
      const timer = new Promise((resolve) => setTimeout(() => resolve(performance.now() - start), 0));
      const listing = await store.files(grant.id);
      const eventLoopDelayMs = await timer;
      assert.equal(listing.total, 0);
      if (index) { assert.equal(listing.capped, true); assert.ok(calls <= 16000); }
      return { eventLoopDelayMs, metadataReads: calls, capped: Number(listing.capped) };
    }, 3);
  } finally { fs.statSync = originalStat; fsPromises.stat = originalAsyncStat; }
}
const mentionsFolder = path.join(fixture, "mentions");
fs.mkdirSync(mentionsFolder);
for (let index = 0; index < 1000; index++) fs.writeFileSync(path.join(mentionsFolder, `file${String(index).padStart(4, "0")}.txt`), `file ${index} content`);
let expectedMentionContent;
for (const [index, variant] of variants.entries()) {
  const ast = ts.createSourceFile("main.ts", fs.readFileSync(path.join(variant.root, "desktop/main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "resolveMentions");
  const store = new variant.folders.FolderStore(path.join(fixture, `mentions-${index}`));
  store.add(mentionsFolder);
  let folderScans = 0;
  let noteScans = 0;
  const scope = {
    ...load(variant.root, "shared/slash.ts"), ...load(variant.root, "shared/folders.ts"),
    app: { getPath: () => fixture }, listArtifacts: async () => [], readVault: () => ({}),
    listNotes: () => { noteScans++; return []; },
    folders: {
      list: () => store.list(), files: (id) => { folderScans++; return store.files(id); },
      read: (id, file) => store.read(id, file),
    },
  };
  const code = ts.transpileModule(`return ${fn.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const resolve = Function(...Object.keys(scope), code)(...Object.values(scope));
  const prompt = Array.from({ length: 8 }, (_, number) => `@file${String(number).padStart(4, "0")}.txt`).join(" ");
  await measured(`${index ? "fixed" : "baseline"}.eightMentions`, async () => {
    folderScans = 0;
    noteScans = 0;
    const result = await resolve(prompt);
    expectedMentionContent ??= result.content;
    assert.equal(result.content, expectedMentionContent);
    if (index) { assert.equal(folderScans, 1); assert.equal(noteScans, 1); }
    return { folderScans, noteScans };
  });
}
const originalSpawn = childProcess.spawn;
for (const [index, variant] of variants.entries()) {
  const name = index ? "fixed" : "baseline";
  childProcess.spawn = () => originalSpawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
  const keepAlive = setInterval(() => undefined, 1000);
  try {
    await measured(`${name}.stopTerminal`, async () => {
      const terminals = new variant.terminal.Terminals(() => "pty", () => undefined, () => undefined);
      terminals.open({ threadId: "perf", cwd: repo, columns: 80, rows: 24 });
      await terminals.stopAll();
      assert.equal(terminals.list().length, 0);
      return {};
    }, 3);
  } finally { clearInterval(keepAlive); childProcess.spawn = originalSpawn; }
}
for (const [index, variant] of variants.entries()) {
  const source = fs.readFileSync(path.join(variant.root, "desktop/src/git.tsx"), "utf8");
  const ast = ts.createSourceFile("git.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "GitPage");
  const statements = fn.body.statements.filter((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => ["parsedDiff", "diffFiles"].includes(decl.name.getText(ast))));
  const code = ts.transpileModule(`return (live, filter, useMemo) => { ${statements.map((node) => node.getText(ast)).join("\n")} return diffFiles; };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let parses = 0;
  const invoke = Function("parseDiff", "matchesFilter", code)((...args) => { parses++; return variant.sharedGit.parseDiff(...args); }, variant.sharedGit.matchesFilter);
  const diff = Array.from({ length: 100 }, (_, file) => `diff --git a/file${file}.ts b/file${file}.ts\n--- a/file${file}.ts\n+++ b/file${file}.ts\n@@ -0,0 +1,500 @@\n${"+example content\n".repeat(500)}`).join("");
  await measured(`${index ? "fixed" : "baseline"}.filterTyping`, async () => {
    const memos = [];
    let slot = 0;
    const useMemo = (compute, deps) => {
      const position = slot++;
      if (!memos[position] || deps.some((dep, i) => dep !== memos[position].deps[i])) memos[position] = { deps, value: compute() };
      return memos[position].value;
    };
    parses = 0;
    for (const filter of ["", "f", "fi", "fil", "file", "file9", "file99"]) {
      slot = 0;
      const files = invoke({ diff }, filter, useMemo);
      assert.ok(files.length > 0);
    }
    if (index) assert.equal(parses, 1);
    return { parses };
  });
}
fs.rmSync(fixture, { recursive: true, force: true });
console.log(JSON.stringify({ baselineRoot, candidateRoot, results }, null, 2));
