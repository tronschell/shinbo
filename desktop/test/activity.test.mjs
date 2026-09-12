import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../src/tool-activity.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { latestSteps, runActivity, stepActive } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const step = (toolName, status = "in_progress", toolCallId = toolName) => ({ threadId: "thread", toolCallId, toolName, title: toolName, kind: "tool", status, at: 1000 });
const block = (value) => ({ kind: "step", step: value });
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const stalledSource = app.slice(app.indexOf("function Stalled("), app.indexOf("\nfunction stepLabel("));
const stalledCompiled = ts.transpileModule(stalledSource, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
const Stalled = new Function("React", "useState", "useEffect", "runActivity", "clock", "keyed", `${stalledCompiled}; return Stalled;`)(React, useState, useEffect, runActivity, (ms) => `${ms}ms`, (text) => text);
const renderActivity = (blocks, recovery = "", since = Date.now()) => renderToStaticMarkup(React.createElement(Stalled, { blocks, recovery, since, onSwap() {} }));

for (const tool of ["advisor", "terminal", "browser", "subagent", "artifact", "read_file", "edit_file", "visualize", "unknown_plugin"]) {
  test(`${tool} remains tool waiting behind text, thinking, notice and a completed call`, () => {
    const activity = runActivity([block(step(tool)), { kind: "text", text: "Working" }, { kind: "thinking", text: "Thinking" }, { kind: "notice", text: "Notice" }, block(step("other", "completed"))], 1000, 601000, "Model recovery");
    assert.equal(activity.phase, "tools");
    assert.equal(activity.stalled, true);
    assert.equal(activity.canSwap, false);
    assert.equal(activity.quiet, 600000);
    assert.equal(activity.outstanding.length, 1);
  });
}

test("active tool status uses the actual action title without warning decoration or model recovery", (t) => {
  t.mock.method(Date, "now", () => 61000);
  const html = renderActivity([block({ ...step("terminal"), title: "Run focused activity tests" })], "Retrying model", 1000);
  assert.match(html, /class="inline-activity run-wait" role="status"/);
  assert.match(html, /Waiting for Run focused activity tests/);
  assert.match(html, /last update <b>60000ms<\/b> ago/);
  assert.doesNotMatch(html, /context-cut|context-notice|stalled|tool-activity-indicator|<svg|Retrying model|Try another model/);
  assert.equal(renderActivity([block(step("terminal"))]), "");
  assert.match(renderActivity([block({ ...step("terminal"), title: " " })], "", 1000), /Waiting for tool/);
});

test("active status counts outstanding calls, not completed calls or duplicate updates", () => {
  const html = renderActivity([block(step("one", "pending")), block(step("one")), block(step("two")), block(step("three", "completed"))], "", Date.now() - 60000);
  assert.match(html, /Waiting for 2 tools/);
  assert.doesNotMatch(html, /Try another model/);
});

test("normal activity stays hidden before silence, including outstanding tools", (t) => {
  t.mock.method(Date, "now", () => 61000);
  for (const blocks of [[], [block(step("terminal"))], [{ kind: "text", text: "Working" }], [block(step("edit_file", "completed")), { kind: "text", text: "Working" }]]) {
    for (const quiet of [0, 59999]) {
      const html = renderActivity(blocks, "", 61000 - quiet);
      assert.equal(html, "");
    }
  }
  assert.match(app, /sending && streaming === null && run\.activeAt <= 0 && <p className="waiting"/);
});

test("model recovery retains its static notice immediately", (t) => {
  t.mock.method(Date, "now", () => 61000);
  const html = renderActivity([], "Retrying");
  assert.match(html, /class="context-cut context-notice stalled run-wait"/);
  assert.match(html, /Retrying/);
  assert.match(html, /Try another model/);
  assert.doesNotMatch(html, /data-running|inline-activity|Waiting for response/);
});

test("model silence and recovery retain neutral warning and swap action", (t) => {
  t.mock.method(Date, "now", () => 61000);
  for (const recovery of ["", "Retrying"]) {
    const html = renderActivity([], recovery, 1000);
    assert.match(html, /class="context-cut context-notice stalled run-wait"/);
    assert.match(html, recovery ? /Retrying/ : /Waiting for model response · no update for <b>60000ms<\/b>/);
    assert.match(html, /Try another model/);
    assert.doesNotMatch(html, /data-running|inline-activity/);
  }
});

test("all outstanding calls are counted once and terminal updates settle only their call", () => {
  const records = [step("one", "pending"), step("two"), step("one", "in_progress"), step("three", "cancelled")];
  assert.equal(latestSteps(records).length, 3);
  assert.equal(runActivity(records.map(block), 1000, 1000, "").outstanding.length, 2);
  for (const status of ["completed", "failed", "cancelled"]) {
    const activity = runActivity([...records, step("one", status), step("two", status)].map(block), 1000, 61000, "");
    assert.equal(activity.outstanding.length, 0);
    assert.equal(activity.phase, "model");
    assert.equal(activity.canSwap, true);
    assert.equal(stepActive(step("one", status)), false);
  }
});

test("model silence starts at the last event, not the turn start; recovery is separate", () => {
  assert.equal(runActivity([], 1000, 60999, "").stalled, false);
  assert.equal(runActivity([], 1000, 61000, "").stalled, true);
  assert.equal(runActivity([], 61000, 61000, "").stalled, false);
  assert.equal(runActivity([], 61000, 60000, "").quiet, 0);
  const recovery = runActivity([], 61000, 61000, "Retrying");
  assert.equal(recovery.phase, "recovery");
  assert.equal(recovery.stalled, false);
});
