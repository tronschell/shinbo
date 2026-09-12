import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("main.ts", readFileSync(process.env.SHINBO_BROADCAST_SOURCE ?? path.join(__dirname, "../../main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "broadcast")!;

function window() {
  const received: { channel: string; payload: unknown }[] = [];
  return {
    destroyed: false, received,
    isDestroyed() { return this.destroyed; },
    webContents: { send: (channel: string, payload: unknown) => received.push({ channel, payload }) },
  };
}

test("live trace histories reach only the workspace while mobile and other window channels retain their behavior", () => {
  const main = window();
  const overlay = window();
  const banner = window();
  const cursor = window();
  const windows = [main, overlay, banner, cursor];
  const mobile: unknown[] = [];
  let mobileActive = true;
  let conversions = 0;
  const scope = {
    BrowserWindow: { getAllWindows: () => windows },
    bridge: { sending: () => mobileActive, event: (event: unknown) => mobile.push(event) },
    BRIDGE_EVENTS: { "shinbo:spans": (payload: unknown) => { conversions++; return { spans: payload }; } },
    initial: main,
  };
  const code = `let mainWindow = initial; ${declaration.getText(source)}\nreturn { broadcast, replace: (next) => { mainWindow = next; } };`;
  const { broadcast, replace } = Function(...Object.keys(scope), ts.transpile(code, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope)) as {
    broadcast: (channel: string, payload: unknown) => void;
    replace: (next: ReturnType<typeof window> | null) => void;
  };
  const payload = { long: [{ id: "tool", output: "complete output 日本語\n".repeat(1000) }] };
  for (let index = 0; index < 20; index++) broadcast("shinbo:spans", payload);
  assert.equal(main.received.length, 20);
  assert.ok(main.received.every((event) => event.channel === "shinbo:spans" && event.payload === payload));
  assert.equal(overlay.received.length + banner.received.length + cursor.received.length, 0);
  assert.equal(conversions, 20);
  assert.equal(mobile.length, 20);
  assert.ok(mobile.every((event) => (event as { spans: unknown }).spans === payload));

  for (const channel of ["shinbo:delta", "shinbo:step", "shinbo:agents", "shinbo:changed", "shinbo:computer-progress"]) {
    broadcast(channel, payload);
    for (const target of windows) assert.deepEqual(target.received.at(-1), { channel, payload });
  }
  main.destroyed = true;
  const before = main.received.length;
  broadcast("shinbo:spans", payload);
  assert.equal(main.received.length, before);
  replace(null);
  broadcast("shinbo:spans", payload);
  assert.equal(conversions, 22);
  const fresh = window();
  windows.push(fresh);
  replace(fresh);
  mobileActive = false;
  broadcast("shinbo:spans", payload);
  assert.deepEqual(fresh.received, [{ channel: "shinbo:spans", payload }]);
  assert.equal(main.received.length, before);
  assert.equal(conversions, 22);
  assert.ok([overlay, banner, cursor].every((target) => target.received.every((event) => event.channel !== "shinbo:spans")));
});
