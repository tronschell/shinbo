import assert from "node:assert/strict";
import fs from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const sources = [process.argv[2] ?? "/tmp/shinbo-perf-wave3-workspace/desktop/main/main.ts", process.argv[3] ?? path.join(import.meta.dirname, "../main/main.ts")];
const root = fs.mkdtempSync(path.join(tmpdir(), "shinbo-phone-read-perf-"));
const file = path.join(root, "external-note.md");
const limit = 256 * 1024;
fs.writeFileSync(file, "x".repeat(limit));
fs.truncateSync(file, 256 * 1024 * 1024);
const results = {};
try {
  for (const [index, filename] of sources.entries()) {
    const source = ts.createSourceFile("main.ts", fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
    const helper = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "readLimitedText");
    let branch;
    const visit = (node) => {
      if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === "readNote") branch = node;
      else ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(branch);
    let readBytes = 0;
    const scope = {
      userData: root, path, readVault: () => ({}), notesRoot: () => root, noteInVault: (_vault, value) => value,
      MAX_NOTE_BYTES: limit, statSync: fs.statSync,
      readFileSync: (...args) => { const buffer = fs.readFileSync(...args); readBytes += buffer.length; return buffer; },
      open: async (...args) => {
        const handle = await open(...args);
        return {
          stat: () => handle.stat(),
          read: async (...values) => { const result = await handle.read(...values); readBytes += result.bytesRead; return result; },
          close: () => handle.close(),
        };
      },
    };
    const code = `${helper?.getText(source) ?? ""}\nreturn async (params) => { ${branch.statements.map((node) => node.getText(source)).join("\n")} };`;
    const read = Function(...Object.keys(scope), ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(scope));
    const rows = [];
    for (let sample = 0; sample < 5; sample++) {
      readBytes = 0;
      const start = performance.now();
      const timer = new Promise((resolve) => setTimeout(() => resolve(performance.now() - start), 0));
      const response = await read({ path: path.basename(file) });
      const ms = performance.now() - start;
      const timerDelayMs = await timer;
      assert.deepEqual(response, { text: "x".repeat(limit), truncated: true });
      if (index) assert.equal(readBytes, limit);
      rows.push({ ms, timerDelayMs, readBytes, responseBytes: Buffer.byteLength(response.text) });
    }
    results[index ? "fixed" : "baseline"] = Object.fromEntries(Object.keys(rows[0]).map((key) => [key, rows.map((row) => row[key]).sort((a, b) => a - b)[2]]));
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ sources, fileBytes: 256 * 1024 * 1024, limit, results }, null, 2));
