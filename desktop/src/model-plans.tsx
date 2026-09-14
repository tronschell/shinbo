import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CLI_PLANS, MAX_SECRET_CHARS, MODEL_PLANS, OPENROUTER_KEYS_URL, PLAN_WEEK_MS, PLAN_WINDOW_MS, PROVIDER_PRESETS, emptySpend, planBalanceLine, planForProfile, planSpend, providerReach, type CliPlan, type KeyBalance, type ModelPlan, type PlanGeneration, type PlanSpend, type ProviderProfile, type UserSettings } from "../shared/settings";
import { charLabel } from "../shared/usage";
import { localDevice, unreadableKeyNotice } from "../shared/platform-copy";
import { reasonText } from "./errors";
import { BrandIcon, InfoDot } from "./icons";
import { TerminalSurface } from "./terminal";
import type { TerminalTab } from "../shared/terminal";
import { brandForEngine, brandForImporter, brandForProvider } from "./brands";
import type { CompactSnapshot, CredentialSummary, Snapshot, Thread } from "./types";

const RUNTIME_PLATFORM = typeof window === "undefined" ? "" : window.shinbo?.platform ?? "";
const LOCAL_DEVICE = localDevice(RUNTIME_PLATFORM);

type InstalledCli = { id: string; label: string; bin: string; path: string; signedIn?: boolean };

export const OPENROUTER_ENV = "OPENROUTER_API_KEY";

