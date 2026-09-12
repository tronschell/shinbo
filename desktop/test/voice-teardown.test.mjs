import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(new URL("../dist-main/main/voice.js", import.meta.url));
const compile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const main = ts.createSourceFile("main.ts", readFileSync(process.env.SHINBO_VOICE_MAIN_SOURCE || new URL("../main/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
let handler;
const visit = (node) => {
  if (ts.isCallExpression(node) && node.expression.getText(main) === "ipcMain.handle" && node.arguments[0]?.text === "shinbo:transcribe") handler = node.arguments[1].getText(main);
  ts.forEachChild(node, visit);
};
visit(main);
const source = readFileSync(process.env.SHINBO_VOICE_HOST_SOURCE || new URL("../main/voice.ts", import.meta.url), "utf8");
const settings = require("../shared/settings").defaultSettings;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const recording = new ArrayBuffer(1024 * 1024);
const recordingBytes = new Uint8Array(recording);
recordingBytes.set(Buffer.from("RIFF"));
recordingBytes.set(Buffer.from("WAVEfmt "), 8);
recordingBytes.set(Buffer.from("data"), 36);
const recordingHeader = new DataView(recording);
for (const [offset, value] of [[4, recording.byteLength - 8], [16, 16], [24, 16_000], [28, 32_000], [40, recording.byteLength - 44]]) recordingHeader.setUint32(offset, value, true);
for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) recordingHeader.setUint16(offset, value, true);

function fixture({ holdClose = false } = {}) {
  const children = [];
  const exports = {};
  const spawn = (_file, args, options) => {
    assert.equal(options.timeout, 120_000);
    const child = new EventEmitter();
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), file: args[0], active: true });
    const close = () => { if (!child.active) return; child.active = false; child.emit("close", 0, null); };
    child.close = close;
    options.signal?.addEventListener("abort", () => {
      child.emit("error", new DOMException("Canceled", "AbortError"));
      if (!holdClose) close();
    }, { once: true });
    children.push(child);
    return child;
  };
  new Function("exports", "require", compile(source))(exports, (id) => id === "node:child_process" ? { spawn } : id === "electron" ? { app: { isPackaged: false, getAppPath: () => "/fixture" } } : require(id));
  const bridge = new Function("trustedFrame", "transcribe", "validateUtterance", "validateVoiceSettings", `${compile(`const callback = ${handler};`)}; return callback;`)(() => {}, exports.transcribe, exports.validateUtterance, exports.validateVoiceSettings);
  const sender = () => {
    const value = new EventEmitter();
    let destroyed = false;
    value.isDestroyed = () => destroyed;
    value.destroy = () => { destroyed = true; value.emit("destroyed"); };
    return value;
  };
  return { children, bridge, sender, transcribe: exports.transcribe };
}

test("destroying dictation senders releases their pending speech helpers and temporary recordings", { timeout: 3000 }, async (t) => {
  const f = fixture();
  const senders = Array.from({ length: 8 }, f.sender);
  const requests = senders.map((sender) => f.bridge({ sender }, { audio: recording.slice(0), mimeType: "audio/wav", settings: { ...settings, transcriptionEngine: "apple", voiceCleanup: false } }).catch((error) => error));
  while (f.children.length < 8) await tick();
  senders.forEach((sender) => sender.destroy());
  await tick();
  const activeAfterDestroy = f.children.filter((child) => child.active).length;
  const retainedFilesInActiveHelpers = f.children.filter((child) => child.active && existsSync(child.file)).length;
  for (const child of f.children) child.close();
  await Promise.all(requests);
  const remainingFiles = f.children.filter((child) => existsSync(child.file)).length;
  t.diagnostic(JSON.stringify({ closedSenders: 8, activeAfterDestroy, retainedFilesInActiveHelpers, remainingFiles }));
  assert.equal(activeAfterDestroy, 0);
  assert.equal(remainingFiles, 0);
  assert.ok(senders.every((sender) => sender.listenerCount("destroyed") === 0));
});

