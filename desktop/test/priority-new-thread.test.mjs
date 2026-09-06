import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const button = source.match(/\{group\.id !== "pinned" && (<button type="button" className="project-new".*?<\/button>)\}/)?.[1];

test("priority reuses the new-thread action without filing into a virtual folder", () => {
  assert.ok(button);
  const emitted = ts.transpileModule(`const render = () => (${button});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: "h", target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [id, expected] of [["priority", undefined], ["unfiled", ""], ["folder-1", "folder-1"]]) {
    const calls = [];
    const render = new Function("h", "group", "uiBusy", "setError", "createThread", `${emitted}\nreturn render;`)(
      (type, props) => ({ type, props }), { id, name: id }, false, (error) => calls.push(error), (folder) => calls.push(folder),
    );
    const node = render();
    assert.equal(node.props.className, "project-new");
    assert.equal(node.props["aria-label"], id === "priority" ? "New thread" : `New thread in ${id}`);
    node.props.onClick({ preventDefault: () => calls.push("prevent"), stopPropagation: () => calls.push("stop") });
    assert.deepEqual(calls, ["prevent", "stop", "", expected]);
  }
});
