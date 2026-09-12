import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(new URL("../dist-main/main/web-search.js", import.meta.url));
const source = readFileSync(process.env.SHINBO_SEARCH_CANCEL_SOURCE || new URL("../main/web-search.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ranked = { providers: [{ provider: "fourget", endpoint: "https://first.invalid", credentialEnv: "" }, { provider: "searxng", endpoint: "https://second.invalid", credentialEnv: "" }] };
const load = (fetch) => {
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => name === "electron" ? { net: { fetch } } : require(name));
  return exports.webSearch;
};

test("Stop aborts the active search and starts no fallback requests", { timeout: 2000 }, async (t) => {
  const controller = new AbortController();
  const requests = [];
  let release;
  let active;
  const search = load(async (url, init) => {
    requests.push(url);
    if (requests.length > 1) throw new Error("provider unavailable");
    active = init.signal;
    await new Promise((resolve, reject) => {
      release = () => reject(new Error("simulated timeout"));
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  });
  const result = search(ranked, "cancel query", 8, () => "", 1_000_000, controller.signal).catch((error) => error);
  controller.abort(new Error("stopped by user"));
  await tick();
  const abortedAtStop = active.aborted;
  release();
  const error = await result;
  t.diagnostic(JSON.stringify({ abortedAtStop, requests: requests.length, fallbackRequestsAfterStop: requests.length - 1 }));
  assert.equal(abortedAtStop, true);
  assert.equal(requests.length, 1);
  assert.match(error.message, /stopped by user/);
});

test("a cancelled search performs no request even with a previously cached result", { timeout: 2000 }, async () => {
  let requests = 0;
  const search = load(async () => { requests++; return Response.json({ results: [{ title: "ok", url: "https://example.invalid", content: "result" }] }); });
  const settings = { providers: [ranked.providers[1]] };
  await search(settings, "cached", 8, () => "", 1_000_000);
  const stopped = AbortSignal.abort(new Error("stopped"));
  await assert.rejects(search(settings, "cached", 8, () => "", 1_000_001, stopped), /stopped/);
  await assert.rejects(search(settings, "uncached", 8, () => "", 1_000_001, stopped), /stopped/);
  assert.equal(requests, 1);
});

test("Stop during response-body reading cannot fall through to another provider", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let requests = 0;
  let reading;
  const started = new Promise((resolve) => { reading = resolve; });
  const search = load(async (_url, init) => {
    requests++;
    return { ok: true, status: 200, json: () => new Promise((resolve, reject) => {
      reading();
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }) };
  });
  const result = search(ranked, "slow body", 8, () => "", 1_000_000, controller.signal);
  await started;
  controller.abort(new Error("stopped during body"));
  await assert.rejects(result, /stopped during body/);
  assert.equal(requests, 1);
});

test("Stop during the fourget fallback prevents the next ranked provider", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let requests = 0;
  let began;
  const fallback = new Promise((resolve) => { began = resolve; });
  const search = load(async (_url, init) => {
    if (++requests === 1) throw new Error("primary unavailable");
    began();
    await new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  });
  const result = search(ranked, "cancel fallback", 8, () => "", 1_000_000, controller.signal);
  await fallback;
  controller.abort(new Error("stopped in fallback"));
  await assert.rejects(result, /stopped in fallback/);
  assert.equal(requests, 2);
});

test("provider timeouts still fall back without aborting the owning run", { timeout: 2000 }, async (t) => {
  const controller = new AbortController();
  const timeout = new AbortController();
  let timers = 0;
  t.mock.method(AbortSignal, "timeout", (milliseconds) => { assert.equal(milliseconds, 20_000); return timers++ ? new AbortController().signal : timeout.signal; });
  let requests = 0;
  const search = load(async (_url, init) => {
    if (++requests === 1) await new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    return Response.json({ web: [{ title: "ok", url: "https://example.invalid", description: "result" }] });
  });
  const result = search(ranked, "timeout fallback", 8, () => "", 1_000_000, controller.signal);
  timeout.abort(new DOMException("timeout", "TimeoutError"));
  assert.equal((await result).results.length, 1);
  assert.equal(requests, 2);
  assert.equal(controller.signal.aborted, false);
});

test("the actual web-search tool caller passes its existing run cancellation signal", { timeout: 2000 }, async () => {
  const main = ts.createSourceFile("main.ts", readFileSync(new URL("../main/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const execute = main.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "executeTool");
  const clause = execute.body.statements.find(ts.isSwitchStatement).caseBlock.clauses.find((node) => ts.isCaseClause(node) && node.expression.text === "web_search");
  const body = clause.statements.map((node) => node.getText(main)).join("\n");
  const controller = new AbortController();
  let forwarded;
  const call = new Function("webSearch", "renderResults", "agents", "toolSettings", "args", "turn", `return (async () => { ${ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText} })();`);
  const result = await call(async (...args) => { forwarded = args[5]; return "reply"; }, (_query, response) => response, { signalFor: (id) => { assert.equal(id, "current"); return controller.signal; } }, { webSearch: ranked }, { query: "query", limit: 8 }, { threadId: "current" });
  assert.equal(result, "reply");
  assert.equal(forwarded, controller.signal);
});