const renderer = readFileSync(process.env.SHINBO_VOICE_RENDERER_SOURCE || new URL("../src/voice.ts", import.meta.url), "utf8");
const rendererRequire = createRequire(new URL("../dist-main/src/voice.js", import.meta.url));
function dictationFixture() {
  const effects = [];
  const texts = [];
  let submissions = 0;
  let decode;
  let reply;
  const exports = {};
  const hooks = { useState: (value) => [value, () => {}], useRef: (current) => ({ current }), useCallback: (callback) => callback, useEffect: (effect) => effects.push(effect) };
  class Recorder {
    state = "inactive";
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.onstop?.(); }
  }
  class Decoder { decodeAudioData() { return new Promise((resolve) => { decode = resolve; }); } }
  new Function("exports", "require", "navigator", "MediaRecorder", "OfflineAudioContext", "window", compile(renderer))(
    exports, (id) => id === "react" ? hooks : rendererRequire(id),
    { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }, Recorder, Decoder,
    { shinbo: { platform: "darwin", transcribe: () => { submissions += 1; return new Promise((resolve) => { reply = resolve; }); } } },
  );
  const dictation = exports.useDictation(settings, (text) => texts.push(text));
  return { dictation, unmount: effects[1](), texts, submissions: () => submissions, decoding: () => Boolean(decode), decode: () => decode({ numberOfChannels: 1, getChannelData: () => new Float32Array(16_000) }), reply: () => reply({ text: "Disposable transcript" }) };
}

for (const action of ["cancel", "unmount"]) {
  test(`${action} during audio conversion prevents a late transcription submission`, { timeout: 3000 }, async (t) => {
    const f = dictationFixture();
    await f.dictation.start();
    const stopped = f.dictation.stop();
    while (!f.decoding()) await tick();
    if (action === "unmount") f.unmount(); else f.dictation.cancel();
    f.decode();
    await tick();
    const submitted = f.submissions();
    if (submitted) f.reply();
    await stopped;
    t.diagnostic(JSON.stringify({ action, submissionsAfterCancel: submitted }));
    assert.equal(submitted, 0);
    assert.deepEqual(f.texts, []);
  });
  test(`${action} during transcription suppresses the late result and prevents overlap`, { timeout: 3000 }, async () => {
    const f = dictationFixture();
    await f.dictation.start();
    const stopped = f.dictation.stop();
    while (!f.decoding()) await tick();
    f.decode();
    while (!f.submissions()) await tick();
    if (action === "unmount") f.unmount(); else f.dictation.cancel();
    const overlap = await f.dictation.start();
    f.reply();
    await stopped;
    assert.equal(overlap, false);
    assert.deepEqual(f.texts, []);
  });
}

test("sender teardown waits for its owned helper to close before deleting the recording", { timeout: 3000 }, async () => {
  const f = fixture({ holdClose: true });
  const sender = f.sender();
  let settled = false;
  const pending = f.bridge({ sender }, { audio: new ArrayBuffer(44), mimeType: "audio/wav", settings: { ...settings, transcriptionEngine: "apple", voiceCleanup: false } }).catch((error) => error).finally(() => { settled = true; });
  while (!f.children.length) await tick();
  const child = f.children[0];
  sender.destroy();
  await tick();
  assert.equal(settled, false);
  assert.equal(existsSync(child.file), true);
  child.close();
  assert.equal((await pending).name, "AbortError");
  assert.equal(existsSync(child.file), false);
  assert.equal(sender.listenerCount("destroyed"), 0);
});

