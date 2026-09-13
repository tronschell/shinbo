import { useCallback, useEffect, useRef, useState } from "react";
import { blankPage, browserDestination } from "../shared/browser";
import type { LocalServer } from "../shared/browser";
import type { PipWindow } from "./pip";
import type { BrowserStatus, BrowserTab } from "./types";

const BLANK: BrowserStatus = { running: false, loading: false, canGoBack: false, canGoForward: false, tabs: [] };

function NavIcon({ path, size = 15 }: { path: string; size?: number }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

const BACK = "M10 3.5 5.5 8l4.5 4.5";
const FORWARD = "M6 3.5 10.5 8 6 12.5";
const RELOAD = "M13.2 6.6A5.4 5.4 0 1 0 13.4 9M13.4 2.8v3.8h-3.8";
const PLUS = "M8 3.4v9.2M3.4 8h9.2";
const CLOSE = "M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6";
const HIDE = "M3 8h10";
const MORE = "M8 3.6h.01M8 8h.01M8 12.4h.01";
const FLOAT = "M2.5 3.4h11v9.2h-11zM8.2 8h4.2v3.6H8.2z";
const CLIPS = "M6.3 3.4H4.5v9.1h7V3.4H9.7M6.4 2.2h3.2v2.2H6.4z";
export function FloatIcon({ size = 12 }: { size?: number }) {
  return <NavIcon path={FLOAT} size={size} />;
}

function PopoutIcon({ size = 12 }: { size?: number }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true"><rect x="2.4" y="2.8" width="11.2" height="10.4" rx="2" /><rect x="7.8" y="8" width="4.4" height="3.4" rx="1" fill="currentColor" stroke="none" /></svg>;
}

function ViewMenu({ wide, floating, onToggleWide, onFloat }: { wide?: boolean; floating?: boolean; onToggleWide?: () => void; onFloat?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [open]);
  const pick = (run?: () => void) => { setOpen(false); run?.(); };
  return <div className="browser-view-menu" ref={box} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
    <button type="button" className="browser-icon" aria-label="View options" title="View options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><PopoutIcon size={13} /></button>
    {open && <section className="source-popover pane-menu browser-view-options" role="menu" aria-label="Browser view">
      {onToggleWide && <button type="button" role="menuitem" autoFocus onClick={() => pick(onToggleWide)}><strong>{wide ? "Narrow" : "Expand"}</strong><small>{wide ? "Shrink the browser column" : "Widen the browser column"}</small></button>}
      {onFloat && <button type="button" role="menuitem" onClick={() => pick(onFloat)}><strong>{floating ? "Dock" : "Pop out"}</strong><small>{floating ? "Return it to the side panel" : "Float it in a picture-in-picture window"}</small></button>}
    </section>}
  </div>;
}

function BrowserStart({ onOpen }: { onOpen: (url: string) => void }) {
  const [servers, setServers] = useState<LocalServer[]>();
  useEffect(() => {
    let alive = true;
    void window.shinbo.browserServers().then((found) => { if (alive) setServers(found); }).catch(() => { if (alive) setServers([]); });
    return () => { alive = false; };
  }, []);
  return <div className="browser-start">
    <p className="browser-start-head">Local servers</p>
    {servers === undefined
      ? <p className="browser-start-hint">Looking…</p>
      : servers.length === 0
        ? <p className="browser-start-hint">Nothing is listening on this machine. Type an address, or a phrase to search Google.</p>
        : <ul className="browser-start-servers">{servers.map((server) => <li key={server.port}>
            <button type="button" onClick={() => onOpen(`http://localhost:${server.port}`)}><strong>localhost:{server.port}</strong><small>{server.process || "server"}</small></button>
          </li>)}</ul>}
  </div>;
}

const GLOBE = "M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6M1.6 8h12.8M8 1.6c1.7 1.7 2.6 3.9 2.6 6.4S9.7 12.7 8 14.4M8 1.6C6.3 3.3 5.4 5.5 5.4 8s.9 4.7 2.6 6.4";

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function tabName(tab: BrowserTab): string {
  return tab.title.trim() || host(tab.url) || "New tab";
}

export function createBrowserPlacementScheduler(
  place: () => void,
  requestFrame: (callback: () => void) => number = requestAnimationFrame,
  cancelFrame: (id: number) => void = cancelAnimationFrame,
) {
  let frame: number | undefined;
  let stopped = false;
  const schedule = () => {
    if (stopped || frame !== undefined) return;
    frame = requestFrame(() => {
      frame = undefined;
      if (!stopped) place();
    });
  };
  const stop = () => {
    stopped = true;
    if (frame !== undefined) cancelFrame(frame);
    frame = undefined;
  };
  return { schedule, stop };
}

export function browserPip(threadId: string, onClose: () => void, onDock?: () => void): PipWindow {
  return {
    id: `browser:${threadId}`,
    label: "Browser",
    icon: <NavIcon path={GLOBE} size={13} />,
    body: <BrowserPane threadId={threadId} onClose={onClose} onFloat={onDock} floating />,
  };
}

export function BrowserPane({ threadId, onHide, onClose, wide, onToggleWide, onFloat, floating }: {
  threadId: string;
  onHide?: () => void;
  onClose: () => void;
  wide?: boolean;
  onToggleWide?: () => void;
  onFloat?: () => void;
  floating?: boolean;
}) {
  const [known, setKnown] = useState<{ threadId: string; status: BrowserStatus }>();
  const [typed, setTyped] = useState<{ threadId: string; url: string }>();
  const [clips, setClips] = useState<string[]>();
  const stage = useRef<HTMLDivElement>(null);
  const sent = useRef("");
  const showing = useRef(threadId);

  useEffect(() => {
    showing.current = threadId;
    let alive = true;
    const read = () => void window.shinbo.browserStatus(threadId)
      .then((status) => { if (alive) setKnown({ threadId, status }); })
      .catch(() => { if (alive) setKnown({ threadId, status: BLANK }); });
    read();
    const stop = window.shinbo.onBrowser(read);
    return () => { alive = false; stop(); };
  }, [threadId]);

  const place = useCallback(() => {
    const box = stage.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const pip = box.closest<HTMLElement>(".pip");
    const buried = !!pip && (pip.dataset.held === "true" || pip.dataset.depth !== "0");
    const blocked = buried || !!document.querySelector("dialog[open]") || rect.width < 1 || rect.height < 1;
    const bounds = blocked ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const key = bounds ? `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}` : "";
    if (key === sent.current) return;
    sent.current = key;
    void window.shinbo.browserPlace({ threadId, bounds }).catch(() => undefined);
  }, [threadId]);

  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    sent.current = "";
    place();
    const scheduler = createBrowserPlacementScheduler(place);
    const { schedule } = scheduler;
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    const dialogs = new MutationObserver(schedule);
    dialogs.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    const shell = box.closest<HTMLElement>(".app-shell");
    const shellChanges = shell ? new MutationObserver(schedule) : undefined;
    if (shell) shellChanges?.observe(shell, { attributes: true, attributeFilter: ["style"] });
    const sidebar = shell?.querySelector<HTMLElement>(".sidebar");
    const sidebarChanges = sidebar ? new MutationObserver(schedule) : undefined;
    if (sidebar) sidebarChanges?.observe(sidebar, { attributes: true, attributeFilter: ["class", "style"] });
    const pip = box.closest<HTMLElement>(".pip");
    const pipChanges = pip ? new MutationObserver(schedule) : undefined;
    if (pip) pipChanges?.observe(pip, { attributes: true, attributeFilter: ["data-held", "data-depth", "style"] });
    addEventListener("resize", schedule);
    addEventListener("scroll", schedule, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    const transitions = new Set<string>();
    let transitionFrame: number | undefined;
    let transitioning = false;
    const track = () => {
      transitionFrame = undefined;
      if (!transitioning) return;
      place();
      transitionFrame = requestAnimationFrame(track);
    };
    const startTransition = (event: TransitionEvent) => {
      transitions.add(event.propertyName);
      if (transitioning) return;
      transitioning = true;
      transitionFrame = requestAnimationFrame(track);
    };
    const endTransition = (event: TransitionEvent) => {
      transitions.delete(event.propertyName);
      if (transitions.size) return;
      transitioning = false;
      if (transitionFrame !== undefined) cancelAnimationFrame(transitionFrame);
      transitionFrame = undefined;
      schedule();
    };
    pip?.addEventListener("transitionrun", startTransition);
    pip?.addEventListener("transitionend", endTransition);
    pip?.addEventListener("transitioncancel", endTransition);
    return () => {
      observer.disconnect();
      dialogs.disconnect();
      shellChanges?.disconnect();
      sidebarChanges?.disconnect();
      pipChanges?.disconnect();
      removeEventListener("resize", schedule);
      removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      pip?.removeEventListener("transitionrun", startTransition);
      pip?.removeEventListener("transitionend", endTransition);
      pip?.removeEventListener("transitioncancel", endTransition);
      transitioning = false;
      transitions.clear();
      if (transitionFrame !== undefined) cancelAnimationFrame(transitionFrame);
      scheduler.stop();
      void window.shinbo.browserPlace({ threadId, bounds: null }).catch(() => undefined);
    };
  }, [threadId, place]);

  const status = known?.threadId === threadId ? known.status : BLANK;
  const apply = (next: BrowserStatus) => { if (showing.current === threadId) setKnown({ threadId, status: next }); };
  const nav = (action: "back" | "forward" | "reload") =>
    void window.shinbo.browserNav({ threadId, action }).then(apply).catch(() => undefined);

  const draft = typed?.threadId === threadId ? typed.url : undefined;
  const open = (url: string) => void window.shinbo.browserOpen({ threadId, url }).then(apply).catch(() => undefined);
  const go = () => {
    const url = browserDestination(draft ?? "");
    setTyped(undefined);
    if (url) open(url);
  };

  const showClips = () => {
    if (clips) return setClips(undefined);
    void window.shinbo.browserClips().then(setClips).catch(() => setClips([]));
  };
  const reuseClip = (index: number) => {
    setClips(undefined);
    void window.shinbo.browserClipUse({ threadId, index }).catch(() => undefined);
  };

  return <section className="browser-pane" aria-label="Browser">
    <header className="browser-tabs">
      <div className="browser-tab-strip" role="tablist" aria-label="Browser tabs">
        {status.tabs.map((tab) => <div key={tab.id} className="browser-tab" data-active={tab.id === status.activeTab}>
          <button type="button" role="tab" aria-selected={tab.id === status.activeTab} title={tab.url || tabName(tab)}
            onClick={() => void window.shinbo.browserSelectTab({ threadId, tabId: tab.id }).then(apply).catch(() => undefined)}>
            {tab.favicon ? <img className="browser-favicon" src={tab.favicon} alt="" /> : <i className="browser-favicon browser-favicon-blank" aria-hidden="true" />}
            <span>{tabName(tab)}</span>
          </button>
          <button type="button" className="browser-tab-close" aria-label={`Close ${tabName(tab)}`}
            onClick={() => void window.shinbo.browserCloseTab({ threadId, tabId: tab.id }).then(apply).catch(() => undefined)}><NavIcon path={CLOSE} size={11} /></button>
        </div>)}
        <button type="button" className="browser-icon browser-new-tab" aria-label="New tab" title="New tab"
          onClick={() => void window.shinbo.browserNewTab({ threadId }).then(apply).catch(() => undefined)}><NavIcon path={PLUS} size={13} /></button>
      </div>
      <div className="browser-window-controls">
        {(onToggleWide || onFloat) && <ViewMenu wide={wide} floating={floating} onToggleWide={onToggleWide} onFloat={onFloat} />}
        {onHide && <button type="button" className="browser-icon" aria-label="Hide the browser" title="Hide — keeps the page and its cookies" onClick={onHide}><NavIcon path={HIDE} size={13} /></button>}
        <button type="button" className="browser-icon" aria-label="Close the browser" title="Close — frees what it holds" onClick={onClose}><NavIcon path={CLOSE} size={12} /></button>
      </div>
    </header>
    <nav className="browser-bar" aria-label="Page">
      <button type="button" className="browser-icon" aria-label="Back" title="Back" disabled={!status.canGoBack} onClick={() => nav("back")}><NavIcon path={BACK} /></button>
      <button type="button" className="browser-icon" aria-label="Forward" title="Forward" disabled={!status.canGoForward} onClick={() => nav("forward")}><NavIcon path={FORWARD} /></button>
      <button type="button" className="browser-icon" aria-label="Reload" title="Reload" disabled={!status.running} onClick={() => nav("reload")}><NavIcon path={RELOAD} size={13} /></button>
      {draft === undefined
        ? <button type="button" className="browser-address" title={status.url ?? "Open a page"} onClick={() => setTyped({ threadId, url: status.url ?? "" })}>
            {status.loading ? <em className="browser-loading" aria-label="Loading" /> : null}
            <span>{status.url ? host(status.url) : "Open a page"}</span>
          </button>
        : <input className="browser-address browser-address-field" autoFocus aria-label="Address" value={draft} spellCheck={false} autoComplete="off" placeholder="Search or enter address" enterKeyHint="go"
            onChange={(event) => setTyped({ threadId, url: event.target.value })}
            onBlur={() => setTyped(undefined)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); go(); }
              if (event.key === "Escape") setTyped(undefined);
            }} />}
      <button type="button" className="browser-icon" aria-label="Clipboard history" title="Clipboard history" aria-expanded={!!clips} onClick={showClips}><NavIcon path={CLIPS} size={13} /></button>
      <button type="button" className="browser-icon" aria-label="Open in a new tab" title="New tab"
        onClick={() => void window.shinbo.browserNewTab({ threadId }).then(apply).catch(() => undefined)}><NavIcon path={PLUS} size={13} /></button>
      <button type="button" className="browser-icon" aria-label="Open this page in your default browser" title="Open in your browser" disabled={!status.url}
        onClick={() => { if (status.url) void window.shinbo.openLink(status.url).catch(() => undefined); }}><NavIcon path={MORE} size={14} /></button>
    </nav>
    {clips && <ul className="browser-clips" aria-label="Clipboard history">
      {clips.length === 0
        ? <li className="browser-clips-empty">Nothing copied here yet</li>
        : clips.map((text, index) => <li key={`${index} ${text.slice(0, 32)}`}>
            <button type="button" title={text} onClick={() => reuseClip(index)}>{text.replace(/\s+/g, " ").trim()}</button>
          </li>)}
    </ul>}
    <div className="browser-stage" ref={stage} data-idle={!status.running}>
      {!status.running
        ? <div className="browser-empty">
            <p>Nothing open</p>
            <button type="button" onClick={() => void window.shinbo.browserNewTab({ threadId }).then(apply).catch(() => undefined)}>New tab</button>
          </div>
        : blankPage(status.url) ? <BrowserStart onOpen={open} /> : null}
    </div>
  </section>;
}
