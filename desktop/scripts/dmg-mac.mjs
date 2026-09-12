import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "darwin", "dmg:mac requires macOS.");

const desktop = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
assert.match(version, /^\d+\.\d+\.\d+$/, "The root package.json needs a stable X.Y.Z version.");

const app = path.resolve(process.argv[2] ?? path.join(desktop, "release/Shinbo-darwin-arm64/Shinbo.app"));
const dmg = path.resolve(process.argv[3] ?? path.join(desktop, "release", `Shinbo-v${version}-darwin-arm64.dmg`));
assert.ok(existsSync(app) && statSync(app).isDirectory(), `Not a packaged app: ${app}`);

const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const output = (command, args) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const plist = (bundle, key) => output("plutil", ["-extract", key, "raw", "-o", "-", path.join(bundle, "Contents/Info.plist")]).trim();
assert.equal(plist(app, "CFBundleShortVersionString"), version);

const stage = mkdtempSync(path.join(tmpdir(), "shinbo-dmg-"));
let mount = path.join(stage, "mount");
const candidate = path.join(stage, "Shinbo.dmg");
const writable = path.join(stage, "writable.dmg");
const payload = path.join(stage, "payload");
try {
  run("xcrun", ["swift", path.join(desktop, "scripts/dmg-background.swift"), stage, version]);
  run("python3", ["-m", "venv", path.join(stage, "python")]);
  const python = path.join(stage, "python/bin/python");
  run(python, ["-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", "--require-hashes", "-r", path.join(desktop, "scripts/dmg-requirements.txt")]);
  mkdirSync(payload);
  run("ditto", [app, path.join(payload, "Shinbo.app")]);
  symlinkSync("/Applications", path.join(payload, "Applications"));
  run("tiffutil", ["-cathidpicheck", path.join(stage, "background.png"), path.join(stage, "background@2x.png"), "-out", path.join(payload, ".background.tiff")]);
  run("hdiutil", ["create", "-volname", "Shinbo", "-srcfolder", payload, "-fs", "HFS+", "-format", "UDRW", "-quiet", writable]);
  run("hdiutil", ["attach", writable, "-nobrowse", "-noautoopen", "-quiet", "-mountpoint", mount]);
  run(python, [path.join(desktop, "scripts/dmg-layout.py"), mount, "--write"]);
  run("bless", ["--folder", mount]);
  run("hdiutil", ["detach", mount, "-quiet"]);
  run("hdiutil", ["convert", writable, "-format", "UDZO", "-quiet", "-o", candidate]);
  mount = path.join(stage, "verify-mount");
  run("hdiutil", ["attach", candidate, "-readonly", "-nobrowse", "-noautoopen", "-quiet", "-mountpoint", mount]);
  const mounted = path.join(mount, "Shinbo.app");
  assert.ok(existsSync(mounted), "The disk image is missing Shinbo.app.");
  assert.equal(plist(mounted, "CFBundleShortVersionString"), version);
  assert.equal(plist(mounted, "CFBundleIdentifier"), "com.tronschell.emma");
  assert.equal(output("readlink", [path.join(mount, "Applications")]).trim(), "/Applications");
  run(python, [path.join(desktop, "scripts/dmg-layout.py"), mount, "--verify"]);
  run("xcrun", ["swift", path.join(desktop, "scripts/dmg-background.swift"), "--verify", path.join(stage, "background.alias"), path.join(mount, ".background.tiff")]);
  for (const resource of ["shinbo-host", "shinbo-cli", "rg"]) assert.ok(existsSync(path.join(mounted, "Contents/Resources", resource)), `The disk image is missing ${resource}.`);
  run("hdiutil", ["detach", mount, "-quiet"]);
  renameSync(candidate, dmg);
} finally {
  if (existsSync(path.join(mount, "Shinbo.app"))) spawnSync("hdiutil", ["detach", mount, "-quiet"], { stdio: "inherit" });
  rmSync(stage, { recursive: true, force: true });
}

console.log(`Verified Shinbo ${version}: ${dmg}`);
