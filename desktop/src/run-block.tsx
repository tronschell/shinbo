import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { BackgroundTask } from "../shared/agents";
import { useTailScroll } from "./cli";
import { tokenize } from "./highlight";
import { reasonText } from "./errors";

export const RunContext = createContext<{ folderId?: string; addContext: (text: string) => void } | null>(null);

const SHELL = /^(bash|sh|shell|zsh|console|terminal|sh-session|shellsession)$/i;
const POLL_MS = 600;
const MAX_CONTEXT_CHARS = 4000;

function useTask(id: string | undefined) {
  const [state, setState] = useState<{ id: string; task: BackgroundTask; output: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    const read = () => void window.shinbo.readBackground(id).then((found) => {
      if (!live || !found) return;
      setState({ id, ...found });
      if (found.task.status === "exited") clearInterval(timer);
    }).catch(() => undefined);
    const timer = setInterval(read, POLL_MS);
    read();
    const off = window.shinbo.onBackground(read);
    return () => { live = false; clearInterval(timer); off(); };
  }, [id]);
  return state?.id === id ? state : null;
}

function Icon({ path }: { path: string }) {
  return <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

const PLAY = "M5 3.5 12.5 8 5 12.5Z";
const STOP = "M4.5 4.5h7v7h-7Z";
const COPY = "M5.5 5.5h8v8h-8ZM10.5 3.5v-1h-8v8h1";
const TICK = "M2.5 8.5 6 12l7.5-8";

export function CodeBlock({ text, language }: { text: string; language?: string }) {
  const highlighted = useMemo(() => tokenize(text, language).map((token, at) =>
    <span key={at} className={token.kind && `tok-${token.kind}`}>{token.text}</span>), [text, language]);
  const thread = useContext(RunContext);
  const [id, setId] = useState<string>();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const state = useTask(id);
  const { ref: terminal, onScroll: terminalScroll } = useTailScroll<HTMLPreElement>([state?.output], id);
  const runnable = !!thread && !!language && SHELL.test(language);
  const running = state?.task.status === "running";

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const start = () => {
    setError("");
    setId(undefined);
    setHidden(false);
    void window.shinbo.runCommand({ command: text, folderId: thread?.folderId })
      .then((task) => setId(task.id))
      .catch((reason: unknown) => setError(reasonText(reason)));
  };

  const addContext = () => {
    if (!state || !thread) return;
    const status = state.task.status === "running" ? "still running" : `exit ${state.task.exitCode ?? "?"}`;
    thread.addContext(`Output of \`${text.split("\n")[0]}\` (${status}):\n\n\`\`\`\n${state.output.slice(-MAX_CONTEXT_CHARS).trim() || "(no output)"}\n\`\`\``);
  };

  return <div className="md-code">
    <div className="md-code-bar">
      {language && <span className="md-code-lang">{language}</span>}
      {runnable && <button type="button" className="md-code-button" title={running ? "Stop" : "Run this command"} aria-label={running ? "Stop this command" : "Run this command"}
        onClick={() => running && id ? void window.shinbo.stopBackground(id).catch((reason: unknown) => setError(reasonText(reason))) : start()}>
        <Icon path={running ? STOP : PLAY} />
      </button>}
      <button type="button" className="md-code-button" title={copied ? "Copied" : "Copy"} aria-label={copied ? "Copied" : "Copy this block"}
        onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => undefined)}>
        <Icon path={copied ? TICK : COPY} />
      </button>
    </div>
    <pre><code>{highlighted}</code></pre>
    {error && <p className="capability-error" role="alert">{error}</p>}
    {state && !hidden && <div className="md-run" data-status={state.task.status}>
      <header>
        <span className="md-run-state">{running ? "Running…" : `Exited ${state.task.exitCode ?? "?"}`}</span>
        <span className="md-run-where">{state.task.folder || "home"}</span>
        <button type="button" onClick={addContext}>Add to chat</button>
        <button type="button" aria-label="Hide this output" onClick={() => setHidden(true)}>×</button>
      </header>
      <pre className="md-run-output" ref={terminal} onScroll={terminalScroll}>{state.output || (running ? "Waiting for output…" : "(no output)")}</pre>
    </div>}
  </div>;
}
