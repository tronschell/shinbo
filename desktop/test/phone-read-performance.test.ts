import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { MAX_MEMORY_FILE_BYTES, resolveMemoryPath } from "../main/memory";
import { noteInVault, notesRoot } from "../main/vault";
import { MAX_NOTE_BYTES, type VaultChoice } from "../shared/vault";

const source = ts.createSourceFile("main.ts", readFileSync(path.join(__dirname, "../../main/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const helper = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "readLimitedText")!;

function reader(name: "readMemory" | "readNote", scope: Record<string, unknown>) {
  let branch: ts.CaseClause | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === name) branch = node;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(branch);
  const text = `${helper.getText(source)}\nreturn async (params) => { ${branch.statements.map((node) => node.getText(source)).join("\n")} };`;
  return Function(...Object.keys(scope), ts.transpile(text, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope)) as (params: { path: string }) => Promise<{ text: string; truncated: boolean }>;
}

test("phone memory and note reads open only the advertised prefix and preserve path checks", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "shinbo-phone-prefix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault: VaultChoice = { root, folder: "notes", kind: "folder", name: "test" };
  mkdirSync(path.join(root, vault.folder), { recursive: true });
  const prefix = "x".repeat(MAX_NOTE_BYTES);
  for (const file of [path.join(root, "large.md"), path.join(notesRoot(vault), "large.md")]) {
    writeFileSync(file, prefix);
    truncateSync(file, 128 * 1024 * 1024);
  }
  let readBytes = 0;
  let opened = 0;
  let closed = 0;
  const scope = {
    userData: root, path, resolveMemoryPath, memoryRoot: () => root,
    readVault: () => vault, notesRoot, noteInVault, MAX_MEMORY_FILE_BYTES, MAX_NOTE_BYTES,
    statSync: () => { throw new Error("synchronous stat"); },
    readFileSync: () => { throw new Error("unbounded synchronous read"); },
    open: async (file: string, flags: string) => {
      const handle = await open(file, flags);
      opened++;
      return {
        stat: () => handle.stat(),
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          const result = await handle.read(buffer, offset, length, position);
          readBytes += result.bytesRead;
          return result;
        },
        close: async () => { closed++; await handle.close(); },
      };
    },
  };
  const memory = reader("readMemory", scope);
  const note = reader("readNote", scope);
  assert.deepEqual(await memory({ path: "/memories/large.md" }), { text: prefix, truncated: true });
  assert.deepEqual(await note({ path: "large.md" }), { text: prefix, truncated: true });
  assert.equal(readBytes, MAX_NOTE_BYTES + MAX_MEMORY_FILE_BYTES);
  assert.equal(opened, 2);
  assert.equal(closed, 2);
  await assert.rejects(memory({ path: "/memories/../../outside.md" }), /outside/);
  await assert.rejects(note({ path: "../../outside.md" }), /not in your vault/);
  assert.equal(opened, 2);
  await assert.rejects(memory({ path: "/memories" }));
  assert.equal(opened, closed);
  writeFileSync(path.join(notesRoot(vault), "unicode.md"), `${"a".repeat(MAX_NOTE_BYTES - 1)}🦄`);
  assert.deepEqual(await note({ path: "unicode.md" }), { text: "a".repeat(MAX_NOTE_BYTES - 1), truncated: true });
  writeFileSync(path.join(notesRoot(vault), "small.md"), "\uFEFFsmall 🦄 note");
  assert.deepEqual(await note({ path: "small.md" }), { text: "\uFEFFsmall 🦄 note", truncated: false });
  writeFileSync(path.join(notesRoot(vault), "empty.md"), "");
  assert.deepEqual(await note({ path: "empty.md" }), { text: "", truncated: false });
});

test("bounded text reads complete short reads and close handles on failure", async () => {
  const bytes = Buffer.from("hello 🦄");
  let closed = 0;
  let fail = false;
  const scope = {
    open: async () => ({
      stat: async () => ({ size: bytes.length, isFile: () => true }),
      read: async (buffer: Buffer, offset: number, length: number, position: number) => {
        if (fail) throw new Error("read failed");
        return { bytesRead: bytes.copy(buffer, offset, position, position + Math.min(length, 2)) };
      },
      close: async () => { closed++; },
    }),
  };
  const read = Function(...Object.keys(scope), ts.transpile(`return ${helper.getText(source)};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope)) as (file: string, limit: number, message: string) => Promise<{ text: string; truncated: boolean }>;
  assert.deepEqual(await read("file", 100, "cannot read"), { text: "hello 🦄", truncated: false });
  assert.equal(closed, 1);
  fail = true;
  await assert.rejects(read("file", 100, "cannot read"), /read failed/);
  assert.equal(closed, 2);
});
