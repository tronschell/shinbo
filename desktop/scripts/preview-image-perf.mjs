import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { app, nativeImage } from "electron";

const load = createRequire(import.meta.url);
const moduleFile = process.env.SHINBO_IMAGE_MODULE || path.resolve(import.meta.dirname, "../dist-main/main/attachments.js");
const { attachmentImage, attachmentPreview } = load(moduleFile);
const { compressScreenFrame } = load(path.join(path.dirname(moduleFile), "computer.js"));
const { pathInside } = load(path.join(path.dirname(moduleFile), "platform.js"));
const file = process.env.SHINBO_IMAGE_FIXTURE;
assert.ok(file, "Set SHINBO_IMAGE_FIXTURE to a disposable photo");
const root = mkdtempSync(path.join(tmpdir(), "shinbo-preview-perf-"));
app.setPath("userData", root);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sources = [["after", path.resolve(import.meta.dirname, "../main/main.ts")]];
if (process.env.SHINBO_IMAGE_BASELINE_SOURCE) sources.unshift(["before", process.env.SHINBO_IMAGE_BASELINE_SOURCE]);
const modes = sources.map(([mode, sourcePath]) => {
  const source = ts.createSourceFile("main.ts", readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true);
  const named = (name) => source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name).getText(source);
  let imageCase;
  function walk(node) {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === "readImage") imageCase = node.statements.map((statement) => statement.getText(source)).join("\n");
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.ok(imageCase);
  const bindings = { nativeImage, attachmentImage, attachmentPreview, PREVIEW_IMAGE_WIDTH: 1600, grantedImage: (_thread, _folder, file) => file, compressScreenFrame, namedPath: (file) => file, folders: { list: () => [{ path: path.dirname(file) }] }, attachments: { holds: () => false }, pathInside };
  const code = `${named("previewImage")}\n${named("folderImage")}\nreturn { preview: previewImage, vision: (file) => folderImage("fixture", "fixture", file), phone: async (file) => { const params = { path: file }; ${imageCase} } };`;
  return [mode, new Function(...Object.keys(bindings), ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(bindings))];
});

app.whenReady().then(async () => {
  for (const task of ["preview", "vision", "phone"]) for (let run = 0; run < 4; run++) for (const [mode, methods] of modes) {
    let previous = performance.now(), maxGap = 0;
    const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - previous); previous = now; }, 1);
    await pause(10);
    const start = performance.now();
    const result = await methods[task](file);
    const elapsed = performance.now() - start;
    await pause(10);
    clearInterval(timer);
    const image = task === "phone" ? nativeImage.createFromBuffer(Buffer.from(result.base64, "base64")) : nativeImage.createFromDataURL(result);
    assert.deepEqual(image.getSize(), task === "preview" ? { width: 1600, height: 1200 } : { width: 1440, height: 1080 });
    if (task !== "preview") assert.ok((task === "phone" ? result.base64 : result).length < 1_500_000);
    console.log(JSON.stringify({ task, mode, run, elapsed, maxGap, size: image.getSize() }));
  }
  for (const [mode, methods] of modes) {
    assert.equal(await methods.preview(path.join(path.dirname(file), "missing.png")), null);
    await assert.rejects(async () => methods.vision(path.join(path.dirname(file), "missing.png")), /could not read/);
    await assert.rejects(async () => methods.phone(path.join(root, "not-granted.png")), /Not an image/);
    console.log(JSON.stringify({ mode, verified: ["missing preview", "invalid vision image", "ungranted phone path"] }));
  }
}).finally(() => rmSync(root, { recursive: true, force: true })).then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