export function ModelPlans({ settings, busy }: { settings: UserSettings; busy: boolean }) {
  const [stored, setStored] = useState<CredentialSummary[]>([]);
  const [clis, setClis] = useState<InstalledCli[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [ledger, setLedger] = useState<{ at: number; generations: PlanGeneration[] }>({ at: 0, generations: [] });
  const [balance, setBalance] = useState<KeyBalance | null>(null);
  const readClis = useCallback(() => void window.shinbo.installedClis().then(setClis).catch(() => undefined), []);
  useEffect(() => {
    void window.shinbo.listCredentials().then(setStored).catch(() => undefined);
    readClis();
    void window.shinbo.deepseekBalance().then(setBalance).catch(() => undefined);
    void readPlanLedger().then(setLedger).catch(() => undefined);
  }, [readClis]);
  const window5h = useMemo(() => planSpend(ledger.generations, settings.providers, ledger.at - PLAN_WINDOW_MS), [ledger, settings.providers]);
  const week = useMemo(() => planSpend(ledger.generations, settings.providers, ledger.at - PLAN_WEEK_MS), [ledger, settings.providers]);
  const keyed = (plan: ModelPlan) => stored.some((item) => item.env === plan.credentialEnv && item.masked);
  const routed = (plan: ModelPlan) => settings.providers.filter((profile) => planForProfile(profile)?.id === plan.id).map((profile) => profile.modelId);
  const active = (plan: ModelPlan) => {
    const profile = settings.selectedModel.startsWith("provider:") ? settings.providers.find((item) => item.id === settings.selectedModel.slice("provider:".length)) : undefined;
    return !!profile && planForProfile(profile)?.id === plan.id;
  };
  const saveKey = async (plan: ModelPlan, secret?: string) => {
    setError("");
    setStatus("");
    try {
      setStored(await window.shinbo.saveCredential(secret === undefined ? { env: plan.credentialEnv } : { env: plan.credentialEnv, secret }));
      setKeys((current) => ({ ...current, [plan.id]: "" }));
      setStatus(secret === undefined ? `${plan.credentialEnv} removed. The agent restarted without it.` : `${plan.credentialEnv} saved. The agent restarted with it.`);
    } catch (reason) { setError(reasonText(reason)); }
  };
  return <section className="provider-keys model-plans">
    <header>
      <div>
        <span>Subscriptions</span>
        <div className="settings-head">
          <h3>Run a model on a plan you already pay for</h3>
          <InfoDot>Most makers sell a flat monthly coding plan alongside metered credit, on its own endpoint. Shinbo routes the whole agent loop at that endpoint, so a plan model answers turns exactly like an OpenRouter one. OpenAI and Anthropic are the exception: neither sells a plan endpoint you can buy a key for, so Shinbo reaches those from the sign-in their own CLI stores, listed below. A ChatGPT plan then answers turns here like any other; a Claude plan still runs inside the claude binary.</InfoDot>
        </div>
        <p>Paste a key here, select a supported model, then choose its provider under the selected row.</p>
      </div>
      <strong>{MODEL_PLANS.filter((plan) => keyed(plan)).length} connected</strong>
    </header>
    {(error || status) && <p className={error ? "local-model-error" : "local-model-status"} role="status">{error || status}</p>}
    <div className="provider-key-list">{MODEL_PLANS.map((plan) => <details className="settings-section" key={plan.id}><summary><span>{plan.label}</span><small>{keyed(plan) ? "Connected" : "Not connected"}</small></summary><div className="settings-section-body"><PlanKeyRow plan={plan} stored={stored} draft={keys[plan.id] ?? ""} setDraft={(value) => setKeys((current) => ({ ...current, [plan.id]: value }))} busy={busy} onSave={saveKey} models={routed(plan).join(", ")} live={active(plan)} spend={<SpendLine window5h={window5h.get(plan.id)} week={week.get(plan.id)} balance={plan.id === "deepseek" ? balance : null} />} /></div></details>)}</div>
    <div className="provider-key-list">{CLI_PLANS.map((plan) => <details className="settings-section" key={plan.id}><summary><span>{plan.plan}</span><small>{clis.find((cli) => cli.id === plan.id)?.signedIn ? "Signed in" : "Not signed in"}</small></summary><div className="settings-section-body"><CliPlanRow plan={plan} installed={clis.find((item) => item.id === plan.id)} busy={busy} onDone={readClis} /></div></details>)}</div>
  </section>;
}

export function PlanKeyRow({ plan, stored, draft, setDraft, busy, onSave, models = "", live = false, spend = null }: { plan: ModelPlan; stored: CredentialSummary[]; draft: string; setDraft: (value: string) => void; busy: boolean; onSave: (plan: ModelPlan, secret?: string) => Promise<void>; models?: string; live?: boolean; spend?: ReactNode }) {
  const key = stored.find((item) => item.env === plan.credentialEnv && item.masked);
  const unreadable = stored.some((item) => item.env === plan.credentialEnv && !item.readable);
  return <div className={`provider-key-row plan-row ${key ? "set" : ""} ${unreadable ? "unreadable" : ""}`}>
        <BrandIcon brand={brandForProvider(plan.brand)} className="provider-mark" />
        <div>
          <div className="settings-head"><strong>{plan.label}</strong><InfoDot>{plan.note}</InfoDot></div>
          <small>{key ? key.masked : plan.detail}</small>
          {unreadable && <em className="provider-key-lost" role="alert">{unreadableKeyNotice(plan.label, RUNTIME_PLATFORM)}</em>}
          <em className="provider-key-balance"><code>{plan.credentialEnv}</code> <a href={plan.keysUrl} target="_blank" rel="noreferrer">Get a key ↗</a> {spend}</em>
        </div>
        <label>
          <span className="sr-only">{plan.label} API key</span>
          <input type="password" autoComplete="off" spellCheck={false} maxLength={MAX_SECRET_CHARS} disabled={busy} value={draft} placeholder={unreadable ? "Paste it again" : key ? "Paste a replacement" : plan.hint} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <span className={`plan-model ${live ? "live" : ""}`}>{models || "No models"}</span>
        <button type="button" disabled={busy || !draft.trim()} onClick={() => void onSave(plan, draft.trim())}>Save key</button>
        <button type="button" disabled={busy || (!key && !unreadable)} onClick={() => void onSave(plan)}>Remove</button>
  </div>;
}

type ProviderTile = { id: string; label: string; detail: string; brand: string; plan?: ModelPlan; cli?: CliPlan };
const SUBSCRIPTION_TILES: readonly ProviderTile[] = [
  ...CLI_PLANS.filter((cli) => cli.id !== "codex").map((cli) => ({ id: `cli:${cli.id}`, label: cli.id === "claude" ? "Claude" : "Gemini", detail: cli.plan, brand: cli.brand, cli })),
  ...MODEL_PLANS.filter((plan) => plan.billing === "subscription" || plan.id === "mistral").map((plan) => ({ id: plan.id, label: plan.label, detail: plan.id === "mistral" ? "Plan credits · then per token" : "Subscription key", brand: plan.brand, plan })),
  ...CLI_PLANS.filter((cli) => cli.id === "codex").map((cli) => ({ id: `cli:${cli.id}`, label: "ChatGPT", detail: cli.plan, brand: cli.brand, cli })),
];

type LocalPreset = (typeof PROVIDER_PRESETS)[number];
const LOCAL_PRESETS = PROVIDER_PRESETS.filter((item) => !item.credentialEnv && (item.id !== "omlx" || RUNTIME_PLATFORM === "darwin"));
const localBrand = (item: LocalPreset) => brandForEngine(item.id) ?? { id: "custom", label: "Custom", fallback: "◇" };

export function ProviderGrid({ busy, onReady, onAddProvider }: { busy: boolean; onReady: (ready: boolean) => void; onAddProvider: (profile: ProviderProfile) => Promise<void> }) {
  const [stored, setStored] = useState<CredentialSummary[]>([]);
  const [clis, setClis] = useState<InstalledCli[]>([]);
  const [picked, setPicked] = useState("");
  const [mode, setMode] = useState<"plans" | "local">("plans");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [balance, setBalance] = useState<KeyBalance | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const readClis = useCallback(() => void window.shinbo.installedClis().then(setClis).catch((reason: unknown) => setError(reasonText(reason))), []);
  useEffect(() => {
    let active = true;
    void window.shinbo.listCredentials().then((next) => { if (active) setStored(next); }).catch((reason: unknown) => { if (active) setError(reasonText(reason)); });
    void window.shinbo.openRouterBalance().then((next) => { if (active) setBalance(next); }).catch((reason: unknown) => { if (active) setError(reasonText(reason)); }).finally(() => { if (active) setChecking(false); });
    readClis();
    window.addEventListener("focus", readClis);
    return () => { active = false; window.removeEventListener("focus", readClis); };
  }, [readClis]);
  const ready = (stored.some((item) => item.env === OPENROUTER_ENV && item.masked) || !!balance?.keyed) && !balance?.error && !checking && !saving;
  useEffect(() => { onReady(ready); }, [ready, onReady]);
  const connected = (tile: ProviderTile) => tile.cli ? clis.some((item) => item.id === tile.cli?.id && item.signedIn) : stored.some((item) => item.env === tile.plan?.credentialEnv && item.masked);
  const saveKey = async (env: string, secret?: string) => {
    setError("");
    setSaving(true);
    if (env === OPENROUTER_ENV) setBalance(null);
    try {
      setStored(await window.shinbo.saveCredential(secret === undefined ? { env } : { env, secret }));
      setDrafts((current) => ({ ...current, [env]: "" }));
      if (env !== OPENROUTER_ENV) return;
      const next = await window.shinbo.openRouterBalance();
      if (next.error && secret !== undefined) setStored(await window.shinbo.saveCredential({ env }));
      setBalance(next);
    } catch (reason) { setError(reasonText(reason)); }
    finally { setSaving(false); }
  };
  const verify = async () => {
    const draft = (drafts[OPENROUTER_ENV] ?? "").trim();
    if (draft) { await saveKey(OPENROUTER_ENV, draft); return; }
    setChecking(true);
    setError("");
    try { setBalance(await window.shinbo.openRouterBalance()); }
    catch (reason) { setBalance(null); setError(reasonText(reason)); }
    finally { setChecking(false); }
  };
  const tile = SUBSCRIPTION_TILES.find((item) => item.id === picked);
  const preset = LOCAL_PRESETS.find((item) => `local:${item.id}` === picked);
  const switchMode = (next: typeof mode) => { setMode(next); setPicked(""); };
  const openRouter = stored.find((item) => item.env === OPENROUTER_ENV && item.masked);
  const openRouterLost = stored.some((item) => item.env === OPENROUTER_ENV && !item.readable);
  const locked = busy || saving || checking;
  return <div className="setup-connections">
    <section className="setup-router" aria-labelledby="setup-router-title">
      <div className="setup-wash" aria-hidden="true" />
      <header><BrandIcon brand={brandForProvider("openrouter")} className="setup-router-mark" /><div><h3 id="setup-router-title">OpenRouter</h3><p>A free API key is enough to get started.</p></div><span className="setup-badge">{ready ? "Connected" : "Required"}</span></header>
      <a className="setup-button" href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer">Create a free API key ↗</a>
      <form className="setup-key" onSubmit={(event) => { event.preventDefault(); void verify(); }}>
        <label htmlFor="setup-router-key">OpenRouter API key</label>
        <div><input id="setup-router-key" type="password" autoComplete="off" spellCheck={false} maxLength={MAX_SECRET_CHARS} disabled={locked} value={drafts[OPENROUTER_ENV] ?? ""} placeholder={openRouter?.masked ?? "sk-or-v1-…"} onChange={(event) => setDrafts((current) => ({ ...current, [OPENROUTER_ENV]: event.target.value }))} /><button type="submit" className="setup-primary" disabled={locked || (!openRouter && !balance?.keyed && !(drafts[OPENROUTER_ENV] ?? "").trim())}>{checking || saving ? "Checking…" : ready ? "Check again" : "Verify key"}</button></div>
      </form>
      {(ready || checking) && <small className={ready ? "setup-success" : ""} role="status">{ready ? "✓ Key verified. OpenRouter is ready." : "Checking your saved OpenRouter key…"}</small>}
      {openRouterLost && <p className="dialog-error" role="alert">{unreadableKeyNotice("OpenRouter", RUNTIME_PLATFORM)} Shinbo kept the unreadable one on disk and replaces it the moment you save a new one.</p>}
      {balance?.error && <p className="dialog-error" role="alert">{balance.error} Check the key or try again.</p>}
    </section>
    <div className="setup-subscription-head">
      <div className="setup-tabs" role="tablist"><button type="button" role="tab" className="setup-link" aria-selected={mode === "plans"} disabled={locked} onClick={() => switchMode("plans")}>Already have a subscription?</button><button type="button" role="tab" className="setup-link" aria-selected={mode === "local"} disabled={locked} onClick={() => switchMode("local")}>Run a local model</button></div>
      <span>Optional</span>
    </div>
    {mode === "local" && <div className="setup-subscriptions setup-engines" aria-label="Local model servers">{LOCAL_PRESETS.map((item) => <button key={item.id} type="button" className="setup-subscription subscription-local" aria-pressed={`local:${item.id}` === picked} aria-expanded={`local:${item.id}` === picked} aria-controls="setup-subscription-detail" disabled={locked} onClick={() => setPicked(`local:${item.id}` === picked ? "" : `local:${item.id}`)}>
      <span className="setup-wash" aria-hidden="true" />
      <span className="setup-subscription-mark"><BrandIcon brand={localBrand(item)} className="provider-mark" /></span>
      <strong>{item.name || "Custom"}</strong><small>{item.detail}</small>
    </button>)}</div>}
    {mode === "plans" && <div className="setup-subscriptions" aria-label="Subscriptions and plans">{SUBSCRIPTION_TILES.map((item) => <button key={item.id} type="button" className={`setup-subscription subscription-${item.brand}`} data-connected={connected(item)} aria-pressed={item.id === picked} aria-expanded={item.id === picked} aria-controls="setup-subscription-detail" disabled={locked} onClick={() => setPicked(item.id === picked ? "" : item.id)}>
      <span className="setup-wash" aria-hidden="true" />
      <span className="setup-subscription-mark"><BrandIcon brand={item.cli?.id === "claude" ? brandForImporter("claude") : brandForProvider(item.brand)} className="provider-mark" />{connected(item) && <span className="setup-success" aria-label="Connected">✓</span>}</span>
      <strong>{item.label}</strong><small>{item.detail}</small>
    </button>)}</div>}
    <div id="setup-subscription-detail" className="setup-subscription-detail" hidden={!tile && !preset}>
      {(tile || preset) && <div className="setup-subscription-heading"><h3>{tile?.label ?? preset?.name ?? "Custom endpoint"}</h3><button type="button" className="setup-link" disabled={locked} onClick={() => setPicked("")}>Close</button></div>}
      {preset && <LocalProviderForm key={preset.id} preset={preset} busy={locked} onAdd={onAddProvider} />}
      {tile && <>{tile.plan && <PlanKeyRow plan={tile.plan} stored={stored} draft={drafts[tile.plan.credentialEnv] ?? ""} setDraft={(value) => setDrafts((current) => ({ ...current, [tile.plan!.credentialEnv]: value }))} busy={locked} onSave={(plan, secret) => saveKey(plan.credentialEnv, secret)} />}
      {tile.cli && <CliPlanRow plan={tile.cli} installed={clis.find((item) => item.id === tile.cli?.id)} busy={locked} onDone={readClis} />}</>}
    </div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </div>;
}

function LocalProviderForm({ preset, busy, onAdd }: { preset: LocalPreset; busy: boolean; onAdd: (profile: ProviderProfile) => Promise<void> }) {
  const [baseUrl, setBaseUrl] = useState<string>(preset.baseUrl);
  const [modelId, setModelId] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [probe, setProbe] = useState<{ models: string[]; tools: boolean; error: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState({ text: "", bad: false });
  const run = async (task: () => Promise<void>) => {
    setWorking(true);
    setNote({ text: "", bad: false });
    try { await task(); }
    catch (reason) { setNote({ text: reasonText(reason), bad: true }); }
    finally { setWorking(false); }
  };
  const test = () => run(async () => setProbe(await window.shinbo.testProvider({ baseUrl, credentialEnv: "", modelId, insecure })));
  const add = () => run(async () => {
    const name = preset.name || (() => { try { return new URL(baseUrl).host; } catch { return "Custom"; } })();
    await onAdd({ id: `p-${Date.now().toString(36)}`, name, modelId, baseUrl, credentialEnv: "", contextWindow: 0, insecure });
    setNote({ text: `${name} · ${modelId} answers the next turn. OpenRouter is still needed for search, vision and other core features.`, bad: false });
  });
  return <form className="setup-local-form" onSubmit={(event) => { event.preventDefault(); void add(); }}>
    <label><span>Base URL</span><input required maxLength={2048} disabled={busy || working} value={baseUrl} placeholder="http://127.0.0.1:1234/v1" onChange={(event) => { setBaseUrl(event.target.value); setProbe(null); }} /></label>
    <label><span>Model ID</span><input required maxLength={128} list="setup-local-models" disabled={busy || working} value={modelId} placeholder="qwen3-8b" onChange={(event) => setModelId(event.target.value)} /></label>
    <datalist id="setup-local-models">{(probe?.models ?? []).map((id) => <option key={id} value={id} />)}</datalist>
    {providerReach(baseUrl) === "network" && <label className="check"><input type="checkbox" checked={insecure} onChange={(event) => setInsecure(event.target.checked)} /> Send prompts unencrypted over my network</label>}
    <div><button type="button" disabled={busy || working || !baseUrl} onClick={() => void test()}>{working ? "Working…" : "Test"}</button><button type="submit" className="setup-primary" disabled={busy || working || !baseUrl || !modelId}>Use this model</button></div>
    {probe && <small role="status">{probe.models.length ? `${probe.models.length} models` : "No model list"} · {probe.tools ? "Tool calls ✓" : modelId ? "No tool calls — Shinbo needs them every turn" : "Fill in a model id to check tool calls"}{probe.error && ` · ${probe.error}`}</small>}
    {note.text && <small className={note.bad ? "dialog-error" : "setup-success"} role="status">{note.text}</small>}
  </form>;
}

async function readPlanLedger(): Promise<{ at: number; generations: PlanGeneration[] }> {
  const began = Date.now();
  const snapshot = await window.shinbo.request<CompactSnapshot>("threadSummaries");
  const generations: PlanGeneration[] = [];
  for (const summary of snapshot.threads) {
    if (summary.messageDates?.every((date) => Date.parse(date) < began - PLAN_WEEK_MS)) continue;
    const thread = await window.shinbo.request<Thread>("thread", { threadId: summary.id });
    for (const generation of planGenerations({ threads: [thread] })) generations.push(generation);
  }
  const at = Date.now();
  if (at < began) {
    const full = await window.shinbo.request<Snapshot>("snapshot");
    return { at: Date.now(), generations: planGenerations(full) };
  }
  return { at, generations };
}

function planGenerations(snapshot: Pick<Snapshot, "threads">): PlanGeneration[] {
  const rows: PlanGeneration[] = [];
  for (const thread of snapshot.threads) {
    for (const message of thread.messages) {
      const generation = message.generation;
      if (!generation?.model) continue;
      rows.push({ at: Date.parse(message.timestamp), model: generation.model, inputTokens: generation.inputTokens, outputTokens: generation.outputTokens });
    }
  }
  return rows;
}

function SpendLine({ window5h, week, balance }: { window5h?: PlanSpend; week?: PlanSpend; balance: KeyBalance | null }) {
  const money = planBalanceLine(balance);
  const spent = week ?? emptySpend();
  if (!spent.turns && !money) return null;
  const tokens = (spend: PlanSpend) => `${charLabel(spend.inputTokens)} in · ${charLabel(spend.outputTokens)} out`;
  return <b className="plan-spend">
    {spent.turns > 0 && <span title={`${(window5h ?? emptySpend()).turns} turns in the last 5 hours, ${spent.turns} in the last week`}>{tokens(window5h ?? emptySpend())} · 5h</span>}
    {spent.turns > 0 && <span className="plan-spend-week">{tokens(spent)} · 7d</span>}
    {money && <span className={balance && (balance.error || (balance.remaining !== null && balance.remaining <= 0)) ? "warn" : ""}>{money}</span>}
  </b>;
}

export function CliPlanRow({ plan, installed, busy, onDone }: { plan: CliPlan; installed?: InstalledCli; busy: boolean; onDone: () => void }) {
  const [tab, setTab] = useState<TerminalTab>();
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState("");
  const signedIn = installed?.signedIn === true;
  useEffect(() => {
    if (!tab || ended) return;
    const stop = window.shinbo.onTerminals(() => void window.shinbo.listTerminals(tab.threadId)
      .then((found) => { if (!found.some((item) => item.id === tab.id && item.running)) { setEnded(true); onDone(); } })
      .catch(() => undefined));
    return stop;
  }, [ended, onDone, tab]);
  const open = ended && signedIn ? undefined : tab;
  useEffect(() => {
    if (!open) return;
    return () => { void window.shinbo.closeTerminal(open.id); };
  }, [open]);
  const signIn = () => {
    setTab(undefined);
    setEnded(false);
    void window.shinbo.signInCli({ signIn: plan.id, columns: 80, rows: 16 }).then(setTab).catch((reason: unknown) => setError(reasonText(reason)));
  };
  return <div className={`provider-key-row cli-plan-row ${signedIn ? "set" : ""}`}>
    <BrandIcon brand={brandForProvider(plan.brand)} className="provider-mark" />
    <div>
      <div className="settings-head"><strong>{plan.plan}</strong><InfoDot>{plan.note}</InfoDot></div>
      <small>{plan.detail}</small>
      <code>{installed ? installed.path : `${plan.label} is not on this ${LOCAL_DEVICE}`}</code>
    </div>
    <span className="provider-key-value">{installed ? "Sign in with " : "Install, then "}<code>{plan.signIn}</code></span>
    {installed
      ? <button type="button" disabled={busy} onClick={() => (open ? setTab(undefined) : signIn())}>{open ? "Close" : signedIn ? "Sign in again" : "Sign in"}</button>
      : <span className="provider-key-value">Not found</span>}
    <span className={`provider-key-value ${signedIn ? "" : "warn"}`}>{!installed ? "Not installed" : signedIn ? "Signed in" : "Not signed in"}</span>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {open && <div className="cli-plan-terminal" data-ended={ended}>
      <TerminalSurface tab={open} active onSelect={() => undefined} onLink={() => undefined} />
    </div>}
  </div>;
}
