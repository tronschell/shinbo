import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { buildTrigger, parseTrigger, type Trigger } from "../shared/workflow";

const source = ts.createSourceFile("schedule.tsx", readFileSync(path.join(process.cwd(), "src/schedule.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = "";
function visit(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(source) === "onClick" && node.initializer?.getText(source).includes("weekdays")) handler = (node.initializer as ts.JsxExpression).expression!.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
const code = ts.transpile(`return (${handler});`, { target: ts.ScriptTarget.ES2022 });
const click = (value: string, day: number) => {
  let next = value;
  const trigger = parseTrigger(value);
  const set = (patch: Partial<Trigger>) => { next = buildTrigger({ ...trigger, ...patch }); };
  Function("trigger", "day", "set", code)(trigger, day, set)();
  return next;
};

test("weekly schedule keeps its last day instead of enabling daily execution", () => {
  assert.equal(click("0 9 * * 1", 1), "0 9 * * 1");
  assert.equal(click("0 9 * * 1,3", 1), "0 9 * * 3");
  assert.equal(click("0 9 * * 1", 3), "0 9 * * 1,3");
});
