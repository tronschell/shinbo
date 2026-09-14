import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { isPreviewImage, type FolderEntry, type FolderGrant } from "../shared/folders";
import { pickIntoComposer } from "./context";
import { OpenIn } from "./editors";
import { reasonText } from "./errors";
import { FileMark } from "./git";
import { tokenize } from "./highlight";
import { CaretIcon, CloseIcon, InspectorIcon } from "./icons";
import { Markdown } from "./markdown";

export const OPEN_FILE_PANE_EVENT = "shinbo:open-file-pane";
export type OpenFileRequest = { folderId: string; path: string; line?: number };
export const openFilePane = (request: OpenFileRequest) => dispatchEvent(new CustomEvent(OPEN_FILE_PANE_EVENT, { detail: request }));

type FileTab = { folderId: string; path: string; text: string; saved: string; note: string; image: string; bytes: number; preview: boolean; line: number; loaded: boolean; crlf: boolean };
type FilesState = { tabs: FileTab[]; active: string; expanded: string[]; entries: Record<string, FolderEntry[]> };

const ROW_HEIGHT = 18;
const MATCHES_SHOWN = 200;
const PREVIEW_ROWS = 500;
const HIGHLIGHT_BYTES = 128 * 1024;

const panes = new Map<string, FilesState>();

const NO_ERROR = { key: "", text: "", stale: false };

const lfText = (text: string) => text.replace(/\r\n/g, "\n");

const eolText = (text: string, crlf: boolean) => crlf ? text.replace(/\n/g, "\r\n") : text;

const escaped = (text: string) => text.replace(/[&<>]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;");

const tabKey = (file: { folderId: string; path: string }) => `${file.folderId}:${file.path}`;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const fileLanguage = (path: string) => {
  const dot = baseName(path).lastIndexOf(".");
  return dot > 0 ? baseName(path).slice(dot + 1).toLowerCase() : "";
};

const isProse = (path: string) => /^(md|markdown)$/.test(fileLanguage(path));

const isTable = (path: string) => /^(csv|tsv)$/.test(fileLanguage(path));

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

const kilobytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

function tableRows(text: string, separator: string): string[][] {
  const rows: string[][] = [[""]];
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    const row = rows[rows.length - 1];
    if (quoted && char === "\"" && text[at + 1] === "\"") { row[row.length - 1] += "\""; at += 1; continue; }
    if (char === "\"") { quoted = !quoted; continue; }
    if (!quoted && char === separator) { row.push(""); continue; }
    if (!quoted && char === "\n") { rows.push([""]); continue; }
    if (!quoted && char === "\r") continue;
    row[row.length - 1] += char;
  }
  const last = rows[rows.length - 1];
  if (rows.length > 1 && last.length === 1 && !last[0]) rows.pop();
  return rows;
}

function openTab(current: FilesState, ask: OpenFileRequest): FilesState {
  const key = tabKey(ask);
  const line = ask.line ?? 0;
  return {
    ...current,
    active: key,
    tabs: current.tabs.some((tab) => tabKey(tab) === key)
      ? current.tabs.map((tab) => tabKey(tab) === key ? { ...tab, line } : tab)
      : [...current.tabs, { folderId: ask.folderId, path: ask.path, text: "", saved: "", note: "", image: "", bytes: 0, preview: false, line, loaded: false, crlf: false }],
  };
}

function closeTab(current: FilesState, key: string): FilesState {
  const tabs = current.tabs.filter((tab) => tabKey(tab) !== key);
  const last = tabs[tabs.length - 1];
  return { ...current, tabs, active: current.active === key ? (last ? tabKey(last) : "") : current.active };
}

const dirty = (tab: FileTab) => tab.loaded && !tab.image && !tab.note && tab.text !== tab.saved;

