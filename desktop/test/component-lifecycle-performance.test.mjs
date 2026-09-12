import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const compile = (source, globals = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, ...globals });
  return exports;
};
const { componentModuleUrl, MAX_COMPONENTS } = compile(readFileSync(path.join(root, "shared/components.ts"), "utf8"), { require: () => ({}) });
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

function mountedModule(file, counters) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useModule");
  const values = [];
  const effects = [];
  const componentCleanups = [];
  let cursor = 0;
  let mounted;
  const errors = [];
  const onError = (error) => errors.push(error);
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const fixture = compile('export default (api) => function Dashboard() { api.useEffect(() => { api.fetch("https://service.example/status"); return () => api.stopped(); }, []); return null; };').default;
  const { useModule } = compile(`${declaration.getText(tree)}\nexport { useModule };`, {
    require: () => ({ __esModule: true, default: (api) => { counters.factories++; counters.variables.push(api.variables); return fixture(api); } }),
    componentModuleUrl, reasonText: String,
    runtime: { useEffect: (callback) => componentCleanups.push(callback()), stopped: () => counters.stopped++ },
    window: { shinbo: { componentFetch: async () => { counters.requests++; return { ok: true, status: 200, body: "{}" }; } } },
    useState: (initial) => {
      const index = cursor++;
      if (!(index in values)) values[index] = { value: initial };
      return [values[index].value, (next) => { values[index].value = next; }];
    },
    useMemo: (run, deps) => {
      const index = cursor++;
      if (!same(values[index]?.deps, deps)) values[index] = { deps, value: run() };
      return values[index].value;
    },
    useEffect: (callback, deps) => {
      const index = cursor++;
      if (!same(values[index]?.deps, deps)) {
        const old = values[index]; values[index] = { deps };
        effects.push(() => { old?.cleanup?.(); values[index].cleanup = callback(); });
      }
    },
  });
  return {
    render: (meta) => {
      cursor = 0;
      const Component = useModule(meta, onError);
      for (const effect of effects.splice(0)) effect();
      if (Component && Component !== mounted) {
        for (const cleanup of componentCleanups.splice(0)) cleanup?.();
        Component(); mounted = Component;
      }
      return Component;
    },
    errors,
    unmount: () => { for (const value of values) value?.cleanup?.(); for (const cleanup of componentCleanups.splice(0)) cleanup?.(); },
  };
}

test("unchanged credential declarations do not remount components on metadata broadcasts", async () => {
  const current = path.join(root, "src/components.tsx");
  const variants = process.env.SHINBO_COMPONENT_LIFECYCLE_BASELINE ? [process.env.SHINBO_COMPONENT_LIFECYCLE_BASELINE, current] : [current];
  for (const file of variants) {
    const baseline = file !== current;
    const counters = { factories: 0, requests: 0, stopped: 0, variables: [] };
    const components = Array.from({ length: MAX_COMPONENTS }, () => mountedModule(file, counters));
    let metadata = components.map((_, index) => ({ id: `component-${index}`, version: 1, title: `Dashboard ${index}`, variables: ["API_KEY"] }));
    const render = async () => { components.forEach((component, index) => component.render(metadata[index])); await settle(); return components.map((component, index) => component.render(metadata[index])); };
    const first = await render();
    assert.equal(counters.requests, MAX_COMPONENTS);
    for (let update = 0; update < 20; update++) {
      metadata = metadata.map((meta, index) => ({ ...meta, variables: [...meta.variables], ...(index === 0 ? { expands: update % 2 === 0 } : {}) }));
      await render();
    }
    const factories = counters.factories;
    const requests = counters.requests;
    if (!baseline) {
      assert.equal(factories, MAX_COMPONENTS); assert.equal(requests, MAX_COMPONENTS); assert.equal(counters.stopped, 0);
      assert.equal(components[1].render(metadata[1]), first[1]);
    }
    metadata[1] = { ...metadata[1], variables: ["OTHER_KEY"] };
    await render(); assert.equal(counters.factories, factories + 1); assert.deepEqual([...counters.variables.at(-1)], ["OTHER_KEY"]);
    metadata[1] = { ...metadata[1], version: 2 };
    await render(); assert.equal(counters.factories, factories + 2);
    metadata[1] = { ...metadata[1], variables: undefined };
    await render(); assert.deepEqual([...counters.variables.at(-1)], []);
    assert.ok(components.every((component) => component.errors.every((error) => error === "")));
    components.forEach((component) => component.unmount());
    assert.equal(counters.stopped, counters.requests);
    console.log(JSON.stringify({ issue: "component-unchanged-variables", baseline, components: MAX_COMPONENTS, metadataBroadcasts: 20, factories, startupRequests: requests }));
  }
});
