









import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { axisTicks, decodeSpans, formatDuration, layoutSpans, summarizeSpans, tokenAxis, type TraceRow, type TraceSpan } from "../shared/trace";
import { charLabel } from "../shared/usage";
import { ExpandIcon, ToolIcon } from "./icons";


const TICK_MS = 500;

const OVERALL = "overall";

const LEGEND = [["agent", "Agent"], ["model", "Model"], ["tool", "Tool"], ["failed", "Failed"]] as const;

const LABEL_AFTER = 78;

const LABEL_BEFORE = 12;

const tokenLabel = (value: number) => `${charLabel(Math.round(value))} tok`;

type Turn = { key: string; label: string; spans: TraceSpan[]; live: boolean };

type Axis = "time" | "context";

export const Timeline = memo(function Timeline({ threadId, sending, carriedTokens, sample }: { threadId: string; sending: boolean; carriedTokens: number; sample?: { label: string; spans: TraceSpan[] } }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState<TraceSpan[]>([]);
  const [fetched, setFetched] = useState<Turn[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [axis, setAxis] = useState<Axis>("time");

  const take = useCallback((trees: Record<string, TraceSpan[]>) => setLive((current) => {
    const next = trees[threadId];
    return next?.length ? next : current.length ? [] : current;
  }), [threadId]);
  useEffect(() => {
    if (sample) return;
    let alive = true;
    void window.shinbo.listSpans()
      .then((trees) => { if (alive) take(trees); })
      .catch(() => undefined);
    const stop = window.shinbo.onSpans(take);
    return () => { alive = false; stop(); };
  }, [sample, take]);



  useEffect(() => {
    if (sample) return;
    let alive = true;
    void window.shinbo.threadTraces(threadId)
      .then((traces) => {
        if (!alive) return;
        setFetched(traces
          .map((trace, index): Turn => ({ key: `${trace.timestamp}-${index}`, label: new Date(trace.timestamp).toLocaleTimeString(), spans: decodeSpans(trace.text), live: false }))
          .filter((turn) => turn.spans.length));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [sample, threadId, sending]);



  const saved = useMemo(() => sample ? [{ key: "sample", label: sample.label, spans: sample.spans, live: false }] : fetched, [sample, fetched]);

  const open = live.some((span) => span.endedAt === undefined);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [open]);










  const turns = useMemo(
    () => live.length ? [...saved, { key: "live", label: sending ? "Running" : "This turn", spans: live, live: true }] : saved,
    [saved, live, sending],
  );

  const { spans, original } = useMemo(() => {
    const original = new Map<string, TraceSpan>();
    const out: TraceSpan[] = [];
    let cursor = 0;
    turns.forEach((turn, index) => {




      const close = (span: TraceSpan) => span.endedAt ?? (turn.live ? now : span.startedAt);
      const from = Math.min(...turn.spans.map((span) => span.startedAt));
      const to = Math.max(...turn.spans.map(close));
      const shift = cursor - from;
      for (const span of turn.spans) {
        const id = `${turn.key}/${span.id}`;
        original.set(id, span);
        out.push({
          ...span,
          id,


          parentId: span.parentId ? `${turn.key}/${span.parentId}` : OVERALL,
          name: span.parentId ? span.name : `Turn ${index + 1} · ${turn.label}`,
          startedAt: span.startedAt + shift,


          endedAt: close(span) + shift,
        });
      }


      cursor = to + shift;
    });
    const running = out.some((span) => original.get(span.id)?.endedAt === undefined);







    const grew = out.reduce((sum, span) => sum + (span.tokens ?? 0), 0);
    out.unshift({ id: OVERALL, name: "Overall", kind: "agent", startedAt: 0, endedAt: cursor, status: running ? "running" : "ok", tokens: Math.max(0, carriedTokens - grew) });
    return { spans: out, original };
  }, [turns, now, carriedTokens]);





  const measured = useMemo(() => (axis === "context" ? tokenAxis(spans) : spans), [axis, spans]);
  const format = axis === "context" ? tokenLabel : formatDuration;



  const rows = useMemo(() => {
    const laid = layoutSpans(measured, now, collapsed);
    if (!laid.length) return laid;
    const groups: (typeof laid)[] = [];
    for (const row of laid.slice(1)) {
      if (row.depth === 1) groups.push([row]);
      else groups[groups.length - 1]?.push(row);
    }
    return [laid[0], ...groups.reverse().flat()];
  }, [measured, now, collapsed]);
  const toggle = useCallback((id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);
  if (spans.length < 2) return <section className="trace" aria-label="Agent timeline">
    <span className="trace-title">Timeline</span>
    <p className="subagent-empty">Nothing has happened in this thread yet.</p>
  </section>;

  const list = <Rows rows={rows} original={original} now={now} format={format} collapsed={collapsed} toggle={toggle} selected={selected} select={setSelected} />;


  const agentMs = (spans[0].endedAt ?? now) - spans[0].startedAt;




  const weighed = spans.slice(1).some((span) => span.tokens);

  return <section className="trace" aria-label="Agent timeline">

    <span><span className="trace-title">Timeline{weighed && <span className="trace-axes" role="group" aria-label="What the bars measure">
      <button type="button" aria-pressed={axis === "time"} title="Bars are how long each span took" onClick={() => setAxis("time")}>Time</button>
      <button type="button" aria-pressed={axis === "context"} title="Bars are what each span added to the context window" onClick={() => setAxis("context")}>Context</button>
    </span>}<button type="button" className="trace-expand" aria-haspopup="dialog" aria-label="Expand the timeline" title="Expand the timeline" onClick={() => setExpanded(true)}><ExpandIcon /></button></span><b>{format(rows[0].durationMs)}{open ? " · running" : ""}</b></span>
    <div className="trace-scroll">{list}</div>
    {expanded && <TimelineDialog turns={turns} agentMs={agentMs} axis={axis} total={rows[0].durationMs} format={format} now={now} close={() => setExpanded(false)}>{list}</TimelineDialog>}
  </section>;
});


function Rows({ rows, original, now, format, collapsed, toggle, selected, select }: {
  rows: TraceRow[];
  original: Map<string, TraceSpan>;
  now: number;

  format: (value: number) => string;
  collapsed: ReadonlySet<string>;
  toggle: (id: string) => void;
  selected?: string;
  select: (id: string | undefined) => void;
}) {
  return <ol className="trace-rows">
    {rows.map((row) => <TimelineRow key={row.span.id} row={row} original={original.get(row.span.id) ?? row.span} now={now} format={format} shut={collapsed.has(row.span.id)} toggle={toggle} selected={selected === row.span.id} select={select} />)}
  </ol>;
}

const TimelineRow = memo(function TimelineRow({ row, original, now, format, shut, toggle, selected, select }: {
  row: TraceRow;
  original: TraceSpan;
  now: number;
  format: (value: number) => string;
  shut: boolean;
  toggle: (id: string) => void;
  selected: boolean;
  select: (id: string | undefined) => void;
}) {
  const { span, depth, offset, width, durationMs, children } = row;
  const id = span.id;
  const end = offset + width;
  const label = end <= LABEL_AFTER ? { className: "trace-bar-label", style: { left: `${end}%` } }
    : offset >= LABEL_BEFORE ? { className: "trace-bar-label trace-bar-label-before", style: { right: `${100 - offset}%` } }
    : { className: "trace-bar-label trace-bar-label-in", style: { left: `${offset}%` } };
  return <li key={span.id} className="trace-row" data-kind={span.kind === "agent" ? "agent" : span.kind === "model" ? "model" : "tool"} data-status={span.status}>

    <div className="trace-head" style={{ paddingLeft: `calc(${depth} * var(--s-3))` }}>
      {children > 0
        ? <button type="button" className="trace-caret" aria-expanded={!shut} aria-label={`${shut ? "Expand" : "Collapse"} ${span.name}`} onClick={() => toggle(id)}>{shut ? "▸" : "▾"}</button>
        : <i className="trace-caret" aria-hidden="true" />}
      {children > 0 && <i className="trace-kids" aria-hidden="true">{children}</i>}

      {span.kind !== "agent" && span.kind !== "model" && <ToolIcon />}
      <button type="button" className="trace-name" aria-pressed={selected} title={`${span.name} — ${span.kind} · ${format(durationMs)}`} onClick={() => select(selected ? undefined : id)}>{span.name}</button>
      <b>{format(durationMs)}</b>
    </div>

    <span className="trace-op" aria-hidden="true">{span.kind}</span>
    <div className="trace-track" aria-hidden="true">
      <i style={{ left: `${offset}%`, width: `${width}%` }} />

      <b {...label}>{format(durationMs)}</b>
    </div>

    {selected && <SpanDetail span={original} now={now} close={() => select(undefined)} />}
  </li>;
});








function TimelineDialog({ turns, agentMs, axis, total, format, now, close, children }: { turns: Turn[]; agentMs: number; axis: Axis; total: number; format: (value: number) => string; now: number; close: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  const dismiss = () => dialog.current?.close();

  const stats = useMemo(() => summarizeSpans(turns.flatMap((turn) => turn.spans), now), [turns, now]);
  if (!stats) return null;

  const wall = stats.to - stats.from;
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="timeline-title" onClose={close} onCancel={(event) => { event.preventDefault(); dismiss(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    <section className="agent-dialog trace-dialog">

      <header><div><h2 id="timeline-title">Timeline</h2><span>{new Date(stats.from).toLocaleString()} → {new Date(stats.to).toLocaleTimeString()}</span></div><button type="button" onClick={dismiss} aria-label="Close timeline">×</button></header>

      <dl>
        <div><dt>Turns</dt><dd>{turns.length}</dd></div>
        <div><dt>Lifetime</dt><dd>{formatDuration(wall)}</dd></div>
        <div><dt>Agent time</dt><dd>{formatDuration(agentMs)} · {Math.round((agentMs / Math.max(1, wall)) * 100)}%</dd></div>
        <div><dt>Model requests</dt><dd>{stats.modelRequests}</dd></div>
        <div><dt>Tool calls</dt><dd>{stats.toolCalls}</dd></div>
        <div><dt>Failed spans</dt><dd>{stats.failed}</dd></div>
      </dl>
      {stats.tools.length > 0 && <div className="trace-tools">
        <span>Where tool time went</span>
        <ol>{stats.tools.slice(0, 8).map((tool) => <li key={tool.name}><b title={tool.name}>{tool.name}</b><i>{tool.count}×</i><em>{formatDuration(tool.ms)}</em></li>)}</ol>
      </div>}
      <TimelineAxis total={total} format={format}>{children}</TimelineAxis>
      <p>{axis === "context"
        ? "Bars are the tokens each span put in the window, laid end to end — a step's own share is what its children do not account for. Overall totals the context ledger, so the tail past the last turn is everything assembled below Shinbo: the system prompt, the tool schemas, retrieved knowledge, and the transcript every step resends. Estimated at four characters a token."
        : "Turns sit end to end on the axis, so the time between them is not to scale — the numbers above are real clock time."}</p>
    </section>
  </dialog>;
}









function TimelineAxis({ total, format, children }: { total: number; format: (value: number) => string; children: React.ReactNode }) {


  const { step, marks } = axisTicks(total);
  const whole = Math.max(1, total);
  return <div className="trace trace-dialog-rows" style={{ "--trace-step": `${(step / whole) * 100}%` } as React.CSSProperties}>
    <ul className="trace-legend">
      {LEGEND.map(([kind, label]) => <li key={kind} data-kind={kind}><i aria-hidden="true" />{label}</li>)}
    </ul>
    <div className="trace-axis">
      <span>Span</span>
      <span>Operation</span>
      <div aria-hidden="true">{marks.map((at) => <i key={at} style={{ left: `${(at / whole) * 100}%` }}>{format(at)}</i>)}</div>
    </div>
    {children}
  </div>;
}


function SpanDetail({ span, now, close }: { span: TraceSpan; now: number; close: () => void }) {
  return <div className="trace-detail">
    <header><strong title={span.name}>{span.name}</strong><button type="button" onClick={close} aria-label="Close span details">×</button></header>
    <dl>
      <div><dt>Kind</dt><dd>{span.kind}</dd></div>
      <div><dt>State</dt><dd>{span.status}</dd></div>
      <div><dt>Start</dt><dd>{new Date(span.startedAt).toLocaleTimeString()}</dd></div>
      <div><dt>Took</dt><dd>{formatDuration((span.endedAt ?? now) - span.startedAt)}</dd></div>

      {span.tokens !== undefined && <div><dt>Context</dt><dd>+{tokenLabel(span.tokens)}</dd></div>}
    </dl>
    {span.input !== undefined && <><span>Input</span><pre>{span.input}</pre></>}
    <span>Output</span>
    <pre>{span.output ?? (span.endedAt === undefined ? "Still running." : "This span reported no output.")}</pre>
  </div>;
}
