import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket as PhoneSocket } from "ws";
import { BRIDGE_PORT, HANDSHAKE_BYTES, HEARTBEAT_MS, isBridgeMethod, MAX_FRAME_BYTES, PAIRING_TTL_MS, splitAddress } from "../shared/mobile-protocol";
import type { BridgeEvent, BridgeFrame, BridgeMethod, DesktopIdentity, LiveState, PairingPayload, PermissionAsk } from "../shared/mobile-protocol";
import { FrameCodec } from "./frames";
import { checkPin, clearPeers, loadPeers, MAX_PEERS, mintPeer, pairingPayload, savePeers, type Peer } from "./pairing";
import { addressesFor, pairingHost } from "./tailnet";

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const GREET_LIVE_MS = 1_000;

const WATCH_MS = 15_000;
const MAX_ID_CHARS = 128;
const MAX_ERROR_CHARS = 200;
const MAX_QUEUED_BYTES = 4 * MAX_FRAME_BYTES;

const MAX_PIN_TRIES = 5;
const UNKNOWN_METHOD = "Shinbo does not answer that request.";
const REQUEST_FAILED = "That request failed on this computer.";
const TOO_LARGE = "That answer is too large to send to the phone.";
const NEEDS_PIN = "Enter this computer's PIN on the phone to finish pairing.";
const BAD_PIN = "That PIN is wrong.";
const NO_ADDRESS = "This computer has no Tailscale or local network address to pair on.";
const NO_SAVE = "This computer could not save the pairing.";
const MOVED = "This computer is no longer reachable at the address the phone was paired on. Pair the phone again.";
const TAKEN = `Another program on this computer is using port ${BRIDGE_PORT}.`;
const FULL = `Shinbo pairs ${MAX_PEERS} devices at a time. Remove one before pairing another.`;

const MAX_REVOKED = 32;

const revokedFile = (userData: string) => path.join(userData, "mobile-revoked.json");

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

function loadRevoked(userData: string): string[] {
  try {
    const stored: unknown = JSON.parse(readFileSync(revokedFile(userData), "utf8"));
    if (!Array.isArray(stored)) return [];
    return stored.filter((hash): hash is string => typeof hash === "string").slice(-MAX_REVOKED);
  } catch {
    return [];
  }
}

export type BridgeDeps = {
  userData: string;
  identity: DesktopIdentity;
  dispatch: (method: BridgeMethod, params: Record<string, unknown>) => Promise<unknown>;
  live: () => LiveState;
  onStatus: (status: BridgeStatus) => void;
};


export type BridgeDevice = { id: number; connected: boolean; lastSeen: number };

export type BridgeStatus = { devices: BridgeDevice[]; listening: boolean; pairing: boolean; full: boolean; reason: string; name: string; addr: string };

export type Bridge = {
  start(): void;
  stop(): void;
  sending(): boolean;
  event(event: BridgeEvent): void;
  ask(ask: PermissionAsk): boolean;
  resolved(id: string, allowed: boolean): void;
  status(): BridgeStatus;
  pair(pin: string): Promise<PairingPayload>;
  cancelPair(): void;
  unpair(id?: number): void;

  recheck(): Promise<void>;
};


type Bound = { server: WebSocketServer; up: boolean };


type Session = { ws: PhoneSocket; peer: Peer; codec: FrameCodec; live: boolean; announced: number; beat?: ReturnType<typeof setInterval> };

