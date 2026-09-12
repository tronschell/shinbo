import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = ts.createSourceFile("task-list.tsx", readFileSync(new URL("../src/task-list.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TaskBarTasks");
const code = ts.transpileModule(`${component.getText(source)}\nreturn TaskBarTasks;`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const TaskBarTasks = new Function("React", "visualState", code)(React, (status) => status);

test("task branches retain their parent, order and nested status", () => {
  const leaf = { id: "leaf", title: "Nested check", status: "pending", subtasks: [] };
  const child = { id: "child", title: "Child", status: "in_progress", subtasks: [leaf] };
  const parent = { id: "parent", title: "Parent", status: "completed", subtasks: [child] };
  const tree = TaskBarTasks({ tasks: [parent, { ...leaf, id: "sibling" }] });
  assert.deepEqual(tree.props.children.map((node) => node.key), ["parent", "sibling"]);
  const children = TaskBarTasks(tree.props.children[0].props.children[1].props);
  assert.equal(children.props.children[0].key, "child");
  const grandchildren = TaskBarTasks(children.props.children[0].props.children[1].props);
  assert.equal(grandchildren.props.children[0].key, "leaf");
  assert.equal(grandchildren.props.children[0].props.children[0].props["data-status"], "pending");
  assert.equal(grandchildren.props.children[0].props.children[1], false);
});

test("plan entries preserve numbering and selection across nested branches", () => {
  const entryComponent = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TaskEntry");
  const entryCode = ts.transpileModule(`${entryComponent.getText(source)}\nreturn TaskEntry;`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const TaskEntry = new Function("React", "visualState", entryCode)(React, (status) => status);
  const child = { id: "child", title: "Child", status: "pending", subtasks: [] };
  const parent = { id: "parent", title: "Parent", status: "in_progress", subtasks: [child] };
  const flat = [{ task: parent, depth: 0 }, { task: child, depth: 1, parentId: "parent" }];
  let picked;
  const tree = TaskEntry({ entry: flat[0], flat, picked: "child", onPick: (id) => { picked = id; } });
  const branch = TaskEntry(tree.props.children[1].props.children[0].props);
  const section = branch.props.children[0];
  assert.equal(section.props.className, "plan-entry active");
  assert.equal(section.props.children[0].props.children[0].props.children, 2);
  section.props.children[0].props.children[1].props.onClick();
  assert.equal(picked, "child");
  assert.equal(branch.props.children[1], false);
});
