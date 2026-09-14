import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { ThreadStep } from "../shared/agents";

type Element = { type: string; props: Record<string, unknown>; children: unknown[] };
const source = ts.createSourceFile("App.tsx", readFileSync(path.resolve(__dirname, "../../src/App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find((item): item is ts.VariableStatement => ts.isVariableStatement(item) && item.declarationList.declarations[0]?.name.getText(source) === "Step");
assert.ok(declaration);
const code = ts.transpileModule(`${declaration.getText(source)}\nreturn Step;`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const elements = (value: unknown): Element[] => Array.isArray(value) ? value.flatMap(elements) : value && typeof value === "object" && "children" in value ? [value as Element, ...(value as Element).children.flatMap(elements)] : [];
const nothing = () => undefined;
const Step = Function("React", "memo", "artifactWritten", "spawnedThread", "markedGoal", "stepActive", "LoaderCircle", "Review", "EditStep", "StepMark", "StepTitle", "ArtifactCard", "ThreadCard", "GoalCard", "openArtifactPane", "openThreadPage", "openGoalPage", code)(
  { createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
  (component: unknown) => component, nothing, nothing, nothing, () => false, "loader", "review", "edit", "mark", "title", "artifact", "thread", "goal", nothing, nothing, nothing,
);
const body = (step: ThreadStep) => elements(Step({ step })).find((item) => item.type === "pre")?.children.join("");
const step: ThreadStep = { threadId: "t1", toolCallId: "c1", title: "Running printf marker", kind: "execute", status: "completed", at: 0 };

test("expanded tool steps show the recorded output and fall back to the title", () => {
  assert.equal(body({ ...step, output: "exit_code=0\n<stdout>\nmarker\n</stdout>\n" }), "exit_code=0\n<stdout>\nmarker\n</stdout>\n");
  assert.equal(body(step), "Running printf marker");
  assert.equal(body({ ...step, output: "" }), "Running printf marker");
});
