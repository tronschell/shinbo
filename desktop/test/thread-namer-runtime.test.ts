import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("R4-N1 delayed automatic naming preserves a user's newer title", async () => {
  const source = readFileSync(process.env.SHINBO_NAMER_TEST_SOURCE ?? path.join(process.cwd(), "main/main.ts"), "utf8");
  const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const node = parsed.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "autoNameThread");
  assert.ok(node);
  let title = "New thread";
  let noted = "";
  const name = runInNewContext(ts.transpileModule(`(${node.getText(parsed)})`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    namingThreads: new Set(), benchThread: () => false, DEFAULT_THREAD_TITLE: "New thread", freeRouter: {}, console,
    nameThread: async () => { title = "My chosen title"; return "Automatic replacement"; },
    noteThreadName: (_id: string, value: string) => { noted = value; }, changed: () => undefined,
    host: { request: async ({ method, params }: { method: string; params: Record<string, string> }) => {
      if (method === "threadSummaries") return { threads: [{ id: "thread", title }] };
      if (method === "renameThread") { if (params.expectedTitle === undefined || title === params.expectedTitle) title = params.title; return { id: "thread", title }; }
      throw new Error(method);
    } },
  }) as (threadId: string, asked: string) => Promise<void>;
  await name("thread", "A useful question");
  assert.equal(title, "My chosen title");
  assert.equal(noted, "My chosen title");
});

test("I3-05 councils reject full tasks before starting model work", async () => {
  const source = readFileSync(process.env.SHINBO_NAMER_TEST_SOURCE ?? path.join(process.cwd(), "main/main.ts"), "utf8");
  const begin = source.indexOf('ipcMain.handle("shinbo:council-start"');
  const end = source.indexOf('ipcMain.handle("shinbo:council-stop"', begin);
  let handler!: (event: unknown, value: unknown) => Promise<unknown>;
  let starts = 0;
  runInNewContext(ts.transpileModule(source.slice(begin, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ipcMain: { handle: (_name: string, action: typeof handler) => { handler = action; } },
    mainWindowSender: () => undefined, validateCouncilStart: (value: unknown) => value,
    host: { request: async () => { throw new Error("Start a new thread"); } },
    startCouncil: async () => { starts++; return {}; },
  });
  const result = await handler({}, { threadId: "full" }).then(() => "started", (error: Error) => error.message);
  assert.equal(result, "Start a new thread");
  assert.equal(starts, 0);
});
