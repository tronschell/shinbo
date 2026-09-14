import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { asPermissionMode, DEFAULT_PERMISSION_MODE } from "../shared/permissions";
import { isThinkingLevel } from "../shared/settings";




const source = ts.createSourceFile("main.ts", readFileSync(path.join(process.cwd(), "main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const lift = (name: string) => source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(source);
const liftConst = (name: string) => source.statements.find((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some((one) => one.name.getText(source) === name))!.getText(source);

const persistence = ts.transpileModule([
  liftConst("threadContextsFile"), lift("loadThreadContexts"), lift("rememberThreadContext"), lift("pruneThreadContexts"), lift("writeThreadContexts"),
  "({ loadThreadContexts, rememberThreadContext, pruneThreadContexts });",
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const on = (dir: string, threadContexts: Map<string, unknown>) => runInNewContext(persistence, {
  app: { getPath: () => dir }, path, readFileSync, writeFileSync, renameSync, rmSync, randomUUID,
  threadContexts, asPermissionMode, isThinkingLevel,
}) as { loadThreadContexts(): void; rememberThreadContext(id: string, record: unknown): void; pruneThreadContexts(ids: Set<string>): void };



const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

test("a thread's folder and permission mode survive a restart", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shinbo-thread-context-"));
  on(dir, new Map()).rememberThreadContext("t1", { folderIds: ["f-shinbo"], mode: "acceptEdits", model: "openrouter:x" });

  const after = new Map();
  on(dir, after).loadThreadContexts();
  assert.deepEqual(plain(after.get("t1")), { folderIds: ["f-shinbo"], mode: "acceptEdits", model: "openrouter:x" });
});

test("an unchanged record is not rewritten and threads the host no longer lists are pruned", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shinbo-thread-context-"));
  const file = path.join(dir, "thread-contexts.json");
  const held = new Map();
  const store = on(dir, held);
  store.rememberThreadContext("t1", { folderIds: [], mode: "ask", model: "" });
  store.rememberThreadContext("t2", { folderIds: [], mode: "ask", model: "" });
  writeFileSync(file, "untouched");
  store.rememberThreadContext("t1", { folderIds: [], mode: "ask", model: "" });
  assert.equal(readFileSync(file, "utf8"), "untouched");
  store.pruneThreadContexts(new Set(["t1", "t2"]));
  assert.equal(readFileSync(file, "utf8"), "untouched");
  store.pruneThreadContexts(new Set(["t2"]));
  assert.deepEqual([...held.keys()], ["t2"]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")) as object), ["t2"]);
});

test("a thread-contexts file that will not read leaves the map empty rather than failing the boot", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shinbo-thread-context-"));
  writeFileSync(path.join(dir, "thread-contexts.json"), "{ not json");
  const held = new Map();
  assert.doesNotThrow(() => on(dir, held).loadThreadContexts());
  assert.equal(held.size, 0);
});

test("a tampered record falls back per field rather than installing a mode nothing can gate on", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shinbo-thread-context-"));
  writeFileSync(path.join(dir, "thread-contexts.json"),
    JSON.stringify({ t1: { folderIds: ["a", "b"], mode: "yolo", model: 7 }, "": { folderIds: [] }, t2: null }));
  const held = new Map();
  on(dir, held).loadThreadContexts();
  assert.deepEqual(plain(held.get("t1")), { folderIds: ["a"], mode: DEFAULT_PERMISSION_MODE, model: "" });
  assert.equal(held.size, 1, "a keyless or null record is a thread not restored, never a crash");
});
