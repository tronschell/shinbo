import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const currentFile = path.join(root, "src/markdown.tsx");
const compile = (source, globals) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, ...globals });
  return exports;
};
const settle = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };

function picture(file, previewPath, openPreview, available = true) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && ["Picture", "PathSpan"].includes(node.name?.text)).map((node) => node.getText(tree)).join("\n");
  const slots = [];
  const observers = [];
  let cursor = 0;
  let pending = [];
  let updates = 0;
  let elapsed = 0;
  let nextTimer = 0;
  const timers = new Map();
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.active = true; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.active = false; }
    intersect(visible = true) { if (this.active) this.callback([{ isIntersecting: visible }]); }
  }
  const jsx = (type, props) => ({ type, props });
  const { Picture, PathSpan } = compile(`${declarations}\nexport { Picture, PathSpan };`, {
    require: () => ({ jsx, jsxs: jsx }), FileMark: "file-mark", openPreview,
    window: { shinbo: { previewPath } },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: elapsed + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    ...(available ? { IntersectionObserver: Observer } : {}),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: initial };
      return [slots[index].value, (value) => { updates++; slots[index].value = value; }];
    },
    useRef: () => {
      const index = cursor++;
      slots[index] ??= { current: {} };
      return slots[index];
    },
    useEffect: (callback, deps) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        const old = slots[index];
        slots[index] = { deps };
        pending.push(() => { old?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  });
  return {
    observers,
    render: (props) => { cursor = 0; const value = Picture(props); for (const callback of pending.splice(0)) callback(); return value; },
    path: (node) => PathSpan((node.type === "span" ? node.props.children : node).props),
    image: (node) => node.type === "span" ? node.props.children : node,
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
    updates: () => updates,
    advance: (ms) => { elapsed += ms; for (const [id, timer] of timers) if (timer.at <= elapsed) { timers.delete(id); timer.callback(); } },
  };
}

test("historical Markdown pictures request previews only near the viewport", async () => {
  const { parseBlocks } = compile(readFileSync(path.join(root, "src/markdown-parse.ts"), "utf8"), { URL });
  const messages = Array.from({ length: 100 }, (_, index) => `![Photo ${index}](/photos/photo-${index}.jpg)`);
  const props = messages.map((text) => { const span = parseBlocks(text)[0].spans[0]; assert.equal(span.image, true); return { path: span.path, alt: span.text }; });
  const variants = process.env.SHINBO_MARKDOWN_IMAGE_BASELINE ? [process.env.SHINBO_MARKDOWN_IMAGE_BASELINE, currentFile] : [currentFile];
  for (const file of variants) {
    const baseline = file !== currentFile;
    let calls = 0;
    const views = props.map(() => picture(file, async (path) => { calls++; return { image: `data:${path}` }; }, () => undefined));
    views.forEach((view, index) => view.render(props[index]));
    await settle();
    const initial = calls;
    if (!baseline) assert.equal(initial, 0);
    views.slice(0, 6).forEach((view) => view.observers[0]?.intersect());
    views.slice(0, 6).forEach((view) => view.advance(100));
    await settle();
    assert.equal(calls, baseline ? 100 : 6);
    views.slice(0, 6).forEach((view, index) => {
      const image = view.image(view.render(props[index]));
      assert.equal(image.type, "img"); assert.equal(image.props.alt, props[index].alt); assert.equal(image.props.title, props[index].path);
      view.observers[0]?.intersect(false); view.observers[0]?.intersect(); view.render(props[index]);
    });
    assert.equal(calls, baseline ? 100 : 6);
    views.forEach((view) => view.unmount());
    assert.ok(views.every((view) => view.observers.every((observer) => !observer.active)));
    console.log(JSON.stringify({ issue: "offscreen-markdown-pictures", baseline, mountedPictures: 100, initiallyRequestedPreviews: initial, nearViewportPictures: 6, finalPreviewRequests: calls }));
  }
});