function treeMove(event: KeyboardEvent<HTMLUListElement>, focus: (key: string) => void) {
  if (!/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(event.key)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button.files-row")];
  const here = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (here < 0) return;
  event.preventDefault();
  const item = rows[here].closest("li");
  const expanded = item?.getAttribute("aria-expanded");
  if ((event.key === "ArrowRight" && expanded === "false") || (event.key === "ArrowLeft" && expanded === "true")) { rows[here].click(); return; }
  const next = event.key === "ArrowLeft" ? item?.parentElement?.closest("li")?.querySelector<HTMLButtonElement>("button.files-row")
    : event.key === "Home" ? rows[0]
    : event.key === "End" ? rows[rows.length - 1]
    : rows[here + (event.key === "ArrowUp" ? -1 : 1)];
  if (!next) return;
  next.focus();
  focus(next.dataset.key ?? "");
}

function Branch({ folderId, dir, depth, pane, cursor, toggle, open, focus }: { folderId: string; dir: string; depth: number; pane: FilesState; cursor: string; toggle: (folderId: string, path: string) => void; open: (ask: OpenFileRequest) => void; focus: (key: string) => void }) {
  const entries = pane.entries[`${folderId}:${dir}`];
  if (!entries) return <p className="files-empty">Reading…</p>;
  if (!entries.length) return <p className="files-empty">Empty</p>;
  return <ul role="group">{entries.map((entry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    const key = `${folderId}:${path}`;
    const unfolded = pane.expanded.includes(key);
    return <li key={key} role="treeitem" aria-expanded={entry.kind === "dir" ? unfolded : undefined} aria-selected={pane.active === key}>
      <button type="button" className={`files-row ${pane.active === key ? "active" : ""}`} style={{ "--files-depth": depth } as CSSProperties} title={path}
        data-key={key} tabIndex={cursor === key ? 0 : -1}
        onClick={() => { focus(key); return entry.kind === "dir" ? toggle(folderId, path) : open({ folderId, path }); }}>
        {entry.kind === "dir"
          ? <span className={`files-twist ${unfolded ? "open" : ""}`} aria-hidden="true"><CaretIcon /></span>
          : <FileMark path={path} />}
        <span className="files-name">{entry.name}</span>
      </button>
      {entry.kind === "dir" && unfolded && <Branch folderId={folderId} dir={path} depth={depth + 1} pane={pane} cursor={cursor} toggle={toggle} open={open} focus={focus} />}
    </li>;
  })}</ul>;
}

function Editor({ tab, onChange, onSave, onPick }: { tab: FileTab; onChange: (text: string) => void; onSave: () => void; onPick: (value: { text: string; from: number; to: number }) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const painted = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const [selection, setSelection] = useState({ text: "", from: 0, to: 0 });
  const html = useMemo(() => `${tokenize(tab.text, fileLanguage(tab.path), HIGHLIGHT_BYTES)
    .map((token) => token.kind ? `<span class="tok-${token.kind}">${escaped(token.text)}</span>` : escaped(token.text)).join("")}\n`, [tab.text, tab.path]);
  const numbers = useMemo(() => Array.from({ length: tab.text.split("\n").length }, (_, at) => at + 1).join("\n"), [tab.text]);
  const sync = useCallback(() => {
    const source = area.current;
    if (!source) return;
    if (painted.current) { painted.current.scrollTop = source.scrollTop; painted.current.scrollLeft = source.scrollLeft; }
    if (gutter.current) gutter.current.scrollTop = source.scrollTop;
  }, []);
  useEffect(() => {
    const source = area.current;
    if (!source || !tab.line) return;
    source.scrollTop = Math.max(0, (tab.line - 1) * ROW_HEIGHT - source.clientHeight / 3);
    sync();
  }, [tab.line, tab.loaded, sync]);
  return <div className="files-editor">
    <pre className="files-gutter" ref={gutter} aria-hidden="true">{numbers}</pre>
    <div className="files-code">
      <pre className="files-paint" ref={painted} aria-hidden="true">
        {tab.line > 0 && <span className="files-line" style={{ "--files-line": tab.line - 1 } as CSSProperties} />}
        <span dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <textarea ref={area} className="files-text" value={tab.text} spellCheck={false} wrap="off" aria-label={`Edit ${tab.path}`}
        onChange={(event) => onChange(event.currentTarget.value)}
        onScroll={sync}
        onSelect={(event) => {
          const source = event.currentTarget;
          const text = source.value.slice(source.selectionStart, source.selectionEnd);
          setSelection(text ? { text, from: lineAt(source.value, source.selectionStart), to: lineAt(source.value, source.selectionEnd) } : { text: "", from: 0, to: 0 });
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); onSave(); return; }
          if (event.key !== "Tab" || event.shiftKey) return;
          if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return;
          event.preventDefault();
          document.execCommand("insertText", false, "  ");
        }} />
      {selection.text && <button type="button" className="files-add" onMouseDown={(event) => event.preventDefault()}
        onClick={() => { onPick(selection); setSelection({ text: "", from: 0, to: 0 }); }}>Add to chat</button>}
    </div>
  </div>;
}

