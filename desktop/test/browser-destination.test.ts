import test from "node:test";
import assert from "node:assert/strict";
import { browserDestination, blankPage } from "../shared/browser";
import { listeners } from "../main/browser";

test("typed text becomes a url, a host, or a Google search", () => {
  assert.equal(browserDestination("  "), undefined);
  assert.equal(browserDestination("https://coned.com"), "https://coned.com");
  assert.equal(browserDestination("coned.com"), "https://coned.com");
  assert.equal(browserDestination("localhost:3000"), "http://localhost:3000");
  assert.equal(browserDestination("127.0.0.1:8080/app"), "http://127.0.0.1:8080/app");
  assert.equal(browserDestination("how tall is the eiffel tower"), "https://www.google.com/search?q=how%20tall%20is%20the%20eiffel%20tower");
  assert.equal(browserDestination("react hooks"), "https://www.google.com/search?q=react%20hooks");
});

test("blank pages are the placeholders", () => {
  assert.equal(blankPage(undefined), true);
  assert.equal(blankPage("about:blank"), true);
  assert.equal(blankPage("https://x.dev"), false);
});

test("lsof output lists local listeners, minus this process and system daemons", () => {
  const lsof = ["p900", "cnode", "f4", "n*:3000", "p901", "cvite", "f5", "n127.0.0.1:5173", "p902", "cControlCenter", "f9", "n*:7000", "p777", "cself", "f1", "n*:9999"].join("\n");
  assert.deepEqual(listeners(lsof, 777), [{ port: 3000, process: "node" }, { port: 5173, process: "vite" }]);
});

test("windows netstat output lists local listeners", () => {
  const netstat = ["Proto  Local Address          Foreign Address        State           PID", "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4321", "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4322"].join("\r\n");
  assert.deepEqual(listeners(netstat, 1), [{ port: 3000, process: "" }, { port: 5173, process: "" }]);
});
