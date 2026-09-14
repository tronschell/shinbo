import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { FrameCodec } from "../main/frames";
import * as protocol from "../shared/mobile-protocol";
import type { Bridge, BridgeDeps } from "../main/bridge";
import type { Peer } from "../main/pairing";

const load = createRequire(__filename);

class Socket extends EventEmitter {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  maximum = 0;
  terminated = 0;
  frames: Uint8Array[] = [];
  messages: protocol.BridgeFrame[] = [];
  callbacks: ((error?: Error) => void)[] = [];
  constructor(readonly codec: FrameCodec, readonly blocked: boolean) { super(); }
  get protocol() { return this.codec.auth; }
  send(data: Uint8Array | string, callback?: (error?: Error) => void) {
    if (callback) this.callbacks.push(callback);
    if (this.readyState !== 1) throw new Error("closed socket");
    if (typeof data === "string") return;
    if (data.byteLength === protocol.HANDSHAKE_BYTES) { this.codec.greet(data); return; }
    if (this.blocked) {
      this.frames.push(data);
      this.bufferedAmount += data.byteLength;
      this.maximum = Math.max(this.maximum, this.bufferedAmount);
    } else {
      const frame = this.codec.open(data);
      if (frame) this.messages.push(frame);
    }
  }
  drain() {
    for (const bytes of this.frames) {
      const frame = this.codec.open(bytes);
      if (frame) this.messages.push(frame);
    }
    this.frames = [];
    this.bufferedAmount = 0;
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close"); }
  terminate() { this.terminated++; this.frames = []; this.bufferedAmount = 0; this.close(); }
  ping() {}
  greet() { this.emit("message", Buffer.from(this.codec.hello), true); }
  request(id: string) { this.emit("message", Buffer.from(this.codec.seal({ k: "req", id, method: "snapshot", params: {} })!), true); }
}

async function fixture(t: test.TestContext) {
  const userData = mkdtempSync(path.join(tmpdir(), "shinbo-bridge-buffer-"));
  t.after(() => rmSync(userData, { recursive: true, force: true }));
  const peers: Peer[] = [1, 2].map((id) => ({ pairedAt: id, verified: true, key: randomBytes(32).toString("base64url"), pin: "", name: `fixture-${id}`, addr: "ws://127.0.0.1:43197" }));
  const servers: EventEmitter[] = [];
  class Server extends EventEmitter {
    constructor() { super(); servers.push(this); queueMicrotask(() => this.emit("listening")); }
    close() {}
  }
  const source = readFileSync(process.env.SHINBO_BRIDGE_SOURCE ?? path.join(__dirname, "../../main/bridge.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const timers = new Set<object>();
  const dependency = (name: string) => {
    if (name === "ws") return { WebSocketServer: Server, WebSocket: Socket };
    if (name === "./pairing") return { loadPeers: () => peers, MAX_PEERS: 3 };
    if (name === "./tailnet") return { addressesFor: async () => ["127.0.0.1"] };
    if (name === "./frames") return { FrameCodec };
    if (name === "../shared/mobile-protocol") return protocol;
    return load(name);
  };
  const exports: { createBridge?: (deps: BridgeDeps) => Bridge } = {};
  Function("require", "exports", "setInterval", "clearInterval", code)(dependency, exports,
    () => { const timer = { unref() {} }; timers.add(timer); return timer; }, (timer: object) => timers.delete(timer));
  let complete: ((value: unknown) => void) | undefined;
  const bridge = exports.createBridge!({
    userData, identity: { id: "fixture", name: "Fixture", version: "0.0.0", protocol: 1 },
    dispatch: () => new Promise((resolve) => { complete = resolve; }),
    live: () => ({ agents: [], spans: {}, asks: [], partial: { thread: { text: "latest durable partial", thinking: "" } }, desktop: { id: "fixture", name: "Fixture", version: "0.0.0", protocol: 1 } }),
    onStatus: () => undefined,
  });
  t.after(() => bridge.stop());
  bridge.start();
  await Promise.resolve();
  await Promise.resolve();
  const connect = (index: number, blocked: boolean) => {
    const socket = new Socket(new FrameCodec(Buffer.from(peers[index].key, "base64url"), "phone"), blocked);
    servers[0].emit("connection", socket);
    socket.greet();
    return socket;
  };
  return { bridge, connect, timers, complete: () => complete?.({ done: true }) };
}

test("a blocked phone cannot retain unbounded encrypted output or delay a healthy peer", async (t) => {
  const { bridge, connect, timers, complete } = await fixture(t);
  const slow = connect(0, true);
  const healthy = connect(1, false);
  slow.request("pending");
  bridge.ask({ id: "permission", threadId: "thread", tool: "edit", summary: "fixture", detail: "fixture", askedAt: Date.now(), expiresAt: Date.now() + 60_000 });
  const data = "x".repeat(64 * 1024);
  const step = { threadId: "thread", toolCallId: "call", title: "fixture", kind: "execute" as const, status: "completed" as const, output: data, at: 0 };
  for (let index = 0; index < 1000; index++) bridge.event({ k: "evt", t: "step", step });
  const beforeReply = slow.frames.length;
  complete();
  await Promise.resolve();
  await Promise.resolve();
  t.diagnostic(JSON.stringify({ offeredEvents: 1000, payloadBytes: data.length, maximumQueuedBytes: slow.maximum, retainedBytes: slow.bufferedAmount, terminated: slow.terminated, healthyEvents: healthy.messages.filter((frame) => frame.k === "evt" && frame.t === "step").length }));
  assert.equal(healthy.terminated, 0);
  assert.equal(healthy.messages.filter((frame) => frame.k === "evt" && frame.t === "step").length, 1000);
  assert.ok(slow.maximum <= protocol.MAX_FRAME_BYTES * 4);
  assert.equal(slow.terminated, 1);
  assert.equal(slow.frames.length, 0);
  assert.equal(beforeReply, 0);
  assert.equal(timers.size, 2);
  const fresh = connect(0, false);
  slow.callbacks[0](new Error("late old-socket failure"));
  assert.equal(fresh.readyState, Socket.OPEN);
  assert.ok(fresh.messages.some((frame) => frame.k === "evt" && frame.t === "live" && frame.state.partial.thread.text === "latest durable partial"));
  assert.ok(fresh.messages.some((frame) => frame.k === "evt" && frame.t === "live" && frame.state.asks.some((ask) => ask.id === "permission")));
  bridge.event({ k: "evt", t: "delta", threadId: "thread", delta: "next" });
  assert.ok(fresh.messages.some((frame) => frame.k === "evt" && frame.t === "delta" && frame.delta === "next"));
  bridge.stop();
  assert.equal(timers.size, 0);
});

test("a draining phone retains normal bursts and an asynchronous send error drops only that socket", async (t) => {
  const { bridge, connect, timers } = await fixture(t);
  const draining = connect(0, true);
  const healthy = connect(1, false);
  for (let batch = 0; batch < 5; batch++) {
    for (let index = 0; index < 32; index++) bridge.event({ k: "evt", t: "delta", threadId: "thread", delta: "x".repeat(64 * 1024) });
    draining.drain();
  }
  assert.equal(draining.terminated, 0);
  assert.equal(draining.readyState, Socket.OPEN);
  assert.equal(draining.messages.filter((frame) => frame.k === "evt" && frame.t === "delta").length, 160);
  draining.callbacks.at(-1)!(new Error("socket write failed"));
  assert.equal(draining.readyState, 3);
  assert.equal(healthy.readyState, Socket.OPEN);
  assert.equal(timers.size, 2);
  bridge.event({ k: "evt", t: "delta", threadId: "thread", delta: "after failure" });
  assert.ok(healthy.messages.some((frame) => frame.k === "evt" && frame.t === "delta" && frame.delta === "after failure"));
});

test("a phone behind a slow link skips streamed events instead of losing its connection", async (t) => {
  const { bridge, connect } = await fixture(t);
  const slow = connect(0, true);
  const healthy = connect(1, false);
  for (let index = 0; index < 1000; index++) bridge.event({ k: "evt", t: "delta", threadId: "thread", delta: "x".repeat(64 * 1024) });
  assert.equal(slow.terminated, 0);
  assert.equal(slow.readyState, Socket.OPEN);
  assert.ok(slow.maximum <= protocol.MAX_FRAME_BYTES * 2 + 65 * 1024);
  assert.equal(healthy.messages.filter((frame) => frame.k === "evt" && frame.t === "delta").length, 1000);
  bridge.ask({ id: "permission", threadId: "thread", tool: "edit", summary: "fixture", detail: "fixture", askedAt: Date.now(), expiresAt: Date.now() + 60_000 });
  slow.drain();
  assert.ok(slow.messages.some((frame) => frame.k === "evt" && frame.t === "permission-ask"));
  bridge.event({ k: "evt", t: "delta", threadId: "thread", delta: "after drain" });
  slow.drain();
  assert.ok(slow.messages.some((frame) => frame.k === "evt" && frame.t === "delta" && frame.delta === "after drain"));
});
