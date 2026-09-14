import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { FolderStore } from "../main/folders";
import { isImageAttachment } from "../main/attachments";
import { pathInside, realPath, realPathInside } from "../main/platform";
import { contextBlock, MAX_BLOB_BYTES, MAX_FILE_BYTES, MAX_FOLDER_COUNT, MAX_FOLDER_FILES, MAX_FOLDER_PATHS, MAX_OPEN_BYTES, mergeSkillContext, slashName } from "../shared/folders";
import { mentions, pathName } from "../shared/slash";
import { NO_SYMLINKS, symlinksAllowed } from "./symlinks";

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "shinbo-folders-"));
  const project = path.join(root, "project");
  mkdirSync(path.join(project, "notes"), { recursive: true });
  mkdirSync(path.join(project, "node_modules"), { recursive: true });
  mkdirSync(path.join(project, "dist-main"), { recursive: true });
  mkdirSync(path.join(project, "dist-renderer"), { recursive: true });
  mkdirSync(path.join(project, "zig-out"), { recursive: true });
  writeFileSync(path.join(project, "readme.md"), "# hello");
  writeFileSync(path.join(project, "notes", "plan.txt"), "plan");
  writeFileSync(path.join(project, "photo.heic"), "binary");
  writeFileSync(path.join(project, "node_modules", "dep.js"), "skip me");
  writeFileSync(path.join(project, "dist-main", "main.js"), "skip me");
  writeFileSync(path.join(project, "dist-renderer", "bundle.js"), "skip me");
  writeFileSync(path.join(project, "zig-out", "helper.js"), "skip me");
  writeFileSync(path.join(root, "secret.md"), "outside the grant");
  return { root, project, store: new FolderStore(root) };
}

test("a grant lists its text files and skips generated, vendored, and non-text ones", async () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  assert.deepEqual((await store.files(grant.id)).files.map((file) => file.path), [path.join("notes", "plan.txt"), "readme.md"]);
  assert.equal((await store.files(grant.id)).total, 2);
  assert.equal((await store.files(grant.id)).capped, false);
  assert.equal(store.read(grant.id, "readme.md").text, "# hello");
});

test("a capped listing still counts every file it walked past", async () => {
  const { project, store } = workspace();
  const many = path.join(project, "many");
  mkdirSync(many, { recursive: true });
  for (let index = 0; index < MAX_FOLDER_FILES + 20; index += 1) writeFileSync(path.join(many, `mod${index}.ts`), "export const v = 1;");
  const [grant] = store.add(project);
  const listing = await store.files(grant.id);
  assert.equal(listing.files.length, MAX_FOLDER_FILES);
  assert.equal(listing.total, MAX_FOLDER_FILES + 22);
  assert.equal(listing.capped, false);
});

test("the total counts only files the listing would accept, on both sides of the cap", async () => {
  const { project, store } = workspace();
  for (let bucket = 0; bucket < 30; bucket += 1) {
    const directory = path.join(project, `bucket${bucket}`);
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 20; index += 1) writeFileSync(path.join(directory, `mod${index}.ts`), "export const v = 1;");
    const oversized = path.join(directory, "oversized.ts");
    writeFileSync(oversized, "");
    truncateSync(oversized, MAX_FILE_BYTES + 1);
  }
  const [grant] = store.add(project);
  const listing = await store.files(grant.id);
  assert.equal(listing.files.length, MAX_FOLDER_FILES);
  assert.equal(listing.files.some((file) => file.bytes > MAX_FILE_BYTES), false);
  assert.equal(listing.total, 602);
});

test("the walk stops at MAX_FOLDER_COUNT instead of reading the whole tree", async () => {
  const { project, store } = workspace();
  for (let bucket = 0; bucket < 6; bucket += 1) {
    const directory = path.join(project, `bucket${bucket}`);
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 400; index += 1) writeFileSync(path.join(directory, `mod${index}.ts`), "export const v = 1;");
  }
  const [grant] = store.add(project);
  const listing = await store.files(grant.id);
  assert.equal(listing.total, MAX_FOLDER_COUNT);
  assert.equal(listing.capped, true);
  assert.equal(listing.files.length, MAX_FOLDER_FILES);
});

