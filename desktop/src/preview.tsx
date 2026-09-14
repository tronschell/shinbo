import { Minimap } from "./minimap";
import { useEffect, useRef, useState } from "react";
import { FRONTMATTER, isKeepKind, keepKindLabel, parseFrontmatter } from "../shared/vault";
import { zoned } from "./dates";
import { tokenize } from "./highlight";
import { Markdown } from "./markdown";
import { OpenIn } from "./editors";
import { TextIcon } from "./icons";

const PREVIEW_EVENT = "shinbo:preview-file";

export function openPreview(path: string, name?: string, image?: string) {
  dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: { path, name, image } }));
}

const extension = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();
export const isMarkdown = (path: string) => /^(md|markdown|mdx)$/.test(extension(path));
const isHtml = (path: string) => /^(html?|xhtml)$/.test(extension(path));
const isAbsolutePath = (path: string) => /^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(path);
const pathName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

export function ReadMarkdown({ folderId, path, name }: { folderId?: string; path: string; name?: string }) {
  if (!isMarkdown(path)) return null;
  const open = () => {
    if (isAbsolutePath(path) || !folderId) { openPreview(path, name); return; }
    void window.shinbo.listFolders()
      .then((grants) => {
        const root = grants.find((grant) => grant.id === folderId)?.path;
        if (root) openPreview(`${root.replace(/[\\/]$/, "")}/${path}`, name ?? pathName(path));
      })
      .catch(() => undefined);
  };
  return <button type="button" className="md-read" title={`Read ${path} as Markdown`} aria-label={`Read ${path} as Markdown`}
    onClick={(event) => { event.preventDefault(); open(); }}><TextIcon /></button>;
}

const savedFormat = zoned({ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const host = (url: string) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; } };

function Prose({ text, embed }: { text: string; embed?: string }) {
  const fields = parseFrontmatter(text);
  const body = text.slice(FRONTMATTER.exec(text)?.[0].length ?? 0)
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (whole, name: string) => embed ? `![${name}](${embed})` : whole);
  const title = typeof fields?.title === "string" ? fields.title : "";
  const kind = typeof fields?.kind === "string" && isKeepKind(fields.kind) ? fields.kind : "";
  const saved = typeof fields?.saved === "string" && !Number.isNaN(Date.parse(fields.saved)) ? fields.saved : "";
  const source = typeof fields?.source === "string" ? fields.source : "";
  const tags = Array.isArray(fields?.tags) ? fields.tags : [];
  const strip = kind || saved || source || tags.length > 0;
  return <div className="message-body preview-prose">
    {strip && <div className="preview-meta">
      {kind && <em data-kind={kind}>{keepKindLabel(kind)}</em>}
      {saved && <time dateTime={saved}>{savedFormat(new Date(saved))}</time>}
      {source && <a href={source} title={source} target="_blank" rel="noreferrer">{host(source)}</a>}
      {tags.length > 0 && <span className="preview-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</span>}
    </div>}
    {title && <h1>{title}</h1>}
    <Markdown text={body} />
  </div>;
}

function Body({ path, name, text, image, source, embed }: { path: string; name: string; text: string; image?: string; source: boolean; embed?: string }) {
  if (image) return <img className="preview-image" src={image} alt={name} />;
  if (isMarkdown(path) && !source) return <Prose text={text} {...(embed ? { embed } : {})} />;
  if (isHtml(path) && !source) return <iframe className="preview-frame" title={`Preview of ${path}`} sandbox="" srcDoc={text} />;
  return <pre className="preview-code"><code>{tokenize(text, extension(path)).map((token, at) =>
    <span key={at} className={token.kind && `tok-${token.kind}`}>{token.text}</span>)}</code></pre>;
}

export function PreviewHost() {
  const [asked, setAsked] = useState<{ path: string; name?: string; image?: string } | null>(null);
  const [file, setFile] = useState<{ path: string; text: string | null; image?: string | null } | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const open = (event: Event) => { setAsked((event as CustomEvent<{ path: string; name?: string; image?: string }>).detail); setSource(false); setError(""); setFile(null); };
    addEventListener(PREVIEW_EVENT, open);
    return () => removeEventListener(PREVIEW_EVENT, open);
  }, []);

  useEffect(() => {
    if (!asked) return;
    let active = true;
    void window.shinbo.previewPath(asked.path)
      .then((found) => { if (!active) return; if (found) setFile(found); else setError("Shinbo cannot find that file on this computer."); })
      .catch(() => { if (active) setError("That file could not be read."); });
    return () => { active = false; };
  }, [asked]);

  useEffect(() => {
    if (asked && !dialog.current?.open) dialog.current?.showModal();
    if (!asked && dialog.current?.open) dialog.current?.close();
  }, [asked]);

  if (!asked) return null;
  const close = () => setAsked(null);
  const shown = file?.path ?? asked.path;
  const called = asked.name ?? pathName(shown);
  const toggleable = !!file?.text && (isMarkdown(shown) || isHtml(shown));

  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="preview-title" onClose={close}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="agent-dialog preview-dialog">
      <header>
        <h2 id="preview-title">{called}</h2>
        <div>
          {toggleable && <button type="button" className="preview-toggle" onClick={() => setSource((current) => !current)}>{source ? "Rendered" : "Source"}</button>}
          {file && <OpenIn path={shown} label />}
          <button type="button" className="preview-close" onClick={close} aria-label="Close preview">×</button>
        </div>
      </header>
      <button type="button" className="preview-location" title="Reveal in the file manager" onClick={() => void window.shinbo.revealPath(shown).then((ok) => { if (!ok) setError("Shinbo can only reveal files inside a connected folder or attached to a message."); }).catch(() => setError("That file could not be revealed."))}>{shown}</button>
      {error && <p className="dialog-error">{error}</p>}
      {file && file.text === null && !file.image && !error && <p className="preview-empty">Shinbo can only read files inside a connected folder or attached to a message, and only text under 256 KB. Connect its folder or attach it to a message to open it here.</p>}
      {(file?.text != null || file?.image) && <Minimap key={shown} className="preview-body"><Body path={shown} name={called} text={file.text ?? ""} {...(file.image ? { image: file.image } : {})} {...(asked.image ? { embed: asked.image } : {})} source={source} /></Minimap>}
    </section>
  </dialog>;
}
