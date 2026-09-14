import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import ts from "typescript";

const source = ts.createSourceFile("main.ts", readFileSync(new URL("../main/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const named = (name) => source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
const compile = (code, bindings) => new Function(...Object.keys(bindings), ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(bindings));

function imagePaths(attachments) {
  return compile(`${named("attachedImagePaths").getText(source)}; return attachedImagePaths;`, { attachments, MAX_TURN_IMAGES: 8 });
}

test("image preparation preserves ordering, refuses the turn on a lost attachment and stops at the turn cap", async () => {
  const prepared = [];
  const controller = new AbortController();
  const paths = imagePaths({
    read(id) {
      if (id === "missing") throw new Error("gone");
      return { id, ...(id === "text" ? { text: "notes" } : {}) };
    },
    async forModel(file) { await Promise.resolve(); prepared.push(file.id); return `${file.id}.jpg`; },
  });
  assert.deepEqual(await paths("invalid", controller.signal), []);
  assert.deepEqual(await paths("{}", controller.signal), []);
  assert.deepEqual(await paths(undefined, controller.signal), []);
  await assert.rejects(paths('["missing","0"]', controller.signal), /could not be sent: gone/);
  assert.equal(prepared.length, 0);
  const ids = ["text", ...Array.from({ length: 32 }, (_, index) => String(index))];
  assert.deepEqual(await paths(JSON.stringify(ids), controller.signal), Array.from({ length: 8 }, (_, index) => `${index}.jpg`));
  assert.equal(prepared.length, 8);
});

test("stopping while image preparation awaits prevents more image work and model dispatch", async () => {
  const goalStopped = new Set();
  const controller = new AbortController();
  const prepared = [];
  const paths = imagePaths({
    read: (id) => ({ id }),
    async forModel(file) { await Promise.resolve(); goalStopped.add("thread"); controller.abort(); prepared.push(file.id); return `${file.id}.jpg`; },
  });
  assert.deepEqual(await paths('["first","second"]', controller.signal), ["first.jpg"]);
  assert.deepEqual(prepared, ["first"]);
  const block = named("runOnHarness").body.statements.find(ts.isTryStatement).tryBlock;
  const code = `return async () => { ${block.statements.slice(0, 3).map((statement) => statement.getText(source)).join("\n")} };`;
  let dispatched = 0;
  const invoke = compile(code, {
    goalStopped,
    signal: controller.signal,
    attachedImagePaths: async () => ["first.jpg"],
    turn: { threadId: "thread", params: {} },
    client: { prompt: () => { dispatched++; } },
  });
  await assert.rejects(invoke(), /stopped before it reached the model/);
  assert.equal(dispatched, 0);
});


test("a rejected retry cannot revive image preparation after Stop or Restart", async () => {
  const controller = new AbortController();
  const goalStopped = new Set();
  const pendingTurns = new Set(["thread"]);
  const harnessRuns = new Map([["thread", {}]]);
  let release;
  const prepared = new Promise((resolve) => { release = resolve; });
  let dispatched = 0;
  const agents = { signalFor: () => controller.signal, isLive: () => false };
  const turn = { threadId: "thread", params: {} };
  const body = named("runOnHarness").body;
  const capture = body.statements.find((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.name.getText(source) === "signal"));
  assert.ok(capture);
  const block = body.statements.find(ts.isTryStatement).tryBlock;
  const invoke = compile(`return async () => { ${capture.getText(source)} ${block.statements.slice(0, 2).map((statement) => statement.getText(source)).join("\n")} return client.prompt(); };`, {
    agents, goalStopped, turn,
    attachedImagePaths: () => prepared,
    client: { prompt: () => { dispatched++; } },
  });
  const drive = compile(`${named("runTurn").getText(source)}\n${named("runDrivenTurn").getText(source)}; return runDrivenTurn;`, {
    agents, goalStopped, pendingTurns, harnessRuns, noteGoalFailure: async () => {},
  });
  const original = invoke();
  controller.abort();
  goalStopped.add("thread");
  await assert.rejects(drive(turn), /still running or finishing/);
  assert.equal(goalStopped.has("thread"), false);
  assert.equal(pendingTurns.has("thread"), true);
  release(["old-image.jpg"]);
  await assert.rejects(original, /stopped before it reached the model/);
  assert.equal(dispatched, 0);
  assert.equal(harnessRuns.has("thread"), true);
});


const attachmentSource = ts.createSourceFile("attachments.ts", readFileSync(new URL("../main/attachments.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const storeClass = attachmentSource.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === "AttachmentStore");
const forModel = storeClass.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText(attachmentSource) === "forModel");
const jpegImage = (value) => ({ isEmpty: () => false, getSize: () => ({ width: 100, height: 100 }), toJPEG: () => Buffer.from(value) });

const atomicSource = ts.createSourceFile("write-atomic.ts", readFileSync(new URL("../main/write-atomic.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const atomicFunction = atomicSource.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "writeAtomicSync");

function modelStore(directory, attachmentImage, overrides = {}) {
  const filesystem = Object.fromEntries(["statSync", "existsSync", "mkdirSync", "writeFileSync", "chmodSync", "renameSync", "rmSync"].map((name) => [name, fs[name]]));
  const writeAtomicSync = compile(`${atomicFunction.getText(atomicSource).replace(/^export\s+/, "")}; return writeAtomicSync;`, { path, randomUUID, ...filesystem, ...overrides });
  const method = compile(`return ({ ${forModel.getText(attachmentSource)} }).forModel;`, {
    isImageAttachment: () => true, MAX_MODEL_IMAGE_BYTES: 1024 * 1024, MAX_MODEL_IMAGE_EDGE: 1568,
    attachmentImage, path, randomUUID, writeAtomicSync, ...filesystem,
    ...overrides,
  });
  return (attachment) => method.call({ directory }, attachment);
}

test("older image preparation cannot overwrite a newer source's cached result", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "shinbo-image-race-"));
  const attachment = { id: "photo", name: "photo.png", path: path.join(root, "photo.png") };
  fs.writeFileSync(attachment.path, Buffer.alloc(1024 * 1024 + 1, 1));
  fs.utimesSync(attachment.path, 1_700_000_000, 1_700_000_000);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let preparations = 0;
  const prepare = modelStore(root, () => ++preparations === 1 ? held : Promise.resolve(jpegImage("fresh")));
  try {
    const previous = prepare(attachment);
    fs.writeFileSync(attachment.path, Buffer.alloc(1024 * 1024 + 1, 2));
    fs.utimesSync(attachment.path, 1_700_000_001, 1_700_000_001);
    const cached = await prepare(attachment);
    assert.equal(fs.readFileSync(cached, "utf8"), "fresh");
    release(jpegImage("obsolete"));
    assert.equal(await previous, attachment.path);
    assert.equal(fs.readFileSync(cached, "utf8"), "fresh");
    assert.equal(await prepare(attachment), cached);
    assert.equal(preparations, 2);
    assert.deepEqual(fs.readdirSync(root).sort(), ["photo-model.jpg", "photo.png"]);
  } finally {
    release(jpegImage("obsolete"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed model-cache publication preserves the existing file and removes its temporary", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "shinbo-image-publish-"));
  const attachment = { id: "photo", name: "photo.png", path: path.join(root, "photo.png") };
  const cached = path.join(root, "photo-model.jpg");
  fs.writeFileSync(attachment.path, Buffer.alloc(1024 * 1024 + 1));
  fs.writeFileSync(cached, "previous");
  fs.utimesSync(cached, 1, 1);
  let publications = 0;
  const prepare = modelStore(root, async () => jpegImage("next"), {
    renameSync(temporary, destination) {
      publications++;
      assert.equal(fs.readFileSync(cached, "utf8"), "previous");
      assert.equal(fs.readFileSync(temporary, "utf8"), "next");
      assert.equal(destination, cached);
      throw new Error("fixture publication failure");
    },
  });
  try {
    assert.equal(await prepare(attachment), attachment.path);
    assert.equal(publications, 1);
    assert.equal(fs.readFileSync(cached, "utf8"), "previous");
    assert.deepEqual(fs.readdirSync(root).sort(), ["photo-model.jpg", "photo.png"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent image previews run at most one native conversion and recover after failure", async (t) => {
  const input = process.env.SHINBO_IMAGE_CONCURRENCY_SOURCE
    ? ts.createSourceFile("attachments.ts", readFileSync(process.env.SHINBO_IMAGE_CONCURRENCY_SOURCE, "utf8"), ts.ScriptTarget.Latest, true)
    : attachmentSource;
  const selected = input.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && ["resizedPng", "preparePng"].includes(statement.name?.text)
    || ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.name.getText(input) === "imagePreparation"));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let active = 0, peak = 0, converted = 0;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const prepare = compile(`${selected.map((statement) => statement.getText(input)).join("\n")} return resizedPng;`, {
    process: { platform: "darwin" }, path, Buffer,
    access: async () => { throw new Error("no scaled sibling"); },
    tmpdir: () => "/fixture",
    mkdtemp: async () => "/fixture/temporary",
    readFile: async () => png,
    rm: async () => {},
    exec: async (_file, args) => {
      if (args.includes("pixelWidth")) return { stdout: "pixelWidth: 8000\npixelHeight: 6000" };
      active++;
      peak = Math.max(peak, active);
      try {
        await held;
        converted++;
        if (args.includes("/fixture/10.jpg")) throw new Error("fixture conversion failure");
        return { stdout: "" };
      } finally {
        active--;
      }
    },
  });
  const work = Promise.all(Array.from({ length: 100 }, (_, index) => prepare(`/fixture/${index}.jpg`, { maxWidth: 1600 })));
  await new Promise((resolve) => setImmediate(resolve));
  const blocked = active;
  release();
  const outputs = await work;
  t.diagnostic(JSON.stringify({ previews: outputs.length, activeWhileBlocked: blocked, peakConversions: peak, converted }));
  assert.equal(blocked, 1);
  assert.equal(peak, 1);
  assert.equal(converted, 100);
  assert.equal(outputs.filter((value) => value === undefined).length, 1);
  assert.equal(outputs[10], undefined);
  assert.ok(outputs.filter(Boolean).every((value) => value.equals(png)));
});
