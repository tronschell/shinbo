import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import * as harness from "../main/harness";

const source = ts.createSourceFile("main.ts", fs.readFileSync(path.join(process.cwd(), "main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);

for (const boundary of ["desktop", "phone"] as const) test(`R7-4 ${boundary} Clear context persists before any harness has started`, async (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "shinbo-clear-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "harness");
  fs.mkdirSync(home);
  const index = path.join(home, "shinbo-sessions.json");
  fs.writeFileSync(index, JSON.stringify({ task: "old-session", other: "keep-session" }));
  const scope = {
    app: { getPath: () => root }, path, userData: root, compactNext: new Set(["task"]), harnesses: new Map(),
    mainWindowSender() {}, boundedCapabilityId: (value: string) => value,
    forgetHarnessSession: (harness as unknown as Record<string, unknown>).forgetHarnessSession,
  };
  let body = "";
  const visit = (node: ts.Node) => {
    if (boundary === "desktop" && ts.isCallExpression(node) && node.expression.getText(source) === "ipcMain.handle" && node.arguments[0]?.getText(source) === '"shinbo:clear-thread-context"') body = node.arguments[1].getText(source);
    if (boundary === "phone" && ts.isFunctionDeclaration(node) && node.name?.text === "bridgeDispatch") body = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(body);
  const handler = Function(...Object.keys(scope), ts.transpile(`return (${body});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  if (boundary === "desktop") await handler({}, "task");
  else await handler("clearThreadContext", { threadId: "task" });
  const saved = JSON.parse(fs.readFileSync(index, "utf8"));
  t.diagnostic(`boundary=${boundary}; oldSessionRetained=${saved.task === "old-session"}; unrelatedRetained=${saved.other === "keep-session"}`);
  assert.equal(saved.task, undefined);
  assert.equal(saved.other, "keep-session");
});

for (const outcome of ["saved", "failed"] as const) test(`R7-4 Clear context marks the transcript only after ${outcome} persistence`, async () => {
  const renderer = ts.createSourceFile("App.tsx", fs.readFileSync(process.env.SHINBO_CLEAR_SOURCE ?? path.join(process.cwd(), "src/App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(renderer) === "pickCommand" && node.initializer?.getText(renderer).includes("clearThreadContext")) body = node.initializer!.getText(renderer);
    ts.forEachChild(node, visit);
  };
  visit(renderer);
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const persistence = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
  let marks = 0;
  const errors: string[] = [];
  const scope = {
    slash: { start: 0, query: "clear" }, message: "/clear", setMessage() {}, setSlashPick() {}, queueMicrotask() {},
    window: { shinbo: { clearThreadContext: () => persistence } }, thread: { id: "task", messages: ["original"] },
    markCleared: () => { marks++; }, ledgerChanged() {}, setRunError: (error: string) => errors.push(error), reasonText: (reason: Error) => reason.message,
  };
  const choose = Function(...Object.keys(scope), ts.transpile(`return (${body});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  choose({ kind: "builtin", id: "clear" });
  assert.equal(marks, 0);
  if (outcome === "saved") resolve();
  else reject(new Error("ENOSPC: context could not be cleared"));
  await new Promise((done) => setImmediate(done));
  assert.equal(marks, outcome === "saved" ? 1 : 0);
  assert.deepEqual(errors, outcome === "saved" ? [] : ["ENOSPC: context could not be cleared"]);
});
