import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { initializeProfile, preferredDataDirectory } from "../main/profile";
import { copyLegacyStorage } from "../shared/legacy-storage";

function source(name: string): string {
  const root = process.env.SHINBO_PROFILE_TEST_SOURCE;
  return readFileSync(root ? path.join(root, name) : path.join(process.cwd(), name === "boot.ts" ? "src" : "main", name), "utf8");
}

function evaluate(code: string, globals: Record<string, unknown>) {
  return runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, globals);
}

test("I3-01 startup selects old profiles without overwriting populated new profiles", () => {
  const main = source("main.ts");
  const startup = main.slice(main.indexOf("const DEVICE ="), main.indexOf("class Host"));
  for (const platform of ["darwin", "win32"]) {
    for (const state of ["old", "new", "both", "empty-new", "explicit", "fresh"]) {
      const root = mkdtempSync(path.join(tmpdir(), "shinbo-profile-"));
      try {
        const newName = platform === "win32" ? "Shinbo" : "shinbo-desktop";
        const oldName = platform === "win32" ? "Emma" : "emma-desktop";
        const current = path.join(root, newName);
        const previous = path.join(root, oldName);
        const paths: Record<string, string> = { appData: root, userData: current, sessionData: current };
        const listeners = new Map<string, () => void>();
        let name = newName;
        const app = {
          getName: () => name,
          setName: (value: string) => { name = value; },
          getPath: (key: string) => paths[key],
          setPath: (key: string, value: string) => { paths[key] = value; },
          once: (event: string, listener: () => void) => { listeners.set(event, listener); },
          commandLine: { hasSwitch: () => state === "explicit" },
        };
        if (["old", "both", "empty-new", "explicit"].includes(state)) {
          mkdirSync(previous);
          writeFileSync(path.join(previous, "credentials.json"), `sealed-for:${oldName}`);
          writeFileSync(path.join(previous, "thread-contexts.json"), "kept contexts");
        }
        if (["new", "both", "empty-new"].includes(state)) mkdirSync(current);
        if (["new", "both"].includes(state)) writeFileSync(path.join(current, "credentials.json"), `sealed-for:${newName}`);
        evaluate(startup, { app, localDevice: () => "computer", isWindows: platform === "win32", initializeProfile, process: { platform, env: {} } });
        const legacy = state === "old" || state === "empty-new";
        assert.equal(paths.userData, legacy ? previous : current, `${platform}/${state}`);
        assert.equal(paths.sessionData, paths.userData, "Chromium state uses the selected profile too");
        assert.equal(name, legacy ? oldName : newName, "encryption keeps the selected profile's original identity before ready");
        listeners.get("ready")?.();
        assert.equal(name, newName, "display identity returns after encryption initialization");
        if (existsSync(path.join(previous, "credentials.json"))) assert.equal(readFileSync(path.join(previous, "credentials.json"), "utf8"), `sealed-for:${oldName}`);
        if (["new", "both"].includes(state)) assert.equal(readFileSync(path.join(current, "credentials.json"), "utf8"), `sealed-for:${newName}`);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  }
});

test("I3-01 explicit new data environment wins and legacy override is carried forward", () => {
  const main = source("main.ts");
  const startup = main.slice(main.indexOf("const DEVICE ="), main.indexOf("class Host"));
  for (const environment of [{ EMMA_DATA_DIR: "/tmp/old-data" }, { EMMA_DATA_DIR: "/tmp/old-data", SHINBO_DATA_DIR: "/tmp/new-data" }, {}]) {
    const env: Record<string, string | undefined> = { ...environment };
    evaluate(startup, { app: {}, localDevice: () => "computer", isWindows: false, initializeProfile: () => undefined, process: { platform: "darwin", env } });
    assert.equal(env.SHINBO_DATA_DIR, environment.SHINBO_DATA_DIR ?? environment.EMMA_DATA_DIR);
    assert.notEqual(env.SHINBO_DATA_DIR, "undefined");
  }
});

test("I3-01 storage migration runs before boot reads provider settings and preserves newer values", () => {
  const providers = [{ id: "saved-provider", label: "Saved provider" }];
  const values = new Map([
    ["emma.settings.v1", JSON.stringify({ providers })],
    ["emma.threadDraft.v1.saved-thread", "kept draft"],
    ["emma.threadPins.v1", "old pins"],
    ["shinbo.threadPins.v1", "new pins"],
  ]);
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  let loaded: unknown;
  evaluate(source("boot.ts"), {
    exports: {},
    require: (name: string) => name.endsWith("legacy-storage") ? { copyLegacyStorage } : { SETTINGS_KEY: "shinbo.settings.v1" },
    location: { search: "" }, URLSearchParams, localStorage: storage, console, JSON,
    window: { shinbo: { request: () => Promise.resolve({}), setProviders: (value: unknown) => { loaded = value; return Promise.resolve(); } } },
  });
  assert.deepEqual(loaded, providers);
  assert.equal(values.get("shinbo.threadDraft.v1.saved-thread"), "kept draft");
  assert.equal(values.get("shinbo.threadPins.v1"), "new pins");
  assert.equal(values.get("emma.threadPins.v1"), "old pins");
  values.delete("shinbo.threadDraft.v1.saved-thread");
  copyLegacyStorage(storage);
  assert.equal(values.has("shinbo.threadDraft.v1.saved-thread"), false, "a deleted draft is not resurrected on every boot");
});

test("I3-01 legacy harness session mappings resume while current mappings take precedence", () => {
  const parsed = ts.createSourceFile("harness.ts", source("harness.ts"), ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "sessionIndex");
  assert.ok(declaration);
  for (const state of ["old", "both"]) {
    const home = mkdtempSync(path.join(tmpdir(), "shinbo-session-profile-"));
    try {
      writeFileSync(path.join(home, "emma-sessions.json"), JSON.stringify({ "saved-thread": "legacy-session" }));
      if (state === "both") writeFileSync(path.join(home, "shinbo-sessions.json"), JSON.stringify({ "saved-thread": "current-session" }));
      const load = evaluate(`(${declaration.getText(parsed)})`, { sessionIndexes: new Map(), SESSION_INDEX: "shinbo-sessions.json", readFileSync, existsSync, path, console }) as (home: string) => Map<string, string>;
      assert.equal(load(home).get("saved-thread"), state === "old" ? "legacy-session" : "current-session");
      assert.equal(JSON.parse(readFileSync(path.join(home, "emma-sessions.json"), "utf8"))["saved-thread"], "legacy-session");
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("an unreadable current data path is not silently replaced with an older directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shinbo-profile-errors-"));
  try {
    const current = path.join(root, "Shinbo");
    const previous = path.join(root, "Emma");
    writeFileSync(current, "not a directory");
    mkdirSync(previous);
    writeFileSync(path.join(previous, "kept.md"), "kept");
    assert.throws(() => preferredDataDirectory(current, [previous]));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
