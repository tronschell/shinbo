import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/visual.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace("function VisualFrame(", "export function VisualFrame("), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function mount(readVisual) {
  const slots = [];
  const effects = [];
  const listeners = new Map();
  const timers = new Map();
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (slots[index]?.deps.every((value, at) => value === deps[at])) return;
      slots[index]?.cleanup?.();
      slots[index] = { deps };
      effects.push(() => { slots[index].cleanup = effect(); });
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "../shared/visualize") return {
        VISUAL_HEIGHT_MESSAGE: "visual-height", VISUAL_PICKED_MESSAGE: "visual-picked",
        visualFrameUrl: (id) => `emma-visual://${id}/`,
      };
      if (name === "./errors") return { reasonText: (error) => error.message };
      if (name === "./icons") return { MoreIcon: () => null };
      throw new Error(name);
    },
    window: {
      emma: { readVisual },
      setTimeout(callback) { timers.set(1, callback); return 1; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name) { listeners.delete(name); },
    },
  });
  const props = { id: "one", onPicked() {}, onKept() {} };
  return {
    render() {
      cursor = 0;
      const tree = exports.VisualFrame(props);
      effects.splice(0).forEach((effect) => effect());
      return tree;
    },
    timeout() { timers.get(1)?.(); },
    message(event) { listeners.get("message")?.(event); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    wrapper(id) { return exports.Visual({ ...props, id }); },
    timers,
  };
}

function children(tree) {
  return [tree, ...[tree?.props?.children].flat(Infinity).filter((child) => child && typeof child === "object").flatMap(children)];
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const status = (tree) => children(tree).find((node) => node.props?.role === "status");
const iframe = (tree) => children(tree).find((node) => node.type === "iframe");

test("loading stays visible until the current frame confirms rendering", async () => {
  const app = mount(async () => ({ title: "Chart", html: "<p>Chart</p>" }));
  assert.equal(status(app.render()).props.children, "Loading picture…");
  await settle();
  let tree = app.render();
  assert.equal(status(tree).props.children, "Rendering picture…");
  const frame = iframe(tree);
  const page = {};
  frame.props.ref.current = { contentWindow: page };
  frame.props.onLoad();
  assert.equal(status(app.render()).props["data-running"], true);
  app.message({ source: {}, data: { emma: "visual-height", height: 200 } });
  app.message({ source: page, data: { emma: "visual-height", height: Infinity } });
  app.message({ source: page, data: { emma: "visual-height", height: 0 } });
  assert.equal(app.render().props["aria-busy"], true);
  app.message({ source: page, data: { emma: "visual-height", height: 220 } });
  tree = app.render();
  assert.equal(tree.props["aria-busy"], false);
  assert.equal(status(tree), undefined);
  assert.equal(iframe(tree).props.style.height, 220);
  app.timeout();
  assert.equal(status(app.render()), undefined);
  app.unmount();
  assert.equal(app.timers.size, 0);
});

test("unconfirmed frames stop pulsing and may recover on a late confirmation", async () => {
  const app = mount(async () => ({ title: "Chart", html: "" }));
  app.render();
  await settle();
  const page = {};
  iframe(app.render()).props.ref.current = { contentWindow: page };
  app.timeout();
  let tree = app.render();
  assert.equal(tree.props["aria-busy"], false);
  assert.equal(status(tree).props["data-running"], undefined);
  assert.match(status(tree).props.children, /hasn’t confirmed/);
  app.message({ source: page, data: { emma: "visual-height", height: 180 } });
  tree = app.render();
  assert.equal(status(tree), undefined);
});

test("read and frame errors end activity rather than implying an expired picture", async () => {
  const failed = mount(async () => { throw new Error("Access denied"); });
  failed.render();
  await settle();
  failed.timeout();
  const message = status(failed.render());
  assert.match(message.props.children, /Access denied/);
  assert.equal(message.props["data-running"], undefined);
  const app = mount(async () => ({ title: "Chart", html: "" }));
  app.render();
  await settle();
  iframe(app.render()).props.onError();
  app.timeout();
  assert.match(status(app.render()).props.children, /frame could not load/);
  assert.equal(status(app.render()).props["data-running"], undefined);
});

test("stalled reads stop activity and different ids have separate component identity", () => {
  const app = mount(() => new Promise(() => {}));
  app.render();
  app.timeout();
  assert.equal(status(app.render()).props["data-running"], undefined);
  assert.equal(app.wrapper("one").key, "one");
  assert.equal(app.wrapper("two").key, "two");
});
