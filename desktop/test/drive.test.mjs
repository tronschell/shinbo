import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("the driver selects packaged and configured development pages", () => {
  for (const [url, devUrl, status] of [
    ["file:///app/index.html", "", 0],
    ["http://127.0.0.1:5187/", "http://127.0.0.1:5187", 0],
    ["http://127.0.0.1:5188/", "http://127.0.0.1:5187", 1],
  ]) {
    const script = `
      process.argv[2] = "return 42";
      globalThis.fetch = async () => ({ json: async () => [{ type: "page", url: ${JSON.stringify(url)}, webSocketDebuggerUrl: "ws://fixture" }] });
      globalThis.WebSocket = class extends EventTarget {
        constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
        send(raw) {
          const { id } = JSON.parse(raw);
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result: { result: { value: 42 } } }) })));
        }
        close() {}
      };
      await import(${JSON.stringify(new URL("../scripts/drive.mjs", import.meta.url).href)});
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, SHINBO_DEV_SERVER_URL: devUrl },
      timeout: 5000,
    });
    assert.equal(result.status, status, result.stderr);
    if (status === 0) assert.equal(result.stdout.trim(), "42");
  }
});
