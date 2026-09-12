

















import { Component, createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState, type FunctionComponent, type ReactNode } from "react";
import { artifactModuleUrl, mountable, type ArtifactSurface } from "../shared/artifacts";
import { reasonText } from "./errors";




export const runtime = { h: createElement, Fragment, useState, useEffect, useMemo, useRef, useCallback, shinbo: window.shinbo };

type Loaded = { key: string; title: string; Component: FunctionComponent<Record<string, unknown>> };









function useRegionModule(name: ArtifactSurface, onError: (why: string) => void) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const found = (await window.shinbo.listArtifacts()).find((item) => item.surface === name && mountable(item.kind));
      if (!active) return;
      if (!found) { setLoaded(null); return; }
      const key = `${found.id}:${found.version}`;


      const module = await import(                   artifactModuleUrl(found.id, found.version)) as { default?: unknown };
      if (!active) return;
      if (typeof module.default !== "function") throw new Error("A region module has to `export default` a function: it is handed { h, useState, shinbo } and returns the component.");
      const Component = (module.default as (api: typeof runtime) => unknown)(runtime);
      if (typeof Component !== "function") throw new Error("The default export returned " + typeof Component + ". It has to return a component — a function of props that returns h(...).");
      setLoaded({ key, title: found.title, Component: Component as FunctionComponent<Record<string, unknown>> });
    };
    const run = () => void load().catch((error: unknown) => {
      if (!active) return;


      setLoaded(null);
      onError(reasonText(error));
    });
    run();
    const stop = window.shinbo.onArtifactsChanged(() => { onError(""); run(); });
    return () => { active = false; stop(); };
  }, [name, onError]);
  return loaded;
}







export function Region({ name, props, children }: { name: ArtifactSurface; props: Record<string, unknown>; children: ReactNode }) {
  const [error, setError] = useState("");

  const report = useCallback((why: string) => setError(why), []);
  const loaded = useRegionModule(name, report);
  return <>
    {error && <p className="region-error" role="status">Shinbo’s {name} could not run, so the built-in is back · {error}</p>}
    {loaded


      ? <RegionBoundary key={loaded.key} fallback={children} onError={report}>
        <loaded.Component {...props} />
      </RegionBoundary>
      : children}
  </>;
}

export class RegionBoundary extends Component<{ fallback: ReactNode; onError: (why: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { this.props.onError(reasonText(error)); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
