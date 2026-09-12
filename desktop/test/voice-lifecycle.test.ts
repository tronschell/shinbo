import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Dictation } from "../src/voice";
import { defaultSettings } from "../shared/settings";

const source = readFileSync(path.join(process.cwd(), "src/voice.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const dependency = createRequire(path.join(__dirname, "../src/voice.js"));

function setup(failure?: "constructor" | "start" | "stop") {
  const effects: (() => (() => void) | void)[] = [];
  const events = new Map<string, (event: unknown) => void>();
  const timers = new Map<number, () => void>();
  const grants: ((stream: unknown) => void)[] = [];
  let liveTracks = 0;
  let stops = 0;
  const stream = () => {
    liveTracks += 1;
    let live = true;
    return { getTracks: () => [{ stop: () => { if (live) { live = false; liveTracks -= 1; stops += 1; } } }] };
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports, ArrayBuffer, Float32Array, DataView, Blob, Event, AbortController,
    require: (id: string) => id === "react" ? {
      useState: (initial: unknown) => [initial, () => undefined],
      useRef: (current: unknown) => ({ current }), useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => (() => void) | void) => { effects.push(effect); },
    } : dependency(id),
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { grants.push(resolve); }) } },
    MediaRecorder: class {
      state = "inactive";
      constructor() { if (failure === "constructor") throw new Error("Recorder unavailable"); }
      start() { if (failure === "start") throw new Error("Recorder could not start"); this.state = "recording"; }
      stop() { if (failure === "stop") throw new Error("Recorder could not stop"); this.state = "inactive"; }
    },
    window: { shinbo: { platform: "darwin", voiceStatus: async () => ({}) }, setTimeout: (callback: () => void) => { const id = timers.size + 1; timers.set(id, callback); return id; } },
    clearTimeout: (id: number) => timers.delete(id),
    addEventListener: (name: string, listener: (event: unknown) => void) => events.set(name, listener),
    removeEventListener: (name: string) => events.delete(name),
  });
  const api = exports as unknown as { useDictation: (settings: unknown, onText: unknown) => Dictation; useSpaceHold: (delay: number, armed: boolean, dictation: Dictation) => void };
  const dictation = api.useDictation(defaultSettings, () => undefined);
  const cleanup = effects[1]()!;
  return {
    dictation, cleanup, grant: (index = 0) => grants[index](stream()),
    tracks: () => liveTracks, stops: () => stops, requests: () => grants.length,
    hold: () => { api.useSpaceHold(300, true, dictation); effects.at(-1)!(); },
    fire: (name: string) => events.get(name)!({ code: "Space", preventDefault() {} }),
    timeout: () => { const [id, callback] = [...timers][0]; timers.delete(id); callback(); },
  };
}

for (const action of ["cancel", "stop", "unmount"] as const) {
  test(`microphone startup is released after ${action} before permission resolves`, async () => {
    const state = setup();
    const started = state.dictation.start();
    if (action === "unmount") state.cleanup();
    else await state.dictation[action]();
    state.grant();
    assert.equal(await started, false);
    assert.equal(state.tracks(), 0);
    assert.equal(state.stops(), 1);
  });
}

for (const action of ["keyup", "blur"]) {
  test(`Space-hold ${action} cancels a pending microphone start`, async () => {
    const state = setup();
    state.hold();
    state.fire("keydown");
    state.timeout();
    state.fire(action);
    state.grant();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.tracks(), 0);
    assert.equal(state.stops(), 1);
  });
}

test("repeated activation starts one microphone and a canceled start can be retried", async () => {
  const state = setup();
  const first = state.dictation.start();
  const second = state.dictation.start();
  assert.equal(state.requests(), 1);
  assert.equal(await second, false);
  state.dictation.cancel();
  const retry = state.dictation.start();
  assert.equal(state.requests(), 2);
  state.grant(0);
  assert.equal(await first, false);
  state.grant(1);
  assert.equal(await retry, true);
  assert.equal(state.tracks(), 1);
  state.dictation.cancel();
  assert.equal(state.tracks(), 0);
});

for (const failure of ["constructor", "start"] as const) {
  test(`microphone tracks close when recorder ${failure} fails`, async () => {
    const state = setup(failure);
    const started = state.dictation.start();
    state.grant();
    assert.equal(await started, false);
    assert.equal(state.tracks(), 0);
    assert.equal(state.stops(), 1);
  });
}

test("microphone tracks close when recorder stop fails", async () => {
  const state = setup("stop");
  const started = state.dictation.start();
  state.grant();
  assert.equal(await started, true);
  await state.dictation.stop();
  assert.equal(state.tracks(), 0);
});

for (const name of ["onPointerLeave", "onBlur"]) {
  test(`voice settings ${name} releases pending acquisition`, async () => {
    const source = ts.createSourceFile("App.tsx", readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler = "";
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === name && node.initializer && ts.isJsxExpression(node.initializer)) {
        const expression = node.initializer.expression?.getText(source) ?? "";
        if (expression.includes("dictation.stop")) handler = expression;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(handler);
    const state = setup();
    const started = state.dictation.start();
    (runInNewContext(handler, { dictation: state.dictation }) as () => void)();
    state.grant();
    assert.equal(await started, false);
    assert.equal(state.tracks(), 0);
  });
}
