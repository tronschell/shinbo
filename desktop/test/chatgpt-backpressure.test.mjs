import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const source = process.env.SHINBO_PERF_SOURCE ?? path.resolve(import.meta.dirname, "../main/chatgpt.ts");

for (const mode of ["drain", "disconnect", "error"]) {
  test(`ChatGPT backpressure bounds reads and handles ${mode}`, (t) => {
    const home = mkdtempSync(path.join(tmpdir(), "shinbo-chatgpt-pressure-"));
    mkdirSync(path.join(home, ".codex"));
    writeFileSync(path.join(home, ".codex/auth.json"), JSON.stringify({ tokens: { access_token: "fixture", account_id: "fixture" } }));
    writeFileSync(path.join(home, "chatgpt.cjs"), ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
    writeFileSync(path.join(home, "run.mjs"), `
      import assert from "node:assert/strict";
      import { request, ServerResponse } from "node:http";
      import { setImmediate as tick } from "node:timers/promises";
      import { chatgptRoute } from "./chatgpt.cjs";
      const mode = ${JSON.stringify(mode)};
      let produced = 0;
      let aborted = 0;
      let held = true;
      let sink;
      let blocking;
      const blocked = new Promise(resolve => { blocking = resolve; });
      const queued = [];
      const original = ServerResponse.prototype.write;
      ServerResponse.prototype.write = function (chunk, ...args) {
        if (!held) return original.call(this, chunk, ...args);
        sink = this;
        queued.push(chunk);
        blocking();
        return false;
      };
      globalThis.fetch = async (_url, options) => {
        options.signal.addEventListener("abort", () => { aborted++; }, { once: true });
        return new Response(new ReadableStream({ pull(controller) {
          if (produced === 1000) { controller.close(); return; }
          const delta = String(produced).padStart(4, "0") + "x".repeat(1020);
          produced++;
          controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify({ type: "response.output_text.delta", delta }) + "\\n\\n"));
        } }));
      };
      const route = await chatgptRoute();
      let completed;
      const completion = new Promise(resolve => { completed = resolve; });
      let text = "";
      const client = request(route.chatUrl, { method: "POST", headers: { authorization: "Bearer " + route.apiKey } }, response => {
        response.setEncoding("utf8");
        response.on("data", chunk => { text += chunk; });
        response.on("end", () => completed());
        response.on("error", () => completed());
      });
      client.on("error", () => completed());
      client.end(JSON.stringify({ model: "fixture", messages: [] }));
      await blocked;
      await tick();
      await tick();
      const beforeDrain = { produced, queuedBytes: queued.reduce((n, chunk) => n + Buffer.byteLength(chunk), 0) };
      if (process.env.SHINBO_PERF_MEASURE === "1") {
        process.stdout.write(JSON.stringify(beforeDrain));
        process.exit(0);
      }
      const closed = new Promise(resolve => sink.once("close", resolve));
      if (mode === "drain") {
        held = false;
        for (const chunk of queued) original.call(sink, chunk);
        sink.emit("drain");
        await completion;
        const data = text.split("\\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6));
        assert.equal(data.pop(), "[DONE]");
        assert.equal(data.length, 1000);
        data.forEach((line, index) => assert.equal(JSON.parse(line).choices[0].delta.content, String(index).padStart(4, "0") + "x".repeat(1020)));
      } else if (mode === "disconnect") {
        client.destroy();
      } else {
        sink.emit("error", new Error("fixture response failure"));
      }
      if (!sink.destroyed) await closed;
      await tick();
      process.stdout.write(JSON.stringify({ ...beforeDrain, aborted, drainListeners: sink.listenerCount("drain") }));
      process.exit(0);
    `);
    try {
      const result = spawnSync(process.execPath, [path.join(home, "run.mjs")], { env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex") }, encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr || String(result.error));
      const measured = JSON.parse(result.stdout);
      t.diagnostic(JSON.stringify({ mode, ...measured }));
      if (process.env.SHINBO_PERF_MEASURE === "1") return;
      assert.ok(measured.produced <= 2, `consumed ${measured.produced} upstream chunks before drain`);
      assert.ok(measured.queuedBytes <= 3, `queued ${measured.queuedBytes} bytes before drain`);
      assert.equal(measured.aborted, 1);
      assert.equal(measured.drainListeners, 0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}
