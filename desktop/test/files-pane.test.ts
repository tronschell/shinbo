import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { inlineSpans, pathLink } from "../src/markdown-parse";

type Tab = { folderId: string; path: string; text: string; line: number; loaded: boolean };
type Pane = { tabs: Tab[]; active: string; expanded: string[]; entries: Record<string, unknown> };

const WANTED = ["tabKey", "baseName", "fileLanguage", "lineAt", "lfText", "eolText", "tableRows", "openTab", "closeTab"];
const source = ts.createSourceFile("files.tsx", readFileSync(path.resolve(__dirname, "../../src/files.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declared = source.statements.filter((item) => ts.isFunctionDeclaration(item)
  ? WANTED.includes(item.name?.text ?? "")
  : ts.isVariableStatement(item) && item.declarationList.declarations.some((one) => ts.isIdentifier(one.name) && WANTED.includes(one.name.text)));
assert.equal(declared.length, WANTED.length);
const code = ts.transpileModule(declared.map((item) => item.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = new Function(`${code}; return { ${WANTED.join(", ")} };`)() as {
  fileLanguage: (path: string) => string;
  lineAt: (text: string, offset: number) => number;
  lfText: (text: string) => string;
  eolText: (text: string, crlf: boolean) => string;
  tableRows: (text: string, separator: string) => string[][];
  openTab: (pane: Pane, ask: { folderId: string; path: string; line?: number }) => Pane;
  closeTab: (pane: Pane, key: string) => Pane;
};

const empty: Pane = { tabs: [], active: "", expanded: [], entries: {} };

test("a file's language comes from its extension, and dotfiles have none", () => {
  assert.equal(helpers.fileLanguage("desktop/src/App.tsx"), "tsx");
  assert.equal(helpers.fileLanguage("a/b/notes.MD"), "md");
  assert.equal(helpers.fileLanguage(".gitignore"), "");
  assert.equal(helpers.fileLanguage("Makefile"), "");
});

test("selection line numbers are one-based and count the lines before the offset", () => {
  const text = "one\ntwo\nthree";
  assert.equal(helpers.lineAt(text, 0), 1);
  assert.equal(helpers.lineAt(text, 4), 2);
  assert.equal(helpers.lineAt(text, text.length), 3);
});

test("a file's newlines survive a round trip through the editor", () => {
  const windows = "one\r\ntwo\r\n";
  assert.equal(helpers.lfText(windows), "one\ntwo\n");
  assert.equal(helpers.eolText(helpers.lfText(windows), true), windows);
  assert.equal(helpers.eolText("one\ntwo\n", false), "one\ntwo\n");
  assert.equal(helpers.lfText("one\ntwo"), "one\ntwo");
});

test("the table preview keeps quoted separators, escaped quotes and drops the trailing newline", () => {
  assert.deepEqual(helpers.tableRows("a,b\n1,\"x,y\"\n", ","), [["a", "b"], ["1", "x,y"]]);
  assert.deepEqual(helpers.tableRows("a\t\"say \"\"hi\"\"\"\n", "\t"), [["a", "say \"hi\""]]);
  assert.deepEqual(helpers.tableRows("a,\"two\nlines\"\r\n", ","), [["a", "two\nlines"]]);
});

test("opening a file twice reuses its tab, keeps its text and moves the line", () => {
  const first = helpers.openTab(empty, { folderId: "f1", path: "src/App.tsx" });
  assert.equal(first.active, "f1:src/App.tsx");
  assert.equal(first.tabs.length, 1);
  const edited = { ...first, tabs: first.tabs.map((tab) => ({ ...tab, text: "draft", loaded: true })) };
  const again = helpers.openTab(edited, { folderId: "f1", path: "src/App.tsx", line: 42 });
  assert.equal(again.tabs.length, 1);
  assert.equal(again.tabs[0].text, "draft");
  assert.equal(again.tabs[0].line, 42);
  const other = helpers.openTab(again, { folderId: "f2", path: "src/App.tsx" });
  assert.equal(other.tabs.length, 2);
  assert.equal(other.active, "f2:src/App.tsx");
});

test("closing the active tab falls back to the last open one, and to nothing when none are left", () => {
  const two = helpers.openTab(helpers.openTab(empty, { folderId: "f1", path: "a.ts" }), { folderId: "f1", path: "b.ts" });
  const one = helpers.closeTab(two, "f1:b.ts");
  assert.equal(one.active, "f1:a.ts");
  assert.deepEqual(one.tabs.map((tab) => tab.path), ["a.ts"]);
  assert.equal(helpers.closeTab(one, "f1:a.ts").active, "");
  assert.equal(helpers.closeTab(two, "f1:a.ts").active, "f1:b.ts");
});

test("inline code becomes a file link only when it reads like a path, with an optional line", () => {
  const linked = (text: string) => {
    const span = inlineSpans(`\`${text}\``)[0];
    return span.path ? { span: span.path, ...pathLink(span.text) } : undefined;
  };
  assert.deepEqual(linked("src/foo.ts"), { span: "src/foo.ts", path: "src/foo.ts" });
  assert.deepEqual(linked("src/foo.ts:42"), { span: "src/foo.ts", path: "src/foo.ts", line: 42 });
  assert.deepEqual(linked("desktop/src/App.tsx:379-393"), { span: "desktop/src/App.tsx", path: "desktop/src/App.tsx", line: 379 });
  assert.equal(linked("npm run build"), undefined);
  assert.equal(linked("const a = 1"), undefined);
  assert.deepEqual(linked("README.md"), { span: "README.md", path: "README.md" });
  assert.deepEqual(linked("package.json:12"), { span: "package.json", path: "package.json", line: 12 });
  assert.equal(linked("foo"), undefined);
  assert.equal(inlineSpans("`npm test`")[0].path, undefined);
});
