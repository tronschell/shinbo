import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { extractFile } from "@electron/asar";

const app = path.resolve(process.argv[2] ?? "");
if (/^Shinbo-win32-(?:x64|arm64)$/.test(path.basename(app))) {
  assert.equal(JSON.parse(extractFile(path.join(app, "resources/app.asar"), "package.json")).productName, "Shinbo");
  const root = path.join(app, "locales");
  const entries = await readdir(root, { withFileTypes: true });
  assert.ok(entries.some((entry) => entry.isFile() && entry.name === "en-US.pak"));
  const locales = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".pak") && entry.name !== "en-US.pak" && entry.name !== "en-GB.pak");
  await Promise.all(locales.map((entry) => rm(path.join(root, entry.name))));
} else {
  assert.equal(path.basename(app), "Shinbo.app");
  assert.equal(path.basename(path.dirname(app)), "Shinbo-darwin-arm64");
  assert.equal(execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim(), "com.tronschell.emma");

  const roots = [
    path.join(app, "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources"),
    path.join(app, "Contents/Resources"),
  ];

  for (const root of roots) {
    const locales = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".lproj") && entry.name !== "en.lproj");
    await Promise.all(locales.map((entry) => rm(path.join(root, entry.name), { recursive: true })));
  }
}
