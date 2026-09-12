import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";

const electron = { app: { getPath: () => "/tmp" }, WebContentsView: class {} };
const electronPath = require.resolve("electron");
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: electron } as unknown as NodeModule;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { attached, browserCursorProgress, Browsers }: typeof import("../main/browser") = require("../main/browser");

test("a browser the agent never attached to is a failure, not a page it can talk about", () => {
  assert.equal(attached({ text: "connected", code: 0, signal: null }, "connect"), undefined);
  assert.throws(() => attached({ text: "All CDP discovery methods failed", code: 1, signal: null }, "connect to Shinbo's browser"), /nothing was driven/);
  assert.throws(() => attached({ text: "All CDP discovery methods failed", code: 1, signal: null }, "connect to Shinbo's browser"), /All CDP discovery methods failed/);
  assert.throws(() => attached({ text: "", code: null, signal: "SIGKILL" }, "connect to Shinbo's browser"), /nothing was driven/);
});

test("the activity cursor lands where the agent clicked in the pane, or nowhere at all", () => {
  const pane = { x: 400, y: 300, width: 800, height: 600 };
  const progress = browserCursorProgress(pane, { x: 120.4, y: 60.6 }, "clicking @e1", 3, 7);
  assert.deepEqual(progress, { step: 0, actions: 3, action: "clicking @e1", cursor: { windowId: 7, bounds: pane, x: 520, y: 361 } });
  assert.equal(browserCursorProgress(pane, { x: 800, y: 10 }, "clicking", 1, 7), null);
  assert.equal(browserCursorProgress(pane, { x: 10, y: -1 }, "clicking", 1, 7), null);
  assert.equal(browserCursorProgress({ ...pane, width: 0 }, { x: 0, y: 0 }, "clicking", 1, 7), null);
  assert.equal(browserCursorProgress(pane, { x: 1, y: 1 }, "x".repeat(200), 1, 7)?.action.length, 80);
});

test("browser shutdown releases each owned daemon after its views and survives cleanup command errors", (t) => {
  const order: string[] = [];
  const children: EventEmitter[] = [];
  const launches = t.mock.method(childProcess, "spawn", (_command: string, args: readonly string[]) => {
    order.push(`command:${args[1]}`);
    const child = Object.assign(new EventEmitter(), { unref: () => order.push("unref") });
    children.push(child);
    return child;
  });
  function session(name: string) {
    let destroyed = false;
    return {
      name, threadId: name, shown: false, activeId: "tab", pinned: "target", connected: Promise.resolve(),
      tabs: [{ id: "tab", view: { webContents: {
        isDestroyed: () => destroyed,
        close: () => { destroyed = true; order.push(`view:${name}`); },
      } } }],
    };
  }
  const browsers = new Browsers(() => undefined, () => undefined);
  const state = browsers as unknown as { path: string | null; sessions: Map<string, ReturnType<typeof session>> };
  state.path = "/fixture/agent-browser";
  const first = session("shinbo-first");
  const second = session("shinbo-second");
  state.sessions.set(first.name, first);
  state.sessions.set(second.name, second);
  browsers.stopAll();
  assert.deepEqual(order, ["view:shinbo-first", "command:shinbo-first", "unref", "view:shinbo-second", "command:shinbo-second", "unref"]);
  assert.equal(state.sessions.size, 0);
  for (const owned of [first, second]) {
    assert.deepEqual(owned.tabs, []);
    assert.equal(owned.connected, undefined);
    assert.equal(owned.pinned, undefined);
    assert.equal(owned.activeId, undefined);
  }
  assert.deepEqual(launches.mock.calls.map((call) => call.arguments), [first, second].map((owned) => [
    "/fixture/agent-browser", ["--session", owned.name, "close"],
    { detached: true, stdio: "ignore", windowsHide: true, shell: false },
  ]));
  for (const child of children) assert.doesNotThrow(() => child.emit("error", Object.assign(new Error("missing executable"), { code: "ENOENT" })));
  browsers.stopAll();
  assert.equal(launches.mock.callCount(), 2);
  state.path = null;
  const unused = session("shinbo-unused");
  state.sessions.set(unused.name, unused);
  browsers.stopAll();
  assert.equal(launches.mock.callCount(), 2);
  assert.equal(state.sessions.size, 0);
  assert.equal(order.at(-1), "view:shinbo-unused");
});
