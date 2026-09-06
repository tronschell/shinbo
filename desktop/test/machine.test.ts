import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import os from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { machineFacts, machineSample, parseGpu, parseProbe } from "../main/machine";
import { MACHINE_TICK_MS } from "../shared/machine";

const SAMPLE = { cpu: 0.1, memory: 0.2, memoryUsedBytes: 1, memoryTotalBytes: 2, gpu: null, rxBytes: 3, txBytes: 4 };

test("concurrent machine requests share one probe and later requests read fresh counters", async (t) => {
  const callbacks: ((error: Error | null, stdout: string) => void)[] = [];
  t.mock.method(childProcess, "execFile", (_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => { callbacks.push(callback); });
  let at = 1000;
  let idle = 50;
  let user = 50;
  let fail = false;
  t.mock.method(Date, "now", () => at);
  t.mock.method(os, "cpus", () => {
    if (fail) throw new Error("cpu probe failed");
    return [{ model: "test", speed: 1, times: { idle, user, nice: 0, sys: 0, irq: 0 } }];
  });
  const first = machineSample();
  const concurrent = machineSample();
  assert.equal(callbacks.length, 1);
  assert.equal(first, concurrent);
  callbacks[0](null, "win 100 200 1000 2000 25");
  const initial = await first;
  assert.equal(await concurrent, initial);
  assert.equal(initial.rxBytes, 0);
  at = 2000;
  idle = 75;
  user = 125;
  const next = machineSample();
  assert.equal(callbacks.length, 2);
  callbacks[1](null, "win 300 500 1200 2000 30");
  const fresh = await next;
  assert.equal(fresh.rxBytes, 200);
  assert.equal(fresh.txBytes, 300);
  assert.equal(fresh.cpu, 0.75);
  fail = true;
  const rejected = machineSample();
  callbacks[2](null, "win 300 500 1200 2000 30");
  await assert.rejects(rejected, /cpu probe failed/);
  fail = false;
  const recovered = machineSample();
  assert.equal(callbacks.length, 4);
  callbacks[3](null, "win 300 500 1200 2000 30");
  await recovered;
});

test("machine facts coalesce initialization, retry failures, and preserve the completed cache", async (t) => {
  const callbacks: ((error: Error | null, stdout: string) => void)[] = [];
  t.mock.method(childProcess, "execFile", (_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => { callbacks.push(callback); });
  const failure = t.mock.method(os, "cpus", () => { throw new Error("cpu probe failed"); });
  const first = machineFacts(process.cwd());
  assert.equal(machineFacts(process.cwd()), first);
  assert.equal(callbacks.length, 1);
  callbacks[0](null, "gpu 1024 Test GPU");
  await assert.rejects(first, /cpu probe failed/);
  failure.mock.restore();
  const retry = machineFacts(process.cwd());
  assert.equal(machineFacts(process.cwd()), retry);
  assert.equal(callbacks.length, 2);
  callbacks[1](null, "gpu 1024 Test GPU");
  const result = await retry;
  assert.equal(result.gpu, "Test GPU");
  assert.equal(await machineFacts(process.cwd()), result);
  assert.equal(callbacks.length, 2);
});

function loadRendererMachine(
  document: { hidden: boolean; addEventListener: (type: string, listener: () => void) => void; removeEventListener: (type: string, listener: () => void) => void },
  window: { emma: { machineSample: () => Promise<typeof SAMPLE> } },
  setInterval: (callback: () => void, delay: number) => unknown,
  clearInterval: (timer: unknown) => void,
  cleanups: (() => void)[],
) {
  const source = readFileSync(path.join(__dirname, "../../src/machine.tsx"), "utf8");
  const start = source.indexOf("let history");
  const end = source.indexOf("\nconst share");
  const sampler = source.slice(start, end).replace("export function useMachine", "function useMachine");
  const output = ts.transpile(`const MACHINE_HISTORY = 60; const MACHINE_TICK_MS = ${MACHINE_TICK_MS}; ${sampler}`, { target: ts.ScriptTarget.ES2022 });
  return new Function("document", "window", "setInterval", "clearInterval", "useState", "useEffect", `${output}; return useMachine;`)(
    document,
    window,
    setInterval,
    clearInterval,
    <T>(initial: T) => [initial, () => undefined],
    (effect: () => (() => void) | undefined) => { cleanups.push(effect() ?? (() => undefined)); },
  ) as () => unknown[];
}

const PROBE = `net 39768951532 34031605873
"Device Utilization %"=32
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    57537.
Pages active:                                1186837.
Pages inactive:                              1176859.
Pages speculative:                              8098.
Pages wired down:                             246992.
Pages purgeable:                               12614.
Pages stored in compressor:                  1085814.
Pages occupied by compressor:                 408651.
`;

test("a probe reads its counters, its GPU share and what memory is actually holding", () => {
  const reading = parseProbe(PROBE);
  assert.equal(reading.rx, 39768951532);
  assert.equal(reading.tx, 34031605873);
  assert.equal(reading.gpu, 0.32);
  assert.equal(reading.memoryUsedBytes, (1186837 + 246992 + 408651) * 16384);
});

test("a probe that answered nothing reads as zero rather than NaN", () => {
  assert.deepEqual(parseProbe(""), { rx: 0, tx: 0, gpu: null, memoryUsedBytes: 0 });
});

test("machine sampling pauses once while hidden and resumes once when shown", async () => {
  const cleanups: (() => void)[] = [];
  const visibilityListeners = new Set<() => void>();
  const intervals: { callback: () => void; delay: number; cleared: boolean }[] = [];
  let hidden = false;
  let calls = 0;
  const documentMock = {
    get hidden() { return hidden; },
    addEventListener: (_type: string, listener: () => void) => { visibilityListeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { visibilityListeners.delete(listener); },
  };
  const changeVisibility = (value: boolean) => {
    hidden = value;
    for (const listener of visibilityListeners) listener();
  };
  const setIntervalMock = (callback: () => void, delay: number) => {
    const interval = { callback, delay, cleared: false };
    intervals.push(interval);
    return interval as unknown as ReturnType<typeof setInterval>;
  };
  const clearIntervalMock = (interval: unknown) => { (interval as { cleared: boolean }).cleared = true; };
  const useMachine = loadRendererMachine(documentMock, { emma: { machineSample: () => { calls++; return Promise.resolve(SAMPLE); } } }, setIntervalMock, clearIntervalMock, cleanups);
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  useMachine();
  await settle();
  assert.equal(calls, 1);
  assert.deepEqual(intervals.map(({ delay }) => delay), [MACHINE_TICK_MS]);
  assert.equal(visibilityListeners.size, 1);
  useMachine();
  assert.equal(calls, 1);
  assert.equal(intervals.length, 1);
  assert.equal(visibilityListeners.size, 1);
  intervals[0].callback();
  await settle();
  assert.equal(calls, 2);
  changeVisibility(true);
  assert.equal(intervals[0].cleared, true);
  intervals[0].callback();
  await settle();
  assert.equal(calls, 2);
  changeVisibility(false);
  await settle();
  assert.equal(calls, 3);
  assert.equal(intervals.length, 2);
  assert.equal(visibilityListeners.size, 1);
  changeVisibility(false);
  await settle();
  assert.equal(calls, 3);
  intervals[1].callback();
  await settle();
  assert.equal(calls, 4);
  cleanups[0]();
  assert.equal(intervals[1].cleared, false);
  assert.equal(visibilityListeners.size, 1);
  cleanups[1]();
  assert.equal(intervals[1].cleared, true);
  assert.equal(visibilityListeners.size, 0);
  changeVisibility(true);
  changeVisibility(false);
  await settle();
  assert.equal(calls, 4);
});

test("the GPU probe reads a Windows adapter line and an Apple displays report", () => {
  assert.deepEqual(parseGpu("gpu 17094934528 NVIDIA GeForce RTX 5080"), { gpu: "NVIDIA GeForce RTX 5080", vramBytes: 17094934528 });
  assert.deepEqual(parseGpu(JSON.stringify({ SPDisplaysDataType: [{ sppci_model: "Apple M3 Max" }] })), { gpu: "Apple M3 Max", vramBytes: 0 });
  assert.deepEqual(parseGpu(JSON.stringify({ SPDisplaysDataType: [{ sppci_model: "AMD Radeon Pro 5500M", spdisplays_vram: "8 GB" }] })), { gpu: "AMD Radeon Pro 5500M", vramBytes: 8 * 1024 * 1024 * 1024 });
  assert.deepEqual(parseGpu(""), { gpu: "", vramBytes: 0 });
});
