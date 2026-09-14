import assert from "node:assert/strict";
import test from "node:test";

import { tokenize } from "../src/highlight";
import { inlineSpans, parseBlocks } from "../src/markdown-parse";

const text = (spans: { text: string }[]) => spans.map((span) => span.text).join("");
const kinds = (source: string, language?: string) => tokenize(source, language).filter((token) => token.kind).map((token) => `${token.kind}:${token.text}`);

test("numbered steps keep their numbers around code blocks and continuation lines", () => {
  const blocks = parseBlocks("1. Install\n\n   ```sh\n   npm i\n   ```\n\n2. Run\n   still run\n3. Done");
  assert.deepEqual(blocks.map((block) => block.kind), ["list", "code", "list"]);
  assert.equal(blocks[0].kind === "list" && blocks[0].start, 1);
  assert.equal(blocks[1].kind === "code" && blocks[1].text, "npm i");
  assert.equal(blocks[2].kind === "list" && blocks[2].start, 2);
  assert.deepEqual(blocks[2].kind === "list" && blocks[2].items.map((item) => text(item.spans)), ["Run\nstill run", "Done"]);
  const [third] = parseBlocks("3. three\n4. four");
  assert.equal(third.kind === "list" && third.start, 3);
  assert.deepEqual(parseBlocks("- item one\n  continues here\n- two").map((block) => block.kind), ["list"]);
});

test("nested lists keep every item when the marker type changes or a third level opens", () => {
  const [mixed] = parseBlocks("- a\n  - b\n  1. c\n- d");
  assert.equal(mixed.kind, "list");
  if (mixed.kind !== "list") return;
  assert.deepEqual(mixed.items[0].sub?.map((sub) => [sub.ordered, sub.items.map((item) => text(item.spans))]), [[false, ["b"]], [true, ["c"]]]);
  assert.equal(mixed.items.length, 2);
  const [deep] = parseBlocks("- a\n  - b\n    - c\n  - d");
  assert.equal(deep.kind === "list" && text(deep.items[0].sub?.[0].items[0].sub?.[0].items[0].spans ?? []), "c");
  assert.deepEqual(deep.kind === "list" && deep.items[0].sub?.[0].items.map((item) => text(item.spans)), ["b", "d"]);
  const [wide] = parseBlocks("1. Foo\n    - bar\n    - baz");
  assert.deepEqual(wide.kind === "list" && wide.items[0].sub?.map((sub) => sub.items.map((item) => text(item.spans))), [["bar", "baz"]]);
  assert.equal(wide.kind === "list" && wide.items[0].sub?.[0].items[0].sub, undefined);
  const [plain] = parseBlocks("- a\n    - b\n    - c");
  assert.deepEqual(plain.kind === "list" && plain.items[0].sub?.map((sub) => sub.items.map((item) => text(item.spans))), [["b", "c"]]);
  assert.equal(plain.kind === "list" && plain.items[0].sub?.[0].items[0].sub, undefined);
});

test("identifiers and arithmetic are not emphasis, and triple stars are both", () => {
  assert.deepEqual(inlineSpans("the user_id and created_at columns"), [{ text: "the user_id and created_at columns" }]);
  assert.deepEqual(inlineSpans("2 * 3 * 4"), [{ text: "2 * 3 * 4" }]);
  assert.deepEqual(inlineSpans("***both***"), [{ text: "both", bold: true, italic: true }]);
  assert.equal(inlineSpans("a *b* c")[1].italic, true);
  assert.equal(inlineSpans("a _b_ c")[1].italic, true);
  assert.equal(inlineSpans("__init__")[0].bold, true);
  assert.deepEqual(inlineSpans("my__var__name"), [{ text: "my__var__name" }]);
});

test("a fence closes only on a matching fence at least as long", () => {
  const blocks = parseBlocks("````\n```\ninner\n```\n````");
  assert.deepEqual(blocks.map((block) => block.kind), ["code"]);
  assert.equal(blocks[0].kind === "code" && blocks[0].text, "```\ninner\n```");
  const tilde = parseBlocks("```\nx\n~~~\ny\n```");
  assert.deepEqual(tilde.map((block) => block.kind), ["code"]);
  assert.equal(tilde[0].kind === "code" && tilde[0].text, "x\n~~~\ny");
});

test("backslashes escape markup and pipes inside table cells stay in the cell", () => {
  assert.equal(text(inlineSpans("\\*not italic\\* and \\_x\\_")), "*not italic* and _x_");
  assert.equal(inlineSpans("\\*not italic\\*").some((span) => span.italic), false);
  const [table] = parseBlocks("| a | b |\n|---|---|\n| `x\\|y` | z |\n| `a|b` | c |\n| d \\| e | f |");
  assert.equal(table.kind, "table");
  if (table.kind !== "table") return;
  assert.deepEqual(table.rows.map((row) => row.map(text)), [["x|y", "z"], ["a|b", "c"], ["d | e", "f"]]);
  assert.equal(table.rows[0][0][0].code, true);
});

test("links survive parentheses and titles, and double backticks hold a backtick", () => {
  assert.equal(inlineSpans("[x](https://en.wikipedia.org/wiki/Foo_(bar))")[0].href, "https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.equal(inlineSpans("[x](https://en.wikipedia.org/wiki/Foo_(bar))").length, 1);
  const titled = inlineSpans('[x](https://a.com "title")');
  assert.deepEqual([titled.length, titled[0].href, titled[0].text], [1, "https://a.com/", "x"]);
  assert.deepEqual(inlineSpans("``a`b``"), [{ text: "a`b", code: true, path: undefined }]);
});

test("prose blocks are not highlighted, and a quote does not swallow the following lines", () => {
  assert.deepEqual(tokenize("Couldn't find file\nnext 'x'", ""), [{ text: "Couldn't find file\nnext 'x'" }]);
  assert.deepEqual(kinds("Couldn't find file", "text"), []);
  assert.deepEqual(kinds("Couldn't find file\nnext 'x'", "js"), ["string:'t find file", "string:'x'"]);
  assert.deepEqual(kinds('"""doc\nstring"""', "python"), ['string:"""doc\nstring"""']);
});

test("a URL in a shell line is not a comment", () => {
  assert.deepEqual(kinds("curl https://api.com/x -H 'a'", "bash"), ["attr:https", "string:'a'"]);
  assert.deepEqual(kinds("x = 1 // note", "ts"), ["number:1", "comment:// note"]);
});
