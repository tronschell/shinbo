import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CliModelCatalog } from "../main/cli-models";
import { CatalogCache, probeProvider } from "../main/catalog";
import { ModelMetadataCatalog } from "../main/model-metadata";
import { loadImportedSkill, mirrorSkillsToHarness, previewImportedSkill } from "../main/capabilities";
import { embeddingProxy, SemanticGrep } from "../main/semantic-grep";
import { ZvecGrepTool } from "../main/zvec-grep";
import { defaultHarnessExperiments, hostedEmbeddingModel } from "../shared/settings";

const temporary = () => fs.mkdtemp(path.join(tmpdir(), "shinbo-discovery-perf-"));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

async function skills(home: string, count: number) {
  await Promise.all(Array.from({ length: count }, async (_, i) => {
    const root = path.join(home, "skills", `skill-${i}`);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "SKILL.md"), `Instructions ${i}`);
  }));
}

test("selecting and previewing a skill only open the named skill", async (t) => {
  const home = await temporary();
  await skills(home, 64);
  const open = fs.open;
  let inspected = 0;
  t.mock.method(fs, "open", (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]).endsWith("SKILL.md")) inspected += 1;
    return open(...args);
  });
  try {
    assert.equal((await loadImportedSkill(home, "skill:shinbo:0:skill-63")).instructions, "Instructions 63");
    assert.equal((await previewImportedSkill(home, "skill-63"))?.text, "Instructions 63");
    t.diagnostic(`SKILL.md opens for selection and preview across 64 skills: ${inspected}`);
    assert.equal(inspected, 4);
    await assert.rejects(loadImportedSkill(home, "skill:shinbo:0:missing"), /no longer installed/);
    await assert.rejects(loadImportedSkill(home, "skill:shinbo:0:.."), /no longer installed/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("unchanged skill mirrors produce no disk writes", async (t) => {
  const home = await temporary();
  const harness = path.join(home, "harness");
  await skills(home, 32);
  await mirrorSkillsToHarness(home, harness);
  const write = fs.writeFile;
  const writes = t.mock.method(fs, "writeFile", write);
  try {
    assert.equal((await mirrorSkillsToHarness(home, harness)).length, 32);
    t.diagnostic(`writes for unchanged 32-skill mirror: ${writes.mock.callCount()}`);
    assert.equal(writes.mock.callCount(), 0);
    await write(path.join(home, "skills", "skill-0", "SKILL.md"), "Updated instructions");
    await mirrorSkillsToHarness(home, harness, ["skill-1"]);
    assert.match(await fs.readFile(path.join(harness, ".fx", "skills", "skill-0", "SKILL.md"), "utf8"), /Updated instructions/);
    await assert.rejects(fs.stat(path.join(harness, ".fx", "skills", "skill-1")), { code: "ENOENT" });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("explicit concurrent CLI refreshes share discovery", async (t) => {
  const home = await temporary();
  const resolved = deferred<null>();
  let calls = 0;
  const locate = () => { calls += 1; return resolved.promise; };
  try {
    const catalog = new CliModelCatalog(home);
    const initial = catalog.read("claude", locate, true);
    const refresh = catalog.read("claude", locate, true);
    await new Promise<void>((done) => setImmediate(done));
    await new Promise<void>((done) => setImmediate(done));
    resolved.resolve(null);
    assert.deepEqual(await initial, await refresh);
    t.diagnostic(`concurrent model discovery operations: ${calls}`);
    assert.equal(calls, 1);
    await catalog.read("claude", async () => { calls += 1; return null; }, true);
    assert.equal(calls, 2);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("provider capability checks start without waiting for the model list", async (t) => {
  const models = deferred<Response>();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1 ? models.promise : new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{}] } }] }));
  });
  const pending = probeProvider("https://fixture.test/v1", "fixture", "model");
  await Promise.resolve();
  const beforeRelease = calls;
  models.resolve(new Response(JSON.stringify({ data: [{ id: "model" }] })));
  assert.deepEqual(await pending, { models: ["model"], tools: true, error: "" });
  t.diagnostic(`provider requests started before model-list completion: ${beforeRelease}`);
  assert.equal(beforeRelease, 2);
});