test("a missing optional file reads as empty rather than throwing", () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  assert.deepEqual(store.read(grant.id, "AGENTS.md"), { path: "AGENTS.md", text: "", missing: true });
});

test("a read cannot escape the granted folder, and an unknown grant is refused", () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  assert.throws(() => store.read(grant.id, "../secret.md"));
  assert.throws(() => store.read("not-a-grant", "readme.md"));
});



test("a directory listing sorts folders first, ignores case, and cannot leave the grant", async (context) => {
  const { root, project, store } = workspace();
  mkdirSync(path.join(project, "Zed"));
  writeFileSync(path.join(project, "Alpha.md"), "alpha");
  const [grant] = store.add(project);
  const listed = await store.entries(grant.id, "");
  assert.deepEqual(listed.map((entry) => entry.name), ["dist-main", "dist-renderer", "node_modules", "notes", "Zed", "zig-out", "Alpha.md", "photo.heic", "readme.md"]);
  assert.deepEqual(listed.map((entry) => entry.kind), ["dir", "dir", "dir", "dir", "dir", "dir", "file", "file", "file"]);
  assert.deepEqual(await store.entries(grant.id, "."), listed);
  assert.deepEqual(await store.entries(grant.id, "notes"), [{ name: "plan.txt", kind: "file", bytes: 4 }]);
  await assert.rejects(store.entries(grant.id, ".."), /outside the granted folder/);
  await assert.rejects(store.entries(grant.id, path.join("..", "secret.md")), /outside the granted folder/);
  await assert.rejects(store.entries("not-a-grant", ""), /no longer connected/);
  if (!symlinksAllowed()) return context.skip(NO_SYMLINKS);
  symlinkSync(root, path.join(project, "door"));
  await assert.rejects(store.entries(grant.id, "door"), /outside the granted folder/);
});

test("a blob preview is limited to images inside the grant", () => {
  const { root, project, store } = workspace();
  writeFileSync(path.join(project, "chart.png"), "inside");
  writeFileSync(path.join(project, "shot.JPG"), "inside");
  writeFileSync(path.join(root, "private.png"), "outside");
  const [grant] = store.add(project);
  assert.deepEqual(store.blob(grant.id, "chart.png"), { path: "chart.png", mime: "image/png", dataUrl: `data:image/png;base64,${Buffer.from("inside").toString("base64")}`, bytes: 6 });
  assert.equal(store.blob(grant.id, "shot.JPG").mime, "image/jpeg");
  assert.throws(() => store.blob(grant.id, "readme.md"), /cannot be previewed here/);
  assert.throws(() => store.blob(grant.id, "notes"), /cannot be previewed here/);
  assert.throws(() => store.blob(grant.id, path.join("..", "private.png")), /outside the granted folder/);
  const oversized = path.join(project, "huge.png");
  writeFileSync(oversized, "");
  truncateSync(oversized, MAX_BLOB_BYTES + 1);
  assert.throws(() => store.blob(grant.id, "huge.png"), /previews images up to/);
});

test("a write round-trips through the grant and reports what it replaced", () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  assert.deepEqual(store.write(grant.id, path.join("notes", "plan.txt"), "plan b"), { path: path.join("notes", "plan.txt"), before: "plan" });
  assert.equal(store.read(grant.id, path.join("notes", "plan.txt")).text, "plan b");
  assert.deepEqual(store.write(grant.id, path.join("notes", "fresh.md"), "new"), { path: path.join("notes", "fresh.md"), before: null });
  assert.equal(readFileSync(path.join(project, "notes", "fresh.md"), "utf8"), "new");
  assert.throws(() => store.write(grant.id, path.join("..", "secret.md"), "nope"), /outside the granted folder/);
  assert.equal(store.write(grant.id, "readme.md", "x".repeat(MAX_OPEN_BYTES)).before, "# hello");
  assert.throws(() => store.write(grant.id, "readme.md", "x".repeat(MAX_OPEN_BYTES + 1)), /at most/);
});

