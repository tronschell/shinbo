import { repairSettings, SETTINGS_KEY } from "../shared/settings";
import { copyLegacyStorage } from "../shared/legacy-storage";
import type { ProviderProfile } from "../shared/settings";
import type { CompactSnapshot } from "./types";

try { copyLegacyStorage(localStorage); }
catch (error) { console.error("Shinbo could not carry forward legacy settings", error); }

try {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (stored !== null) localStorage.setItem(SETTINGS_KEY, JSON.stringify(repairSettings(JSON.parse(stored), window.shinbo?.platform === "win32" ? "win32" : "darwin")));
} catch (error) { console.error("Shinbo could not repair stored settings", error); }

const OVERLAY_SURFACES = ["annotation", "hotspot", "radial", "run", "overlay", "computerCursor"];
const query = new URLSearchParams(location.search);

export const isWorkspaceWindow = !OVERLAY_SURFACES.some((key) => query.has(key));

let pending = OVERLAY_SURFACES.some((key) => query.has(key))
  ? undefined
  : window.shinbo.request<CompactSnapshot>("threadSummaries");

void pending?.catch(() => undefined);

const savedProviders = (): ProviderProfile[] => {
  try { return (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as { providers?: ProviderProfile[] } | null)?.providers ?? []; }
  catch { return []; }
};

const providersReady = isWorkspaceWindow
  ? window.shinbo.setProviders(savedProviders()).then(() => undefined, () => undefined)
  : Promise.resolve();

export const whenProvidersReady = () => providersReady;

export function takeBootSnapshot() {
  const first = pending;
  pending = undefined;
  return first;
}