export function FilesPane({ threadId, folders, folderIds, ask, onConsumed, wide, onToggleWide, onClose }: { threadId: string; folders: FolderGrant[]; folderIds: string[]; ask?: OpenFileRequest; onConsumed: () => void; wide: boolean; onToggleWide: () => void; onClose: () => void }) {
  const [pane, setPane] = useState<FilesState>(() => panes.get(threadId) ?? { tabs: [], active: "", expanded: folderIds[0] ? [`${folderIds[0]}:`] : [], entries: {} });
  const [query, setQuery] = useState("");
  const [listings, setListings] = useState<Record<string, { paths: string[]; capped: boolean }>>({});
  const [shape, setShape] = useState({ key: "", text: "" });
  const [error, setError] = useState(NO_ERROR);
  const [asked, setAsked] = useState<OpenFileRequest>();
  const [stamp, setStamp] = useState(0);
  const [cursor, setCursor] = useState("");
  const walked = useRef(new Set<string>());
  useEffect(() => { panes.set(threadId, pane); }, [threadId, pane]);
  const roots = useMemo(() => folderIds.map((id) => folders.find((grant) => grant.id === id)).filter((grant) => !!grant), [folders, folderIds]);
  const open = useCallback((request: OpenFileRequest) => { setError(NO_ERROR); setPane((current) => openTab(current, request)); }, []);
  const toggle = useCallback((folderId: string, path: string) => setPane((current) => {
    const key = `${folderId}:${path}`;
    if (!current.expanded.includes(key)) return { ...current, expanded: [...current.expanded, key] };
    const entries = { ...current.entries };
    delete entries[key];
    return { ...current, expanded: current.expanded.filter((item) => item !== key), entries };
  }), []);
  const patch = useCallback((key: string, change: Partial<FileTab>) =>
    setPane((current) => ({ ...current, tabs: current.tabs.map((tab) => tabKey(tab) === key ? { ...tab, ...change } : tab) })), []);
  useEffect(() => {
    const missing = pane.expanded.filter((key) => !pane.entries[key]);
    if (!missing.length) return;
    let live = true;
    const settle = (key: string, entries: FolderEntry[]) => { if (live) setPane((current) => ({ ...current, entries: { ...current.entries, [key]: entries } })); };
    for (const key of missing) {
      const at = key.indexOf(":");
      void window.shinbo.listFolderEntries({ folderId: key.slice(0, at), path: key.slice(at + 1) })
        .then((entries) => settle(key, entries))
        .catch(() => settle(key, []));
    }
    return () => { live = false; };
  }, [pane.expanded, pane.entries]);
  if (ask && ask !== asked) {
    setAsked(ask);
    if (folderIds.includes(ask.folderId)) setPane((current) => openTab(current, ask));
  }
  useEffect(() => { if (ask) onConsumed(); }, [ask, onConsumed]);
  useEffect(() => {
    const listener = window.shinbo.onChanged(() => setStamp((count) => count + 1));
    return () => window.shinbo.offChanged(listener);
  }, []);
  useEffect(() => {
    if (!stamp) return;
    let live = true;
    for (const key of panes.get(threadId)?.expanded ?? []) {
      const at = key.indexOf(":");
      void window.shinbo.listFolderEntries({ folderId: key.slice(0, at), path: key.slice(at + 1) })
        .then((entries) => { if (live) setPane((current) => current.entries[key] ? { ...current, entries: { ...current.entries, [key]: entries } } : current); })
        .catch(() => undefined);
    }
    return () => { live = false; };
  }, [stamp, threadId]);
  const refresh = useCallback((key: string) => {
    const tab = panes.get(threadId)?.tabs.find((item) => tabKey(item) === key);
    if (!tab || !tab.loaded || tab.image || tab.note || tab.text !== tab.saved) return;
    void window.shinbo.readFolderFile({ folderId: tab.folderId, path: tab.path })
      .then((file) => {
        const now = panes.get(threadId)?.tabs.find((item) => tabKey(item) === key);
        const text = lfText(file.text);
        if (file.missing || !now || now.text !== now.saved || now.text === text) return;
        patch(key, { text, saved: text, crlf: file.text !== text, bytes: file.text.length });
      })
      .catch(() => undefined);
  }, [threadId, patch]);
  useEffect(() => { refresh(pane.active); }, [pane.active, refresh]);
  useEffect(() => {
    const wake = () => refresh(panes.get(threadId)?.active ?? "");
    addEventListener("focus", wake);
    return () => removeEventListener("focus", wake);
  }, [threadId, refresh]);
  const tab = pane.tabs.find((item) => tabKey(item) === pane.active);
  useEffect(() => {
    if (!tab || tab.loaded) return;
    let live = true;
    const key = tabKey(tab);
    const settle = (change: Partial<FileTab>) => { if (live) patch(key, { loaded: true, ...change }); };
    if (isPreviewImage(tab.path)) {
      void window.shinbo.readFolderBlob({ folderId: tab.folderId, path: tab.path })
        .then((blob) => settle({ image: blob.dataUrl, bytes: blob.bytes }))
        .catch((reason: unknown) => settle({ note: reasonText(reason) }));
      return () => { live = false; };
    }
    void window.shinbo.readFolderFile({ folderId: tab.folderId, path: tab.path })
      .then((file) => { const text = lfText(file.text); settle(file.missing ? { note: "That file is no longer there." }
        : file.text.slice(0, 8192).includes("\u0000") ? { note: "Binary file" }
        : { text, saved: text, crlf: file.text !== text, bytes: file.text.length }); })
      .catch((reason: unknown) => settle({ note: /cannot be attached/.test(reasonText(reason)) ? "Too large to open here" : reasonText(reason) }));
    return () => { live = false; };
  }, [tab, patch]);
  useEffect(() => {
    if (!query.trim()) return;
    let live = true;
    for (const grant of roots) {
      const mark = `${stamp}:${grant.id}`;
      if (walked.current.has(mark)) continue;
      walked.current.add(mark);
      void window.shinbo.listFolderPaths(grant.id)
        .then((found) => { if (live) setListings((current) => ({ ...current, [grant.id]: found })); })
        .catch(() => { if (live) setListings((current) => ({ ...current, [grant.id]: { paths: [], capped: false } })); });
    }
    return () => { live = false; };
  }, [query, roots, stamp]);
  const matches = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return [];
    const found = new Map<string, OpenFileRequest>();
    for (const grant of roots) for (const path of listings[grant.id]?.paths ?? []) if (path.toLowerCase().includes(wanted)) found.set(`${grant.id}:${path}`, { folderId: grant.id, path });
    return [...found.values()].slice(0, MATCHES_SHOWN);
  }, [query, roots, listings]);
  const close = (key: string, name: string) => {
    const doomed = pane.tabs.find((item) => tabKey(item) === key);
    if (doomed && dirty(doomed) && !confirm(`Discard changes to ${name}?`)) return;
    setPane((current) => closeTab(current, key));
  };
  const save = (file: FileTab) => {
    setError(NO_ERROR);
    void window.shinbo.writeFolderFile({ folderId: file.folderId, path: file.path, text: eolText(file.text, file.crlf), previous: eolText(file.saved, file.crlf), threadId })
      .then(() => patch(tabKey(file), { saved: file.text }))
      .catch((reason: unknown) => {
        const text = reasonText(reason);
        setError({ key: tabKey(file), text, stale: /changed on disk/.test(text) });
      });
  };
  const grant = tab && folders.find((item) => item.id === tab.folderId);
  const crumbs = tab ? [grant?.name ?? "folder", ...tab.path.split("/")] : [];
  const toggles = tab && tab.loaded && !tab.note && !tab.image && (isProse(tab.path) || isTable(tab.path));
  return <section className="files-pane artifact-pane" aria-label="Files pane">
    <header>
      <div className="files-tabs" role="tablist" aria-label="Open files">
        {pane.tabs.map((item) => {
          const key = tabKey(item);
          return <span className={`files-tab ${key === pane.active ? "active" : ""}`} key={key}>
            <button type="button" role="tab" aria-selected={key === pane.active} title={item.path} onClick={() => setPane((current) => ({ ...current, active: key }))}>
              <FileMark path={item.path} />
              <span>{baseName(item.path)}</span>
              {dirty(item) && <i className="files-dot" aria-label="Unsaved changes" />}
            </button>
            <button type="button" className="files-tab-close" aria-label={`Close ${baseName(item.path)}`} onClick={() => close(key, baseName(item.path))}>×</button>
          </span>;
        })}
      </div>
      <button type="button" className="artifact-icon" aria-label={wide ? "Narrow pane" : "Widen pane"} aria-pressed={wide} onClick={onToggleWide}><InspectorIcon /></button>
      <button type="button" className="artifact-icon" aria-label="Close pane" onClick={onClose}><CloseIcon /></button>
    </header>
    <div className="files-crumbs">
      <span className="files-crumb">{crumbs.map((part, at) => <span key={at}>{part}</span>)}</span>
      {tab?.image && <small>{shape.key === pane.active ? `${shape.text} · ` : ""}{kilobytes(tab.bytes)}</small>}
      {toggles && <button type="button" className="files-preview" aria-pressed={tab.preview} onClick={() => patch(pane.active, { preview: !tab.preview })}>Preview</button>}
      {tab && <OpenIn folderId={tab.folderId} path={tab.path} />}
    </div>
    <div className="files-body">
      <div className="files-main">
        {error.text && error.key === pane.active && <p className="capability-error" role="alert">{error.text}
          {error.stale && <button type="button" className="files-preview" onClick={() => { patch(error.key, { loaded: false, text: "", saved: "" }); setError(NO_ERROR); }}>Reload</button>}</p>}
        {!tab && <p className="project-empty">{roots.length ? "Pick a file from the tree." : "Connect a folder to browse its files."}</p>}
        {tab?.note && <p className="project-empty">{tab.note}</p>}
        {tab?.image && <div className="files-image"><img src={tab.image} alt={tab.path} onLoad={(event) => setShape({ key: tabKey(tab), text: `${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}` })} /></div>}
        {tab && tab.loaded && !tab.note && !tab.image && (tab.preview
          ? isTable(tab.path)
            ? <div className="files-table"><table><tbody>{tableRows(tab.text, fileLanguage(tab.path) === "tsv" ? "\t" : ",").slice(0, PREVIEW_ROWS).map((row, at) => <tr key={at}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>
            : <div className="message-body files-prose"><Markdown text={tab.text} /></div>
          : <Editor key={tabKey(tab)} tab={tab} onChange={(text) => patch(tabKey(tab), { text, line: 0 })} onSave={() => save(tab)}
            onPick={(selection) => pickIntoComposer({ kind: "selection", id: crypto.randomUUID(), folderId: tab.folderId, path: tab.path, text: selection.text, from: selection.from, to: selection.to })} />)}
      </div>
      <div className="files-tree">
        <div className="files-filter">
          <label className="sr-only" htmlFor="files-filter">Filter files</label>
          <input id="files-filter" value={query} spellCheck={false} placeholder="Filter files…" onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="Clear the filter" onClick={() => setQuery("")}>×</button>}
        </div>
        {!roots.length && <p className="project-empty">Connect a folder to browse its files.</p>}
        {query.trim()
          ? <ul className="files-matches">{matches.map((match) => <li key={`${match.folderId}:${match.path}`}>
            <button type="button" className={`files-row ${tabKey(match) === pane.active ? "active" : ""}`} title={match.path} onClick={() => open(match)}>
              <FileMark path={match.path} /><span className="files-name">{match.path}</span>
            </button>
          </li>)}{!matches.length && <li><p className="files-empty">{roots.every((root) => listings[root.id]) ? "Nothing matches" : "Reading…"}</p></li>}
          {roots.some((root) => listings[root.id]?.capped) && <li><p className="files-empty">Showing the first {roots.reduce((total, root) => total + (listings[root.id]?.paths.length ?? 0), 0)} files</p></li>}</ul>
          : <ul role="tree" aria-label="Files" onKeyDown={(event) => treeMove(event, setCursor)}>{roots.map((root) => {
            const key = `${root.id}:`;
            const unfolded = pane.expanded.includes(key);
            return <li key={root.id} role="treeitem" aria-expanded={unfolded}>
              <button type="button" className="files-row files-root" title={root.path} data-key={key} tabIndex={(cursor || `${roots[0].id}:`) === key ? 0 : -1} onClick={() => { setCursor(key); toggle(root.id, ""); }}>
                <span className={`files-twist ${unfolded ? "open" : ""}`} aria-hidden="true"><CaretIcon /></span>
                <span className="files-name">{root.name}</span>
              </button>
              {unfolded && <Branch folderId={root.id} dir="" depth={1} pane={pane} cursor={cursor || `${roots[0].id}:`} toggle={toggle} open={open} focus={setCursor} />}
            </li>;
          })}</ul>}
      </div>
    </div>
  </section>;
}
