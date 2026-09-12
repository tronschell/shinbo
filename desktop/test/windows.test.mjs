import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createPackage } from "@electron/asar";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalResetPath, commandShimArguments, pathInside, processTreeCommand, resetDataRoots, samePath, spawnCommand, squirrelEvent, terminateProcessTree, windowsShimTarget, windowsShortcutFiles, WINDOWS_APP_USER_MODEL_ID, WINDOWS_INSTALLER_COMPANY } from "../dist-main/main/platform.js";
import { commandShimArguments as packageCommandShimArguments, publishStagedBuild, squirrelStagingDirectory, windowsSystemExecutable } from "../scripts/windows-command.mjs";
import { gitReady } from "../dist-main/main/git.js";
import { parseWindowsFrontContext } from "../dist-main/main/windows-front.js";
import { keybindLabel, validateKeybinds } from "../dist-main/shared/settings.js";

test("Squirrel lifecycle ignores firstrun and handles install events", () => {
  assert.equal(squirrelEvent(["Shinbo.exe", "--squirrel-firstrun"]), null);
  assert.equal(squirrelEvent(["Shinbo.exe", "--squirrel-install"]), "install");
  assert.equal(squirrelEvent(["Shinbo.exe", "--squirrel-updated"]), "updated");
  assert.equal(squirrelEvent(["Shinbo.exe", "--squirrel-uninstall"]), "uninstall");
  assert.equal(squirrelEvent(["Shinbo.exe", "--squirrel-obsolete"]), "obsolete");
});

test("Windows package locale trimming retains English and refuses unidentified packages", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-locales-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "Shinbo-win32-x64");
  const source = path.join(root, "source");
  const locales = path.join(app, "locales");
  await mkdir(source);
  await mkdir(path.join(app, "resources"), { recursive: true });
  await mkdir(locales);
  for (const name of ["en-US.pak", "en-GB.pak", "de.pak", "ja.pak", "other.txt"]) await writeFile(path.join(locales, name), name);
  const run = async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/trim-packaged-locales.mjs", import.meta.url)), app], { stdio: "ignore" });
    return (await once(child, "exit"))[0];
  };
  await writeFile(path.join(source, "package.json"), JSON.stringify({ productName: "Another app" }));
  await createPackage(source, path.join(app, "resources/app.asar"));
  assert.notEqual(await run(), 0);
  assert.ok(existsSync(path.join(locales, "de.pak")));
  await writeFile(path.join(source, "package.json"), JSON.stringify({ productName: "Shinbo" }));
  await createPackage(source, path.join(app, "resources/app.asar"));
  assert.equal(await run(), 0);
  assert.deepEqual((await readdir(locales)).sort(), ["en-GB.pak", "en-US.pak", "other.txt"]);
  assert.equal(await readFile(path.join(locales, "en-US.pak"), "utf8"), "en-US.pak");
  assert.equal(await run(), 0);
  await rm(path.join(locales, "en-US.pak"));
  await writeFile(path.join(locales, "fr.pak"), "fr");
  assert.notEqual(await run(), 0);
  assert.ok(existsSync(path.join(locales, "fr.pak")));
});

test("Squirrel shortcut and Electron use the same app identity", () => {
  assert.equal(WINDOWS_APP_USER_MODEL_ID, "com.squirrel.Shinbo.Shinbo");
});

test("Windows command shims preserve metacharacters as argv", () => {
  const args = commandShimArguments("C:\\Program Files\\npm.cmd", ["a&b", "%PATH%", "x|y", "quote\"value"]);
  assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(args[3], /\^+&/);
  assert.match(args[3], /\^+%/);
  assert.match(args[3], /\^+\|/);
  assert.throws(() => commandShimArguments("tool.cmd", ["line\nbreak"]), TypeError);
});

test("Windows dev tree-stop resolves only an absolute System32 taskkill", () => {
  assert.equal(windowsSystemExecutable("taskkill.exe", { SystemRoot: "D:\\Windows" }), "D:\\Windows\\System32\\taskkill.exe");
  assert.equal(windowsSystemExecutable("taskkill.exe", { SystemRoot: "..\\Windows", WINDIR: "E:\\Windows" }), "E:\\Windows\\System32\\taskkill.exe");
  assert.equal(windowsSystemExecutable("taskkill.exe", { SystemRoot: "..\\Windows", WINDIR: "relative" }), "C:\\Windows\\System32\\taskkill.exe");
});