test("model catalog refreshes persist without synchronous writes", async (t) => {
  const home = await temporary();
  const router = new CatalogCache(home);
  const metadata = new ModelMetadataCatalog(home, path.join(home, "absent.json"));
  const syncWrite = t.mock.method(syncFs, "writeFileSync", syncFs.writeFileSync);
  const asyncWrite = t.mock.method(fs, "writeFile", fs.writeFile);
  try {
    await router.refresh(async () => ({ models: [{ id: "test/model", name: "Fixture", contextLength: 1000, inputModalities: [], free: false }] }));
    await metadata.refresh(0, async () => ({ fixture: { models: { model: { limit: { context: 1000 } } } } }));
    t.diagnostic(`catalog persistence synchronous writes: ${syncWrite.mock.callCount()}; asynchronous writes: ${asyncWrite.mock.callCount()}`);
    assert.equal(syncWrite.mock.callCount(), 0);
    assert.equal(asyncWrite.mock.callCount(), 2);
    assert.match(await fs.readFile(path.join(home, "openrouter-catalog.json"), "utf8"), /Fixture/);
    assert.match(await fs.readFile(path.join(home, "model-metadata.json"), "utf8"), /fixture/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("semantic search disable stops active index workers", (t) => {
  const grep = new SemanticGrep("node", () => "fixture", 0, () => {});
  const inner = grep as unknown as { children: Map<string, unknown>; folders: Map<string, unknown> };
  let killed = 0;
  for (let i = 0; i < 4; i++) {
    inner.children.set(`folder-${i}`, { kill: () => { killed += 1; } });
    inner.folders.set(`folder-${i}`, { state: "indexing" });
  }
  grep.apply({ ...defaultHarnessExperiments, semanticGrep: false });
  t.diagnostic(`index workers stopped on disable: ${killed}/4`);
  assert.equal(killed, 4);
  assert.equal(inner.children.size, 0);
  assert.equal(inner.folders.size, 0);
});

test("semantic shutdown never synchronously waits for a process or restarts the daemon", (t) => {
  t.mock.method(syncFs, "mkdirSync", () => undefined);
  t.mock.method(syncFs, "existsSync", () => true);
  const fake = () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  const syncSpawn = t.mock.method(childProcess, "spawnSync", () => ({}));
  const spawn = t.mock.method(childProcess, "spawn", () => fake());
  const grep = new SemanticGrep("node", () => "fixture", 0, () => {});
  const inner = grep as unknown as { started: boolean; restartDaemon: (settings: typeof defaultHarnessExperiments) => void; experiments: typeof defaultHarnessExperiments };
  const settings = { ...defaultHarnessExperiments, semanticGrep: true };
  inner.started = true;
  inner.experiments = settings;
  inner.restartDaemon(settings);
  const first = spawn.mock.calls[0].result as EventEmitter;
  grep.stop();
  first.emit("close", 0);
  t.diagnostic(`synchronous process waits during semantic shutdown: ${syncSpawn.mock.callCount()}`);
  assert.equal(syncSpawn.mock.callCount(), 0);
  assert.equal(spawn.mock.callCount(), 2);
});

test("old search installation cleanup does not synchronously remove trees during startup", async (t) => {
  const home = await temporary();
  await fs.mkdir(path.join(home, "old-version"));
  await fs.writeFile(path.join(home, "old-version", "old.bin"), Buffer.alloc(1024 * 1024));
  const remove = t.mock.method(syncFs, "rmSync", syncFs.rmSync);
  try {
    const tool = new ZvecGrepTool(home, "https://fixture.test", () => {});
    const synchronous = remove.mock.callCount();
    await (tool as unknown as { sweeping?: Promise<void> }).sweeping;
    t.diagnostic(`synchronous recursive deletions in search constructor: ${synchronous}`);
    assert.equal(synchronous, 0);
    await assert.rejects(fs.stat(path.join(home, "old-version")), { code: "ENOENT" });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("closing an indexing connection cancels its embedding request", async (t) => {
  const started = deferred<void>();
  const response = deferred<Response>();
  let aborted = 0;
  t.mock.method(globalThis, "fetch", (_url: unknown, options?: RequestInit) => {
    started.resolve();
    options?.signal?.addEventListener("abort", () => { aborted += 1; }, { once: true });
    return response.promise;
  });
  const server = embeddingProxy(hostedEmbeddingModel("hosted/openai/text-embedding-3-small")!, "fixture", () => "fixture");
  const handler = server.listeners("request")[0] as (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
  const request = { headers: { authorization: "Bearer fixture" }, method: "POST", async *[Symbol.asyncIterator]() { yield Buffer.from('{"input":["fixture"]}'); } };
  const output = Object.assign(new EventEmitter(), { writeHead() {}, end() {}, destroyed: false });
  const pending = handler(request as unknown as IncomingMessage, output as unknown as ServerResponse);
  await started.promise;
  output.emit("close");
  const cancelled = aborted;
  response.resolve(new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 1024 }, () => 1) }] })));
  await pending;
  t.diagnostic(`embedding aborts on index connection close: ${cancelled}`);
  assert.equal(cancelled, 1);
});

test("a cancelled install waiting for startup cleanup never begins a download", async (t) => {
  const home = await temporary();
  const gate = deferred<void>();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests += 1; throw new Error("fixture fetch"); });
  try {
    const tool = new ZvecGrepTool(home, "https://fixture.test", () => {});
    const inner = tool as unknown as { sweeping: Promise<void>; controller?: AbortController; run(controller: AbortController): Promise<void> };
    await inner.sweeping;
    inner.sweeping = gate.promise;
    const controller = new AbortController();
    inner.controller = controller;
    const pending = inner.run(controller).catch(() => {});
    controller.abort();
    gate.resolve();
    await pending;
    assert.equal(requests, 0);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
