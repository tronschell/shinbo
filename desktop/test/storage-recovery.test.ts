import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { runMemoryCommand } from "../main/memory";
import { FolderStore } from "../main/folders";
import { applyNoteTags, createNoteFolder, keepNote, locateNote, moveNote, noteInVault, notesRoot, saveVault } from "../main/vault";
import { MAX_NOTE_BYTES, noteFolder } from "../shared/vault";
import * as vaultLimits from "../shared/vault";
import { symlinksAllowed } from "./symlinks";

const source = ts.createSourceFile("main.ts", fs.readFileSync(path.join(process.cwd(), "main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
function lifted(name: string, scope: Record<string, unknown>) {
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration);
  return Function(...Object.keys(scope), ts.transpile(`${declaration.getText(source)}\nreturn ${name};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}

function directory(t: test.TestContext) {
  const base = fs.mkdtempSync(path.join(tmpdir(), "shinbo-storage-recovery-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}

test("S1 simultaneous memory edits preserve every acknowledged replacement", async (t) => {
  const base = directory(t);
  const count = 12;
  const original = Array.from({ length: count }, (_, index) => `entry${index}=old`).join("\n");
  fs.writeFileSync(path.join(base, "facts.md"), original);
  const results = await Promise.all(Array.from({ length: count }, (_, index) => runMemoryCommand(base, { command: "str_replace", path: "/memories/facts.md", old_str: `entry${index}=old`, new_str: `entry${index}=new` })));
  const text = fs.readFileSync(path.join(base, "facts.md"), "utf8");
  const retained = text.match(/=new/g)?.length ?? 0;
  t.diagnostic(`acknowledged=${results.length}; retained=${retained}/${count}`);
  assert.equal(retained, count);
});

test("S2 a partial memory write failure preserves the original durable file", async (t) => {
  const base = directory(t);
  const file = path.join(base, "facts.md");
  const original = "Remember the original project decisions.";
  fs.writeFileSync(file, original);
  const write = fsp.writeFile;
  t.mock.method(fsp, "writeFile", async (target: Parameters<typeof write>[0], data: Parameters<typeof write>[1], options: Parameters<typeof write>[2]) => {
    await write(target, String(data).slice(0, 4), options);
    throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
  });
  await assert.rejects(runMemoryCommand(base, { command: "str_replace", path: "/memories/facts.md", old_str: "original", new_str: "updated" }), /ENOSPC/);
  t.diagnostic(`originalBytes=${Buffer.byteLength(original)}; retainedBytes=${fs.statSync(file).size}`);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("S2 a partial Revert write failure preserves the current project file", (t) => {
  const base = directory(t);
  const project = path.join(base, "project");
  fs.mkdirSync(project);
  const store = new FolderStore(base);
  const [grant] = store.add(project);
  const file = path.join(project, "file.txt");
  const original = "Current user edits that must survive an unsuccessful revert.";
  fs.writeFileSync(file, original);
  const write = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (target: Parameters<typeof write>[0], data: Parameters<typeof write>[1], options: Parameters<typeof write>[2]) => {
    write(target, String(data).slice(0, 4), options);
    throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
  });
  assert.throws(() => store.write(grant.id, "file.txt", "Previously recorded file contents"), /ENOSPC/);
  t.diagnostic(`originalBytes=${Buffer.byteLength(original)}; retainedBytes=${fs.statSync(file).size}`);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("S3 a maximum accepted note can be reopened through the actual read-note handler", async (t) => {
  const base = directory(t);
  const vault = saveVault(base, { root: base, folder: "knowledge", kind: "folder", name: "Notes" });
  const note = await keepNote(vault, { kind: "note", title: "Long note", text: "a".repeat(MAX_NOTE_BYTES) });
  let handler: ((event: unknown, value: string) => string) | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "ipcMain.handle" && node.arguments[0]?.getText(source) === '"shinbo:read-note"') {
      const scope = { panelSender() {}, readVault: () => vault, app: { getPath: () => base }, path, notesRoot, noteInVault, statSync: fs.statSync, readFileSync: fs.readFileSync, ...vaultLimits };
      handler = Function(...Object.keys(scope), ts.transpile(`return (${node.arguments[1].getText(source)});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(handler);
  const text = handler({}, note.relative);
  t.diagnostic(`bodyBytes=${MAX_NOTE_BYTES}; storedBytes=${fs.statSync(note.path).size}; readableBytes=${Buffer.byteLength(text)}`);
  assert.ok(text.includes("a".repeat(MAX_NOTE_BYTES)));
});

test("S4 background tagging preserves edits made in Obsidian while the tagger was running", async (t) => {
  const base = directory(t);
  const vault = saveVault(base, { root: base, folder: "knowledge", kind: "folder", name: "Notes" });
  const note = await keepNote(vault, { kind: "note", title: "Draft", text: "My original note" });
  let reply!: (value: { title: string; tags: string[] }) => void;
  const tagging = new Promise<{ title: string; tags: string[] }>((resolve) => { reply = resolve; });
  const tag = lifted("tagKeptNote", { readFileSync: fs.readFileSync, locateNote, tagNote: () => tagging, tagger: {}, applyNoteTags, fireEvent() {}, notesChanged() {}, console: { warn() {}, error() {} } });
  const running = tag(note, "My original note");
  const edited = fs.readFileSync(note.path, "utf8").replace('title: "Draft"', 'title: "My chosen title"\nrelated:\n  - "[[Important project]]"');
  fs.writeFileSync(path.join(noteFolder(vault), note.relative), edited);
  reply({ title: "Model suggestion", tags: ["automatic"] });
  await running;
  const text = fs.readFileSync(note.path, "utf8");
  t.diagnostic(`retainedUserTitle=${text.includes('title: "My chosen title"')}; retainedRelatedNote=${text.includes('  - "[[Important project]]"')}`);
  assert.equal(text, edited);
});

test("S1 a failed memory edit does not block the next queued edit", async (t) => {
  const base = directory(t);
  fs.writeFileSync(path.join(base, "facts.md"), "old");
  const failed = runMemoryCommand(base, { command: "str_replace", path: "/memories/facts.md", old_str: "absent", new_str: "wrong" });
  const next = runMemoryCommand(base, { command: "str_replace", path: "/memories/facts.md", old_str: "old", new_str: "new" });
  await assert.rejects(failed, /No replacement/);
  await next;
  assert.equal(fs.readFileSync(path.join(base, "facts.md"), "utf8"), "new");
});

test("S2 atomic edits preserve ordinary file links and executable permissions", async (t) => {
  if (!symlinksAllowed()) return;
  const base = directory(t);
  const project = path.join(base, "project");
  fs.mkdirSync(project);
  const store = new FolderStore(base);
  const [grant] = store.add(project);
  const file = path.join(project, "script.sh");
  const link = path.join(project, "linked.sh");
  fs.writeFileSync(file, "original");
  fs.chmodSync(file, 0o764);
  const mode = fs.statSync(file).mode & 0o777;
  fs.symlinkSync(file, link);
  store.write(grant.id, "linked.sh", "reverted");
  assert.equal(fs.readFileSync(file, "utf8"), "reverted");
  assert.equal(fs.statSync(file).mode & 0o777, mode);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  await runMemoryCommand(project, { command: "str_replace", path: "/memories/linked.sh", old_str: "reverted", new_str: "remembered" });
  assert.equal(fs.readFileSync(file, "utf8"), "remembered");
  assert.equal(fs.statSync(file).mode & 0o777, mode);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
});

test("S4 an untouched newly kept note still receives its automatic title and tags", async (t) => {
  const base = directory(t);
  const vault = saveVault(base, { root: base, folder: "knowledge", kind: "folder", name: "Notes" });
  const note = await keepNote(vault, { kind: "note", title: "Draft", text: "My original note" });
  const events: string[] = [];
  const tag = lifted("tagKeptNote", { readFileSync: fs.readFileSync, locateNote, tagNote: async () => ({ title: "Useful title", tags: ["project"] }), tagger: {}, applyNoteTags, fireEvent: (name: string) => events.push(name), notesChanged() {}, console });
  await tag(note, "My original note");
  const text = fs.readFileSync(note.path, "utf8");
  assert.match(text, /title: "Useful title"/);
  assert.match(text, /tags: \["project"\]/);
  assert.deepEqual(events, ["note-kept"]);

  const filed = await keepNote(vault, { kind: "note", title: "Filed", text: "Moved while tagging" });
  createNoteFolder(vault, "Projects");
  let reply!: (value: { title: string; tags: string[] }) => void;
  const tagging = new Promise<{ title: string; tags: string[] }>((resolve) => { reply = resolve; });
  const tagMoved = lifted("tagKeptNote", { readFileSync: fs.readFileSync, locateNote, tagNote: () => tagging, tagger: {}, applyNoteTags, fireEvent: (name: string) => events.push(name), notesChanged() {}, console });
  const running = tagMoved(filed, "Moved while tagging");
  const moved = moveNote(vault, filed.relative, "Projects");
  reply({ title: "Filed title", tags: ["filed"] });
  await running;
  assert.equal(fs.existsSync(filed.path), false);
  assert.match(fs.readFileSync(path.join(notesRoot(vault), moved), "utf8"), /title: "Filed title"/);
  assert.deepEqual(events, ["note-kept", "note-kept"]);
});