test("Windows process-tree termination uses absolute taskkill and reports helper failures", async () => {
  assert.deepEqual(processTreeCommand(421, "SIGKILL", "win32", { SystemRoot: "D:\\Windows" }), {
    executable: "D:\\Windows\\System32\\taskkill.exe",
    args: ["/pid", "421", "/t", "/f"],
  });
  const listeners = new Map();
  const taskkill = {
    killed: false,
    once(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    kill() {
      this.killed = true;
    },
  };
  let invoked;
  const failed = await terminateProcessTree(421, "SIGKILL", true, "win32", (executable, args) => {
    invoked = { executable, args };
    queueMicrotask(() => listeners.get("error")?.(new Error("taskkill unavailable")));
    return taskkill;
  });
  assert.deepEqual(invoked.args, ["/pid", "421", "/t", "/f"]);
  assert.equal(failed, false);
  assert.equal(taskkill.killed, false);
  assert.equal(processTreeCommand(421, "SIGTERM", "darwin"), undefined);
});

test("Windows packaging command shims preserve spaces and metacharacters", () => {
  const args = packageCommandShimArguments("C:\\Program Files\\npm.cmd", ["run", "build", "a&b", "%PATH%", "quote\"value"]);
  assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(args[3], /Program\^ Files/);
  assert.match(args[3], /\^+&/);
  assert.match(args[3], /\^+%/);
  assert.match(args[3], /quote\\\^+"/);
  assert.throws(() => packageCommandShimArguments("npm.cmd", ["line\nbreak"]), TypeError);
});

test("Windows command shims round-trip hostile argv without executing it", async () => {
  if (process.platform !== "win32") return;
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-shim-"));
  const shim = path.join(root, "fixture.cmd");
  const marker = path.join(root, "injected.txt");
  const values = ["spaces here", "a&b", "x|y", "%PATH%", "!bang!", "^caret^", "(paren)", "quote\"value", "trailing\\", `& echo injected > ${marker}`];
  await writeFile(shim, `@echo off\r\n"${process.execPath}" -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" %*\r\n`, "utf8");
  try {
    const settle = (child) => {
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      return once(child, "close").then(([code]) => ({ code, stdout, stderr }));
    };
    const runs = [
      settle(spawnCommand(shim, values, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })),
      settle(spawn(process.env.ComSpec ?? "cmd.exe", packageCommandShimArguments(shim, values), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false, windowsVerbatimArguments: true })),
    ];
    for (const run of runs) {
      const { code, stdout, stderr } = await run;
      assert.equal(code, 0, stderr);
      assert.deepEqual(JSON.parse(stdout), values);
    }
    await assert.rejects(readFile(marker));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows front-window context accepts only bounded browser metadata", () => {
  const page = { application: "Microsoft Edge", window: "Shinbo docs", url: "https://example.com", title: "Shinbo docs" };
  assert.deepEqual(parseWindowsFrontContext(JSON.stringify({ front: page, browsers: [page] })), { front: page, browsers: [page] });
  assert.throws(() => parseWindowsFrontContext("not json"));
  assert.throws(() => parseWindowsFrontContext(JSON.stringify({ front: page, browsers: Array.from({ length: 65 }, () => page) })));
  assert.throws(() => parseWindowsFrontContext(JSON.stringify({ front: { ...page, title: "x".repeat(2049) }, browsers: [] })));
});

test("Windows keybinds normalize legacy Command and Control collisions", () => {
  const command = { accelerator: "Command+Alt+E", hold: "", ms: 0 };
  const control = { accelerator: "Control+Alt+E", hold: "", ms: 0 };
  assert.equal(keybindLabel(command, "win32"), "Ctrl+Alt+E");
  assert.throws(() => validateKeybinds({ toggle: command, voice: control }, "win32"), /bound twice/);
  assert.throws(() => validateKeybinds({ toggle: { accelerator: "Control+S", hold: "", ms: 0 } }, "win32"), /Ctrl with a single key/);
  assert.throws(() => validateKeybinds({ toggle: { accelerator: "Command+S", hold: "", ms: 0 } }, "win32"), /Ctrl with a single key/);
});

test("Windows path containment handles drive roots, UNC shares, and case", () => {
  assert.equal(pathInside("C:\\", "c:\\Users\\Shinbo\\notes", "win32"), true);
  assert.equal(pathInside("C:\\Users\\Shinbo", "c:\\users\\shinbo\\notes", "win32"), true);
  assert.equal(pathInside("C:\\Users\\Shinbo", "C:\\Users\\Shinbo2", "win32"), false);
  assert.equal(pathInside("C:\\Users\\Shinbo", "D:\\Users\\Shinbo", "win32"), false);
  assert.equal(pathInside("\\\\server\\share", "\\\\SERVER\\SHARE\\folder", "win32"), true);
  assert.equal(pathInside("\\\\server\\share", "\\\\server\\other\\folder", "win32"), false);
  assert.equal(samePath("C:\\Users\\Shinbo", "c:\\users\\shinbo", "win32"), true);
});

test("Windows native helpers embed the long-path manifest", () => {
  const build = readFileSync(new URL("../scripts/build-native.mjs", import.meta.url), "utf8");
  const manifest = readFileSync(new URL("../native/windows-helper.manifest", import.meta.url), "utf8");
  const paths = readFileSync(new URL("../native/windows_path.hpp", import.meta.url), "utf8");
  assert.match(build, /rc\.exe/);
  assert.match(build, /native\/windows-helper\.rc/);
  assert.equal((build.match(/resource,/g) ?? []).length, 5);
  assert.match(manifest, /<longPathAware [^>]+>true<\/longPathAware>/);
  assert.match(manifest, /<supportedOS Id="\{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a\}"\/>/);
  assert.match(manifest, /<dpiAwareness [^>]+>PerMonitorV2<\/dpiAwareness>/);
  assert.match(paths, /extended_length/);
  assert.match(paths, /without_extended_length/);
});

test("Reset data roots reject Windows protected locations and retain app descendants", () => {
  const environment = {
    USERPROFILE: "C:\\Users\\Shinbo",
    SystemRoot: "C:\\Windows",
    WINDIR: "C:\\Windows",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    ProgramW6432: "C:\\Program Files",
    ProgramData: "C:\\ProgramData",
    APPDATA: "C:\\Users\\Shinbo\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\Shinbo\\AppData\\Local",
    TEMP: "C:\\Users\\Shinbo\\AppData\\Local\\Temp",
    TMP: "C:\\Users\\Shinbo\\AppData\\Local\\Temp",
  };
  const userData = "C:\\Users\\Shinbo\\AppData\\Roaming\\Shinbo";
  for (const candidate of [
    "C:\\",
    "C:\\Users\\Shinbo",
    "C:\\Windows\\System32",
    environment.APPDATA,
    "C:\\Users\\Shinbo\\AppData",
    environment.LOCALAPPDATA,
    environment.TEMP,
    environment.ProgramFiles,
    "C:\\Program Files\\Shinbo",
    environment["ProgramFiles(x86)"],
    "C:\\Program Files (x86)\\Shinbo",
    "C:\\Windows\\Shinbo",
    environment.ProgramData,
    "C:\\ProgramData\\Shinbo",
  ]) assert.throws(() => resetDataRoots(userData, candidate, "win32", environment.USERPROFILE, environment), /Reset blocked/);
  assert.deepEqual(resetDataRoots(userData, undefined, "win32", environment.USERPROFILE, environment), [userData]);
  assert.deepEqual(resetDataRoots(userData, "C:\\Users\\Shinbo\\AppData\\Roaming\\Shinbo\\Extra", "win32", environment.USERPROFILE, environment), ["C:\\Users\\Shinbo\\AppData\\Roaming\\Shinbo\\Extra", userData]);
  assert.deepEqual(resetDataRoots(userData, "C:\\Users\\Shinbo\\AppData\\Local\\Temp\\Shinbo", "win32", environment.USERPROFILE, environment), ["C:\\Users\\Shinbo\\AppData\\Local\\Temp\\Shinbo", userData]);
  assert.deepEqual(resetDataRoots(userData, "c:\\users\\shinbo\\appdata\\roaming\\shinbo", "win32", environment.USERPROFILE, environment), ["c:\\users\\shinbo\\appdata\\roaming\\shinbo"]);
});

test("Reset canonical paths expose symlink targets before deletion", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-reset-canonical-"));
  const target = path.join(root, "target");
  const link = path.join(root, "link");
  await mkdir(target, { recursive: true });
  try {
    try {
      await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }
    const requested = path.join(link, "Shinbo");
    const canonical = canonicalResetPath(requested);
    assert.equal(canonical, canonicalResetPath(path.join(target, "Shinbo")));
    assert.equal(samePath(canonical, requested, process.platform), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows git execution does not use a repo-local shim", async () => {
  if (process.platform !== "win32") return;
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-git-shadow-"));
  const previous = process.cwd();
  const marker = path.join(root, "executed.txt");
  await writeFile(path.join(root, "git.cmd"), "@echo off\r\n>\"%~dp0executed.txt\" echo ran\r\nexit /b 0\r\n", "utf8");
  try {
    process.chdir(root);
    assert.ok(["no-git", "no-repo", "ready"].includes(await gitReady(root)));
  } finally {
    process.chdir(previous);
  }
  await assert.rejects(readFile(marker));
  await rm(root, { recursive: true, force: true });
});

test("Windows npm shims resolve to the executable or script they run", async () => {
  if (process.platform !== "win32") return;
  const root = await mkdtemp(path.join(tmpdir(), "shinbo-shim-target-"));
  try {
    const script = path.join(root, "cli.js");
    const executable = path.join(root, "cli.exe");
    await writeFile(script, "");
    await writeFile(executable, "");
    const direct = path.join(root, "direct.cmd");
    await writeFile(direct, ["@ECHO off", "SET dp0=%~dp0", '"%dp0%\\cli.exe"   %*'].join("\r\n"));
    const scripted = path.join(root, "scripted.cmd");
    await writeFile(scripted, [
      "@ECHO off",
      "SET dp0=%~dp0",
      'IF EXIST "%dp0%\\node.exe" (SET "_prog=%dp0%\\node.exe") ELSE (SET "_prog=node")',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\cli.js" %*',
    ].join("\r\n"));

    assert.deepEqual(await windowsShimTarget(direct), { command: executable, args: [] });
    const resolved = await windowsShimTarget(scripted);
    assert.deepEqual(resolved.args, [script]);
    assert.match(path.basename(resolved.command).toLowerCase(), /^node(\.exe)?$/);
    assert.equal(await windowsShimTarget(executable), undefined);
    await writeFile(path.join(root, "empty.cmd"), "@ECHO off\r\necho nothing\r\n");
    assert.equal(await windowsShimTarget(path.join(root, "empty.cmd")), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows uninstall clears every Start Menu shortcut the installer leaves behind", () => {
  const expected = [
    "C:\\Users\\Shinbo\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Shinbo.lnk",
    `C:\\Users\\Shinbo\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\${WINDOWS_INSTALLER_COMPANY}\\Shinbo.lnk`,
  ];
  assert.deepEqual(windowsShortcutFiles({ APPDATA: "C:\\Users\\Shinbo\\AppData\\Roaming" }), expected);
  assert.deepEqual(windowsShortcutFiles({ USERPROFILE: "C:\\Users\\Shinbo" }), expected);

  const main = readFileSync(new URL("../main/main.ts", import.meta.url), "utf8");
  const uninstall = main.slice(main.indexOf('if (event === "uninstall")')).slice(0, 400);
  assert.match(uninstall, /"--removeShortcut", "Shinbo\.exe"/);
  assert.match(uninstall, /windowsShortcutFiles\(\)\) rmSync\(link, \{ force: true \}\)/);

  const packaging = readFileSync(new URL("../scripts/package-windows.mjs", import.meta.url), "utf8");
  assert.ok(packaging.includes(`CompanyName: "${WINDOWS_INSTALLER_COMPANY}"`), "the packager no longer stamps the company the uninstall sweeps");
});

test("Windows packaging stages Squirrel work in a short temp directory and publishes it", async () => {
  const staging = squirrelStagingDirectory();
  assert.ok(staging.startsWith(path.join(tmpdir(), "shinbo-squirrel-")), staging);
  const out = await mkdtemp(path.join(tmpdir(), "shinbo-release-"));
  try {
    await mkdir(path.join(staging, "squirrel"), { recursive: true });
    await writeFile(path.join(staging, "squirrel", "RELEASES"), "feed");
    await mkdir(path.join(out, "squirrel"), { recursive: true });
    await writeFile(path.join(out, "squirrel", "stale.nupkg"), "old");

    publishStagedBuild(staging, out, ["squirrel"]);
    assert.equal(await readFile(path.join(out, "squirrel", "RELEASES"), "utf8"), "feed");
    assert.equal(existsSync(path.join(out, "squirrel", "stale.nupkg")), false);
    assert.equal(existsSync(staging), false);
    assert.throws(() => publishStagedBuild(staging, out, ["squirrel"]), /Missing staged Windows output/);

    const packaging = readFileSync(new URL("../scripts/package-windows.mjs", import.meta.url), "utf8");
    assert.match(packaging, /const staging = squirrelStagingDirectory\(\);/);
    assert.match(packaging, /out: staging,/);
    assert.match(packaging, /publishStagedBuild\(staging, out, \[/);
    assert.doesNotMatch(packaging, /path\.join\(out, "squirrel"\);/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