test("deferred pictures retain fallback actions and reject stale path responses", async () => {
  const requested = [];
  const opened = [];
  const view = picture(currentFile, (path) => new Promise((resolve, reject) => requested.push({ path, resolve, reject })), (...args) => opened.push(args));
  let props = { path: "/photo-a.jpg", alt: "Photo A" };
  const fallback = view.path(view.render(props));
  assert.equal(fallback.props.role, "button"); assert.equal(fallback.props.tabIndex, 0);
  fallback.props.onClick();
  let prevented = 0;
  fallback.props.onKeyDown({ key: "Enter", preventDefault: () => prevented++ });
  fallback.props.onKeyDown({ key: " ", preventDefault: () => prevented++ });
  assert.equal(prevented, 2); assert.deepEqual(opened, [[props.path], [props.path], [props.path]]);
  assert.equal(view.observers[0].options.rootMargin, "400px");
  view.observers[0].intersect(false); assert.equal(requested.length, 0);
  view.observers[0].intersect(); view.advance(99); assert.equal(requested.length, 0);
  view.advance(1); assert.equal(requested.length, 1);
  props = { path: "/photo-b.jpg", alt: "Photo B" };
  assert.equal(view.path(view.render(props)).props.title, "Open /photo-b.jpg");
  requested[0].resolve({ image: "old" }); await settle();
  assert.equal(view.updates(), 0);
  view.observers[1].intersect(); view.advance(100); requested[1].resolve({ image: "new" }); await settle();
  const image = view.image(view.render(props));
  assert.equal(image.props.src, "new"); image.props.onClick(); assert.deepEqual(opened.at(-1), [props.path, props.alt]);
  props = { path: "/missing.jpg", alt: "Missing" };
  assert.equal(view.path(view.render(props)).props.title, "Open /missing.jpg");
  view.observers[2].intersect(); view.advance(100); requested[2].reject(new Error("missing")); await settle();
  assert.equal(view.path(view.render(props)).props.children[1], "Missing");
  props = { path: "/unmounted.jpg", alt: "" }; view.render(props); view.observers[3].intersect(); view.advance(100);
  const updates = view.updates(); view.unmount(); requested[3].resolve({ image: "late" }); await settle(); assert.equal(view.updates(), updates);
  const eager = picture(currentFile, async () => ({ image: "eager" }), () => undefined, false);
  eager.render(props); await settle(); assert.equal(eager.image(eager.render(props)).props.src, "eager"); eager.unmount();
  let pendingCalls = 0;
  const pending = picture(currentFile, async () => { pendingCalls++; return null; }, () => undefined);
  pending.render(props); pending.observers[0].intersect(); pending.advance(50);
  pending.render({ ...props, path: "/new-path.jpg" }); pending.advance(100); assert.equal(pendingCalls, 0);
  pending.observers[1].intersect(); pending.unmount(); pending.advance(100); assert.equal(pendingCalls, 0);
});

test("pictures crossed briefly during navigation do not queue ahead of the destination", async () => {
  const variants = process.env.SHINBO_MARKDOWN_DWELL_BASELINE ? [process.env.SHINBO_MARKDOWN_DWELL_BASELINE, currentFile] : [currentFile];
  for (const file of variants) {
    const baseline = file !== currentFile;
    const requested = [];
    const views = Array.from({ length: 100 }, (_, index) => {
      const view = picture(file, async (path) => { requested.push(path); return { image: path }; }, () => undefined);
      view.render({ path: `/photo-${index}.jpg`, alt: `Photo ${index}` });
      return view;
    });
    for (const view of views.slice(1)) {
      view.observers[0].intersect(); view.advance(40); view.observers[0].intersect(false); view.advance(100);
    }
    views[0].observers[0].intersect(); views[0].advance(100); await settle();
    if (!baseline) assert.deepEqual(requested, ["/photo-0.jpg"]);
    console.log(JSON.stringify({ issue: "markdown-picture-navigation-dwell", baseline, passedPictures: 99, passedVisibilityMs: 40, requestedPreviews: requested.length, destinationQueuePosition: requested.indexOf("/photo-0.jpg") + 1 }));
    views.forEach((view) => view.unmount());
  }
});
