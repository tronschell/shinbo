export const UPDATE_REPOSITORY = "tronschell/shinbo";
export const DEFAULT_UPDATE_ORIGIN = "https://update.electronjs.org";

const MAX_UPDATE_ORIGIN_CHARS = 512;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function updateOrigin(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed.length > MAX_UPDATE_ORIGIN_CHARS) return "";
  if (/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(trimmed)) return trimmed;
  if (/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i.test(trimmed)) return trimmed;
  return "";
}

export function updateFeedUrl(origin: string, platform: string, arch: string, version: string) {
  return `${origin}/${UPDATE_REPOSITORY}/${platform}-${arch}/${version}`;
}

export function newerVersion(current: string, downloaded: unknown): string {
  if (typeof downloaded !== "string") return "";
  const next = downloaded.trim().replace(/^v/i, "");
  if (!SEMVER.test(next) || !SEMVER.test(current)) return "";
  const to = next.split(".").map(Number);
  const from = current.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (to[index] !== from[index]) return to[index] > from[index] ? next : "";
  }
  return "";
}

export const CHECK_TICK_MS = 5 * 60 * 1000;
export const CHECK_GAP_MS = 30 * 60 * 1000;

export function dueForCheck(now: number, lastCheck: number) {
  return !lastCheck || now - lastCheck >= CHECK_GAP_MS;
}

export function savedUpdate(held: unknown, current: string): { version: string; install: boolean } {
  if (!held || typeof held !== "object" || Array.isArray(held)) return { version: "", install: false };
  const record = held as { version?: unknown; install?: unknown };
  const version = newerVersion(current, record.version);
  return { version, install: !!version && record.install === true };
}

export type UpdatePhase = "idle" | "checking" | "ready" | "installing" | "current" | "error";

export type UpdateState = { phase: UpdatePhase; version: string; step: string; percent: number; detail: string };

export const IDLE_UPDATE: UpdateState = { phase: "idle", version: "", step: "", percent: 0, detail: "" };

const UPDATE_PHASES = new Set<string>(["idle", "checking", "ready", "installing", "current", "error"]);
const MAX_UPDATE_TEXT_CHARS = 512;

export function readUpdateState(value: unknown): UpdateState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { phase, version, step, percent, detail } = value as Record<string, unknown>;
  if (typeof phase !== "string" || !UPDATE_PHASES.has(phase)) return null;
  const text = (field: unknown) => typeof field === "string" && field.length <= MAX_UPDATE_TEXT_CHARS ? field : null;
  if (text(version) === null || text(step) === null || text(detail) === null) return null;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return { phase: phase as UpdatePhase, version: version as string, step: step as string, percent, detail: detail as string };
}

export function installSteps(version: string, downloaded: boolean) {
  return [...(downloaded ? [] : ["Checking for updates", `Downloading ${version}`]), "Saving your work", "Relaunching"];
}

export function installPercent(done: number, total: number) {
  return total > 0 ? Math.round(Math.min(Math.max(done, 0), total) / total * 100) : 0;
}
