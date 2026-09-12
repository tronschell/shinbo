import type { App } from "electron";
import { readdirSync } from "node:fs";
import path from "node:path";

export function preferredDataDirectory(current: string, previous: string[]): string {
  const populated = (directory: string): boolean => {
    try { return readdirSync(directory).length > 0; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  return populated(current) ? current : previous.find(populated) ?? current;
}

export function initializeProfile(app: Pick<App, "getName" | "getPath" | "setName" | "setPath" | "once" | "commandLine">): void {
  if (app.commandLine.hasSwitch("user-data-dir")) return;
  const current = app.getPath("userData");
  const name = app.getName();
  const previous = name === "Shinbo" ? ["Emma", "emma-desktop"] : ["emma-desktop", "Emma"];
  const selected = preferredDataDirectory(current, previous.map((old) => path.join(app.getPath("appData"), old)));
  if (selected === current) return;
  app.setPath("userData", selected);
  app.setPath("sessionData", selected);
  app.setName(path.basename(selected));
  app.once("ready", () => app.setName(name));
}
