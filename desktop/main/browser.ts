import { app, clipboard, Menu, WebContentsView, type BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { blankPage, BLANK_PAGE, type LocalServer } from "../shared/browser";
import { validComputerProgress, type ComputerRunProgress } from "../shared/computer";
import { recentClips, rememberClip, restoreClip } from "./clip";
import { externalUrl } from "./ipc";
import { findExecutable, isWindows, shellArguments, shellBinary, spawnCommand, terminateProcessTree } from "./platform";
import { MAX_TOOL_OUTPUT_BYTES } from "./tools";

export const INSTALL_COMMAND = "npm install -g agent-browser && agent-browser install";

export type BrowserTab = { id: string; url: string; title: string; favicon?: string; loading: boolean; error?: string };
export type BrowserStatus = {
  running: boolean;
  url?: string;
  title?: string;
  loading: boolean;
  error?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  activeTab?: string;
  tabs: BrowserTab[];
};
export type BrowserBounds = { x: number; y: number; width: number; height: number };

const NAVIGATIONS = ["back", "forward", "reload", "close"] as const;
type Navigation = (typeof NAVIGATIONS)[number];

const MAX_COMMAND_MS = 60_000;
const RESOLVE_MS = 5_000;
const RECHECK_MS = 15_000;
const DRAIN_MS = 100;
const MAX_STDERR = 4 * 1024;
const MAX_SESSION_CHARS = 48;
const MAX_TABS = 12;
const HOME = BLANK_PAGE;
const FAVICON_MS = 5_000;
const MAX_FAVICON_BYTES = 64 * 1024;
const SYSTEM_LISTENERS = new Set(["ControlCenter", "rapportd", "sharingd"]);
const LOCAL_BINDINGS = new Set(["*", "0.0.0.0", "127.0.0.1", "[::]", "[::1]", "::", "::1"]);
const CLIP_SETTLE_MS = 150;
const CLIP_KEYS = ["c", "x", "v"];
const TRUNCATION_NOTICE = "\n[truncated — read less at a time: snapshot with interactive true, or narrow it with a selector]";
const MAX_CURSOR_ACTIONS = 20;
const MAX_CURSOR_LABEL = 80;
const LOAD_MS = 30_000;
const ABORTED = -3;
const POINTERLESS = new Set(["snapshot", "get", "eval", "wait", "scroll", "screenshot"]);

export type Ran = { text: string; code: number | null; signal: NodeJS.Signals | null };
type Tab = { id: string; view: WebContentsView; targetId?: string; favicon?: string; iconRequest: number; point?: { x: number; y: number }; error?: string };
type Session = { name: string; threadId: string; tabs: Tab[]; activeId?: string; bounds?: BrowserBounds; shown: boolean; connected?: Promise<void>; pinned?: string };
type Driving = { session: Session; tab: Tab; action: string; actions: number };

export class Browsers {
  private sessions = new Map<string, Session>();
  private window: BrowserWindow | null = null;
  private path: string | null = null;
  private lookup?: Promise<string | null>;
  private port?: Promise<number | null>;
  private expires = 0;
  private loginPath?: string;
  private counter = 0;
  private driving: Driving | undefined;
  private drives = 0;

  constructor(private readonly onChange: () => void, private readonly onCursor: (progress: ComputerRunProgress | null) => void, private readonly bundled?: string) {}

  attach(window: BrowserWindow) {
    this.window = window;
    window.on("closed", () => {
      if (this.window === window) this.window = null;
    });
    for (const session of this.sessions.values()) {
      for (const tab of session.tabs) if (!tab.view.webContents.isDestroyed()) window.contentView.addChildView(tab.view);
      this.layout(session);
    }
  }

  status(threadId: string): BrowserStatus {
    const session = this.sessions.get(sessionName(threadId));
    const active = session && this.active(session);
    if (!session?.tabs.length || !active) return { running: false, loading: false, canGoBack: false, canGoForward: false, tabs: [] };
    const contents = active.view.webContents;
    return {
      running: true,
      url: contents.getURL() || undefined,
      title: contents.getTitle() || undefined,
      loading: contents.isLoading(),
      error: active.error,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      activeTab: active.id,
      tabs: session.tabs.map((tab) => ({
        id: tab.id,
        url: tab.view.webContents.getURL(),
        title: tab.view.webContents.getTitle(),
        favicon: tab.favicon,
        loading: tab.view.webContents.isLoading(),
        error: tab.error,
      })),
    };
  }

  async open(threadId: string, url: string): Promise<BrowserStatus> {
    const target = externalUrl(url);
    if (!target) throw new Error(`Shinbo's browser opens http and https addresses only, and ${url.slice(0, 120)} is neither.`);
    const session = this.session(threadId);
    const tab = this.active(session) ?? this.spawnTab(session);
    await this.load(session, tab, target.href);
    this.onChange();
    return this.status(threadId);
  }

  async newTab(threadId: string, url?: string): Promise<BrowserStatus> {
    const session = this.session(threadId);
    if (session.tabs.length >= MAX_TABS) throw new Error(`Shinbo's browser holds ${MAX_TABS} tabs at once. Close one first.`);
    const tab = this.spawnTab(session);
    const target = url ? externalUrl(url) : null;
    if (url && !target) throw new Error(`Shinbo's browser opens http and https addresses only, and ${url.slice(0, 120)} is neither.`);
    await this.load(session, tab, target ? target.href : HOME);
    this.onChange();
    return this.status(threadId);
  }

  selectTab(threadId: string, tabId: string): BrowserStatus {
    const session = this.session(threadId);
    if (!session.tabs.some((tab) => tab.id === tabId)) throw new Error("That browser tab is already gone.");
    session.activeId = tabId;
    this.layout(session);
    this.onChange();
    return this.status(threadId);
  }

  closeTab(threadId: string, tabId: string): BrowserStatus {
    const session = this.session(threadId);
    const index = session.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return this.status(threadId);
    this.destroyTab(session, session.tabs.splice(index, 1)[0]!);
    if (session.activeId === tabId) session.activeId = session.tabs[Math.min(index, session.tabs.length - 1)]?.id;
    if (!session.tabs.length) this.forget(session);
    else this.layout(session);
    this.onChange();
    return this.status(threadId);
  }

  async navigate(threadId: string, action: Navigation): Promise<BrowserStatus> {
    if (!NAVIGATIONS.includes(action)) throw new Error(`Shinbo's browser has no "${String(action).slice(0, 32)}" navigation.`);
    const session = this.session(threadId);
    if (action === "close") {
      for (const tab of session.tabs.splice(0)) this.destroyTab(session, tab);
      this.forget(session);
      this.onChange();
      return this.status(threadId);
    }
    const contents = this.active(session)?.view.webContents;
    if (!contents) return this.status(threadId);
    if (action === "reload") contents.reload();
    if (action === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    if (action === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    this.onChange();
    return this.status(threadId);
  }

  place(threadId: string, bounds: BrowserBounds | null) {
    const session = this.session(threadId);
    session.shown = bounds !== null;
    if (bounds) session.bounds = bounds;
    this.layout(session);
  }

  hideAllExcept(threadId: string) {
    const keep = sessionName(threadId);
    for (const [name, session] of this.sessions) {
      if (name === keep) continue;
      session.shown = false;
      this.layout(session);
    }
  }

  clips(): string[] {
    return recentClips();
  }

  async servers(): Promise<LocalServer[]> {
    const path = process.env.PATH ?? "";
    const ran = isWindows
      ? await capture("netstat", ["-ano", "-p", "tcp"], path)
      : await capture("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "cpn"], path);
    return ran.code === 0 ? listeners(ran.text, process.pid) : [];
  }

  reuseClip(threadId: string, index: number) {
    const text = restoreClip(index);
    if (text === undefined) throw new Error("That clipboard item is gone.");
    const session = this.sessions.get(sessionName(threadId));
    const contents = session && this.active(session)?.view.webContents;
    if (!contents || contents.isDestroyed()) return;
    contents.focus();
    contents.paste();
  }

  async run(threadId: string, argv: readonly string[], action?: string): Promise<string> {
    const session = this.session(threadId);
    const tab = this.active(session) ?? this.spawnTab(session);
    await this.pin(session, tab);
    this.drives = (this.drives + 1) % MAX_CURSOR_ACTIONS;
    this.driving = { session, tab, action: action ?? argv[0] ?? "working", actions: this.drives };
    if (!POINTERLESS.has(argv[0] ?? "")) this.pointAt(tab);
    try {
      return bounded((await this.exec(session, argv)).text);
    } finally {
      this.driving = undefined;
      this.onCursor(null);
    }
  }

  stopAll() {
    for (const session of this.sessions.values()) {
      for (const tab of session.tabs.splice(0)) this.destroyTab(session, tab);
      this.forget(session);
    }
  }

  private session(threadId: string): Session {
    const name = sessionName(threadId);
    const known = this.sessions.get(name);
    if (known) return known;
    const created: Session = { name, threadId, tabs: [], shown: true };
    this.sessions.set(name, created);
    return created;
  }

  private active(session: Session): Tab | undefined {
    return session.tabs.find((tab) => tab.id === session.activeId) ?? session.tabs[0];
  }

  private spawnTab(session: Session): Tab {
    this.counter += 1;
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    const tab: Tab = { id: `t${this.counter}`, view, iconRequest: 0 };
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (externalUrl(url) && session.tabs.length < MAX_TABS) void this.newTab(session.threadId, url);
      return { action: "deny" };
    });
    contents.on("before-input-event", (_event, input) => {
      const modifier = isWindows ? input.control : input.meta;
      const otherModifier = isWindows ? input.meta : input.control;
      if (input.type !== "keyUp" || !modifier || otherModifier || input.alt) return;
      if (!CLIP_KEYS.includes(input.key.toLowerCase())) return;
      setTimeout(rememberClip, CLIP_SETTLE_MS).unref();
    });
    contents.on("input-event", (_event, input) => {
      if (input.type !== "mouseDown") return;
      const { x, y } = input as Electron.MouseInputEvent;
      this.pointAt(tab, { x, y });
    });
    contents.on("context-menu", (_event, params) => {
      const target = this.window;
      if (!target || target.isDestroyed()) return;
      contextMenu(contents, params, (url) => { if (session.tabs.length < MAX_TABS) void this.newTab(session.threadId, url); }).popup({ window: target });
    });
    contents.on("page-favicon-updated", (_event, icons) => {
      const icon = icons.find((candidate) => candidate.startsWith("https://") || candidate.startsWith("http://"));
      const request = ++tab.iconRequest;
      if (!icon) {
        tab.favicon = undefined;
        this.onChange();
        return;
      }
      void faviconData(contents.session, icon).then((data) => {
        if (tab.iconRequest !== request || contents.isDestroyed()) return;
        tab.favicon = data;
        this.onChange();
      });
    });
    const changed = () => {
      this.layout(session);
      this.onChange();
    };
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === ABORTED) return;
      tab.error = `This page could not be loaded: ${description || `error ${code}`}`;
      changed();
    });
    contents.on("did-navigate", () => {
      tab.error = undefined;
      changed();
    });
    contents.on("did-navigate-in-page", changed);
    contents.on("page-title-updated", changed);
    contents.on("did-start-loading", changed);
    contents.on("did-stop-loading", changed);
    contents.once("destroyed", () => {
      if (session.tabs.includes(tab)) this.closeTab(session.threadId, tab.id);
    });
    session.tabs.push(tab);
    session.activeId = tab.id;
    this.window?.contentView.addChildView(view);
    this.layout(session);
    return tab;
  }

  private async load(session: Session, tab: Tab, url: string): Promise<void> {
    const contents = tab.view.webContents;
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      if (!contents.isDestroyed()) contents.stop();
    }, LOAD_MS);
    try {
      await contents.loadURL(url);
    } catch (error) {
      if (expired) {
        tab.error = `This page took longer than ${LOAD_MS / 1000}s to load.`;
        this.layout(session);
      }
      throw new Error(`Could not open ${url.slice(0, 120)}: ${tab.error ?? (error instanceof Error ? error.message : String(error))}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  private pointAt(tab: Tab, point?: { x: number; y: number }) {
    if (point) tab.point = point;
    const driving = this.driving;
    const window = this.window;
    if (driving?.tab !== tab || !driving.session.shown || !window || window.isDestroyed()) return;
    const view = tab.view.getBounds();
    const content = window.getContentBounds();
    const bounds = { x: content.x + view.x, y: content.y + view.y, width: view.width, height: view.height };
    const at = tab.point ?? { x: view.width / 2, y: view.height / 2 };
    const progress = browserCursorProgress(bounds, at, driving.action, driving.actions, window.id);
    if (progress) this.onCursor(progress);
  }

  private destroyTab(session: Session, tab: Tab) {
    session.connected = undefined;
    session.pinned = undefined;
    try {
      this.window?.contentView.removeChildView(tab.view);
    } catch (error) {
      if (this.window && !this.window.isDestroyed()) throw error;
    }
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }

  private forget(session: Session) {
    session.connected = undefined;
    session.pinned = undefined;
    session.activeId = undefined;
    this.sessions.delete(session.name);
    if (this.path) spawnCommand(this.path, ["--session", session.name, "close"], { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => undefined).unref();
  }

  private layout(session: Session) {
    const active = this.active(session);
    const zoom = this.window?.webContents.getZoomFactor() ?? 1;
    for (const tab of session.tabs) {
      const shows = session.shown && !!session.bounds && tab.id === active?.id && !tab.error && !blankPage(tab.view.webContents.getURL());
      tab.view.setVisible(shows);
      if (shows && session.bounds) tab.view.setBounds(whole(session.bounds, zoom));
    }
  }

  private async pin(session: Session, tab: Tab) {
    const port = await this.cdpPort();
    if (port === null) throw new Error("Shinbo could not open a debugging port for its browser, so the agent cannot drive it.");
    session.connected ??= this.exec(session, ["connect", String(port)])
      .then((ran) => attached(ran, `connect to Shinbo's browser on port ${port}`))
      .catch((error: unknown) => {
        session.connected = undefined;
        throw error;
      });
    await session.connected;
    const targetId = (tab.targetId ??= await targetOf(tab));
    if (session.pinned === targetId) return;
    attached(await this.exec(session, ["tab", targetId, "--pin-tab"]), "pin itself to the tab in Shinbo's browser pane");
    session.pinned = targetId;
  }

  private cdpPort(): Promise<number | null> {
    const reading = this.port ?? readFile(join(app.getPath("userData"), "DevToolsActivePort"), "utf8")
      .then((body) => {
        const port = Number(body.split("\n")[0]);
        return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
      })
      .catch(() => null);
    this.port = reading;
    void reading.then((port) => { if (port === null && this.port === reading) this.port = undefined; });
    return reading;
  }

  private async exec(session: Session, argv: readonly string[]): Promise<Ran> {
    const binary = await this.binary();
    if (!binary) throw new Error(`agent-browser is not installed, so the agent cannot drive Shinbo's browser. The pane still works. Install it by running: ${INSTALL_COMMAND}`);
    return capture(binary, ["--session", session.name, ...argv], this.loginPath ?? process.env.PATH ?? "");
  }

  private binary(): Promise<string | null> {
    if (this.lookup && Date.now() < this.expires) return this.lookup;
    this.expires = Number.MAX_SAFE_INTEGER;
    this.lookup = this.find();
    void this.lookup.then((found) => {
      if (!found) this.expires = Date.now() + RECHECK_MS;
    });
    return this.lookup;
  }

  private async find(): Promise<string | null> {
    if (this.bundled && await access(this.bundled, constants.X_OK).then(() => true, () => false)) {
      this.path = this.bundled;
      return this.path;
    }
    this.loginPath ??= isWindows ? process.env.PATH || "" : (await shell('printf %s "$PATH"')) || process.env.PATH || "";
    this.path = await findExecutable("agent-browser", this.loginPath);
    return this.path;
  }
}

