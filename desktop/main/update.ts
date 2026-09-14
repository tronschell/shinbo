import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, autoUpdater, powerMonitor } from "electron";
import { CHECK_TICK_MS, DEFAULT_UPDATE_ORIGIN, dueForCheck, IDLE_UPDATE, installPercent, installSteps, newerVersion, savedUpdate, updateFeedUrl, updateOrigin, type UpdateState } from "../shared/update";

const FAKE_ANNOUNCE_MS = 4000;
const FAKE_STEP_MS = 1500;

let state: UpdateState = IDLE_UPDATE;
let ready = "";
let staged = "";
let feedUrl = "";
let lastCheck = 0;
let announce: (state: UpdateState) => void = () => {};
let prepareQuit: () => Promise<void> = () => Promise.resolve();
let recheck: (() => void) | undefined;
let checking = false;
let download: { resolve: () => void; reject: (error: Error) => void } | undefined;
let downloading: (version: string) => void = () => {};

const readyFile = () => path.join(app.getPath("userData"), "update-ready.json");

function set(next: Partial<UpdateState>) {
  state = { ...state, ...next };
  announce(state);
}

const readyState = (version: string): UpdateState => ({ ...IDLE_UPDATE, phase: "ready", version });
const currentState = (): UpdateState => ({ ...IDLE_UPDATE, phase: "current", version: app.getVersion() });

function rememberReady(version: string, install = false) {
  try {
    writeFileSync(readyFile(), JSON.stringify({ version, install }));
  } catch (error) {
    console.error("Shinbo: could not record the downloaded update", error);
  }
}

function recallReady() {
  try {
    return savedUpdate(JSON.parse(readFileSync(readyFile(), "utf8")), app.getVersion());
  } catch {
    return { version: "", install: false };
  }
}

function forgetReady() {
  try {
    rmSync(readyFile(), { force: true });
  } catch (error) {
    console.error("Shinbo: could not clear the recorded update", error);
  }
}

export function updateState() {
  return state;
}

function forceCheck() {
  if (checking || !recheck) return;
  lastCheck = 0;
  recheck();
}

export function checkForUpdates() {
  if (state.phase === "checking" || state.phase === "installing") return;
  if (ready && staged === ready) {
    set(readyState(ready));
    return;
  }
  set({ ...IDLE_UPDATE, phase: "checking" });
  if (!recheck) {
    settleCheck(currentState(), new Error("Update checks are off in this build."));
    return;
  }
  forceCheck();
}

function settleCheck(outcome: UpdateState, failure: Error) {
  checking = false;
  const stale = !!ready && !staged;
  if (stale) {
    ready = "";
    forgetReady();
  }
  if (download) {
    const pending = download;
    download = undefined;
    pending.reject(failure);
    return;
  }
  if (state.phase === "checking") set(outcome);
  else if (stale) set(IDLE_UPDATE);
}

function downloaded(version: string) {
  checking = false;
  ready = version;
  staged = version;
  rememberReady(version);
  if (download) {
    const pending = download;
    download = undefined;
    pending.resolve();
    return;
  }
  set(readyState(version));
}

function reportFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error("Shinbo: update failed", error);
  set({ ...IDLE_UPDATE, phase: "error", detail });
}

function relaunch() {
  if (!app.isPackaged) {
    setTimeout(() => { ready = ""; set(IDLE_UPDATE); }, FAKE_STEP_MS).unref();
    return;
  }
  if (ready !== staged) rememberReady(ready, true);
  autoUpdater.quitAndInstall();
}

export async function installUpdate() {
  if (!ready || state.phase === "installing") return;
  const version = ready;
  const steps = installSteps(version, !!staged);
  let done = 0;
  const step = (label: string) => set({ phase: "installing", version, step: label, percent: installPercent(done++, steps.length), detail: "" });
  try {
    if (!staged) {
      step(steps[0]);
      await new Promise<void>((resolve, reject) => {
        if (!recheck) {
          reject(new Error("Update checks are off in this build."));
          return;
        }
        download = { resolve, reject };
        downloading = () => step(steps[1]);
        forceCheck();
      });
    }
    step("Saving your work");
    await prepareQuit();
    step("Relaunching");
    set({ percent: 100 });
    relaunch();
  } catch (error) {
    reportFailure(error);
  }
}