function safeError(error: unknown): string {
  const raw = String((error as { message?: unknown } | null | undefined)?.message ?? error);
  const line = raw.split("\n", 1)[0].replace(/(?:\/[^\s:,;)\]"']+)+/g, "…").trim();
  return line.slice(0, MAX_ERROR_CHARS) || REQUEST_FAILED;
}

function requestParams(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function why(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "EADDRINUSE") return TAKEN;
  if (code === "EADDRNOTAVAIL") return MOVED;
  return safeError(error);
}


function sameToken(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createBridge(deps: BridgeDeps): Bridge {
  const pending = new Map<string, PermissionAsk>();
  const sessions = new Map<PhoneSocket, Session>();


  const codecs = new Map<number, FrameCodec>();
  const lastSeen = new Map<number, number>();









  let revoked = loadRevoked(deps.userData);
  const wasRevoked = (offered: string) => offered !== "" && revoked.includes(digest(offered));
  const revoke = (token: string) => {
    const hash = digest(token);
    if (revoked.includes(hash)) return;
    revoked = [...revoked, hash].slice(-MAX_REVOKED);
    try {
      mkdirSync(deps.userData, { recursive: true, mode: 0o700 });
      writeFileSync(revokedFile(deps.userData), `${JSON.stringify(revoked)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.error("shinbo bridge: could not record the revoked key", error);
    }
  };

  let peers = loadPeers(deps.userData);
  let staged: Peer | undefined;
  let pairingRequest = 0;


  const servers = new Map<string, Bound>();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let guard: ReturnType<typeof setInterval> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let backoff = BACKOFF_MIN_MS;
  let running = false;
  let listening = false;

  let targets: string[] | undefined;
  let tries = 0;
  let reason = "";
  let reported = "";

  const codecFor = (peer: Peer): FrameCodec => {
    const held = codecs.get(peer.pairedAt);
    if (held) return held;
    const made = new FrameCodec(Buffer.from(peer.key, "base64url"), "mac");
    codecs.set(peer.pairedAt, made);
    return made;
  };


  const candidates = (): Peer[] => (staged ? [...peers, staged] : peers);


  const bindAddr = (): string | undefined => staged?.addr ?? peers[0]?.addr;

  const sessionOf = (peer: Peer): [PhoneSocket, Session] | undefined => {
    for (const entry of sessions) if (entry[1].peer.pairedAt === peer.pairedAt) return entry;
    return undefined;
  };

  const devices = (): BridgeDevice[] => peers.map((peer) => ({
    id: peer.pairedAt,
    connected: sessionOf(peer)?.[1].live === true,
    lastSeen: lastSeen.get(peer.pairedAt) ?? 0,
  }));

  const status = (): BridgeStatus => ({
    devices: devices(),
    listening,
    pairing: staged !== undefined,
    full: peers.length >= MAX_PEERS,
    reason,
    name: deps.identity.name,
    addr: bindAddr() ?? "",
  });

  const changed = () => {
    const next = status();
    const stamp = JSON.stringify(next);
    if (stamp === reported) return;
    reported = stamp;
    deps.onStatus(next);
  };

  const writable = (session: Session, bytes = 0): boolean => {
    if (sessions.get(session.ws) !== session || session.ws.readyState !== PhoneSocket.OPEN) return false;
    if (session.ws.bufferedAmount + bytes <= MAX_QUEUED_BYTES) return true;
    session.ws.terminate();
    drop(session.ws, 1000);
    return false;
  };

  const send = (session: Session, data: Uint8Array | string): boolean => {
    if (!writable(session, typeof data === "string" ? Buffer.byteLength(data) : data.byteLength)) return false;
    try {
      session.ws.send(data, (error) => { if (error) drop(session.ws, 1000); });
      return true;
    } catch {
      return false;
    }
  };

  const to = (session: Session, frame: BridgeFrame): boolean => {
    if (frame.k === "evt" && !session.peer.verified) return false;
    if (!session.codec.ready || !writable(session)) return false;
    const sealed = session.codec.seal(frame);
    return sealed ? send(session, sealed) : false;
  };

  const broadcast = (event: BridgeEvent): boolean => {
    let sent = false;
    for (const session of sessions.values()) if (to(session, event)) sent = true;
    return sent;
  };

  const sending = (): boolean => {
    for (const session of sessions.values()) if (session.peer.verified && session.codec.ready) return true;
    return false;
  };

  const liveState = (): LiveState => {
    const state = deps.live();
    const now = Date.now();
    const asks = new Map(state.asks.map((ask) => [ask.id, ask]));
    for (const [id, ask] of pending) {
      if (ask.expiresAt <= now) pending.delete(id);
      else if (!asks.has(id)) asks.set(id, ask);
    }
    return { ...state, asks: [...asks.values()].filter((ask) => ask.expiresAt > now) };
  };

  const answer = (session: Session, id: string, run: Promise<unknown>) => {
    void run.then(
      (result) => {
        if (!to(session, { k: "res", id, ok: true, result } as BridgeFrame)) to(session, { k: "res", id, ok: false, error: TOO_LARGE });
      },
      (error: unknown) => {
        to(session, { k: "res", id, ok: false, error: safeError(error) });
      },
    ).catch(() => undefined);
  };

  const drop = (ws: PhoneSocket, code: number) => {
    try {
      ws.close(code, "");
    } catch (error) {
      console.error("shinbo bridge: peer close failed", error);
    }
    const session = sessions.get(ws);
    if (!session) return;
    sessions.delete(ws);
    if (session.beat !== undefined) clearInterval(session.beat);
    changed();
  };

  const unstage = () => {
    if (expiry === undefined) return;
    clearTimeout(expiry);
    expiry = undefined;
  };

  const commit = (peer: Peer): boolean => {
    if (peer !== staged || !peer.verified) return false;
    const next = [...peers, peer];
    try {
      savePeers(deps.userData, next);
    } catch (error) {
      console.error("shinbo bridge: could not save the paired phone", error);
      return false;
    }
    peers = next;
    staged = undefined;
    unstage();
    return true;
  };

  const cancelPair = () => {
    pairingRequest += 1;
    unstage();
    if (!staged) return;
    const entry = sessionOf(staged);
    codecs.delete(staged.pairedAt);
    staged = undefined;
    tries = 0;
    if (entry) drop(entry[0], 1000);
    settle();
  };

  const receive = (ws: PhoneSocket, data: Buffer, isBinary: boolean) => {
    const session = sessions.get(ws);
    if (!session) return;
    if (!isBinary) return;
    if (data.byteLength === HANDSHAKE_BYTES) {
      if (!session.codec.greet(data)) return;
      if (!send(session, session.codec.hello)) return;
      const now = Date.now();
      if (!session.peer.verified || now - session.announced < GREET_LIVE_MS) return;
      session.announced = now;
      to(session, { k: "evt", t: "live", state: liveState() });
      return;
    }
    const frame = session.codec.open(data);
    if (!frame) return;
    lastSeen.set(session.peer.pairedAt, Date.now());
    const verified = session.peer.verified;
    if (verified && !session.live) {
      session.live = true;
      changed();
    }
    if (frame.k !== "req") return;
    const id: unknown = frame.id;
    if (typeof id !== "string" || !id || id.length > MAX_ID_CHARS) return;
    const params = requestParams(frame.params);
    if (!params || !isBridgeMethod(frame.method)) {
      to(session, { k: "res", id, ok: false, error: UNKNOWN_METHOD });
      return;
    }
    if (frame.method === "unlock") {
      if (!checkPin(session.peer.pin, params.pin)) {
        to(session, { k: "res", id, ok: false, error: BAD_PIN });

        if (session.peer === staged && ++tries >= MAX_PIN_TRIES) {
          cancelPair();
          drop(ws, 1008);
        }
        return;
      }
      if (!session.peer.verified) {
        session.peer.verified = true;


        if (!commit(session.peer)) {
          session.peer.verified = false;
          to(session, { k: "res", id, ok: false, error: NO_SAVE });
          return;
        }
        session.live = true;
        changed();
      }
      tries = 0;
      to(session, { k: "res", id, ok: true, result: { unlocked: true } });
      to(session, { k: "evt", t: "live", state: liveState() });
      return;
    }
    if (!verified) {
      to(session, { k: "res", id, ok: false, error: NEEDS_PIN });
      return;
    }
    try {
      answer(session, id, deps.dispatch(frame.method, params));
    } catch (error) {
      to(session, { k: "res", id, ok: false, error: safeError(error) });
    }
  };


  const missing = (): boolean => (targets ?? []).some((address) => !servers.has(address));

  const anyUp = (): boolean => [...servers.values()].some((held) => held.up);

  const close = (server: WebSocketServer) => {
    try {
      server.close();
    } catch { return; }
  };

  const schedule = () => {
    if (!running || !bindAddr() || retry !== undefined || !missing()) return;
    const wait = backoff;
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    retry = setTimeout(() => {
      retry = undefined;
      reconcile();
    }, wait);
    retry.unref();
  };

  const open = (host: string, port: number) => {


    const known = (offered: string) => !wasRevoked(offered) && candidates().some((peer) => sameToken(offered, codecFor(peer).auth));
    let next: WebSocketServer;
    try {
      next = new WebSocketServer({
        host,
        port,
        maxPayload: MAX_FRAME_BYTES,
        handleProtocols: (protocols) => {
          for (const offered of protocols) if (known(offered)) return offered;
          return false;
        },
        verifyClient: (info: { req: { headers: Record<string, string | string[] | undefined> } }) => {
          const offered = String(info.req.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
          return offered.some(known);
        },
      });
    } catch (error) {
      reason = why(error);
      changed();
      schedule();
      return;
    }
    const held: Bound = { server: next, up: false };
    servers.set(host, held);
    const mine = () => servers.get(host) === held;
    next.on("listening", () => {
      if (!mine()) return;
      held.up = true;
      backoff = BACKOFF_MIN_MS;
      listening = true;
      reason = "";
      changed();
    });
    next.on("error", (error) => {
      if (!mine()) return;
      console.error("shinbo bridge: could not listen on", host, error);
      servers.delete(host);
      listening = anyUp();
      reason = why(error);
      changed();
      close(next);
      schedule();
    });
    next.on("connection", (ws) => {


      const peer = mine() ? candidates().find((peer) => sameToken(ws.protocol, codecFor(peer).auth)) : undefined;
      if (!peer) {
        ws.close(1011, "");
        return;
      }






      const other = sessionOf(peer);
      if (other) drop(other[0], 1000);
      const codec = codecFor(peer);
      codec.restart();
      const session: Session = { ws, peer, codec, live: false, announced: 0 };
      sessions.set(ws, session);
      ws.on("message", (data, isBinary) => receive(ws, data as Buffer, isBinary));
      ws.on("error", () => drop(ws, 1000));
      ws.on("close", () => drop(ws, 1000));



      let alive = true;
      ws.on("pong", () => { alive = true; });
      session.beat = setInterval(() => {
        if (sessions.get(ws) !== session || ws.readyState !== PhoneSocket.OPEN) return;
        if (!alive) {
          ws.terminate();
          drop(ws, 1000);
          return;
        }
        alive = false;
        try {
          if (!writable(session)) return;
          ws.ping();
          send(session, "p");
        } catch {
          drop(ws, 1000);
        }
      }, HEARTBEAT_MS);
      session.beat.unref();
      changed();
    });
  };


  const reconcile = () => {
    const addr = bindAddr();
    const where = addr ? splitAddress(addr) : undefined;
    if (!running || !where || !targets) return;
    for (const [address, held] of [...servers]) {
      if (targets.includes(address)) continue;
      servers.delete(address);
      close(held.server);
    }
    for (const address of targets) if (!servers.has(address)) open(address, where.port);
    listening = anyUp();
    changed();
  };






  const refresh = async () => {
    const addr = bindAddr();
    if (!running || !addr) return;
    const where = splitAddress(addr);
    if (!where) return;
    const found = await addressesFor(where.host);

    if (!running || bindAddr() !== addr) return;
    targets = found;
    if (!found.length) {
      if (reason === MOVED && !servers.size) return;
      reason = MOVED;
      shut();
      return;
    }
    if (reason === MOVED) reason = "";
    reconcile();
  };

  const watch = () => {
    if (guard !== undefined) return;
    guard = setInterval(() => void refresh(), WATCH_MS);
    guard.unref();
  };


  const settle = () => {
    if (!candidates().length) {
      shut();
      return;
    }
    void refresh();
    changed();
  };

  const shut = () => {
    if (retry !== undefined) {
      clearTimeout(retry);
      retry = undefined;
    }
    targets = undefined;
    for (const ws of [...sessions.keys()]) drop(ws, 1000);
    const closing = [...servers.values()];
    servers.clear();
    listening = false;
    for (const held of closing) close(held.server);
    changed();
  };

  const farewell = (why: "revoked" | "shutdown") => {
    broadcast({ k: "evt", t: "bye", reason: why });
    unstage();
    shut();
  };

  return {
    start() {
      if (running) return;
      running = true;
      changed();
      void refresh();
      watch();
    },
    stop() {
      pairingRequest += 1;
      running = false;
      if (guard !== undefined) {
        clearInterval(guard);
        guard = undefined;
      }
      farewell("shutdown");
    },
    sending,
    event(event) {
      broadcast(event);
    },
    ask(ask) {
      if (peers.length) {
        const now = Date.now();
        for (const [id, held] of pending) if (held.expiresAt <= now) pending.delete(id);
        pending.set(ask.id, ask);
      }
      const sent = broadcast({ k: "evt", t: "permission-ask", ask });
      return sent && devices().some((device) => device.connected);
    },
    resolved(id, allowed) {
      pending.delete(id);
      broadcast({ k: "evt", t: "permission-resolved", id, allowed });
    },
    status,
    async pair(pin) {
      if (peers.length >= MAX_PEERS) throw new Error(FULL);
      cancelPair();
      const request = pairingRequest;
      const host = await pairingHost();
      if (request !== pairingRequest) throw new Error("That pairing was canceled or replaced.");
      if (!host) throw new Error(NO_ADDRESS);
      const next = mintPeer(deps.identity.name, `ws://${host}:${BRIDGE_PORT}`, pin);
      unstage();
      staged = next;
      tries = 0;
      running = true;
      reason = "";

      settle();
      watch();
      expiry = setTimeout(cancelPair, PAIRING_TTL_MS);
      expiry.unref();
      return await Promise.resolve(pairingPayload(next));
    },
    cancelPair,
    recheck: refresh,
    unpair(id) {
      const going = id === undefined ? [...peers] : peers.filter((peer) => peer.pairedAt === id);
      if (!going.length && id !== undefined) return;
      for (const peer of going) {
        const entry = sessionOf(peer);
        if (entry) {
          to(entry[1], { k: "evt", t: "bye", reason: "revoked" });


          drop(entry[0], 1000);
        }
        revoke(codecFor(peer).auth);
        codecs.delete(peer.pairedAt);
        lastSeen.delete(peer.pairedAt);
      }
      const keep = peers.filter((peer) => !going.some((gone) => gone.pairedAt === peer.pairedAt));
      try {
        if (keep.length) savePeers(deps.userData, keep);
        else clearPeers(deps.userData);
      } catch (error) {
        console.error("shinbo bridge: could not update the paired phones", error);
      }
      peers = keep;
      if (id === undefined) {
        pairingRequest += 1;
        unstage();
        if (staged) codecs.delete(staged.pairedAt);
        staged = undefined;
        pending.clear();
        tries = 0;
      }


      settle();
    },
  };
}
