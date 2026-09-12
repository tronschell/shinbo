import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const compile = (source, globals = {}) => {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(code, { exports, require: () => ({ jsx, jsxs: jsx }), ...globals });
  return exports;
};
const componentSource = (directory, name) => {
  const source = readFileSync(path.join(directory, "src/App.tsx"), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name
    || ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => entry.name.getText(tree) === name));
  assert.ok(declaration);
  return `${declaration.getText(tree)}\nexport { ${name} };`;
};
const hooks = () => {
  const values = [];
  let at = 0;
  let dirty = true;
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    begin: () => { at = 0; },
    useState: (initial) => {
      const index = at++;
      values[index] ??= initial;
      return [values[index], (value) => { dirty ||= !Object.is(values[index], value); values[index] = value; }];
    },
    useMemo: (run, deps) => {
      const index = at++;
      if (!same(values[index]?.deps, deps)) values[index] = { deps, value: run() };
      return values[index].value;
    },
    memo: (render) => {
      let previous;
      let result;
      return (props) => {
        if (dirty || !previous || !same(Object.keys(previous), Object.keys(props)) || Object.keys(props).some((key) => !Object.is(props[key], previous[key]))) {
          dirty = false;
          result = render(props);
          previous = props;
        }
        return result;
      };
    },
  };
};

test("transcript navigation reuses full prompt previews during streaming and hover", () => {
  const { sentByThread } = compile(readFileSync(path.join(root, "shared/agents.ts"), "utf8"));
  const content = "Prompt heading\n" + "context line\n".repeat(4500);
  const messages = Array.from({ length: 1024 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: index % 2 ? "Reply" : content, timestamp: "2026-09-12T12:00:00Z" }));
  const variants = process.env.SHINBO_RENDERER_ROUND2_BASELINE ? [process.env.SHINBO_RENDERER_ROUND2_BASELINE, root] : [root];
  for (const directory of variants) {
    const baseline = directory !== root;
    const times = [];
    let finalCalls;
    for (let trial = 0; trial < 5; trial++) {
      let calls = 0;
      let navigated;
      const runtime = hooks();
      const { TranscriptRail } = compile(componentSource(directory, "TranscriptRail"), { ...runtime, time: (stamp) => stamp, sentByThread: (text) => { calls++; return sentByThread(text); } });
      let props = { messages, scroller: { current: { querySelector: (selector) => ({ scrollIntoView: () => { navigated = selector; } }) } } };
      const render = () => { runtime.begin(); return TranscriptRail(props); };
      const start = performance.now();
      let rail;
      for (let update = 0; update < 20; update++) rail = render();
      times.push(performance.now() - start);
      finalCalls = calls;
      if (!baseline) assert.equal(calls, 512);
      const buttons = rail.props.children;
      assert.equal(buttons.length, 512);
      assert.equal(buttons[0].props["aria-label"], "Jump to: Prompt heading");
      buttons[1].props.onFocus();
      const focused = render().props.children[1];
      const preview = focused.props.children;
      assert.equal(preview.props.children[0].props.children, "Prompt heading");
      assert.equal(preview.props.children[1].props.children, "context line ".repeat(4499) + "context line");
      focused.props.onClick();
      assert.equal(navigated, '[data-turn="2"]');
      focused.props.onBlur();
      assert.equal(render().props.children[1].props.children, false);
      if (!baseline) assert.equal(calls, 512);
      props = { ...props, messages: messages.map((message, index) => index ? message : { ...message, content: "Edited heading\nEdited body" }) };
      assert.equal(render().props.children[0].props["aria-label"], "Jump to: Edited heading");
    }
    console.log(JSON.stringify({ issue: "transcript-rail", baseline, messages: messages.length, promptBytes: content.length, renders: 20, parsedPrompts: finalCalls, medianMs: times.sort((a, b) => a - b)[2] }));
  }
});

test("streaming keeps completed tool rows while changed tool results still render", () => {
  const { spawnedThread } = compile(readFileSync(path.join(root, "shared/agents.ts"), "utf8"));
  const { markedGoal } = compile(readFileSync(path.join(root, "shared/goal.ts"), "utf8"));
  const { latestSteps, stepActive } = compile(readFileSync(path.join(root, "src/tool-activity.ts"), "utf8"));
  const output = "file output line\n".repeat(3500);
  const steps = Array.from({ length: 128 }, (_, index) => ({ threadId: "thread", toolCallId: String(index), title: "Read file", kind: "read", status: "completed", output }));
  const variants = process.env.SHINBO_RENDERER_ROUND2_BASELINE ? [process.env.SHINBO_RENDERER_ROUND2_BASELINE, root] : [root];
  for (const directory of variants) {
    const baseline = directory !== root;
    const source = componentSource(directory, "Step");
    const times = [];
    let finalCalls;
    for (let trial = 0; trial < 5; trial++) {
      let calls = 0;
      const rows = steps.map(() => compile(source, {
        memo: hooks().memo, spawnedThread, stepActive,
        markedGoal: (text) => { calls++; return markedGoal(text); },
        artifactWritten: () => undefined,
        LoaderCircle: "loader", Review: "review", EditStep: "edit", StepMark: "mark", StepTitle: "title", GoalCard: "goal", openGoalPage: () => undefined,
      }).Step);
      const start = performance.now();
      for (let update = 0; update < 20; update++) latestSteps(steps).forEach((step, index) => rows[index]({ step }));
      times.push(performance.now() - start);
      finalCalls = calls;
      if (!baseline) assert.equal(calls, 128);
      const updated = rows[0]({ step: { ...steps[0], output: "Created goal\n[goal:my-goal]" } });
      const goal = updated.props.children.find((child) => child?.type === "goal");
      assert.equal(goal.props.threadId, "my-goal");
      const active = rows[0]({ step: { ...steps[0], status: "in_progress" } });
      assert.equal(active.props.className, "step in_progress");
      assert.equal(active.props.children[0].type, "loader");
    }
    console.log(JSON.stringify({ issue: "streaming-tool-rows", baseline, steps: steps.length, outputBytes: output.length, renders: 20, inspectedOutputs: finalCalls, medianMs: times.sort((a, b) => a - b)[2] }));
  }
});

test("failed and interrupted tool rows name their status without relying on color", () => {
  const { Step } = compile(componentSource(root, "Step"), {
    memo: (render) => render, spawnedThread: () => undefined, markedGoal: () => undefined,
    artifactWritten: () => undefined, stepActive: () => false, StepMark: "mark", StepTitle: "title",
  });
  for (const [status, label] of [["failed", "failed"], ["cancelled", "interrupted"], ["completed", undefined]]) {
    const row = Step({ step: { status, title: "Run command" } });
    const note = row.props.children.find((child) => child?.props?.className === "step-note");
    assert.equal(note?.props.children, label);
  }
});