async function probeFeed() {
  try {
    const response = await fetch(feedUrl, { headers: { accept: "application/json" } });
    if (response.status !== 200) return;
    const latest = newerVersion(ready, ((await response.json()) as { name?: unknown } | null)?.name);
    if (!latest) return;
    if (process.platform === "win32") {
      checking = true;
      autoUpdater.checkForUpdates();
      return;
    }
    ready = latest;
    rememberReady(latest);
    if (state.phase === "ready" || state.phase === "idle") set(readyState(latest));
  } catch (error) {
    console.error("Shinbo: update feed probe failed", error);
  }
}

function restore(): boolean {
  const restored = recallReady();
  if (!restored.version) {
    forgetReady();
    return false;
  }
  ready = restored.version;
  rememberReady(ready);
  set(readyState(ready));
  return restored.install;
}

function startFakeUpdates() {
  const fake = newerVersion(app.getVersion(), process.env.SHINBO_UPDATE_FAKE);
  recheck = () => {
    checking = true;
    setTimeout(() => {
      if (!fake) {
        settleCheck(currentState(), new Error("No update is available."));
        return;
      }
      if (!download) {
        downloaded(fake);
        return;
      }
      downloading(fake);
      setTimeout(() => downloaded(fake), FAKE_STEP_MS).unref();
    }, FAKE_STEP_MS).unref();
  };
  if (restore()) {
    void installUpdate();
    return;
  }
  if (fake) setTimeout(() => { ready = fake; set(readyState(fake)); }, FAKE_ANNOUNCE_MS).unref();
}

export function startUpdates(announceState: (state: UpdateState) => void, drain: () => Promise<void>) {
  announce = announceState;
  prepareQuit = drain;
  if (!app.isPackaged) {
    startFakeUpdates();
    return;
  }
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  const origin = process.env.SHINBO_UPDATE_URL ? updateOrigin(process.env.SHINBO_UPDATE_URL) : DEFAULT_UPDATE_ORIGIN;
  if (!origin) {
    console.error("Shinbo: SHINBO_UPDATE_URL is not an https origin; update checks are off");
    return;
  }
  autoUpdater.on("error", (error) => {
    console.error("Shinbo: update check failed", error);
    settleCheck({ ...IDLE_UPDATE, phase: "error", detail: error.message }, error);
  });
  autoUpdater.on("update-not-available", () => {
    settleCheck(currentState(), new Error("The downloaded update is no longer available."));
  });
  autoUpdater.on("update-available", () => {
    if (download) downloading(ready);
  });
  autoUpdater.on("update-downloaded", (_event, _notes, name) => {
    const version = newerVersion(app.getVersion(), name);
    if (!version) {
      settleCheck(currentState(), new Error(`The update feed offered an unusable version: ${String(name)}`));
      return;
    }
    downloaded(version);
  });
  feedUrl = updateFeedUrl(origin, process.platform, process.arch, app.getVersion());
  try {
    autoUpdater.setFeedURL({ url: feedUrl });
  } catch (error) {
    console.error("Shinbo: update feed unavailable", error);
    return;
  }
  const check = () => {
    if (!dueForCheck(Date.now(), lastCheck)) return;
    lastCheck = Date.now();
    if (staged) {
      void probeFeed();
      return;
    }
    checking = true;
    try {
      autoUpdater.checkForUpdates();
    } catch (error) {
      console.error("Shinbo: update check failed", error);
      settleCheck({ ...IDLE_UPDATE, phase: "error", detail: error instanceof Error ? error.message : String(error) }, error instanceof Error ? error : new Error(String(error)));
    }
  };
  recheck = check;
  if (restore()) void installUpdate();
  else check();
  setInterval(check, CHECK_TICK_MS).unref();
  powerMonitor.on("resume", check);
  app.on("browser-window-focus", check);
}
