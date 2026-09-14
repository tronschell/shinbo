import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const callbacks = source.slice(source.indexOf("  const showBrowser ="), source.indexOf("  useEffect(() => {\n    const open = (event: Event) => showArtifact"));
const compiled = ts.transpileModule(callbacks, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("review panes replace other right panes and restore the original context visibility", () => {
  for (const collapsed of [false, true]) {
    const state = { review: "", artifact: "", files: false, layout: { inspectorCollapsed: collapsed, browserOpen: false } };
    const { showReview, showBrowser, showArtifact, showFiles } = new Function("useCallback", "layout", "pane", "inspectorBefore", "setReviewPane", "setArtifactPaneId", "setFilesPane", "setView", `${compiled}; return { showReview, showBrowser, showArtifact, showFiles };`)(
      (callback) => callback, state.layout, (change) => Object.assign(state.layout, change), { current: null },
      (next) => { state.review = next; }, (id) => { state.artifact = id; }, (update) => { state.files = update({ open: state.files }).open; }, () => {},
    );
    showBrowser(true);
    showReview("git");
    assert.equal(state.layout.browserOpen, false);
    assert.equal(state.review, "git");
    showReview("changes");
    assert.equal(state.review, "changes");
    assert.equal(state.layout.inspectorCollapsed, true);
    showArtifact("example");
    assert.equal(state.review, "");
    showReview("changes");
    assert.equal(state.artifact, "");
    showBrowser(true);
    assert.equal(state.review, "");
    showBrowser(false);
    assert.equal(state.layout.inspectorCollapsed, collapsed);
    showReview("git");
    showFiles(true);
    assert.equal(state.files, true);
    assert.equal(state.review, "");
    assert.equal(state.layout.browserOpen, false);
    showReview("git");
    assert.equal(state.files, false);
    showReview("");
    assert.equal(state.layout.inspectorCollapsed, collapsed);
  }
});
