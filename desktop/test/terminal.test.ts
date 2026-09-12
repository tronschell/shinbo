import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { MAX_TERMINAL_SCROLLBACK, MAX_TERMINAL_SELECTION_CHARS, MAX_TERMINAL_SELECTION_LINES, terminalSelection, terminalTitle, type TerminalTab } from "../shared/terminal";
import { Terminals } from "../main/terminal";
import { isWindows } from "../main/platform";
import { defaultPaneLayout, validatePaneLayout } from "../src/layout";

test("terminal scrollback preserves output and offsets through repeated eviction and compaction", (t) => {
  const child = Object.assign(new EventEmitter(), { stdin: new EventEmitter(), stdout: new EventEmitter(), stderr: new EventEmitter() });
  t.mock.method(childProcess, "spawn", () => child);
  let written = 0;
  const terminals = new Terminals(() => "pty", (_id, data, at) => {
    written += data.length;
    assert.equal(at, written);
  }, () => undefined);
  const tab = terminals.open({ threadId: "thread", cwd: process.cwd(), columns: 80, rows: 24 });
  const expected: Buffer[] = [];
  for (let index = 0; index < 16_000; index++) {
    const chunk = Buffer.alloc(64, index % 256);
    expected.push(chunk);
    (index % 2 ? child.stdout : child.stderr).emit("data", chunk);
    if (index % 4000 === 3999) {
      const snapshot = terminals.buffer(tab.id);
      assert.equal(snapshot.at, written);
      assert.deepEqual(snapshot.data, Buffer.concat(expected).subarray(-MAX_TERMINAL_SCROLLBACK));
    }
  }
  terminals.close(tab.id);
  assert.deepEqual(terminals.buffer(tab.id), { data: Buffer.alloc(0), at: 0 });
});

