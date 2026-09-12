import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = (path, dependencies = require) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, dependencies);
  return exports;
};
const agents = compile("../shared/agents.ts");
const { ChangeDiff } = compile("../src/diff.tsx", (name) => name === "../shared/agents" ? agents : require(name));
const render = (before, after) => renderToStaticMarkup(React.createElement(ChangeDiff, { before, after }));

test("changes stay visible while leading, middle and trailing context folds independently", () => {
  const html = render("top\nold\nmiddle\nremove\nbottom", "top\nnew\nmiddle\nbottom");
  assert.equal((html.match(/<details /g) ?? []).length, 3);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  const visible = html.replace(/<details\b[\s\S]*?<\/details>/g, "");
  for (const line of ["-old", "+new", "-remove"]) assert.ok(visible.includes(line));
  for (const line of ["top", "middle", "bottom"]) assert.ok(!visible.includes(line));
  assert.match(html, /aria-label="Unchanged lines: 1 — toggle context"/);
  assert.doesNotMatch(render("", "new"), /<details/);
  assert.doesNotMatch(render("old", ""), /<details/);
  assert.doesNotMatch(render("", ""), /<details/);
});
