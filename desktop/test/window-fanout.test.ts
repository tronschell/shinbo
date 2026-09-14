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

test("broadcast reaches the workspace and overlay but no auxiliary window, and the phone gets the bridge form", () => {
  const main = window();
  const overlay = window();
  const banner = window();
  const cursor = window();
  const mobile: unknown[] = [];
  let mobileActive = true;
  let conversions = 0;
  const scope = {
    bridge: { sending: () => mobileActive, event: (event: unknown) => mobile.push(event) },
    BRIDGE_EVENTS: { "shinbo:agents": (payload: unknown) => { conversions++; return { agents: payload }; } },
    initial: main,
    overlayWindow: overlay,
  };
  const code = `let mainWindow = initial; let overlay = overlayWindow; ${declaration.getText(source)}\nreturn { broadcast, replace: (next) => { mainWindow = next; } };`;
  const { broadcast, replace } = Function(...Object.keys(scope), ts.transpile(code, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope)) as {
    broadcast: (channel: string, payload: unknown) => void;
    replace: (next: ReturnType<typeof window> | null) => void;
  };
  const payload = [{ threadId: "t1", status: "running" }];
  for (let index = 0; index < 20; index++) broadcast("shinbo:agents", payload);
  assert.equal(main.received.length, 20);
  assert.equal(overlay.received.length, 20);
  assert.ok([...main.received, ...overlay.received].every((event) => event.channel === "shinbo:agents" && event.payload === payload));
  assert.equal(banner.received.length + cursor.received.length, 0);
  assert.equal(conversions, 20);
  assert.equal(mobile.length, 20);
  assert.ok(mobile.every((event) => (event as { agents: unknown }).agents === payload));

  for (const channel of ["shinbo:delta", "shinbo:step", "shinbo:changed", "shinbo:computer-progress"]) {
    broadcast(channel, payload);
    for (const target of [main, overlay]) assert.deepEqual(target.received.at(-1), { channel, payload });
  }
  assert.equal(conversions, 20);
  assert.equal(banner.received.length + cursor.received.length, 0);
  overlay.destroyed = true;
  const overlayBefore = overlay.received.length;
  broadcast("shinbo:delta", payload);
  assert.equal(overlay.received.length, overlayBefore);
  overlay.destroyed = false;
  main.destroyed = true;
  const before = main.received.length;
  broadcast("shinbo:agents", payload);
  assert.equal(main.received.length, before);
  replace(null);
  broadcast("shinbo:agents", payload);
  assert.equal(conversions, 22);
  const fresh = window();
  replace(fresh);
  mobileActive = false;
  broadcast("shinbo:agents", payload);
  assert.deepEqual(fresh.received, [{ channel: "shinbo:agents", payload }]);
  assert.equal(main.received.length, before);
  assert.equal(conversions, 22);
});

test("span refreshes go to the workspace window directly, never through broadcast", () => {
  const sends: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.some((argument) => ts.isStringLiteral(argument) && argument.text === "shinbo:spans-changed")) sends.push(node.expression.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.deepEqual(sends, ["mainWindow.webContents.send"]);
  assert.ok(!declaration.getText(source).includes("shinbo:spans"));
});