test("a write with the text the editor loaded refuses to clobber an edit made elsewhere", () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  assert.deepEqual(store.write(grant.id, "readme.md", "# mine", "# hello"), { path: "readme.md", before: "# hello" });
  assert.throws(() => store.write(grant.id, "readme.md", "# later", "# hello"), /changed on disk/);
  assert.equal(readFileSync(path.join(project, "readme.md"), "utf8"), "# mine");
  assert.deepEqual(store.write(grant.id, path.join("notes", "fresh.md"), "new", ""), { path: path.join("notes", "fresh.md"), before: null });
  assert.throws(() => store.write(grant.id, path.join("notes", "gone.md"), "new", "was here"), /changed on disk/);
  assert.equal(existsSync(path.join(project, "notes", "gone.md")), false);
});

test("listing a path that is not a folder says so without naming the disk location", async () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  await assert.rejects(store.entries(grant.id, "readme.md"), (error: Error) => {
    assert.match(error.message, /not a folder/);
    assert.equal(error.message.includes(project), false);
    return true;
  });
  await assert.rejects(store.entries(grant.id, "nowhere"), /not a folder/);
});

test("the path walk reaches every file the listing caps away, and stays inside its budget", async () => {
  const { project, store } = workspace();
  mkdirSync(path.join(project, ".config"), { recursive: true });
  mkdirSync(path.join(project, ".git"), { recursive: true });
  writeFileSync(path.join(project, ".config", "app.conf"), "deep");
  writeFileSync(path.join(project, ".git", "HEAD"), "ref");
  let deep = project;
  for (let level = 0; level < 14; level += 1) {
    deep = path.join(deep, `level${level}`);
    mkdirSync(deep, { recursive: true });
    writeFileSync(path.join(deep, `file${level}.bin`), "x");
  }
  const [grant] = store.add(project);
  const { paths: listed, capped } = await store.paths(grant.id);
  assert.deepEqual(listed, [...listed].sort());
  assert.ok(listed.includes(".config/app.conf"));
  assert.ok(listed.includes("photo.heic"));
  assert.ok(listed.includes("notes/plan.txt"));
  assert.equal(listed.some((file) => file.startsWith(".git/")), false);
  assert.equal(listed.some((file) => file.startsWith("node_modules/")), false);
  assert.equal(listed.some((file) => file.includes("level12")), false);
  assert.ok(listed.includes("level0/level1/level2/level3/level4/level5/level6/level7/level8/level9/level10/level11/file11.bin"));
  assert.ok(listed.length <= MAX_FOLDER_PATHS);
  assert.equal(capped, false);
  await assert.rejects(store.paths("not-a-grant"), /no longer connected/);
});

test("the folder itself is a path inside the grant, and cannot be climbed out of", () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  assert.equal(store.within(grant.id, "."), ".");
  assert.equal(path.join(store.directory(grant.id), store.within(grant.id, ".")), store.directory(grant.id));
  assert.throws(() => store.within(grant.id, "../secret.md"));
});

test("adding the same folder twice keeps one grant, and forgetting drops it", () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  assert.equal(store.add(project).length, 1);
  assert.deepEqual(store.remove(grant.id), []);
});