test("ordinary recognition preserves text and cleans the recording and sender listener", { timeout: 3000 }, async () => {
  const f = fixture();
  const sender = f.sender();
  const pending = f.bridge({ sender }, { audio: new ArrayBuffer(44), mimeType: "audio/wav", settings: { ...settings, transcriptionEngine: "apple", voiceCleanup: false } });
  while (!f.children.length) await tick();
  f.children[0].stdout.emit("data", Buffer.from("  Disposable speech  "));
  f.children[0].close();
  assert.deepEqual(await pending, { text: "Disposable speech", raw: "Disposable speech" });
  assert.equal(existsSync(f.children[0].file), false);
  assert.equal(sender.listenerCount("destroyed"), 0);
});

for (const phase of ["upload", "body", "cleanup", "cleanup-body"]) {
  test(`destroyed sender aborts ${phase} without publishing or starting another request`, { timeout: 3000 }, async (t) => {
    const f = fixture();
    const sender = f.sender();
    let calls = 0;
    let waiting;
    let finish;
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      calls += 1;
      const cleanup = calls === 2;
      if ((!cleanup && phase === "upload") || (cleanup && phase === "cleanup")) {
        waiting = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      }
      return { ok: true, json: async () => {
        if ((!cleanup && phase === "body") || (cleanup && phase === "cleanup-body")) {
          waiting = options.signal;
          await new Promise((resolve) => { finish = resolve; });
        }
        return cleanup ? { choices: [{ message: { content: "Disposable speech." } }] } : { text: "Disposable speech" };
      } };
    });
    const pending = f.bridge({ sender }, { audio: new ArrayBuffer(44), mimeType: "audio/wav", settings: { ...settings, transcriptionEngine: "server", voiceCleanup: true } }).catch((error) => error);
    while (!waiting) await tick();
    sender.destroy();
    const aborted = waiting.aborted;
    finish?.();
    const result = await pending;
    assert.equal(aborted, true);
    assert.equal(result.name, "AbortError");
    assert.equal(calls, phase.startsWith("cleanup") ? 2 : 1);
    assert.equal(sender.listenerCount("destroyed"), 0);
  });
}

test("an already destroyed sender cannot start a transcription request", async (t) => {
  const f = fixture();
  const sender = f.sender();
  sender.destroy();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; throw new Error("Unexpected request"); });
  await assert.rejects(f.bridge({ sender }, { audio: new ArrayBuffer(44), mimeType: "audio/wav", settings: { ...settings, transcriptionEngine: "server" } }), { name: "AbortError" });
  assert.equal(calls, 0);
  assert.equal(sender.listenerCount("destroyed"), 0);
});

test("normal server errors and optional cleanup failure preserve existing outcomes", async (t) => {
  const f = fixture();
  const utterance = { audio: new ArrayBuffer(44), mimeType: "audio/wav" };
  const voice = { ...settings, transcriptionEngine: "server", voiceCleanup: true };
  let mode = "network";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (mode === "network" || calls === 2) throw new Error("Connection failed");
    if (mode === "status") return { ok: false, status: 503 };
    return { ok: true, json: async () => { if (mode === "body") throw new Error("Invalid JSON"); return { text: "  Raw speech  " }; } };
  });
  await assert.rejects(f.transcribe(utterance, voice), /No speech-to-text server answered/);
  mode = "status"; calls = 0;
  await assert.rejects(f.transcribe(utterance, voice), /answered 503/);
  mode = "body"; calls = 0;
  assert.deepEqual(await f.transcribe(utterance, voice), { text: "", raw: "" });
  mode = "cleanup"; calls = 0;
  assert.deepEqual(await f.transcribe(utterance, voice), { text: "Raw speech", raw: "Raw speech" });
});

test("successful dictation publishes once and can start again after completion", { timeout: 3000 }, async () => {
  const f = dictationFixture();
  await f.dictation.start();
  const pending = f.dictation.stop();
  while (!f.decoding()) await tick();
  f.decode();
  while (!f.submissions()) await tick();
  f.reply();
  await pending;
  assert.deepEqual(f.texts, ["Disposable transcript"]);
  assert.equal(await f.dictation.start(), true);
  f.dictation.cancel();
});