test("terminal subscriptions follow the selected thread and ignore stale tabs and responses", async () => {
  const source = ts.createSourceFile("terminal.tsx", readFileSync(path.join(__dirname, "../../src/terminal.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hook = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useTerminals");
  assert.ok(hook);
  const requests: { threadId: string; resolve: (tabs: TerminalTab[]) => void }[] = [];
  const listeners = new Set<() => void>();
  let state: TerminalTab[] = [];
  let writes = 0;
  let stopped = 0;
  let thread: string | undefined;
  let cleanup: (() => void) | void = undefined;
  let effect: (() => (() => void) | void) | undefined;
  const scope = {
    useState: () => [state, (tabs: TerminalTab[]) => { state = tabs; writes++; }],
    useEffect(next: () => (() => void) | void, [id]: string[]) {
      if (id === thread) return;
      thread = id;
      effect = next;
    },
    window: { shinbo: {
      listTerminals: (threadId: string) => new Promise<TerminalTab[]>((resolve) => { requests.push({ threadId, resolve }); }),
      onTerminals: (listener: () => void) => {
        listeners.add(listener);
        return () => { assert.equal(listeners.delete(listener), true); stopped++; };
      },
    } },
  };
  const invoke = Function(...Object.keys(scope), ts.transpile(`return (${hook.getText(source).replace(/^export /, "")});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope)) as (threadId: string) => TerminalTab[];
  const render = (id: string) => {
    const tabs = invoke(id);
    if (effect) { cleanup?.(); cleanup = effect(); effect = undefined; }
    return tabs;
  };
  const unmount = () => cleanup?.();
  const respond = async (index: number, tabs: TerminalTab[]) => { requests[index].resolve(tabs); await Promise.resolve(); };
  const changed = () => listeners.forEach((listener) => listener());
  const first: TerminalTab = { id: "terminal-first", threadId: "first", title: "shell", cwd: "/tmp", running: true, exitCode: null };
  const second = { ...first, id: "terminal-second", threadId: "second" };

  assert.deepEqual(render(""), []);
  assert.equal(requests.length, 0);
  assert.equal(listeners.size, 0);
  assert.deepEqual(render("first"), []);
  assert.equal(listeners.size, 1);
  assert.equal(requests[0].threadId, "first");
  await respond(0, [first]);
  assert.deepEqual(render("first"), [first]);
  assert.equal(requests.length, 1);
  changed();
  await respond(1, [{ ...first, running: false }]);
  assert.equal(render("first")[0].running, false);

  changed();
  assert.deepEqual(render("second"), []);
  assert.equal(stopped, 1);
  assert.equal(listeners.size, 1);
  assert.deepEqual(requests.map((request) => request.threadId), ["first", "first", "first", "second"]);
  await respond(3, [second]);
  assert.deepEqual(render("second"), [second]);
  const settledWrites = writes;
  await respond(2, [first]);
  assert.deepEqual(render("second"), [second]);
  assert.equal(writes, settledWrites);

  changed();
  assert.deepEqual(render(""), []);
  assert.equal(listeners.size, 0);
  assert.equal(stopped, 2);
  assert.equal(requests.length, 5);
  await respond(4, [second]);
  assert.deepEqual(render(""), []);
  assert.equal(writes, settledWrites);
  render("first");
  unmount();
  await respond(5, [first]);
  assert.equal(listeners.size, 0);
  assert.equal(stopped, 3);
  assert.equal(writes, settledWrites);
});

test("the terminal pane retries when the thread is pointed at another folder", () => {
  const source = ts.createSourceFile("terminal-implementation.tsx", readFileSync(path.join(__dirname, "..", "..", "src", "terminal-implementation.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.getText(source).includes("listTerminals")) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(found.length, 1);
  const [body, deps] = found[0].arguments;
  assert.ok(ts.isArrayLiteralExpression(deps));
  assert.deepEqual(deps.elements.map((item) => item.getText(source)).sort(), ["folderId", "start", "threadId"]);
  assert.match(body.getText(source), /setError\(""\)/);
});

test("xterm stays behind the terminal implementation lazy boundary", () => {
  const eager = readFileSync(path.join(__dirname, "..", "..", "src", "terminal.tsx"), "utf8");
  const implementation = readFileSync(path.join(__dirname, "..", "..", "src", "terminal-implementation.tsx"), "utf8");
  assert.doesNotMatch(eager, /@xterm\//);
  assert.match(eager, /LazyTerminalSurface = lazy\(\(\) => import\(["']\.\/terminal-implementation["']\)/);
  assert.match(eager, /LazyTerminalPanel = lazy\(\(\) => import\(["']\.\/terminal-implementation["']\)/);
  assert.match(implementation, /@xterm\/xterm\/css\/xterm\.css/);
});

test("a shell is named after the folder it was opened in", () => {
  assert.equal(terminalTitle("/Users/someone/Documents/shinbo"), "shinbo");
  assert.equal(terminalTitle("/Users/someone/Documents/shinbo/"), "shinbo");
  assert.equal(terminalTitle("/"), "shell");
  assert.equal(terminalTitle(`/tmp/${"a".repeat(41)}`), "shell");
});

test("a selection arrives as the lines that were drawn over, without the blank ones around them", () => {
  const picked = terminalSelection("\n\n  npm test   \r\n   \nok 334\n\n");
  assert.deepEqual(picked, { text: "  npm test\n\nok 334", lines: 3 });
});

test("selecting nothing but whitespace attaches nothing", () => {
  assert.equal(terminalSelection(""), null);
  assert.equal(terminalSelection("\n  \n\t\n"), null);
});

test("a runaway selection is cut off and says so, and still reports what was there", () => {
  const picked = terminalSelection(Array.from({ length: MAX_TERMINAL_SELECTION_LINES + 12 }, (_, index) => `line ${index}`).join("\n"));
  assert.ok(picked);
  assert.equal(picked.lines, MAX_TERMINAL_SELECTION_LINES + 12);
  assert.match(picked.text, /\n\[12 more lines not attached\]$/);
  assert.equal(picked.text.split("\n").length, MAX_TERMINAL_SELECTION_LINES + 1);
});

test("one very long line is cut to the character budget", () => {
  const picked = terminalSelection("x".repeat(MAX_TERMINAL_SELECTION_CHARS + 500));
  assert.ok(picked);
  assert.equal(picked.text.length, MAX_TERMINAL_SELECTION_CHARS);
});

test("the terminal opens shut, and a stored height outside the pane's range is pulled back into it", () => {
  assert.equal(defaultPaneLayout.terminalOpen, false);
  assert.equal(validatePaneLayout({}).terminalHeight, defaultPaneLayout.terminalHeight);
  assert.equal(validatePaneLayout({ terminalHeight: 5 }).terminalHeight, 120);
  assert.equal(validatePaneLayout({ terminalHeight: 9999 }).terminalHeight, 720);
  assert.equal(validatePaneLayout({ terminalOpen: "yes" }).terminalOpen, false);
  assert.equal(validatePaneLayout({ terminalOpen: true, terminalHeight: 300 }).terminalHeight, 300);
});

test("the terminal is a full-width row under the thread, not a fourth column", () => {
  const css = readFileSync(path.join(__dirname, "..", "..", "src", "styles", "conversation.css"), "utf8").split("\n");
  const layout = css.find((line) => line.startsWith(".thread-layout {"));
  const row = css.find((line) => line.startsWith(".terminal-row {"));
  assert.ok(layout && row);
  assert.match(layout, /grid-template-rows:\s*minmax\(0, 1fr\) min\(var\(--terminal-height, 0px\), 60%\)/);
  assert.match(row, /grid-column: 1 \/ -1/);
});

test("output that arrived during a failed replay is still written to the pane", () => {
  const source = readFileSync(path.join(__dirname, "..", "..", "src", "terminal-implementation.tsx"), "utf8");
  const replay = source.slice(source.indexOf("readTerminal(tab.id)"), source.indexOf("term.onData"));
  const failed = replay.slice(replay.indexOf(".catch("));
  assert.match(failed, /for \(const chunk of queued\) term\.write\(chunk\.data\)/);
  assert.match(failed, /queued\.length = 0/);
});

test("stopping terminals resolves on exit and removes the grace-period listener", async (t) => {
  if (isWindows) return t.skip("Windows taskkill is exercised by the platform integration tests.");
  const child = Object.assign(new EventEmitter(), {
    stdin: new EventEmitter(), stdout: new EventEmitter(), stderr: new EventEmitter(),
    pid: 123, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    kill(signal: NodeJS.Signals) {
      setImmediate(() => { child.signalCode = signal; child.emit("exit", null, signal); });
      return true;
    },
  });
  t.mock.method(childProcess, "spawn", () => child);
  const terminals = new Terminals(() => "pty", () => undefined, () => undefined);
  terminals.open({ threadId: "thread", cwd: process.cwd(), columns: 80, rows: 24 });
  const began = performance.now();
  await terminals.stopAll();
  assert.ok(performance.now() - began < 1000);
  assert.equal(child.listenerCount("exit"), 1);
  assert.deepEqual(terminals.list(), []);
});

test("a terminal pane abandoned during lookup never starts a hidden shell and remount still starts one", async () => {
  const source = ts.createSourceFile("terminal-implementation.tsx", readFileSync(path.join(__dirname, "../../src/terminal-implementation.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.getText(source).includes("listTerminals")) body = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(body);
  const pending: { resolve: (tabs: TerminalTab[]) => void; reject: (error: Error) => void }[] = [];
  let opened = 0;
  const scope = {
    threadId: "task", folderId: "folder", started: { current: "" }, setError: () => undefined,
    start: () => { opened++; },
    window: { shinbo: { listTerminals: () => new Promise<TerminalTab[]>((resolve, reject) => pending.push({ resolve, reject })) } },
  };
  const effect = Function(...Object.keys(scope), ts.transpile(`return (${body.getText(source)});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope)) as () => (() => void) | undefined;
  const cleanup = effect();
  cleanup?.();
  const mountedCleanup = effect();
  pending[0].resolve([]);
  await Promise.resolve();
  assert.equal(opened, 0);
  assert.equal(pending.length, 2);
  pending[1].resolve([]);
  await Promise.resolve();
  assert.equal(opened, 1);
  mountedCleanup?.();
  const failedCleanup = effect();
  failedCleanup?.();
  pending[2].reject(new Error("task removed"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(opened, 1);
});