test("the context block drops whole sections once its budget is gone", () => {
  const block = contextBlock([{ heading: "One", body: "a".repeat(50) }, { heading: "Two", body: "b".repeat(500) }], 200);
  assert.match(block, /## One/);
  assert.doesNotMatch(block, /## Two/);
  assert.match(block, /1 more attachment omitted/);
  assert.equal(contextBlock([]), "");
});

test("an oversized section is truncated to the remaining budget and says so", () => {
  const block = contextBlock([{ heading: "Log", body: "x".repeat(2000) }, { heading: "Rows", body: "y".repeat(2000) }], 1000);
  assert.ok(block.length <= 1000, String(block.length));
  const kept = Number(/\(truncated at (\d+) chars\)/.exec(block)?.[1]);
  assert.ok(kept >= 256 && kept < 2000, String(kept));
  assert.match(block, new RegExp(`## Log\\nx{${kept}}\\n\\(truncated at ${kept} chars\\)`));
  assert.doesNotMatch(block, /## Rows/);
  assert.match(block, /1 more attachment omitted/);
  const whole = contextBlock([{ heading: "Small", body: "ok" }]);
  assert.match(whole, /## Small\nok$/);
  assert.doesNotMatch(whole, /truncated/);
});

test("merged context stays inside the host's skill-context ceiling", () => {
  assert.equal(mergeSkillContext("files", "skill"), "files\n\nskill");
  assert.ok(new TextEncoder().encode(mergeSkillContext("x".repeat(90_000), "y".repeat(90_000))).length <= 64 * 1024);
});

test("a slash name is one word in the command alphabet", () => {
  assert.equal(slashName("notes/my plan (final).md"), "my-plan-final-.md");
  assert.equal(slashName("///"), "file");
});

const mainSource = ts.createSourceFile("main.ts", readFileSync(path.join(__dirname, "../../main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);

function mainFunction(name: string): string {
  const declaration = mainSource.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(mainSource);
}

function mainHandler(channel: string): string {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(mainSource) === "ipcMain.handle" && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === channel) found = node.arguments[1];
    else ts.forEachChild(node, visit);
  };
  visit(mainSource);
  assert.ok(found, channel);
  return found.getText(mainSource);
}

function pathHandlers() {
  const root = mkdtempSync(path.join(tmpdir(), "shinbo-preview-"));
  const project = path.join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, "chart.png"), "inside");
  if (symlinksAllowed()) {
    symlinkSync(path.join(root, "private.png"), path.join(project, "escape.png"));
    symlinkSync(path.join(root, "secret.md"), path.join(project, "escape.md"));
  }
  writeFileSync(path.join(project, "readme.md"), "# inside");
  writeFileSync(path.join(root, "private.png"), "outside");
  writeFileSync(path.join(root, "secret.md"), "outside");
  const attached = path.join(root, "dropped.png");
  writeFileSync(attached, "dropped");
  const previewed: string[] = [];
  const revealed: string[] = [];
  const scope = {
    folders: { list: () => [{ id: "grant-1", path: project }], read: (_id: string, relative: string) => ({ text: readFileSync(path.join(project, relative), "utf8") }) },
    attachments: { holds: (file: string) => file === attached },
    pathInside,
    realPath,
    realPathInside,
    isImageAttachment,
    previewImage: (file: string) => { previewed.push(file); return "data:image/png;base64,MARKER"; },
    mainWindowSender: () => undefined,
    reconnectVault: () => undefined,
    shell: { showItemInFolder: (file: string) => revealed.push(file) },
    statSync,
    readFileSync,
    existsSync,
    homedir: () => root,
    path,
    MAX_FILE_BYTES: 1024 * 1024,
    capabilities: {
      previewSkill: async (name: string) => name === "bro" ? { path: path.join(root, "skills", "bro", "SKILL.md"), text: "# Bro" } : null,
    },
  };
  const code = ts.transpile(`${mainFunction("namedPath")}\n${mainFunction("pathGrant")}\nreturn { preview: ${mainHandler("shinbo:preview-path")}, reveal: ${mainHandler("shinbo:reveal-path")} };`, { target: ts.ScriptTarget.ES2022 });
  const handlers = Function(...Object.keys(scope), code)(...Object.values(scope)) as {
    preview: (event: unknown, value: unknown) => Promise<{ path: string; text: string | null; image?: string | null } | null>;
    reveal: (event: unknown, value: unknown) => boolean;
  };
  return { root, project, attached, previewed, revealed, ...handlers };
}

test("a preview reads imported slash skills and granted files without opening arbitrary paths", async () => {
  const { root, project, attached, previewed, preview } = pathHandlers();
  assert.deepEqual(await preview(null, "/bro"), { path: path.join(root, "skills", "bro", "SKILL.md"), text: "# Bro" });
  assert.deepEqual(await preview(null, path.join(project, "chart.png")), { path: path.join(project, "chart.png"), text: null, image: "data:image/png;base64,MARKER" });
  assert.deepEqual(await preview(null, path.join(project, "readme.md")), { path: path.join(project, "readme.md"), text: "# inside" });
  assert.deepEqual(await preview(null, attached), { path: attached, text: null, image: "data:image/png;base64,MARKER" });
  assert.deepEqual(previewed, [path.join(project, "chart.png"), attached]);

  for (const outside of [path.join(root, "private.png"), path.join(root, "secret.md")]) {
    assert.deepEqual(await preview(null, outside), { path: outside, text: null }, outside);
  }
  assert.deepEqual(await preview(null, "~/private.png"), { path: path.join(root, "private.png"), text: null });
  assert.equal(await preview(null, path.join(root, "nothing.png")), null);
  assert.deepEqual(previewed, [path.join(project, "chart.png"), attached]);
});

test("revealing a path in the file manager asks the same grant question", () => {
  const { root, project, attached, revealed, reveal } = pathHandlers();
  assert.equal(reveal(null, path.join(project, "readme.md")), true);
  assert.equal(reveal(null, attached), true);
  assert.equal(reveal(null, path.join(root, "secret.md")), false);
  assert.equal(reveal(null, path.join(root, "private.png")), false);
  assert.deepEqual(revealed, [path.join(project, "readme.md"), attached]);
});

test("a symlink inside a grant is not a way out of it", async (context) => {
  if (!symlinksAllowed()) return context.skip(NO_SYMLINKS);
  const { root, project, previewed, preview, reveal } = pathHandlers();
  const escapePng = path.join(project, "escape.png");
  const escapeMd = path.join(project, "escape.md");
  assert.equal(realPath(escapePng), path.join(realPath(root)!, "private.png"));
  assert.equal(pathInside(project, escapePng), true);
  assert.equal(realPathInside(project, escapePng), false);

  assert.deepEqual(await preview(null, escapePng), { path: escapePng, text: null });
  assert.deepEqual(await preview(null, escapeMd), { path: escapeMd, text: null });
  assert.deepEqual(previewed, []);
  assert.equal(reveal(null, escapePng), false);
  assert.equal(reveal(null, escapeMd), false);
});

test("a grant refuses a symlinked leaf for reads, writes and editor opens", (context) => {
  if (!symlinksAllowed()) return context.skip(NO_SYMLINKS);
  const { root, project, store } = workspace();
  const outside = path.join(root, "secret.md");
  symlinkSync(outside, path.join(project, "escape.md"));
  symlinkSync(root, path.join(project, "door"));
  const [grant] = store.add(project);
  for (const escape of ["escape.md", "door/secret.md"]) {
    assert.throws(() => store.read(grant.id, escape), /outside the granted folder/, escape);
    assert.throws(() => store.within(grant.id, escape), /outside the granted folder/, escape);
    assert.throws(() => store.fileWithin(grant.id, escape), /outside the granted folder/, escape);
    assert.throws(() => store.write(grant.id, escape, "overwritten"), /outside the granted folder/, escape);
  }
  assert.equal(readFileSync(outside, "utf8"), "outside the grant");
  assert.equal(store.fileWithin(grant.id, "readme.md"), path.join(realPath(project)!, "readme.md"));
  assert.equal(store.fileWithin(grant.id, path.join(project, "readme.md")), path.join(realPath(project)!, "readme.md"));
  assert.throws(() => store.fileWithin(grant.id, outside), /outside the granted folder/);
});

function visionImage() {
  const { root, project, store } = workspace();
  writeFileSync(path.join(project, "chart.png"), "inside");
  writeFileSync(path.join(root, "private.png"), "outside");
  symlinkSync(path.join(root, "private.png"), path.join(project, "escape.png"));
  const attached = path.join(root, "dropped.png");
  writeFileSync(attached, "dropped");
  const [grant] = store.add(project);
  const asked: string[] = [];
  const optional = (name: string) => mainSource.statements.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === name) ? mainFunction(name) : "";
  const scope = {
    folders: store,
    attachments: { holds: (file: string) => file === attached },
    grantFor: () => grant.id,
    attachmentImage: async (file: string) => { asked.push(file); return { isEmpty: () => false }; },
    compressScreenFrame: () => ({ image: "data:image/jpeg;base64,MARKER" }),
    realPath,
    path,
  };
  const code = ts.transpile(`${optional("grantedImage")}\nreturn ${mainFunction("folderImage")};`, { target: ts.ScriptTarget.ES2022 });
  const look = Function(...Object.keys(scope), code)(...Object.values(scope)) as (threadId: string, named: string | undefined, relative: string) => Promise<string>;
  return { root, project, attached, asked, look };
}

test("the vision tool is bound by the same grants as every other door", async (context) => {
  if (!symlinksAllowed()) return context.skip(NO_SYMLINKS);
  const { root, project, attached, asked, look } = visionImage();
  for (const escape of [path.join(root, "private.png"), path.join(project, "escape.png"), "../private.png", "/etc/hosts"]) {
    await assert.rejects(look("thread", undefined, escape), /outside the granted folder/, escape);
  }
  assert.deepEqual(asked, [], "the vision tool read a file outside every grant");

  assert.equal(await look("thread", undefined, "chart.png"), "data:image/jpeg;base64,MARKER");
  assert.equal(await look("thread", undefined, path.join(project, "chart.png")), "data:image/jpeg;base64,MARKER");
  assert.equal(await look("thread", undefined, attached), "data:image/jpeg;base64,MARKER");
  assert.deepEqual(asked, [path.join(realPath(project)!, "chart.png"), path.join(realPath(project)!, "chart.png"), attached]);
});

test("folder listing yields to the event loop before scanning file metadata", async () => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  let completed = false;
  const reading = store.files(grant.id).then((listing) => { completed = true; return listing; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  const listing = await reading;
  assert.equal(listing.total, 2);
});

test("oversized and non-text entries cannot bypass the folder traversal budget", async (t) => {
  const { project, store } = workspace();
  const [grant] = store.add(project);
  let inspected = 0;
  let directories = 0;
  t.mock.method(fsPromises, "readdir", async (directory: unknown) => {
    directories++;
    return directory === realPath(project) ? Array.from({ length: MAX_FOLDER_COUNT * 20 }, (_, index) =>
      ({ name: `entry-${index}.${index % 3 === 1 ? "ts" : "bin"}`, isDirectory: () => index % 3 === 0, isFile: () => index % 3 !== 0 }) as Dirent) : [];
  });
  t.mock.method(fsPromises, "stat", async () => { inspected++; return { size: MAX_FILE_BYTES + 1 } as Stats; });
  const listing = await store.files(grant.id);
  assert.deepEqual(listing, { files: [], total: 0, capped: true });
  assert.ok(inspected <= MAX_FOLDER_COUNT * 8 / 3 + 1);
  assert.ok(directories <= MAX_FOLDER_COUNT * 8 / 3 + 2);
});

test("one prompt reuses folder and note listings but a later prompt refreshes them", async () => {
  const { root, project, store } = workspace();
  store.add(project);
  let folderScans = 0;
  let noteScans = 0;
  const scope = {
    mentions, pathName, contextBlock,
    app: { getPath: () => root },
    listArtifacts: async () => [],
    readVault: () => ({}),
    listNotes: async () => { noteScans++; return []; },
    folders: {
      list: () => store.list(),
      files: (id: string) => { folderScans++; return store.files(id); },
      read: (id: string, relative: string) => store.read(id, relative),
    },
  };
  const resolve = Function(...Object.keys(scope), ts.transpile(`return ${mainFunction("resolveMentions")};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope)) as (prompt: string) => Promise<{ content: string }>;
  const prompt = `Read @readme.md and @${pathName(path.join("notes", "plan.txt"))} and @missing.txt`;
  const first = await resolve(prompt);
  assert.equal(folderScans, 1);
  assert.equal(noteScans, 1);
  assert.match(first.content, /# hello/);
  assert.match(first.content, /File project\/notes[/\\]plan.txt/);
  assert.equal(first.content.includes("Could not be read"), false);
  writeFileSync(path.join(project, "missing.txt"), "newly available");
  const next = await resolve(prompt);
  assert.equal(folderScans, 2);
  assert.equal(noteScans, 2);
  assert.match(next.content, /newly available/);
});