export function browserCursorProgress(bounds: BrowserBounds, point: { x: number; y: number }, action: string, actions: number, windowId: number): ComputerRunProgress | null {
  const progress = {
    step: 0,
    actions,
    action: action.slice(0, MAX_CURSOR_LABEL),
    cursor: { windowId, bounds, x: bounds.x + Math.round(point.x), y: bounds.y + Math.round(point.y) },
  };
  return validComputerProgress(progress) ? progress : null;
}

function contextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams, openTab: (url: string) => void): Electron.Menu {
  const items: Electron.MenuItemConstructorOptions[] = [];
  const { editFlags } = params;
  if (params.linkURL) {
    items.push({ label: "Open Link in New Tab", click: () => openTab(params.linkURL) });
    items.push({ label: "Copy Link", click: () => clipboard.writeText(params.linkURL) });
    items.push({ type: "separator" });
  }
  if (params.mediaType === "image" && params.srcURL) {
    items.push({ label: "Copy Image Address", click: () => clipboard.writeText(params.srcURL) });
    items.push({ label: "Copy Image", click: () => contents.copyImageAt(params.x, params.y) });
    items.push({ type: "separator" });
  }
  if (params.isEditable) {
    items.push({ label: "Undo", role: "undo", enabled: editFlags.canUndo });
    items.push({ label: "Redo", role: "redo", enabled: editFlags.canRedo });
    items.push({ type: "separator" });
    items.push({ label: "Cut", role: "cut", enabled: editFlags.canCut });
    items.push({ label: "Copy", role: "copy", enabled: editFlags.canCopy });
    items.push({ label: "Paste", role: "paste", enabled: editFlags.canPaste });
    items.push({ label: "Select All", role: "selectAll" });
  } else {
    if (params.selectionText) {
      items.push({ label: "Copy", role: "copy", enabled: editFlags.canCopy });
      items.push({ label: "Search Google", click: () => void contents.loadURL(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText.slice(0, 400))}`).catch(() => undefined) });
      items.push({ type: "separator" });
    }
    items.push({ label: "Back", enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
    items.push({ label: "Forward", enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
    items.push({ label: "Reload", click: () => contents.reload() });
  }
  return Menu.buildFromTemplate(items);
}

async function faviconData(session: Electron.Session, url: string): Promise<string | undefined> {
  try {
    const response = await session.fetch(url, { signal: AbortSignal.timeout(FAVICON_MS) });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!response.ok || !type.startsWith("image/")) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_FAVICON_BYTES) return undefined;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export function listeners(output: string, ownPid: number): LocalServer[] {
  const found = new Map<number, string>();
  let pid = 0;
  let command = "";
  const keep = (address: string, port: number, who: string) => {
    if (pid === ownPid || !LOCAL_BINDINGS.has(address) || SYSTEM_LISTENERS.has(who) || !Number.isInteger(port) || port < 1 || port > 65535) return;
    found.set(port, found.get(port) || who);
  };
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const row = /^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i.exec(line);
    if (row) {
      pid = Number(row[3]);
      keep(row[1]!, Number(row[2]), "");
      continue;
    }
    const key = line[0];
    const rest = line.slice(1);
    if (key === "p") pid = Number(rest);
    else if (key === "c") command = rest;
    else if (key === "n") {
      const at = rest.lastIndexOf(":");
      if (at > 0) keep(rest.slice(0, at), Number(rest.slice(at + 1)), command);
    }
  }
  return [...found].map(([port, process]) => ({ port, process })).sort((left, right) => left.port - right.port);
}

async function targetOf(tab: Tab): Promise<string> {
  const contents = tab.view.webContents;
  if (contents.debugger.isAttached()) contents.debugger.detach();
  contents.debugger.attach("1.3");
  try {
    const info = await contents.debugger.sendCommand("Target.getTargetInfo") as { targetInfo?: { targetId?: unknown } };
    const id = info.targetInfo?.targetId;
    if (typeof id !== "string" || !/^[0-9A-F]{8,}$/i.test(id)) throw new Error("Shinbo could not identify its browser view to the agent.");
    return id;
  } finally {
    if (contents.debugger.isAttached()) contents.debugger.detach();
  }
}

function whole(bounds: BrowserBounds, zoom: number): BrowserBounds {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.max(0, Math.round(bounds.width * scale)),
    height: Math.max(0, Math.round(bounds.height * scale)),
  };
}

function sessionName(threadId: string): string {
  return `shinbo-${threadId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_SESSION_CHARS)}`;
}

function bounded(value: string): string {
  if (Buffer.byteLength(value) <= MAX_TOOL_OUTPUT_BYTES) return value;
  const kept = Buffer.from(value).subarray(0, MAX_TOOL_OUTPUT_BYTES - Buffer.byteLength(TRUNCATION_NOTICE)).toString("utf8");
  return `${kept.replace(/�$/, "")}${TRUNCATION_NOTICE}`;
}

export function attached(ran: Ran, what: string): void {
  if (ran.code === 0 && !ran.signal) return;
  throw new Error(`agent-browser could not ${what}, so nothing was driven and the browser pane shows nothing. Do not report what you cannot see. It said: ${ran.text.slice(0, 400) || "(nothing)"}`);
}

function capture(binary: string, argv: readonly string[], path: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(binary, [...argv], { env: { ...process.env, PATH: path }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    let settled = false;
    child.stdout?.on("data", (data: Buffer) => { if (out.length < MAX_TOOL_OUTPUT_BYTES) out += String(data); });
    child.stderr?.on("data", (data: Buffer) => { if (err.length < MAX_STDERR) err += String(data); });
    const timer = setTimeout(() => { if (child.pid !== undefined) terminateProcessTree(child.pid, "SIGKILL", false); }, MAX_COMMAND_MS);
    timer.unref();
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const body = out.trim();
      if (signal) return resolve({ text: `${body}\n[agent-browser was killed after ${MAX_COMMAND_MS / 1000}s]`.trim(), code, signal });
      resolve({ text: body || (code === 0 ? "(no output)" : `${err.trim() || "(no output)"}\n[exit ${code}]`), code, signal });
    };
    child.once("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(new Error(`agent-browser could not start: ${error.message}. Install or repair it by running: ${INSTALL_COMMAND}`));
    });
    child.once("exit", (code, signal) => { setTimeout(() => finish(code, signal), DRAIN_MS).unref(); });
    child.once("close", (code, signal) => finish(code, signal));
  });
}

function shell(command: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(shellBinary(), shellArguments(command, false), { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (data: Buffer) => { if (out.length < 8192) out += String(data); });
    const timer = setTimeout(() => { if (child.pid !== undefined) terminateProcessTree(child.pid, "SIGKILL", false); }, RESOLVE_MS);
    timer.unref();
    child.once("error", () => { clearTimeout(timer); resolve(""); });
    child.once("close", () => { clearTimeout(timer); resolve(out.trim().split("\n")[0] ?? ""); });
  });
}
