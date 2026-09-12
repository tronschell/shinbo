import { useEffect, useRef, useState } from "react";
import { VISUAL_HEIGHT_MESSAGE, VISUAL_PICK_MESSAGE, VISUAL_PICKED_MESSAGE, visualFrameUrl, visualPage, type Visual as Drawn } from "../shared/visualize";
import type { ContextPick } from "../shared/folders";
import { reasonText } from "./errors";
import { MoreIcon } from "./icons";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 760;
const DEFAULT_WIDTH = 720;

type VisualProps = { id: string; onKept: (artifactId: string) => void; onPicked: (pick: ContextPick) => void };

export function Visual(props: VisualProps) {
  return <VisualFrame key={props.id} {...props} />;
}

function VisualFrame({ id, onKept, onPicked }: VisualProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [renderState, setRenderState] = useState<"loading" | "ready" | "unconfirmed" | "failed">("loading");
  const [failure, setFailure] = useState("");
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    const timeout = window.setTimeout(() => {
      if (alive) setRenderState((state) => state === "loading" ? "unconfirmed" : state);
    }, 15000);
    void window.shinbo.readVisual(id)
      .then((visual) => { if (alive) setDrawn(visual); })
      .catch((error) => {
        if (!alive) return;
        setFailure(reasonText(error));
        setRenderState("failed");
      });
    return () => { alive = false; window.clearTimeout(timeout); };
  }, [id]);

  useEffect(() => {
    const heard = (event: MessageEvent) => {
      const page = frame.current?.contentWindow;
      const said = event.data as { shinbo?: unknown; height?: unknown; label?: unknown; html?: unknown };
      if (!page || event.source !== page) return;
      if (said?.shinbo === VISUAL_HEIGHT_MESSAGE && typeof said.height === "number" && Number.isFinite(said.height) && said.height > 0) {
        setRenderState((state) => state === "failed" ? state : "ready");
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(said.height))));
        return;
      }
      if (said?.shinbo !== VISUAL_PICKED_MESSAGE || typeof said.label !== "string" || typeof said.html !== "string") return;
      const title = typeof drawn === "object" && drawn ? drawn.title : "Picture";
      onPicked({ kind: "visual", id: `${id}:${said.label}`, title, label: said.label, html: said.html });
      setNote(`${said.label} is attached to your next message.`);
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [id, drawn, onPicked]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ shinbo: VISUAL_PICK_MESSAGE, on: picking }, "*");
  }, [picking]);

  const loading = renderState === "loading";
  const status = renderState === "failed" ? `Couldn’t load this picture. ${failure}`
    : renderState === "unconfirmed" ? "This picture hasn’t confirmed it is ready."
    : drawn ? "Rendering picture…" : "Loading picture…";

  if (!drawn) return <p className="visual-missing inline-activity" data-running={loading || undefined} role="status">{status}</p>;

  const run = async (label: string, work: () => Promise<string>) => {
    setBusy(label);
    setNote("");
    try { setNote(await work()); }
    catch (error) { setNote(reasonText(error)); }
    finally { setBusy(""); }
  };

  const exportPng = () => run("Exporting", async () => {
    const saved = await window.shinbo.exportVisual(id, frame.current?.clientWidth || DEFAULT_WIDTH);
    return saved ? `Saved to ${saved}` : "";
  });

  const keep = () => run("Keeping", async () => {
    const artifact = await window.shinbo.saveArtifact({ title: drawn.title, kind: "html", content: visualPage(drawn.html) });
    onKept(artifact.id);
    return `Kept as the artifact "${artifact.title}".`;
  });

  return <figure className="visual" aria-label={drawn.title} aria-busy={loading}>
    <div className="visual-actions" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }}>
      <button ref={trigger} type="button" className="visual-more" aria-label={`More for ${drawn.title}`} aria-expanded={open} title="More" onClick={() => setOpen(!open)}><MoreIcon /></button>
      {open && <div className="visual-options" aria-label="Visualization actions">
        <button type="button" aria-pressed={picking} disabled={!!busy} onClick={() => { setOpen(false); trigger.current?.focus(); setPicking(!picking); setNote(picking ? "" : "Point at a part of the picture to attach it to your next message."); }} title="Point at a part of this to ask for a change">{picking ? "Done editing" : "Edit"}</button>
        <button type="button" disabled={!!busy} onClick={() => { setOpen(false); trigger.current?.focus(); void exportPng(); }} title="Save a PNG of the whole thing">{busy === "Exporting" ? "Exporting…" : "Export"}</button>
        <button type="button" disabled={!!busy} onClick={() => { setOpen(false); trigger.current?.focus(); void keep(); }} title="Keep this on the Artifacts page">{busy === "Keeping" ? "Keeping…" : "Keep"}</button>
      </div>}
    </div>
    <iframe ref={frame} title={drawn.title} sandbox="allow-scripts" src={visualFrameUrl(id)} style={{ height }} onError={() => { setFailure("The picture frame could not load."); setRenderState("failed"); }} onLoad={() => { if (picking) frame.current?.contentWindow?.postMessage({ shinbo: VISUAL_PICK_MESSAGE, on: true }, "*"); }} />
    {renderState !== "ready" && <figcaption className="inline-activity" data-running={loading || undefined} role="status">{status}</figcaption>}
    {(busy || note) && <figcaption className="inline-activity" data-running={!!busy || undefined} role="status">{busy ? `${busy}…` : note}</figcaption>}
  </figure>;
}
