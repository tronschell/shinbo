import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/minimap.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

test("minimap drag keeps its grab offset, track clicks center, and keyboard reaches both ends", () => {
  const scroll = { scrollTop: 400, scrollHeight: 2000, clientHeight: 400 };
  const refs = [{ current: scroll }, { current: null }, { current: null }, { current: null }];
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  new Function("exports", "require", compiled)(exports, (name) => {
    if (name === "react") return { useId: () => "content", useRef: () => refs.shift(), useState: () => [{ top: 0.15, height: 0.4 }], useEffect: () => {} };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    return {};
  });
  const tree = exports.Minimap({ children: "content", className: "preview-body" });
  const map = tree.props.children[0].props;
  const target = { getBoundingClientRect: () => ({ top: 50, height: 500 }), setPointerCapture: () => {}, focus: () => {} };
  const pointer = (clientY) => ({ button: 0, pointerId: 1, clientY, currentTarget: target, preventDefault: () => {} });
  map.onPointerDown(pointer(150));
  assert.equal(Math.round(scroll.scrollTop), 400);
  map.onPointerMove(pointer(300));
  assert.equal(Math.round(scroll.scrollTop), 1200);
  map.onPointerUp();
  map.onPointerMove(pointer(400));
  assert.equal(Math.round(scroll.scrollTop), 1200);
  map.onPointerDown(pointer(400));
  assert.equal(Math.round(scroll.scrollTop), 1333);
  map.onPointerCancel();
  map.onPointerMove(pointer(200));
  assert.equal(Math.round(scroll.scrollTop), 1333);
  const key = (key) => map.onKeyDown({ key, preventDefault: () => {} });
  key("Home");
  assert.equal(scroll.scrollTop, 0);
  key("PageDown");
  assert.equal(scroll.scrollTop, 400);
  key("ArrowUp");
  assert.equal(scroll.scrollTop, 360);
  key("End");
  assert.equal(scroll.scrollTop, 2000);
  assert.equal(map["aria-controls"], tree.props.children[1].props.id);
});
