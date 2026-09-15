import { Accessibility, AppWindow, AudioLines, Bell, Mic, Monitor, Archive, ArrowDownWideNarrow, Check, CircleAlert, CircleHelp, Copy, EllipsisVertical, Eye, Folder, FolderTree, Hourglass, LoaderCircle, Pin, Smartphone, Tag, Wrench } from "lucide-react";
import { createContext, Fragment, lazy, memo, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { isCurrentThreadLoad, threadMessageCount, type AgentImportSource, type CompactSnapshot, type CredentialSummary, type HeldAttachment, type ImportedMcpServer, type ImportedSkill, type ToolTarget, type Message, type ModelModality, type OpenRouterCatalog, type OverlaySurface, type ScheduledJob, type Snapshot, type Thread, type ThreadContext } from "./types";
import { describeRun, describeTrigger, parseVariables, parseWorkflow, runWorkflow, triggerProblem } from "../shared/workflow";
import { MAX_SCHEDULED_PROMPT_BYTES, PromptField, ScheduleField, useTaskCommands, WorkflowGraph } from "./schedule";
import { plural } from "./plural";
import { ColorPicker } from "./color-picker";
import { zoned } from "./dates";
import { latestRate, latestReply, nested, newest, spawnedAgents, spawnedByTurn, subagentRows, threadAt, threadDepth, threadLabel, threadTitle, type Spawned } from "./threads";
import { comboKeybind, DEFAULT_HOLD_MS, DOUBLE_TAP_WINDOW_MS, holdKeybind, HOLD_DURATIONS, HOLD_KEYS, TAP_MS, keyboardAccelerator, keybindKey, keybindLabel, keybindProblem, KEYBIND_ACTIONS, normalizeAccelerator, saveShortcut, type Keybind, type KeybindAction, type Keybinds } from "../shared/settings";
import { ACCENT_CHOICES, CONVERSATION_WIDTHS, type ConversationWidth, MIN_UI_SCALE, MAX_UI_SCALE, canRemoveProvider, thinkingLabel, thinkingStops, type ThinkingLevel, type NotchConcurrency, CURSOR_COMMANDS, balanceLine, outOfCredit, type KeyBalance, OPENROUTER_CREDITS_URL, FREE_ROUTER_ID, FREE_ROUTER_MODELS, forgetRouter, MAX_ROUTERS, MAX_ROUTER_NAME, routerIdFor, routerKey, type ModelRouter, MAX_EXPERIMENT_STEPS, MAX_COMMAND_TIMEOUT_MINUTES, MIN_COMMAND_TIMEOUT_MINUTES, CHECKPOINT_BAND_PERCENT, MAX_REVIEW_ROUNDS, type HarnessExperiments, LOCAL_EMBEDDING_MODELS, HOSTED_EMBEDDING_MODELS, hostedEmbeddingModel, type EmbeddingModel, type HostedEmbeddingModel, FONT_CHOICES, fontStack, cursorCommandGlyphs, cursorCommandNames, defaultHarnessExperiments, defaultSettings, forgetProvider, isEnvName, MAX_CURSOR_ORBS, MAX_FAVORITE_MODELS, MAX_SECRET_CHARS, MAX_SYSTEM_PROMPT_CHARS, MAX_VERIFIER_SYSTEM_CHARS, defaultAdvisorSystem, defaultVisionSystem, defaultSecretSystem, defaultVerifierSystem, SECOND_MODELS, SECOND_MODEL_IDS, type SecondModelId, verifierFromKey, verifierKey, SETTINGS_KEY, OPENROUTER_CHAT_ENDPOINT, PROVIDER_PRESETS, MODEL_PLANS, CODEX_PREFIX, availableCodexModelKey, codexModelKey, codexSlug, planFor, modelPlanRoute, planForModel, planForProfile, planModelId, planProfileFor, providerChatUrl, providerCredentials, providerReach, toggleFavoriteModel, validateSettings as validateSettingsForPlatform, WEB_SEARCH_PROVIDERS, webSearchCredentials, webSearchProvider, type AccentChoice, type CursorCommand, type FontChoice, type ModelPlan, type ProviderProfile, type ToolSettings, type UserSettings, type VerifierSettings, type WebSearchProvider, type WebSearchSettings } from "../shared/settings";
import { TOOL_CATALOG } from "../shared/permissions";
import { validComputerProgress, type ComputerRunProgress } from "../shared/computer";
import { defaultPaneLayout, fitPaneLayout, MIN_BROWSER_WIDTH, NAV_VIEWS, ordered, validatePaneLayout, WIDE_BROWSER_WIDTH, type PaneLayout } from "./layout";
import { DndContext, MeasuringStrategy, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { hasPersistedPrompt } from "./drafts";
import { arrived, canSteer, dropHeld, dropQueued, groupBlocks, MAX_STEER_CHARS, pairBlocks, pairingFrom, settleRun, tracedBlocks, queuedTurns, releaseHeld, RUN_ERROR_EVENT, sendTurn, steerQueued, steerRunning, stopTurn, turnToRetry, thinkingOf, useRun, withoutThinking, wrote, type Block, type RunFailure } from "./runs";
import { splitThinking } from "../shared/thinking";
import { latestSteps, runActivity, stepActive } from "./tool-activity";
import { IDLE_UPDATE, readUpdateState, type UpdateState } from "../shared/update";
import { brandForImporter, brandForModel, brandForProvider, obsidianBrand, providerBrands, type BrandDefinition } from "./brands";
import { DEFAULT_SYSTEM_PROMPT, forkPreset, MAX_PROMPTS, MAX_PROMPT_NAME_CHARS, MODEL_FAMILIES, newPresetId, promptApplies, promptSegments, PROMPT_VARIABLES, type PromptPreset } from "../shared/prompts";
import { validScreenContextId } from "../shared/screen-context";
import { COUNCIL_SEATS_DEFAULT, COUNCIL_SEATS_MIN, councilRunning, type CouncilState } from "../shared/council";
import { BUILTIN_COMMANDS, highlightSegments, insertCommand, KIND_LABELS, matchCommands, mentions, MENU_MAX, pathName, slashQuery, type SlashCommand } from "../shared/slash";
import { attachmentLimit, isImageAttachment, MAX_TURN_IMAGES, oversizeMessage, pickKey, type ContextPick, type FolderFile, type FolderGrant } from "../shared/folders";
import { charLabel, CHARS_PER_TOKEN, type ContextUse } from "../shared/usage";
import { formatDuration } from "../shared/trace";
import { ContextBarSettings, ContextWidgets, readContextPage, useContextLedger, useThreadCalls, writeContextPage } from "./context-bar";
import { type ContextPage } from "../shared/context-bar";
import { Markdown, OpenPaths, SkillNames } from "./markdown";
import { RunContext } from "./run-block";
import { openPreview, PreviewHost } from "./preview";
import { ArtifactCard, ArtifactPane, ArtifactsView } from "./artifacts";
import { Visual } from "./visual";
import { Region } from "./regions";
import { Built, BuiltSettings } from "./components";
import type { ComponentMeta } from "../shared/components";
import { ARTIFACT_LABELS, artifactWritten, type Artifact, type ArtifactMeta } from "../shared/artifacts";
import { atCommands, buildAttachedContext, cachedBlocks, clearedAt, contextCommands, handTags, markCleared, modelSwitches, overlayMode, PICK_CONTEXT_EVENT, pickIntoComposer, pickLabel, pinnedThreads, recordModelSwitch, recordUses, rememberBlocks, seenRuns as storedSeenRuns, setSeenRuns as storeSeenRuns, rememberTurnAttachments, setOverlayMode, setThreadFolders, setThreadMode, setThreadReview, setThreadDraft, setThreadPinned, setThreadTag, setThreadUnread, threadBreakdown, threadDraft, threadExperiments, threadFolderMap, threadFolders, threadTags, threadUses, toolCommands, turnAttachments, unreadThreads, type ModelSwitch, type TurnAttachment } from "./context";
import { AgentPanel, AgentRail, BackgroundRail, ChangeCount, ChangesPanel, ModeMenu, ModePicker, ModeTrigger, PermissionPrompt, usePermissionAsk, SubagentChips, TabStrip, ThreadCard, useAgents, type AgentTab } from "./agents";
import { ThreadGitStatus, useThreadGit } from "./thread-git";
import { FileMark, GitPage, GitSetup, useGit } from "./git";
import { ResizeHandle } from "./resize";
import { HarnessStatus } from "./harness";
import { MobileSettings, PhoneMark, usePhone } from "./mobile";
import { worktreeName, type GitSnapshot } from "../shared/git";
import { CouncilPanel } from "./council";
import { BrandIcon, BranchIcon, CaretIcon, ChevronIcon, ClipIcon, CloseIcon, DockIcon, ShinboMark, shinboBrand, GearIcon, GlobeIcon, InfoDot, InspectorIcon, Mark, PencilIcon, ReviewIcon, SearchProviderMark, SidebarIcon, SparkIcon, StopIcon, TabIcon, TextIcon, ToolIcon, ToolMark, TrashIcon } from "./icons";
import { FilesPane, OPEN_FILE_PANE_EVENT, openFilePane, type OpenFileRequest } from "./files";
import { BrowserPane, browserPip } from "./browser";
import { PaneSwitch } from "./pane-switch";
import { embeddingModelLabel, embeddingModelMode, IndexStatus, indexStateLabel, useSemanticGrepStatus, useZvecGrepStatus } from "./index-status";
import { gigabytes, type MachineFacts, recommendEmbeddingModel } from "../shared/embedding-recommendation";
import { sizeLabel, type ZvecGrepStatus, zvecGrepDownloadBytes, zvecGrepPercent, zvecGrepPhaseLabel, zvecGrepProgressLabel } from "../shared/zvec-grep";
import { progressLabel } from "../shared/semantic-grep";
import { TaskListBar } from "./task-list";
import { closeTerminals, TerminalIcon, TerminalPanel, TerminalSurface, useTerminals } from "./terminal";
import { collectStats, statsFiles, statsFolderName } from "./thread-stats";
import { Dashboard } from "./dashboard";
import { MAX_TERMINAL_HEIGHT, MIN_TERMINAL_HEIGHT } from "../shared/terminal";
import { syncImprovements } from "./improvements";
import { CliComposer, CliPanel, CliStatus, CliStream, cliBrand, cliLabel, useCliRuns, useTailScroll } from "./cli";
import { PipLayer, type PipWindow } from "./pip";
import { cliHarness } from "../shared/cli";
import { searchProvider } from "./search-provider";
import { diffStat, sentByThread, spawnedThread, type AgentStatus, type FileChange, type LiveAgent, type ThreadStep } from "../shared/agents";
import { DEFAULT_PERMISSION_MODE, isPermissionMode, type PermissionMode } from "../shared/permissions";
import { SETUP_PERMISSIONS, type SetupPermission, type SetupStatus } from "../shared/setup";
import { keepKindLabel, MAX_FOLDER_NAME, noteFolder, tagName, type KeepKind, type KeptNote, type NoteFolder, type VaultChoice } from "../shared/vault";
import { CLEANUP_INSTALL, HOLD_TO_TALK_MS, LLAMA_INSTALL, LLAMA_SITE_URL, SPEECH_INSTALL, SPEECH_MODEL, SPEECH_MODEL_URL, VOICE_MODEL, VOICE_MODEL_URL, voiceReady, type TranscriptionEngine } from "../shared/voice";
import { useDictation, useSpaceHold } from "./voice";
import { reasonText } from "./errors";
import { ModelPlans, OPENROUTER_ENV, ProviderGrid } from "./model-plans";
import { isWorkspaceWindow, takeBootSnapshot, whenProvidersReady } from "./boot";
import { GoalCard, GoalThreads, GoalView } from "./goal";
import { GOAL_LABELS, markedGoal, usageLimitedFailure } from "../shared/goal";
import { localDevice, overlayLabel, unreadableKeyNotice } from "../shared/platform-copy";

const empty: Snapshot = { threads: [], scheduledJobs: [], warnings: [] };
const SNAPSHOT_REFRESH_MS = 60_000;
const RUNTIME_PLATFORM = typeof window !== "undefined" && window.shinbo?.platform === "win32" ? "win32" : "darwin";
const IS_WINDOWS = RUNTIME_PLATFORM === "win32";
const HARNESS_CLI = IS_WINDOWS ? "./harness/zig-out/bin/shinbo-cli.exe acp" : "./harness/zig-out/bin/shinbo-cli acp";
const LOCAL_DEVICE = localDevice(RUNTIME_PLATFORM);
const PLATFORM_NAME = IS_WINDOWS ? "Windows" : "macOS";
const MODIFIER_LABEL = IS_WINDOWS ? "Ctrl" : "⌘";
const ALT_LABEL = IS_WINDOWS ? "Alt" : "⌥";
const OVERLAY_LABEL = overlayLabel(RUNTIME_PLATFORM);
const validateSettings = (value: unknown) => validateSettingsForPlatform(value, RUNTIME_PLATFORM);
const AgentView = lazy(() => import("./AgentView"));
const PluginsView = lazy(() => import("./plugins").then(({ PluginsView }) => ({ default: PluginsView })));
const dateFormat = zoned({ month: "short", day: "numeric", year: "numeric" });
const timeFormat = zoned({ hour: "numeric", minute: "2-digit" });
const date = (value: string) => dateFormat(new Date(value));
const time = (value: string) => timeFormat(new Date(value));

const STATUS_TITLES: Record<string, string> = { tool: "Running a tool", running: "Thinking", waiting: "Waiting for you", failed: "Something went wrong", done: "Unread", idle: "Idle" };

type ThreadLive = { status: AgentStatus; tool: boolean; startedAt: number };

const runStamp = (live?: ThreadLive) => live ? `${live.startedAt}:${live.status}` : "";

function ThreadStatus({ live, unseen }: { live?: ThreadLive; unseen?: boolean }) {
  const status = live?.status;
  const state = status === "running" ? (live?.tool ? "tool" : "running")
    : status === "waiting" || status === "failed" ? status
    : unseen ? "done"
    : "idle";
  if (state === "idle") return null;
  const label = STATUS_TITLES[state];
  const Icon = state === "tool" ? Wrench : state === "running" ? LoaderCircle : state === "waiting" ? CircleHelp : state === "failed" ? CircleAlert : Check;
  return <span className={`thread-status ${state}`} title={label} role="img" aria-label={label}><Icon size={14} strokeWidth={1.6} aria-hidden="true" /></span>;
}

function Body({ content }: { content: string }) {
  return <div className="message-body"><Markdown text={content} /></div>;
}

const clock = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)}s` : formatDuration(ms);

function Thought({ text, ms, tokens, live }: { text: string; ms: number; tokens: number; live?: string }) {
  if (!text.trim() && !live) return null;
  return <details className="thinking" data-live={live ? "true" : undefined}>
    <summary>{live
      ? `${clock(ms)} · ${charLabel(tokens)} tokens · ${live}`
      : ms > 0 ? `Thought for ${clock(ms)} · ${charLabel(tokens)} tokens` : `Thought · ${charLabel(tokens)} tokens`}</summary>
    <p>{text}</p>
  </details>;
}

const thoughtTokens = (text: string) => Math.round(text.length / CHARS_PER_TOKEN);

function CopyTurn({ text, label = "Copy message" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  return <button type="button" className="message-copy" aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label} onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => undefined)}>
    {copied
      ? <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8.5 6 12l7.5-8" /></svg>
      : <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" /><path d="M10.5 3.5v-1h-8v8h1" /></svg>}
  </button>;
}

const TranscriptRail = memo(function TranscriptRail({ messages, scroller }: { messages: Message[]; scroller: React.RefObject<HTMLDivElement | null> }) {
  const [peek, setPeek] = useState<number>();
  const marks = useMemo(() => messages.flatMap((item, index) => {
    if (item.role !== "user") return [];
    const [head, ...rest] = sentByThread(item.content).body.trim().split("\n");
    return [{ item, index, head, rest: rest.join(" ") }];
  }), [messages]);
  if (marks.length < 2) return null;
  return <nav
    className="rail"
    aria-label="Jump to a message"
    style={{ "--rail-gap": `${Math.max(2, Math.min(7, 360 / marks.length))}px` } as React.CSSProperties}
    onMouseLeave={() => setPeek(undefined)}
  >
    {marks.map(({ item, index, head, rest }, at) => {
      return <button
        key={index}
        type="button"
        className="rail-mark"
        aria-label={`Jump to: ${head.slice(0, 80)}`}
        onMouseEnter={() => setPeek(at)}
        onFocus={() => setPeek(at)}
        onBlur={() => setPeek(undefined)}
        onClick={() => scroller.current?.querySelector(`[data-turn="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      >
        {peek === at && <span className="rail-peek" aria-hidden="true">
          <b>{head}</b>
          {rest.trim() && <i>{rest}</i>}
          <time dateTime={item.timestamp}>{time(item.timestamp)}</time>
        </span>}
      </button>;
    })}
  </nav>;
});

function ContextCut() {
  return <p className="context-cut" role="separator" aria-label="Context cleared">Context cleared</p>;
}

function ModelCut({ mark }: { mark: ModelSwitch }) {
  const effort = mark.effort === undefined ? "" : mark.effort === "" ? "Default" : thinkingLabel(mark.effort);
  const said = [mark.label && `Switched to ${mark.label}`, effort && `thinking ${effort}`].filter(Boolean).join(" · ");
  return <p className="context-cut model-cut" role="separator" aria-label={said}>
    {mark.label && <><span>Switched to</span>
      <span className="model-cut-name">
        <BrandIcon brand={brandForProvider(mark.brand) ?? (mark.brand === routerBrand.id ? routerBrand : undefined)} className="model-cut-mark" />
        {mark.label}
      </span></>}
    {effort && <><span>{mark.label ? "· thinking" : "Thinking"}</span><span className="model-cut-effort" data-level={mark.effort}>{effort}</span></>}
    {mark.after && <span>— last one was silent for <b>{mark.after}</b></span>}
  </p>;
}

const PROJECT_RULES_FILE = "AGENTS.md";

function ProjectRules({ folder }: { folder?: FolderGrant }) {
  const [rules, setRules] = useState<{ id: string; lines: number }>();
  useEffect(() => {
    if (!folder) return;
    let live = true;
    void window.shinbo.readFolderFile({ folderId: folder.id, path: PROJECT_RULES_FILE })
      .then(({ text }) => { if (live && text.trim()) setRules({ id: folder.id, lines: text.trimEnd().split("\n").length }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [folder]);
  const lines = rules && rules.id === folder?.id ? rules.lines : 0;
  if (!folder || !lines) return null;
  return <p className="project-rules">
    <TextIcon />
    <button type="button" onClick={() => openPreview(`${folder.path}/${PROJECT_RULES_FILE}`, PROJECT_RULES_FILE)}>{PROJECT_RULES_FILE}</button>
    <span>{lines} {plural(lines, "line")} read into context</span>
  </p>;
}

function MessageTray({ attached }: { attached?: TurnAttachment[] }) {
  if (!attached?.length) return null;
  return <div className="message-tray">{attached.map((item, index) => {
    const kind = item.kind ?? "attachment";
    const face = <>{item.thumbnail
      ? <img src={item.thumbnail} alt="" />
      : <><FileMark path={item.name} /><small>{item.name}</small></>}{kind !== "attachment" && <em>{kindLabel(kind)}</em>}</>;
    const file = item.path;
    const title = `${kindLabel(kind)} · ${item.name}`;
    return file
      ? <button type="button" className="composer-tile" data-kind={kind} key={index} title={title} aria-label={`Open ${item.name}`} onClick={() => openPreview(file, item.name)}>{face}</button>
      : <div className="composer-tile" data-kind={kind} key={index} title={title}>{face}</div>;
  })}</div>;
}

const Turn = memo(function Turn({ item, blocks, index, attached, spawned }: { item: Message; blocks?: Block[]; index?: number; attached?: TurnAttachment[]; spawned?: Spawned[] }) {
  if (item.role === "system") return <div className="turn-notice" data-turn={index}>{!!blocks?.length && <Blocks blocks={blocks} />}<ContextNotice text={item.content} plain /></div>;
  const model = item.generation?.model ?? "";
  const { from, body } = sentByThread(item.content);
  const thought = item.role !== "assistant" ? "" : blocks?.length ? thinkingOf(blocks) : splitThinking(body).thinking;
  return <article className={`message ${item.role}`} data-turn={index}>
    {thought && <Thought text={thought} ms={item.generation?.durationMilliseconds ?? 0} tokens={thoughtTokens(thought)} />}
    <MessageTray attached={attached} />
    {blocks?.length ? <Blocks blocks={blocks} /> : <Body content={item.role === "assistant" ? splitThinking(body).answer : body} />}
    {!!spawned?.length && <SubagentChips spawned={spawned} onOpen={openSubagentTab} />}
    <footer className="message-meta">{from && <span>{`thread ${from} messaged:`}</span>}<CopyTurn text={item.role === "assistant" ? splitThinking(item.content).answer : body} />{model && <span className="message-model" title={`Answered by ${model}`}><BrandIcon brand={brandForModel(model)} className="message-model-mark" /><span>{model}</span></span>}<time dateTime={item.timestamp}>{time(item.timestamp)}</time>{item.generation && <span className="generation-rate" title={`${item.generation.outputTokens} output tokens in ${item.generation.durationMilliseconds} ms`}>{Math.round(item.generation.outputTokens / item.generation.durationMilliseconds * 1000).toLocaleString()} tok/s</span>}</footer>
  </article>;
});

function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{groupBlocks(withoutThinking(blocks), STEPS_SHOWN).map((block, index) => block.kind === "steps"
    ? <Steps key={index} steps={block.steps} shown={block.keep} />
    : block.kind === "visual"
      ? <Visual key={index} id={block.id} onKept={openArtifactPane} onPicked={pickIntoComposer} />
      : block.kind === "notice"
        ? block.steer
          ? <Steered key={index} text={block.text} />
          : <ContextNotice key={index} text={block.text} plain={block.plain} handoff={block.handoff} />
        : <Body key={index} content={block.text} />)}</>;
}

const NOTICE_KEY = /([+\u2212-]?\d[\d.,:]*\s?[%kM]?)/g;

function keyed(text: string) {
  return text.split(NOTICE_KEY).map((part, index) => index % 2 ? <b key={index}>{part}</b> : part);
}

function Steered({ text }: { text: string }) {
  return <p className="steered"><span>{"\u2933"} Steered</span>{text}</p>;
}

function ContextNotice({ text, plain, handoff }: { text: string; plain?: boolean; handoff?: string }) {
  if (handoff) return <details className="context-handoff">
    <summary>{keyed(text)}</summary>
    <pre>{handoff}</pre>
  </details>;
  return <p className="context-cut context-notice">
    <span>{keyed(text)}</span>
    {!plain && <button type="button" onClick={() => openSettingsPage("harness")}>Change in settings</button>}
  </p>;
}

function Stalled({ since, blocks, recovery, onSwap }: { since: number; blocks: Block[]; recovery: string; onSwap: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const activity = runActivity(blocks, since, now, recovery);
  if (!activity.stalled && activity.phase !== "recovery") return null;
  if (activity.phase === "tools") return <p className="inline-activity run-wait" role="status">
    Waiting for {activity.outstanding.length === 1 ? activity.outstanding[0].title.trim() || activity.outstanding[0].kind.trim() || "tool call" : `${activity.outstanding.length} tools`} · last update <b>{clock(activity.quiet)}</b> ago
  </p>;
  return <p className="context-cut context-notice stalled run-wait" role="status">
    <span>{recovery ? keyed(recovery) : <>Waiting for model response · no update for <b>{clock(activity.quiet)}</b></>}</span>
    {activity.canSwap && <button type="button" onClick={onSwap}>Try another model</button>}
  </p>;
}

function stepLabel(step: ThreadStep): string {
  if (step.edit) return `Edited ${step.edit.path.split(/[\\/]+/).pop() ?? step.edit.path}`;
  return step.title.trim() || step.kind.trim() || "tool call";
}

const PATH_TOOLS = new Set(["read_file", "file_info", "open_file", "write_file", "edit_file", "delete_file", "create_folder", "list_files", "look_at_image"]);

function StepTitle({ step }: { step: ThreadStep }) {
  const label = stepLabel(step);
  const path = stepPath(step);
  const at = path ? label.lastIndexOf(path) : -1;
  if (!path || at < 0) return <span className="step-title">{label}</span>;
  return <button type="button" className="step-title step-file" title={`Open ${path}`} onClick={() => openPreview(path)}>{label.slice(0, at)}<FileMark path={path} />{label.slice(at)}</button>;
}

function StepMark({ step }: { step: ThreadStep }) {
  const provider = searchProvider(step);
  return provider ? <SearchProviderMark provider={provider} /> : <ToolMark name={step.toolName} kind={step.kind} />;
}

function stepPath(step: ThreadStep): string | undefined {
  if (step.edit) return step.edit.path;
  if (!step.toolName || !PATH_TOOLS.has(step.toolName)) return undefined;
  const value = argPath(step.input) ?? step.title.slice(step.title.indexOf(" ") + 1).trim();
  if (/^[a-z]+:\/\//i.test(value)) return undefined;
  return value.includes("/") || value.includes(".") ? value : undefined;
}

function argPath(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    const args = JSON.parse(input) as { path?: unknown };
    return typeof args.path === "string" && args.path.trim() ? args.path.trim() : undefined;
  } catch {
    return undefined;
  }
}

const STEPS_SHOWN = 0;

function Steps({ steps: records, shown: keep = STEPS_SHOWN }: { steps: ThreadStep[]; shown?: number }) {
  const steps = latestSteps(records);
  if (!steps.length) return null;
  const folded = steps.length > keep + 1;
  const shown = folded ? steps.slice(0, keep) : steps;
  const rest = steps.slice(shown.length);
  const active = rest.filter(stepActive);
  const latest = active.at(-1) ?? rest.at(-1);
  return <>
    {shown.length > 0 && <ol className="steps">{shown.map((step) => <Step key={step.toolCallId} step={step} />)}</ol>}
    {latest && <details className="steps-more">
      <summary><CaretIcon />{!!active.length && <LoaderCircle className="tool-activity-indicator" size={12} aria-hidden="true" />}{searchProvider(latest) && <StepMark step={latest} />}<span key={latest.toolCallId} className={`steps-latest ${latest.status}`}>{stepLabel(latest)}</span><EditCount steps={rest} /><span className="steps-count">{active.length ? `${active.length} active · ` : ""}{rest.length} more</span></summary>
      <ol className="steps">{rest.map((step) => <Step key={step.toolCallId} step={step} />)}</ol>
    </details>}
  </>;
}

const Step = memo(function Step({ step }: { step: ThreadStep }) {
  const made = artifactWritten(step);
  const started = spawnedThread(step.output);
  const goal = markedGoal(step.output);
  return <li className={`step ${step.status}`}>
    {stepActive(step) && <LoaderCircle className="tool-activity-indicator" size={12} aria-label="Tool call active" />}
    {step.kind === "verifier" ? <Review step={step} />
      : step.edit ? <EditStep step={step} edit={step.edit} />
      : <details className="step-review">
        <summary><StepMark step={step} /><StepTitle step={step} /></summary>
        <pre>{step.title}</pre>
      </details>}
    {(step.status === "cancelled" || step.status === "failed") && <span className="step-note">{step.status === "failed" ? "failed" : "interrupted"}</span>}
    {made && <ArtifactCard id={made} onOpen={openArtifactPane} />}
    {started && <ThreadCard id={started.id} title={started.title} onOpen={openThreadPage} />}
    {goal && <GoalCard threadId={goal} onOpen={openGoalPage} />}
  </li>;
});

function EditStep({ step, edit }: { step: ThreadStep; edit: NonNullable<ThreadStep["edit"]> }) {
  return <details className="step-edit">
    <summary title={edit.path}>
      <PencilIcon />
      <span className="step-title">{stepLabel(step)}</span>
      <span className="step-diff"><b>+{edit.added}</b><i>-{edit.removed}</i></span>
      <CaretIcon />
    </summary>
    <FilePathButton path={edit.path} />
    {edit.hunks?.length
      ? <pre className="diff">{edit.hunks.map((line, index) => <span key={index} className={line.kind === "+" ? "added" : line.kind === "-" ? "removed" : undefined}><i>{line.line}</i>{line.kind}{line.text}{"\n"}</span>)}</pre>
      : <p className="step-note">Shinbo no longer has the text of this edit.</p>}
  </details>;
}

const EditTargets = createContext<{ changes: { folderId: string; path: string }[]; folderId: string }>({ changes: [], folderId: "" });

function FilePathButton({ path }: { path: string }) {
  const targets = useContext(EditTargets);
  const folderId = targets.changes.find((item) => item.path === path)?.folderId ?? targets.folderId;
  return <button type="button" className="step-path" title={folderId ? "Open this file" : "Open this file in Changes"}
    onClick={() => folderId ? openFilePane({ folderId, path }) : openChangesPanel()}>{path}</button>;
}

function EditCount({ steps }: { steps: ThreadStep[] }) {
  const added = steps.reduce((total, step) => total + (step.edit?.added ?? 0), 0);
  const removed = steps.reduce((total, step) => total + (step.edit?.removed ?? 0), 0);
  if (!added && !removed) return null;
  return <span className="step-diff"><b>+{added}</b><i>-{removed}</i></span>;
}

const OPEN_CHANGES_EVENT = "shinbo:open-changes";
const openChangesPanel = () => dispatchEvent(new Event(OPEN_CHANGES_EVENT));

const OPEN_ARTIFACT_PANE_EVENT = "shinbo:open-artifact-pane";
const openArtifactPane = (id: string) => dispatchEvent(new CustomEvent(OPEN_ARTIFACT_PANE_EVENT, { detail: id }));

const OPEN_THREAD_EVENT = "shinbo:open-thread";
const openThreadPage = (id: string) => dispatchEvent(new CustomEvent(OPEN_THREAD_EVENT, { detail: id }));

const OPEN_SUBAGENT_EVENT = "shinbo:open-subagent";
const openSubagentTab = (id: string) => dispatchEvent(new CustomEvent(OPEN_SUBAGENT_EVENT, { detail: id }));

const OPEN_GOAL_EVENT = "shinbo:open-goal";
const openGoalPage = (threadId: string) => dispatchEvent(new CustomEvent(OPEN_GOAL_EVENT, { detail: threadId }));

const OPEN_SETTINGS_EVENT = "shinbo:open-settings-page";
const openSettingsPage = (page: SettingsPage) => dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: page }));

function Review({ step }: { step: ThreadStep }) {
  return <details className="step-review">
    <summary><ToolIcon /><span className="step-title">{step.title}</span><span className="step-output">{(step.output ?? "").replace(/\s+/g, " ").slice(0, 120)}</span></summary>
    <b>Context sent to the verifier</b>
    <pre>{step.input || "(nothing)"}</pre>
    <b>What the verifier answered</b>
    <pre>{step.output || "(nothing)"}</pre>
  </details>;
}

function Streaming({ blocks, threadId, spawned }: { blocks: Block[]; threadId: string; spawned?: Spawned[] }) {
  const agent = useAgents().find((item) => item.threadId === threadId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <article className="message assistant streaming">
    <Blocks blocks={blocks} />
    {!!spawned?.length && <SubagentChips spawned={spawned} onOpen={openSubagentTab} />}
    {agent && <Thought text={thinkingOf(blocks)} ms={(agent.endedAt ?? now) - agent.startedAt} tokens={agent.outputTokens} live={agent.endedAt ? undefined : agent.activity || "thinking"} />}
    {!agent && <footer className="message-meta"><span className="pending-note">Streaming…</span></footer>}
  </article>;
}

function AgentTranscript({ threadId, thread }: { threadId: string; thread?: Thread }) {
  const run = useRun(threadId);
  if (thread?.messages.length) return <>{thread.messages.map((item, index) => <Turn key={`${item.timestamp}-${index}`} item={item} />)}</>;
  if (run.blocks.length) return <Streaming blocks={run.blocks} threadId={threadId} />;
  return <p className="waiting" role="status"><Mark /> Waiting for this agent's first turn…</p>;
}

function PastAgentPanel({ thread }: { thread: Thread }) {
  return <section className="conversation agent-conversation" aria-label={`Subagent: ${thread.title}`}>
    <header className="thread-bar">
      <h2><i className="subagent-square" style={{ background: "var(--text-3)" }} aria-hidden="true" /> {thread.title}</h2>
      <div className="thread-actions"><span className="agent-status done">finished</span></div>
    </header>
    <div className="transcript"><AgentTranscript threadId={thread.id} thread={thread} /></div>
  </section>;
}

function SendIcon() {
  return <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 1.5 1.8 6.3l5.1 2 2 5.1z" /><path d="M14.5 1.5 6.9 8.3" /></svg>;
}

let composerSeed = { threadId: "", text: "" };
const seedComposer = (threadId: string, text: string) => { composerSeed = { threadId, text }; };
const takeComposerSeed = (threadId: string) => composerSeed.threadId === threadId ? composerSeed.text : "";

function useBenchRuns(snapshot: Snapshot) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void import("./bench").then(({ readBench }) => { if (live) setCount(readBench().runs.filter((run) => run.state === "running").length); });
    return () => { live = false; };
  }, [snapshot]);
  return count;
}

function useArtifactCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const read = () => void window.shinbo.listArtifacts().then((list) => setCount(list.length)).catch(() => undefined);
    read();
    return window.shinbo.onArtifactsChanged(read);
  }, []);
  return count;
}

function useNotes() {
  const [notes, setNotes] = useState<KeptNote[]>([]);
  const [notesError, setNotesError] = useState("");
  const read = useCallback(() => void window.shinbo.listNotes()
    .then((list) => { setNotes(list); setNotesError(""); })
    .catch((reason: unknown) => { setNotes([]); setNotesError(reasonText(reason)); }), []);
  useEffect(() => {
    read();
    return window.shinbo.onNotesChanged(read);
  }, [read]);
  return { notes, notesError, reloadNotes: read };
}

const LAYOUT_KEY = "shinbo.layout.v2";
const SETUP_SEEN_KEY = "shinbo.setupSeen.v1";
const readLayout = () => {
  try { return validatePaneLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null")); }
  catch { return defaultPaneLayout; }
};

function App() {
  useShortcutRequests();
  useEffect(() => {
    const styles: HTMLStyleElement[] = [];
    void window.shinbo.loadUiPlugins().then((plugins) => {
      for (const plugin of plugins) {
        const style = document.createElement("style");
        style.dataset.shinboPlugin = plugin.id;
        style.textContent = plugin.css;
        document.head.append(style);
        styles.push(style);
      }
    });
    return () => styles.forEach((style) => style.remove());
  }, []);
  const query = new URLSearchParams(location.search);
  if (query.has("annotation")) return <ScreenAnnotation />;
  if (query.has("hotspot")) return <NotchHotspot />;
  if (query.has("radial")) return <RadialCommands />;
  if (query.has("run")) return <ComputerRunBanner />;
  if (query.has("computerCursor")) return <ComputerActivityCursor />;
  return query.has("overlay") ? <Overlay /> : <Workspace />;
}

function ComputerRunBanner() {
  const [progress, setProgress] = useState<ComputerRunProgress>({ step: 0, action: "Starting", actions: 0 });
  useEffect(() => window.shinbo.onComputerRunProgress((value) => { if (validComputerProgress(value)) setProgress(value); }), []);
  const status = `Shinbo is using the computer · ${progress.action}${progress.app ? ` in ${progress.app}` : ""}`;
  return <div className="run-banner">
    <span className="run-banner-icon" role="status" aria-label={status} title={status}><Monitor size={16} aria-hidden="true" /></span>
    <button type="button" aria-label="Stop computer use" title="Stop computer use (Esc). The agent keeps running." onClick={() => window.shinbo.stopComputerRun()}>Stop</button>
  </div>;
}

function ComputerActivityCursor() {
  const [progress, setProgress] = useState<ComputerRunProgress>();
  useEffect(() => window.shinbo.onComputerRunProgress((value) => { if (validComputerProgress(value) && value.cursor) setProgress(value); }), []);
  const cursor = progress?.cursor;
  if (!cursor) return null;
  const x = cursor.x - cursor.bounds.x;
  const y = cursor.y - cursor.bounds.y;
  return <div className="computer-cursor-surface" aria-hidden="true">
    <div key={cursor.windowId} className="computer-cursor" style={{ transform: `translate(${x}px, ${y}px)` }}>
      <span key={progress.actions} className="computer-cursor-ring" />
      <svg className="computer-cursor-arrow" width="21" height="22" viewBox="0 0 21 22"><path d="M1 1L20 14L11.5 15.5L6.5 21Z" /></svg>
      <span className="computer-cursor-label" data-left={x > cursor.bounds.width - 210 || undefined} data-above={y > cursor.bounds.height - 75 || undefined}>
        <strong>Shinbo</strong><span>{progress.action}</span>
      </span>
    </div>
  </div>;
}

function ScreenAnnotation() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") void window.shinbo.cancelScreenAnnotation(); };
    addEventListener("keydown", cancel);
    const target = canvas.current;
    if (target) {
      target.width = Math.round(innerWidth * devicePixelRatio);
      target.height = Math.round(innerHeight * devicePixelRatio);
    }
    return () => removeEventListener("keydown", cancel);
  }, []);
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * target.width / rect.width, y: (event.clientY - rect.top) * target.height / rect.height, scale: target.width / rect.width };
  };
  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const { x, y, scale } = point(event);
    drawing.current = true;
    clearTimeout(settle.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    context.beginPath(); context.moveTo(x, y);
    context.lineCap = "round"; context.lineJoin = "round"; context.lineWidth = 5 * scale;
    context.strokeStyle = "#ffe84f"; context.shadowColor = "#fff46b"; context.shadowBlur = 14 * scale;
  };
  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y); context.stroke();
    setDrawn(true);
  };
  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => void finish(), SETTLE_MS);
  };
  const finish = async () => {
    const target = canvas.current;
    if (!drawn || !target) return;
    try {
      const frame = await window.shinbo.getScreenAnnotationFrame();
      const source = new Image();
      source.src = frame.image;
      await source.decode();
      const composite = document.createElement("canvas");
      composite.width = frame.width;
      composite.height = frame.height;
      const context = composite.getContext("2d");
      if (!context) { setError("Shinbo could not composite the annotated screen"); return; }
      context.drawImage(source, 0, 0, frame.width, frame.height);
      context.drawImage(target, 0, 0, frame.width, frame.height);
      await window.shinbo.finishScreenAnnotation(composite.toDataURL("image/jpeg", 0.8));
    } catch (reason) { setError(reasonText(reason)); }
  };
  return <main className="screen-annotation"><canvas ref={canvas} aria-label="Draw yellow screen highlights" onPointerDown={begin} onPointerMove={draw} onPointerUp={endStroke} onPointerCancel={endStroke} /><div className="annotation-toolbar"><div><strong>Yellow highlight</strong><span>Draw on your live screen · attaches when you stop · Esc cancels</span></div><button type="button" onClick={() => void window.shinbo.cancelScreenAnnotation()}>Cancel</button></div>{error && <p className="annotation-error" role="alert">{error}</p>}</main>;
}

const sameMessages = (left: Message[], right: Message[]) =>
  left.length === right.length && left.every((message, index) => {
    const other = right[index];
    return message.timestamp === other.timestamp && message.role === other.role && message.content === other.content
      && JSON.stringify(message.generation ?? null) === JSON.stringify(other.generation ?? null);
  });

const sameThread = (left: Thread, right: Thread) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]) as Set<keyof Thread>;
  for (const key of keys) {
    if (left[key] === right[key]) continue;
    if (key !== "messages" && key !== "messageDates" && key !== "goal") return false;
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false;
  }
  return true;
};

function useSnapshot(onLoad?: (snapshot: Snapshot) => void) {
  const [snapshot, setSnapshot] = useState(empty);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const booted = useRef(takeBootSnapshot());
  const held = useRef(empty);
  const skipped = useRef(false);
  const owned = useRef(false);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const inFlight = booted.current;
      booted.current = undefined;
      const compact = await (inFlight ?? window.shinbo.request<CompactSnapshot>("threadSummaries"));
      if (ticket !== latest.current) return;
      const previous = held.current;
      const known = new Map(previous.threads.map((item) => [item.id, item]));
      let reused = 0;
      const threads = compact.threads.map(({ messages, ...thread }) => {
        const fresh: Thread = { ...thread, messages: [], messageCount: messages };
        const kept = known.get(fresh.id);
        if (!kept || !sameThread(kept, fresh)) return fresh;
        reused += 1;
        return kept;
      });
      const next: Snapshot = {
        ...compact,
        threads: reused === threads.length && reused === previous.threads.length ? previous.threads : threads,
        scheduledJobs: JSON.stringify(compact.scheduledJobs) === JSON.stringify(previous.scheduledJobs) ? previous.scheduledJobs : compact.scheduledJobs,
      };
      held.current = next;
      setSnapshot(next);
      setRevision((current) => current + 1);
      onLoad?.(next);
      setLoaded(true);
      if (owned.current) {
        owned.current = false;
        setError("");
      }
    } catch (reason) {
      if (ticket !== latest.current) return;
      setLoaded(true);
      owned.current = true;
      setError(reasonText(reason));
    }
  }, [onLoad]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = () => { skipped.current = false; void load(); };
    const refreshVisible = () => { if (document.visibilityState === "visible") refresh(); else skipped.current = true; };
    const listener = window.shinbo.onChanged(refresh);
    const shown = () => { if (document.visibilityState === "visible" && skipped.current) refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", shown);
    const timer = setInterval(refreshVisible, SNAPSHOT_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", shown);
      clearInterval(timer);
      window.shinbo.offChanged(listener);
    };
  }, [load]);
  const notify = useCallback((text: string) => {
    owned.current = false;
    setError(text);
  }, []);
  return { snapshot, load, error, setError: notify, revision, loading: !loaded };
}

function Workspace() {
  const [threadId, setThreadId] = useState("");
  const pinSelections = useCallback((next: Snapshot) => {
    const live = next.threads.filter((item) => !item.archivedAt && item.kind !== "subagent");
    setThreadId((current) => live.some((item) => item.id === current) ? current : (live[0]?.id ?? ""));
  }, []);
  const { snapshot, load, error, setError, revision, loading: snapshotLoading } = useSnapshot(pinSelections);
  const [view, setViewState] = useState<"threads" | "knowledge" | "artifacts" | "agent" | "scheduled" | "plugins" | "archive" | "settings">("threads");
  const viewRef = useRef(view);
  useLayoutEffect(() => { viewRef.current = view; }, [view]);
  const workflowDirty = useRef(false);
  const setView = useCallback((next: typeof view) => {
    if (viewRef.current === "scheduled" && next !== "scheduled" && workflowDirty.current && !confirm("Leave this workflow? What you changed here is not saved.")) return;
    setViewState(next);
  }, []);
  const trail = useRef({ stack: [] as { view: typeof view; threadId: string }[], at: -1, jumping: false });
  const [trailAt, setTrailAt] = useState(-1);
  const [trailLen, setTrailLen] = useState(0);
  useEffect(() => {
    const here = trail.current;
    if (here.jumping) { here.jumping = false; return; }
    const top = here.stack[here.at];
    if (top && top.view === view && top.threadId === threadId) return;
    here.stack = [...here.stack.slice(0, here.at + 1), { view, threadId }].slice(-50);
    here.at = here.stack.length - 1;
    setTrailAt(here.at);
    setTrailLen(here.stack.length);
  }, [view, threadId]);
  const jump = (step: number) => {
    const here = trail.current;
    const entry = here.stack[here.at + step];
    if (!entry) return;
    here.at += step;
    here.jumping = true;
    setTrailAt(here.at);
    setView(entry.view);
    setThreadId(entry.threadId);
  };
  const [threadMenu, setThreadMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [threadSubmenu, setThreadSubmenu] = useState<"project" | "tag" | "copy" | "">("");
  const showThreadMenu = (id: string, x: number, y: number) => { setThreadSubmenu(""); setThreadMenu({ id, x, y }); };
  const [projectMenu, setProjectMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameDone = useRef(false);
  const startRename = (id: string, value: string) => { renameDone.current = false; setRenaming({ id, value }); };
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);
  const warning = snapshot.warnings.find((item) => !dismissedWarnings.includes(item)) ?? "";
  const [busy, setBusy] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [threadLimits, setThreadLimits] = useState<Record<string, number>>({});
  const projectList = useRef<HTMLDivElement>(null);
  const [listRows, setListRows] = useState(THREAD_PAGE);
  useEffect(() => {
    const box = projectList.current;
    if (!box) return;
    const watch = new ResizeObserver(() => setListRows(Math.floor(box.clientHeight / THREAD_ROW)));
    watch.observe(box);
    return () => watch.disconnect();
  }, []);
  const searchInput = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef("");
  const [grants, setGrants] = useState<FolderGrant[]>([]);
  const [tags, setTags] = useState(threadTags);
  const [filedFolders, setFiledFolders] = useState(threadFolderMap);
  const [pins, setPins] = useState(pinnedThreads);
  const phone = usePhone();
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [markedUnread, setMarkedUnread] = useState(unreadThreads);
  useEffect(() => {
    const reload = () => { void window.shinbo.listFolders().then(setGrants).catch(() => undefined); setTags(threadTags()); setFiledFolders(threadFolderMap()); setPins(pinnedThreads()); setMarkedUnread(unreadThreads()); };
    reload();
    addEventListener("shinbo-thread-folders-changed", reload);
    addEventListener("shinbo-thread-tags-changed", reload);
    addEventListener("shinbo-thread-pins-changed", reload);
    addEventListener("shinbo-thread-unread-changed", reload);
    const stop = window.shinbo.onFoldersChanged(reload);
    return () => { stop(); removeEventListener("shinbo-thread-folders-changed", reload); removeEventListener("shinbo-thread-tags-changed", reload); removeEventListener("shinbo-thread-pins-changed", reload); removeEventListener("shinbo-thread-unread-changed", reload); };
  }, []);
  const [setupOpen, setSetupOpen] = useState(() => !localStorage.getItem(SETUP_SEEN_KEY));
  const [layout, setLayout] = useState<PaneLayout>(readLayout);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("keybinds");
  const [settings, setSettings] = useState(readSettings);
  const [interactionLocked, setInteractionLocked] = useState(false);
  const saveToolSettings = async (tools: ToolSettings) => {
    const valid = persistSettings({ ...settings, tools });
    setSettings(valid);
    await window.shinbo.setToolSettings(valid.tools);
  };
  const agents = useAgents();
  const benchRuns = useBenchRuns(snapshot);
  const artifactCount = useArtifactCount();
  const { notes, notesError, reloadNotes } = useNotes();
  const [artifactPick, setArtifactPick] = useState({ id: "", at: 0 });
  const [artifactPaneId, setArtifactPaneId] = useState("");
  const [filesPane, setFilesPane] = useState<{ open: boolean; ask?: OpenFileRequest }>({ open: false });
  const [reviewPane, setReviewPane] = useState<"changes" | "git" | "">("");
  useEffect(() => {
    const open = (requested: string) => {
      if (!settingsPages.some((item) => item.id === requested)) return;
      setSettingsPage(requested as SettingsPage);
      setView("settings");
    };
    const fromTranscript = (event: Event) => open((event as CustomEvent<string>).detail);
    addEventListener(OPEN_SETTINGS_EVENT, fromTranscript);
    const stop = window.shinbo.onOpenSettings(open);
    return () => { removeEventListener(OPEN_SETTINGS_EVENT, fromTranscript); stop(); };
  }, [setView]);
  const [tab, setTab] = useState("thread");
  const actionInFlight = useRef(false);
  const restoredModel = useRef(false);
  const liveThreads = useMemo(() => snapshot.threads.filter((item) => !item.archivedAt && item.kind !== "subagent"), [snapshot.threads]);
  const archivedThreads = useMemo(() => snapshot.threads.filter((item) => item.archivedAt && item.kind !== "subagent"), [snapshot.threads]);
  const selectedSummary = liveThreads.find((item) => item.id === threadId) ?? liveThreads[0];
  const selectedId = selectedSummary?.id ?? "";
  const selectedIdRef = useRef(selectedId);
  const loadedFor = useRef("");
  const loadSequence = useRef(0);
  const parentRequest = useRef("");
  const subthreadRequest = useRef("");
  const [loadedThread, setLoadedThread] = useState<Thread & { context: ThreadContext }>();
  const [loadedSubthread, setLoadedSubthread] = useState<Thread>();
  const [threadLoadError, setThreadLoadError] = useState<{ id: string; text: string }>();
  useLayoutEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const loadThread = useCallback(async (id: string) => {
    const parentId = selectedId;
    const requestId = `${id}:${++loadSequence.current}`;
    if (id === parentId) parentRequest.current = requestId;
    else subthreadRequest.current = requestId;
    setThreadLoadError((current) => current?.id === id ? undefined : current);
    try {
      const [next, context] = await Promise.all([window.shinbo.request<Thread>("thread", { threadId: id }), window.shinbo.getThreadContext(id)]);
      const currentRequest = id === parentId ? parentRequest.current : subthreadRequest.current;
      if (!isCurrentThreadLoad(parentId, selectedIdRef.current, requestId, currentRequest)) return;
      if (id === parentId) setLoadedThread((current) => current?.id !== next.id ? { ...next, context } : {
        ...next,
        messages: sameMessages(current.messages, next.messages) ? current.messages : next.messages,
        context: JSON.stringify(current.context) === JSON.stringify(context) ? current.context : context,
      });
      else setLoadedSubthread(next);
    } catch (reason) {
      const currentRequest = id === parentId ? parentRequest.current : subthreadRequest.current;
      if (selectedIdRef.current === parentId && currentRequest === requestId) {
        const text = reasonText(reason);
        setThreadLoadError({ id, text });
      }
    }
  }, [selectedId]);
  const selectedGoalKey = JSON.stringify(selectedSummary?.goal ?? null);
  useEffect(() => {
    if (loadedFor.current !== selectedId) {
      loadedFor.current = selectedId;
      parentRequest.current = "";
      subthreadRequest.current = "";
    }
    if (!selectedId) {
      return;
    }
    let active = true;
    queueMicrotask(() => { if (active) void loadThread(selectedId); });
    return () => { active = false; };
  }, [loadThread, selectedId, selectedSummary?.messageCount, selectedSummary?.title, selectedSummary?.updatedAt, selectedGoalKey]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void window.shinbo.getThreadContext(selectedId).then((context) => {
      if (!active) return;
      setLoadedThread((current) => current?.id !== selectedId || JSON.stringify(current.context) === JSON.stringify(context) ? current : { ...current, context });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [revision, selectedId]);
  const thread = loadedThread?.id === selectedId ? loadedThread : undefined;
  const uiBusy = busy || interactionLocked;
  const threadStatus = useMemo(() => {
    const rank: Record<string, number> = { running: 1, waiting: 2, failed: 3 };
    const map = new Map<string, ThreadLive>(agents.filter((agent) => !agent.parentThreadId).map((agent) => [agent.threadId, agent]));
    for (const agent of agents) {
      const parent = agent.parentThreadId;
      if (parent && (rank[agent.status] ?? 0) > (rank[map.get(parent)?.status ?? ""] ?? 0)) map.set(parent, agent);
    }
    return map;
  }, [agents]);
  const [seenRuns, setSeenRuns] = useState<Record<string, string>>(storedSeenRuns);
  useEffect(() => { storeSeenRuns(seenRuns); }, [seenRuns]);
  const openThreadId = view === "threads" && !selection.length ? thread?.id : undefined;
  const openStamp = openThreadId ? runStamp(threadStatus.get(openThreadId)) : "";
  if (openThreadId && openStamp && seenRuns[openThreadId] !== openStamp) {
    const known = new Set(snapshot.threads.map((item) => item.id));
    setSeenRuns({ ...Object.fromEntries(Object.entries(seenRuns).filter(([id]) => known.has(id))), [openThreadId]: openStamp });
  }
  const unseen = useCallback((id: string) => {
    const stamp = runStamp(threadStatus.get(id));
    return markedUnread.includes(id) || (!!stamp && seenRuns[id] !== stamp);
  }, [markedUnread, threadStatus, seenRuns]);
  const threadModelKey = thread?.context.model || "fallback";
  const threadModelLabel = modelKeyLabel(settings, threadModelKey);
  const threadModelBrand = modelKeyBrand(settings, threadModelKey);
  const { contextTokens } = useSelectedModel(settings, threadModelKey);
  useEffect(() => {
    const timer = setTimeout(() => localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)), LAYOUT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [layout]);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const reload = () => setSettings(readSettings());
    addEventListener("storage", reload);
    addEventListener("shinbo-settings-changed", reload);
    return () => { removeEventListener("storage", reload); removeEventListener("shinbo-settings-changed", reload); };
  }, []);
  useEffect(() => {
    let asked = 0;
    const resync = () => {
      if (document.hidden || window.innerWidth <= window.outerWidth || Date.now() - asked < 2_000) return;
      asked = Date.now();
      window.shinbo.resyncWindow();
    };
    const fit = () => { setViewportWidth(window.innerWidth); resync(); };
    resync();
    addEventListener("resize", fit);
    addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);
    return () => { removeEventListener("resize", fit); removeEventListener("focus", resync); document.removeEventListener("visibilitychange", resync); };
  }, []);
  const pane = useCallback((change: Partial<PaneLayout>) => setLayout((current) => {
    const next = validatePaneLayout({ ...current, ...change });
    return JSON.stringify(next) === JSON.stringify(current) ? current : next;
  }), []);
  const inspectorBefore = useRef<boolean | null>(null);
  const showBrowser = useCallback((open: boolean) => {
    if (open) {
      setArtifactPaneId("");
      setReviewPane("");
      setFilesPane((current) => ({ ...current, open: false }));
      inspectorBefore.current ??= layout.inspectorCollapsed;
      pane({ browserOpen: true, inspectorCollapsed: true });
      return;
    }
    const before = inspectorBefore.current;
    inspectorBefore.current = null;
    pane({ browserOpen: false, ...(before === false ? { inspectorCollapsed: false } : {}) });
  }, [layout.inspectorCollapsed, pane]);
  const showArtifact = useCallback((id: string) => {
    if (id) {
      setReviewPane("");
      setFilesPane((current) => ({ ...current, open: false }));
      inspectorBefore.current ??= layout.inspectorCollapsed;
      setArtifactPaneId(id);
      setView("threads");
      pane({ inspectorCollapsed: true });
      return;
    }
    const before = inspectorBefore.current;
    inspectorBefore.current = null;
    setArtifactPaneId("");
    if (before === false) pane({ inspectorCollapsed: false });
  }, [layout.inspectorCollapsed, pane, setView]);
  const showReview = useCallback((next: "changes" | "git" | "") => {
    setReviewPane(next);
    if (next) {
      inspectorBefore.current ??= layout.inspectorCollapsed;
      setArtifactPaneId("");
      setFilesPane((current) => ({ ...current, open: false }));
      pane({ browserOpen: false, inspectorCollapsed: true });
      return;
    }
    const before = inspectorBefore.current;
    inspectorBefore.current = null;
    if (before === false) pane({ inspectorCollapsed: false });
  }, [layout.inspectorCollapsed, pane]);
  const clearFileAsk = useCallback(() => setFilesPane((current) => current.ask ? { ...current, ask: undefined } : current), []);
  const showFiles = useCallback((open: boolean) => {
    setFilesPane((current) => ({ ...current, open }));
    if (open) {
      setArtifactPaneId("");
      setReviewPane("");
      inspectorBefore.current ??= layout.inspectorCollapsed;
      pane({ browserOpen: false, inspectorCollapsed: true });
      return;
    }
    const before = inspectorBefore.current;
    inspectorBefore.current = null;
    if (before === false) pane({ inspectorCollapsed: false });
  }, [layout.inspectorCollapsed, pane]);
  useEffect(() => {
    const open = (event: Event) => showArtifact((event as CustomEvent<string>).detail);
    addEventListener(OPEN_ARTIFACT_PANE_EVENT, open);
    return () => removeEventListener(OPEN_ARTIFACT_PANE_EVENT, open);
  }, [showArtifact]);
  useEffect(() => {
    const open = (event: Event) => {
      showFiles(true);
      setFilesPane((current) => ({ ...current, ask: { ...(event as CustomEvent<OpenFileRequest>).detail } }));
    };
    addEventListener(OPEN_FILE_PANE_EVENT, open);
    return () => removeEventListener(OPEN_FILE_PANE_EVENT, open);
  }, [showFiles]);
  useEffect(() => window.shinbo.onBrowserShow((shown) => {
    if (shown.threadId === thread?.id) { setArtifactPaneId(""); showBrowser(true); }
  }), [thread?.id, showBrowser]);
  const fitted = fitPaneLayout(artifactPaneId || reviewPane || filesPane.open ? { ...layout, browserOpen: true } : layout, viewportWidth);
  const shellStyle = {
    "--sidebar-width": `${fitted.sidebarWidth}px`,
    "--inspector-width": `${fitted.inspectorCollapsed ? 0 : fitted.inspectorWidth}px`,
    "--browser-width": `${fitted.browserOpen ? fitted.browserWidth : 0}px`,
    "--terminal-height": `${layout.terminalOpen ? layout.terminalHeight : 0}px`,
  } as CSSProperties;
  const jobIds = useMemo(() => new Set(snapshot.scheduledJobs.map((job) => job.id)), [snapshot.scheduledJobs]);
  const filedThreads = useMemo(() => liveThreads.filter((item) => !item.scheduledJobId || !jobIds.has(item.scheduledJobId)), [liveThreads, jobIds]);
  const scheduledThreads = useMemo(() => liveThreads.filter((item) => item.scheduledJobId && jobIds.has(item.scheduledJobId)), [liveThreads, jobIds]);
  const threadById = useMemo(() => new Map(liveThreads.map((item) => [item.id, item])), [liveThreads]);
  const projectOf = useCallback((item: Thread) => {
    let at: Thread | undefined = item;
    for (let hop = 0; at && hop < 8; hop += 1) {
      const grant = grants.find((folder) => folder.id === filedFolders[at!.id]?.[0]);
      if (grant) return grant.id;
      at = threadById.get(at.parentThreadId ?? "");
    }
    return "";
  }, [filedFolders, grants, threadById]);
  const repoKey = useMemo(() => JSON.stringify([...new Set(filedThreads.map(projectOf).filter(Boolean))].sort()), [filedThreads, projectOf]);
  const threadRepos = useThreadGit(repoKey);
  const projectName = useCallback((item: Thread) => grants.find((grant) => grant.id === projectOf(item))?.name ?? "", [grants, projectOf]);
  const projects = useMemo(() => {
    const filedTo = new Map(filedThreads.map((item) => [item.id, projectOf(item)]));
    const loose = filedThreads.filter((item) => !pins.includes(item.id));
    const groups = ordered(grants.map((grant) => ({ id: grant.id, name: grant.name, threads: nested(loose.filter((item) => filedTo.get(item.id) === grant.id)) }))
      .sort((left, right) => newest(right.threads) - newest(left.threads)), layout.projectOrder);
    const unfiled = nested(loose.filter((item) => !filedTo.get(item.id)));
    if (unfiled.length) groups.push({ id: "unfiled", name: "Unfiled", threads: unfiled });
    const kept = pins.map((id) => filedThreads.find((item) => item.id === id)).filter((item) => item !== undefined);
    const shown = layout.projectSort === "priority" ? [{ id: "priority", name: "Priority", threads: nested(loose) }] : groups;
    return kept.length ? [{ id: "pinned", name: "Pinned", threads: kept }, ...shown] : shown;
  }, [filedThreads, grants, layout.projectOrder, layout.projectSort, pins, projectOf]);
  const search = threadQuery.trim().toLowerCase();
  const visibleProjects = useMemo(() => search
    ? projects.map((group) => group.name.toLowerCase().includes(search) ? group : { ...group, threads: group.threads.filter((item) => threadTitle(item).toLowerCase().includes(search) || (tags[item.id]?.tag ?? "").includes(search)) }).filter((group) => group.threads.length)
    : projects, [projects, search, tags]);
  const queryThreads = (value: string) => { setThreadQuery(value); setThreadLimits({}); };
  const openThread = useCallback((id: string) => {
    const byId = new Map(snapshot.threads.map((item) => [item.id, item]));
    let item = byId.get(id);
    if (item?.archivedAt) { setView("archive"); return; }
    for (let hop = 0; item?.kind === "subagent" && item.parentThreadId && hop < 8; hop += 1) item = byId.get(item.parentThreadId);
    const parentId = item && item.id !== id ? item.id : id;
    if (markedUnread.includes(parentId)) setThreadUnread(parentId, false);
    setThreadId(parentId);
    if (parentId !== id) setTab(id);
    setView("threads");
  }, [markedUnread, setView, snapshot.threads]);
  useEffect(() => window.shinbo.onSelectThread(openThread), [openThread]);
  const attachComponent = (meta: ComponentMeta) => {
    const pick: ContextPick = { kind: "component", id: meta.id, title: meta.title };
    const id = thread?.id;
    if (!id) return;
    const draft = threadDraft(id);
    setThreadDraft(id, { ...draft, picks: [...draft.picks.filter((held) => pickKey(held) !== pickKey(pick)), pick] });
    setView("threads");
  };
  useEffect(() => {
    const open = (event: Event) => { openThread((event as CustomEvent<string>).detail); void load(); };
    addEventListener(OPEN_THREAD_EVENT, open);
    return () => removeEventListener(OPEN_THREAD_EVENT, open);
  }, [load, openThread]);
  const connectProject = () => {
    setError("");
    void window.shinbo.pickFolder().then((granted) => {
      setGrants(granted);
      const added = granted.find((grant) => !grants.some((known) => known.id === grant.id));
      if (!added) return;
      pane({ projectOrder: [added.id, ...layout.projectOrder.filter((id) => id !== added.id)] });
      void createThread(added.id);
    }).catch((reason: unknown) => setError(reasonText(reason)));
  };
  const forgetProject = (id: string) => {
    const group = projects.find((item) => item.id === id);
    setProjectMenu(null);
    if (!group) return;
    if (group.threads.length && !confirm(`Remove ${group.name} from the sidebar? Its ${group.threads.length} thread(s) move to Unfiled.`)) return;
    setError("");
    void window.shinbo.forgetFolder(group.id).then(setGrants).catch((reason: unknown) => setError(reasonText(reason)));
  };
  const moveThread = async (id: string, folderIds: string[]) => {
    setThreadMenu(null);
    setError("");
    try {
      const context = await window.shinbo.getThreadContext(id);
      const mode = await window.shinbo.setThreadContext({ threadId: id, folderIds, mode: context.mode, review: context.review });
      setThreadFolders(id, folderIds);
      setLoadedThread((current) => current?.id === id ? { ...current, context: { ...current.context, folderIds, mode } } : current);
    } catch (reason) { setError(reasonText(reason)); }
  };
  const setArchived = async (id: string, archived: boolean) => {
    setThreadMenu(null);
    if (await act("setThreadArchived", { threadId: id, archived: String(archived) }) !== undefined) await load();
  };
  const clickThread = (event: ReactMouseEvent, group: { threads: Thread[] }, id: string) => {
    if (event.shiftKey) {
      const from = group.threads.findIndex((item) => item.id === anchor.current);
      const to = group.threads.findIndex((item) => item.id === id);
      const span = from < 0 ? [id] : group.threads.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id);
      setSelection((current) => [...new Set([...current, ...span])]);
      return;
    }
    anchor.current = id;
    if (event.metaKey || event.ctrlKey) { setSelection((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); return; }
    setSelection([]);
    openThread(id);
  };
  const renameThread = async (id: string, title: string) => {
    if (renameDone.current) return;
    renameDone.current = true;
    setRenaming(null);
    const named = title.trim();
    const current = liveThreads.find((item) => item.id === id);
    if (!named || (current && (named === current.title || named === threadName(current)))) return;
    if (await act("renameThread", { threadId: id, title: named }) !== undefined) await load();
  };
  const archiveThreads = async (ids: string[]) => {
    setThreadMenu(null);
    for (const id of ids) if (await act("setThreadArchived", { threadId: id, archived: "true" }) === undefined) break;
    setSelection([]);
    await load();
  };

  const act = async (method: string, params: Record<string, string> = {}) => {
    if (actionInFlight.current) { setError("Wait for the current action to finish, then try again."); return undefined; }
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await window.shinbo.request<unknown>(method, params);
      return result;
    } catch (reason) {
      await load();
      setError(reasonText(reason));
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (restoredModel.current) return;
    restoredModel.current = true;
    void (async () => {
      let initializationError = "";
      try {
        await syncMainPreferences(settings);
        if (settings.selectedModel === "fallback") {
          try {
            if ((JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<UserSettings> | null)?.selectedModel !== "fallback") return;
          } catch { return; }
          await window.shinbo.request("selectFallbackModel");
          return;
        }
        try {
          if (routerIdFor(settings.selectedModel)) {
            await selectModelKey(settings, settings.selectedModel, (method, params) => window.shinbo.request(method, params));
            return;
          }
          if (settings.selectedModel.startsWith("provider:")) {
            const profile = settings.providers.find((item) => item.id === settings.selectedModel.slice("provider:".length));
            if (!profile) throw new Error("The saved provider is missing");
            await window.shinbo.setProviders(settings.providers);
            await window.shinbo.request("selectProviderModel", { providerId: profile.id, effort: settings.thinkingLevel });
            return;
          }
          if (settings.selectedModel.startsWith("openrouter:")) {
            const modelId = settings.selectedModel.slice("openrouter:".length);
            const catalog = await window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels");
            if (!catalog.models.some((model) => model.id === modelId)) throw new Error("The saved OpenRouter model is no longer in the catalog");
            await window.shinbo.request("selectOpenRouterModel", { modelId, effort: settings.thinkingLevel });
            return;
          }
          if (settings.selectedModel.startsWith(CODEX_PREFIX)) {
            await window.shinbo.request("selectCodexModel", { modelId: codexSlug(settings.selectedModel), effort: settings.thinkingLevel });
            return;
          }
          throw new Error("The saved model selection is invalid");
        } catch (reason) {
          const message = reasonText(reason);
          initializationError = message;
          let resetFailure = "";
          await window.shinbo.request("selectFallbackModel").catch((resetReason) => {
            resetFailure = reasonText(resetReason);
          });
          setError(`Saved model unavailable; Shinbo sends no model until you pick one. ${message}${resetFailure ? ` Runtime reset failed: ${resetFailure}` : ""}`);
          const next = persistSettings({ ...settings, selectedModel: "fallback" });
          setSettings(next);
        }
      } catch (reason) {
        initializationError = reasonText(reason);
        setError(initializationError);
      } finally {
        restoredModel.current = !initializationError;
        await window.shinbo.runtimeReady(initializationError.slice(0, 4096)).catch((reason: unknown) => setError(reasonText(reason)));
      }
    })();
  }, [settings, setError]);

  const createThread = async (folderId?: string, seed?: string) => {
    const folder = folderId ?? (thread ? projectOf(thread) : "");
    const created = await act("createThread") as Thread | undefined;
    if (!created) return;
    try {
      await window.shinbo.setThreadContext({ threadId: created.id, folderIds: folder ? [folder] : [], mode: settings.defaultPermissionMode });
    } catch (reason) { setError(reasonText(reason)); return; }
    if (folder) setThreadFolders(created.id, [folder]);
    if (seed) seedComposer(created.id, seed);
    setThreadId(created.id);
    setView("threads");
    await load();
  };
  const editArtifact = (artifact: Artifact) => createThread(undefined, [
    `Edit the artifact "${artifact.title}" (${ARTIFACT_LABELS[artifact.kind].toLowerCase()}, id \`${artifact.id}\`, v${artifact.version}).`,
    "",
    "Read it first with `artifact {\"action\":\"get\",\"id\":\"" + artifact.id + "\"}`, then write the change back with `update` for a small edit or `rewrite` when most of it changes.",
    "",
    "What I want changed: ",
  ].join("\n"));

  const shortcut = useRef((_event: KeyboardEvent) => undefined);
  useEffect(() => {
    shortcut.current = (event: KeyboardEvent) => {
      const primary = IS_WINDOWS ? event.ctrlKey && !event.metaKey : event.metaKey && !event.ctrlKey;
      if (!primary || event.altKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest(".terminal-panel")) return;
      if (event.key === "n") { event.preventDefault(); setError(""); void createThread(); return; }
      if (!/^[1-9]$/.test(event.key)) return;
      const pick = threadAt(projects, thread?.id ?? "", Number(event.key) - 1);
      if (!pick) return;
      event.preventDefault();
      setSelection([]);
      openThread(pick);
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => shortcut.current(event);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const saveBenchCase = async (id: string) => {
    setThreadMenu(null);
    const summary = liveThreads.find((entry) => entry.id === id);
    const item = summary ? await window.shinbo.request<Thread>("thread", { threadId: id }).catch(() => undefined) : undefined;
    const prompt = item?.messages.find((message) => message.role === "user")?.content.trim() ?? "";
    const folderId = threadFolders(id)[0] ?? "";
    if (!item || !prompt) { setError("The bench replays a thread's first message, and this one has none yet."); return; }
    if (!folderId) { setError("The bench replays a thread in its folder, and this one has no folder."); return; }
    const [{ readBench, saveBench }, { MAX_BENCH_CASES, MAX_BENCH_PROMPT_CHARS }] = await Promise.all([import("./bench"), import("../shared/bench")]);
    const store = readBench();
    if (store.cases.some((row) => row.fromThreadId === id)) { setError("That thread is already a bench case, and the bench counts each case once."); return; }
    if (store.cases.length >= MAX_BENCH_CASES) { setError(`The bench holds ${MAX_BENCH_CASES} cases — remove one on the Agent page first.`); return; }
    saveBench({ ...store, cases: [...store.cases, { id: `case-${Date.now().toString(36)}`, title: item.title, prompt: prompt.slice(0, MAX_BENCH_PROMPT_CHARS), folderId, fromThreadId: id, createdAt: Date.now() }] });
    setError(`Saved as bench case ${store.cases.length + 1} of ${MAX_BENCH_CASES} · ${threadLabel(summary ?? item)}`);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [draggingProject, setDraggingProject] = useState(false);
  const [navMore, setNavMore] = useState(false);
  const navCounts: Record<string, number> = { knowledge: notes.length, artifacts: artifactCount, agent: benchRuns, scheduled: snapshot.scheduledJobs.length, plugins: 0 };
  const navPages = ordered(NAV_VIEWS.map((id) => ({ id })), layout.navOrder);
  const navShown = navMore ? navPages : navPages.filter((item, at) => at < NAV_PINNED || item.id === view);
  const dropped = (all: { id: string }[], write: (order: string[]) => void) => ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = all.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    write(arrayMove(ids, from, to));
  };
  const menuThread = threadMenu ? liveThreads.find((item) => item.id === threadMenu.id) : undefined;
  const menuProjectId = menuThread ? projectOf(menuThread) : "";
  const menuRun = !!menuThread?.scheduledJobId && jobIds.has(menuThread.scheduledJobId);
  const menuTag = menuThread ? tags[menuThread.id]?.tag ?? "" : "";
  const copyThreadValue = (value: string) => {
    setThreadMenu(null);
    void navigator.clipboard.writeText(value).catch((reason: unknown) => setError(reasonText(reason)));
  };
  const markThreadUnread = (id: string, unread: boolean) => {
    const stamp = runStamp(threadStatus.get(id));
    if (!unread && stamp) setSeenRuns((current) => ({ ...current, [id]: stamp }));
    setThreadUnread(id, unread);
    setThreadMenu(null);
  };

  return (
    <div className={`app-shell ${IS_WINDOWS ? "win32" : ""}`} style={shellStyle}>
      <a className="skip-link" href="#content">Skip to content</a>
      <div className="drag-region" />
      <Region name="navbar" props={{
        view, setView, busy: uiBusy,
        threads: liveThreads, projects: visibleProjects, agents,
        counts: { threads: liveThreads.length, notes: notes.length, artifacts: artifactCount, scheduled: snapshot.scheduledJobs.length },
        threadId: thread?.id, openThread, newThread: () => { setError(""); void createThread(); },
        collapsed: layout.sidebarCollapsed, setCollapsed: (sidebarCollapsed: boolean) => pane({ sidebarCollapsed }),
      }}>
      <aside className={`sidebar ${layout.sidebarCollapsed ? "collapsed" : ""} ${layout.navIcons ? "nav-icons" : ""}`} aria-label="Workspace navigation">
        <div className="brand">
          <div className="sidebar-search">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" strokeLinecap="round" /></svg>
            <label className="sr-only" htmlFor="thread-search">Search threads</label>
            <input ref={searchInput} id="thread-search" type="search" value={threadQuery} onChange={(event) => queryThreads(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") queryThreads(""); }} placeholder="Search" />
          </div>
          <button type="button" className="new-thread" title="New thread" aria-label="New thread" onClick={() => { setError(""); void createThread(); }} disabled={uiBusy}>＋</button>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropped(navPages, (navOrder) => pane({ navOrder }))}>
          <SortableContext items={navShown.map((item) => item.id)}>
            <nav className="sidebar-nav">
              {navShown.map((item) => <Sortable key={item.id} id={item.id} className="nav-sort">{(handle) =>
                <button {...handle} data-view={item.id} title={navLabels[item.id]} disabled={uiBusy} className={view === item.id ? "active" : ""} onClick={() => { if (item.id === "artifacts") setArtifactPick({ id: "", at: 0 }); setView(item.id); }}><span><NavIcon view={item.id} /></span><span className="nav-label">{navLabels[item.id]}</span>{navCounts[item.id] > 0 && <b>{navCounts[item.id]}</b>}</button>}
              </Sortable>)}
              {navPages.length > navShown.length || navMore
                ? <button type="button" className="nav-more" title={navMore ? "Show fewer sections" : "Show every section"} aria-expanded={navMore} onClick={() => setNavMore(!navMore)}><span><NavIcon view="more" /></span><span className="nav-label">{navMore ? "Less" : "More"}</span></button>
                : null}
            </nav>
          </SortableContext>
        </DndContext>
        <AgentRail agents={agents} active={view === "threads" ? tab : undefined} onPick={(agent) => {
          setView("threads");
          if (agent.parentThreadId) { setThreadId(agent.parentThreadId); setTab(agent.threadId); }
          else { setThreadId(agent.threadId); setTab("thread"); }
        }} />
        <BackgroundRail />
        <DndContext sensors={sensors} collisionDetection={closestCenter} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={() => setDraggingProject(true)}
          onDragCancel={() => setDraggingProject(false)}
          onDragEnd={(event) => { setDraggingProject(false); dropped(projects, (projectOrder) => pane({ projectOrder }))(event); }}>
        <SortableContext items={visibleProjects.filter((group) => !virtualGroup(group.id) && group.id !== "unfiled").map((group) => group.id)} strategy={verticalListSortingStrategy}>
        <div className="sidebar-projects" ref={projectList} data-dragging={draggingProject || undefined}>
          <span className="sidebar-label">Projects<span className="sidebar-label-actions"><button type="button" className={`project-new ${layout.projectSort === "priority" ? "on" : ""}`} aria-label="Group threads" title="Group threads" aria-haspopup="menu" aria-expanded={sortMenu !== null} onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setSortMenu({ x: box.left, y: box.bottom + 2 }); }}><FilterIcon /></button><button type="button" className="project-new" disabled={uiBusy} aria-label="Connect a folder" title="Connect a folder" onClick={connectProject}>＋</button></span></span>
          {selection.length > 0 && <div className="thread-selection"><span className="nav-label">{selection.length} selected</span><button type="button" disabled={uiBusy} onClick={() => void archiveThreads(selection)}>Archive</button><button type="button" onClick={() => setSelection([])} aria-label="Clear selection">×</button></div>}
          {visibleProjects.map((group) => { const limit = threadLimits[group.id] ?? Math.max(THREAD_PAGE, Math.floor((listRows - visibleProjects.length - 1) / visibleProjects.length)); return <Sortable key={group.id} id={group.id} className="project-sort" disabled={virtualGroup(group.id) || group.id === "unfiled"}>{(handle) => <details className={`project-group ${virtualGroup(group.id) ? "flat" : ""}`} open><summary {...handle} onContextMenu={(event) => { event.preventDefault(); setProjectMenu({ id: group.id, x: event.clientX, y: event.clientY }); }}>{!virtualGroup(group.id) && group.id !== "unfiled" && <FolderIcon />}<span className="nav-label">{group.name}</span>{group.id !== "pinned" && <button type="button" className="project-new" disabled={uiBusy} aria-label={group.id === "priority" ? "New thread" : `New thread in ${group.name}`} title={group.id === "priority" ? "New thread" : `New thread in ${group.name}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setError(""); void createThread(group.id === "priority" ? undefined : group.id === "unfiled" ? "" : group.id); }}>＋</button>}<b>{group.threads.length}</b></summary>{group.threads.slice(0, limit).map((item) => renaming?.id === item.id
            ? <form key={item.id} className="project-thread renaming" onSubmit={(event) => { event.preventDefault(); void renameThread(item.id, renaming.value); }}><input autoFocus value={renaming.value} maxLength={THREAD_NAME_MAX} aria-label="Thread name" onChange={(event) => setRenaming({ id: item.id, value: event.target.value })} onBlur={() => void renameThread(item.id, renaming.value)} onKeyDown={(event) => { if (event.key === "Escape") { renameDone.current = true; setRenaming(null); } }} /><ThreadStatus live={threadStatus.get(item.id)} unseen={unseen(item.id)} /></form>
            : <div className={`project-row ${threadMenu?.id === item.id ? "menu-open" : ""}`} key={item.id}><button type="button" style={{ "--thread-depth": threadDepth(group.threads, item) } as CSSProperties} className={`project-thread ${item.id === thread?.id && view === "threads" && !selection.length ? "active" : ""} ${selection.includes(item.id) ? "selected" : ""}`} title={threadLabel(item)} disabled={uiBusy} onClick={(event) => clickThread(event, group, item.id)} onDoubleClick={() => startRename(item.id, threadName(item))} onContextMenu={(event) => { event.preventDefault(); showThreadMenu(item.id, event.clientX, event.clientY); }}><span className="thread-copy"><span className="nav-label">{threadLabel(item)}</span>{virtualGroup(group.id) && <span className="thread-home"><FolderIcon /><span>{projectName(item) || "Unfiled"}</span></span>}</span><span className="thread-indicators">{phone.threads.includes(item.id) && <Smartphone size={14} strokeWidth={1.6} role="img" aria-label="Started from phone" />}<ThreadGitStatus snapshot={threadRepos[projectOf(item)]} /><ThreadStatus live={threadStatus.get(item.id)} unseen={unseen(item.id)} /></span>{tags[item.id] && <em className={`thread-tag ${tags[item.id].auto ? "auto" : ""}`} title={tags[item.id].auto ? `${tags[item.id].tag} · Shinbo’s guess, right-click to change it` : tags[item.id].tag}>{tags[item.id].tag}</em>}</button><button type="button" className={`thread-pin ${pins.includes(item.id) ? "on" : ""}`} title={pins.includes(item.id) ? "Unpin thread" : "Pin thread"} aria-label={`${pins.includes(item.id) ? "Unpin" : "Pin"} ${threadLabel(item)}`} aria-pressed={pins.includes(item.id)} disabled={uiBusy} onClick={() => setThreadPinned(item.id, !pins.includes(item.id))}><Pin size={14} strokeWidth={1.6} fill={pins.includes(item.id) ? "currentColor" : "none"} aria-hidden="true" /></button><button type="button" className="thread-actions" title="Thread options" aria-label={`Options for ${threadLabel(item)}`} aria-haspopup="menu" aria-expanded={threadMenu?.id === item.id} disabled={uiBusy} onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); showThreadMenu(item.id, box.left, box.bottom + 2); }}><DotsIcon /></button></div>)}{group.threads.length > limit && <button type="button" className="project-more" onClick={() => setThreadLimits((current) => ({ ...current, [group.id]: limit + Math.max(THREAD_PAGE, listRows, limit) }))}>Load more ({group.threads.length - limit})</button>}{!group.threads.length && <p className="project-empty">No threads yet</p>}</details>}</Sortable>; })}
          {search && !visibleProjects.length && <p className="project-empty">No threads match that search</p>}
        </div>
        </SortableContext>
        </DndContext>
        {snapshot.scheduledJobs.length > 0 && <details className="sidebar-scheduled">
          <summary className={scheduledThreads.some((item) => unseen(item.id)) ? "new-runs" : ""}><HourglassIcon /><span className="nav-label">Scheduled tasks</span></summary>
          {snapshot.scheduledJobs.map((job) => { const runs = scheduledThreads.filter((item) => item.scheduledJobId === job.id); return <details className="project-group" key={job.id} open><summary><span className="nav-label">{job.title}</span><b>{runs.length}</b></summary>{runs.map((item) => <button key={item.id} type="button" style={{ "--thread-depth": 1 } as CSSProperties} className={`project-thread ${item.id === thread?.id && view === "threads" && !selection.length ? "active" : ""}`} title={`${threadLabel(item)} · ${date(item.createdAt)} ${time(item.createdAt)}`} disabled={uiBusy} onClick={() => openThread(item.id)} onContextMenu={(event) => { event.preventDefault(); showThreadMenu(item.id, event.clientX, event.clientY); }}><span className="nav-label">{date(item.createdAt)} · {time(item.createdAt)}</span><ThreadStatus live={threadStatus.get(item.id)} unseen={unseen(item.id)} /></button>)}{!runs.length && <p className="project-empty">No runs yet</p>}</details>; })}
        </details>}
        <div className="nav-foot"><HarnessStatus /><PhoneMark state={phone.state} disabled={uiBusy} onClick={() => { setView("settings"); setSettingsPage("mobile"); }} /><button type="button" className={`nav-settings ${layout.navIcons ? "active" : ""}`} title={layout.navIcons ? "Show sections as rows" : "Show sections as icons"} aria-label="Show sections as icons" aria-pressed={layout.navIcons} onClick={() => pane({ navIcons: !layout.navIcons })}><NavIcon view="tiles" /></button><button type="button" data-view="archive" className={`nav-settings nav-archive ${view === "archive" ? "active" : ""}`} title="Archive" aria-label="Archive" aria-pressed={view === "archive"} disabled={uiBusy} onClick={() => setView("archive")}><NavIcon view="archive" /></button><button type="button" data-view="settings" className={`nav-settings ${view === "settings" ? "active" : ""}`} title="Settings" aria-label="Settings" aria-pressed={view === "settings"} disabled={uiBusy} onClick={() => setView("settings")}><NavIcon view="settings" /></button></div>
        {!layout.sidebarCollapsed && <ResizeHandle label="Resize navigation" value={layout.sidebarWidth} min={200} max={340} onChange={(sidebarWidth) => pane({ sidebarWidth })} />}
      </aside>
      </Region>
      <main id="content" className="content">
        {view === "threads" ? thread ? <ThreadView key={thread.id} thread={thread} loadedSubthread={loadedSubthread} loadThread={loadThread} threadLoadError={threadLoadError} clearThreadLoadError={() => setThreadLoadError(undefined)} snapshot={snapshot} notes={notes} busy={uiBusy} act={act} reload={load} agents={agents} tab={tab} setTab={setTab} newThread={(seed?: string) => { setError(""); void createThread(undefined, seed); }} onSendingChange={setInteractionLocked} onModelChanged={(next) => { if (selectedIdRef.current === thread.id) parentRequest.current = ""; setLoadedThread((current) => current?.id === thread.id ? { ...current, context: { ...current.context, model: next.selectedModel, effort: next.thinkingLevel } } : current); }} onContextChanged={(context) => { if (selectedIdRef.current === thread.id) parentRequest.current = ""; setLoadedThread((current) => current?.id === thread.id ? { ...current, context } : current); }} onManageModels={() => { setView("settings"); setSettingsPage("models"); }} onManageImports={() => { setView("settings"); setSettingsPage("imports"); }} modelKey={threadModelKey} modelLabel={threadModelLabel} modelBrand={threadModelBrand} thinkingLevel={thread.context.effort} reviewOffered={settings.review.enabled && !!settings.review.model.trim()} contextTokens={contextTokens} contextPages={settings.contextPages} onContextPages={(contextPages) => setSettings(persistSettings({ ...settings, contextPages }))} layout={layout} pane={pane} showBrowser={showBrowser} reviewPane={reviewPane} showReview={showReview} filesPane={filesPane} showFiles={showFiles} clearFileAsk={clearFileAsk} artifactPaneId={artifactPaneId} setArtifactPaneId={showArtifact} editArtifact={editArtifact} /> : <ThreadLoading loading={snapshotLoading || !!selectedSummary} error={threadLoadError?.id === selectedId ? threadLoadError.text : ""} busy={uiBusy} retry={() => { setError(""); setThreadLoadError(undefined); void loadThread(selectedId); }} newThread={() => { setError(""); void createThread(); }} /> : view === "knowledge" ? <NotesView notes={notes} notesError={notesError} busy={uiBusy} reload={reloadNotes} hues={settings.folderHues} setHues={(folderHues) => setSettings(persistSettings({ ...settings, folderHues }))} /> : view === "artifacts" ? <ArtifactsView key={artifactPick.at} busy={uiBusy} select={artifactPick.id} openArtifact={(artifact) => void editArtifact(artifact)} /> : view === "agent" ? <Suspense fallback={<AgentLoading />}><AgentView snapshot={snapshot} act={act} busy={uiBusy} openThread={openThread} projectName={projectName} mode={settings.defaultPermissionMode} model={settings.selectedModel} pickers={{ run: (model, effort, onPick, busy) => <BenchRunPicker model={model} effort={effort} onPick={onPick} onSettingsChanged={setSettings} busy={busy} />, judge: (draft, onChange, busy) => <SecondModelPicker label="Judge model" off="Tagger model · scores with your tagger" draft={draft ?? { ...settings.tagger, model: "" }} providers={settings.providers} routers={settings.routers} busy={busy} onChange={(next) => onChange(next.model ? next : undefined)} />, describe: (key) => ({ label: modelKeyLabel(settings, key), brand: modelKeyBrand(settings, key)?.id ?? "" }) }} /></Suspense> : view === "scheduled" ? <ScheduledView snapshot={snapshot} act={act} busy={uiBusy} openThread={openThread} dirtyRef={workflowDirty} /> : view === "plugins" ? <Suspense fallback={<AgentLoading copy="Loading plugins…" />}><PluginsView busy={uiBusy} tools={settings.tools} onTools={saveToolSettings} /></Suspense> : view === "archive" ? <ArchiveView threads={archivedThreads} projectName={projectName} busy={uiBusy} restore={(id) => void setArchived(id, false)} /> : <SettingsView page={settingsPage} onSelectPage={setSettingsPage} act={act} busy={uiBusy} onModelChanged={setSettings} onAttach={attachComponent} />}
      </main>
      {(error || warning) && <div className="notice" role="status"><button aria-label="Dismiss notice" onClick={() => { if (error) setError(""); else setDismissedWarnings((current) => [...current, warning]); }}>×</button>{error || warning}</div>}
      {threadMenu && menuThread && <MenuScrim close={() => setThreadMenu(null)}>
        <menu className="thread-menu thread-context-menu" aria-label={`Actions for ${threadLabel(menuThread)}`} style={{ left: `clamp(8px, ${threadMenu.x}px, calc(100vw - 236px))`, top: `clamp(8px, ${threadMenu.y}px, calc(100vh - 280px))` }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
          <div className="thread-menu-head">Thread</div><hr />
          {!menuRun && <button type="button" role="menuitem" autoFocus disabled={uiBusy} onClick={() => { setThreadPinned(menuThread.id, !pins.includes(menuThread.id)); setThreadMenu(null); }}><span className="thread-menu-icon"><Pin size={14} strokeWidth={1.6} fill={pins.includes(menuThread.id) ? "currentColor" : "none"} aria-hidden="true" /></span><span>{pins.includes(menuThread.id) ? "Unpin" : "Pin"}</span></button>}
          <button type="button" role="menuitem" autoFocus={!!menuRun} disabled={uiBusy} onClick={() => { setThreadMenu(null); startRename(menuThread.id, threadName(menuThread)); }}><span className="thread-menu-icon"><PencilIcon /></span><span>Rename</span></button>
          <button type="button" role="menuitem" onClick={() => markThreadUnread(menuThread.id, !unseen(menuThread.id))}><span className="thread-menu-icon"><UnreadIcon /></span><span>{unseen(menuThread.id) ? "Mark as read" : "Mark as unread"}</span></button>
          <button type="button" role="menuitem" disabled={uiBusy} onClick={() => void archiveThreads(selection.includes(menuThread.id) ? selection : [menuThread.id])}><span className="thread-menu-icon"><ArchiveIcon /></span><span>{selection.includes(menuThread.id) && selection.length > 1 ? `Archive ${selection.length} threads` : "Archive"}</span></button>
          {!menuRun && <>
            <hr />
            <div className="thread-menu-branch" onPointerEnter={() => setThreadSubmenu("project")}>
              <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={threadSubmenu === "project"} onClick={() => setThreadSubmenu("project")}><span className="thread-menu-icon"><FolderIcon /></span><span>Project</span><CaretIcon /></button>
              {threadSubmenu === "project" && <menu className="thread-submenu" aria-label="Move thread to project">
                <div className="thread-menu-head">Move to</div><hr />
                <button type="button" role="menuitemradio" aria-checked={!menuProjectId} onClick={() => void moveThread(menuThread.id, [])}><span className="thread-menu-icon"><FolderIcon /></span><span>Unfiled</span><span className="thread-menu-check"><CheckIcon /></span></button>
                {grants.map((grant) => <button type="button" role="menuitemradio" aria-checked={menuProjectId === grant.id} key={grant.id} onClick={() => void moveThread(menuThread.id, [grant.id])}><span className="thread-menu-icon"><FolderIcon /></span><span>{grant.name}</span><span className="thread-menu-check"><CheckIcon /></span></button>)}
              </menu>}
            </div>
            <div className="thread-menu-branch" onPointerEnter={() => setThreadSubmenu("tag")}>
              <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={threadSubmenu === "tag"} onClick={() => setThreadSubmenu("tag")}><span className="thread-menu-icon"><TagIcon /></span><span>Tag</span><CaretIcon /></button>
              {threadSubmenu === "tag" && <menu className="thread-submenu thread-tag-submenu" aria-label="Set thread tag">
                <form className="thread-menu-tag" key={menuThread.id} onSubmit={(event) => { event.preventDefault(); setThreadTag(menuThread.id, String(new FormData(event.currentTarget).get("tag") ?? "")); setThreadMenu(null); }}><input name="tag" list="thread-tag-names" autoComplete="off" maxLength={32} defaultValue={menuTag} placeholder="Type a tag" aria-label="Thread tag" /><button type="submit">Save</button><datalist id="thread-tag-names">{handTags().map((tag) => <option key={tag} value={tag} />)}</datalist></form>
                {handTags().filter((tag) => tag !== menuTag).slice(0, 6).map((tag) => <button type="button" role="menuitem" key={tag} onClick={() => { setThreadTag(menuThread.id, tag); setThreadMenu(null); }}><span className="thread-menu-icon"><TagIcon /></span><span>{tag}</span></button>)}
                {menuTag && <button type="button" role="menuitem" onClick={() => { setThreadTag(menuThread.id, ""); setThreadMenu(null); }}><span className="thread-menu-icon"><TrashIcon /></span><span>Clear tag</span></button>}
              </menu>}
            </div>
          </>}
          <hr />
          <button type="button" role="menuitem" disabled={uiBusy} onClick={() => void saveBenchCase(menuThread.id)}><span className="thread-menu-icon"><SparkIcon /></span><span>Save as bench case</span></button>
          <div className="thread-menu-branch" onPointerEnter={() => setThreadSubmenu("copy")}>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={threadSubmenu === "copy"} onClick={() => setThreadSubmenu("copy")}><span className="thread-menu-icon"><CopyIcon /></span><span>Copy</span><CaretIcon /></button>
            {threadSubmenu === "copy" && <menu className="thread-submenu" aria-label="Copy thread details">
              <button type="button" role="menuitem" onClick={() => copyThreadValue(threadLabel(menuThread))}><span className="thread-menu-icon"><CopyIcon /></span><span>Title</span></button>
              <button type="button" role="menuitem" onClick={() => copyThreadValue(menuThread.id)}><span className="thread-menu-icon"><CopyIcon /></span><span>Thread ID</span></button>
            </menu>}
          </div>
        </menu>
      </MenuScrim>}
      {sortMenu && <MenuScrim close={() => setSortMenu(null)}><menu className="thread-menu" role="menu" aria-label="Group threads" style={{ left: sortMenu.x, top: sortMenu.y }}>
        <div className="thread-menu-head"><FilterIcon />Group threads</div><hr />
        {(["project", "priority"] as const).map((sort) => <button type="button" key={sort} role="menuitemradio" aria-checked={layout.projectSort === sort} onClick={() => { pane({ projectSort: sort }); setSortMenu(null); }}><span className="thread-menu-icon">{sort === "project" ? <FolderIcon /> : <HourglassIcon />}</span><span>By {sort}</span><span className="thread-menu-check"><CheckIcon /></span></button>)}
      </menu></MenuScrim>}
      {projectMenu && <MenuScrim close={() => setProjectMenu(null)}><menu className="thread-menu" aria-label="Project actions" style={{ left: projectMenu.x, top: projectMenu.y }}><div className="thread-menu-head">Project</div><hr /><ProjectSweep threads={visibleProjects.find((group) => group.id === projectMenu.id)?.threads ?? []} busy={uiBusy} archive={archiveThreads} />{projectMenu.id !== "unfiled" && !virtualGroup(projectMenu.id) && <button type="button" disabled={uiBusy} onClick={() => forgetProject(projectMenu.id)}><span className="thread-menu-icon"><TrashIcon /></span><span>Remove from sidebar</span></button>}</menu></MenuScrim>}
      {setupOpen && <SetupDialog close={() => { localStorage.setItem(SETUP_SEEN_KEY, "1"); setSetupOpen(false); setSettings(readSettings()); void createThread(); }} />}
      <div className="rail-nav">
        <button type="button" className="rail-toggle" aria-label={layout.sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!layout.sidebarCollapsed} onClick={(event) => { event.currentTarget.focus(); pane({ sidebarCollapsed: !layout.sidebarCollapsed }); }}><SidebarIcon /></button>
        <button type="button" className="rail-toggle" aria-label="Back" title="Back" disabled={trailAt <= 0} onClick={() => jump(-1)}><ChevronIcon back /></button>
        <button type="button" className="rail-toggle" aria-label="Forward" title="Forward" disabled={trailAt >= trailLen - 1} onClick={() => jump(1)}><ChevronIcon /></button>
      </div>
      <PreviewHost />
      <Built />
      <UpdateNotice />
    </div>
  );
}

function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateState>(IDLE_UPDATE);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const show = (next: unknown) => { const state = readUpdateState(next); if (state) { setUpdate(state); setHidden(false); } };
    void window.shinbo.updateState().then(show).catch(() => undefined);
    return window.shinbo.onUpdate(show);
  }, []);
  useEffect(() => {
    if (update.phase !== "current") return;
    const timer = setTimeout(() => setHidden(true), UPDATE_CURRENT_MS);
    return () => clearTimeout(timer);
  }, [update]);
  if (hidden || update.phase === "idle") return null;
  const dismiss = <button type="button" aria-label="Dismiss" onClick={() => setHidden(true)}>×</button>;
  if (update.phase === "checking") return <div className="pick-toast update" role="status"><span className="toast-actions"><span className="browser-loading" />Checking for updates…</span></div>;
  if (update.phase === "installing") return <div className="pick-toast update" role="status" aria-live="polite">
    <span>Installing {update.version}</span>
    <span className="toast-actions"><span className="browser-loading" />{update.step}…</span>
    <div className="tool-progress"><span className="index-bar" style={{ "--p": `${update.percent}%` } as CSSProperties}><b /></span><small>{update.percent}%</small></div>
  </div>;
  if (update.phase === "error") return <div className="pick-toast update" role="alert">
    <span className="toast-actions">Update failed{dismiss}</span>
    <small className="update-detail">{update.detail}</small>
  </div>;
  if (update.phase === "current") return <div className="pick-toast update" role="status"><span className="toast-actions">Shinbo is up to date · {update.version}{dismiss}</span></div>;
  return <div className="pick-toast update" role="status">
    <span>Update ready · {update.version}</span>
    <span className="toast-actions">
      <button type="button" className="update-install" onClick={() => void window.shinbo.installUpdate().catch(() => undefined)}>Install and relaunch</button>
      {dismiss}
    </span>
  </div>;
}

const UPDATE_CURRENT_MS = 4000;

const THREAD_PAGE = 6;

const LAYOUT_SAVE_MS = 250;

const THREAD_ROW = 30;

const NAV_PINNED = 3;

const SWEEP_DAYS = [7, 30, 90, 180];

function MenuScrim({ close, children }: { close: () => void; children: ReactNode }) {
  return <div className="thread-menu-scrim" tabIndex={-1} ref={(node) => { if (node && !node.contains(document.activeElement)) node.focus(); }} onClick={close}
    onContextMenu={(event) => { event.preventDefault(); if (event.target === event.currentTarget) close(); }}
    onKeyDown={(event) => { if (event.key === "Escape") close(); }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>{children}</div>;
}

function ProjectSweep({ threads, busy, archive }: { threads: Thread[]; busy: boolean; archive: (ids: string[]) => Promise<void> }) {
  const stale = (days: number) => threads.filter((item) => Date.parse(item.updatedAt) < Date.now() - days * 86_400_000).map((item) => item.id);
  return <>{SWEEP_DAYS.map((days) => { const ids = stale(days); return <button key={days} type="button" disabled={busy || !ids.length} onClick={() => void archive(ids)}><span className="thread-menu-icon"><ArchiveIcon /></span><span>Archive older than {days} days ({ids.length})</span></button>; })}</>;
}

const navLabels: Record<string, string> = { knowledge: "Knowledge base", artifacts: "Artifacts", agent: "Agent", scheduled: "Workflows", plugins: "Plugins" };
const navHueDefaults: Record<string, string> = { knowledge: "teal", artifacts: "", scheduled: "violet", agent: "lime", plugins: "" };
const navHueHex = (settings: UserSettings, view: string) => {
  const hue = settings.navHues[view] ?? navHueDefaults[view];
  if (hue.startsWith("#")) return hue.slice(0, 7);
  return getComputedStyle(document.documentElement).getPropertyValue(`--${hue || "text-3"}`).trim().slice(0, 7);
};

function NavIcon({ view }: { view: string }) {
  const paths: Record<string, ReactNode> = {
    threads: <><path d="M13.8 9.2a1.3 1.3 0 0 1-1.3 1.3H5.4l-2.7 2.7V4a1.3 1.3 0 0 1 1.3-1.3h8.5A1.3 1.3 0 0 1 13.8 4z" /><path d="M5.4 5.9h5.2M5.4 8h3.4" /></>,
    knowledge: <><path d="M8 4.4S6.6 3.1 3.2 3.1a.6.6 0 0 0-.6.6v7.6a.6.6 0 0 0 .6.6c3.4 0 4.8 1.3 4.8 1.3s1.4-1.3 4.8-1.3a.6.6 0 0 0 .6-.6V3.7a.6.6 0 0 0-.6-.6C9.4 3.1 8 4.4 8 4.4z" /><path d="M8 4.4v8.8" /></>,
    artifacts: <><path d="M9.3 1.9H4.4a1 1 0 0 0-1 1v10.2a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1V5.2z" /><path d="M9.3 1.9v3.3h3.3M5.9 8.4h4.2M5.9 10.9h2.8" /></>,
    agent: <><path d="M8 1.4v2.1" /><rect x="2.9" y="3.5" width="10.2" height="8.9" rx="2.4" /><path d="M1.3 7.3v2.2M14.7 7.3v2.2M6.1 10.2h3.8" /><circle cx="6" cy="7.3" r="0.95" fill="currentColor" stroke="none" /><circle cx="10" cy="7.3" r="0.95" fill="currentColor" stroke="none" /></>,
    scheduled: <><circle cx="8" cy="8" r="5.8" /><path d="M8 4.6V8l2.4 1.6" /></>,
    plugins: <><path d="M6.1 2.2v3.2M9.9 2.2v3.2" /><path d="M4.3 5.4h7.4v2.4a3.7 3.7 0 0 1-7.4 0z" /><path d="M8 11.5v2.3" /></>,
    archive: <><path d="M2.2 3.4h11.6v2.7H2.2z" /><path d="M3.3 6.1v6.1a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1V6.1M6.4 8.6h3.2" /></>,
    settings: <g transform="scale(.667)" strokeWidth="1.95"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></g>,
    tiles: <><rect x="2.4" y="2.4" width="4.7" height="4.7" rx="1" /><rect x="8.9" y="2.4" width="4.7" height="4.7" rx="1" /><rect x="2.4" y="8.9" width="4.7" height="4.7" rx="1" /><rect x="8.9" y="8.9" width="4.7" height="4.7" rx="1" /></>,
    more: <path d="M4 6.3 8 10.2l4-3.9" />,
  };
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[view]}</svg>;
}

function Sortable({ id, className, disabled, children }: { id: string; className: string; disabled?: boolean; children: (handle: Record<string, unknown>) => ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  return <div ref={setNodeRef} className={className} data-dragging={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform), transition }}>
    {children({ ref: setActivatorNodeRef, ...listeners })}
  </div>;
}

const virtualGroup = (id: string) => id === "pinned" || id === "priority";

function CheckIcon() {
  return <Check size={14} strokeWidth={1.6} aria-hidden="true" />;
}

function FilterIcon() {
  return <ArrowDownWideNarrow size={14} strokeWidth={1.6} aria-hidden="true" />;
}

function FolderIcon() {
  return <span className="project-folder" aria-hidden="true"><Folder size={14} strokeWidth={1.6} aria-hidden="true" /></span>;
}

function HourglassIcon() {
  return <span className="project-folder" aria-hidden="true"><Hourglass size={14} strokeWidth={1.6} aria-hidden="true" /></span>;
}

function DotsIcon() {
  return <EllipsisVertical size={14} strokeWidth={1.6} aria-hidden="true" />;
}

function UnreadIcon() {
  return <Eye size={14} strokeWidth={1.6} aria-hidden="true" />;
}

function ArchiveIcon() {
  return <Archive size={14} strokeWidth={1.6} aria-hidden="true" />;
}

function TagIcon() {
  return <Tag size={14} strokeWidth={1.6} aria-hidden="true" />;
}

function CopyIcon() {
  return <Copy size={14} strokeWidth={1.6} aria-hidden="true" />;
}

function AgentLoading({ copy = "Reading what Shinbo's own runs recorded…" }: { copy?: string }) {
  return <div className="content-empty" role="status" aria-live="polite"><Mark /><p>{copy}</p></div>;
}

function ThreadLoading({ loading, error, busy, retry, newThread }: { loading: boolean; error: string; busy: boolean; retry: () => void; newThread: () => void }) {
  return <div className="content-empty"><Mark /><h2>{error ? "Couldn’t load thread" : loading ? "Loading thread" : "Start a thread"}</h2><p>{error ? "Shinbo could not read that transcript." : loading ? "Reading its transcript…" : "Threads keep their transcript, folder and context between launches."}</p>{error ? <button type="button" disabled={busy} onClick={retry}>Retry</button> : !loading && <button type="button" disabled={busy} onClick={newThread}>New thread</button>}</div>;
}

function AgentTranscriptLoading({ error, busy, retry }: { error: string; busy: boolean; retry: () => void }) {
  return <div className="content-empty" role="status" aria-live="polite"><Mark /><p>{error ? "Shinbo could not read that agent transcript." : "Loading agent transcript…"}</p>{error && <button type="button" disabled={busy} onClick={retry}>Retry</button>}</div>;
}

const NODE_PLACEHOLDER = '[\n  {"id": "process", "kind": "script", "text": "/Users/me/project/analyze.py", "input": "{{source}}", "saveAs": "analysis"},\n  {"id": "explain", "kind": "agent", "text": "Analyze this script output:\\n{{analysis}}"}\n]';

const NODE_GLYPHS = { agent: "◆", script: "▶", set: "◇", if: "◈" } as const;

function variableRows(outputs: string) {
  return Object.entries(parseVariables(outputs)).slice(0, 12);
}

function TaskModelPicker({ model, onChange, busy, label = "The model this task runs on", inherit = "Whichever model Shinbo is set to", codex = true }: { model: string; onChange: (model: string, settings: UserSettings) => void | Promise<void>; busy: boolean; label?: string; inherit?: string; codex?: boolean }) {
  const settings = loadSettings();
  const [catalog, setCatalog] = useState<OpenRouterCatalog>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const codexSlugs = useCodexSlugs(catalog?.routes);
  useEffect(() => { void window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels").then(setCatalog).catch(() => undefined); }, []);
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const entries = useMemo(() => modelEntries(settings.providers, catalog?.models ?? [], codexSlugs, catalog?.routes, model), [catalog, codexSlugs, model, settings.providers]);
  const pick = async (key: string, plan?: ModelPlan) => {
    setError("");
    try {
      const routed = plan ? modelPlanRoute(settings, plan, key) : { settings, key };
      let current = routed.settings;
      if (current !== settings) {
        await window.shinbo.setProviders(current.providers);
        current = persistSettings(current);
      }
      await onChange(routed.key === "fallback" ? "" : routed.key, current);
      setOpen(false);
    } catch (reason) { setError(reasonText(reason)); }
  };
  return <div className="task-model verifier-pick" ref={box}>
    <button type="button" className="verifier-pick-trigger" disabled={busy} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      <BrandIcon brand={model ? modelKeyBrand(settings, model) : undefined} className="model-brand" />
      <span>{model ? modelKeyLabel(settings, model) : inherit}</span>
      <b aria-hidden="true">▾</b>
    </button>
    {open && <section className="source-popover model-menu" role="dialog" aria-label={label} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <ModelPicker label={label.toLowerCase()} entries={entries} active={model} busy={busy} providers={settings.providers} favorites={settings.favoriteModels} codex={codex}
        lead={{ key: "", name: "Shinbo's model", detail: inherit, brand: shinboBrand }}
        onPick={(key, plan) => void pick(key, plan)} />
    </section>}
    {error && <small className="local-model-error" role="alert">{error}</small>}
  </div>;
}

function BenchRunPicker({ model, effort, onPick, onSettingsChanged, busy }: { model: string; effort: string; onPick: (next: { model: string; effort: string }) => void; onSettingsChanged: (settings: UserSettings) => void; busy: boolean }) {
  const [catalog, setCatalog] = useState<OpenRouterCatalog>();
  useEffect(() => { void window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels").then(setCatalog).catch(() => undefined); }, []);
  const stops = thinkingStops(reasoningFor(catalog, model));
  return <>
    <TaskModelPicker model={model} busy={busy} label="The model the cases are replayed under" inherit="Pick a model" onChange={(next, current) => { onSettingsChanged(current); onPick({ model: next, effort: "" }); }} />
    {stops.length > 1 && <select aria-label="Thinking level for this run" value={stops.includes(effort) ? effort : ""} disabled={busy} onChange={(event) => onPick({ model, effort: event.target.value })}>
      {stops.map((level) => <option key={level} value={level}>{level === "" ? "Default thinking" : thinkingLabel(level)}</option>)}
    </select>}
  </>;
}

const WORKFLOW_DRAFT_KEY = "shinbo.workflowDraft.v1";

function TaskEditor({ job, runs, act, busy, openThread, onSaved, onDeleted, onDirty, commands, view }: {
  view: "editor" | "graph";
  job?: ScheduledJob;
  runs: Thread[];
  act: (method: string, params?: Record<string, string>) => Promise<unknown>;
  busy: boolean;
  openThread: (id: string) => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onDirty: (dirty: boolean) => void;
  commands: { skills: SlashCommand[]; tools: SlashCommand[]; atItems: SlashCommand[] };
}) {
  const draftKey = `${WORKFLOW_DRAFT_KEY}.${job?.id ?? "new"}`;
  const draft = useMemo(() => { try { return JSON.parse(localStorage.getItem(draftKey) ?? "null") as Partial<Record<"title" | "trigger" | "prompt" | "nodes" | "mode" | "model", string>> | null; } catch { return null; } }, [draftKey]);
  const [title, setTitle] = useState(draft?.title ?? job?.title ?? "");
  const [trigger, setTrigger] = useState(draft?.trigger ?? job?.schedule ?? "0 9 * * 1");
  const [prompt, setPrompt] = useState(draft?.prompt ?? job?.prompt ?? "");
  const [nodes, setNodes] = useState(draft?.nodes ?? job?.nodes ?? "");
  const [mode, setMode] = useState<PermissionMode>(() => { const mode = draft?.mode; return isPermissionMode(mode) ? mode : job?.permissionMode ?? DEFAULT_PERMISSION_MODE; });
  const [model, setModel] = useState(draft?.model ?? job?.model ?? "");
  const dirty = title.trim() !== (job?.title ?? "") || trigger.trim() !== (job?.schedule ?? "0 9 * * 1") || prompt.trim() !== (job?.prompt ?? "") || nodes.trim() !== (job?.nodes ?? "") || mode !== (job?.permissionMode ?? DEFAULT_PERMISSION_MODE) || model !== (job?.model ?? "");
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    if (dirty) localStorage.setItem(draftKey, JSON.stringify({ title, trigger, prompt, nodes, mode, model }));
    else localStorage.removeItem(draftKey);
    return () => localStorage.removeItem(draftKey);
  }, [dirty, draftKey, title, trigger, prompt, nodes, mode, model]);
  const [dryRun, setDryRun] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [selectedNode, setSelectedNode] = useState("");
  const graph = parseWorkflow(nodes, prompt);
  const inspected = graph.nodes.find((node) => node.id === selectedNode) ?? graph.nodes[0];
  const problem = triggerProblem(trigger);
  const promptBytes = new TextEncoder().encode(prompt.trim()).length;
  const promptProblem = promptBytes > MAX_SCHEDULED_PROMPT_BYTES ? `The prompt is ${promptBytes.toLocaleString("en-US")} bytes; a scheduled task holds at most ${MAX_SCHEDULED_PROMPT_BYTES.toLocaleString("en-US")}. Trim it, or move the long part into a note and @-mention it.` : "";
  const ready = Boolean(title.trim() && prompt.trim()) && !problem && !promptProblem && !graph.errors.length && graph.nodes.length > 0;
  const save = async () => {
    if (!ready || busy) return;
    const saved = await act("saveScheduledJob", {
      ...(job ? { jobId: job.id } : {}),
      title: title.trim(),
      schedule: trigger.trim(),
      prompt: prompt.trim(),
      ...(nodes.trim() ? { nodes: nodes.trim() } : {}),
      sourceDomains: JSON.stringify(job?.sourceDomains ?? []),
      permissionMode: mode,
      model,
    }) as { id?: string } | undefined;
    if (saved?.id) onSaved(saved.id);
  };
  const test = async () => {
    const run = await runWorkflow(graph.nodes, parseVariables(job?.outputs ?? ""), (text, node) => Promise.resolve(node.kind === "script" ? `(the script would run: ${text})` : `(a turn would run: ${text})`));
    setDryRun(`${describeRun(run.steps)}\n\nVariables afterwards: ${Object.keys(run.variables).join(", ") || "none"}`);
  };
  const liveRuns = runs.filter((run) => !run.archivedAt).length;
  const remove = async () => {
    if (!job) return;
    if (!confirming) { setConfirming(true); return; }
    if (await act("deleteScheduledJob", { jobId: job.id }) === undefined) return;
    onDeleted();
  };
  return <div className={`task-detail task-composer ${view === "graph" ? "task-graph-view" : ""}`}>
    <header>
      <h3>{title.trim() || "New workflow"}</h3>
      <span>{!job ? "Not saved yet" : !job.enabled ? "Paused" : job.nextRunAt ? `Next run ${date(job.nextRunAt)} · ${time(job.nextRunAt)}` : "Waits for its trigger"}</span>
    </header>
    <div className="task-editor-body" hidden={view !== "editor"}>
    <div className="task-fields">
      <label><span>Name</span><input value={title} maxLength={128} disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder="Daily AI news" /></label>
      <div><span className="task-label">What should Shinbo do?</span><PromptField value={prompt} onChange={setPrompt} commands={[...commands.skills, ...commands.tools]} atItems={commands.atItems} disabled={busy} rows={7} label="What should Shinbo do?" placeholder="Write the instructions just as you would in a conversation. Type / for a skill or tool, @ for a file, artifact or saved page." /></div>
      {promptProblem && <p className="task-problem" role="alert">{promptProblem}</p>}
      <ScheduleField value={trigger} onChange={setTrigger} disabled={busy} />
      <div className="task-run-settings">
        <TaskModelPicker model={model} onChange={setModel} busy={busy} inherit="Current model" label="Workflow model" />
        <div className="task-permissions"><span>Permissions</span><ModePicker mode={mode} setMode={setMode} disabled={busy} /></div>
      </div>
    </div>
    <details className="task-graph task-advanced">
      <summary>{nodes.trim() ? `${graph.nodes.length} workflow steps` : "Advanced · multi-step workflow"}</summary>
      <ol>{graph.nodes.map((node) => <li key={node.id}>
        <span className={`task-node ${node.kind}`}>{NODE_GLYPHS[node.kind]} {node.kind}</span>
        <b>{node.id}</b>
        <span className="task-node-text">{node.text}</span>
        <small>{[node.input !== undefined && `stdin ${node.input || "(empty)"}`, node.saveAs && `→ ${node.saveAs}`, node.next && `then ${node.next}`, node.otherwise && `else ${node.otherwise}`].filter(Boolean).join("  ")}</small>
      </li>)}</ol>
      {graph.errors.map((error) => <p key={error} className="task-problem">{error}</p>)}
      <details className="task-nodes">
        <summary>Write the graph</summary>
        <textarea value={nodes} rows={10} spellCheck={false} disabled={busy} onChange={(event) => setNodes(event.target.value)} placeholder={NODE_PLACEHOLDER} aria-label="Node graph as JSON" />
        <p>Each node has an <b>id</b>, a <b>kind</b> and <b>text</b>. <b>agent</b> runs its text as a turn, <b>script</b> runs a fixed absolute file from a connected folder with optional templated <b>input</b> on stdin, <b>set</b> stores its text, and <b>if</b> branches. <b>saveAs</b> keeps output as a variable; use it later with <b>{"{{name}}"}</b>, while <b>{"{{last}}"}</b> is the last agent answer. A step with no <b>next</b> falls through; <b>"next": "end"</b> finishes the run. Leave this empty for a task that is just its prompt.</p>
      </details>
    </details>
    {graph.errors.map((error) => <p key={error} className="task-problem" role="alert">{error}</p>)}
    </div>
    {view === "graph" && <div className="workflow-canvas-layout">
      <div className="workflow-canvas-main">
        <div className="workflow-trigger">◷ {describeTrigger(trigger)}</div>
        <WorkflowGraph nodes={graph.nodes} errors={graph.errors} selected={inspected?.id ?? ""} onSelect={setSelectedNode} />
      </div>
      <aside className="workflow-inspector" aria-label="Step inspector">
        {inspected ? <>
          <span className={`task-node ${inspected.kind}`}>{NODE_GLYPHS[inspected.kind]} {inspected.kind}</span>
          <h4>{inspected.id}</h4>
          <dl className="graph-detail">
            <div><dt>{inspected.kind === "if" ? "Condition" : inspected.kind === "set" ? "Value" : inspected.kind === "script" ? "Script" : "Prompt"}</dt><dd>{inspected.text}</dd></div>
            {inspected.input !== undefined && <div><dt>Stdin</dt><dd>{inspected.input || "Empty"}</dd></div>}
            {inspected.saveAs && <div><dt>Saves as</dt><dd>{inspected.saveAs}</dd></div>}
            <div><dt>{inspected.kind === "if" ? "If true" : "Then"}</dt><dd>{inspected.next ?? "Next step, or finish"}</dd></div>
            {inspected.kind === "if" && <div><dt>Otherwise</dt><dd>{inspected.otherwise ?? "end"}</dd></div>}
          </dl>
        </> : <p>Add a prompt in the editor to preview your workflow.</p>}
      </aside>
    </div>}
    <div className="task-actions">
      <span className="task-save-summary">{describeTrigger(trigger)}</span>
      <button type="button" disabled={busy || !ready} onClick={() => void save()}>{job ? "Save" : "Create workflow"}</button>
      <button type="button" disabled={busy || !graph.nodes.length || graph.errors.length > 0} onClick={() => void test()}>Test</button>
      {job && <button type="button" disabled={busy} onClick={() => void act("runScheduledJob", { jobId: job.id })}>Run now</button>}
      {job && <button type="button" disabled={busy} onClick={() => void act("setScheduledJobEnabled", { jobId: job.id, enabled: String(!job.enabled) })}>{job.enabled ? "Pause" : "Resume"}</button>}
      {job && <button type="button" className="task-danger" data-armed={confirming} disabled={busy} onClick={() => void remove()}>{confirming ? liveRuns ? `Delete for good · stops and archives ${liveRuns} ${liveRuns === 1 ? "run" : "runs"}` : "Delete for good" : "Delete"}</button>}
    </div>
    {dryRun && <pre className="task-dry-run">{dryRun}</pre>}
    {job && <section className="task-runs">
      <header><h4>Runs</h4><small>{runs.length} {plural(runs.length, "thread")}</small></header>
      {runs.slice(0, 8).map((item) => <button key={item.id} type="button" disabled={busy} onClick={() => openThread(item.id)}>{date(item.createdAt)} · {time(item.createdAt)}<small>{threadMessageCount(item)} {plural(threadMessageCount(item), "message")}</small></button>)}
      {!runs.length && <p>Nothing has run yet.</p>}
      {variableRows(job.outputs).length > 0 && <dl>{variableRows(job.outputs).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
    </section>}
  </div>;
}

function ScheduledView({ snapshot, act, busy, openThread, dirtyRef }: { snapshot: Snapshot; act: (method: string, params?: Record<string, string>) => Promise<unknown>; busy: boolean; openThread: (id: string) => void; dirtyRef: { current: boolean } }) {
  const jobs = snapshot.scheduledJobs;
  const [picked, setPicked] = useState("");
  const [mode, setMode] = useState<"editor" | "graph">("editor");
  const onDirty = useCallback((value: boolean) => { dirtyRef.current = value; }, [dirtyRef]);
  const pick = (id: string) => {
    if (dirtyRef.current && !confirm("Leave this workflow? What you changed here is not saved.")) return;
    setPicked(id);
    if (id === "new") setMode("editor");
  };
  const commands = useTaskCommands(loadSettings().tools.disabledTools);
  const selected = jobs.find((item) => item.id === picked);
  const creating = picked === "new" || (!selected && !jobs.length);
  const job = creating ? undefined : selected ?? jobs[0];
  return <section className="tasks-view">
    <header>
      <span>Prompts, schedules and automations</span>
      <h2>Workflows</h2>
      <div className="tasks-modes" role="tablist" aria-label="Workflow view">
        {(["editor", "graph"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item === "editor" ? "Editor" : "Graph"}</button>)}
      </div>
    </header>
    <div className="tasks-body">
      <nav className="tasks-rail" aria-label="Workflows">
        {jobs.map((item) => <button key={item.id} type="button" className={!creating && item.id === job?.id ? "active" : ""} disabled={busy} onClick={() => pick(item.id)}>
          <span>{item.title}</span>
          <small>{describeTrigger(item.schedule)}</small>
          <b className={item.enabled ? "on" : ""}>{item.enabled ? "live" : "paused"}</b>
        </button>)}
        <button type="button" className={`tasks-new ${creating ? "active" : ""}`} disabled={busy} onClick={() => pick("new")}>+ New workflow</button>
      </nav>
      <TaskEditor
        key={creating ? "new" : job?.id ?? "new"}
        view={mode}
        job={job}
        runs={snapshot.threads.filter((item) => item.scheduledJobId === job?.id)}
        act={act}
        busy={busy}
        openThread={openThread}
        onSaved={setPicked}
        onDeleted={() => setPicked("")}
        onDirty={onDirty}
        commands={commands}
      />
    </div>
  </section>;
}

const ARCHIVE_RETENTION_DAYS = 30;

function ArchiveView({ threads, busy, restore, projectName }: { threads: Thread[]; busy: boolean; restore: (id: string) => void; projectName: (thread: Thread) => string }) {
  const now = new Date();
  const today = date(now.toISOString());
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const previousDay = date(yesterday.toISOString());
  const groups = new Map<string, Thread[]>();
  for (const item of [...threads].sort((a, b) => Date.parse(b.archivedAt!) - Date.parse(a.archivedAt!))) {
    const day = date(item.archivedAt!);
    const group = groups.get(day);
    if (group) group.push(item);
    else groups.set(day, [item]);
  }
  return <section className="scheduled-view archive-view">
    <header><span>Archive</span><h2>Archived threads</h2><p>Threads are permanently deleted {ARCHIVE_RETENTION_DAYS} days after archiving.</p></header>
    {!threads.length ? <div className="content-empty"><Mark /><h2>Nothing archived</h2><p>Archived threads appear here until they are discarded.</p></div> : <div className="archive-timeline">
      <div className="archive-summary"><span>{threads.length} {plural(threads.length, "thread")}</span><span>By archive date · newest first</span></div>
      {[...groups].map(([day, items]) => <section className="archive-day" key={day}>
        <h3>{day === today ? "Today" : day === previousDay ? "Yesterday" : day}</h3>
        <div className="archive-entries">{items.map((item) => {
          const days = Math.max(0, Math.ceil((Date.parse(item.archivedAt!) + ARCHIVE_RETENTION_DAYS * 86_400_000 - now.getTime()) / 86_400_000));
          const count = threadMessageCount(item);
          const project = projectName(item);
          return <article className="archive-entry" key={item.id}>
            <div className="archive-thread"><h4>{threadLabel(item)}</h4><p>{project && <span>{project} · </span>}{count} {plural(count, "message")} · <time dateTime={item.archivedAt!}>{time(item.archivedAt!)}</time></p></div>
            <span className={`archive-expiry${days <= 2 ? " expiring" : ""}`}>{days ? `${days} ${plural(days, "day")} left` : "Deletion pending"}</span>
            <button type="button" disabled={busy} aria-label={`Restore ${threadLabel(item)}`} onClick={() => restore(item.id)}>Restore</button>
          </article>;
        })}</div>
      </section>)}
    </div>}
  </section>;
}

function useVault() {
  const [vault, setVault] = useState<VaultChoice | null>(null);
  const read = useCallback(() => void window.shinbo.vaultStatus().then(setVault).catch(() => setVault(null)), []);
  useEffect(read, [read]);
  return { vault, setVault, reloadVault: read };
}

const noteSource = (note: KeptNote): string => {
  if (note.sourceApplication) return note.sourceApplication;
  if (!note.sourceUrl) return "";
  try {
    return new URL(note.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return note.sourceUrl;
  }
};

function NoteThumb({ path, className }: { path: string; className: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    void window.shinbo.previewPath(path).then((found) => { if (active) setSrc(found?.image ?? ""); }).catch(() => undefined);
    return () => { active = false; };
  }, [path]);
  if (!src) return null;
  return <div className={className}><img src={src} alt="" /></div>;
}

const NOTE_MARK: Record<KeepKind, string> = { page: "▤", screenshot: "▣", selection: "❝", note: "✎" };

function FolderTile({ folder, notes, hue, busy, open, move, recolour, rename }: { folder: NoteFolder; notes: KeptNote[]; hue: AccentChoice | undefined; busy: boolean; open: () => void; move: (notePath: string, folder: string) => void; recolour: (hue: AccentChoice | "") => void; rename: (name: string) => void }) {
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!card.current?.contains(event.target as Node)) setMenu(false); };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [menu]);
  return <article ref={card} className={`kb-folder ${over ? "over" : ""} ${menu ? "picking" : ""}`} style={hue ? { "--kind": hue.startsWith("#") ? hue : `var(--${hue})` } as CSSProperties : undefined}
    onContextMenu={(event) => { event.preventDefault(); setDraft(folder.name); setMenu(true); }}
    onDragOver={(event) => { event.preventDefault(); setOver(true); }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); move(event.dataTransfer.getData("text/plain"), folder.name); }}>
    <button type="button" className="kb-folder-open" disabled={busy} onClick={open}>
      <span className="kb-folder-peek">
        {notes.slice(0, 4).map((note) => <i key={note.path} data-kind={note.kind} title={note.title}>{note.image ? <NoteThumb path={note.image} className="kb-mark-thumb" /> : NOTE_MARK[note.kind]}</i>)}
      </span>
      <span className="kb-folder-front">
        <strong>{folder.name}</strong>
        <small>{notes.length} {plural(notes.length, "save")}</small>
      </span>
    </button>
    {menu && <div className="source-popover kb-menu" role="dialog" aria-label={`${folder.name} options`}
      onKeyDown={(event) => { if (event.key === "Escape") setMenu(false); }}>
      <form onSubmit={(event) => { event.preventDefault(); setMenu(false); rename(draft); }}>
        <input autoFocus value={draft} maxLength={MAX_FOLDER_NAME} spellCheck={false} aria-label={`Rename ${folder.name}`} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
      </form>
      <div className="kb-hues">
        {ACCENT_CHOICES.map((choice) => <button key={choice} type="button" className={`kb-hue ${hue === choice ? "active" : ""}`} style={{ "--swatch": `var(--${choice})` } as CSSProperties}
          title={choice} aria-label={`Colour ${folder.name} ${choice}`} aria-pressed={hue === choice} disabled={busy} onClick={() => recolour(hue === choice ? "" : choice)} />)}
      </div>
    </div>}
  </article>;
}

function NoteCard({ note, busy, open, openLabel }: { note: KeptNote; busy: boolean; open: (note: KeptNote) => void; openLabel: string }) {
  const source = noteSource(note);
  return <article className="kb-card" data-kind={note.kind} draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", note.path); event.dataTransfer.effectAllowed = "move"; }}>
    <button type="button" className="kb-face" title={`Read ${note.title}`} onClick={() => openPreview(note.path, note.title, note.image)}>
      {note.image && <NoteThumb path={note.image} className="kb-thumb" />}
      <em>{keepKindLabel(note.kind)}</em>
      <h3>{note.title}</h3>
      {note.excerpt && <p>{note.excerpt}</p>}
    </button>
    {note.tags.length > 0 && <ul className="kb-tags">{note.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>}
    <footer>
      <time dateTime={note.savedAt}>{date(note.savedAt)}</time>
      {source && <b title={note.sourceUrl ?? source}>{source}</b>}
      <button type="button" className="kb-jump" disabled={busy} title={openLabel} aria-label={`${openLabel} · ${note.title}`} onClick={() => open(note)}>↗</button>
    </footer>
  </article>;
}

function NotesView({ notes, notesError, busy, reload, hues, setHues }: { notes: KeptNote[]; notesError: string; busy: boolean; reload: () => void; hues: Record<string, AccentChoice>; setHues: (hues: Record<string, AccentChoice>) => void }) {
  const { vault, setVault } = useVault();
  const [error, setError] = useState("");
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [into, setInto] = useState("");
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    reload();
    addEventListener("focus", reload);
    return () => removeEventListener("focus", reload);
  }, [reload]);
  useEffect(() => {
    let active = true;
    void window.shinbo.listNoteFolders().then((found) => { if (active) setFolders(found); }).catch(() => { if (active) setFolders([]); });
    return () => { active = false; };
  }, [notes]);
  const go = (folder: string) => { setError(""); setInto(folder); };
  const sorted = useMemo(() => [...notes].sort((a, b) => b.savedAt.localeCompare(a.savedAt)), [notes]);
  const filed = useMemo(() => {
    const shelves = folders.map((folder) => {
      const held = sorted.filter((note) => note.folder === folder.name);
      return { folder, notes: held, changedAt: held[0] && held[0].savedAt > folder.changedAt ? held[0].savedAt : folder.changedAt };
    });
    return shelves.sort((left, right) => right.changedAt.localeCompare(left.changedAt));
  }, [folders, sorted]);
  const shown = sorted.filter((note) => (note.folder ?? "") === into);
  const choose = async () => {
    try {
      const picked = await window.shinbo.pickVaultFolder();
      if (!picked) return;
      await window.shinbo.setVault(picked);
      setVault(picked);
      reload();
    } catch (reason) { setError(reasonText(reason)); }
  };
  const open = (note: KeptNote) => void window.shinbo.openInObsidian(note.path).catch((reason: unknown) => setError(reasonText(reason)));
  const move = (notePath: string, folder: string) => {
    if (!notePath) return;
    setError("");
    void window.shinbo.moveNote({ path: notePath, folder }).then(() => reload()).catch((reason: unknown) => setError(reasonText(reason)));
  };
  const rename = (folder: string, value: string) => {
    const name = value.trim();
    if (!name || name === folder) return;
    setError("");
    void window.shinbo.renameNoteFolder({ folder, name })
      .then(() => {
        if (hues[folder]) { const moved = { ...hues, [name]: hues[folder] }; delete moved[folder]; setHues(moved); }
        reload();
      })
      .catch((reason: unknown) => setError(reasonText(reason)));
  };
  const make = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    void window.shinbo.createNoteFolder(draft)
      .then(() => { setDraft(""); setNaming(false); reload(); })
      .catch((reason: unknown) => setError(reasonText(reason)));
  };
  return <section className="kb-view">
    <header>
      <div>
        {into
          ? <button type="button" className="kb-crumb" onClick={() => go("")} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); move(event.dataTransfer.getData("text/plain"), ""); }}>← Knowledge base</button>
          : <span>Knowledge base</span>}
        <h2>{into || `${sorted.length} ${plural(sorted.length, "save")}`}</h2>
      </div>
      {vault && <div className="kb-vault"><code title={noteFolder(vault)}>{home(noteFolder(vault))}</code><button type="button" disabled={busy} onClick={() => void choose()}>Change folder…</button></div>}
    </header>
    {(error || notesError) && <p className="capability-error" role="alert">{error || notesError}</p>}
    {!vault && <div className="content-empty"><Mark /><h2>No vault yet</h2><p>Pick the <span className="inline-brand"><BrandIcon brand={obsidianBrand} className="inline-brand-mark" />Obsidian</span> vault or folder Shinbo saves into.</p><button type="button" disabled={busy} onClick={() => void choose()}>Choose a folder…</button></div>}
    {vault && !into && <div className="kb-shelf">
      {filed.map((shelf) => <FolderTile key={shelf.folder.name} folder={shelf.folder} notes={shelf.notes} hue={hues[shelf.folder.name]} busy={busy} open={() => go(shelf.folder.name)} move={move}
        recolour={(choice) => { const next = { ...hues }; if (choice) next[shelf.folder.name] = choice; else delete next[shelf.folder.name]; setHues(next); }}
        rename={(name) => rename(shelf.folder.name, name)} />)}
      {naming
        ? <article className="kb-folder kb-folder-new"><form className="kb-folder-front kb-naming" onSubmit={make}><input autoFocus value={draft} maxLength={MAX_FOLDER_NAME} spellCheck={false} aria-label="Folder name" placeholder="Name it…" onChange={(event) => setDraft(event.target.value)} onBlur={() => { setNaming(false); setDraft(""); setError(""); }} onKeyDown={(event) => { if (event.key === "Escape") { setNaming(false); setDraft(""); setError(""); } }} /><small>Enter to create</small></form></article>
        : <article className="kb-folder kb-folder-new"><button type="button" className="kb-folder-open" disabled={busy} onClick={() => setNaming(true)}><span className="kb-folder-front"><strong>＋ New folder</strong><small>Drag saves onto it</small></span></button></article>}
    </div>}
    {vault && !notesError && !(into ? shown.length : sorted.length) && <div className="content-empty"><Mark /><h2>{into ? "This folder is empty" : "Nothing saved yet"}</h2><p>{into ? "Drag a save onto a folder to file it here." : "Saved pages, screenshots and highlights land in the vault folder above."}</p></div>}
    <div className="kb-board">{shown.map((note) => <NoteCard key={note.path} note={note} busy={busy} open={open} openLabel={vault?.kind === "folder" ? (window.shinbo.platform === "win32" ? "Reveal in File Explorer" : "Reveal in Finder") : "Open in Obsidian"} />)}</div>
  </section>;
}

type PaneProps = { reviewPane: "changes" | "git" | ""; showReview: (next: "changes" | "git" | "") => void; filesPane: { open: boolean; ask?: OpenFileRequest }; showFiles: (open: boolean) => void; clearFileAsk: () => void; layout: PaneLayout; pane: (change: Partial<PaneLayout>) => void; showBrowser: (open: boolean) => void; artifactPaneId: string; setArtifactPaneId: (id: string) => void; editArtifact: (artifact: Artifact) => void };

const kindLabel = (kind: ContextPick["kind"]) => kind === "note" ? KIND_LABELS.page : kind === "attachment" ? KIND_LABELS.file : kind === "selection" ? "Selection" : KIND_LABELS[kind];

const pickKindLabel = (pick: ContextPick) => kindLabel(pick.kind);

const pickBrief = (pick: ContextPick) => pick.kind === "file" || pick.kind === "diff" ? pathName(pick.path)
  : pick.kind === "attachment" ? pick.name
  : pick.kind === "artifact" || pick.kind === "note" || pick.kind === "component" ? pick.title
  : pick.kind === "terminal" ? `${pick.lines} ${plural(pick.lines, "line")}`
  : pick.kind === "selection" ? `${pathName(pick.path)}:${pick.from}-${pick.to}`
  : pick.label;

function PickTray({ picks, folders, locked, drop }: { picks: ContextPick[]; folders: FolderGrant[]; locked: boolean; drop: (pick: ContextPick) => void }) {
  if (!picks.length) return null;
  return <div className="composer-tray">{picks.map((pick) => {
    const label = pickLabel(pick, folders);
    return <div className="composer-tile" data-kind={pick.kind} key={pickKey(pick)} title={`${pickKindLabel(pick)} · ${label} · next turn only`}>
      {pick.kind === "attachment" && pick.thumbnail
        ? <img src={pick.thumbnail} alt="" />
        : <><FileMark path={pickBrief(pick)} /><small>{pickBrief(pick)}</small></>}
      {pick.kind !== "attachment" && <em>{pickKindLabel(pick)}</em>}
      <button type="button" disabled={locked} onClick={() => drop(pick)} aria-label={`Remove ${label}`}>×</button>
    </div>;
  })}</div>;
}

const home = (path: string) => IS_WINDOWS ? path.replace(/^[A-Za-z]:[\\/][^\\/]+/, "~") : path.replace(/^\/Users\/[^/]+/, "~");

function ProjectBar({ folders, ids, setFolders, setIds, git, name, busy }: { folders: FolderGrant[]; ids: string[]; setFolders: (folders: FolderGrant[]) => void; setIds: (ids: string[]) => void; git: GitSnapshot | null; name: string; busy: boolean }) {
  const [error, setError] = useState("");
  const [open, setOpen] = useState<"" | "project" | "branch">("");
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const bar = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const branchTrigger = useRef<HTMLButtonElement>(null);
  const shut = useCallback(() => {
    const back = open === "branch" ? branchTrigger.current : trigger.current;
    setOpen(""); setNaming(false); setDraft("");
    queueMicrotask(() => back?.focus());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!bar.current?.contains(event.target as Node)) { setOpen(""); setNaming(false); } };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [open]);
  const project = folders.find((folder) => folder.id === ids[0]);
  const say = (reason: unknown) =>
    setError(reasonText(reason));
  const lead = (id: string) => setIds([id]);
  const choose = (value: string) => {
    setError("");
    if (value !== "pick") { if (value) lead(value); else setIds([]); return; }
    void window.shinbo.pickFolder().then((granted) => {
      setFolders(granted);
      const chosen = granted.find((grant) => !folders.some((known) => known.id === grant.id)) ?? granted.at(-1);
      if (chosen) lead(chosen.id);
    }).catch(say);
  };
  const worktree = (on: boolean) => {
    if (!project) return;
    setError("");
    void window.shinbo.setWorktree({ folderId: project.id, name, on }).then((moved) => {
      setFolders(moved.folders);
      lead(moved.folderId);
    }).catch(say);
  };
  const branchTo = (branch: string, create: boolean) => {
    if (!project || !branch.trim()) return;
    setError("");
    void window.shinbo.setBranch({ folderId: project.id, branch: branch.trim(), create }).catch(say).finally(shut);
  };
  const options = [
    { pick: "", label: "General", detail: "Chat only — no files", current: !project },
    ...folders.map((folder) => ({ pick: folder.id, label: `/${folder.name}`, detail: home(folder.path), current: folder.id === project?.id })),
    { pick: "pick", label: "Connect a folder…", detail: "Native picker", current: false },
  ];
  return <div className="composer-project" ref={bar} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); shut(); } }}
    onBlur={(event) => { if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(""); setNaming(false); } }}>
    <span className="project-chip">
      <button ref={trigger} type="button" className="project-button" disabled={busy} aria-haspopup="listbox" aria-expanded={open === "project"}
        aria-label={`Project folder, currently ${project?.name ?? "General"}`} title={project?.path ?? "No folder — Shinbo can only chat in this thread"}
        onClick={() => open === "project" ? shut() : setOpen("project")}>
        <span className="project-name">{project ? `/${project.name}` : "General"}</span><span aria-hidden="true">▾</span>
      </button>
      {open === "project" && <section className="source-popover project-menu" role="listbox" aria-label="Project folder" tabIndex={-1}>
        {options.map((option) => <button type="button" role="option" aria-selected={option.current} key={option.pick || "general"}
          className={`slash-row ${option.current ? "active" : ""}`} onClick={() => { choose(option.pick); shut(); }}>
          <strong>{option.label}</strong><small>{option.detail}</small>
        </button>)}
      </section>}
    </span>
    {git && <span className="project-chip">
      <button ref={branchTrigger} type="button" className="project-branch" disabled={busy} aria-haspopup="listbox" aria-expanded={open === "branch"}
        aria-label={`Branch, currently ${git.branch}`} title="Check out another branch, or start one here"
        onClick={() => open === "branch" ? shut() : setOpen("branch")}>⑂ {git.branch}</button>
      {open === "branch" && <section className="source-popover project-menu branch-menu" role="listbox" aria-label="Branch" tabIndex={-1}>
        {git.branches.map((branch) => <button type="button" role="option" aria-selected={branch === git.branch} key={branch}
          className={`slash-row ${branch === git.branch ? "active" : ""}`} onClick={() => branchTo(branch, false)}>
          <strong>{branch}</strong>{branch === git.branch && <small>current</small>}
        </button>)}
        {naming
          ? <form className="branch-new" onSubmit={(event) => { event.preventDefault(); branchTo(draft, true); }}>
            <input autoFocus value={draft} maxLength={128} spellCheck={false} placeholder="new-branch-name" aria-label="New branch name" onChange={(event) => setDraft(event.target.value)} />
            <button disabled={!draft.trim()}>Create</button>
          </form>
          : <button type="button" className="slash-row" onClick={() => setNaming(true)}><strong>New branch…</strong><small>from {git.branch}</small></button>}
      </section>}
    </span>}
    {git && <label title={`Work on a checkout of this repo at ${name}, beside the folder itself`}>
      <input type="checkbox" checked={git.worktree} disabled={busy} onChange={(event) => worktree(event.target.checked)} />worktree
    </label>}
    {error && <small role="alert">{error}</small>}
  </div>;
}

function CapabilityPopover({ threadId, locked, close, skill, setSkill, setBusy }: { threadId: string; locked: boolean; close: () => void; skill: ImportedSkill | null; setSkill: (skill: ImportedSkill | null) => void; setBusy: (busy: boolean) => void }) {
  const [skillQuery, setSkillQuery] = useState("");
  const [skills, setSkills] = useState<ImportedSkill[]>([]);
  const [servers, setServers] = useState<ImportedMcpServer[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    void window.shinbo.searchImportedSkills({ query: "", limit: 64 }).then((value) => { if (active) setSkills(value); }).catch(() => undefined);
    void window.shinbo.listImportedMcpServers().then((value) => { if (active) setServers(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const run = async <T,>(operation: () => Promise<T>, onResult: (value: T) => void) => {
    if (locked || pending) return;
    setPending(true); setBusy(true); setError("");
    try { onResult(await operation()); }
    catch (reason) { setError(reasonText(reason)); }
    finally { setPending(false); setBusy(false); }
  };
  const shownSkills = skills.filter((item) => `${item.source}/${item.name}`.toLowerCase().includes(skillQuery.trim().toLowerCase()));
  const attach = (item: ImportedSkill) => void run(() => window.shinbo.selectImportedSkill({ id: item.id, threadId }), setSkill);
  const clearSkill = () => void run(() => window.shinbo.clearImportedSkill(skill?.id ?? ""), () => setSkill(null));
  return <section className="capability-panel" aria-label="Imported capabilities"><header><div><span>Imported skills & MCP</span><small>A skill attaches to the next turn; imported MCP servers are handed to the harness with every turn.</small></div><button type="button" disabled={locked || pending} onClick={close} aria-label="Back to add menu">← Back</button></header>{skill && <div className="capability-attached"><span>Skill attached · {skill.source}/{skill.name}</span><button type="button" disabled={locked || pending} onClick={clearSkill}>Clear</button></div>}<div className="capability-section"><label>Filter skills<input value={skillQuery} disabled={locked || pending} onChange={(event) => setSkillQuery(event.target.value)} placeholder="review, research…" /></label>{!shownSkills.length && <p className="project-empty">{skills.length ? "Nothing matches that." : "No skills imported yet."}</p>}{shownSkills.map((item) => <button type="button" className="capability-row" disabled={locked || pending} key={item.id} onClick={() => attach(item)}><strong>{item.name}</strong><small>{item.source} · attach to this thread</small></button>)}<small>Instructions remain main-side and apply only to the next turn.</small></div><div className="capability-section"><div className="capability-label"><span>MCP servers</span></div>{!servers.length && <p className="project-empty">No MCP servers imported yet.</p>}{servers.map((item) => <div className="capability-row" key={item.id}><strong>{item.name}</strong><small>{item.source} · {item.command} · env: {item.environmentKeys.join(", ") || "none"}</small></div>)}<small>The harness starts these itself and searches their tools when a turn needs one. Switch one off in Settings → Tools.</small></div>{error && <p className="capability-error" role="alert">{error}</p>}</section>;
}

const onTagsChanged = (fire: () => void) => {
  addEventListener("shinbo-thread-tags-changed", fire);
  return () => removeEventListener("shinbo-thread-tags-changed", fire);
};

function TagPicker({ threadId }: { threadId: string }) {
  const filed = useSyncExternalStore(onTagsChanged, () => threadTags()[threadId]?.tag ?? "");
  const guessed = useSyncExternalStore(onTagsChanged, () => threadTags()[threadId]?.auto === true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [open]);
  const typed = tagName(query);
  const matches = handTags().filter((tag) => !typed || tag.includes(typed));
  const coin = typed && !matches.includes(typed) ? typed : "";
  const apply = (tag: string) => { setThreadTag(threadId, tag); setOpen(false); setQuery(""); };
  return <div className="tag-picker" ref={box}>
    <button type="button" className="tag-trigger" data-state={!filed ? "none" : guessed ? "auto" : "filed"}
      aria-haspopup="listbox" aria-expanded={open}
      title={guessed ? `${filed} · Shinbo’s guess` : filed || "Tag this thread"}
      aria-label={filed ? `Tag: ${filed}${guessed ? ", Shinbo’s guess" : ""}` : "Tag this thread"}
      onClick={() => { setQuery(""); setOpen((was) => !was); }}>{filed || "＋ tag"}</button>
    {open && <section className="source-popover tag-menu" role="listbox" aria-label="Thread tag">
      <input autoFocus value={query} maxLength={32} autoComplete="off" placeholder="Find or name a tag" aria-label="Find or name a tag"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); return; }
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (coin || matches.length === 1) apply(coin || matches[0]);
        }} />
      {coin && <button type="button" role="option" aria-selected={false} className="tag-row" onClick={() => apply(coin)}><strong>{coin}</strong><em>New</em></button>}
      {matches.map((tag) => <button type="button" role="option" aria-selected={tag === filed} key={tag} className="tag-row" onClick={() => apply(tag)}><strong>{tag}</strong>{tag === filed && <em>Filed</em>}</button>)}
      {!matches.length && !coin && <p className="slash-empty">No tags yet — type one and press Enter.</p>}
      {filed && <button type="button" className="tag-row clear" onClick={() => apply("")}>Clear tag</button>}
    </section>}
  </div>;
}

function DropVeil({ onFiles, locked }: { onFiles: (files: File[], folders: number) => void; locked: boolean }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const latest = useRef({ onFiles, locked });
  useEffect(() => { latest.current = { onFiles, locked }; });
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const enter = (event: DragEvent) => { if (carriesFiles(event)) { depth.current += 1; setOver(!latest.current.locked); } };
    const leave = () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); };
    const move = (event: DragEvent) => { if (!carriesFiles(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; };
    const drop = (event: DragEvent) => {
      depth.current = 0;
      setOver(false);
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      const files: File[] = [];
      let folders = 0;
      for (const item of event.dataTransfer.items) {
        if (item.kind !== "file") continue;
        if (item.webkitGetAsEntry()?.isDirectory) { folders += 1; continue; }
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (!files.length && !folders) files.push(...event.dataTransfer.files);
      latest.current.onFiles(files, folders);
    };
    addEventListener("dragenter", enter);
    addEventListener("dragleave", leave);
    addEventListener("dragover", move);
    addEventListener("drop", drop);
    return () => { removeEventListener("dragenter", enter); removeEventListener("dragleave", leave); removeEventListener("dragover", move); removeEventListener("drop", drop); };
  }, []);
  return over ? <div className="drop-veil" aria-hidden="true"><span><ClipIcon /> Drop to attach</span></div> : null;
}

const QUOTE_MENU_EDGE = 96;

function SelectionQuote({ scroller, onQuote, onThread }: { scroller: RefObject<HTMLDivElement | null>; onQuote: (text: string) => void; onThread: (text: string) => void }) {
  const [pick, setPick] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const node = scroller.current;
    const read = () => {
      const selection = document.getSelection();
      if (!node || !selection || selection.isCollapsed || !selection.rangeCount) { setPick(null); return; }
      const range = selection.getRangeAt(0);
      const text = selection.toString().trim();
      if (!text || !node.contains(range.commonAncestorContainer)) { setPick(null); return; }
      const rect = range.getBoundingClientRect();
      const x = Math.min(Math.max(rect.left + rect.width / 2, QUOTE_MENU_EDGE), innerWidth - QUOTE_MENU_EDGE);
      const y = Math.max(rect.top, 52);
      setPick((current) => current && current.text === text && current.x === x && current.y === y ? current : { text, x, y });
    };
    let frame = 0;
    const scrolled = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(read); };
    addEventListener("pointerup", read);
    addEventListener("keyup", read);
    node?.addEventListener("scroll", scrolled);
    return () => { cancelAnimationFrame(frame); removeEventListener("pointerup", read); removeEventListener("keyup", read); node?.removeEventListener("scroll", scrolled); };
  }, [scroller]);

  if (!pick) return null;
  const take = (act: (text: string) => void) => {
    act(pick.text.split("\n").map((line) => `> ${line}`).join("\n"));
    document.getSelection()?.removeAllRanges();
    setPick(null);
  };
  const copy = () => {
    void navigator.clipboard.writeText(pick.text).catch(() => undefined);
    document.getSelection()?.removeAllRanges();
    setPick(null);
  };
  return <div className="quote-menu" style={{ left: pick.x, top: pick.y }} role="toolbar" aria-label="Selected text" onMouseDown={(event) => event.preventDefault()}>
    <button type="button" onClick={copy}>Copy</button>
    <span className="quote-menu-separator" role="separator" aria-orientation="vertical" />
    <button type="button" onClick={() => take(onQuote)}>Add to chat</button>
    <span className="quote-menu-separator" role="separator" aria-orientation="vertical" />
    <button type="button" onClick={() => take(onThread)}>New thread</button>
  </div>;
}

const THREAD_NAME_MAX = 120;
const threadName = (thread: Thread) => threadLabel(thread, THREAD_NAME_MAX);

const COMPOSER_MAX = 65_536;

const DRAFT_SAVE_MS = 250;

function ThreadView({ thread, loadedSubthread, loadThread, threadLoadError, clearThreadLoadError, snapshot, notes, busy, act, reload, agents, tab, setTab, newThread, onSendingChange, onModelChanged, onContextChanged, onManageModels, onManageImports, modelKey, modelLabel, modelBrand, thinkingLevel, reviewOffered, contextTokens, contextPages, onContextPages, layout, pane, showBrowser, reviewPane, showReview, filesPane, showFiles, clearFileAsk, artifactPaneId, setArtifactPaneId, editArtifact }: { thread: Thread & { context: ThreadContext }; loadedSubthread?: Thread; loadThread: (id: string) => Promise<void>; threadLoadError?: { id: string; text: string }; clearThreadLoadError: () => void; snapshot: Snapshot; notes: KeptNote[]; busy: boolean; act: (method: string, params?: Record<string, string>) => Promise<unknown>; reload: () => unknown; agents: LiveAgent[]; tab: string; setTab: (tab: string) => void; newThread: (seed?: string) => void; onSendingChange: (busy: boolean) => void; onModelChanged: (settings: UserSettings) => void; onContextChanged: (context: ThreadContext) => void; onManageModels: () => void; onManageImports: () => void; modelKey: string; modelLabel: string; modelBrand?: BrandDefinition; thinkingLevel: ThinkingLevel; reviewOffered: boolean; contextTokens: number; contextPages: ContextPage[]; onContextPages: (pages: ContextPage[]) => void } & PaneProps) {
  const [message, setMessage] = useState(() => takeComposerSeed(thread.id) || threadDraft(thread.id).text);
  useEffect(() => { if (composerSeed.threadId === thread.id) composerSeed = { threadId: "", text: "" }; }, [thread.id]);
  const context = thread.context;
  const [contextBusy, setContextBusy] = useState(false);
  const { mode, review, folderIds } = context;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [capabilityBusy, setCapabilityBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "pick" | "error"; funds?: boolean; id: number } | null>(null);
  const toast = (text: string, tone: "pick" | "error", funds = false) => setNotice((current) => text ? { text, tone, funds, id: (current?.id ?? 0) + 1 } : null);
  const setRunError = (text: string) => toast(text, "error");
  const switchToFreeModels = async () => {
    try {
      await changeThreadModel({ ...readSettings(), selectedModel: routerKey(FREE_ROUTER_ID), thinkingLevel: "" });
      setNotice(null);
    } catch (reason) { setRunError(reasonText(reason)); }
  };
  const [confirmStop, setConfirmStop] = useState(false);
  const [stallSwap, setStallSwap] = useState(false);
  const [skill, setSkill] = useState<ImportedSkill | null>(null);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [messageSkills, setMessageSkills] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactMeta[]>([]);
  const [folders, setFolders] = useState<FolderGrant[]>([]);
  const threadId = thread?.id;
  const [folderFiles, setFolderFiles] = useState<Record<string, FolderFile[]>>({});
  const [folderTotals, setFolderTotals] = useState<Record<string, { total: number; capped: boolean }>>({});
  const [contextQuery, setContextQuery] = useState("");
  const [picks, setPicks] = useState<ContextPick[]>(() => threadDraft(threadId ?? "").picks);
  const [draftSaved, setDraftSaved] = useState(true);
  const draft = useRef({ text: message, picks });
  useEffect(() => { draft.current = { text: message, picks }; }, [message, picks]);
  useEffect(() => {
    const timer = setTimeout(() => setDraftSaved(setThreadDraft(threadId ?? "", draft.current)), DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [threadId, message, picks]);
  useEffect(() => {
    const flush = () => { setThreadDraft(threadId ?? "", draft.current); };
    addEventListener("pagehide", flush);
    return () => { removeEventListener("pagehide", flush); flush(); };
  }, [threadId]);
  const [, ledgerChanged] = useState(0);
  const [caret, setCaret] = useState(0);
  const [slashPick, setSlashPick] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [history, setHistory] = useState(-1);
  const historyDraft = useRef("");
  const addPick = (pick: ContextPick) => setPicks((current) => current.some((item) => pickKey(item) === pickKey(pick)) ? current.map((item) => pickKey(item) === pickKey(pick) ? pick : item) : [...current, pick]);
  useEffect(() => {
    const take = (event: Event) => {
      const pick = (event as CustomEvent<ContextPick>).detail;
      addPick(pick);
      toast(`Added to the composer · ${pickKindLabel(pick)} · ${pickBrief(pick)}`, "pick");
    };
    const failed = (event: Event) => {
      const detail = (event as CustomEvent<RunFailure>).detail;
      if (detail.threadId !== (threadId ?? "")) return;
      toast(detail.text, "error", usageLimitedFailure(detail.text));
      if (!draft.current.text) setMessage(threadDraft(threadId ?? "").text);
    };
    addEventListener(PICK_CONTEXT_EVENT, take);
    addEventListener(RUN_ERROR_EVENT, failed);
    return () => {
      removeEventListener(PICK_CONTEXT_EVENT, take);
      removeEventListener(RUN_ERROR_EVENT, failed);
    };
  }, [threadId]);
  const run = useRun(threadId ?? "");
  useEffect(() => {
    if (!notice) return;
    if (notice.funds) return;
    const timer = setTimeout(() => setNotice(null), notice.tone === "error" ? 8000 : 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  const installedSkillCount = run.blocks.filter((block) => block.kind === "step" && block.step.title === "Installing skill" && block.step.status === "completed").length;
  const sending = run.sending;
  const queued = queuedTurns(run);
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const { ref: transcript, onScroll: transcriptScroll, atEnd, toEnd } = useTailScroll<HTMLDivElement>(
    [thread?.id, thread?.messages.length, run.blocks],
    thread?.id,
  );
  useEffect(() => { if (tab === "thread" && !thread?.messages.length) input.current?.focus(); }, [tab, thread?.messages.length]);
  const addContext = useCallback((text: string) => {
    setMessage((current) => `${current}${current.trim() ? "\n\n" : ""}${text}\n\n`);
    input.current?.focus();
  }, []);
  const runFences = useMemo(() => ({ folderId: folderIds[0], addContext }), [addContext, folderIds]);
  const sourceTrigger = useRef<HTMLButtonElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const modelMenu = useRef<HTMLElement>(null);
  const sourceMenu = useRef<HTMLElement | null>(null);
  const closeSources = useCallback(() => { setSourcesOpen(false); setCapabilitiesOpen(false); queueMicrotask(() => sourceTrigger.current?.focus()); }, []);
  useEffect(() => {
    if (!sourcesOpen || busy || capabilityBusy) return;
    const outside = (event: PointerEvent) => { const node = event.target as Node; if (!sourceMenu.current?.contains(node) && !sourceTrigger.current?.contains(node)) closeSources(); };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [busy, capabilityBusy, closeSources, sourcesOpen]);
  const closeModels = useCallback(() => { setModelsOpen(false); setStallSwap(false); queueMicrotask(() => modelTrigger.current?.focus()); }, []);
  useEffect(() => {
    if (!modelsOpen) return;
    const outside = (event: PointerEvent) => { const node = event.target as Node; if (!modelMenu.current?.contains(node) && !modelTrigger.current?.contains(node)) closeModels(); };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [closeModels, modelsOpen]);
  useEffect(() => {
    let active = true;
    void window.shinbo.importedSkillStatus().then((status) => { if (active) setSkill(status?.threadId === thread?.id ? status : null); }).catch(() => { if (active) setSkill(null); });
    return () => { active = false; };
  }, [thread?.id]);
  useEffect(() => {
    let active = true;
    const load = () => {
      const skills = window.shinbo.searchImportedSkills({ query: "", limit: 64 }).catch(() => [] as ImportedSkill[]);
      const servers = window.shinbo.listImportedMcpServers().catch(() => [] as ImportedMcpServer[]);
      void Promise.all([skills, servers]).then(([imported, mcp]) => {
        if (!active) return;
        setMessageSkills(imported.map((item) => item.name));
        setCommands([
          ...BUILTIN_COMMANDS,
          ...imported.map((item) => ({ id: item.id, name: item.name, kind: "skill" as const, detail: `${item.source} · skill` })),
          ...mcp.map((item) => ({ id: item.id, name: item.name, kind: "mcp" as const, detail: `${item.source} · MCP server` })),
          ...toolCommands(readSettings().tools.disabledTools),
        ]);
      });
    };
    load();
    const stop = window.shinbo.onToolsChanged(load);
    return () => { active = false; stop(); };
  }, [installedSkillCount]);
  useEffect(() => {
    let active = true;
    const load = () => void window.shinbo.listArtifacts().then((list) => { if (active) setArtifacts(list); }).catch(() => undefined);
    load();
    const stop = window.shinbo.onArtifactsChanged(load);
    return () => { active = false; stop(); };
  }, []);
  const granted = useRef<{ folderIds: string[]; setFolderIds: (ids: string[]) => void }>({ folderIds, setFolderIds: () => undefined });
  useEffect(() => {
    let active = true;
    const load = () => void window.shinbo.listFolders().then((list) => {
      if (!active) return;
      setFolders(list);
      const kept = granted.current.folderIds.filter((id) => list.some((folder) => folder.id === id));
      if (kept.length !== granted.current.folderIds.length) granted.current.setFolderIds(kept);
    }).catch(() => { if (active) setFolders([]); });
    load();
    const stop = window.shinbo.onFoldersChanged(load);
    return () => { active = false; stop(); };
  }, []);
  useEffect(() => {
    if (!threadId) return;
    setThreadFolders(threadId, folderIds);
    setThreadMode(threadId, mode);
    setThreadReview(threadId, review);
  }, [folderIds, mode, review, threadId]);
  useEffect(() => {
    let active = true;
    for (const id of folderIds) {
      void window.shinbo.listFolderFiles(id).then((listing) => {
        if (!active) return;
        setFolderFiles((current) => ({ ...current, [id]: listing.files }));
        setFolderTotals((current) => ({ ...current, [id]: { total: listing.total, capped: listing.capped } }));
      }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [folderIds, sending]);
  const subagents = useMemo(() => subagentRows(snapshot.threads, agents, threadId ?? ""), [agents, snapshot.threads, threadId]);
  const spawned = useMemo(
    () => spawnedByTurn(thread?.messages ?? [], spawnedAgents(snapshot.threads, agents, threadId ?? "")),
    [agents, snapshot.threads, thread.messages, threadId],
  );
  const subthreads = useMemo(
    () => snapshot.threads.filter((item) => item.parentThreadId === threadId && !item.archivedAt && item.kind !== "subagent"),
    [snapshot.threads, threadId],
  );
  const subagentSummary = useMemo(
    () => snapshot.threads.find((item) => item.id === tab && item.kind === "subagent"),
    [snapshot.threads, tab],
  );
  const activeSubagent = agents.some((agent) => agent.threadId === tab) ? tab : "";
  const subagentId = subagentSummary?.id ?? activeSubagent;
  const subagentRevision = `${subagentSummary?.updatedAt ?? ""}:${subagentSummary ? threadMessageCount(subagentSummary) : 0}`;
  useEffect(() => {
    if (!subagentId) return;
    void loadThread(subagentId);
  }, [loadThread, subagentId, subagentRevision]);
  const inspected = useMemo(
    () => subagentId ? loadedSubthread?.id === subagentId ? loadedSubthread : undefined : thread,
    [loadedSubthread, subagentId, thread],
  );
  const inspectedId = inspected?.id ?? subagentId;
  const inFlight = useMemo(
    () => agents
      .filter((agent) => agent.threadId === inspectedId || agent.parentThreadId === inspectedId)
      .filter((agent) => agent.status === "running" || agent.status === "waiting"),
    [agents, inspectedId],
  );
  const cliRuns = useCliRuns();
  const terminalTabs = useTerminals(thread?.id ?? "");
  const [popped, setPopped] = useState<string[]>([]);
  const [raw, setRaw] = useState<string[]>([]);
  const [floated, setFloated] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [browserFloat, setBrowserFloat] = useState(false);
  useEffect(() => {
    if (tab === "thread" || tab === "goal") return;
    if (!subagents.some((agent) => agent.threadId === tab) && !cliRuns.some((run) => run.id === tab)
      && !snapshot.threads.some((item) => item.id === tab && item.kind === "subagent")) setTab("thread");
  }, [subagents, cliRuns, snapshot.threads, tab, setTab]);
  useEffect(() => {
    const open = (event: Event) => setTab((event as CustomEvent<string>).detail);
    addEventListener(OPEN_SUBAGENT_EVENT, open);
    return () => removeEventListener(OPEN_SUBAGENT_EVENT, open);
  }, [setTab]);
  const [contextPage, setContextPage] = useState(readContextPage);
  const page = contextPages.find((item) => item.id === contextPage) ?? contextPages[0];
  useEffect(() => { writeContextPage(page.id); }, [page.id]);
  const uses = threadUses(inspectedId);
  const cleared = Math.min(clearedAt(threadId ?? ""), thread?.messages.length ?? 0);
  const switches = modelSwitches(threadId ?? "");
  const switchesAt = useMemo(() => {
    const marks = new Map<number, ModelSwitch[]>();
    for (const mark of switches) marks.set(mark.at, [...(marks.get(mark.at) ?? []), mark]);
    return marks;
  }, [switches]);
  const cut = inspectedId === threadId ? cleared : 0;
  const carried = useMemo(() => inspected && cut ? { ...inspected, messages: inspected.messages.slice(cut) } : inspected, [inspected, cut]);
  const landedCalls = useThreadCalls(inspectedId, sending);
  const ledger = useContextLedger(carried, uses, contextTokens, inFlight, threadExperiments(inspectedId), landedCalls, threadBreakdown(inspectedId));
  const gitState = useGit(folderIds[0], sending, !layout.inspectorCollapsed && page.widgets.some((widget) => widget.type === "git"));
  const git = gitState.snapshot;
  const [changes, setChanges] = useState<FileChange[]>([]);
  const changeStat = useMemo(() => diffStat(changes), [changes]);
  const reloadChanges = useCallback(() => {
    if (!threadId) return;
    void window.shinbo.threadChanges(threadId).then(setChanges).catch(() => setChanges([]));
  }, [threadId]);
  useEffect(() => {
    reloadChanges();
    const listener = window.shinbo.onChanged(reloadChanges);
    return () => window.shinbo.offChanged(listener);
  }, [reloadChanges]);
  const editTargets = useMemo(() => ({ changes: changes.map((change) => ({ folderId: change.folderId, path: change.path })), folderId: folderIds[0] ?? "" }), [changes, folderIds]);
  const [folderPaths, setFolderPaths] = useState<Record<string, Set<string>>>({});
  useEffect(() => {
    let live = true;
    const settle = (id: string, paths: string[]) => { if (live) setFolderPaths((current) => ({ ...current, [id]: new Set(paths) })); };
    for (const id of folderIds) {
      if (folderPaths[id]) continue;
      void window.shinbo.listFolderPaths(id).then((found) => settle(id, found.paths)).catch(() => settle(id, []));
    }
    return () => { live = false; };
  }, [folderIds, folderPaths]);
  const pathOpener = useMemo(() => ({
    known: (path: string) => folderIds.some((id) => folderPaths[id]?.has(path)),
    open: (path: string, line?: number) => {
      const folderId = folderIds.find((id) => folderPaths[id]?.has(path));
      if (folderId) openFilePane({ folderId, path, ...(line ? { line } : {}) });
    },
  }), [folderIds, folderPaths]);
  useEffect(() => {
    const open = () => showReview("changes");
    addEventListener(OPEN_CHANGES_EVENT, open);
    return () => removeEventListener(OPEN_CHANGES_EVENT, open);
  }, [showReview]);
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id === threadId) setTab("goal");
      else openThreadPage(id);
    };
    addEventListener(OPEN_GOAL_EVENT, open);
    return () => removeEventListener(OPEN_GOAL_EVENT, open);
  }, [threadId, setTab]);
  const cached = useMemo(() => { void run.landed; return cachedBlocks(thread.id); }, [thread.id, run.landed]);
  const [traced, setTraced] = useState<{ threadId: string; traces: { timestamp: string; text: string }[] }>({ threadId: "", traces: [] });
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    void window.shinbo.threadTraces(threadId)
      .then((traces) => { if (alive) setTraced({ threadId, traces }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [threadId, thread?.messages.length]);
  const recorded = useMemo(
    () => tracedBlocks(traced.threadId, traced.threadId === threadId ? thread?.messages ?? [] : [], traced.traces),
    [threadId, thread.messages, traced],
  );
  const from = pairingFrom(thread.id);
  useEffect(() => {
    if (!thread) return;
    const paired = pairBlocks(thread.messages, run.landed, {}, from);
    const turns = Object.fromEntries(thread.messages.flatMap((item, index) =>
      paired[index] && wrote(item.content, paired[index]!) ? [[item.timestamp, paired[index]!]] : []));
    rememberBlocks(thread.id, turns);
    settleRun(thread.id, thread.messages, cachedBlocks(thread.id), from);
  }, [thread, run.landed, from]);
  const attachedTurns = useMemo(() => thread ? turnAttachments(thread.id, thread.messages) : {}, [thread]);
  const ask = usePermissionAsk(threadId ?? "", agents);
  const locked = busy || capabilityBusy || contextBusy;
  const changeContext = async (patch: Partial<Pick<typeof context, "folderIds" | "mode" | "review">>) => {
    if (contextBusy) return;
    setContextBusy(true);
    const next = { ...context, ...patch };
    try {
      await window.shinbo.setThreadContext({ threadId: thread.id, folderIds: next.folderIds, mode: next.mode, review: next.review });
      onContextChanged(next);
    } catch (reason) { setRunError(reasonText(reason)); }
    finally { setContextBusy(false); }
  };
  const setMode = (mode: PermissionMode) => { void changeContext({ mode }); };
  const setFolderIds = (folderIds: string[]) => { void changeContext({ folderIds }); };
  useEffect(() => { granted.current = { folderIds, setFolderIds }; });
  const setReview = (review: boolean) => { void changeContext({ review }); };
  const echo = run.pending && !thread.messages.slice(run.pending.after).some((message) => message.role === "user" && message.content === run.pending?.content) ? run.pending.content : null;
  const echoTray = echo !== null ? run.pending?.attachments ?? [] : [];
  const unlanded = !sending && run.blocks.length > 0 && !arrived(thread.messages, run.blocks);
  const streaming = (sending || unlanded) && run.blocks.length ? run.blocks : null;
  const landedBlocks = useMemo(() => pairBlocks(thread.messages, unlanded ? run.landed.slice(0, -1) : run.landed, { ...recorded, ...cached }, from), [thread.messages, unlanded, run.landed, recorded, cached, from]);
  const setCapabilityRunning = (value: boolean) => { setCapabilityBusy(value); onSendingChange(value); };
  const localContext = useMemo(() => contextCommands(folders, folderIds, folderFiles), [folders, folderIds, folderFiles]);
  const cappedFolder = folderIds.map((id) => ({ folder: folders.find((item) => item.id === id), listed: folderFiles[id]?.length ?? 0, total: folderTotals[id]?.total ?? 0, capped: folderTotals[id]?.capped ?? false })).find((count) => count.total > count.listed);
  const allCommands = commands;
  const [searchedSkills, setSearchedSkills] = useState<{ query: string; items: SlashCommand[] }>({ query: "", items: [] });
  const imported = commands.filter((item) => item.kind === "skill" || item.kind === "mcp");
  const atItems = useMemo(() => atCommands(artifacts, notes, folders, folderIds, folderFiles), [artifacts, notes, folders, folderIds, folderFiles]);
  const composerSegments = useMemo(() => highlightSegments(message, allCommands.map((item) => item.name), atItems.map((item) => item.name)), [message, allCommands, atItems]);
  const noteUses = (added: Omit<ContextUse, "turns">[]) => { recordUses(thread.id, added); ledgerChanged((current) => current + 1); };
  const dropPick = (pick: ContextPick) => setPicks((current) => current.filter((item) => pickKey(item) !== pickKey(pick)));
  const holdAttachments = ({ picked, failed = [] }: { picked: HeldAttachment[]; failed?: string[] }) => {
    let room = MAX_TURN_IMAGES - picks.filter((pick) => pick.kind === "attachment" && isImageAttachment(pick.name)).length;
    let refused = 0;
    for (const item of picked) {
      if (isImageAttachment(item.name)) {
        if (room < 1) { refused += 1; continue; }
        room -= 1;
      }
      addPick({ kind: "attachment", id: item.id, name: item.name, path: item.path, ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}) });
    }
    const notes = [...failed, ...(refused ? [`A message carries at most ${MAX_TURN_IMAGES} images — ${refused} ${plural(refused, "was", "were")} left out. Send these, then attach the rest.`] : [])];
    if (notes.length) setRunError(notes.join("\n"));
  };
  const attachDropped = (dropped: Iterable<File> | null | undefined, folders = 0) => {
    const files = [...(dropped ?? [])];
    if (!files.length && !folders) return;
    if (locked) { setRunError("Wait for this turn to finish before attaching files."); return; }
    setRunError(folders ? `${plural(folders, "A folder", "Folders")} cannot be attached — drop the files inside instead.` : "");
    void Promise.allSettled(files.map(async (file) => {
      if (file.size > attachmentLimit(file.name)) throw new Error(oversizeMessage(file.name, file.size));
      return window.shinbo.attachData({ name: file.name, data: await file.arrayBuffer() });
    })).then((results) => holdAttachments({
      picked: results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
      failed: results.flatMap((result) => result.status === "rejected" ? [reasonText(result.reason)] : []),
    }));
  };
  const slash = locked || slashDismissed ? null : slashQuery(message, caret);
  const slashOpen = slash !== null;
  const skillSearch = slash?.sigil === "/" && slash.query && !matchCommands(commands, slash.query).length ? slash.query : "";
  useEffect(() => {
    if (!skillSearch) return;
    let active = true;
    const timer = setTimeout(() => {
      void window.shinbo.searchImportedSkills({ query: skillSearch, limit: 32 }).then((found) => {
        if (active) setSearchedSkills({ query: skillSearch, items: found.map((item) => ({ id: item.id, name: item.name, kind: "skill" as const, detail: `${item.source} · skill` })) });
      }).catch(() => undefined);
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [skillSearch]);
  const slashMatches = slash ? matchCommands(slash.sigil === "@" ? atItems : skillSearch && searchedSkills.query === skillSearch ? searchedSkills.items : allCommands, slash.query).slice(0, MENU_MAX) : [];
  const slashActive = Math.min(slashPick, slashMatches.length - 1);
  const typing = (element: HTMLTextAreaElement) => { setMessage(element.value); setCaret(element.selectionStart ?? element.value.length); setSlashDismissed(false); setSlashPick(0); setHistory(-1); };
  const past = useMemo(() => thread.messages.filter((item) => item.role === "user").map((item) => sentByThread(item.content).body).reverse(), [thread.messages]);
  const openCapabilities = () => { setModelsOpen(false); setSourcesOpen(true); setCapabilitiesOpen(true); };
  const [councilOpen, setCouncilOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const seated = (state: CouncilState | null) => { if (live && state && (councilRunning(state.phase) || state.phase === "waiting")) setCouncilOpen(true); };
    void window.shinbo.councilState(thread.id).then(seated).catch(() => undefined);
    const stop = window.shinbo.onCouncil((next) => { if (next.threadId === thread.id) seated(next); });
    return () => { live = false; stop(); };
  }, [thread.id]);
  const pickCommand = (command: SlashCommand) => {
    if (!slash) return;
    const next = command.kind === "builtin" ? { text: `${message.slice(0, slash.start)}${message.slice(slash.start + slash.query.length + 1)}`, caret: slash.start } : insertCommand(message, slash, command.name);
    setMessage(next.text);
    setSlashPick(0);
    queueMicrotask(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); setCaret(next.caret); });
    if (command.pick) addPick(command.pick);
    else if (command.kind === "tool" || command.kind === "mcp") return;
    else if (command.kind === "skill") void window.shinbo.selectImportedSkill({ id: command.id, threadId: thread.id }).then(setSkill).catch((reason: unknown) => setRunError(reasonText(reason)));
    else if (command.id === "agent") setAgentOpen(true);
    else if (command.id === "council") setCouncilOpen(true);
    else if (command.id === "import") onManageImports();
    else if (command.id === "new") newThread();
    else if (command.id === "clear") {
      void window.shinbo.clearThreadContext(thread.id).then(() => {
        markCleared(thread.id, thread.messages.length);
        ledgerChanged((current) => current + 1);
      }).catch((reason: unknown) => setRunError(reasonText(reason)));
    }
    else openCapabilities();
  };
  const composerKeys = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (slashOpen && slashMatches.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSlashPick((current) => (Math.min(current, slashMatches.length - 1) + (event.key === "ArrowDown" ? 1 : slashMatches.length - 1)) % slashMatches.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pickCommand(slashMatches[slashActive]); return; }
    }
    if (slashOpen && event.key === "Escape") { event.preventDefault(); setSlashDismissed(true); return; }
    if (event.key === "Escape" && sending) { event.preventDefault(); if (confirmStop) interrupt(); else setConfirmStop(true); return; }
    if (confirmStop) setConfirmStop(false);
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey) {
      const element = event.currentTarget;
      const edge = event.key === "ArrowUp" ? 0 : element.value.length;
      if (element.selectionStart === edge && element.selectionEnd === edge) {
        const next = event.key === "ArrowUp" ? Math.min(history + 1, past.length - 1) : history - 1;
        if (!past.length || next < -1 || next === history) return;
        event.preventDefault();
        if (history < 0) historyDraft.current = message;
        setHistory(next);
        const text = next < 0 ? historyDraft.current : past[next];
        setMessage(text);
        queueMicrotask(() => { input.current?.setSelectionRange(text.length, text.length); setCaret(text.length); });
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && sending && (message.trim() || queued.length)) {
      event.preventDefault();
      const steered = message.trim();
      if (!steered) { steerNow(queued.findIndex((turn) => canSteer(turn))); return; }
      setMessage("");
      setHistory(-1);
      setRunError("");
      void steerRunning(thread.id, steered).catch((reason: unknown) => { setMessage(steered); setRunError(reasonText(reason)); });
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  };
  const send = (event?: FormEvent, text?: string) => {
    event?.preventDefault();
    if (locked) return;
    const content = (text ?? message).trim();
    if (!content) return;
    setRunError("");
    if (text === undefined) { setMessage(""); setHistory(-1); }
    const attachedSkill = skill;
    setSkill(null);
    setPicks([]);
    const after = thread.messages.length;
    const attachments = picks.map((pick) => ({
      kind: pick.kind,
      name: pickBrief(pick),
      ...(pick.kind === "attachment" ? { path: pick.path, ...(pick.thumbnail ? { thumbnail: pick.thumbnail } : {}) } : {}),
    }));
    rememberTurnAttachments(thread.id, after, content, attachments);
    sendTurn(thread.id, {
      content,
      after,
      params: {},
      attached: picks.length > 0 || !!attachedSkill,
      attachments,
      prepare: folderIds.length || picks.length || attachedSkill ? async () => {
        const attached = folderIds.length || picks.length ? await buildAttachedContext(folders, folderIds, picks, folderFiles) : { text: "", uses: [], images: [] };
        return {
          params: { ...(attached.text ? { attachedContext: attached.text } : {}), ...(attached.images.length ? { attachedImages: JSON.stringify(attached.images) } : {}), ...(attachedSkill ? { skillAttachmentId: attachedSkill.id } : {}) },
          delivered: () => noteUses([...attached.uses, ...(attachedSkill ? [{ kind: "skills" as const, label: `${attachedSkill.source}/${attachedSkill.name}`, chars: attachedSkill.chars ?? 0 }] : [])]),
        };
      } : undefined,
    }, reload);
  };
  const changeThreadModel = async (next: UserSettings) => {
    await window.shinbo.request("setThreadModel", { threadId: thread.id, modelId: next.selectedModel, effort: next.thinkingLevel });
    onModelChanged(next);
  };
  const swapStalledModel = async (next: UserSettings) => {
    const mark = { at: thread.messages.length, label: modelKeyLabel(next, next.selectedModel), brand: modelKeyBrand(next, next.selectedModel)?.id ?? "", after: run.activeAt ? clock(Date.now() - run.activeAt) : "" };
    const turn = turnToRetry(thread.id);
    const content = turn?.content ?? "";
    closeModels();
    if (!content.trim()) {
      recordModelSwitch(thread.id, mark);
      stopTurn(thread.id, undefined, reload);
      return;
    }
    const params = Object.fromEntries(Object.entries(turn?.params ?? {}).filter(([key]) => key !== "skillAttachmentId"));
    stopTurn(thread.id, { content, after: mark.at, params, attached: turn?.attached, attachments: turn?.attachments, prepare: async () => { recordModelSwitch(thread.id, mark); return { params }; } }, reload);
  };
  const interrupt = () => {
    setConfirmStop(false);
    setRunError("");
    stopTurn(thread.id, undefined, reload);
    if (message.trim()) void send();
  };
  const steerNow = (index: number) => {
    const turn = queued[index];
    if (!turn || !canSteer(turn) || !turn.content.trim()) return;
    setRunError("");
    steerQueued(thread.id, index);
  };
  const openAgent = agents.find((agent) => agent.threadId === tab && agent.parentThreadId === threadId);
  const agentThread = openAgent && loadedSubthread?.id === openAgent.threadId ? loadedSubthread : undefined;
  const pastAgent = !openAgent && loadedSubthread?.id === tab ? loadedSubthread : undefined;
  const subagentLoading = !!subagentId && loadedSubthread?.id !== subagentId;
  const subagentError = threadLoadError?.id === subagentId ? threadLoadError.text : "";
  const threadClis = cliRuns.filter((run) => run.threadId === thread.id && (run.status === "running" || !dismissed.includes(run.id)));
  const openCli = threadClis.find((run) => run.id === tab);
  const openCliRun = (id: string) => { setFloated((current) => current.filter((runId) => runId !== id)); setTab(id); };
  const parentThread = thread.parentThreadId ? snapshot.threads.find((item) => item.id === thread.parentThreadId) : undefined;
  const threadTabs = new Set([...(parentThread ? [parentThread.id] : []), ...subthreads.map((item) => item.id)]);
  const tabs: AgentTab[] = [
    ...(parentThread ? [{ id: parentThread.id, label: threadLabel(parentThread), closable: false }] : []),
    { id: "thread", label: threadLabel(thread), closable: false },
    ...subthreads.map((item) => ({ id: item.id, label: threadLabel(item), color: agents.find((agent) => agent.threadId === item.id)?.color, closable: false })),
    ...threadClis.map((run) => ({
      id: run.id,
      label: `${cliHarness(run.cli)?.label ?? run.cli} ${run.id}`,
      icon: <BrandIcon brand={brandForImporter(run.cli)} className={`cli-mark ${run.cli}`} />,
      closable: run.status !== "running",
    })),
    ...(thread.goal ? [{ id: "goal", label: `Goal · ${GOAL_LABELS[thread.goal.status]}`, closable: false }] : []),
  ];
  const toTerminal = (cli: string) => {
    pane({ terminalOpen: true });
    void window.shinbo.openTerminal({ threadId: thread.id, columns: 80, rows: 24, cli }).catch((reason: unknown) => setRunError(reasonText(reason)));
  };
  const pips: PipWindow[] = [
    ...(layout.browserOpen && browserFloat ? [browserPip(
      thread.id,
      () => { setBrowserFloat(false); showBrowser(false); void window.shinbo.browserNav({ threadId: thread.id, action: "close" }).catch(() => undefined); },
      () => setBrowserFloat(false),
    )] : []),
    ...threadClis.filter((run) => floated.includes(run.id)).map((run) => ({
      id: run.id,
      label: cliLabel(run),
      detail: run.title,
      tone: run.status,
      icon: <BrandIcon brand={cliBrand(run)} className={`cli-mark ${run.cli}`} />,
      status: <><CliStatus run={run} />{run.unattended && <span className="cli-unattended" title="Running with this CLI's approvals turned off">unattended</span>}</>,
      menu: [
        raw.includes(run.id)
          ? { label: "Show Markdown", icon: <TextIcon />, onSelect: () => setRaw((current) => current.filter((id) => id !== run.id)) }
          : { label: "Show raw output", icon: <TextIcon />, onSelect: () => setRaw((current) => [...current, run.id]) },
        { label: "Back to its tab", icon: <TabIcon />, onSelect: () => { setFloated((current) => current.filter((id) => id !== run.id)); setTab(run.id); } },
        { label: "Run in terminal", icon: <TerminalIcon />, onSelect: () => toTerminal(run.cli) },
        ...(run.status === "running" ? [{ label: "Stop run", icon: <StopIcon />, onSelect: () => void window.shinbo.stopCliRun(run.id) }] : []),
      ],
      body: <CliStream id={run.id} rich={!raw.includes(run.id)} />,
      footer: <CliComposer run={run} onOpenRun={openCliRun} />,
    })),
    ...terminalTabs.filter((item) => popped.includes(item.id)).map((item) => ({
      id: item.id,
      label: item.title,
      detail: item.cwd,
      tone: item.running ? "running" : "idle",
      icon: item.cli ? <BrandIcon brand={brandForImporter(item.cli)} className={`cli-mark ${item.cli}`} /> : <TerminalIcon />,
      menu: [
        { label: "Back to terminal pane", icon: <DockIcon />, onSelect: () => { setPopped((current) => current.filter((id) => id !== item.id)); pane({ terminalOpen: true }); } },
        { label: "Close shell", icon: <CloseIcon />, onSelect: () => { setPopped((current) => current.filter((id) => id !== item.id)); void window.shinbo.closeTerminal(item.id).catch(() => undefined); } },
      ],
      body: <TerminalSurface tab={item} active
        onSelect={(value) => addPick({ kind: "terminal", id: value.id, text: value.text, lines: value.lines })}
        onLink={({ url }) => { showBrowser(true); void window.shinbo.browserOpen({ threadId: thread.id, url }).catch(() => undefined); }} />,
    })),
  ];
  const panel = subagentLoading ? <AgentTranscriptLoading error={subagentError} busy={locked} retry={() => { clearThreadLoadError(); void loadThread(subagentId); }} />
    : openCli ? <CliPanel run={openCli} busy={locked} onOpenRun={openCliRun} onFloat={() => { setFloated((current) => [...current, openCli.id]); setTab("thread"); }} />
    : tab === "goal" ? <GoalView thread={thread} busy={locked} reload={reload} onOpenThread={openThreadPage} />
    : openAgent ? <AgentPanel agent={openAgent} transcript={<AgentTranscript threadId={openAgent.threadId} thread={agentThread} />} />
    : pastAgent ? <PastAgentPanel thread={pastAgent} />
    : null;
  return <GoalThreads.Provider value={snapshot.threads}><div className="thread-layout">
    <div className="thread-column">
      <TabStrip tabs={tabs} active={tab} onPick={(id) => { if (threadTabs.has(id)) openThreadPage(id); else setTab(id); }} onClose={(id) => { setDismissed((current) => [...current, id]); setFloated((current) => current.filter((runId) => runId !== id)); if (tab === id) setTab("thread"); }} />
      <div className="thread-stage">
      {notice && <div className={`pick-toast ${notice.tone} ${notice.funds ? "funds" : ""}`} role={notice.tone === "error" ? "alert" : "status"} key={notice.id}>
        <span>{notice.funds ? `OpenRouter would not run that turn — out of credit, or over what a free key is allowed. ${notice.text}` : notice.text}</span>
        {notice.funds && <span className="toast-actions">
          <button type="button" onClick={() => void switchToFreeModels()}>Use free models</button>
          <a href={OPENROUTER_CREDITS_URL} target="_blank" rel="noreferrer">Add credit ↗</a>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
        </span>}
      </div>}
      <PipLayer panes={pips} />
      {panel}
      <div className="chat-pane" hidden={!!panel}>
        <Region name="chat" props={{
          thread, messages: thread.messages, busy: locked, sending,
          send: (text: string) => void send(undefined, text), stop: () => stopTurn(thread.id, undefined, reload),
          streaming, mode, setMode,
        }}>
        <section className="conversation" aria-label={`Thread: ${threadLabel(thread)}`}>
      <header className="thread-bar"><input
        className="thread-name"
        key={`${thread.id}:${threadName(thread)}`}
        defaultValue={threadName(thread)}
        aria-label="Thread name"
        maxLength={THREAD_NAME_MAX}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") { if (event.key === "Escape") event.currentTarget.value = threadName(thread); event.currentTarget.blur(); } }}
        onBlur={(event) => {
          const named = event.currentTarget.value.trim();
          if (!named || named === thread.title || named === threadName(thread)) { event.currentTarget.value = threadName(thread); return; }
          void act("renameThread", { threadId: thread.id, title: named }).then(reload);
        }}
      /><button type="button" className="page-info-button" aria-label="Show thread details" aria-haspopup="dialog" onClick={() => setAgentOpen(true)}>i</button><TagPicker threadId={thread.id} /><div className="thread-actions">
        {changes.length > 0 && <button type="button" className="changes-open" aria-label="Open changes pane" aria-pressed={reviewPane === "changes"} onClick={() => showReview(reviewPane === "changes" ? "" : "changes")}><ChangeCount stat={changeStat} /></button>}
        <button type="button" className="pane-toggle" aria-label="Open the files pane" aria-pressed={filesPane.open} title="Files"
          onClick={() => showFiles(!filesPane.open)}><FolderTree size={14} strokeWidth={1.6} aria-hidden="true" /></button>
        {folderIds[0] && <button type="button" className="pane-toggle" aria-pressed={reviewPane === "git"}
          aria-label={git ? `Open the Git pane, on branch ${git.branch}` : "Open the Git pane"} title={git ? `Git · ${git.branch}` : "Git"}
          onClick={() => showReview(reviewPane === "git" ? "" : "git")}><BranchIcon /></button>}
        <PaneSwitch open={layout.terminalOpen}
          running={() => window.shinbo.listTerminals(thread.id).then((tabs) => tabs.some((tab) => tab.running))}
          onOpen={() => pane({ terminalOpen: true })}
          onHide={() => pane({ terminalOpen: false })}
          onClose={() => { pane({ terminalOpen: false }); void closeTerminals(thread.id); }}
          openLabel="Open the terminal" closeLabel="Close the terminal"
          hideNote="Keeps every shell running where it is" closeNote="Ends every shell and frees what it holds"><TerminalIcon /></PaneSwitch>
        <PaneSwitch open={layout.browserOpen}
          running={() => window.shinbo.browserStatus(thread.id).then((status) => status.running)}
          onOpen={() => showBrowser(true)}
          onHide={() => showBrowser(false)}
          onClose={() => { showBrowser(false); void window.shinbo.browserNav({ threadId: thread.id, action: "close" }).catch(() => undefined); }}
          openLabel="Open the browser pane" closeLabel="Close the browser pane"
          hideNote="Keeps the page and its memory" closeNote="Quits Chrome and frees its memory; cookies are shared across threads and stay"><GlobeIcon /></PaneSwitch>
        <IndexStatus paths={folderIds.map((id) => folders.find((item) => item.id === id)?.path ?? "")} />
        <button type="button" className="pane-toggle" aria-label={layout.inspectorCollapsed ? "Expand context bar" : "Collapse context bar"} aria-pressed={!layout.inspectorCollapsed} title={layout.inspectorCollapsed ? "Show the context bar" : "Hide the context bar"} onClick={() => pane({ inspectorCollapsed: !layout.inspectorCollapsed })}><InspectorIcon /></button></div></header>
      <div className="transcript-wrap">
      <TranscriptRail messages={thread.messages} scroller={transcript} />
      <div className="transcript" ref={transcript} onScroll={transcriptScroll}>
        <SkillNames.Provider value={messageSkills}>
        <OpenPaths.Provider value={pathOpener}>
        <EditTargets.Provider value={editTargets}>
        <RunContext.Provider value={runFences}>
        {(!thread.messages.length && echo === null && !sending) || <ProjectRules folder={folders.find((grant) => grant.id === folderIds[0])} />}
        {!thread.messages.length && echo === null && !sending && <Dashboard threads={snapshot.threads} folders={folders} folderId={folderIds[0] ?? ""} seed={(prompt) => { setMessage(prompt); setCaret(prompt.length); queueMicrotask(() => { input.current?.focus(); input.current?.setSelectionRange(prompt.length, prompt.length); }); }} />}
        {thread.messages.map((item, index) => <Fragment key={`${item.timestamp}-${index}`}>{cleared > 0 && index === cleared && <ContextCut />}{switchesAt.get(index)?.map((mark) => <ModelCut key={`model-${mark.at}`} mark={mark} />)}<Turn item={item} blocks={landedBlocks[index]} index={index} attached={attachedTurns[index]} spawned={spawned.turns.get(index)} /></Fragment>)}
        {cleared > 0 && cleared === thread.messages.length && <ContextCut />}
        {switchesAt.get(thread.messages.length)?.map((mark) => <ModelCut key={`model-${mark.at}`} mark={mark} />)}
        {echo !== null && <article className="message user pending"><MessageTray attached={echoTray} /><Body content={echo} /></article>}
        {councilOpen && <CouncilPanel threadId={thread.id} mode={mode} question={message.trim() || lastAsked(thread.messages)}
          seed={councilSeed(loadSettings())}
          picker={(model, onPick, label) => <TaskModelPicker model={model} onChange={(key) => onPick(key)} busy={locked} label={label} inherit="Pick a model" codex={false} />}
          name={(key) => key ? modelKeyLabel(loadSettings(), key) : "Empty seat"}
          brand={(key) => key ? modelKeyBrand(loadSettings(), key) : undefined}
          onClose={() => setCouncilOpen(false)} />}
        {streaming !== null && <Streaming blocks={streaming} threadId={thread.id} spawned={spawned.loose} />}
        {streaming === null && spawned.loose.length > 0 && <SubagentChips spawned={spawned.loose} onOpen={openSubagentTab} />}
        {sending && streaming === null && run.activeAt <= 0 && <p className="waiting" role="status"><Mark /> {agents.find((agent) => agent.threadId === thread.id)?.activity || "getting started"}…</p>}
        {sending && run.activeAt > 0 && <Stalled since={run.activeAt} blocks={run.blocks} recovery={run.recovery} onSwap={() => { setStallSwap(true); setModelsOpen(true); }} />}
        {!sending && streaming === null && echo === null && thread.messages.at(-1)?.role === "assistant" && <p className="turn-done" aria-label="Shinbo is ready for the next message"><ShinboMark /></p>}
        </RunContext.Provider>
        </EditTargets.Provider>
        </OpenPaths.Provider>
        </SkillNames.Provider>
      </div>
      <SelectionQuote scroller={transcript} onQuote={addContext} onThread={(quote) => newThread(`${quote}\n\n`)} />
      {!atEnd && <button type="button" className="transcript-tail" onClick={toEnd} aria-label="Scroll to the latest message" title="Jump to the end">↓</button>}
      </div>
      <ProjectBar folders={folders} ids={folderIds} setFolders={setFolders} setIds={setFolderIds} git={git} name={worktreeName(thread.id)} busy={locked} />
      {sending && confirmStop && <div className="queued-stack" role="status"><div className="queued-row"><span>Press Esc again to stop Shinbo</span><button type="button" onClick={() => setConfirmStop(false)} aria-label="Keep going">×</button></div></div>}
      {queued.length > 0 && <div className="queued-stack" aria-label="Queued messages">{queued.map((turn, index) => <div className="queued-row" key={`${index}-${turn.content}`}><span>Queued · {turn.content}</span><button type="button" className="steering" disabled={!canSteer(turn)} onClick={() => steerNow(index)} aria-label="Steer the running turn with this message now" title={turn.content.length > MAX_STEER_CHARS ? `Longer than ${MAX_STEER_CHARS.toLocaleString("en-US")} characters — waits for the turn to end` : !canSteer(turn) ? "Attachments cannot be steered — this one waits for the turn to end" : "Steer — cut into what Shinbo is doing now and hand it this message"}>steer</button><button type="button" onClick={() => dropQueued(thread.id, index)} aria-label="Drop this queued message">×</button></div>)}</div>}
      {run.held.length > 0 && <div className="queued-stack held-stack" aria-label="Held messages">{run.held.map((turn, index) => <div className="queued-row" key={`${index}-${turn.content}`}><span>{turn.failure ? `Not sent · ${turn.failure}` : "Held"} · {turn.content}</span><button type="button" onClick={() => releaseHeld(thread.id, index, reload)} aria-label="Send this held message">↑</button><button type="button" onClick={() => dropHeld(thread.id, index)} aria-label="Drop this held message">×</button></div>)}</div>}
      <DropVeil onFiles={attachDropped} locked={locked} />
      {ask && <PermissionPrompt ask={ask} agents={agents} />}
      <TaskListBar threadId={thread.id} />
      <form className={`composer ${ask ? "asking" : ""}`} onSubmit={(event) => void send(event)}><label className="sr-only" htmlFor="message">Message Shinbo</label>
        {!draftSaved && <p className="capability-error" role="alert">This draft could not be saved. Copy it before quitting Shinbo.</p>}
        <PickTray picks={picks} folders={folders} locked={locked} drop={dropPick} /><div className="composer-input"><div className="composer-highlight" ref={mirror} aria-hidden="true">{composerSegments.map((segment, index) => <span key={index} className={segment.hue === undefined ? undefined : "slash-token"} data-hue={segment.hue}>{segment.text}</span>)}{"\n"}</div><textarea ref={input} autoFocus={!thread.messages.length} id="message" value={message} disabled={capabilityBusy || contextBusy} maxLength={COMPOSER_MAX} role="combobox" aria-expanded={slashOpen} aria-controls="slash-menu" aria-autocomplete="list" onChange={(event) => typing(event.currentTarget)} onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)} onScroll={(event) => { if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={composerKeys} onPaste={(event) => { const { files } = event.clipboardData; if (!files.length) return; const names = [...files].map((file) => file.name); if (event.clipboardData.getData("text/plain").split(/\r?\n/).every((line) => !line.trim() || names.includes(line.trim()))) event.preventDefault(); attachDropped(files); }} placeholder={sending ? `Shinbo is working — Enter queues, ${MODIFIER_LABEL}Enter steers (empty: oldest queued first), Esc Esc stops…` : thread.messages.length ? "Ask Shinbo to continue…" : "Ask Shinbo anything…"} rows={2} /></div>{message.length >= COMPOSER_MAX && <div className="composer-attachment"><span>Full — the composer holds {COMPOSER_MAX.toLocaleString()} characters, and anything past that was not taken. Attach the rest as a file.</span></div>}{slashOpen && <section className="source-popover slash-menu" id="slash-menu" role="listbox" aria-label={slash?.sigil === "@" ? "Artifacts, saved notes and files" : "Built-in tools, skills and MCP servers"}>{slashMatches.map((item, index) => <button type="button" role="option" aria-selected={index === slashActive} className={`slash-row ${index === slashActive ? "active" : ""}`} key={`${item.kind}-${item.id}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSlashPick(index)} title={item.detail} onClick={() => pickCommand(item)}><strong>{slash?.sigil ?? "/"}{item.name}</strong><em className="slash-kind" data-kind={item.kind}>{KIND_LABELS[item.kind]}</em><small>{item.detail}</small></button>)}{!slashMatches.length && <p className="slash-empty">{slash?.query ? `Nothing matches “${slash.query}”. ` : slash?.sigil === "@" ? "Nothing to add yet — connect a folder, save a note or make an artifact. " : ""}{slash?.sigil === "@" ? "Artifacts, saved notes and the files of this thread's folders appear here." : "Built-in tools, imported skills and MCP servers appear here."}</p>}</section>}<div className="composer-row"><div className="composer-tools"><button ref={sourceTrigger} type="button" className="source-trigger" disabled={locked} aria-label="Add context or plugin" aria-haspopup="dialog" aria-expanded={sourcesOpen} onClick={() => sourcesOpen ? closeSources() : setSourcesOpen(true)}>＋</button><ModePicker mode={mode} setMode={setMode} disabled={locked} />{reviewOffered && <button type="button" className="review-toggle" disabled={locked} aria-pressed={review} aria-label={review ? "Second-model review is on for this thread" : "Second-model review is off for this thread"} title={review ? "A second model reviews every turn that changes something here" : "Nothing is reviewed in this thread"} onClick={() => setReview(!review)}><ReviewIcon /></button>}</div><button ref={modelTrigger} type="button" className="model-button" disabled={locked} aria-haspopup="dialog" aria-expanded={modelsOpen} aria-label={`Select model, currently ${modelLabel}`} onClick={() => { if (modelsOpen) { closeModels(); return; } setSourcesOpen(false); setModelsOpen(true); }}><BrandIcon brand={modelBrand} className="model-brand" /><span className="model-label">{modelLabel}</span><span aria-hidden="true">▾</span></button><ThinkingControl level={thinkingLevel} modelKey={modelKey} act={act} busy={locked} onSettingsChanged={(next) => changeThreadModel(next).catch((reason: unknown) => { setRunError(reasonText(reason)); throw reason; })} onPicked={(effort) => { if (thread.messages.length) recordModelSwitch(thread.id, { at: thread.messages.length, label: "", brand: "", effort }); }} />{sending
          ? (message.trim()
            ? <button className="composer-send" disabled={locked} aria-label="Queue message" title="Queue — sent when this turn ends. Steer it from the queue to interrupt and send it now">↑</button>
            : <button type="button" className="composer-send stopping" onClick={interrupt} aria-label="Stop this turn" title="Stop this turn — Esc Esc">■</button>)
          : <button className="composer-send" disabled={locked || !message.trim()} aria-label="Send message">↑</button>}</div>{modelsOpen && <ModelMenu ref={modelMenu} close={closeModels} act={act} busy={locked} onSettingsChanged={() => undefined} pinned={{ key: modelKey, onPick: async (key, current) => { const next = { ...current, selectedModel: key, thinkingLevel: "" as const }; await changeThreadModel(next); if (key === modelKey) return; if (stallSwap) { await swapStalledModel(next); return; } if (thread.messages.length) recordModelSwitch(thread.id, { at: thread.messages.length, label: modelKeyLabel(next, key), brand: modelKeyBrand(next, key)?.id ?? "" }); } }} onManage={onManageModels} />}{skill &&<div className="composer-attachment"><span>Skill · {skill.name} · next turn only</span><button type="button" disabled={locked} onClick={() => void window.shinbo.clearImportedSkill(skill.id).then(() => setSkill(null))} aria-label="Clear attached skill">×</button></div>}{sourcesOpen && <section className="source-popover add-menu" role="dialog" aria-modal="false" aria-labelledby="source-popover-title" tabIndex={-1} ref={(node) => { sourceMenu.current = node; if (node && !node.contains(document.activeElement)) node.focus(); }} onKeyDown={(event) => { if (event.key === "Escape" && !locked) closeSources(); }}><header><h3 id="source-popover-title">Add</h3><button type="button" disabled={locked} aria-label="Close add menu" onClick={closeSources}>×</button></header>{capabilitiesOpen ? <CapabilityPopover threadId={thread.id} locked={locked} close={() => setCapabilitiesOpen(false)} skill={skill} setSkill={setSkill} setBusy={setCapabilityRunning} /> : <><button type="button" className="add-row kind-knowledge" disabled={locked} onClick={() => { closeSources(); void window.shinbo.attachFiles().then(holdAttachments).catch((reason: unknown) => setRunError(reasonText(reason))); }}><b><ClipIcon /></b><div><strong>Attach files</strong><small>Images, code, CSVs, Markdown — dropping anywhere in the window or pasting works too</small></div></button><span className="add-section">Files</span><div className="add-context"><label className="sr-only" htmlFor="context-search">Search the files of this thread's folders</label><input id="context-search" value={contextQuery} disabled={locked} onChange={(event) => setContextQuery(event.target.value)} placeholder="Search files, skills & MCP — same as typing /" />{matchCommands(localContext, contextQuery).slice(0, 12).map((item) => <button type="button" className="slash-row" key={item.id} title={item.detail} disabled={locked} onClick={() => { if (item.pick) addPick(item.pick); }}>{item.pick?.kind === "file" ? <FileMark path={item.pick.path} /> : <span className="git-type" aria-hidden>·</span>}<strong>/{item.name}</strong><small>{item.detail}</small></button>)}{!localContext.length ? <p className="project-empty">Pick a folder in the project chip to list its files here.</p> : cappedFolder && <p className="project-empty">Showing {cappedFolder.listed} of {cappedFolder.total}{cappedFolder.capped ? "+" : ""} files in {cappedFolder.folder?.name ?? "this folder"} — the rest are not listed here.</p>}</div><span className="add-section">Skills &amp; MCP servers</span><div className="add-context">{matchCommands(imported, contextQuery).map((item) => <button type="button" className="slash-row" key={`${item.kind}-${item.id}`} title={item.detail} disabled={locked} onClick={() => { if (item.kind === "skill") { void window.shinbo.selectImportedSkill({ id: item.id, threadId: thread.id }).then(setSkill).catch((reason: unknown) => setRunError(reasonText(reason))); closeSources(); } else openCapabilities(); }}><strong>{item.kind === "skill" ? "Skill" : "MCP"} · {item.name}</strong><small>{item.detail}</small></button>)}{!imported.length && <p className="project-empty">Nothing imported yet — use /import to scan this {LOCAL_DEVICE}.</p>}</div><button type="button" className="add-row kind-capability" onClick={() => openCapabilities()}><b>{MODIFIER_LABEL}</b><div><strong>Imported skills &amp; MCP</strong><small>Attach a skill, or see the MCP servers every turn is handed</small></div></button><span className="add-section">Built-in plugins</span><button type="button" className="add-row kind-agent" onClick={() => { closeSources(); setAgentOpen(true); }}><b>⌁</b><div><strong>Agent runtime</strong><small>Inspect Shinbo's Zig harness and headless entry point</small></div></button><div className="add-row muted kind-hint"><b>{ALT_LABEL}</b><div><strong>Draw on screen</strong><small>Double-tap left {IS_WINDOWS ? "Alt" : "Option"}, then choose the yellow pen</small></div></div></>}</section>}</form>
    </section></Region></div>
      </div>
    </div>
    <Region name="context" props={{
      thread, messages: thread.messages, ledger, busy: locked, sending, agents, subagents, subthreads, git,
      collapsed: layout.inspectorCollapsed, setCollapsed: (inspectorCollapsed: boolean) => pane({ inspectorCollapsed }),
    }}>
    <aside className={`inspector ${layout.inspectorCollapsed ? "collapsed" : ""}`}>
      {!layout.inspectorCollapsed && <ResizeHandle label="Resize context bar" value={layout.inspectorWidth} min={260} max={360} direction={-1} onChange={(inspectorWidth) => pane({ inspectorWidth })} />}
      {!layout.inspectorCollapsed && <div className="inspector-body"><header>
        {contextPages.length > 1 ? <span className="inspector-tabs" role="tablist" aria-label="Context bar pages">
          {contextPages.map((item) => <button key={item.id} type="button" role="tab" aria-selected={item.id === page.id} title={`${item.name} — ${item.widgets.length} ${plural(item.widgets.length, "component")}`} onClick={() => setContextPage(item.id)}>{item.name}</button>)}
        </span> : <span>{page.name}</span>}
        {changes.length > 0 && <button type="button" className="changes-open" title={`${changes.length} ${plural(changes.length, "file")} changed — open the diff`} onClick={() => showReview("changes")}><ChangeCount stat={changeStat} /></button>}</header>
      {inspected && inspectedId !== thread.id && <button type="button" className="inspector-subject" title={`Reading ${threadLabel(inspected)} — back to ${threadLabel(thread)}`} onClick={() => setTab("thread")}>
        <i className="agent-dot" style={{ background: agents.find((agent) => agent.threadId === inspectedId)?.color ?? "var(--text-3)" }} aria-hidden="true" />
        <span>{threadLabel(inspected)}</span><em>×</em>
      </button>}
      <ContextWidgets page={page} context={{ ledger, messages: carried?.messages ?? NO_MESSAGES, threadId: inspectedId || thread.id, sending, subagents, subthreads, agents, onOpenThread: openThreadPage, tab, onPick: setTab, git, onOpenGit: () => showReview("git") }} onChange={(widgets) => onContextPages(contextPages.map((item) => item.id === page.id ? { ...item, widgets } : item))} /></div>}
    </aside></Region>
    {reviewPane && <div className="browser-column">
      <ResizeHandle label={`Resize ${reviewPane}`} value={layout.browserWidth} min={MIN_BROWSER_WIDTH} max={720} direction={-1} onChange={(browserWidth) => pane({ browserWidth })} />
      <section className="review-pane artifact-pane" aria-label={reviewPane === "git" ? "Git pane" : "Changes pane"}>
        <header><div><h2>{reviewPane === "git" ? "Git" : "Changes"}</h2></div>{reviewPane === "changes" && <ChangeCount stat={changeStat} />}
          <button type="button" className="artifact-icon" aria-label={layout.browserWidth >= WIDE_BROWSER_WIDTH ? "Narrow pane" : "Widen pane"} aria-pressed={layout.browserWidth >= WIDE_BROWSER_WIDTH} onClick={() => pane({ browserWidth: layout.browserWidth >= WIDE_BROWSER_WIDTH ? MIN_BROWSER_WIDTH : WIDE_BROWSER_WIDTH })}><InspectorIcon /></button>
          <button type="button" className="artifact-icon" aria-label="Close pane" onClick={() => showReview("")}><CloseIcon /></button>
        </header>
        {reviewPane === "changes" ? <ChangesPanel changes={changes} busy={locked} onReverted={reloadChanges} /> : folderIds[0] ? (git ? <GitPage key={folderIds[0]} snapshot={git} folderId={folderIds[0]} brand={modelBrand} /> : <GitSetup ready={gitState.ready} folderId={folderIds[0]} />) : <p className="project-empty">Connect a folder to use Git.</p>}
      </section>
    </div>}
    {filesPane.open && <div className="browser-column">
      <ResizeHandle label="Resize files" value={layout.browserWidth} min={MIN_BROWSER_WIDTH} max={720} direction={-1} onChange={(browserWidth) => pane({ browserWidth })} />
      <FilesPane threadId={thread.id} folders={folders} folderIds={folderIds} ask={filesPane.ask} onConsumed={clearFileAsk}
        wide={layout.browserWidth >= WIDE_BROWSER_WIDTH}
        onToggleWide={() => pane({ browserWidth: layout.browserWidth >= WIDE_BROWSER_WIDTH ? MIN_BROWSER_WIDTH : WIDE_BROWSER_WIDTH })}
        onClose={() => showFiles(false)} />
    </div>}
    {artifactPaneId ? <div className="artifact-column">
      <ResizeHandle label="Resize artifact" value={layout.browserWidth} min={MIN_BROWSER_WIDTH} max={720} direction={-1} onChange={(browserWidth) => pane({ browserWidth })} />
      <ArtifactPane id={artifactPaneId} busy={locked} close={() => setArtifactPaneId("")} edit={(artifact) => { setArtifactPaneId(""); void editArtifact(artifact); }} />
    </div> : null}
    {layout.browserOpen && !browserFloat && !artifactPaneId && <div className="browser-column">
      <ResizeHandle label="Resize browser" value={layout.browserWidth} min={MIN_BROWSER_WIDTH} max={720} direction={-1} onChange={(browserWidth) => pane({ browserWidth })} />
      <BrowserPane threadId={thread.id}
        wide={layout.browserWidth >= WIDE_BROWSER_WIDTH}
        onToggleWide={() => pane({ browserWidth: layout.browserWidth >= WIDE_BROWSER_WIDTH ? MIN_BROWSER_WIDTH : WIDE_BROWSER_WIDTH })}
        onFloat={() => setBrowserFloat(true)}
        onHide={() => showBrowser(false)}
        onClose={() => { showBrowser(false); void window.shinbo.browserNav({ threadId: thread.id, action: "close" }).catch(() => undefined); }} />
    </div>}
    {layout.terminalOpen && <div className="terminal-row">
      <ResizeHandle label="Resize terminal" axis="y" value={layout.terminalHeight} min={MIN_TERMINAL_HEIGHT} max={MAX_TERMINAL_HEIGHT} direction={-1} onChange={(terminalHeight) => pane({ terminalHeight })} />
      <TerminalPanel threadId={thread.id} folderId={folderIds[0] ?? ""} popped={popped} onPop={(id) => setPopped((current) => [...current, id])}
        onSelect={(value) => addPick({ kind: "terminal", id: value.id, text: value.text, lines: value.lines })}
        onHide={() => pane({ terminalOpen: false })}
        onOpenInShinbo={(url) => { showBrowser(true); void window.shinbo.browserOpen({ threadId: thread.id, url }).catch((reason: unknown) => setRunError(reasonText(reason))); }} />
    </div>}{agentOpen && <AgentDialog thread={thread} contextTokens={contextTokens} close={() => setAgentOpen(false)} />}
  </div></GoalThreads.Provider>;
}

function ThreadStatsExport({ thread, contextTokens }: { thread: Thread; contextTokens: number }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    setNote("Reading traces\u2026");
    try {
      const sources = await collectStats(thread.id, contextTokens);
      if (!sources) throw new Error("That thread is no longer stored.");
      setNote("Choose where to save\u2026");
      const saved = await window.shinbo.exportThreadStats({ folder: statsFolderName(sources.thread, sources.exportedAt), files: statsFiles(sources) });
      setNote(saved ? `Saved to ${saved}` : "");
    } catch (error) {
      setNote(reasonText(error));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <button type="button" disabled={busy} onClick={() => void download()}>{busy ? "Exporting\u2026" : "Download stats & traces"}</button>
    {note && <small role="status">{note}</small>}
  </>;
}

function AgentDialog({ thread, contextTokens, close }: { thread: Thread; contextTokens: number; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  const dismiss = () => dialog.current?.close();
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="agent-title" onClose={close} onCancel={(event) => { event.preventDefault(); dismiss(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}><section className="agent-dialog"><header><div><span>Thread agent</span><h2 id="agent-title">Shinbo harness</h2></div><button type="button" onClick={dismiss} aria-label="Close agent details">×</button></header><dl><div><dt>Thread</dt><dd className="copyable"><span>{thread.id}</span><CopyTurn text={thread.id} label="Copy thread ID" /></dd></div><div><dt>Created</dt><dd>{date(thread.createdAt)} · {time(thread.createdAt)}</dd></div><div><dt>Modified</dt><dd>{date(thread.updatedAt)} · {time(thread.updatedAt)}</dd></div><div><dt>Runtime</dt><dd><i /> shinbo-cli · ACP</dd></div><div><dt>Context</dt><dd>{thread.messages.length} durable {plural(thread.messages.length, "message")}</dd></div><div><dt>Tools</dt><dd>Lazy MCP search; schemas load only after selection</dd></div><div><dt>Stats</dt><dd className="stats-export"><ThreadStatsExport thread={thread} contextTokens={contextTokens} /></dd></div></dl><div className="agent-cli"><span>Headless entry point</span><code>{HARNESS_CLI}</code><p>Run coding or automation threads without Electron. See harness/README.md for the protocol.</p></div></section></dialog>;
}

const NO_MESSAGES: Message[] = [];

function loadSettings(): UserSettings {
  try { return validateSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null")); } catch { return structuredClone(defaultSettings); }
}

function readSettings(): UserSettings {
  const settings = loadSettings();
  applyAppearance(settings);
  return settings;
}

const accentValue = (accent: string) => (accent.startsWith("#") ? accent : `var(--${accent})`);
const previewAccent = (accent: string) => document.documentElement.style.setProperty("--accent", accentValue(accent));

function applyAppearance({ interfaceFont, agentFont, accent, tabColor, navIconColors, navHues, uiScale, conversationWidth }: UserSettings) {
  const root = document.documentElement;
  root.style.setProperty("--font-mono", fontStack(interfaceFont));
  root.style.setProperty("--font", fontStack(agentFont));
  root.style.setProperty("--accent", accentValue(accent));
  root.style.setProperty("--tab-color", accentValue(tabColor));
  for (const view of NAV_VIEWS) {
    const hue = navIconColors ? navHues[view] ?? navHueDefaults[view] : "";
    if (hue) root.style.setProperty(`--nav-${view}`, hue.startsWith("#") ? hue : `var(--${hue})`);
    else root.style.removeProperty(`--nav-${view}`);
  }
  if (conversationWidth === "default") delete root.dataset.conversation;
  else root.dataset.conversation = conversationWidth;
  if (isWorkspaceWindow) void window.shinbo.setZoom(uiScale / 100);
}

function persistSettings(settings: UserSettings): UserSettings {
  const valid = validateSettings(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(valid));
  dispatchEvent(new Event("shinbo-settings-changed"));
  return valid;
}

function useShortcutRequests() {
  useEffect(() => window.shinbo.onShortcutRequest((request) => {
    try {
      const saved = saveShortcut(loadSettings(), request);
      persistSettings(saved.settings);
      const index = Number(saved.action.at(-1));
      void window.shinbo.completeShortcutRequest({
        id: request.id,
        keybinds: saved.settings.keybinds,
        message: `Saved “${saved.settings.quickActions[index].label}” on ${keybindLabel(saved.settings.keybinds[saved.action]!, RUNTIME_PLATFORM)} in Settings → Keybinds.`,
      }).catch(() => undefined);
    } catch (error) {
      void window.shinbo.completeShortcutRequest({ id: request.id, error: reasonText(error) }).catch(() => undefined);
    }
  }), []);
}

const routerBrand: BrandDefinition = { id: "router", label: "Shinbo", fallback: "∞" };
const allFree = (models: readonly string[]) => models.every((id) => id.endsWith(":free"));
const routerEntry = (router: ModelRouter): CatalogEntry => ({
  maker: "other",
  key: routerKey(router.id),
  name: router.name,
  detail: `${router.models.length} ${plural(router.models.length, "model")}, best first · falls through when one stops answering`,
  brand: routerBrand,
  free: allFree(router.models),
});
const routerFor = (settings: UserSettings, key: string) => settings.routers.find((router) => router.id === routerIdFor(key));

function councilSeed(settings: UserSettings): string[] {
  const starred = settings.favoriteModels.filter((key) => key && key !== "fallback");
  const chosen = settings.selectedModel && settings.selectedModel !== "fallback" ? [settings.selectedModel] : [];
  const seats = [...new Set([...chosen, ...starred])].slice(0, COUNCIL_SEATS_DEFAULT);
  while (seats.length < COUNCIL_SEATS_MIN) seats.push("");
  return seats;
}

function lastAsked(messages: readonly Message[]): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
}

function modelKeyLabel(settings: UserSettings, key: string): string {
  if (routerIdFor(key)) return routerFor(settings, key)?.name ?? "Router";
  if (key === "fallback") return "No model chosen";
  if (key.startsWith("openrouter:")) return key.slice("openrouter:".length).split("/").at(-1) ?? "OpenRouter";
  if (key.startsWith(CODEX_PREFIX)) return codexSlug(key);
  if (key.startsWith("provider:")) {
    const profile = settings.providers.find((item) => item.id === key.slice("provider:".length));
    return profile ? planForProfile(profile) ? profile.modelId : profile.name : "Provider";
  }
  return "Model";
}

function modelKeyBrand(settings: UserSettings, key: string): BrandDefinition | undefined {
  if (key === "fallback") return shinboBrand;
  if (routerIdFor(key)) return routerBrand;
  if (key.startsWith("openrouter:")) return brandForModel(key.slice("openrouter:".length), "openrouter");
  if (key.startsWith(CODEX_PREFIX)) return brandForProvider("openai");
  if (key.startsWith("provider:")) {
    const profile = settings.providers.find((item) => item.id === key.slice("provider:".length));
    const plan = profile && planForProfile(profile);
    return profile ? plan ? brandForProvider(plan.brand) : brandForModel(profile.modelId, "local") : undefined;
  }
  return undefined;
}

function modelKeyRoute(settings: UserSettings, key: string): string {
  const router = routerFor(settings, key);
  if (router) return `${router.models.length} ${plural(router.models.length, "model")} · via OpenRouter`;
  if (key === "fallback") return "No model sent · the agent’s own free route";
  if (key.startsWith("openrouter:")) return `${modelKeyBrand(settings, key)?.label ?? "Community"} · via OpenRouter`;
  if (key.startsWith(CODEX_PREFIX)) return "OpenAI · ChatGPT subscription";
  if (key.startsWith("provider:")) {
    const profile = settings.providers.find((item) => item.id === key.slice("provider:".length));
    const plan = profile && planForProfile(profile);
    return profile ? plan ? `${plan.label} · ${plan.billing === "subscription" ? "subscription" : "API billing"}` : `${profile.modelId} · ${reachLabel[providerReach(profile.baseUrl)] ?? "Unreachable"}` : "Missing provider";
  }
  return "Unknown route";
}

const selectedModelLabel = (settings: UserSettings) => modelKeyLabel(settings, settings.selectedModel);

function useSelectedModel(settings: UserSettings, selectedModel: string): { contextTokens: number } {
  const profile = selectedModel.startsWith("provider:") ? settings.providers.find((item) => item.id === selectedModel.slice("provider:".length)) : undefined;
  const routerId = routerIdFor(selectedModel);
  const modelId = profile ? ""
    : selectedModel.startsWith("openrouter:") ? selectedModel.slice("openrouter:".length)
    : routerId === FREE_ROUTER_ID ? FREE_ROUTER_MODELS[0]
    : routerId ? settings.routers.find((router) => router.id === routerId)?.models[0] ?? ""
    : "";
  const [windows, setWindows] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!selectedModel) return;
    let live = true;
    void whenProvidersReady()
      .then(() => window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels"))
      .then((catalog) => {
        const context = catalog.routes?.[selectedModel]?.contextWindow ?? catalog.models.find((model) => model.id === modelId)?.contextLength ?? 0;
        if (live) setWindows((current) => ({ ...current, [selectedModel]: context }));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [modelId, selectedModel]);
  return { contextTokens: profile?.contextWindow || windows[selectedModel] || 0 };
}

function reasoningFor(catalog: OpenRouterCatalog | undefined, key: string): { reasoningEfforts?: string[]; reasoningMandatory?: boolean } | undefined {
  if (key.startsWith("openrouter:")) return catalog?.models.find((model) => model.id === key.slice("openrouter:".length));
  return catalog?.routes?.[key];
}

function useThinking(act: (method: string, params?: Record<string, string>) => Promise<unknown>, onSettingsChanged: (settings: UserSettings) => void | Promise<void>, modelKey?: string) {
  const [catalog, setCatalog] = useState<OpenRouterCatalog>();
  useEffect(() => { void window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels").then(setCatalog).catch(() => undefined); }, []);
  const settings = loadSettings();
  const stops = thinkingStops(reasoningFor(catalog, modelKey ?? settings.selectedModel));
  const setLevel = async (next: ThinkingLevel) => {
    if (modelKey !== undefined) {
      await onSettingsChanged({ ...settings, selectedModel: modelKey, thinkingLevel: next });
      return;
    }
    const selected = await selectModelKey(settings, settings.selectedModel, act, next);
    if (!selected) return;
    await onSettingsChanged(persistSettings({ ...selected, thinkingLevel: next }));
  };
  return { stops, setLevel };
}

function ThinkingChip({ level, stops, open, disabled, onToggle, ref }: { level: ThinkingLevel; stops: ThinkingLevel[]; open: boolean; disabled: boolean; onToggle: () => void; ref?: RefObject<HTMLButtonElement | null> }) {
  const index = Math.max(0, stops.indexOf(level));
  const bars = Math.min(stops.length - 1, 5);
  const filled = Math.round(index / Math.max(1, stops.length - 1) * bars);
  return <button ref={ref} type="button" className="thinking-chip" data-level={level} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}
    title={`Thinking · ${thinkingLabel(level)}`} aria-label={`Thinking effort, ${thinkingLabel(level)} of ${stops.length} levels`}>
    <span className="thinking-bars" aria-hidden="true">{Array.from({ length: bars }, (_, bar) => <i key={bar} data-on={bar < filled ? "true" : "false"} />)}</span>
    <span className="thinking-value">{thinkingLabel(level)}</span>
    <span aria-hidden="true">▾</span>
  </button>;
}

function ThinkingDither({ fill }: { fill: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (!node || !context) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    let tick = 0;
    const paint = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (!width || !height) return;
      const scale = devicePixelRatio || 1;
      if (node.width !== Math.round(width * scale)) { node.width = Math.round(width * scale); node.height = Math.round(height * scale); }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#0e0e10e6";
      context.fillRect(0, 0, width, height);
      const lit = width * fill;
      context.globalCompositeOperation = "destination-out";
      for (let x = 1; x < width - 1; x += CELL) {
        for (let y = 1; y < height - 1; y += CELL) {
          const noise = Math.abs(Math.sin(x * 91.7 + y * 47.3 + tick * 1.7) * 43758.5453) % 1;
          const inside = x < lit;
          const alpha = inside ? (noise > 0.94 ? 1 : 0.62 + noise * 0.2) : (noise > 0.97 ? 0.4 : 0.16);
          context.fillStyle = `rgba(0, 0, 0, ${alpha})`;
          context.fillRect(x, y, CELL - 1, CELL - 1);
        }
      }
      context.globalCompositeOperation = "source-over";
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < SPARKLE_MS) return;
      last = now;
      tick += 1;
      paint();
    };
    paint();
    if (!still && fill > 0) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fill]);
  return <canvas ref={canvas} className="thinking-dither" aria-hidden="true" />;
}

const CELL = 4;
const SPARKLE_MS = 110;

function ThinkingMenu({ level, stops, setLevel, close, ref }: { level: ThinkingLevel; stops: ThinkingLevel[]; setLevel: (level: ThinkingLevel) => void | Promise<void>; close: () => void; ref?: RefObject<HTMLDivElement | null> }) {
  const [dragged, setDragged] = useState<ThinkingLevel | null>(null);
  const [saved, setSaved] = useState(level);
  if (saved !== level) { setSaved(level); setDragged(null); }
  const shown = dragged !== null && stops.includes(dragged) ? dragged : stops.includes(level) ? level : "";
  const index = Math.max(0, stops.indexOf(shown));
  const style = { "--stop": String(index), "--stops": String(Math.max(1, stops.length - 1)) } as CSSProperties;
  const save = (next: ThinkingLevel) => {
    if (next === level) { setDragged(null); return; }
    setDragged(next);
    void Promise.resolve(setLevel(next)).catch(() => undefined).finally(() => setDragged((current) => current === next ? null : current));
  };
  return <div ref={ref} className="source-popover thinking-menu" data-level={shown} style={style} role="dialog" aria-label="Thinking effort" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <header><span>Thinking</span><b>{thinkingLabel(shown)}</b></header>
    <label className="thinking-rail">
      <span className="sr-only">Thinking effort</span>
      <span className="thinking-ramp" aria-hidden="true" />
      <ThinkingDither fill={index / Math.max(1, stops.length - 1)} />
      <span className="thinking-ticks" aria-hidden="true">{stops.map((stop, at) => <i key={stop} data-on={index > 0 && at <= index ? "true" : "false"} />)}</span>
      <span className="thinking-knob" aria-hidden="true" />
      <input type="range" min={0} max={stops.length - 1} step={1} value={index} autoFocus aria-label="Thinking effort" aria-valuetext={thinkingLabel(shown)}
        onChange={(event) => setDragged(stops[Number(event.target.value)])}
        onPointerUp={(event) => save(stops[Number(event.currentTarget.value)])}
        onKeyUp={(event) => save(stops[Number(event.currentTarget.value)])} />
    </label>
    <footer><span>{thinkingLabel(stops[0])}</span><span>{stops.length} levels</span><span>{thinkingLabel(stops[stops.length - 1])}</span></footer>
  </div>;
}

function ThinkingControl({ level, modelKey, act, busy, onSettingsChanged, onPicked }: { level: ThinkingLevel; modelKey?: string; act: (method: string, params?: Record<string, string>) => Promise<unknown>; busy: boolean; onSettingsChanged: (settings: UserSettings) => void | Promise<void>; onPicked?: (level: ThinkingLevel) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const { stops, setLevel } = useThinking(act, onSettingsChanged, modelKey);
  const close = () => { setOpen(false); queueMicrotask(() => trigger.current?.focus()); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!menu.current?.contains(node) && !trigger.current?.contains(node)) setOpen(false);
    };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [open]);
  if (stops.length < 2) return null;
  const shown = stops.includes(level) ? level : "";
  return <span className="thinking-control">
    <ThinkingChip ref={trigger} level={shown} stops={stops} open={open} disabled={busy} onToggle={() => setOpen(!open)} />
    {open && !busy && <ThinkingMenu ref={menu} level={shown} stops={stops} close={close} setLevel={async (next) => { await setLevel(next); onPicked?.(next); }} />}
  </span>;
}

async function selectModelKey(settings: UserSettings, key: string, act: (method: string, params?: Record<string, string>) => Promise<unknown>, effort = ""): Promise<UserSettings | undefined> {
  if (routerIdFor(key)) {
    const router = routerFor(settings, key);
    if (!router) throw new Error("The saved router is missing");
    if (await act("selectRouterModel", { routerId: router.id }) === undefined) return undefined;
  } else if (key.startsWith("openrouter:")) {
    if (await act("selectOpenRouterModel", { modelId: key.slice("openrouter:".length), effort }) === undefined) return undefined;
  } else if (key.startsWith(CODEX_PREFIX)) {
    if (await act("selectCodexModel", { modelId: codexSlug(key), effort }) === undefined) return undefined;
  } else if (key.startsWith("provider:")) {
    const profile = settings.providers.find((item) => item.id === key.slice("provider:".length));
    if (!profile || await act("selectProviderModel", { providerId: profile.id, effort }) === undefined) return undefined;
  } else if (await act("selectFallbackModel") === undefined) return undefined;
  return { ...settings, selectedModel: key };
}

const syncOverlayPreferences = (settings: UserSettings) => window.shinbo.setOverlayPreferences({ notchGap: settings.notchGap, cursorOrbsEnabled: settings.cursorOrbsEnabled, notchConcurrency: settings.notchConcurrency, systemPrompt: settings.systemPrompt, prompts: settings.prompts });

function syncMainPreferences(settings: UserSettings) {
  const ready = Promise.all([
    syncOverlayPreferences(settings),
    window.shinbo.request("setRouters", { routers: JSON.stringify(settings.routers) }),
    window.shinbo.setProviders(settings.providers),
    window.shinbo.setVerifier(settings.verifier),
    window.shinbo.setToolSettings(settings.tools),
    window.shinbo.setHarnessExperiments(settings.harnessExperiments),
    window.shinbo.setReview(settings.review),
    window.shinbo.setDefaultMode(settings.defaultPermissionMode),
    window.shinbo.setKeybinds(settings.keybinds),
    window.shinbo.setTagger(settings.tagger),
    window.shinbo.setZeroRetention(settings.requireZeroRetention),
  ]);
  void ready.catch(() => undefined);
  syncImprovements();
  return ready;
}

const credits: { title: string; summary: string; body: string; href?: string; link?: string }[] = [
  { title: "vercel-labs/fx", summary: "Agent harness", body: "Shinbo's coding harness, shinbo-cli, is a fork of fx — a coding agent harness written in Zig by Vercel. It keeps fx's agent loop, permission model, hooks, skills, subagents, tools, and MCP client, and replaces what tied it to Vercel's hosted services. Apache-2.0; the license and upstream notices ship with the fork.", href: "https://github.com/vercel-labs/fx", link: "vercel-labs/fx ↗" },
  { title: "ripgrep", summary: "Code search", body: "The ripgrep tool is BurntSushi's ripgrep 14.1.1, pinned by version and by the SHA-256 its release publishes, and shipped inside the app. MIT / Unlicense.", href: "https://github.com/BurntSushi/ripgrep", link: "BurntSushi/ripgrep ↗" },
  { title: "Icons and marks", summary: "Brand artwork", body: "Vendor icons come from official brand kits where one exists, and otherwise from pinned Simple Icons (CC0 1.0) and lobe-icons (MIT) revisions; the settings gear is Lucide's path (ISC). Every file is bundled rather than fetched at runtime, and each mark stays its owner's trademark.", href: "https://github.com/simple-icons/simple-icons", link: "simple-icons ↗" },
  { title: "Departure Mono", summary: "Interface typeface", body: "The interface face is Departure Mono by Helena Zhang, bundled as a woff2 rather than loaded from a font CDN. SIL Open Font License 1.1; the license text ships beside the file." },
  { title: "xterm.js", summary: "Terminal", body: "The terminal panel is a real login shell, drawn by xterm.js. Its pty is a small clang-built helper rather than node-pty, which would need a rebuild for every Electron release. MIT.", href: "https://github.com/xtermjs/xterm.js", link: "xtermjs/xterm.js ↗" },
  { title: "Electron + React", summary: "Desktop interface", body: `The renderer is sandboxed and reaches main only through a narrow preload API. Electron owns the windows; clang-built helpers own the ${ALT_LABEL}${ALT_LABEL} Quick Ask gesture and built-in dictation. React 19, TypeScript, and Vite build it; Mermaid draws the diagrams.` },
  { title: "Rust + Markdown", summary: "Local records", body: `Threads and knowledge are Markdown on this ${LOCAL_DEVICE}: shinbo-core owns their records, their validation, and the atomic writes, and the Rust host is an NDJSON server onto it that talks to no model. Rust 1.97, and Zig 0.16 builds the harness.` },
  { title: "Model Context Protocol", summary: "External tools", body: "Shinbo speaks no MCP herself: configured servers are handed to the harness, which starts them and holds their tools behind a search until the model asks for one. Servers and skills already set up for another agent are referenced where they sit, not copied, and every call still stops at Shinbo's permission gate." },
  { title: "OpenAI-compatible providers", summary: "Model connections", body: `Every remote route is a Chat Completions endpoint — OpenRouter by default, any compatible local or hosted server otherwise. A setting names an environment variable and never holds a key; a pasted key is encrypted with the ${PLATFORM_NAME} credential store and reaches the agent only through its spawn environment.` },
];

type SettingsPage = "keybinds" | "notch" | "voice" | "appearance" | "contextbar" | "models" | "prompts" | "tools" | "permissions" | "harness" | "imports" | "mobile" | "built" | "privacy" | "about";
const settingsPages: { id: SettingsPage; label: string; copy: string; group: string }[] = [
  { id: "keybinds", label: "Keybinds", copy: "Global and workspace shortcuts", group: "Personal" },
  { id: "notch", label: "Quick Ask", copy: "Actions, orbs, and placement", group: "Personal" },
  { id: "voice", label: "Voice", copy: "Dictation and cleanup", group: "Personal" },
  { id: "appearance", label: "Appearance", copy: "Accent colour, section marks, fonts", group: "Personal" },
  { id: "contextbar", label: "Context bar", copy: "Arrange the context bar", group: "Personal" },
  { id: "models", label: "Models", copy: "Picker, keys, and routes", group: "Personal" },
  { id: "prompts", label: "System prompt", copy: "Global, and per model", group: "Coding" },
  { id: "tools", label: "Tools", copy: "What the agent may call", group: "Integrations" },
  { id: "permissions", label: "Permissions", copy: `What ${PLATFORM_NAME} lets Shinbo do`, group: "Integrations" },
  { id: "harness", label: "Harness", copy: "Experimental context hooks", group: "Coding" },
  { id: "imports", label: "Imports & plugins", copy: "Skills and MCP sources", group: "Integrations" },
  { id: "mobile", label: "Mobile", copy: "Pair a phone with Shinbo", group: "Integrations" },
  { id: "built", label: "Built by Shinbo", copy: "What she made for your interface", group: "Shinbo" },
  { id: "privacy", label: "Data & privacy", copy: "Boundaries and reset", group: "Shinbo" },
  { id: "about", label: "About Shinbo", copy: "Build and architecture", group: "Shinbo" },
];

const providerMarks = [
  ["openai", "OpenAI", "US"], ["anthropic", "Anthropic", "US"], ["gemini", "Gemini", "US"], ["xai", "xAI", "US"],
  ["openrouter", "OpenRouter", "Router"], ["meta", "Meta", "US"], ["mistral", "Mistral", "EU"], ["cohere", "Cohere", "CA"], ["qwen", "Qwen", "CN"],
  ["deepseek", "DeepSeek", "CN"], ["kimi", "Kimi", "CN"], ["glm", "Z.ai / GLM", "CN"], ["minimax", "MiniMax", "CN"],
  ["ernie", "ERNIE", "CN"], ["hunyuan", "Hunyuan", "CN"], ["naver", "HyperCLOVA", "KR"], ["sakana", "Sakana AI", "JP"],
  ["nvidia", "NVIDIA", "US"], ["poolside", "Poolside", "US"], ["liquid", "Liquid AI", "US"],
] as const;

function SettingsNavigation({ page, onSelect, busy }: { page: SettingsPage; onSelect: (page: SettingsPage) => void; busy: boolean }) {
  return <nav className="settings-sidebar" aria-label="Settings sections"><h1>Settings</h1>{[...new Set(settingsPages.map((item) => item.group))].map((group) => <div className="settings-group" key={group}><span className="settings-group-label">{group}</span>{settingsPages.filter((item) => item.group === group).map((item) => <button key={item.id} disabled={busy} className={page === item.id ? "selected" : ""} onClick={() => onSelect(item.id)}><strong>{item.label}</strong><span>{item.copy}</span></button>)}</div>)}</nav>;
}

const KEYBIND_GLYPHS: Record<KeybindAction, string> = { toggle: "▭", voice: "●", draw: "✎", keep: "⧉", action0: `${MODIFIER_LABEL}1`, action1: `${MODIFIER_LABEL}2`, action2: `${MODIFIER_LABEL}3` };

const WINDOWS_KEYBIND_DETAILS: Partial<Record<KeybindAction, string>> = {
  toggle: "Shows Quick Ask, or hides it when it is already up.",
  voice: "Opens Quick Ask and starts dictation.",
  draw: "Opens Quick Ask and captures the screen to mark up.",
};

const WINDOWS_KEYBIND_BUILTINS: Partial<Record<KeybindAction, string>> = { draw: "✎ on Quick Ask", keep: "◈ on Quick Ask" };

function keybindDetail(action: (typeof KEYBIND_ACTIONS)[number]) {
  return (IS_WINDOWS ? WINDOWS_KEYBIND_DETAILS[action.id] : undefined) ?? action.detail;
}

function keybindBuiltin(action: (typeof KEYBIND_ACTIONS)[number]) {
  if (action.id === "toggle") return `${ALT_LABEL}${ALT_LABEL} double-tap left ${IS_WINDOWS ? "Alt" : "Option"}`;
  if (action.id === "action0" || action.id === "action1" || action.id === "action2") return `${MODIFIER_LABEL}${Number(action.id.slice(-1)) + 1} while ${OVERLAY_LABEL} is open`;
  return (IS_WINDOWS ? WINDOWS_KEYBIND_BUILTINS[action.id] : undefined) ?? action.builtin;
}

function KeybindSettings({ settings, save }: { settings: UserSettings; save: (keybinds: Keybinds) => Promise<string[]> }) {
  const [recording, setRecording] = useState<KeybindAction | "">("");
  const [problem, setProblem] = useState<{ action: KeybindAction; text: string } | null>(null);
  const [refused, setRefused] = useState<string[]>([]);
  const holding = useRef("");
  const released = useRef<{ code: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const forgetRelease = () => { if (released.current) { clearTimeout(released.current.timer); released.current = null; } };
  useEffect(() => { void window.shinbo.setKeybinds(loadSettings().keybinds).then(setRefused).catch(() => undefined); }, []);
  const bind = async (action: KeybindAction, keybinds: Keybinds) => {
    try { setRefused(await save(keybinds)); setProblem(null); }
    catch (reason) { setProblem({ action, text: reasonText(reason) }); }
  };
  const commit = (action: KeybindAction, keybind: Keybind) => {
    const clash = Object.entries(settings.keybinds).find(([other, value]) => other !== action && keybindKey(value, RUNTIME_PLATFORM) === keybindKey(keybind, RUNTIME_PLATFORM));
    if (clash) {
      const index = /^action([0-2])$/.exec(clash[0]);
      const label = index ? settings.quickActions[Number(index[1])].label : KEYBIND_ACTIONS.find((item) => item.id === clash[0])?.label;
      setProblem({ action, text: `${keybindLabel(keybind, RUNTIME_PLATFORM)} already runs “${label}”.` });
      return;
    }
    if (!keybind.hold) {
      const trouble = keybindProblem(keybind.accelerator, RUNTIME_PLATFORM);
      if (trouble) { setProblem({ action, text: trouble }); return; }
    }
    setProblem(null);
    setRecording("");
    void bind(action, { ...settings.keybinds, [action]: keybind });
  };
  const commitRef = useRef(commit);
  useLayoutEffect(() => { commitRef.current = commit; });
  const holdMs = (recording && settings.keybinds[recording]?.ms) || DEFAULT_HOLD_MS;
  useEffect(() => {
    if (!recording) return;
    const down = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const tapped = released.current?.code === event.code;
      forgetRelease();
      if (event.key === "Escape") { holding.current = ""; setRecording(""); setProblem(null); return; }
      if (tapped) { holding.current = ""; commitRef.current(recording, holdKeybind(event.code, TAP_MS)); return; }
      const accelerator = keyboardAccelerator(event, RUNTIME_PLATFORM);
      const holdAllowed = !IS_WINDOWS || !event.metaKey || /^Meta(?:Left|Right)$/.test(event.code);
      if (HOLD_KEYS[event.code] && holdAllowed && !accelerator) { holding.current = event.code; return; }
      holding.current = "";
      if (accelerator) commitRef.current(recording, comboKeybind(normalizeAccelerator(accelerator)));
    };
    const up = (event: KeyboardEvent) => {
      event.preventDefault();
      if (holding.current !== event.code) return;
      holding.current = "";
      const timer = setTimeout(() => { released.current = null; commitRef.current(recording, holdKeybind(event.code, holdMs)); }, DOUBLE_TAP_WINDOW_MS);
      released.current = { code: event.code, timer };
    };
    addEventListener("keydown", down, true);
    addEventListener("keyup", up, true);
    return () => { removeEventListener("keydown", down, true); removeEventListener("keyup", up, true); };
  }, [recording, holdMs]);
  const bound = KEYBIND_ACTIONS.filter((action) => settings.keybinds[action.id]?.accelerator || settings.keybinds[action.id]?.hold).length;
  const optionTapTaken = Object.values(settings.keybinds).some((keybind) => keybind.hold === "AltLeft" && keybind.ms === TAP_MS);
  return <div className="settings-stack settings-keybinds">
    <p className="personal-intro">Add global shortcuts to use Shinbo from any app. Built-in gestures always stay available.</p>
    {["Shinbo controls", "Quick actions"].map((group, groupIndex) => <div className="settings-lines" key={group}>
    <header><h3>{group}</h3>{groupIndex === 0 ? <strong>{bound} custom shortcuts</strong> : <small>Edit these actions in Quick Ask</small>}</header>
    {KEYBIND_ACTIONS.filter((action) => action.id.startsWith("action") === (groupIndex === 1)).map((action) => {
    const keybind = settings.keybinds[action.id];
    const listening = recording === action.id;
    const index = /^action([0-2])$/.exec(action.id);
    const label = index ? settings.quickActions[Number(index[1])].label : action.label;
    const detail = index ? "" : keybindDetail(action);
    return <section className="keybind-row" key={action.id}>
      <span className="orb" aria-hidden="true"><kbd>{KEYBIND_GLYPHS[action.id]}</kbd></span>
      <div><h3>{label}</h3>{detail && <p>{detail}</p>}
        {action.builtin && !(action.id === "toggle" && optionTapTaken) && <small className="keybind-builtin">{keybindBuiltin(action)}</small>}
        {problem?.action === action.id && <small className="keybind-problem">{problem.text}</small>}
        {!listening && keybind && refused.includes(action.id) && <small className="keybind-problem">Another app holds {keybindLabel(keybind, RUNTIME_PLATFORM)}. Pick a different one.</small>}
      </div>
      <div className="keybind-controls">
        <button type="button" className={`keybind-capture ${listening ? "recording" : ""}`} aria-label={`${listening ? "Recording shortcut for" : "Record shortcut for"} ${label}`} onClick={() => { setProblem(null); holding.current = ""; forgetRelease(); setRecording(listening ? "" : action.id); }}>
          {listening ? "Press keys… Esc cancels" : keybind ? <kbd>{keybindLabel(keybind, RUNTIME_PLATFORM)}</kbd> : "Add a shortcut"}
        </button>
        {keybind?.hold && <label className="keybind-duration">Trigger<select value={keybind.ms} onChange={(event) => commit(action.id, holdKeybind(keybind.hold, Number(event.target.value)))}><option value={TAP_MS}>Double-tap</option>{HOLD_DURATIONS.map((ms) => <option key={ms} value={ms}>Hold {ms}ms</option>)}</select></label>}
        {keybind && <button type="button" onClick={() => { setProblem(null); setRecording(""); void bind(action.id, { ...settings.keybinds, [action.id]: comboKeybind("") }); }}>Clear</button>}
      </div>
    </section>;
  })}</div>)}
  </div>;
}

const microphoneCopy: Record<string, string> = {
  granted: "Granted",
  denied: `Refused — ${PLATFORM_NAME} is blocking it`,
  restricted: `Blocked by this ${LOCAL_DEVICE}'s policy`,
  "not-determined": "Not asked yet",
  unknown: "Checking…",
};

function VoiceSettings({ settings, onChange, busy }: { settings: UserSettings; onChange: (next: UserSettings) => void; busy: boolean }) {
  const [heard, setHeard] = useState("");
  const [problem, setProblem] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const dictation = useDictation(settings, setHeard);
  const save = (patch: Partial<UserSettings>) => {
    try { onChange(persistSettings({ ...settings, ...patch })); setProblem(""); }
    catch (reason) { setProblem(reasonText(reason)); }
  };
  type TextField = "transcriptionEndpoint" | "transcriptionModel" | "voiceCleanupEndpoint" | "voiceCleanupModel";
  const field = (key: TextField, label: string) => <label>{label}<input
    value={drafts[key] ?? settings[key]}
    disabled={busy}
    spellCheck={false}
    aria-label={label}
    onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
    onBlur={() => { const value = drafts[key]; setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([name]) => name !== key))); if (value !== undefined && value !== settings[key]) save({ [key]: value.trim() }); }}
  /></label>;
  const grant = async () => {
    try {
      await window.shinbo.openPrivacySettings("microphone");
      await dictation.refresh();
    } catch (reason) {
      setProblem(reasonText(reason));
    }
  };
  const { status } = dictation;
  return <div className="settings-stack settings-personal settings-voice">
    <div className="settings-lines"><section><div><h3>Voice input</h3><p>Dictate in Quick Ask.</p></div><label className="check"><input type="checkbox" checked={settings.transcriptionEnabled} disabled={busy} onChange={(event) => save({ transcriptionEnabled: event.target.checked })} /> {settings.transcriptionEnabled ? "On" : "Off"}</label></section></div>
    {problem && <p className="local-model-error" role="alert">{problem}</p>}
    {settings.transcriptionEnabled && <>
      <div className="settings-lines">
        <section><div><h3>Microphone</h3><p>Audio stays on this {LOCAL_DEVICE}. The transcript reaches your model only when sent.</p></div><div className="voice-values"><strong className={status.microphone === "granted" ? "status-live" : "status-idle"}><i /> {microphoneCopy[status.microphone] ?? status.microphone}</strong>{status.microphone !== "granted" && <button type="button" disabled={busy} onClick={() => void grant()}>{status.microphone === "not-determined" || status.microphone === "unknown" ? "Set up microphone" : `Open ${IS_WINDOWS ? "Windows Settings" : "System Settings"} ↗`}</button>}</div></section>
        <section><div><h3>Speech to text</h3><p>{settings.transcriptionEngine === "apple" ? "Built-in, on-device recognition. No server needed." : "Transcribe through a server running on this computer."}</p></div><div className="voice-values"><label>Engine<select value={settings.transcriptionEngine} disabled={busy} onChange={(event) => save({ transcriptionEngine: event.target.value as TranscriptionEngine })}><option value="apple">{PLATFORM_NAME} · built in</option><option value="server">llama.cpp server</option></select></label><strong className={status.speech ? "status-live" : "status-idle"}><i /> {status.speech ? "Ready" : "Not running"}</strong>{!status.speech && status.speechError && <small className="keybind-problem">{status.speechError}</small>}{settings.transcriptionEngine === "apple" && !status.speech && <button type="button" disabled={busy} onClick={() => void window.shinbo.openPrivacySettings("speech")}>{IS_WINDOWS ? "Speech settings ↗" : "Speech Recognition ↗"}</button>}</div></section>
      </div>
      {settings.transcriptionEngine === "server" && <div className="settings-dependent"><div className="settings-field-pair voice-values">{field("transcriptionEndpoint", "Local speech endpoint")}{field("transcriptionModel", "Speech model")}</div><SettingsSection title="Speech server setup"><p>Install <a href={LLAMA_SITE_URL} target="_blank" rel="noreferrer">llama.cpp</a>, then start <a href={SPEECH_MODEL_URL} target="_blank" rel="noreferrer">{SPEECH_MODEL}</a>.</p><pre className="voice-command">{LLAMA_INSTALL}</pre><pre className="voice-command">{SPEECH_INSTALL}</pre></SettingsSection></div>}
      <SettingsSection title="Transcript cleanup" summary={settings.voiceCleanup ? "On · local model" : "Off · optional"}><div className="settings-lines"><section><div><h3>Clean up dictation</h3><p>Fix punctuation and false starts with a local text model. If cleanup fails, keep the original words.</p></div><label className="check"><input type="checkbox" checked={settings.voiceCleanup} disabled={busy} onChange={(event) => save({ voiceCleanup: event.target.checked })} /> Clean up transcripts</label></section></div>
      {settings.voiceCleanup && <div className="settings-dependent"><div className="settings-field-pair voice-values">{field("voiceCleanupEndpoint", "Local cleanup endpoint")}{field("voiceCleanupModel", "Cleanup model")}</div><strong className={status.model ? "status-live" : "status-idle"}>{status.model ? "Model loaded" : status.cleanup ? "Server up, no model" : "Not running"}</strong>{!!status.models.length && <small>Serving: {status.models.join(", ")}</small>}<SettingsSection title="Cleanup server setup"><p><a href={VOICE_MODEL_URL} target="_blank" rel="noreferrer">{VOICE_MODEL}</a> rewrites the transcript; it does not receive audio.</p><pre className="voice-command">{CLEANUP_INSTALL}</pre></SettingsSection></div>}
      </SettingsSection>
      <SettingsSection title="Hold to talk & test" summary={`${settings.voiceHoldMs} ms`}>
        <div className="settings-lines"><section><div><h3>Hold duration</h3><p>A tap stays a tap. Hold Space while Quick Ask is empty to dictate.</p></div><div className="voice-values"><label>Hold for<select value={settings.voiceHoldMs} disabled={busy} onChange={(event) => save({ voiceHoldMs: Number(event.target.value) })}>{HOLD_TO_TALK_MS.map((ms) => <option key={ms} value={ms}>{ms}ms</option>)}</select></label></div></section><section><div><h3>Try dictation</h3><p>Press and hold, say something, and let go.</p>{dictation.error && <p className="local-model-error" role="alert">{dictation.error}</p>}{heard && <p className="voice-heard" role="status">“{heard}”</p>}</div><div className="voice-values"><button type="button" disabled={busy || dictation.working || status.microphone === "denied" || status.microphone === "restricted"} onPointerDown={() => void dictation.start()} onPointerUp={() => void dictation.stop()} onPointerLeave={() => void dictation.stop()} onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); void dictation.start(); } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); void dictation.stop(); } }} onBlur={() => void dictation.stop()}>{dictation.working ? "Transcribing…" : dictation.listening ? "Listening — let go" : "Hold to talk"}</button><button type="button" disabled={busy} onClick={() => void dictation.refresh()}>Check voice status</button></div></section></div>
      </SettingsSection>
    </>}
  </div>;
}

function NotchSettings({ settings, onChange, busy }: { settings: UserSettings; onChange: (settings: UserSettings) => void; busy: boolean }) {
  return <div className="settings-lines settings-personal settings-quick-behavior">
    <section>
      <div>
        <h3>Quick Ask model</h3>
        <p>Follow the workspace selection or choose a model for new Quick Ask threads.</p>
      </div>
      <div className="notch-values">
        <TaskModelPicker model={settings.notchModel} busy={busy} label="Quick Ask model" inherit="Workspace picker" codex={false} onChange={(notchModel, current) => onChange({ ...current, notchModel })} />
      </div>
    </section>
    <section>
      <div>
        <h3>While a task is running</h3>
        <p>{settings.notchConcurrency === "separate" ? "Start a new thread. The current task finishes in the workspace." : "Reopen the current thread. Your next message waits for its reply."}</p>
      </div>
      <div className="notch-values">
        <label>Opens<select value={settings.notchConcurrency} disabled={busy} onChange={(event) => onChange({ ...settings, notchConcurrency: event.target.value as NotchConcurrency })}>
          <option value="separate">A separate task</option>
          <option value="continue">The running task</option>
        </select></label>
      </div>
    </section>
  </div>;
}

function SettingsSection({ title, summary, children, open }: { title: string; summary?: string; children: ReactNode; open?: boolean }) {
  return <details className="settings-section" open={open}><summary><span>{title}</span>{summary && <small>{summary}</small>}</summary><div className="settings-section-body">{children}</div></details>;
}

function SettingsView({ page, onSelectPage, busy, ...rest }:{ page: SettingsPage; onSelectPage: (page: SettingsPage) => void; act: (method: string, params?: Record<string, string>) => Promise<unknown>; busy: boolean; onModelChanged: (settings: UserSettings) => void; onAttach: (meta: ComponentMeta) => void }) {
  return <div className="settings-layout"><SettingsNavigation page={page} onSelect={onSelectPage} busy={busy} /><SettingsBody page={page} busy={busy} {...rest} /></div>;
}

function SettingsBody({ page, act, busy, onModelChanged, onAttach }: { page: SettingsPage; act: (method: string, params?: Record<string, string>) => Promise<unknown>; busy: boolean; onModelChanged: (settings: UserSettings) => void; onAttach: (meta: ComponentMeta) => void }) {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    const reload = () => setSettings(({ quickActions, cursorOrbs, cursorOrbsEnabled, notchCommandsEnabled, notchGap }) => ({ ...loadSettings(), quickActions, cursorOrbs, cursorOrbsEnabled, notchCommandsEnabled, notchGap }));
    addEventListener("storage", reload);
    addEventListener("shinbo-settings-changed", reload);
    return () => { removeEventListener("storage", reload); removeEventListener("shinbo-settings-changed", reload); };
  }, []);
  const [saved, setSaved] = useState(false);
  const [orb, setOrb] = useState(0);
  const [scale, setScale] = useState<number>();
  const [modelPage, setModelPage] = useState("workspace");
  const [saveError, setSaveError] = useState("");
  const [resetError, setResetError] = useState("");
  const setOrbs = (cursorOrbs: CursorCommand[]) => { setSaved(false); setSettings((current) => ({ ...current, cursorOrbs })); };
  const resizeOrbs = (count: number) => {
    if (!Number.isFinite(count)) return;
    const size = Math.min(MAX_CURSOR_ORBS, Math.max(1, Math.round(count)));
    const cursorOrbs = settings.cursorOrbs.slice(0, size);
    while (cursorOrbs.length < size) cursorOrbs.push(CURSOR_COMMANDS.find((command) => !cursorOrbs.includes(command)) ?? "screen");
    setOrb((current) => Math.min(current, size - 1));
    setOrbs(cursorOrbs);
  };
  const moveOrb = (step: number) => {
    const next = (orb + step + settings.cursorOrbs.length) % settings.cursorOrbs.length;
    const cursorOrbs = [...settings.cursorOrbs];
    [cursorOrbs[orb], cursorOrbs[next]] = [cursorOrbs[next], cursorOrbs[orb]];
    setOrbs(cursorOrbs);
    setOrb(next);
  };
  const updateAction = (index: number, field: string, value: string | boolean) => setSettings((current) => ({ ...current, quickActions: current.quickActions.map((action, actionIndex) => actionIndex === index ? { ...action, [field]: value } : action) as UserSettings["quickActions"] }));
  const save = (event: FormEvent) => { event.preventDefault(); setSaveError(""); try { const { quickActions, cursorOrbs, cursorOrbsEnabled, notchCommandsEnabled, notchGap } = settings; const valid = persistSettings({ ...loadSettings(), quickActions, cursorOrbs, cursorOrbsEnabled, notchCommandsEnabled, notchGap }); setSettings(valid); syncMainPreferences(valid); onModelChanged(valid); setSaved(true); } catch (reason) { setSaved(false); setSaveError(reasonText(reason)); } };
  const saveModelSettings = (next: UserSettings) => {
    const valid = validateSettings(next);
    const save = () => { const saved = persistSettings(valid); setSettings(saved); onModelChanged(saved); };
    if (JSON.stringify(valid.providers) !== JSON.stringify(settings.providers)) return window.shinbo.setProviders(valid.providers).then(async () => {
      try { save(); }
      catch (reason) {
        try { await window.shinbo.setProviders(settings.providers); }
        catch (rollbackReason) { throw new Error(`${reasonText(reason)} Could not restore providers: ${reasonText(rollbackReason)}`, { cause: rollbackReason }); }
        throw reason;
      }
    });
    save();
  };
  const saveNotch = (next: UserSettings) => { const { notchModel, notchConcurrency, providers } = next; const valid = persistSettings({ ...loadSettings(), notchModel, notchConcurrency, providers }); setSettings((current) => ({ ...current, notchModel, notchConcurrency, providers })); syncMainPreferences(valid); onModelChanged(valid); };
  const patch = (fields: Partial<UserSettings>) => { const valid = persistSettings({ ...loadSettings(), ...fields }); setSettings(valid); return valid; };
  const saveZeroRetention = async (requireZeroRetention: boolean) => {
    const valid = patch({ requireZeroRetention });
    await window.shinbo.setZeroRetention(requireZeroRetention);
    await selectModelKey(valid, valid.selectedModel, act);
    onModelChanged(valid);
  };
  const saveKeybinds = async (keybinds: Keybinds) => {
    const valid = patch({ keybinds });
    return await window.shinbo.setKeybinds(valid.keybinds).catch(() => [] as string[]);
  };
  const saveVerifier = async (verifier: VerifierSettings) => {
    const valid = patch({ verifier });
    await window.shinbo.setVerifier(valid.verifier);
  };
  const saveTools = async (tools: ToolSettings) => {
    const valid = patch({ tools });
    await window.shinbo.setToolSettings(valid.tools);
  };
  const saveHarnessExperiments = async (harnessExperiments: HarnessExperiments) => {
    const valid = patch({ harnessExperiments });
    await window.shinbo.setHarnessExperiments(valid.harnessExperiments);
  };
  const saveReview = async (next: UserSettings) => {
    const valid = patch({ review: next.review });
    await window.shinbo.setReview(valid.review);
  };
  const savePrompts = (next: UserSettings) => {
    const current = loadSettings();
    const valid = patch({ systemPrompt: next.systemPrompt, prompts: next.prompts, providers: next.providers });
    void syncOverlayPreferences(valid).catch(() => undefined);
    if (JSON.stringify(valid.providers) !== JSON.stringify(current.providers)) void window.shinbo.setProviders(valid.providers).catch(() => undefined);
  };
  const saveAppearance = (fields: Partial<UserSettings>) => patch(fields);
  const previewScale = (next: number) => { setScale(next); if (isWorkspaceWindow) void window.shinbo.setZoom(next / 100); };
  const commitScale = () => { if (scale !== undefined && scale !== settings.uiScale) saveAppearance({ uiScale: scale }); setScale(undefined); };
  const accentHex = settings.accent.startsWith("#") ? settings.accent : getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const saveContextPages = (contextPages: ContextPage[]) => { try { patch({ contextPages }); } catch { setSettings((current) => ({ ...current, contextPages })); } };
  const resetSettings = () => {
    if (!confirm("Restore every setting to its default?\n\nThreads, notes, artifacts, connected folders and saved keys stay. This cannot be undone.")) return;
    const valid = persistSettings(structuredClone(defaultSettings));
    setSettings(valid);
    void syncMainPreferences(valid).then(() => selectModelKey(valid, valid.selectedModel, act)).catch(() => undefined);
    onModelChanged(valid);
  };
  const resetData = async () => {
    if (!confirm(`Delete all Shinbo data and start fresh?\n\nEvery thread, artifact, connected folder, saved key, and setting on this ${LOCAL_DEVICE} goes, and Shinbo restarts empty. This cannot be undone.`)) return;
    try { await window.shinbo.resetData(); localStorage.clear(); }
    catch (reason) { setResetError(reasonText(reason)); }
  };
  if (page === "built") return <section className="settings-view"><header><span>Settings / built by Shinbo</span><div className="settings-head"><h2>Built by Shinbo</h2><InfoDot>Every piece Shinbo has built into her own interface, where you pointed her at it. Send one to a thread to work on it again, switch it off to hide it without losing it, or delete it for good.</InfoDot></div></header><BuiltSettings busy={busy} onAttach={onAttach} /></section>;
  if (page === "contextbar") return <section className="settings-view settings-wide"><header><span>Settings / context bar</span><h2>Context bar</h2></header><ContextBarSettings pages={settings.contextPages} onChange={saveContextPages} busy={busy} /></section>;
  if (page === "appearance") return <section className="settings-view settings-personal settings-appearance">
    <header><span>Settings / appearance</span><h2>Appearance</h2><p>Make Shinbo comfortable to read and easy to navigate.</p></header>
    <div className="settings-lines">
      <section><div><h3>Accent</h3><p>Buttons, focus rings, and selected controls.</p></div><div className="accent-values">{ACCENT_CHOICES.map((hue) => <button key={hue} type="button" className={`accent-swatch ${settings.accent === hue ? "active" : ""}`} style={{ "--swatch": `var(--${hue})` } as CSSProperties} title={hue} aria-label={hue} aria-pressed={settings.accent === hue} disabled={busy} onPointerEnter={() => !busy && previewAccent(hue)} onPointerLeave={() => previewAccent(settings.accent)} onFocus={() => !busy && previewAccent(hue)} onBlur={() => previewAccent(settings.accent)} onClick={() => saveAppearance({ accent: hue })} />)}<ColorPicker className={`accent-swatch accent-custom ${settings.accent.startsWith("#") ? "active" : ""}`} label="Any colour" value={accentHex} disabled={busy} onPreview={previewAccent} onChange={(hex) => saveAppearance({ accent: hex as AccentChoice })} /><small>{accentHex}</small></div></section>
      <section><div><h3>Tab color</h3><p>Conversation underlines and context bar tabs.</p></div><ColorPicker className="accent-swatch accent-custom" label="Tab color" value={settings.tabColor.startsWith("#") ? settings.tabColor : getComputedStyle(document.documentElement).getPropertyValue(`--${settings.tabColor}`).trim()} disabled={busy} onPreview={(hex) => document.documentElement.style.setProperty("--tab-color", hex)} onChange={(hex) => saveAppearance({ tabColor: hex as AccentChoice })} /></section>
      <section><div><h3>Interface scale</h3><p>Resize text, controls, and spacing together.</p></div><div className="font-values"><label>Scale · {scale ?? settings.uiScale}%<input type="range" min={MIN_UI_SCALE} max={MAX_UI_SCALE} step={5} value={scale ?? settings.uiScale} disabled={busy} onChange={(event) => previewScale(Number(event.target.value))} onPointerUp={commitScale} onKeyUp={commitScale} onBlur={commitScale} /></label></div></section>
      <section><div><h3>Conversation width</h3><p>Set the reading width of thread messages.</p></div><div className="font-values"><label>Column<select value={settings.conversationWidth} disabled={busy} onChange={(event) => saveAppearance({ conversationWidth: event.target.value as ConversationWidth })}>{CONVERSATION_WIDTHS.map((width) => <option key={width.id} value={width.id}>{width.label} · {width.detail}</option>)}</select></label></div></section>
    </div>
    <SettingsSection title="Typography" summary={`${FONT_CHOICES.find((font) => font.id === settings.interfaceFont)?.label} / ${FONT_CHOICES.find((font) => font.id === settings.agentFont)?.label}`} open>
      <div className="settings-field-pair"><div className="font-values"><label>Interface font<select value={settings.interfaceFont} disabled={busy} onChange={(event) => saveAppearance({ interfaceFont: event.target.value as FontChoice })}>{FONT_CHOICES.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label><p className="personal-hint">Navigation, buttons, and labels</p></div><div className="font-values"><label>Agent font<select value={settings.agentFont} disabled={busy} onChange={(event) => saveAppearance({ agentFont: event.target.value as FontChoice })}>{FONT_CHOICES.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label><p className="personal-hint">Messages and the composer</p></div></div>
      <div className="appearance-preview" aria-label="Font preview"><span style={{ fontFamily: fontStack(settings.interfaceFont) }}>Shinbo <span>Today · 10:24</span></span><p style={{ fontFamily: fontStack(settings.agentFont) }}>A little space to think clearly.</p><p style={{ fontFamily: fontStack(settings.agentFont) }}>Your ideas, notes, and next steps — all in one place.</p><small style={{ fontFamily: fontStack(settings.interfaceFont) }}>Aa Bb Cc · 0123456789</small></div>
    </SettingsSection>
    <SettingsSection title="Sidebar colors" summary={settings.navIconColors ? "Colored section marks" : "Monochrome"}>
      <div className="settings-lines"><section><div><h3>Section marks</h3><p>Give each sidebar section its own color.</p></div><label className="check"><input type="checkbox" checked={settings.navIconColors} disabled={busy} onChange={(event) => saveAppearance({ navIconColors: event.target.checked })} /> Use colors</label></section>{settings.navIconColors && <section><div className="nav-hues">{NAV_VIEWS.map((view) => <ColorPicker key={view} className="nav-hue" label={navLabels[view]} value={navHueHex(settings, view)} disabled={busy} onPreview={(hex) => document.documentElement.style.setProperty(`--nav-${view}`, hex)} onChange={(hex) => saveAppearance({ navHues: { ...settings.navHues, [view]: hex as AccentChoice } })}><NavIcon view={view} /></ColorPicker>)}<button type="button" className="hue-reset" disabled={busy || !Object.keys(settings.navHues).length} onClick={() => saveAppearance({ navHues: {} })}>Reset colors</button></div></section>}</div>
    </SettingsSection>
  </section>;
  if (page === "models") {
    const panels = [
      { id: "workspace", label: "Workspace", group: "Model roles", summary: modelKeyLabel(settings, settings.selectedModel), body: <div className="settings-lines"><section><div><h3>Workspace model</h3><p>The model selected for workspace turns. Existing threads keep their own selection.</p></div><TaskModelPicker model={settings.selectedModel} busy={busy} label="Workspace model" inherit="Default hosted route" onChange={async (selectedModel, current) => { const next = await selectModelKey(current, selectedModel || "fallback", act); if (next) await saveModelSettings(next); }} /></section><section><div><h3>Default route</h3><p>When no model is selected, Shinbo uses the agent’s hosted OpenRouter route. This needs network access and an OpenRouter key.</p></div></section></div> },
      { id: "quick-ask", label: "Quick Ask", group: "Model roles", summary: settings.notchModel ? modelKeyLabel(settings, settings.notchModel) : "Workspace selection", body: <div className="settings-lines"><section><div><h3>Quick Ask model</h3><p>Use the workspace selection or pin a separate model for new Quick Ask threads.</p></div><TaskModelPicker model={settings.notchModel} busy={busy} label="Quick Ask model" inherit="Workspace selection" codex={false} onChange={(notchModel, current) => saveNotch({ ...current, notchModel })} /></section></div> },
      { id: "verifier", label: "Verifier", group: "Model roles", summary: settings.verifier.model || "Off · Auto asks you", body: <VerifierPanel settings={settings} onSave={saveVerifier} busy={busy} /> },
      { id: "advisor", label: "Advisor", group: "Model roles", summary: settings.tools.advisor.model || "Not configured", body: <AdvisorPanel settings={settings} onSave={(advisor) => saveTools({ ...settings.tools, advisor })} busy={busy} /> },
      { id: "vision", label: "Vision", group: "Model roles", summary: settings.tools.vision.model || "Not configured", body: <VisionPanel settings={settings} onSave={(vision) => saveTools({ ...settings.tools, vision })} busy={busy} /> },
      { id: "secrets", label: "Secrets", group: "Model roles", summary: settings.tools.secret.model || "Not configured", body: <SecretPanel settings={settings} onSave={(secret) => saveTools({ ...settings.tools, secret })} busy={busy} /> },
      { id: "catalog", label: "Catalog & routers", group: "Manage", summary: `${settings.favoriteModels.length} favorites`, body: <ModelCatalog settings={settings} onChange={saveModelSettings} act={act} busy={busy} onConfigure={() => setModelPage("connections")} /> },
      { id: "connections", label: "Connections", group: "Manage", summary: `${settings.providers.length} providers`, body: <ProviderSettings settings={settings} onChange={saveModelSettings} act={act} busy={busy} /> },
      { id: "subscriptions", label: "Subscriptions", group: "Manage", summary: "Plans and CLI sign-ins", body: <ModelPlans settings={settings} busy={busy} /> },
      { id: "credentials", label: "Credentials", group: "Manage", summary: "Shared keys", body: <ProviderKeys settings={settings} act={act} busy={busy} /> },
      { id: "routing", label: "Private routing", group: "Manage", summary: settings.requireZeroRetention ? "Required" : "Off", body: <div className="settings-lines"><section><div><h3>Private routing</h3><p>Requests no-training, zero-retention endpoints for the main agent loop on OpenRouter. If no eligible endpoint exists, the request fails. This does not cover secondary models, tools or account logging. Changes apply to newly started agent processes.</p><label className="check"><input type="checkbox" checked={settings.requireZeroRetention} disabled={busy} onChange={(event) => void saveZeroRetention(event.target.checked)} /> Require no-training, zero-retention OpenRouter endpoints</label></div></section></div> },
    ];
    return <section className="settings-view settings-models"><header><h2>Models</h2><p>Choose a role or connection to configure.</p></header><div className="settings-master-detail"><nav className="settings-master" aria-label="Model settings">{["Model roles", "Manage"].map((group) => <div key={group}><h3>{group}</h3>{panels.filter((panel) => panel.group === group).map((panel) => <button type="button" key={panel.id} id={`model-nav-${panel.id}`} aria-pressed={modelPage === panel.id} aria-controls={`model-detail-${panel.id}`} disabled={busy} onClick={() => setModelPage(panel.id)}><span>{panel.label}</span><small>{panel.summary}</small></button>)}</div>)}</nav><div className="settings-detail">{panels.map((panel) => <section key={panel.id} id={`model-detail-${panel.id}`} aria-labelledby={`model-nav-${panel.id}`} hidden={modelPage !== panel.id}>{panel.body}</section>)}</div></div></section>;
  }
  if (page === "voice") return <section className="settings-view"><header><span>Settings / voice</span><h2>Voice</h2></header><VoiceSettings settings={settings} onChange={saveModelSettings} busy={busy} /></section>;
  if (page === "prompts") return <section className="settings-view"><header><span>Settings / system prompt</span><h2>System prompt</h2></header><PromptSettings settings={settings} onChange={savePrompts} busy={busy} /></section>;
  if (page === "tools") return <section className="settings-view"><header><span>Settings / tools</span><h2>Tools</h2></header><ToolSettingsPanel settings={settings} onChange={saveTools} onDefaultMode={(defaultPermissionMode) => { saveModelSettings({ ...loadSettings(), defaultPermissionMode }); void window.shinbo.setDefaultMode(defaultPermissionMode).catch(() => undefined); }} busy={busy} /></section>;
  if (page === "permissions") return <section className="settings-view"><header><span>Settings / permissions</span><h2>Permissions</h2></header><PermissionSettings busy={busy} /></section>;
  if (page === "harness") return <section className="settings-view"><header><span>Settings / harness</span><h2>Harness <b className="tag-experimental">Experimental</b></h2></header><div className="coding-harness"><ReviewPanel settings={settings} onSave={saveReview} busy={busy} /><SemanticGrepPanel settings={settings} onChange={saveHarnessExperiments} busy={busy} /><HarnessExperimentsPanel settings={settings} onChange={saveHarnessExperiments} busy={busy} /></div></section>;
  if (page === "imports") return <section className="settings-view"><header><span>Settings / imports & plugins</span><h2>Imports & plugins</h2></header><AgentImports /></section>;
  if (page === "mobile") return <section className="settings-view"><header><span>Settings / mobile</span><h2>Mobile</h2></header><MobileSettings busy={busy} /></section>;
  if (page === "privacy") return <section className="settings-view"><header><span>Settings / data &amp; privacy</span><h2>Data &amp; privacy</h2></header><PrivacySettings busy={busy} onReset={() => void resetData()} onResetSettings={resetSettings} onModels={() => { setModelPage("routing"); openSettingsPage("models"); }} />{resetError && <p className="local-model-error" role="alert">{resetError}</p>}</section>;
  if (page === "about") return <section className="settings-view"><header><span>Settings / about Shinbo</span><h2>About Shinbo</h2></header><div className="about-settings"><div className="settings-intro"><div><h3>Built with open source</h3><p>The projects behind Shinbo’s interface, agent and local data. Open a row for details and licenses.</p></div></div>{credits.map((credit) => <SettingsSection key={credit.title} title={credit.title} summary={credit.summary}><p>{credit.body}</p>{credit.href ? <a href={credit.href} target="_blank" rel="noreferrer">{credit.link}</a> : null}</SettingsSection>)}</div></section>;
  if (page === "keybinds") return <section className="settings-view"><header><h2>Keybinds</h2></header>
    <KeybindSettings settings={settings} save={saveKeybinds} />
    <div className="settings-lines">
      <header>
        <div className="settings-head"><h3>In the workspace</h3><InfoDot>These live in the window, not system wide, so they only reach Shinbo while she is in front and no other app loses them.</InfoDot></div>
        <strong>Built in</strong>
      </header>
      <section className="workspace-key"><div><h3>New thread</h3><p>Filed under the project the open thread belongs to.</p></div><kbd>{MODIFIER_LABEL}N</kbd></section>
      <section className="workspace-key"><div><h3>Jump to a thread</h3><p>The first nine threads in that project, in the order the sidebar lists them.</p></div><kbd>{MODIFIER_LABEL}1 – {MODIFIER_LABEL}9</kbd></section>
    </div>
    </section>;
  return <section className="settings-view"><header><h2>Quick Ask</h2></header><NotchSettings settings={settings} onChange={saveNotch} busy={busy} /><form className="settings-form" onSubmit={save} onChange={() => setSaved(false)}>
    <div className="quick-action-editor settings-lines">
      <header>
        <div className="settings-head"><h3>Quick actions</h3><InfoDot>Each one is a prompt {OVERLAY_LABEL} runs against whatever you hand it — a capture, the page your browser has in front, or nothing at all. Destination and category decide where the answer is filed when <b>Save analyzed result</b> is on.</InfoDot></div>
        <strong>{MODIFIER_LABEL}1 – {MODIFIER_LABEL}3</strong>
      </header>
      {settings.quickActions.map((action, index) => <SettingsSection title={action.label || `Action ${index + 1}`} summary={`${MODIFIER_LABEL}${index + 1}`} key={index}>
        <div className="quick-fields"><label>Label<input value={action.label} maxLength={40} onChange={(event) => updateAction(index, "label", event.target.value)} /></label><label className="prompt-field">Prompt<textarea value={action.prompt} maxLength={4096} rows={2} onChange={(event) => updateAction(index, "prompt", event.target.value)} /></label></div>
      </SettingsSection>)}
    </div>
    <SettingsSection title="Cursor orbs & swipe commands" summary={settings.cursorOrbsEnabled || settings.notchCommandsEnabled ? "On" : "Off"}>
    <section className="orb-settings"><div><div className="settings-head"><h3>Orbs you can rearrange</h3><InfoDot>The ring opens where the pointer is when Quick Ask does, and the same commands hang under {OVERLAY_LABEL} when the pointer swipes below it. <b>Save screen</b> takes a picture of what you are looking at, reads it with your vision model, and asks the app in front what it is showing. Each save lands as one Markdown note in your vault, picture and all.</InfoDot></div><p>Pick an orb to change what it runs or where it sits.</p>
      <label className="check"><input type="checkbox" checked={settings.cursorOrbsEnabled} onChange={(event) => setSettings((current) => ({ ...current, cursorOrbsEnabled: event.target.checked }))} /> Ring the cursor when Quick Ask opens</label>
      <label className="check"><input type="checkbox" checked={settings.notchCommandsEnabled} onChange={(event) => setSettings((current) => ({ ...current, notchCommandsEnabled: event.target.checked }))} /> Reveal commands under {OVERLAY_LABEL} on a swipe</label>
      {(settings.cursorOrbsEnabled || settings.notchCommandsEnabled) && <div className="orb-fields"><label>Orbs · 1–{MAX_CURSOR_ORBS}<input type="number" min={1} max={MAX_CURSOR_ORBS} value={settings.cursorOrbs.length} onChange={(event) => resizeOrbs(event.currentTarget.valueAsNumber)} /></label>
      <label>Orb {orb + 1} runs<select value={settings.cursorOrbs[orb]} onChange={(event) => setOrbs(settings.cursorOrbs.map((command, index) => index === orb ? event.target.value as CursorCommand : command))}>{CURSOR_COMMANDS.map((command) => <option key={command} value={command}>{orbLabel(command, settings)}</option>)}</select></label>
      <div className="orb-order"><span>Position</span><button type="button" onClick={() => moveOrb(-1)} aria-label="Move orb counter-clockwise">↺</button><button type="button" onClick={() => moveOrb(1)} aria-label="Move orb clockwise">↻</button></div></div>}</div>
      {(settings.cursorOrbsEnabled || settings.notchCommandsEnabled) && <div className="orb-preview"><OrbRing commands={settings.cursorOrbs} settings={settings} selected={orb} onPick={setOrb} radius={108} /></div>}</section>
    </SettingsSection>
    <SettingsSection title="Placement" summary={IS_WINDOWS ? "Drag the pill where you want it" : `${settings.notchGap} pt fallback gap`}>
    <section className="notch-settings"><div><div className="settings-head"><h3>{IS_WINDOWS ? "Where Quick Ask appears" : "Where the island hangs"}</h3><InfoDot>{IS_WINDOWS ? "Quick Ask appears as a small pill near the top of the display. Move it if the default position does not suit your taskbar or windows." : "Shinbo measures the real camera housing on each display and wraps the menu bar around it. The gap below is the fallback for Macs and external displays without a housing."}</InfoDot></div><p>{IS_WINDOWS ? "Quick Ask appears near the top of the display." : "Quick Ask hangs off the camera housing."}</p></div>{!IS_WINDOWS && <div className="notch-values"><label>Fallback gap · 120–260 pt<NumberField value={settings.notchGap} min={120} max={260} disabled={busy} onCommit={(notchGap) => { setSaved(false); setSettings((current) => ({ ...current, notchGap })); }} /></label></div>}</section>
    </SettingsSection>
    <button className="save-settings">{saved ? "Saved ✓" : "Save settings"}</button>{saveError && <p className="local-model-error" role="alert">{saveError}</p>}</form></section>;
}

const MODALITY_MARKS: Record<ModelModality, { label: string; path: string }> = {
  image: { label: "Accepts images", path: "M2.5 3.5h11v9h-11zM4 10l2.5-2.5 2 2 2-2L13.5 10" },
  file: { label: "Accepts files", path: "M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12" },
  audio: { label: "Accepts audio", path: "M3.5 6.5h2.5l3.5-3v9l-3.5-3H3.5zM11.5 5.5a4 4 0 0 1 0 5" },
};

const contextMark = new Intl.NumberFormat("en", { notation: "compact" });

const modalityMarks = (modalities: ModelModality[] = []) => modalities
  .filter((modality) => modality in MODALITY_MARKS)
  .map((modality) => <svg key={modality} className="model-modality" viewBox="0 0 16 16" role="img" aria-label={MODALITY_MARKS[modality].label}><title>{MODALITY_MARKS[modality].label}</title><path d={MODALITY_MARKS[modality].path} /></svg>);

type ModelEntry = { key: string; name: string; detail: string; brand?: BrandDefinition; modalities?: ModelModality[]; free?: boolean; context?: number };
type CatalogEntry = ModelEntry & { maker: string };
type ModelPick = (key: string, plan?: ModelPlan) => void;

const isFreeModel = (idOrKey: string) => idOrKey.endsWith(":free");
const priceBadge = (free: boolean) => free
  ? <span className="model-free">Free</span>
  : <span className="model-paid">Paid</span>;

const localBrand: BrandDefinition = { id: "local", label: "Local models", fallback: "L" };
const allBrand: BrandDefinition = { id: "all", label: "All models", fallback: "∗" };

const catalogMarks = [["local", "Local models", LOCAL_DEVICE], ...providerMarks, ["other", "Other", "Various"]] as const;

function codexEntries(models: OpenRouterCatalog["models"], slugs: readonly string[], routes: OpenRouterCatalog["routes"]): CatalogEntry[] {
  const plan = planFor("openai");
  if (!plan) return [];
  const listed = new Set(models.filter((model) => modelEntryPlan({ key: `openrouter:${model.id}` })?.id === plan.id).map((model) => planModelId(plan, model.id)));
  return slugs.filter((slug) => !listed.has(slug)).map((slug) => {
    const key = `${CODEX_PREFIX}${slug}`;
    const context = routes?.[key]?.contextWindow;
    return {
      maker: plan.brand,
      key,
      name: routes?.[key]?.name ?? slug,
      detail: `${slug}${context ? ` · ${Math.round(context / 1000)}K context` : ""} · ChatGPT subscription`,
      brand: brandForProvider(plan.brand),
      context,
    };
  });
}

function modelEntries(providers: ProviderProfile[], models: OpenRouterCatalog["models"], codexSlugs: readonly string[] = [], routes?: OpenRouterCatalog["routes"], active = ""): CatalogEntry[] {
  const standalone = providers.filter((profile) => {
    const plan = planForProfile(profile);
    return !plan || !models.some((model) => modelEntryPlan({ key: `openrouter:${model.id}` })?.id === plan.id && planModelId(plan, model.id) === profile.modelId);
  });
  const entries: CatalogEntry[] = [
    { maker: "other", key: "fallback", name: "No model chosen", detail: "Shinbo sends no model · the agent answers on its own free OpenRouter route", free: true, brand: shinboBrand },
    ...standalone.map((profile) => {
      const key = `provider:${profile.id}`;
      const context = (routes?.[key]?.contextWindow ?? profile.contextWindow) || undefined;
      const plan = planForProfile(profile);
      return { maker: plan?.brand ?? "local", key, name: plan ? `${profile.name} · ${profile.modelId}` : profile.name, detail: `${profile.modelId}${context ? ` · ${Math.round(context / 1000)}K context` : ""} · ${profile.baseUrl}`, brand: (plan ? brandForProvider(plan.brand) : brandForModel(profile.modelId, "local")) ?? localBrand, context };
    }),
    ...models.map((model) => {
      const brand = brandForModel(model.id, "openrouter");
      const key = `openrouter:${model.id}`;
      const plan = modelEntryPlan({ key });
      const profile = plan && planProfileFor(providers, plan, planModelId(plan, key));
      const codexKey = plan?.id === "openai" && !isFreeModel(key) ? codexModelKey(plan, key) : "";
      const route = active === codexKey ? codexKey : profile && active === `provider:${profile.id}` ? active : key;
      const context = routes?.[route]?.contextWindow ?? model.contextLength;
      return { maker: brand?.id ?? "other", key, name: model.name, detail: `${model.id} · ${Math.round(context / 1000)}K context`, brand, modalities: model.inputModalities, free: model.free, context };
    }),
    ...codexEntries(models, codexSlugs, routes),
  ];
  const order = ["local", ...providerBrands.map((brand) => brand.id), "other"];
  return entries.sort((left, right) => order.indexOf(left.maker) - order.indexOf(right.maker));
}

function catalogStatus(catalog: OpenRouterCatalog): string {
  if (catalog.stale) return "Offline \u00b7 showing the cached catalog";
  const changes = [
    catalog.added?.length ? `${catalog.added.length} new` : "",
    catalog.removed?.length ? `${catalog.removed.length} gone` : "",
  ].filter(Boolean).join(" \u00b7 ");
  return changes || "No change since the last reload";
}

const CATALOG_PAGE = 15;

const MODEL_MENU_LIMIT = 30;
const FREE_ONLY_KEY = "shinbo.freeModelsOnly.v1";
const MAKER_ORDER_KEY = "shinbo.makerOrder.v1";
const STAR_MARK = "starred";

function readMakerOrder(): string[] {
  try { const saved: unknown = JSON.parse(localStorage.getItem(MAKER_ORDER_KEY) ?? "[]"); return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []; }
  catch { return []; }
}

function modelEntryPlan(entry: Pick<ModelEntry, "key">): ModelPlan | undefined {
  return entry.key.startsWith("openrouter:") && !entry.key.slice("openrouter:".length).includes(":") ? planForModel(entry.key) : undefined;
}

function modelEntryPlanProfile(entry: ModelEntry, providers: readonly ProviderProfile[]): ProviderProfile | undefined {
  if (isFreeModel(entry.key)) return undefined;
  const plan = modelEntryPlan(entry);
  return plan ? planProfileFor(providers, plan, planModelId(plan, entry.key)) : undefined;
}

const CODEX_SLUG_REFRESH_MS = 60 * 60 * 1000;
let codexSlugsOnce: { at: number; value: Promise<string[]> } | undefined;

function useCodexSlugs(routes?: OpenRouterCatalog["routes"]): string[] {
  const routed = Object.keys(routes ?? {}).filter((key) => key.startsWith(CODEX_PREFIX)).map(codexSlug);
  const [slugs, setSlugs] = useState<string[]>([]);
  useEffect(() => {
    if (routed.length) return;
    let live = true;
    if (!codexSlugsOnce || Date.now() - codexSlugsOnce.at >= CODEX_SLUG_REFRESH_MS) {
      codexSlugsOnce = { at: Date.now(), value: window.shinbo.cliModels({ cli: "codex" }).then((found) => found.models).catch(() => []) };
    }
    void codexSlugsOnce.value.then((found) => { if (live) setSlugs(found); });
    return () => { live = false; };
  }, [routed.length]);
  return routed.length ? routed : slugs;
}

function modelEntryCodexKey(entry: ModelEntry, slugs?: readonly string[]): string {
  const plan = modelEntryPlan(entry);
  if (plan?.id !== "openai" || isFreeModel(entry.key)) return "";
  return availableCodexModelKey(plan, entry.key, slugs);
}

function modelEntryCurrent(entry: ModelEntry, active: string, providers: readonly ProviderProfile[]): boolean {
  const profile = modelEntryPlanProfile(entry, providers);
  const codexKey = modelEntryCodexKey(entry);
  return active === entry.key || (!!codexKey && codexKey === active) || !!profile && `provider:${profile.id}` === active;
}

function modelEntryRoute(entry: ModelEntry, active: string, providers: readonly ProviderProfile[], slugs: readonly string[]): { key: string; plan?: ModelPlan } {
  if (active.startsWith(CODEX_PREFIX) && modelEntryCodexKey(entry) === active) return { key: active };
  const codexKey = modelEntryCodexKey(entry, slugs);
  const plan = modelEntryPlan(entry);
  const profile = modelEntryPlanProfile(entry, providers);
  if (profile && `provider:${profile.id}` === active) return { key: entry.key, plan };
  if (active === entry.key) return { key: entry.key };
  if (codexKey) return { key: codexKey };
  return profile && plan?.billing === "subscription" ? { key: entry.key, plan } : { key: entry.key };
}

function modelEntryFavorite(entry: ModelEntry, favorites: readonly string[], providers: readonly ProviderProfile[]): string {
  return favorites.find((key) => modelEntryCurrent(entry, key, providers)) ?? "";
}

function ModelProviderPicker({ entry, active, providers, busy, onPick, codexSlugs }: { entry: ModelEntry; active: string; providers: readonly ProviderProfile[]; busy?: boolean; onPick: ModelPick; codexSlugs: readonly string[] }) {
  const plan = modelEntryPlan(entry);
  if (!plan || !modelEntryCurrent(entry, active, providers)) return null;
  const profile = modelEntryPlanProfile(entry, providers);
  const codexKey = active.startsWith(CODEX_PREFIX) && modelEntryCodexKey(entry) === active ? active : modelEntryCodexKey(entry, codexSlugs);
  const chatgpt = !!codexKey && codexKey === active;
  const direct = !chatgpt && !!profile && `provider:${profile.id}` === active;
  return <div className="model-provider-picker" role="group" aria-label={`Provider for ${entry.name}`}>
    <span>Provider</span>
    <button type="button" aria-pressed={!direct && !chatgpt} disabled={busy} title={`Bill ${entry.name} through OpenRouter`} onClick={() => { if (direct || chatgpt) onPick(entry.key); }}>
      <BrandIcon brand={brandForProvider("openrouter")} className="model-brand" /><span>OpenRouter</span><small>API</small>
    </button>
    <button type="button" aria-pressed={direct} disabled={busy} title={`Bill ${entry.name} through ${plan.label}`} onClick={() => { if (!direct) onPick(entry.key, plan); }}>
      <BrandIcon brand={brandForProvider(plan.brand)} className="model-brand" /><span>{plan.label}</span><small>{plan.billing === "subscription" ? "Plan" : "API"}</small>
    </button>
    {codexKey && <button type="button" aria-pressed={chatgpt} disabled={busy} title={`Run ${entry.name} on Shinbo's own agent, spending your ChatGPT subscription`} onClick={() => { if (!chatgpt) onPick(codexKey); }}>
      <BrandIcon brand={brandForProvider(plan.brand)} className="model-brand" /><span>ChatGPT</span><small>Plan</small>
    </button>}
  </div>;
}

function ModelRow({ entry, active, providers, busy, onPick, starred, onStar, drag, codex = true }: {
  entry: ModelEntry;
  active: string;
  providers: readonly ProviderProfile[];
  busy?: boolean;
  onPick: ModelPick;
  starred?: boolean;
  onStar?: () => void;
  drag?: Record<string, unknown>;
  codex?: boolean;
}) {
  const slugs = useCodexSlugs();
  const codexSlugs = codex ? slugs : [];
  const route = modelEntryRoute(entry, active, providers, codexSlugs);
  const current = modelEntryCurrent(entry, active, providers);
  return <div className={`model-row ${current ? "current" : ""}`} {...drag}>
    <button type="button" className="model-row-pick" disabled={busy} aria-current={current} title={entry.detail} onClick={() => onPick(route.key, route.plan)}>
      <strong><BrandIcon brand={entry.brand} className="model-brand" /><span>{entry.name}</span>{modalityMarks(entry.modalities)}{entry.free ? priceBadge(true) : null}</strong>
      <small><span>{entry.brand && entry.brand !== shinboBrand ? entry.brand.label : entry.detail}</span></small>
    </button>
    <span className="model-context" title={entry.context ? `${entry.context.toLocaleString()}-token context window` : ""}>{entry.context ? contextMark.format(entry.context) : ""}</span>
    {onStar && <button type="button" className="model-star" aria-pressed={starred} aria-label={`${starred ? "Unstar" : "Star"} ${entry.name}`} title={starred ? "Remove from the composer's picker" : "Show in the composer's picker"} onClick={() => onStar()}>{starred ? "★" : "☆"}</button>}
    <ModelProviderPicker entry={entry} active={active} providers={providers} busy={busy} onPick={onPick} codexSlugs={codexSlugs} />
  </div>;
}

function ModelPicker({ entries, active: selected, onPick, busy, providers = [], favorites, onStar, onReorder, label, lead, routers, strip, children, codex = true }: {
  entries: CatalogEntry[];
  active: string;
  onPick: ModelPick;
  busy?: boolean;
  providers?: readonly ProviderProfile[];
  routers?: ModelRouter[];
  favorites?: string[];
  onStar?: (key: string) => void;
  onReorder?: (keys: string[]) => void;
  label: string;
  lead?: ModelEntry;
  strip?: ReactNode;
  children?: ReactNode;
  codex?: boolean;
}) {
  const active = codex || !selected.startsWith(CODEX_PREFIX) ? selected : "";
  const [maker, setMaker] = useState("");
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(() => localStorage.getItem(FREE_ONLY_KEY) === "1");
  const showFree = (on: boolean) => { localStorage.setItem(FREE_ONLY_KEY, on ? "1" : ""); setFreeOnly(on); };
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus(); }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [railOrder, setRailOrder] = useState<string[]>(readMakerOrder);
  const starred = favorites ?? [];
  const favorite = (entry: CatalogEntry) => modelEntryFavorite(entry, starred, providers);
  const listed = entries.filter((entry) => (codex || !entry.key.startsWith(CODEX_PREFIX)) && (!freeOnly || entry.free === true || modelEntryCurrent(entry, active, providers)));
  const routerEntries = (routers ?? []).map(routerEntry);
  const freeRouter = routerEntries.find((entry) => entry.key === routerKey(FREE_ROUTER_ID));
  const visibleRouters = routerEntries.filter((entry) => (!freeOnly || entry.key !== routerKey(FREE_ROUTER_ID)) && (!freeOnly || entry.free === true || modelEntryCurrent(entry, active, providers)));
  const needle = query.trim().toLowerCase();
  const searched = listed.filter((entry) => !needle || `${entry.name} ${entry.key}`.toLowerCase().includes(needle));
  const counts = new Map<string, number>([[STAR_MARK, searched.filter((entry) => favorite(entry)).length]]);
  for (const entry of searched) counts.set(entry.maker, (counts.get(entry.maker) ?? 0) + 1);
  const filter = counts.get(maker) ? maker : "";
  const matched = filter === STAR_MARK ? searched.filter((entry) => favorite(entry))
    : filter ? searched.filter((entry) => entry.maker === filter)
      : searched;
  const weight = (entry: CatalogEntry) => modelEntryCurrent(entry, active, providers) ? -1 : favorite(entry) ? starred.indexOf(favorite(entry)) : starred.length;
  const shown = [...matched].sort((left, right) => weight(left) - weight(right)).slice(0, MODEL_MENU_LIMIT);
  const railRank = (id: string) => { const at = railOrder.indexOf(id); return at < 0 ? catalogMarks.findIndex(([mark]) => mark === id) + catalogMarks.length : at; };
  const marks = catalogMarks.filter(([id]) => listed.some((entry) => entry.maker === id)).sort((left, right) => railRank(left[0]) - railRank(right[0]));
  const dropMark = ({ active: from, over }: DragEndEvent) => {
    const ids: string[] = marks.map(([id]) => id);
    const at = ids.indexOf(String(from.id)), to = ids.indexOf(String(over?.id));
    if (at < 0 || to < 0 || at === to) return;
    const next = arrayMove(ids, at, to);
    localStorage.setItem(MAKER_ORDER_KEY, JSON.stringify(next));
    setRailOrder(next);
  };
  const dropStar = ({ active: from, over }: DragEndEvent) => {
    const at = starred.indexOf(String(from.id)), to = starred.indexOf(String(over?.id));
    if (at < 0 || to < 0 || at === to) return;
    onReorder?.(arrayMove([...starred], at, to));
  };
  return <>
    <nav className="model-rail" aria-label={`Filter ${label} by maker`}>
      {favorites && <>
        <button type="button" className="model-mark model-star" aria-pressed={filter === STAR_MARK} disabled={!counts.get(STAR_MARK)} title="Starred" aria-label="Starred models" onClick={() => setMaker(maker === STAR_MARK ? "" : STAR_MARK)}>★</button>
        <hr />
      </>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropMark}>
        <SortableContext items={marks.map(([id]) => id)} strategy={verticalListSortingStrategy}>
          {marks.map(([id, name]) => <Sortable key={id} id={id} className="model-mark-sort">{(handle) =>
            <button type="button" {...handle} className="model-mark" aria-pressed={filter === id} disabled={!counts.get(id)} title={name} aria-label={name} onClick={() => setMaker(id === maker ? "" : id)}>
              <BrandIcon brand={id === "local" ? localBrand : brandForProvider(id) ?? allBrand} className="model-brand" />
            </button>}
          </Sortable>)}
        </SortableContext>
      </DndContext>
    </nav>
    <div className="model-body">
      {strip}
      <div className="model-find">
        <input ref={search} className="model-search" value={query} aria-label={`Search ${label}`} placeholder="Search models…" onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="model-free-only" aria-pressed={freeOnly} title="Only the models the catalog lists as free" onClick={() => showFree(!freeOnly)}>Free only</button>
      </div>
      <div className="model-rows">
        {freeOnly && freeRouter && (!needle || `${freeRouter.name} ${freeRouter.key}`.toLowerCase().includes(needle)) && <ModelRow entry={freeRouter} active={active} providers={providers} busy={busy} onPick={onPick} codex={codex} />}
        {lead && <ModelRow entry={lead} active={active} providers={providers} busy={busy} onPick={onPick} codex={codex} />}
        {visibleRouters.filter((entry) => !needle || `${entry.name} ${entry.key}`.toLowerCase().includes(needle)).map((entry) =>
          <ModelRow key={entry.key} entry={entry} active={active} providers={providers} busy={busy} onPick={onPick} codex={codex} />)}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropStar}>
          <SortableContext items={shown.map(favorite).filter(Boolean)} strategy={verticalListSortingStrategy}>
            {shown.map((entry) => onReorder && favorite(entry)
              ? <Sortable key={entry.key} id={favorite(entry)} className="model-row-sort">{(handle) =>
                <ModelRow entry={entry} active={active} providers={providers} busy={busy} onPick={onPick} starred onStar={onStar && (() => onStar(favorite(entry)))} drag={handle} codex={codex} />}
              </Sortable>
              : <ModelRow key={entry.key} entry={entry} active={active} providers={providers} busy={busy} onPick={onPick} starred={!!favorite(entry)} onStar={onStar && (() => onStar(favorite(entry) || entry.key))} codex={codex} />)}
          </SortableContext>
        </DndContext>
        {!shown.length && <p className="model-menu-note">Nothing matches “{query}”.</p>}
        {matched.length > shown.length && <p className="model-menu-note">{matched.length - shown.length} more · search to narrow.</p>}
      </div>
      {children}
    </div>
  </>;
}

function ModelCatalog({ settings, onChange, act, busy, onConfigure }: { settings: UserSettings; onChange: (settings: UserSettings) => void | Promise<void>; act: (method: string, params?: Record<string, string>) => Promise<unknown>; busy: boolean; onConfigure: () => void }) {
  const [models, setModels] = useState<OpenRouterCatalog["models"]>([]);
  const [routes, setRoutes] = useState<OpenRouterCatalog["routes"]>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [maker, setMaker] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(CATALOG_PAGE);
  const [routerOpen, setRouterOpen] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const codexSlugs = useCodexSlugs(routes);
  const load = useCallback((force = false) => window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels", force ? { force: "1" } : {})
    .then((catalog) => { setModels(catalog.models); setRoutes(catalog.routes ?? {}); setError(catalog.error ?? catalog.metadataError ?? ""); setStatus(catalogStatus(catalog)); })
    .catch((reason: unknown) => setError(reasonText(reason)))
    .finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);
  const reload = () => { setLoading(true); setError(""); setStatus(""); void load(true); };
  const entries = useMemo(() => modelEntries(settings.providers, models, codexSlugs, routes, settings.selectedModel), [settings.providers, settings.selectedModel, models, codexSlugs, routes]);
  const needle = query.trim().toLowerCase();
  const searched = entries.filter((entry) => !needle || `${entry.name} ${entry.key}`.toLowerCase().includes(needle));
  const counts = new Map<string, number>();
  for (const entry of searched) counts.set(entry.maker, (counts.get(entry.maker) ?? 0) + 1);
  const filter = counts.has(maker) ? maker : "";
  const matched = filter ? searched.filter((entry) => entry.maker === filter) : searched;
  const favorite = (entry: CatalogEntry) => modelEntryFavorite(entry, settings.favoriteModels, settings.providers);
  const ordered = [...matched].sort((left, right) => (favorite(left) ? 0 : 1) - (favorite(right) ? 0 : 1));
  const shown = ordered.slice(0, limit);
  const narrow = (next: () => void) => { setLimit(CATALOG_PAGE); next(); };
  const star = (key: string) => {
    setError("");
    try { onChange(toggleFavoriteModel(settings, key)); }
    catch (reason) { setError(reasonText(reason)); }
  };
  const use = async (key: string, plan?: ModelPlan) => {
    setError("");
    setStatus("");
    try {
      const routed = plan ? modelPlanRoute(settings, plan, key) : { settings, key };
      if (routed.settings !== settings) await onChange(routed.settings);
      const next = await selectModelKey(routed.settings, routed.key, act);
      if (!next) return;
      await onChange(next);
      if (plan) setStatus(`${planModelId(plan, key)} now bills to ${plan.label}. Its key is in Models → Subscriptions.`);
    } catch (reason) { setError(reasonText(reason)); }
  };
  const saveRouters = (routers: ModelRouter[]) => {
    setError("");
    try {
      const next = validateSettings({ ...settings, routers });
      onChange(next);
      void act("setRouters", { routers: JSON.stringify(next.routers) });
    } catch (reason) { setError(reasonText(reason)); }
  };
  const editRouter = (id: string, patch: Partial<ModelRouter>) => saveRouters(settings.routers.map((item) => item.id === id ? { ...item, ...patch } : item));
  const rename = (id: string, value: string) => setNames((current) => ({ ...current, [id]: value }));
  const commitName = (item: ModelRouter) => { const value = names[item.id]?.trim(); if (value && value !== item.name) editRouter(item.id, { name: value }); };
  const addRouter = () => {
    const id = `r-${Date.now().toString(36)}`;
    saveRouters([...settings.routers, { id, name: `Router ${settings.routers.length + 1}`, models: [...FREE_ROUTER_MODELS] }]);
    setRouterOpen(id);
  };
  const dropRouter = async (id: string) => {
    setError("");
    try {
      const next = validateSettings(forgetRouter(settings, id));
      await onChange(next);
      if (await act("setRouters", { routers: JSON.stringify(next.routers) }) === undefined) return;
      if (next.selectedModel !== settings.selectedModel) await selectModelKey(next, next.selectedModel, act);
    } catch (reason) { setError(reasonText(reason)); }
  };
  const routers = settings.routers.filter((item) => !needle || `${item.name} ${item.models.join(" ")}`.toLowerCase().includes(needle));
  return <section className="model-catalog">
    <header><div><span>Model catalog</span><h3>Choose a model, star up to {MAX_FAVORITE_MODELS}</h3></div><strong>{settings.favoriteModels.length} / {MAX_FAVORITE_MODELS} starred</strong></header>
    <div className="catalog-search"><input type="search" value={query} aria-label="Search the model catalog" placeholder="Search models by name or ID" onChange={(event) => narrow(() => setQuery(event.target.value))} /></div>
    <div className="catalog-marks" role="group" aria-label="Filter the catalog by maker">
      <button type="button" className="catalog-mark" aria-pressed={!filter} onClick={() => narrow(() => setMaker(""))}>
        <BrandIcon brand={allBrand} className="provider-mark" />
        <span className="provider-mark-text"><strong>All models</strong><small>{searched.length}</small></span>
      </button>
      {catalogMarks.map(([id, name, region]) => {
        const count = counts.get(id) ?? 0;
        return <button type="button" key={id} className="catalog-mark" disabled={!count} aria-pressed={id === filter} aria-label={`${name} · ${count} ${plural(count, "model")}`} onClick={() => narrow(() => setMaker(id === filter ? "" : id))}>
          <BrandIcon brand={id === "local" ? localBrand : brandForProvider(id)} className="provider-mark" />
          <span className="provider-mark-text"><strong>{name}</strong><small>{region}</small></span>
        </button>;
      })}
    </div>
    {error && <p className="local-model-error" role="alert">{error}</p>}
    {status && <p className="local-model-status" role="status">{status}</p>}
    {!filter && <div className="router-list">
      {routers.map((item) => {
        const key = routerKey(item.id);
        const open = routerOpen === item.id;
        return <Fragment key={item.id}>
          <div className={`catalog-row router ${settings.selectedModel === key ? "selected" : ""}`}>
            <BrandIcon brand={routerBrand} className="model-brand" />
            <span>
              <span className="model-name">
                <input className="router-name" value={names[item.id] ?? item.name} maxLength={MAX_ROUTER_NAME} aria-label={`Rename ${item.name}`} onChange={(event) => rename(item.id, event.target.value)} onBlur={() => commitName(item)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                {priceBadge(allFree(item.models))}
              </span>
              <small>{routerEntry(item).detail}</small>
            </span>
            <button type="button" className="catalog-gear" aria-expanded={open} aria-label={`Edit ${item.name}`} title="Reorder, add or drop the models this router falls through" onClick={() => setRouterOpen(open ? "" : item.id)}><GearIcon /></button>
            <button type="button" className="catalog-drop" aria-label={`Delete ${item.name}`} title="Delete this router" onClick={() => void dropRouter(item.id)}>✕</button>
            <button type="button" className="catalog-use" disabled={busy || settings.selectedModel === key} onClick={() => void use(key)}>{settings.selectedModel === key ? "Active" : "Use"}</button>
          </div>
          {open && <RouterEditor chain={item.models} catalog={models} onChange={(chain) => editRouter(item.id, { models: chain })} />}
        </Fragment>;
      })}
      {settings.routers.length < MAX_ROUTERS && !needle && <button type="button" className="load-models" onClick={addRouter}>Add a router · {settings.routers.length} / {MAX_ROUTERS}</button>}
    </div>}
    <div className="model-list">{shown.map((entry) => {
      const favoriteKey = favorite(entry);
      const starred = !!favoriteKey;
      const active = modelEntryCurrent(entry, settings.selectedModel, settings.providers);
      const route = modelEntryRoute(entry, settings.selectedModel, settings.providers, codexSlugs);
      return <Fragment key={entry.key}>
        <div className={`catalog-row ${active ? "selected" : ""}`}>
          <BrandIcon brand={entry.brand} className="model-brand" />
          <span><span className="model-name"><strong>{entry.name}</strong>{entry.free === undefined ? null : priceBadge(entry.free)}{modalityMarks(entry.modalities)}</span><small>{entry.detail}</small></span>
          <button type="button" className="catalog-star" aria-pressed={starred} aria-label={`${starred ? "Unstar" : "Star"} ${entry.name}`} title={starred ? "Remove from the model picker" : "Show in the model picker"} onClick={() => star(favoriteKey || entry.key)}>{starred ? "★" : "☆"}</button>
          <button type="button" className="catalog-use" disabled={busy || active} onClick={() => void use(route.key, route.plan)}>{active ? "Active" : "Use"}</button>
        </div>
        <ModelProviderPicker entry={entry} active={settings.selectedModel} providers={settings.providers} busy={busy} onPick={(key, plan) => void use(key, plan)} codexSlugs={codexSlugs} />
      </Fragment>;
    })}</div>
    {!matched.length && !loading && <p className="local-model-empty">{needle ? `Nothing matches “${query}”.` : "No models under this maker."}</p>}
    {filter === "local" && <button type="button" className="load-models catalog-setup" onClick={onConfigure}>Set up a local model</button>}
    {matched.length > limit && <button type="button" className="load-models" onClick={() => setLimit(limit + CATALOG_PAGE)}>Show {Math.min(CATALOG_PAGE, matched.length - limit)} more · {matched.length - limit} left</button>}
    <button type="button" className="load-models" disabled={loading} onClick={reload}>{loading ? "Loading model catalogs…" : "Reload model catalogs"}</button>
  </section>;
}

function RouterEditor({ chain, catalog, onChange }: { chain: string[]; catalog: OpenRouterCatalog["models"]; onChange: (models: string[]) => void }) {
  const [pick, setPick] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const nameOf = (id: string) => catalog.find((model) => model.id === id)?.name ?? id;
  const free = catalog.filter((model) => !chain.includes(model.id));
  const chosen = free.find((model) => model.id === pick.trim());
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!chosen) return;
    onChange([...chain, chosen.id]);
    setPick("");
  };
  const drop = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = chain.indexOf(String(active.id));
    const to = chain.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(chain, from, to));
  };
  return <div className="router-editor">
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drop}>
      <SortableContext items={chain} strategy={verticalListSortingStrategy}>
        {chain.map((id, at) => <Sortable key={id} id={id} className="router-line">{(handle) => <>
          <button type="button" className="router-grip" {...handle} aria-label={`Reorder ${nameOf(id)}`} title="Drag to reorder"><DotsIcon /></button>
          <b>{at + 1}</b>
          <span><strong>{nameOf(id)}</strong><small>{id}</small></span>
          <button type="button" className="router-drop" disabled={chain.length < 2} aria-label={`Remove ${nameOf(id)}`} onClick={() => onChange(chain.filter((item) => item !== id))}>✕</button>
        </>}</Sortable>)}
      </SortableContext>
    </DndContext>
    <form className="router-add" onSubmit={add}>
      <input list="router-choices" value={pick} placeholder="Add a model by ID…" aria-label="Add a model to the router" onChange={(event) => setPick(event.target.value)} />
      <datalist id="router-choices">{free.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
      <button type="submit" disabled={!chosen}>Add</button>
      <button type="button" onClick={() => onChange([...FREE_ROUTER_MODELS])} disabled={chain.join() === FREE_ROUTER_MODELS.join()}>Reset</button>
    </form>
  </div>;
}

const emptyDraft = { name: "", modelId: "", baseUrl: "", credentialEnv: "", contextWindow: "", insecure: false };

const reachLabel: Record<string, string> = { "this-mac": `On this ${LOCAL_DEVICE}`, network: "Your network", internet: "Over the internet" };

function ProviderSettings({ settings, onChange, act, busy }: { settings: UserSettings; onChange: (settings: UserSettings) => void | Promise<void>; act: (method: string, params?: Record<string, string>) => Promise<unknown>; busy: boolean }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [probe, setProbe] = useState<{ models: string[]; tools: boolean; error: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const update = (field: keyof typeof draft, value: string | boolean) => { setDraft((current) => ({ ...current, [field]: value })); setProbe(null); };
  const reach = providerReach(draft.baseUrl);
  const preset = (item: (typeof PROVIDER_PRESETS)[number]) => {
    setError("");
    setProbe(null);
    setDraft({ ...emptyDraft, name: item.name, baseUrl: item.baseUrl, credentialEnv: item.credentialEnv });
  };
  const test = async () => {
    setError("");
    setStatus("");
    setTesting(true);
    try { setProbe(await window.shinbo.testProvider({ baseUrl: draft.baseUrl, credentialEnv: draft.credentialEnv, modelId: draft.modelId, insecure: draft.insecure })); }
    catch (reason) { setError(reasonText(reason)); }
    finally { setTesting(false); }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const profile: ProviderProfile = { id: `p-${Date.now().toString(36)}`, name: draft.name, modelId: draft.modelId, baseUrl: draft.baseUrl, credentialEnv: draft.credentialEnv, contextWindow: Number(draft.contextWindow) || 0, insecure: draft.insecure };
      const next = validateSettings({ ...settings, providers: [...settings.providers, profile] });
      await onChange(next);
      setDraft(emptyDraft);
      setProbe(null);
      setStatus(`${profile.name} added. Choose Use to route the next turn.`);
    } catch (reason) { setError(reasonText(reason)); }
    finally { setSaving(false); }
  };
  const select = async (profile: ProviderProfile) => {
    setError("");
    if (await act("selectProviderModel", { providerId: profile.id, effort: settings.thinkingLevel }) === undefined) return;
    try {
      await onChange({ ...settings, selectedModel: `provider:${profile.id}` });
      setStatus(`${profile.name} answers the next turn.`);
    } catch (reason) { setError(reasonText(reason)); }
  };
  const remove = async (profile: ProviderProfile) => {
    if (!canRemoveProvider(settings, profile.id)) return;
    setError("");
    setStatus("");
    setSaving(true);
    try { await onChange(forgetProvider(settings, profile.id)); }
    catch (reason) { setError(reasonText(reason)); }
    finally { setSaving(false); }
  };
  return <section className="local-model-settings" id="local-models">
    <header>
      <div><span>Providers</span><h3>Any OpenAI-compatible endpoint</h3></div>
      <strong>{settings.providers.length} saved</strong>
    </header>
    <SettingsSection title="Add provider" summary="Local or hosted endpoint">
    <div className="provider-presets">{PROVIDER_PRESETS.map((item) => <button type="button" key={item.id} disabled={busy || saving} title={item.detail} onClick={() => preset(item)}>{item.name || "Custom"}</button>)}</div>
    <form className="local-model-form" onSubmit={add}>
      <label>Name<input required maxLength={64} value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder={IS_WINDOWS ? "Windows PC" : "Mac Studio"} /></label>
      <label>Base URL<input required maxLength={2048} value={draft.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} placeholder="http://127.0.0.1:1234/v1" /></label>
      <label>Model ID<input required maxLength={128} list="provider-model-ids" value={draft.modelId} onChange={(event) => update("modelId", event.target.value)} placeholder="qwen3-8b" /></label>
      <datalist id="provider-model-ids">{(probe?.models ?? []).map((id) => <option key={id} value={id} />)}</datalist>
      <label>Key env<input maxLength={64} value={draft.credentialEnv} onChange={(event) => update("credentialEnv", event.target.value)} placeholder="Optional · DEEPSEEK_API_KEY" /></label>
      <label>Context window<input inputMode="numeric" maxLength={9} value={draft.contextWindow} onChange={(event) => update("contextWindow", event.target.value.replace(/\D/g, ""))} placeholder="Optional · 131072" /></label>
      {reach === "network" && <label className="check"><input type="checkbox" checked={draft.insecure} onChange={(event) => update("insecure", event.target.checked)} /> Send prompts and the key unencrypted over my network</label>}
      <button type="button" disabled={busy || saving || testing || !draft.baseUrl} onClick={() => void test()}>{testing ? "Testing…" : "Test"}</button>
      <button disabled={busy || saving}>Add provider</button>
    </form>
    {probe && <p className="local-model-status" role="status">
      <span className={probe.models.length ? "provider-dot on" : "provider-dot"} /> {probe.models.length ? `${probe.models.length} models` : "No model list"}
      {" · "}
      <span className={probe.tools ? "provider-dot on" : "provider-dot"} /> {probe.tools ? "Tool calls" : draft.modelId ? "No tool calls — Shinbo needs them every turn" : "Fill in a model id to check tool calls"}
      {probe.error && ` · ${probe.error}`}
    </p>}
    {(error || status) && <p className={error ? "local-model-error" : "local-model-status"} role="status">{error || status}</p>}
    </SettingsSection>
    <div className="local-model-list">
      {settings.providers.map((profile) => <div className={`local-model-row ${settings.selectedModel === `provider:${profile.id}` ? "selected" : ""}`} key={profile.id}>
        <div>
          <BrandIcon brand={brandForModel(profile.modelId, "local")} className="local-model-brand" />
          <div>
            <strong>{profile.name}</strong>
            <span>{profile.modelId} · {profile.baseUrl}</span>
            <small>{reachLabel[providerReach(profile.baseUrl)] ?? "Unreachable"} · {profile.credentialEnv || "No key"}</small>
          </div>
        </div>
        <div>
          <button type="button" disabled={busy || saving} onClick={() => void select(profile)}>{settings.selectedModel === `provider:${profile.id}` ? "Active" : "Use"}</button>
          <button type="button" disabled={busy || saving || !canRemoveProvider(settings, profile.id)} title={settings.selectedModel === `provider:${profile.id}` ? "Select another model before removing the active provider" : "Remove provider"} onClick={() => void remove(profile)}>Remove</button>
        </div>
      </div>)}
      {!settings.providers.length && <p className="local-model-empty">No providers yet.</p>}
    </div>
  </section>;
}

const seesImages = (model: OpenRouterCatalog["models"][number]) => model.inputModalities?.includes("image") ?? false;

function PromptEditor({ value, onChange, busy, rows }: { value: string; onChange: (value: string) => void; busy: boolean; rows: number }) {
  const mirror = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const timer = useRef(0);
  if (value !== seen) { setSeen(value); setDraft(value); }
  const commit = (next: string) => { clearTimeout(timer.current); timer.current = 0; if (next !== value) onChange(next); };
  const edit = (next: string) => { setDraft(next); clearTimeout(timer.current); timer.current = window.setTimeout(() => commit(next), 300); };
  const insert = (name: string) => {
    const node = input.current;
    if (!node) return;
    const start = node.selectionStart ?? draft.length;
    const caret = start + name.length + 2;
    edit(`${draft.slice(0, start)}{${name}}${draft.slice(node.selectionEnd ?? start)}`.slice(0, MAX_SYSTEM_PROMPT_CHARS));
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(caret, caret); });
  };
  return <div className="prompt-editor">
    <div className="prompt-canvas">
      <div className="prompt-highlight" ref={mirror} aria-hidden="true">{promptSegments(draft).map((segment, index) => <span key={index} className={segment.hue === undefined ? segment.unknown ? "prompt-token prompt-token-unknown" : undefined : "prompt-token"} data-hue={segment.hue}>{segment.text}</span>)}{"\n"}</div>
      <textarea ref={input} value={draft} disabled={busy} spellCheck={false} rows={rows} maxLength={MAX_SYSTEM_PROMPT_CHARS} aria-label="Prompt text"
        onScroll={(event) => { if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop; }}
        onChange={(event) => edit(event.target.value)} onBlur={() => commit(draft)} />
    </div>
    <details className="prompt-variable-picker"><summary>Insert a variable</summary><div className="prompt-variables">{PROMPT_VARIABLES.map((variable, index) => <button type="button" key={variable.name} className="prompt-token" data-hue={index % 6} disabled={busy} title={variable.detail} onClick={() => insert(variable.name)}>{`{${variable.name}}`}</button>)}</div></details>
  </div>;
}

function ScopePicker({ settings, entries, scope, onChange, busy }: { settings: UserSettings; entries: CatalogEntry[]; scope: string; onChange: (scope: string, settings?: UserSettings) => void; busy: boolean }) {
  const [picking, setPicking] = useState(false);
  const modelKey = scope.startsWith("model:") ? scope.slice("model:".length) : "";
  const family = scope.startsWith("family:") ? scope.slice("family:".length) : "";
  return <div className="scope-picker">
    <div className="scope-marks">
      <button type="button" className="scope-mark" aria-pressed={!scope} disabled={busy} onClick={() => { onChange(""); setPicking(false); }}><BrandIcon brand={allBrand} className="model-brand" /><span>Every model</span></button>
      {MODEL_FAMILIES.map((entry) => <button type="button" key={entry.id} className="scope-mark" aria-pressed={family === entry.id} disabled={busy} title={`Only ${entry.label} models`} onClick={() => { onChange(`family:${entry.id}`); setPicking(false); }}>
        <BrandIcon brand={brandForProvider(entry.brand) ?? allBrand} className="model-brand" /><span>{entry.label}</span>
      </button>)}
      <button type="button" className="scope-mark" aria-pressed={!!modelKey} aria-expanded={picking} disabled={busy} onClick={() => setPicking(!picking)}>
        <BrandIcon brand={modelKey ? modelKeyBrand(settings, modelKey) ?? allBrand : allBrand} className="model-brand" /><span>{modelKey ? modelKeyLabel(settings, modelKey) : "One model…"}</span>
      </button>
    </div>
    {picking && <div className="scope-models model-menu"><ModelPicker entries={entries} active={modelKey} label="the model this prompt is pinned to" busy={busy} providers={settings.providers} onPick={(key, plan) => { const routed = plan ? modelPlanRoute(settings, plan, key) : { settings, key }; onChange(`model:${routed.key}`, routed.settings); setPicking(false); }} /></div>}
  </div>;
}

function PromptSettings({ settings, onChange, busy }: { settings: UserSettings; onChange: (settings: UserSettings) => void; busy: boolean }) {
  const [models, setModels] = useState<OpenRouterCatalog["models"]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels").then((catalog) => setModels(catalog.models)).catch(() => setModels([])); }, []);
  const entries = useMemo(() => modelEntries(settings.providers, models), [settings.providers, models]);
  const apply = (next: Partial<UserSettings>, current = settings) => {
    setError("");
    try { onChange({ ...current, ...next }); }
    catch (reason) { setError(reasonText(reason)); }
  };
  const write = (id: string, patch: Partial<PromptPreset>, current = settings) => apply({ prompts: current.prompts.map((preset) => preset.id === id ? { ...preset, ...patch } : preset) }, current);
  const add = (preset: PromptPreset) => {
    if (settings.prompts.length >= MAX_PROMPTS) { setError(`Keep at most ${MAX_PROMPTS} prompts.`); return; }
    apply({ prompts: [...settings.prompts, preset] });
  };
  return <div className="coding-prompts">
    <section className="prompt-card prompt-global">
      <header>
        <div><h3>Global prompt</h3><p>Your instructions for every model and every turn. Shinbo adds its tool contracts automatically.</p></div>
        <div className="prompt-card-actions">
          <button type="button" disabled={busy} onClick={() => add({ id: newPresetId(), name: "Forked from global", body: settings.systemPrompt, scope: "", enabled: false })}>Fork</button>
          <button type="button" disabled={busy || settings.systemPrompt === DEFAULT_SYSTEM_PROMPT} onClick={() => apply({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}>Reset to default</button>
        </div>
      </header>
      <PromptEditor value={settings.systemPrompt} busy={busy} rows={9} onChange={(systemPrompt) => apply({ systemPrompt })} />
      <footer><small>{settings.systemPrompt.length} / {MAX_SYSTEM_PROMPT_CHARS} characters</small></footer>
    </section>
    <div className="coding-section-heading"><div><h3>Conditional prompts</h3><p>Extra instructions for a model or family. Applied after the global prompt.</p></div><small>{settings.prompts.length} / {MAX_PROMPTS}</small></div>
    {settings.prompts.map((preset) => <SettingsSection key={preset.id} title={preset.name} summary={preset.enabled ? promptApplies(preset, settings.selectedModel) ? "Active for this model" : "Enabled" : "Off"}><section className={`prompt-card ${promptApplies(preset, settings.selectedModel) ? "prompt-live" : ""}`}>
      <header>
        <div className="prompt-name">
          <label className="check"><input type="checkbox" checked={preset.enabled} disabled={busy} onChange={(event) => write(preset.id, { enabled: event.target.checked })} /> On</label>
          <input key={preset.name} defaultValue={preset.name} maxLength={MAX_PROMPT_NAME_CHARS} disabled={busy} aria-label="Prompt name" onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== preset.name) write(preset.id, { name }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          {promptApplies(preset, settings.selectedModel) && <strong className="status-live"><i /> Applies to {modelKeyLabel(settings, settings.selectedModel)}</strong>}
        </div>
        <div className="prompt-card-actions">
          <button type="button" disabled={busy} onClick={() => add(forkPreset(preset, newPresetId()))}>Fork</button>
          <button type="button" disabled={busy} onClick={() => apply({ prompts: settings.prompts.filter((item) => item.id !== preset.id) })}>Delete</button>
        </div>
      </header>
      <ScopePicker settings={settings} entries={entries} scope={preset.scope} busy={busy} onChange={(scope, current) => write(preset.id, { scope }, current)} />
      <PromptEditor value={preset.body} busy={busy} rows={7} onChange={(body) => write(preset.id, { body })} />
      <footer><small>{preset.body.length} / {MAX_SYSTEM_PROMPT_CHARS} characters · read after the global one, so it wins where the two disagree</small></footer>
    </section></SettingsSection>)}
    <div className="prompt-add">
      <button type="button" disabled={busy || settings.prompts.length >= MAX_PROMPTS} onClick={() => add({ id: newPresetId(), name: "New prompt", body: "", scope: "", enabled: true })}>Add a conditional prompt</button>
      {!settings.prompts.length && <small>No conditional prompts yet.</small>}
    </div>
    {error && <p className="local-model-error" role="status">{error}</p>}
  </div>;
}

function secondModelView(draft: VerifierSettings, providers: ProviderProfile[], routers: ModelRouter[], catalog: OpenRouterCatalog["models"], accepts?: (model: OpenRouterCatalog["models"][number]) => boolean) {
  const directPlan = MODEL_PLANS.find((plan) => draft.endpoint === providerChatUrl(plan) && draft.credentialEnv === plan.credentialEnv);
  const directRoute = directPlan ? modelPlanRoute({ ...defaultSettings, providers }, directPlan, `openrouter:${directPlan.namespace}/${draft.model}`) : undefined;
  const pickerProviders = directRoute?.settings.providers ?? providers;
  const natural = verifierKey(draft, pickerProviders, routers);
  const listed = accepts ? catalog.filter(accepts) : catalog;
  const key = `openrouter:${draft.model}`;
  const [first, ...rest] = draft.model.split(",");
  const brand = brandForModel(first, "openrouter");
  const saved: CatalogEntry[] = natural === key && !listed.some((model) => `openrouter:${model.id}` === key)
    ? [{ maker: brand?.id ?? "other", key, name: first, detail: rest.length ? `Saved \u00b7 ${rest.length} ${plural(rest.length, "fallback")} after it` : "Saved", brand }]
    : [];
  const entries = [...saved, ...modelEntries(pickerProviders, listed).filter((entry) => entry.key !== "fallback")];
  return { natural, pickerProviders, entries };
}

function secondModelFromPick(key: string, plan: ModelPlan | undefined, providers: ProviderProfile[], system: string, routers: ModelRouter[]): VerifierSettings {
  const base = { ...defaultSettings, providers };
  const routed = plan ? modelPlanRoute(base, plan, key) : { settings: base, key };
  return verifierFromKey(routed.key, routed.settings.providers, system, routers);
}

function secondModelLabel(settings: UserSettings, id: SecondModelId): string {
  const draft = SECOND_MODELS[id].read(settings);
  if (!draft.model) return "Off";
  const key = verifierKey(draft, settings.providers, settings.routers);
  if (key === "custom") return draft.model.split(",")[0];
  return modelKeyLabel(settings, key.startsWith("openrouter:") ? `openrouter:${draft.model.split(",")[0]}` : key);
}

function SecondModelPicker({ label, off, draft, providers, routers, onChange, busy, accepts }: {
  label: string;
  off: string;
  draft: VerifierSettings;
  providers: ProviderProfile[];
  routers: ModelRouter[];
  onChange: (next: VerifierSettings) => void;
  busy?: boolean;
  accepts?: (model: OpenRouterCatalog["models"][number]) => boolean;
}) {
  const [catalog, setCatalog] = useState<OpenRouterCatalog["models"]>([]);
  useEffect(() => { void window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels").then((loaded) => setCatalog(loaded.models)).catch(() => undefined); }, []);
  const [forced, setForced] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { natural, pickerProviders, entries } = useMemo(() => secondModelView(draft, providers, routers, catalog, accepts), [draft, providers, routers, catalog, accepts]);
  const picked = forced ? "custom" : natural;
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const chosen = routers.map(routerEntry).find((row) => row.key === picked) ?? entries.find((row) => modelEntryCurrent(row, picked, pickerProviders));
  const pick = (key: string, plan?: ModelPlan) => {
    setForced(key === "custom");
    setOpen(false);
    if (key !== "custom") {
      onChange(secondModelFromPick(key, plan, pickerProviders, draft.system, routers));
    }
  };
  return <>
    <div className="verifier-pick" ref={box}>
      <span className="verifier-pick-label">{label}</span>
      <button type="button" className="verifier-pick-trigger" disabled={busy} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <BrandIcon brand={picked === "custom" ? undefined : chosen?.brand} className="model-brand" />
        <span>{picked === "custom" ? draft.model || "Custom endpoint" : chosen?.name ?? (draft.model || off)}</span>
        <b aria-hidden="true">▾</b>
      </button>
      {open && <section className="source-popover model-menu" role="dialog" aria-label={label} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
        <ModelPicker label={label} entries={entries} active={picked} busy={busy} providers={pickerProviders} routers={routers} onPick={pick} codex={false} lead={{ key: "", name: off, detail: "Off", brand: shinboBrand }}>
          <div className="model-menu-foot"><button type="button" className="model-menu-row quiet" aria-current={picked === "custom"} onClick={() => pick("custom")}><span>Custom endpoint…</span><b aria-hidden="true">↗</b></button></div>
        </ModelPicker>
      </section>}
    </div>
    {picked === "custom" && <>
      <label>Model ID<input maxLength={128} value={draft.model} disabled={busy} onChange={(event) => onChange({ ...draft, model: event.target.value })} placeholder="vendor/model-id" /></label>
      <label>Endpoint<input required maxLength={2048} value={draft.endpoint} disabled={busy} onChange={(event) => onChange({ ...draft, endpoint: event.target.value })} placeholder={OPENROUTER_CHAT_ENDPOINT} /></label>
      <label>Credential env<input maxLength={128} value={draft.credentialEnv} disabled={busy} onChange={(event) => onChange({ ...draft, credentialEnv: event.target.value })} placeholder="OPENROUTER_API_KEY" /></label>
      <button type="button" className="verifier-custom" disabled={busy} onClick={() => pick(natural)}>Back to the picker</button>
    </>}
  </>;
}

function VerifierPanel({ settings, onSave, busy }: { settings: UserSettings; onSave: (verifier: VerifierSettings) => Promise<void>; busy: boolean }) {
  const [draft, setDraft] = useState(settings.verifier);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const update = (field: keyof VerifierSettings, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError("");
    setStatus("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    void onSave(draft)
      .then(() => setStatus(draft.model ? `${draft.model} reviews every gated call in Auto mode.` : "No verifier: Auto mode asks you, exactly like Ask."))
      .catch((reason: unknown) => setError(reasonText(reason)));
  };
  return <section className="local-model-settings">
    <header><div><div className="settings-head"><h3>Verifier · clears a call in Auto</h3><InfoDot>In <b>Auto</b>, anything that would stop and ask goes to this model first with what you asked for and the exact command about to run. Anything on the prohibited list is blocked before the model is asked. It answers allow or block; a call it will not clear, or a reply Shinbo cannot read, still comes to you with the reason.</InfoDot></div><p>A small, cheap second model that allows or blocks each gated call. Leave it off and Auto asks you.</p></div><strong>{settings.verifier.model ? "Configured" : "Off"}</strong></header>
    <form className="local-model-form" onSubmit={submit}>
      <SecondModelPicker label="Verifier model" off={SECOND_MODELS.verifier.off} draft={draft} providers={settings.providers} routers={settings.routers} busy={busy} onChange={(next) => { setDraft(next); setError(""); setStatus(""); }} />
      {draft.model && <SettingsSection title="Custom instructions" summary="Optional">
      <label className="verifier-rules">Rules it judges by<textarea rows={10} maxLength={MAX_VERIFIER_SYSTEM_CHARS} value={draft.system} onChange={(event) => update("system", event.target.value)} /></label>
      <div className="verifier-rules prompt-footer"><small>{draft.system.length} / {MAX_VERIFIER_SYSTEM_CHARS} characters · the request and the command are appended below this</small><button type="button" onClick={() => update("system", defaultVerifierSystem)}>Reset to default</button></div>
      </SettingsSection>}
      <button disabled={busy}>Save verifier</button>
    </form>
    {(error || status) && <p className={error ? "local-model-error" : "local-model-status"} role="status">{error || status}</p>}
  </section>;
}

type CredentialSlot = { env: string; label: string; detail: string; hint: string; brand?: BrandDefinition };

function credentialSlots(settings: UserSettings, stored: CredentialSummary[]): CredentialSlot[] {
  const slots = new Map<string, CredentialSlot>();
  for (const item of providerCredentials) slots.set(item.env, { env: item.env, label: item.label, detail: item.detail, hint: item.hint, brand: brandForProvider(item.providerId) });
  for (const profile of settings.providers) {
    if (!profile.credentialEnv || slots.has(profile.credentialEnv)) continue;
    slots.set(profile.credentialEnv, { env: profile.credentialEnv, label: profile.name, detail: `${profile.modelId} · ${profile.baseUrl}`, hint: "Provider key", brand: brandForModel(profile.modelId, "local") });
  }
  for (const source of settings.tools.webSearch.providers) {
    if (!source.credentialEnv || slots.has(source.credentialEnv)) continue;
    const provider = webSearchProvider(source.provider);
    slots.set(source.credentialEnv, { env: source.credentialEnv, label: provider.label, detail: `Web search · ${provider.detail}`, hint: "Search API key", brand: brandForProvider(source.provider) });
  }
  for (const item of stored) if (!slots.has(item.env)) slots.set(item.env, { env: item.env, label: item.env, detail: "Custom environment variable", hint: "Key", brand: brandForProvider(item.env.split("_")[0]) });
  return [...slots.values()];
}

function ProviderKeys({ settings, act, busy }: { settings: UserSettings; act: (method: string, params?: Record<string, string>) => Promise<unknown>; busy: boolean }) {
  const [stored, setStored] = useState<CredentialSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [balance, setBalance] = useState<KeyBalance | null>(null);
  const fail = (reason: unknown) => setError(reasonText(reason));
  const readBalance = () => void window.shinbo.openRouterBalance().then(setBalance).catch(() => undefined);
  useEffect(() => { void window.shinbo.listCredentials().then(setStored).catch(fail); readBalance(); }, []);
  const slots = credentialSlots(settings, stored);
  const lost = stored.filter((item) => !item.readable);
  const draft = (env: string) => (drafts[env] ?? "").trim();
  const save = async (env: string, secret?: string) => {
    setError("");
    setStatus("");
    try {
      setStored(await window.shinbo.saveCredential(secret === undefined ? { env } : { env, secret }));
      setDrafts((current) => ({ ...current, [env]: "" }));
      if (env === OPENROUTER_ENV) readBalance();
      const restarted = await selectModelKey(settings, settings.selectedModel, act);
      setStatus(`${env} ${secret === undefined ? "removed" : "saved"}. ${restarted ? `The agent restarted ${secret === undefined ? "without" : "with"} it.` : "Restart the agent to pick that up."}`);
    } catch (reason) { fail(reason); }
  };
  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    const env = custom.trim().toUpperCase();
    if (!isEnvName(env)) { setError("An environment variable name must start with a letter or underscore and hold only letters, digits, and underscores."); return; }
    setDrafts((current) => ({ ...current, [env]: current[env] ?? "" }));
    setStored((current) => current.some((item) => item.env === env) ? current : [...current, { env, masked: "", readable: true }]);
    setCustom("");
  };
  return <section className="provider-keys">
    <header><div><span>API keys</span><h3>Keys stay in the secure store</h3><p>A key reaches the agent only through its process environment. Changing one restarts the local agent, so save it between turns.</p></div><strong>{stored.filter((item) => item.masked).length} stored</strong></header>
    {lost.length > 0 && <p className="local-model-error" role="alert">{lost.length === 1 ? `${unreadableKeyNotice(slots.find((slot) => slot.env === lost[0].env)?.label ?? lost[0].env, RUNTIME_PLATFORM)} Shinbo kept it on disk and replaces it the moment you save a new one.` : `${lost.length} saved keys could not be read on this ${LOCAL_DEVICE}. Paste each one again. Shinbo kept them on disk and replaces each one the moment you save it.`}</p>}
    {(error || status) && <p className={error ? "local-model-error" : "local-model-status"} role="status">{error || status}</p>}
    <div className="provider-key-list">{slots.map((slot) => {
      const saved = stored.find((item) => item.env === slot.env && item.masked);
      const unreadable = stored.some((item) => item.env === slot.env && !item.readable);
      const value = unreadable ? "Could not be read" : saved ? saved.masked : "Not set";
      return <SettingsSection key={slot.env} title={slot.label} summary={value}><div className={`provider-key-row ${saved ? "set" : ""} ${unreadable ? "unreadable" : ""}`}>
        <BrandIcon brand={slot.brand} className="provider-mark" />
        <div><strong>{slot.label}</strong><small>{slot.detail}</small><code>{slot.env}</code>
          {unreadable && <em className="provider-key-lost" role="alert">{unreadableKeyNotice(slot.label, RUNTIME_PLATFORM)}</em>}
          {slot.env === OPENROUTER_ENV && saved && <em className={`provider-key-balance ${outOfCredit(balance) || balance?.error ? "warn" : ""}`}>{balanceLine(balance)}{outOfCredit(balance) || balance?.freeTier ? <a href={OPENROUTER_CREDITS_URL} target="_blank" rel="noreferrer">Add credit ↗</a> : null}</em>}
        </div>
        <span className="provider-key-value">{value}</span>
        <label><span className="sr-only">{slot.label} API key</span><input type="password" autoComplete="off" spellCheck={false} maxLength={MAX_SECRET_CHARS} disabled={busy} value={drafts[slot.env] ?? ""} placeholder={unreadable ? "Paste it again" : saved ? "Paste a replacement" : slot.hint} onChange={(event) => setDrafts((current) => ({ ...current, [slot.env]: event.target.value }))} /></label>
        <button type="button" disabled={busy || !draft(slot.env)} onClick={() => void save(slot.env, draft(slot.env))}>Save</button>
        <button type="button" disabled={busy || (!saved && !unreadable)} onClick={() => void save(slot.env)}>Remove</button>
      </div></SettingsSection>;
    })}</div>
    <form className="provider-key-add" onSubmit={addCustom}><label>Another environment variable<input value={custom} maxLength={64} disabled={busy} placeholder="TOGETHER_API_KEY" onChange={(event) => setCustom(event.target.value)} /></label><button disabled={busy || !custom.trim()}>Add slot</button></form>
  </section>;
}

function ToolSettingsPanel({ settings, onChange, onDefaultMode, busy }: { settings: UserSettings; onChange: (tools: ToolSettings) => Promise<void>; onDefaultMode: (mode: PermissionMode) => void; busy: boolean }) {
  const tools = settings.tools;
  const [targets, setTargets] = useState<{ written: ToolTarget[]; skills: ImportedSkill[]; servers: ImportedMcpServer[] }>({ written: [], skills: [], servers: [] });
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => void window.shinbo.listToolTargets().then(setTargets).catch(() => undefined);
    load();
    return window.shinbo.onToolsChanged(load);
  }, []);
  const save = (next: ToolSettings) => { setError(""); void onChange(next).catch((reason: unknown) => setError(reasonText(reason))); };
  const toggle = (field: "disabledTools" | "disabledSkills" | "disabledServers", id: string, on: boolean) =>
    save({ ...tools, [field]: on ? tools[field].filter((item) => item !== id) : [...new Set([...tools[field], id])] });
  const groups = [...new Set(TOOL_CATALOG.map((tool) => tool.group))];
  const off = TOOL_CATALOG.filter((tool) => tools.disabledTools.includes(tool.name)).length;
  const rows = (field: "disabledTools" | "disabledSkills" | "disabledServers", items: { id: string; name: string; source: string }[], empty: string) =>
    items.length
      ? items.map((item) => <label className="check tool-row" key={item.id}><input type="checkbox" checked={!tools[field].includes(item.id)} disabled={busy} onChange={(event) => toggle(field, item.id, event.target.checked)} /><div><strong>{item.name}</strong><span>{item.source}</span></div></label>)
      : <p className="tool-empty">{empty}</p>;
  return <div className="tool-settings coding-tools">
    <section className="local-model-settings default-mode">
      <header><div><div className="settings-head"><h3>New threads</h3><InfoDot>The rung a thread's picker opens on. Change it in the composer and that thread keeps its own from then on; this only decides where a fresh one starts. Quick Ask starts here too, until you change it {IS_WINDOWS ? "there" : "in the island"}.</InfoDot></div><p>Choose the permission mode new threads and Quick Ask start with.</p></div><ModePicker mode={settings.defaultPermissionMode} setMode={onDefaultMode} disabled={busy} /></header>
    </section>
    <section className="local-model-settings coding-tool-catalog">
      <header><div><div className="settings-head"><h3>Built-in tools</h3><InfoDot>Permission modes still apply on top of this: <b>Plan</b> already hides everything that changes anything. The two tools that call a model of their own — <b>Advisor</b> and <b>Vision</b> — pick it in <b>Settings → Models</b>.</InfoDot></div><p>Only enabled tools are offered to the model. Permission modes still apply.</p></div><strong>{off ? `${off} off` : "All on"}</strong></header>
      {groups.map((group) => <SettingsSection key={group} title={group} open={group === groups[0]} summary={`${TOOL_CATALOG.filter((tool) => tool.group === group && !tools.disabledTools.includes(tool.name)).length} enabled`}><div className="coding-tool-options">{TOOL_CATALOG.filter((tool) => tool.group === group).map((tool) => <label className="check tool-row" key={tool.name}><input type="checkbox" checked={!tools.disabledTools.includes(tool.name)} disabled={busy} onChange={(event) => toggle("disabledTools", tool.name, event.target.checked)} /><div><strong>{tool.label}</strong><span>{tool.blurb}</span></div></label>)}</div></SettingsSection>)}
    </section>
    <div hidden={tools.disabledTools.includes("web_search")}><SettingsSection title="Web search providers" summary={tools.disabledTools.includes("web_search") ? "Tool off" : `${tools.webSearch.providers.length} ranked`}><WebSearchPanel search={tools.webSearch} disabled={tools.disabledTools.includes("web_search")} onChange={(webSearch) => save({ ...tools, webSearch })} busy={busy} /></SettingsSection></div>
    <div className="coding-section-heading"><div><h3>Added to Shinbo</h3><p>Manage tools, skills, and servers already installed.</p></div></div>
    <SettingsSection title="Shinbo’s tools" summary={`${targets.written.length} tools`}><section className="local-model-settings">
      <p>Switching a tool off leaves its script on disk and hides it from <b>run_tool</b>.</p>
      <div className="tool-group">{rows("disabledTools", targets.written, "Shinbo has not written any tools yet.")}</div>
    </section></SettingsSection>
    <SettingsSection title="Imported skills" summary={`${targets.skills.length} skills`}><section className="local-model-settings">
      <p>Disabled skills cannot reach the model or attach to a thread. Add more in Imports &amp; plugins.</p>
      <div className="tool-group">{rows("disabledSkills", targets.skills.map((skill) => ({ id: skill.id, name: skill.name, source: `from ${skill.source}` })), "No skills imported yet.")}</div>
    </section></SettingsSection>
    <SettingsSection title="MCP servers" summary={`${targets.servers.length} servers`}><section className="local-model-settings">
      <p>Disabled servers do not start or offer their tools to the agent.</p>
      <div className="tool-group">{rows("disabledServers", targets.servers.map((server) => ({ id: server.id, name: server.name, source: `from ${server.source} · ${server.command}` })), "No MCP servers imported yet.")}</div>
    </section></SettingsSection>
    {error && <p className="local-model-error" role="status">{error}</p>}
  </div>;
}

function NumberField({ value, min, max, disabled, onCommit }: { value: number; min: number; max: number; disabled: boolean; onCommit: (next: number) => void }) {
  const commit = (node: HTMLInputElement) => {
    const parsed = Math.trunc(Number(node.value));
    const next = node.value.trim() === "" || !Number.isFinite(parsed) ? value : Math.max(min, Math.min(max, parsed));
    node.value = String(next);
    if (next !== value) onCommit(next);
  };
  return <input key={value} type="number" defaultValue={value} min={min} max={max} disabled={disabled} onBlur={(event) => commit(event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function ExperimentRow({ label, blurb, steps, percent, suggested, onChange, busy }: {
  label: string;
  blurb: string;
  steps: number;
  percent: number;
  suggested: number;
  onChange: (next: { steps: number; percent: number }) => void;
  busy: boolean;
}) {
  const on = steps > 0 || percent > 0;
  return <div className="tool-group coding-experiment">
    <div className="settings-head">
      <label className="check tool-row">
        <input type="checkbox" checked={on} disabled={busy} onChange={(event) => onChange(event.target.checked ? { steps: suggested, percent: 0 } : { steps: 0, percent: 0 })} />
        <strong>{label}</strong>
      </label>
      <InfoDot>{blurb}</InfoDot>
    </div>
    {on && <div className="font-values coding-dependent">
      <label>Every N steps<NumberField min={0} max={MAX_EXPERIMENT_STEPS} value={steps} disabled={busy} onCommit={(next) => onChange({ steps: next, percent })} /></label>
      <label>At % of context<NumberField min={0} max={100} value={percent} disabled={busy} onCommit={(next) => onChange({ steps, percent: next })} /></label>
      <small>0 switches a trigger off; set both and either one fires.</small>
    </div>}
  </div>;
}

function ReviewPanel({ settings, onSave, busy }: { settings: UserSettings; onSave: (next: UserSettings) => Promise<void>; busy: boolean }) {
  const review = settings.review;
  const [error, setError] = useState("");
  const save = (next: UserSettings) => { setError(""); void onSave(next).catch((reason: unknown) => setError(reasonText(reason))); };
  const live = review.enabled && !!review.model.trim();
  return <div className="tool-settings coding-review">
    <section className="local-model-settings">
      <header>
        <div>
          <div className="settings-head">
            <h3>Second-model review</h3>
            <InfoDot>A turn of its own, not one more API call: the reviewer gets its own thread beside this one, the same folder, and its own tools, so it reads the diff, runs the tests and judges the work rather than the account of it. Every edit it attempts is refused — the thread's own model does the fixing. It runs only after a turn that wrote a file or ran a command, in a thread with a connected folder, never while a goal is being pursued, and it hands the work back at most {MAX_REVIEW_ROUNDS} times before it stops and leaves the last word to you. Two models, two bills.</InfoDot>
          </div>
          <p>Have another model inspect changes and send back fixes.</p>
        </div>
        <strong className={live ? "on" : ""}>{live ? "On" : "Off"}</strong>
      </header>
      <div className="tool-group">
        <label className="check tool-row">
          <input type="checkbox" checked={review.enabled} disabled={busy} onChange={(event) => save({ ...settings, review: { ...review, enabled: event.target.checked } })} />
          <strong>Check the work with another model</strong>
        </label>
        {review.enabled && <div className="coding-dependent"><TaskModelPicker model={review.model} busy={busy} label="The model that reviews the work" inherit="No reviewer picked" onChange={(model, current) => save({ ...current, review: { ...current.review, model } })} />
        <small>{live ? <>{modelKeyLabel(settings, review.model)} reads what changed and sends it back when it is not good enough. The <span className="review-mark"><ReviewIcon /></span> beside the composer turns it off for one thread.</> : review.enabled ? "Pick a model — one stronger than the model doing the work, or one that fails differently." : "Off. Nothing is reviewed and nothing is sent back."}</small></div>}
      </div>
    </section>
    {error && <p className="local-model-error" role="status">{error}</p>}
  </div>;
}

function HarnessExperimentsPanel({ settings, onChange, busy }: { settings: UserSettings; onChange: (experiments: HarnessExperiments) => Promise<void>; busy: boolean }) {
  const experiments = settings.harnessExperiments;
  const [error, setError] = useState("");
  const save = (next: HarnessExperiments) => { setError(""); void onChange(next).catch((reason: unknown) => setError(reasonText(reason))); };
  const compacting = experiments.autoCompactPercent > 0;
  return <div className="tool-settings coding-execution">
    <section className="local-model-settings">
      <header>
        <div>
          <div className="settings-head">
            <h3>Context &amp; execution</h3>
            <InfoDot>The first two levers rewrite only the copy sent for one model step. Auto compact advances the same durable context boundary as <code>/compact</code>, once between user turns. Percentages use four characters per token against the selected model's context window; routes without a known window leave them inert.</InfoDot>
          </div>
          <p>Keep long sessions focused and bound how long commands run.</p>
        </div>
        <strong className={compacting || experiments.reinjectPromptSteps || experiments.reinjectPromptPercent || experiments.pruneToolsSteps || experiments.pruneToolsPercent ? "on" : ""}>{compacting || experiments.reinjectPromptSteps || experiments.reinjectPromptPercent || experiments.pruneToolsSteps || experiments.pruneToolsPercent ? "On" : "Off"}</strong>
      </header>
      <div className="tool-group">
        <div className="settings-head">
          <label className="check tool-row">
            <input type="checkbox" checked={compacting} disabled={busy} onChange={(event) => save({ ...experiments, autoCompactPercent: event.target.checked ? defaultHarnessExperiments.autoCompactPercent : 0 })} />
            <strong>Auto compact</strong>
          </label>
          <InfoDot>Compaction rewrites the cached prefix, so Shinbo waits until the current turn is over. A cache-hit gate would keep postponing on a healthy prefix; the high-water mark is the safety gate, and the compacted prefix can warm again on the following steps.</InfoDot>
        </div>
        {compacting && <div className="font-values coding-dependent">
          <label>At % of context<NumberField min={0} max={100} value={experiments.autoCompactPercent} disabled={busy} onCommit={(autoCompactPercent) => save({ ...experiments, autoCompactPercent })} /></label>
          <small>{compacting ? "Runs /compact once between turns when history reaches this mark." : "Off. /compact remains available manually."}</small>
        </div>}
        <div className="coding-dependent">
          <div className="settings-head">
            <label className="check tool-row">
              <input type="checkbox" checked={experiments.freshContext} disabled={busy} onChange={(event) => save({ ...experiments, freshContext: event.target.checked })} />
              <strong>Fresh context instead of a summary</strong>
            </label>
            <InfoDot>Drops every earlier turn and hands the model a short record it can verify: your messages, and the handoff it wrote before the rollover. No model writes a summary. Also applies to /compact and to the model's own context tool. With Auto compact on, the model is nudged to save its state and reset itself once the window is within {CHECKPOINT_BAND_PERCENT}% of the compact mark.</InfoDot>
          </div>
          <small>{experiments.freshContext ? "On. Earlier turns stay readable with the threads and read_trace tools." : "Off. Compaction rewrites earlier turns into one summary."}</small>
        </div>
      </div>
      <div className="tool-group">
        <div className="settings-head">
          <strong>Command timeout</strong>
          <InfoDot>Caps one captured <code>terminal</code> command. Shinbo is mute and blind while a command runs, so the ceiling bounds how long a single call can hold a turn; anything longer belongs in a durable terminal session, which this does not touch.</InfoDot>
        </div>
        <div className="font-values">
          <label>Minutes<NumberField min={MIN_COMMAND_TIMEOUT_MINUTES} max={MAX_COMMAND_TIMEOUT_MINUTES} value={experiments.commandTimeoutMinutes} disabled={busy} onCommit={(commandTimeoutMinutes) => save({ ...experiments, commandTimeoutMinutes })} /></label>
          <small>Terminated after this long, with the exit reported to the model.</small>
        </div>
      </div>
      <SettingsSection title="Advanced context rules" summary="Repeat prompts or prune results"><ExperimentRow
        label="Repeat the original prompt"
        blurb="Appends what you asked for, unchanged, after the newest tool results — so a long run of tool calls does not bury the request under its own output."
        steps={experiments.reinjectPromptSteps}
        percent={experiments.reinjectPromptPercent}
        suggested={15}
        busy={busy}
        onChange={({ steps, percent }) => save({ ...experiments, reinjectPromptSteps: steps, reinjectPromptPercent: percent })}
      />
      <ExperimentRow
        label="Prune older tool results"
        blurb="Replaces the output of earlier tool calls with a one-line placeholder, keeping the newest batch intact so the model is not made to re-run the call it just made. It can always run a tool again."
        steps={experiments.pruneToolsSteps}
        percent={experiments.pruneToolsPercent}
        suggested={15}
        busy={busy}
        onChange={({ steps, percent }) => save({ ...experiments, pruneToolsSteps: steps, pruneToolsPercent: percent })}
      />
      </SettingsSection>
    </section>
    {error && <p className="local-model-error" role="status">{error}</p>}
  </div>;
}

function EmbeddingKeyRow({ model, stored, busy, onStored }: { model: HostedEmbeddingModel; stored: CredentialSummary[]; busy: boolean; onStored: (next: CredentialSummary[]) => void }) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [checking, setChecking] = useState(false);
  const saved = stored.find((item) => item.env === model.credentialEnv && item.masked);
  const save = async (secret?: string) => {
    setNote("");
    try {
      onStored(await window.shinbo.saveCredential(secret === undefined ? { env: model.credentialEnv } : { env: model.credentialEnv, secret }));
      setDraft("");
    } catch (reason) { setNote(reasonText(reason)); }
  };
  const verify = async () => {
    setChecking(true);
    setNote("");
    const answer = await window.shinbo.verifyEmbeddingKey(model.id).catch((reason: unknown) => ({ ok: false, detail: reasonText(reason) }));
    setChecking(false);
    setNote(answer.detail);
  };
  return <div className="embedding-key">
    <div><strong>{model.label}</strong><small>Indexed file contents and search queries are sent to this provider.</small><code>{model.credentialEnv}</code></div>
    <span className="embedding-key-value">{saved ? saved.masked : "Not set"}</span>
    <label><span className="sr-only">{model.label} API key</span><input type="password" autoComplete="off" spellCheck={false} maxLength={MAX_SECRET_CHARS} disabled={busy} value={draft} placeholder={saved ? "Paste a replacement" : "Paste the API key"} onChange={(event) => setDraft(event.target.value)} /></label>
    <div className="embedding-key-actions">
      <button type="button" disabled={busy || !draft.trim()} onClick={() => void save(draft.trim())}>Save</button>
      <button type="button" disabled={busy || !saved || checking} onClick={() => void verify()}>{checking ? "Checking…" : "Verify"}</button>
      <button type="button" disabled={busy || !saved} onClick={() => void save()}>Remove</button>
    </div>
    {note && <small className="embedding-key-note">{note}</small>}
  </div>;
}

function ZvecGrepCard({ tool, busy }: { tool: ZvecGrepStatus; busy: boolean }) {
  const working = tool.phase === "downloading" || tool.phase === "verifying" || tool.phase === "extracting";
  return <div className="tool-download">
    <div className="tool-download-head">
      <div><strong>zvec-grep {tool.version}</strong><small>The index is built on this {LOCAL_DEVICE} for local and hosted models alike, so the tool is needed either way. About {sizeLabel(zvecGrepDownloadBytes(RUNTIME_PLATFORM))}, kept in Shinbo's data folder and reused by later versions of Shinbo.</small></div>
      {tool.phase === "ready"
        ? <strong className="tool-download-state">Installed · v{tool.version}</strong>
        : working
          ? <button type="button" onClick={() => void window.shinbo.zvecGrepCancel()}>Cancel</button>
          : <button type="button" disabled={busy} onClick={() => void window.shinbo.zvecGrepInstall()}>{tool.phase === "failed" ? "Retry" : "Download"}</button>}
    </div>
    {working && <div className="tool-progress"><span className="index-bar" style={{ "--p": `${zvecGrepPercent(tool)}%` } as CSSProperties}><b /></span><small>{zvecGrepPhaseLabel[tool.phase]} · {zvecGrepProgressLabel(tool)}</small></div>}
    {tool.phase === "failed" && <p className="local-model-error" role="status">{tool.detail}</p>}
  </div>;
}

function EmbeddingAdvice({ facts, chosen, busy, onUse }: { facts: MachineFacts; chosen: EmbeddingModel; busy: boolean; onUse: (id: EmbeddingModel) => void }) {
  const advice = recommendEmbeddingModel(facts);
  const parts = [facts.gpu || "No GPU reported", facts.vramBytes ? `${gigabytes(facts.vramBytes)} GB video memory` : "", `${gigabytes(facts.memoryBytes)} GB memory`, `${facts.cores} cores`].filter(Boolean);
  return <div className="embedding-advice">
    <div>
      <strong>Recommended for this {LOCAL_DEVICE} · {embeddingModelLabel(advice.id)}</strong>
      <small>{advice.reason}</small>
      <em>{parts.join(" · ")}</em>
    </div>
    <button type="button" disabled={busy || chosen === advice.id} onClick={() => onUse(advice.id)}>{chosen === advice.id ? "In use" : "Use"}</button>
  </div>;
}

function SemanticGrepPanel({ settings, onChange, busy }: { settings: UserSettings; onChange: (experiments: HarnessExperiments) => Promise<void>; busy: boolean }) {
  const experiments = settings.harnessExperiments;
  const [error, setError] = useState("");
  const status = useSemanticGrepStatus();
  const tool = useZvecGrepStatus();
  const [facts, setFacts] = useState<MachineFacts | null>(null);
  const [stored, setStored] = useState<CredentialSummary[]>([]);
  useEffect(() => {
    let live = true;
    void window.shinbo.listCredentials().then((next) => { if (live) setStored(next); }).catch(() => undefined);
    void window.shinbo.machineFacts().then((next) => { if (live) setFacts(next); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const save = (next: HarnessExperiments) => { setError(""); void onChange(next).catch((reason: unknown) => setError(reasonText(reason))); };
  const enabled = experiments.semanticGrep;
  const on = enabled && status.available;
  const hosted = hostedEmbeddingModel(experiments.embeddingModel);
  return <div className="tool-settings coding-semantic">
    <section className="local-model-settings">
      <header>
        <div>
          <div className="settings-head">
            <h3>Semantic search</h3>
            <InfoDot>Makes <code>semantic_search</code> the agent's default search and answers it with zvec-grep: vector embeddings, BM25 and ripgrep in one tool. The tool is downloaded the first time you ask for it, not shipped inside Shinbo, and it stays in Shinbo's data folder so later versions reuse it. Each connected folder is indexed the first time a thread runs there and kept fresh as files change; until then the agent searches by keywords. The index lives in <code>.zvec-grep/</code> inside the folder and is excluded from git. A hosted model sends the contents of every indexed file, and each query, to that provider under the key named below; a local one keeps them on this computer.</InfoDot>
          </div>
          <p>Find code by meaning as well as exact keywords.</p>
        </div>
        <strong className={on ? "on" : ""}>{on ? "On" : "Off"}</strong>
      </header>
      <div className="tool-group">
        <label className="check tool-row">
          <input type="checkbox" checked={experiments.semanticGrep} disabled={busy} onChange={(event) => save({ ...experiments, semanticGrep: event.target.checked })} />
          <strong>Index connected folders</strong>
        </label>
        {enabled && <div className="font-values coding-dependent">
          <ZvecGrepCard tool={tool} busy={busy} />
          {facts && !hosted && <EmbeddingAdvice facts={facts} chosen={experiments.embeddingModel} busy={busy} onUse={(id) => save({ ...experiments, embeddingModel: id })} />}
          <label>Model<select value={experiments.embeddingModel} disabled={busy} onChange={(event) => save({ ...experiments, embeddingModel: event.target.value as EmbeddingModel })}>
            <optgroup label="On this computer">{LOCAL_EMBEDDING_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.detail}</option>)}</optgroup>
            <optgroup label="Hosted">{HOSTED_EMBEDDING_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.detail}</option>)}</optgroup>
          </select></label>
          {hosted && <EmbeddingKeyRow model={hosted} stored={stored} busy={busy} onStored={setStored} />}
          {on && status.folders.length === 0 && <small>Each connected folder is indexed the first time a thread runs in it.</small>}
        </div>}
        {on && status.folders.length > 0 && <SettingsSection title="Folder indexes" summary={`${status.folders.length} folders`}><div className="coding-index-scroll"><table className="index-ledger">
          <thead><tr><th>Folder</th><th>State</th><th>Model</th><th>Mode</th><th>Progress</th></tr></thead>
          <tbody>{status.folders.map((folder) => <tr key={folder.path}>
            <td>{folder.path.split(/[\\/]/).pop()}</td>
            <td data-state={folder.state}>{indexStateLabel[folder.state]}</td>
            <td>{embeddingModelLabel(folder.model)}</td>
            <td>{embeddingModelMode(folder.model)}</td>
            <td>{folder.state === "indexing" && folder.total > 0 && <span className="index-bar" style={{ "--p": `${Math.min(100, (folder.done / folder.total) * 100)}%` } as CSSProperties}><b /></span>}{progressLabel(folder)}</td>
          </tr>)}</tbody>
        </table></div></SettingsSection>}
      </div>
      {error && <p className="local-model-error" role="status">{error}</p>}
    </section>
  </div>;
}

function WebSearchPanel({ search, disabled, onChange, busy }: { search: WebSearchSettings; disabled: boolean; onChange: (value: WebSearchSettings) => void; busy: boolean }) {
  const [draft, setDraft] = useState(search);
  const [adding, setAdding] = useState<WebSearchProvider>("searxng");
  const available = WEB_SEARCH_PROVIDERS.filter((item) => !draft.providers.some((source) => source.provider === item.id));
  const chosen = available.some((item) => item.id === adding) ? adding : available[0]?.id;
  const update = (at: number, field: "endpoint" | "credentialEnv", value: string) => setDraft((current) => ({ ...current, providers: current.providers.map((source, index) => index === at ? { ...source, [field]: value } : source) }));
  const move = (at: number, by: number) => setDraft((current) => {
    const providers = [...current.providers];
    [providers[at], providers[at + by]] = [providers[at + by], providers[at]];
    return { ...current, providers };
  });
  const add = () => {
    if (!chosen) return;
    const provider = webSearchProvider(chosen);
    setDraft((current) => ({ ...current, providers: [...current.providers, { provider: chosen, endpoint: provider.endpoint, credentialEnv: webSearchCredentials[chosen] }] }));
  };
  return <section className="local-model-settings">
    <header><div><span>web_search</span><h3>Where the search goes</h3><p>Shinbo tries this list from top to bottom. TinyFish cools down for one minute at its free limit, then returns to its ranked place. Adding a metered provider here explicitly allows Shinbo to use it.</p></div><strong>{disabled ? "Tool off" : `${draft.providers.length} ranked`}</strong></header>
    <form className="web-search-form" onSubmit={(event) => { event.preventDefault(); onChange(draft); }}>
      <ol className="web-search-rank">
        {draft.providers.map((source, at) => { const provider = webSearchProvider(source.provider); return <li key={source.provider}>
          <b>{at + 1}</b>
          <div className="web-search-source">
            <div><SearchProviderMark provider={provider.id} /><strong>{provider.label}</strong><em className={provider.free ? "free" : "paid"}>{provider.free ? "Free" : "May bill"}</em></div>
            <small>{provider.detail}</small>
            <div className="web-search-fields">
              <label>Endpoint<input required maxLength={2048} value={source.endpoint} disabled={busy} onChange={(event) => update(at, "endpoint", event.target.value)} /></label>
              {!provider.keyless && <label>Credential env<input required maxLength={128} value={source.credentialEnv} disabled={busy} onChange={(event) => update(at, "credentialEnv", event.target.value)} placeholder={webSearchCredentials[source.provider]} /></label>}
            </div>
          </div>
          <div className="web-search-order">
            <button type="button" disabled={busy || at === 0} aria-label={`Move ${provider.label} earlier`} title="Move earlier" onClick={() => move(at, -1)}>↑</button>
            <button type="button" disabled={busy || at === draft.providers.length - 1} aria-label={`Move ${provider.label} later`} title="Move later" onClick={() => move(at, 1)}>↓</button>
            <button type="button" disabled={busy || draft.providers.length === 1} aria-label={`Remove ${provider.label}`} onClick={() => setDraft((current) => ({ ...current, providers: current.providers.filter((item) => item.provider !== source.provider) }))}>Remove</button>
          </div>
        </li>; })}
      </ol>
      <div className="web-search-actions">
        {chosen && <><label>Add provider<select value={chosen} disabled={busy} onChange={(event) => setAdding(event.target.value as WebSearchProvider)}>{available.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.free ? "free" : "may bill"}</option>)}</select></label><button type="button" disabled={busy} onClick={add}>Add</button></>}
        <button className="save-settings" disabled={busy}>Save ranking</button>
      </div>
    </form>
  </section>;
}

function AdvisorPanel({ settings, onSave, busy }: { settings: UserSettings; onSave: (advisor: VerifierSettings) => Promise<void>; busy: boolean }) {
  const [draft, setDraft] = useState(settings.tools.advisor);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNote({ text: "" });
    void onSave(draft)
      .then(() => setNote({ text: draft.model ? `${draft.model} answers when the agent asks for advice.` : "No advisor: the tool tells the agent to come back here." }))
      .catch((reason: unknown) => setNote({ text: reasonText(reason), bad: true }));
  };
  return <section className="local-model-settings">
    <header><div><div className="settings-head"><h3>Advisor · asked when the agent is stuck</h3><InfoDot>The agent hands this model the thread and what it has tried, and gets back a plan. Pick something <b>stronger</b> than the model you run on — asking a weaker one costs a turn and returns worse advice. Leave it empty and the tool tells the agent to come back here.</InfoDot></div><p>A stronger second model the agent asks for a plan when it is stuck.</p></div><strong>{settings.tools.advisor.model ? "Configured" : "Not set up"}</strong></header>
    {!draft.model && <p className="local-model-error">No advisor model is set, so the tool does nothing but point back at this page. Pick one below — any model whose key you have already stored.</p>}
    <form className="local-model-form" onSubmit={submit}>
      <SecondModelPicker label="Advisor model" off={SECOND_MODELS.advisor.off} draft={draft} providers={settings.providers} routers={settings.routers} busy={busy} onChange={(next) => { setDraft(next); setNote({ text: "" }); }} />
      {draft.model && <SettingsSection title="Custom instructions" summary="Optional">
      <label className="verifier-rules">What it is asked to do<textarea rows={6} maxLength={MAX_VERIFIER_SYSTEM_CHARS} value={draft.system} disabled={busy} onChange={(event) => setDraft({ ...draft, system: event.target.value })} /></label>
      <div className="verifier-rules prompt-footer"><small>{draft.system.length} / {MAX_VERIFIER_SYSTEM_CHARS} characters · the thread is appended below this</small><button type="button" onClick={() => setDraft({ ...draft, system: defaultAdvisorSystem })}>Reset to default</button></div>
      </SettingsSection>}
      <button disabled={busy}>Save advisor</button>
    </form>
    {note.text && <p className={note.bad ? "local-model-error" : "local-model-status"} role="status">{note.text}</p>}
  </section>;
}

function SecretPanel({ settings, onSave, busy }: { settings: UserSettings; onSave: (secret: VerifierSettings) => Promise<void>; busy: boolean }) {
  const [draft, setDraft] = useState(settings.tools.secret);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNote({ text: "" });
    void onSave(draft)
      .then(() => setNote({ text: draft.model ? `${draft.model} is the only model your secrets reach.` : "No secrets model: the tool tells the agent it cannot look." }))
      .catch((reason: unknown) => setNote({ text: reasonText(reason), bad: true }));
  };
  return <section className="local-model-settings">
    <header><div><div className="settings-head"><h3>Secrets · the only model your keys reach</h3><InfoDot>The <code>secret</code> tool runs a command — <code>printenv</code>, <code>cat .env</code>, <code>op read</code>, <code>vault kv get</code> — and sends its output to this model and nothing else. The model you run threads on gets the answer, never the output. Pick a local profile to keep every key on this {LOCAL_DEVICE}.</InfoDot></div><p>Where the agent sends keys, tokens and vault entries. Nothing else sees them.</p></div><strong>{settings.tools.secret.model ? "Configured" : "Not set up"}</strong></header>
    {!draft.model && <p className="local-model-error">No secrets model is set, so the tool refuses and tells the agent to come back here. A local model keeps every value on this {LOCAL_DEVICE}.</p>}
    <form className="local-model-form" onSubmit={submit}>
      <SecondModelPicker label="Secrets model" off={SECOND_MODELS.secret.off} draft={draft} providers={settings.providers} routers={settings.routers} busy={busy} onChange={(next) => { setDraft(next); setNote({ text: "" }); }} />
      {draft.model && <SettingsSection title="Custom instructions" summary="Optional">
      <label className="verifier-rules">What it is asked to do<textarea rows={6} maxLength={MAX_VERIFIER_SYSTEM_CHARS} value={draft.system} disabled={busy} onChange={(event) => setDraft({ ...draft, system: event.target.value })} /></label>
      <div className="verifier-rules prompt-footer"><small>{draft.system.length} / {MAX_VERIFIER_SYSTEM_CHARS} characters · the question and the command's output are appended below this</small><button type="button" onClick={() => setDraft({ ...draft, system: defaultSecretSystem })}>Reset to default</button></div>
      </SettingsSection>}
      <button disabled={busy}>Save secrets model</button>
    </form>
    {note.text && <p className={note.bad ? "local-model-error" : "local-model-status"} role="status">{note.text}</p>}
  </section>;
}

function VisionPanel({ settings, onSave, busy }: { settings: UserSettings; onSave: (vision: VerifierSettings) => Promise<void>; busy: boolean }) {
  const [draft, setDraft] = useState(settings.tools.vision);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: "" });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNote({ text: "" });
    void onSave(draft)
      .then(() => setNote({ text: draft.model ? `${draft.model} answers when the agent looks at an image.` : "No vision model: the tool tells the agent it cannot look." }))
      .catch((reason: unknown) => setNote({ text: reasonText(reason), bad: true }));
  };
  return <section className="local-model-settings">
    <header><div><div className="settings-head"><h3>Vision · asked to look at an image</h3><InfoDot>Most models cannot see. This one is sent one image and one question — what is in it, what does it say, where exactly is the button — and answers in words the agent can use. Only models that take images are listed; a free one reads a screenshot perfectly well.</InfoDot></div><p>The model the agent sends an image to. Only models that can see are listed.</p></div><strong>{settings.tools.vision.model ? "Configured" : "Not set up"}</strong></header>
    {!draft.model && <p className="local-model-error">No vision model is set, so the tool tells the agent it cannot look.</p>}
    <form className="local-model-form" onSubmit={submit}>
      <SecondModelPicker label="Vision model" off={SECOND_MODELS.vision.off} draft={draft} providers={settings.providers} routers={settings.routers} busy={busy} accepts={seesImages} onChange={(next) => { setDraft(next); setNote({ text: "" }); }} />
      {draft.model && <SettingsSection title="Custom instructions" summary="Optional">
      <label className="verifier-rules">What it is asked to do<textarea rows={6} maxLength={MAX_VERIFIER_SYSTEM_CHARS} value={draft.system} disabled={busy} onChange={(event) => setDraft({ ...draft, system: event.target.value })} /></label>
      <div className="verifier-rules prompt-footer"><small>{draft.system.length} / {MAX_VERIFIER_SYSTEM_CHARS} characters · the question and the image are appended below this</small><button type="button" onClick={() => setDraft({ ...draft, system: defaultVisionSystem })}>Reset to default</button></div>
      </SettingsSection>}
      <button disabled={busy}>Save vision model</button>
    </form>
    {note.text && <p className={note.bad ? "local-model-error" : "local-model-status"} role="status">{note.text}</p>}
  </section>;
}

function PrivacySettings({ busy, onReset, onResetSettings, onModels }: { busy: boolean; onReset: () => void; onResetSettings: () => void; onModels: () => void }) {
  return <div className="privacy-settings settings-stack">
    <div className="settings-intro"><div><h3>Your data and connections</h3><p>Local storage and model requests have different boundaries.</p></div></div>
    <dl className="privacy-overview"><div><dt>Threads & notes</dt><dd>Stored on this {LOCAL_DEVICE}</dd></div><div><dt>Voice recordings</dt><dd>Transcribed locally, then deleted</dd></div><div><dt>Model requests</dt><dd>Sent to your selected provider</dd></div></dl>
    <SettingsSection title="Models & retention" summary="Provider settings apply">
      <p>Relevant thread history and tool results reach the selected model. The note tagger may send note text to its own model. Free or paid does not determine a model’s privacy policy.</p>
      <p>Shinbo cannot read or change your OpenRouter account’s logging settings. Private input/output logging and using prompts to improve OpenRouter are separate opt-ins.</p>
      <a href="https://openrouter.ai/settings/privacy" target="_blank" rel="noreferrer">Review OpenRouter privacy settings ↗</a>
      <p>Private routing is off by default. It requests no-training, zero-retention endpoints for the main agent loop on OpenRouter; a request fails when no eligible endpoint exists. It does not cover secondary models, tools, widgets, browsers, external CLIs, or account logging.</p>
      <button type="button" disabled={busy} onClick={onModels}>Manage private routing</button>
    </SettingsSection>
    <SettingsSection title="App access & approvals" summary="Granted per turn">
      <p>Computer use lists running apps, then reads accessibility text only from apps you approve. App titles, labels and values may reach the turn’s model. It takes no screenshots and reads no clipboard; images you attach or send to vision still reach their configured model.</p>
      <p>Every app asks before access, even in Auto or Full access. A grant covers the named app and active parent turn only, never delegated work. Declining blocks that app for the rest of the turn.</p>
      <p>Stop, Escape, screen lock, sleep, turn completion and quitting Shinbo revoke access. There is no always-allow setting. The yellow pen’s separate capture stays in Shinbo’s process; the turn goes out without it.</p>
    </SettingsSection>
    <SettingsSection title="Local files & dictation" summary="On this computer">
      <p>Thread records are Markdown in Shinbo’s application data folder, moved by <code>SHINBO_DATA_DIR</code>. Notes stay in your chosen vault and are written only when you ask. Normal agent requests remain in their thread.</p>
      <p>Pane layout, Quick Ask preferences and an unsent overlay draft stay in local application storage.</p>
      <p>Speech and cleanup use loopback servers or on-device speech. Non-local endpoints are refused when saved and before use. Temporary audio is read once and deleted. Sending the dictated words shares them with the selected thread model.</p>
    </SettingsSection>
    <SettingsSection title="Usage & diagnostics" summary="No analytics uploader">
      <p>Shinbo records local usage and execution traces but does not configure analytics or crash-report uploads. Providers, update checks, the catalog and enabled integrations still make network requests and receive ordinary request metadata.</p>
    </SettingsSection>
    <section className="settings-danger"><div><h3>Reset settings</h3><p>Restore every setting to its default. Threads, notes, artifacts and saved keys stay.</p></div><button type="button" disabled={busy} onClick={onResetSettings}>Reset settings…</button></section>
    <section className="settings-danger"><div><h3>Reset Shinbo</h3><p>Delete threads, artifacts, saved keys and settings, then restart empty. Notes in your vault stay in place. This cannot be undone.</p></div><button type="button" className="reset-data" disabled={busy} onClick={onReset}>Reset Shinbo…</button></section>
  </div>;
}

function AgentImports() {
  const [sources, setSources] = useState<AgentImportSource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void window.shinbo.discoverAgentImports().then((items) => {
      setSources(items);
      const present = items.filter((item) => item.skills || item.mcpConfigs);
      const kept = present.filter((item) => item.registered);
      setSelected((kept.length ? kept : present).map((item) => item.id));
    }).catch((reason) => setStatus(reasonText(reason))).finally(() => setBusy(false));
  }, []);
  const submit = async () => {
    setBusy(true); setStatus("");
    try {
      const imported = await window.shinbo.importAgentSources(selected);
      setSources((items) => items.map((item) => ({ ...item, registered: imported.includes(item.id) })));
      setStatus(`${imported.length} ${plural(imported.length, "agent source")} registered`);
    } catch (reason) { setStatus(reasonText(reason)); }
    finally { setBusy(false); }
  };
  const found = sources.filter((source) => source.skills > 0 || source.mcpConfigs > 0);
  const registered = found.filter((source) => source.registered).map((source) => source.id);
  const changed = selected.length !== registered.length || selected.some((id) => !registered.includes(id));
  const adding = selected.some((id) => !registered.includes(id));
  const missing = sources.filter((source) => !found.includes(source));
  return <div className="import-sources import-settings">
    <header className="settings-intro"><div><h3>Bring your existing setup</h3><p>Use skills and MCP configurations from agents already on this computer. Their files stay where they are.</p></div><span className="settings-count">{busy ? "Scanning…" : `${found.length} sources found`}</span></header>
    <div className="import-list">{found.map((source) => <label key={source.id}><input type="checkbox" disabled={busy} checked={selected.includes(source.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, source.id] : selected.filter((id) => id !== source.id))} /><BrandIcon brand={brandForImporter(source.id)} className={`integration-mark ${source.id}`} /><div><strong>{source.label}</strong><small>{source.skills} {plural(source.skills, "skill")} · {source.mcpConfigs} MCP {plural(source.mcpConfigs, "config")}{source.registered ? " · imported" : ""}</small></div></label>)}</div>
    {!busy && !found.length && <p className="import-status">No existing skills or MCP configurations were found in the default locations.</p>}
    <footer><div><p>{selected.length} {plural(selected.length, "source")} selected</p><small>Imported tools stay inactive until selected by a thread or plugin.</small></div><button type="button" onClick={() => void submit()} disabled={busy || !changed}>{busy ? "Working…" : adding ? "Import selected" : "Save selection"}</button></footer>
    {status && <p className="import-status" role="status">{status}</p>}
    {found.length > 0 && <SettingsSection title="Source locations" summary="Referenced in place">{found.map((source) => <div className="import-location" key={source.id}><strong>{source.label}</strong>{source.locations.map((location) => <code key={location}>{location}</code>)}</div>)}</SettingsSection>}
    {missing.length > 0 && <SettingsSection title="Not found on this computer" summary={`${missing.length} agents`}><p>{missing.map((source) => source.label).join(" · ")}</p><p>Shinbo checked their default configuration locations.</p></SettingsSection>}
  </div>;
}

const DOUBLE_TAP_MS = 350;

function setupPermissionUnavailable(id: SetupPermission): boolean {
  return IS_WINDOWS && (id === "accessibility" || id === "speech" || id === "automation");
}

function setupPermissionTitle(permission: (typeof SETUP_PERMISSIONS)[number]): string {
  if (!IS_WINDOWS) return permission.title;
  if (permission.id === "screen") return "Screen capture";
  if (permission.id === "files") return "Files";
  if (permission.id === "accessibility") return "App control";
  return permission.title;
}

function setupPermissionWhat(permission: (typeof SETUP_PERMISSIONS)[number]): string {
  if (IS_WINDOWS && permission.id === "accessibility") return "Opens Quick Ask on the built-in shortcut and controls apps you approve.";
  return permission.what;
}

function setupPermissionTasks(permission: (typeof SETUP_PERMISSIONS)[number]): readonly string[] {
  if (IS_WINDOWS && permission.id === "accessibility") return ["Control approved apps", "Quick Ask on Alt+Alt", "Bound shortcuts"];
  return permission.tasks;
}

function setupPermissionWhy(permission: (typeof SETUP_PERMISSIONS)[number]): string {
  if (IS_WINDOWS && permission.id === "accessibility") return "Windows does not use a separate accessibility grant for Shinbo's approved app actions. Shinbo asks before each app run and limits access to that turn.";
  if (IS_WINDOWS && permission.id === "speech") return "Windows SAPI does not use a separate Shinbo speech grant. Shinbo checks the local speech helper before dictation.";
  if (IS_WINDOWS && permission.id === "automation") return "Windows does not use a separate automation grant for supported browser metadata. Shinbo reads only the foreground browser details needed for the action you ask for.";
  return permission.why;
}

const PERMISSION_ICONS = { accessibility: Accessibility, screen: Monitor, microphone: Mic, speech: AudioLines, automation: AppWindow, notifications: Bell, files: Folder };

function PermissionSettings({ busy, onboarding = false }: { busy: boolean; onboarding?: boolean }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => { void window.shinbo.setupStatus().then(setStatus).catch(() => undefined); }, []);
  useEffect(() => { refresh(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [refresh]);
  const open = (permission: SetupPermission) => void window.shinbo.openPrivacySettings(permission).catch((reason: unknown) => setError(reasonText(reason)));
  const requiredPermissions = SETUP_PERMISSIONS.filter((permission) => !setupPermissionUnavailable(permission.id));
  const granted = requiredPermissions.filter((permission) => status?.[permission.id] === true).length;
  return <>
    <div className="permission-settings">
      <header className="settings-intro">
        {onboarding ? <div /> : <div><h3>Access to this computer</h3><p>Shinbo asks only when a task needs access. You control each grant in {PLATFORM_NAME} settings.</p></div>}
        <span className="settings-count">{status ? `${granted} of ${requiredPermissions.length} granted` : "Checking access…"}</span>
      </header>
      {SETUP_PERMISSIONS.map((permission) => {
        const ok = status?.[permission.id];
        const unavailable = setupPermissionUnavailable(permission.id);
        const Icon = PERMISSION_ICONS[permission.id];
        return <section key={permission.id} className="permission-row">
          <details>
            <summary><span className="permission-name"><Icon size={18} strokeWidth={1.5} aria-hidden="true" />{setupPermissionTitle(permission)}</span><span className="permission-purpose">{setupPermissionWhat(permission)}</span></summary>
            <div className="permission-explanation">
              <p>{setupPermissionWhy(permission)}</p>
              <p>Used for: {setupPermissionTasks(permission).join(" · ")}</p>
              {permission.relaunch && !unavailable && ok !== true && <p>Relaunch Shinbo once you have granted it.</p>}
            </div>
          </details>
          <div className="permission-access">
            <span className="permission-state" data-granted={!unavailable && ok === true}>{unavailable ? "Not required" : !status ? "Checking…" : ok === true ? "Granted" : ok === false ? "Not granted" : "Check in settings"}</span>
            <button type="button" aria-label={`Open ${setupPermissionTitle(permission)} settings`} disabled={busy || unavailable} onClick={() => open(permission.id)}>Settings ↗</button>
          </div>
        </section>;
      })}
    </div>
    {!onboarding && <footer className="settings-related"><div><h3>Agent permissions</h3><p>Choose available tools and when Shinbo asks before acting.</p></div><button type="button" disabled={busy} onClick={() => openSettingsPage("tools")}>Open Tools</button></footer>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </>;
}

function ControlLesson({ done, onDone }: { done: boolean; onDone: () => void }) {
  const [taps, setTaps] = useState(0);
  useEffect(() => {
    let released = 0;
    let timer = 0;
    const forget = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setTaps(0), 900); };
    const down = (event: KeyboardEvent) => {
      if (event.code !== "AltLeft" || event.repeat) return;
      if (released && event.timeStamp - released <= DOUBLE_TAP_MS) { window.clearTimeout(timer); setTaps(2); onDone(); return; }
      setTaps(1);
      forget();
    };
    const up = (event: KeyboardEvent) => { if (event.code === "AltLeft") { released = event.timeStamp; forget(); } };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [onDone]);
  return <div className={`key-lesson ${done ? "done" : ""}`}>
    <div className="keycaps" aria-hidden="true">
      {[0, 1].map((index) => <kbd key={index} className={taps > index || done ? "lit" : ""}>{ALT_LABEL}<span>{IS_WINDOWS ? "alt" : "option"}</span></kbd>)}
    </div>
    <p role="status">{done ? "That is it — Shinbo is up." : taps ? "Again, quickly…" : `Tap the left ${IS_WINDOWS ? "Alt" : "Option"} key twice.`}</p>
  </div>;
}

const DITHER_TILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAP0lEQVR4nGP4////dyiugOLrUBwBwgzEKLCA4u1QLAHF00GYKAXHodgDip9DcQYIE6WAA4rboVgDipeDMEEFANAk3yGw5PAUAAAAAElFTkSuQmCC";

const SETUP_STEP_KEY = "shinbo.setupStep.v1";
const SETUP_STEPS = ["Connect", "Permissions", "Quick Ask"];

function SetupDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const resumed = useRef(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(() => { void window.shinbo.setupStatus().then(setStatus).catch((reason: unknown) => setError(reasonText(reason))); }, []);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  useEffect(() => { refresh(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [refresh]);
  const connectionReady = useCallback((value: boolean) => {
    setReady(value);
    if (!value || resumed.current) return;
    resumed.current = true;
    const saved = localStorage.getItem(SETUP_STEP_KEY);
    if (saved === "1" || saved === "2") setPage(Number(saved));
  }, []);
  useEffect(() => { heading.current?.focus(); }, [page]);
  const move = (next: number) => {
    if (busy || (next > 0 && !ready)) return;
    localStorage.setItem(SETUP_STEP_KEY, String(next));
    setPage(next);
    setError("");
  };
  const showQuickAsk = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await window.shinbo.demoQuickAsk(); setTapped(true); }
    catch (reason) { setError(reasonText(reason)); }
    finally { setBusy(false); }
  };
  const skip = () => { if (busy) return; localStorage.removeItem(SETUP_STEP_KEY); close(); };
  const finish = () => { if (ready) skip(); };
  const addProvider = useCallback(async (profile: ProviderProfile) => {
    const settings = loadSettings();
    const providers = [...settings.providers, profile];
    await window.shinbo.setProviders(providers);
    await window.shinbo.request("selectProviderModel", { providerId: profile.id, effort: settings.thinkingLevel });
    persistSettings({ ...settings, providers, selectedModel: `provider:${profile.id}` });
  }, []);
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="setup-title" onCancel={(event) => event.preventDefault()}>
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><filter id="setup-dither" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feImage href={DITHER_TILE} x="0" y="0" width="8" height="8" result="tile" /><feTile in="tile" result="bayer" />
      <feComposite in="SourceGraphic" in2="bayer" operator="arithmetic" k1="0" k2="4" k3="4" k4="-3.5" result="sum" />
      <feComponentTransfer in="sum" result="mask"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer>
      <feComposite in="SourceGraphic" in2="mask" operator="in" />
    </filter></svg>
    <section className="setup-dialog setup-guided" data-step={page}>
      <header className="setup-chrome"><Mark /></header>
      <div className="setup-content">
        <div className="setup-wash setup-welcome-wash" aria-hidden="true" />
        <ol className="setup-progress" aria-label="Setup progress">{SETUP_STEPS.map((label, index) => <li key={label} aria-current={index === page ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span> {label}</li>)}</ol>
        <header className="setup-intro">
          <h2 id="setup-title" ref={heading} tabIndex={-1} className={page < 2 ? "sr-only" : undefined}>{page === 0 ? "Connect Shinbo" : page === 1 ? "Permissions" : "Quick Ask"}</h2>
          <p>{page === 0 ? "Shinbo needs an OpenRouter key for its core features. Subscriptions are optional." : page === 1 ? "Grant what you need now, or set them up later in Settings → Permissions." : `Tap the left ${IS_WINDOWS ? "Alt" : "Option"} key twice to open Shinbo from any app.`}</p>
        </header>
        <div hidden={page !== 0}><ProviderGrid busy={busy} onReady={connectionReady} onAddProvider={addProvider} /></div>
        {page === 1 && <PermissionSettings busy={busy} onboarding />}
        {page === 2 && <section className="setup-lesson">
          <div className="setup-wash" aria-hidden="true" />
          <ControlLesson done={tapped} onDone={() => void showQuickAsk()} />
          <h3>Make Shinbo easy to reach.</h3>
          <p>{IS_WINDOWS ? "Try Quick Ask here, then use the shortcut from another app." : status?.accessibility ? "Accessibility is enabled. Try the shortcut from another app." : "Enable Accessibility in macOS so the shortcut works outside Shinbo. You can also keep using the main window."}</p>
          {!IS_WINDOWS && !status?.accessibility && <><button className="setup-button" type="button" onClick={() => void window.shinbo.openPrivacySettings("accessibility").catch((reason: unknown) => setError(reasonText(reason)))}>Enable Accessibility ↗</button><small>Setup resumes here once you have granted it.</small></>}
          <button className="setup-button" type="button" disabled={busy} onClick={() => void showQuickAsk()}>Show Quick Ask ↗</button>
        </section>}
        {error && <p className="dialog-error" role="alert">{error}</p>}
      </div>
      <div className="setup-actions">
          {page === 0 ? <p>{ready ? "OpenRouter is ready. Subscriptions can be added anytime." : "Verify your OpenRouter key to continue."}</p> : <button type="button" className="setup-link" disabled={busy} onClick={() => move(page - 1)}>← Back</button>}
          {page < 2 && <button type="button" className="setup-link" disabled={busy} onClick={skip}>Skip for now</button>}
          <button type="button" className="setup-primary" disabled={!ready || busy} onClick={() => page < 2 ? move(page + 1) : finish()}>{page < 2 ? "Continue →" : "Finish setup →"}</button>
      </div>
    </section>
  </dialog>;
}

const sendSecondModel = (id: SecondModelId, settings: UserSettings) => id === "verifier" ? window.shinbo.setVerifier(settings.verifier)
  : id === "tagger" ? window.shinbo.setTagger(settings.tagger)
  : window.shinbo.setToolSettings(settings.tools);

function RoleStrip({ settings, agent, role, onPick }: { settings: UserSettings; agent: string; role: SecondModelId | ""; onPick: (role: SecondModelId | "") => void }) {
  const tab = (id: SecondModelId | "", label: string, value: string) =>
    <button type="button" key={id || "agent"} role="tab" className="role-tab" aria-selected={role === id} onClick={() => onPick(id)}>
      <strong>{label}</strong><small>{value}</small>
    </button>;
  return <div className="role-strip" role="tablist" aria-label="What this model is for">
    {tab("", "Agent", modelKeyLabel(settings, agent))}
    {SECOND_MODEL_IDS.map((id) => tab(id, SECOND_MODELS[id].label, secondModelLabel(settings, id)))}
  </div>;
}

function ModelMenu({ ref, close, act, busy, onSettingsChanged, onManage, pinned }: { ref: RefObject<HTMLElement | null>; close: () => void; act: (method: string, params?: Record<string, string>) => Promise<unknown>; busy: boolean; onSettingsChanged: (settings: UserSettings) => void; onManage: () => void; pinned?: { key: string; onPick: (key: string, settings: UserSettings) => void | Promise<void> } }) {
  const [catalog, setCatalog] = useState<OpenRouterCatalog>();
  const [settings, setSettings] = useState(readSettings);
  const [error, setError] = useState("");
  const [roleId, setRoleId] = useState<SecondModelId | "">("");
  const codexSlugs = useCodexSlugs(catalog?.routes);
  const role = useMemo(() => {
    if (!roleId) return undefined;
    const spec = SECOND_MODELS[roleId];
    return { id: roleId, spec, ...secondModelView(spec.read(settings), settings.providers, settings.routers, catalog?.models ?? [], roleId === "vision" ? seesImages : undefined) };
  }, [roleId, settings, catalog]);
  useEffect(() => {
    void window.shinbo.request<OpenRouterCatalog>("listOpenRouterModels")
      .then(setCatalog)
      .catch((reason: unknown) => setError(reasonText(reason)));
  }, []);
  const choose = async (key: string, plan?: ModelPlan) => {
    if (busy) return;
    setError("");
    try {
      const routed = plan ? modelPlanRoute(settings, plan, key) : { settings, key };
      let current = routed.settings;
      if (current !== settings) {
        await window.shinbo.setProviders(current.providers);
        current = persistSettings(current);
        setSettings(current);
        onSettingsChanged(current);
      }
      if (pinned) { await pinned.onPick(routed.key, current); return; }
      const selected = await selectModelKey(current, routed.key, act);
      if (!selected) return;
      const next = persistSettings({ ...selected, thinkingLevel: "" });
      setSettings(next);
      onSettingsChanged(next);
    } catch (reason) { setError(reasonText(reason)); }
  };
  const star = (key: string) => {
    setError("");
    try {
      const next = persistSettings(toggleFavoriteModel(settings, key));
      setSettings(next);
      onSettingsChanged(next);
    } catch (reason) { setError(reasonText(reason)); }
  };
  const reorder = (favoriteModels: string[]) => {
    setError("");
    try {
      const next = persistSettings({ ...settings, favoriteModels });
      setSettings(next);
      onSettingsChanged(next);
    } catch (reason) { setError(reasonText(reason)); }
  };
  const chooseRole = async (key: string, plan?: ModelPlan) => {
    if (busy || !role) return;
    setError("");
    try {
      const draft = role.spec.read(settings);
      const next = persistSettings(role.spec.write(settings, secondModelFromPick(key, plan, role.pickerProviders, draft.system, settings.routers)));
      setSettings(next);
      onSettingsChanged(next);
      await sendSecondModel(role.id, next);
    } catch (reason) { setError(reasonText(reason)); }
  };
  const active = pinned ? pinned.key : settings.selectedModel;
  const entries = useMemo(() => {
    const all = modelEntries(settings.providers, catalog?.models ?? [], codexSlugs, catalog?.routes, active);
    const listed = pinned ? all.filter((entry) => entry.key.startsWith("openrouter:")) : all;
    if (!active || listed.some((entry) => modelEntryCurrent(entry, active, settings.providers))) return listed;
    const brand = modelKeyBrand(settings, active);
    return [{ maker: brand?.id ?? "other", key: active, name: modelKeyLabel(settings, active), detail: modelKeyRoute(settings, active), brand }, ...listed];
  }, [settings, catalog, codexSlugs, pinned, active]);
  return <section className="source-popover model-menu" ref={ref} role="dialog" aria-modal="false" aria-label="Model" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <ModelPicker key={roleId} label={role ? `${role.spec.label.toLowerCase()} models` : "models"} entries={role ? role.entries : entries} active={role ? role.natural : active} busy={busy} providers={role ? role.pickerProviders : settings.providers} codex={!role}
      favorites={role ? undefined : settings.favoriteModels} onStar={role ? undefined : star} onReorder={role ? undefined : reorder} routers={pinned && !role ? undefined : settings.routers}
      onPick={(key, plan) => { if (role) { void chooseRole(key, plan); return; } void choose(key, plan); }}
      strip={<RoleStrip settings={settings} agent={active} role={roleId} onPick={setRoleId} />}
      lead={role ? { key: "", name: role.spec.off, detail: "Off", brand: shinboBrand } : pinned ? { key: "", name: "Same as the workspace", detail: pinned.key ? selectedModelLabel(settings) : "Active", brand: shinboBrand } : undefined}>
      {!catalog && !error && <p className="model-menu-note">Loading the OpenRouter catalog…</p>}
      {error && <p className="capability-error" role="alert">{error}</p>}
      <div className="model-menu-foot"><button type="button" className="model-menu-row quiet" onClick={onManage}><span>All models, keys, and local profiles</span><b aria-hidden="true">↗</b></button></div>
    </ModelPicker>
  </section>;
}

const OVERLAY_DRAFT_KEY = "shinbo.overlayDraft.v1";
const SPARKLE_RAMP = " ·∙░▒▓";
const WAVE_ROWS = 2;
const ATTACHMENT_BAND = 60;
const SETTLE_MS = 700;
const ISLAND_BOTTOM = 97;
const ORB_DROP = 105;
const MAX_TRANSCRIPT = 260;
const MIGRATE_AFTER = 6;
const POPOUT_BAR = 28;
const PILL_LINGER_MS = 2400;
const PILL_FADE_MS = 320;

function NotchWave({ width, busy }: { width: number; busy: boolean }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setFrame((value) => value + 1), busy ? 55 : 90);
    return () => clearInterval(timer);
  }, [busy]);
  const columns = Math.max(12, Math.round(width / 6));
  const rows = Array.from({ length: WAVE_ROWS }, (_, row) => Array.from({ length: columns }, (_, column) => {
    const edge = 1 - Math.abs((column / (columns - 1)) * 2 - 1) ** (2.4 - row * 0.9);
    const tongue = 0.74 + 0.26 * Math.sin(column * 0.55 - frame * 0.7) * Math.sin(column * 0.19 + frame * 0.31);
    const flicker = Math.abs(Math.sin((column + 1) * 12.9898 + (row + 1) * 4.1414 + frame * (busy ? 1.4 : 0.9)));
    const level = Math.round(edge * tongue * (1 - row * 0.42) * SPARKLE_RAMP.length * (0.7 + flicker * 0.7));
    return SPARKLE_RAMP[Math.min(SPARKLE_RAMP.length - 1, Math.max(0, level))];
  }).join(""));
  return <div className={`notch-wave ${busy ? "busy" : ""}`} aria-hidden="true">{rows.map((row, index) => <span key={index}>{row}</span>)}</div>;
}

function readNotchQuery(fallbackWidth: number) {
  const query = new URLSearchParams(location.search);
  const read = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(query.get(key));
    return Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback;
  };
  return { left: read("notchLeft", 0, 0, 16_384), width: read("notchWidth", fallbackWidth, 40, 600), height: read("notchHeight", 32, 8, 120) };
}

export function orbLabel(command: CursorCommand, settings: UserSettings) {
  return /^[012]$/.test(command) ? settings.quickActions[Number(command)].label : cursorCommandNames[command];
}

function OrbRing({ commands, settings, selected, onPick, radius = 88 }: { commands: CursorCommand[]; settings: UserSettings; selected?: number; onPick: (index: number) => void; radius?: number }) {
  return <div className="radial" role={selected === undefined ? "menu" : "group"} aria-label={selected === undefined ? "Shinbo context commands" : "Cursor orb positions"}>
    {commands.map((command, index) => {
      const angle = (index / commands.length) * 2 * Math.PI - Math.PI / 2;
      const style = { left: `calc(50% + ${Math.round(Math.cos(angle) * radius)}px)`, top: `calc(50% + ${Math.round(Math.sin(angle) * radius)}px)` } as CSSProperties;
      const label = orbLabel(command, settings);
      const glyph = /^[012]$/.test(command) ? `${MODIFIER_LABEL}${Number(command) + 1}` : cursorCommandGlyphs[command];
      return <button type="button" key={index} role={selected === undefined ? "menuitem" : undefined} aria-pressed={selected === undefined ? undefined : selected === index} className={selected === index ? "selected" : ""} style={style} title={label} onClick={() => onPick(index)}><span className="orb" aria-hidden="true"><kbd>{glyph}</kbd></span><span className="orb-label">{label}</span></button>;
    })}
  </div>;
}

function RadialCommands() {
  const settings = useMemo(() => readSettings(), []);
  return <OrbRing commands={settings.cursorOrbs} settings={settings} onPick={(index) => window.shinbo.sendQuickCommand(settings.cursorOrbs[index])} />;
}

function NotchHotspot() {
  const [hover, setHover] = useState(false);
  const notch = useMemo(() => readNotchQuery(180), []);
  useEffect(() => window.shinbo.onNotchHover(setHover), []);
  const style = { "--notch-x": `${notch.left}px`, "--notch-w": `${notch.width}px`, "--notch-h": `${notch.height}px` } as CSSProperties;
  return <button className={`notch-hotspot ${hover ? "open" : ""}`} style={style} onClick={() => window.shinbo.openOverlay()} aria-label="Open Shinbo Quick Ask">
    {hover && <NotchWave width={notch.width} busy={false} />}
  </button>;
}

function useNotchSwipe(notch: { left: number; width: number; height: number }, bottom: number) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = (event: MouseEvent) => {
      const drop = event.clientY - notch.height;
      const inside = drop >= bottom - 6 && drop <= bottom + ORB_DROP
        && Math.abs(event.clientX - (notch.left + notch.width / 2)) <= notch.width / 2 + 60 + Math.max(0, drop - bottom) * 1.7;
      if (inside) { clearTimeout(timer); timer = undefined; setOpen(true); }
      else if (!timer) timer = setTimeout(() => setOpen(false), 260);
    };
    addEventListener("mousemove", move);
    return () => { removeEventListener("mousemove", move); clearTimeout(timer); };
  }, [bottom, notch.height, notch.left, notch.width]);
  return open;
}

type QuickTurn = { role: "user" | "assistant"; content: string; steps?: ThreadStep[]; choices?: { label: string; run: () => void }[] };

function StatusPill({ status, label }: { status: "working" | "error" | "done"; label: string }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (status !== "done") return;
    const fade = setTimeout(() => setLeaving(true), PILL_LINGER_MS);
    const gone = setTimeout(() => window.shinbo.dismissOverlay(), PILL_LINGER_MS + PILL_FADE_MS);
    return () => { clearTimeout(fade); clearTimeout(gone); };
  }, [status]);
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.screenX - window.screenX, y: event.screenY - window.screenY, moved: false };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const grab = drag.current;
    if (!grab) return;
    const next = { x: event.screenX - grab.x, y: event.screenY - grab.y };
    if (!grab.moved && Math.abs(next.x - window.screenX) + Math.abs(next.y - window.screenY) < 3) return;
    grab.moved = true;
    window.shinbo.movePill(next);
  };
  const up = () => {
    const grab = drag.current;
    drag.current = undefined;
    if (grab && !grab.moved) window.shinbo.expandPill();
  };
  return <button
    type="button"
    className={`status-pill ${status} ${leaving ? "leaving" : ""}`}
    title={label}
    aria-label={`Shinbo — ${label}. Open the quick thread here`}
    onPointerDown={down}
    onPointerMove={move}
    onPointerUp={up}
  ><Mark /></button>;
}

function Overlay() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState(() => localStorage.getItem(OVERLAY_DRAFT_KEY) ?? "");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(readSettings);
  const [annotationId, setAnnotationId] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [attachedApp, setAttachedApp] = useState("");
  const [modelsOpen, setModelsOpen] = useState(false);
  const modelMenu = useRef<HTMLElement>(null);
  const [menuBand, setMenuBand] = useState(0);
  const [mode, setMode] = useState<PermissionMode>(() => overlayMode(settings.defaultPermissionMode));
  const pickMode = useCallback((next: PermissionMode) => { setMode(next); setOverlayMode(next); }, []);
  const [modesOpen, setModesOpen] = useState(false);
  const modeMenu = useRef<HTMLDivElement>(null);
  const thinkMenu = useRef<HTMLDivElement>(null);
  const thinkTrigger = useRef<HTMLButtonElement>(null);
  const [modeBand, setModeBand] = useState(0);
  const [thread, setThread] = useState<Thread>();
  const [turns, setTurns] = useState<QuickTurn[]>([]);
  const [surface, setSurface] = useState<OverlaySurface>(() => {
    const opened = new URLSearchParams(location.search).get("surface");
    return opened === "pill" || opened === "popout" ? opened : "notch";
  });
  const notch = useMemo(() => readNotchQuery(settings.notchGap), [settings.notchGap]);
  const [grow, setGrow] = useState(0);
  const [fieldBand, setFieldBand] = useState(0);
  const transcript = useRef<HTMLDivElement>(null);
  const { skills, tools, atItems, folders, files } = useTaskCommands(settings.tools.disabledTools);
  const [servers, setServers] = useState<SlashCommand[]>([]);
  const [caret, setCaret] = useState(0);
  const [slashPick, setSlashPick] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashBand, setSlashBand] = useState(0);
  const [thinkBand, setThinkBand] = useState(0);
  const [thinkOpen, setThinkOpen] = useState(false);
  const slashMenu = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [stream, setStream] = useState<{ text: string; steps: ThreadStep[] }>({ text: "", steps: [] });
  const live = useRef("");
  const liveSteps = useRef<ThreadStep[]>([]);
  const orbs = useNotchSwipe(notch, ISLAND_BOTTOM + grow) && settings.notchCommandsEnabled && surface === "notch";
  const modelKey = settings.notchModel || settings.selectedModel;
  const effort: ThinkingLevel = settings.notchModel ? "" : settings.thinkingLevel;
  const { contextTokens } = useSelectedModel(settings, modelKey);
  const session = useRef(0);
  const running = useRef(0);
  const startRun = useCallback(() => { running.current += 1; window.shinbo.setOverlayBusy(true); }, []);
  const endRun = useCallback(() => { running.current = Math.max(0, running.current - 1); window.shinbo.setOverlayBusy(running.current > 0); }, []);
  const rate = latestRate(thread);
  const screenContextId = validScreenContextId(annotationId) ? annotationId : undefined;
  useEffect(() => window.shinbo.onOverlaySurface(setSurface), []);
  useEffect(() => {
    if (message) localStorage.setItem(OVERLAY_DRAFT_KEY, message);
    else localStorage.removeItem(OVERLAY_DRAFT_KEY);
  }, [message]);
  useEffect(() => {
    let active = true;
    void window.shinbo.listImportedMcpServers()
      .then((imported: ImportedMcpServer[]) => { if (active) setServers(imported.map((item) => ({ id: item.id, name: item.name, kind: "mcp" as const, detail: `${item.source} · MCP server` }))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const offDelta = window.shinbo.onDelta(({ threadId, delta, thinking }) => {
      if (threadId !== live.current || thinking) return;
      setStream((current) => ({ ...current, text: delta ? current.text + delta : "" }));
    });
    const offStep = window.shinbo.onStep((step) => {
      if (step.threadId !== live.current) return;
      liveSteps.current = [...liveSteps.current.filter((item) => item.toolCallId !== step.toolCallId), step];
      setStream((current) => ({ ...current, steps: liveSteps.current }));
    });
    return () => { offDelta(); offStep(); };
  }, []);
  const startStream = useCallback((threadId: string) => { live.current = threadId; liveSteps.current = []; setStream({ text: "", steps: [] }); }, []);
  const endStream = useCallback(() => { live.current = ""; setStream({ text: "", steps: [] }); }, []);
  const applyMode = useCallback(async (threadId: string) => {
    setThreadMode(threadId, mode);
    await window.shinbo.setThreadContext({ threadId, folderIds: [], mode, model: modelKey }).catch(() => undefined);
  }, [mode, modelKey]);
  useEffect(() => window.shinbo.onNewQuickSession(() => {
    session.current += 1;
    running.current = 0;
    window.shinbo.setOverlayBusy(false);
    endStream();
    setThread(undefined);
    setTurns([]);
    setBusy(false);
    setError("");
  }), [endStream, setError]);
  useEffect(() => { if (thread) void applyMode(thread.id); }, [applyMode, thread]);
  const slash = busy || slashDismissed ? null : slashQuery(message, caret);
  const slashMatches = slash ? matchCommands(slash.sigil === "@" ? atItems : [...skills, ...servers, ...tools], slash.query).slice(0, MENU_MAX) : [];
  const slashOpen = slash !== null;
  const slashActive = Math.min(slashPick, slashMatches.length - 1);
  const pickCommand = (command: SlashCommand) => {
    if (!slash) return;
    const next = insertCommand(message, slash, command.name);
    setMessage(next.text);
    setSlashPick(0);
    queueMicrotask(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); setCaret(next.caret); });
  };
  const composerKeys = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (slashOpen) {
      if (event.key === "Escape") { event.preventDefault(); setSlashDismissed(true); return; }
      if (slashMatches.length) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSlashPick((current) => (Math.min(current, slashMatches.length - 1) + (event.key === "ArrowDown" ? 1 : slashMatches.length - 1)) % slashMatches.length); return; }
        if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pickCommand(slashMatches[slashActive]); return; }
      }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  };
  const send = async (event?: FormEvent, text?: string) => {
    event?.preventDefault();
    const content = (text ?? message).trim();
    if (!content) return;
    if (text === undefined) { localStorage.removeItem(OVERLAY_DRAFT_KEY); setMessage(""); }
    startRun();
    setBusy(true); setError("");
    const mine = session.current;
    let active = thread;
    const previousMessageCount = active?.messages.length ?? 0;
    try {
      if (!active) { active = await window.shinbo.request<Thread>("createThread"); if (session.current !== mine) return; setThread(active); }
      setTurns((list) => [...list, { role: "user", content }]);
      await applyMode(active.id);
      if (session.current !== mine) return;
      startStream(active.id);
      const named = mentions(content, "/");
      const skill = named.length ? skills.find((item) => named.includes(item.name)) : undefined;
      const attachedSkill = skill ? await window.shinbo.selectImportedSkill({ id: skill.id, threadId: active.id }).catch(() => undefined) : undefined;
      const paths = mentions(content, "@");
      const picks = atItems.filter((item) => item.pick && paths.includes(item.name)).map((item) => item.pick!);
      const attached = picks.length ? await buildAttachedContext(folders, [], picks, files) : { text: "", images: [] };
      const turn = await window.shinbo.request<Thread>("sendMessage", {
        threadId: active.id,
        content,
        ...(attached.text ? { attachedContext: attached.text } : {}),
        ...(attached.images.length ? { attachedImages: JSON.stringify(attached.images) } : {}),
        ...(attachedSkill ? { skillAttachmentId: attachedSkill.id } : {}),
        ...(screenContextId ? { screenContextId } : {}),
      });
      if (session.current !== mine) return;
      setThread(turn);
      setTurns((list) => [...list, { role: "assistant", content: latestReply(turn), steps: liveSteps.current }]);
      if (screenContextId) { setAnnotationId(""); setThumbnail(""); setAttachedApp(""); }
    } catch (reason) {
      if (session.current !== mine) return;
      const latest = active ? await window.shinbo.request<Thread>("thread", { threadId: active.id }).catch(() => undefined) : undefined;
      if (!active || !latest || !hasPersistedPrompt(latest, previousMessageCount, content)) {
        localStorage.setItem(OVERLAY_DRAFT_KEY, content);
        setMessage(content);
      }
      setError(reasonText(reason));
    } finally {
      if (session.current === mine) { endRun(); endStream(); setBusy(false); }
    }
  };
  const dictation = useDictation(settings, useCallback((text: string) => setMessage((current) => current ? `${current.trimEnd()} ${text}` : text), []));
  const { listening, working: transcribing, refresh: refreshVoice, start: startVoice, stop: stopVoice } = dictation;
  const dictate = useCallback(async () => {
    if (listening) { await stopVoice(); return; }
    const status = await refreshVoice();
    if (!voiceReady(status, settings)) { window.shinbo.openWorkspace("voice"); return; }
    await startVoice();
  }, [listening, refreshVoice, settings, startVoice, stopVoice]);
  const runAction = useCallback(async (index: number) => {
    const action = settings.quickActions[index];
    if (!action || busy) return;
    startRun();
    setBusy(true); setError("");
    const mine = session.current;
    setTurns((list) => [...list, { role: "user", content: action.label || action.prompt }]);
    try {
      const created = await window.shinbo.request<Thread>("createThread");
      await applyMode(created.id);
      if (session.current !== mine) return;
      startStream(created.id);
      const answered = await window.shinbo.request<Thread>("sendMessage", { threadId: created.id, content: action.prompt, ...(screenContextId ? { screenContextId } : {}) });
      if (session.current !== mine) return;
      setTurns((list) => [...list, { role: "assistant", content: latestReply(answered), steps: liveSteps.current }]);
      if (screenContextId) { setAnnotationId(""); setThumbnail(""); setAttachedApp(""); }
    } catch (reason) { if (session.current === mine) setError(reasonText(reason)); }
    finally { if (session.current === mine) { endRun(); endStream(); setBusy(false); } }
  }, [applyMode, busy, endRun, endStream, screenContextId, settings, startRun, startStream]);
  useSpaceHold(settings.voiceHoldMs, dictation.ready && !busy && !transcribing && !message.trim(), dictation);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && /^[123]$/.test(event.key)) { event.preventDefault(); void runAction(Number(event.key) - 1); } }; addEventListener("keydown", listener); return () => removeEventListener("keydown", listener); }, [runAction]);
  useEffect(() => { const reload = () => setSettings(readSettings()); addEventListener("storage", reload); addEventListener("focus", reload); return () => { removeEventListener("storage", reload); removeEventListener("focus", reload); }; }, []);
  useEffect(() => {
    const show = (status: { id: string; image: string; source?: { application: string } } | null) => {
      setAnnotationId(status?.id ?? "");
      setThumbnail(status?.image ?? "");
      setAttachedApp(status?.source?.application ?? "");
    };
    void window.shinbo.screenAnnotationStatus().then(show).catch(() => show(null));
    return window.shinbo.onScreenContext(show);
  }, []);
  useEffect(() => {
    const node = transcript.current;
    if (!node) return;
    const height = Math.min(MAX_TRANSCRIPT, node.scrollHeight + menuBand + modeBand + slashBand + thinkBand + fieldBand + (annotationId ? ATTACHMENT_BAND : 0));
    setGrow(height);
    window.shinbo.setOverlayHeight(height);
    node.scrollTop = node.scrollHeight;
  }, [turns, busy, stream, menuBand, modeBand, slashBand, thinkBand, fieldBand, annotationId, surface]);
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    const base = node.offsetHeight;
    const observer = new ResizeObserver(() => setFieldBand(Math.max(0, node.offsetHeight - base)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!busy) input.current?.focus(); }, [busy]);
  useEffect(() => {
    const node = modelMenu.current;
    if (!node) { setMenuBand(0); return; }
    const observer = new ResizeObserver(() => setMenuBand(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [modelsOpen]);
  useEffect(() => {
    const node = modeMenu.current;
    if (!node) { setModeBand(0); return; }
    const observer = new ResizeObserver(() => setModeBand(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [modesOpen]);
  useEffect(() => {
    const node = thinkMenu.current;
    if (!node) { setThinkBand(0); return; }
    const observer = new ResizeObserver(() => setThinkBand(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [thinkOpen]);
  useEffect(() => {
    if (!thinkOpen) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!thinkMenu.current?.contains(node) && !thinkTrigger.current?.contains(node)) setThinkOpen(false);
    };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [thinkOpen]);
  useEffect(() => {
    const node = slashMenu.current;
    if (!node) { setSlashBand(0); return; }
    const observer = new ResizeObserver(() => setSlashBand(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [slashOpen]);
  const detached = surface === "popout";
  const overlayStyle ={ "--notch-x": `${notch.left}px`, "--notch-w": `${detached ? 0 : notch.width}px`, "--notch-h": `${detached ? POPOUT_BAR : notch.height}px`, "--island-h": `${ISLAND_BOTTOM + grow}px` } as CSSProperties;
  const working = stream.steps.filter((step) => step.status === "pending" || step.status === "in_progress").at(-1)?.title || "Working";
  const startDrawing = async () => { try { await window.shinbo.startScreenAnnotation(); } catch (reason) { setError(reasonText(reason)); } };
  const pickModel = useCallback((key: string, current: UserSettings) => {
    try { setSettings(persistSettings({ ...current, notchModel: key })); }
    catch (reason) { setError(reasonText(reason)); }
  }, [setError]);
  const act = useCallback(async (method: string, params: Record<string, string> = {}) => {
    try { return await window.shinbo.request<unknown>(method, params); }
    catch (reason) { setError(reasonText(reason)); return undefined; }
  }, [setError]);
  const { stops: thinkingStopsHere, setLevel: setThinkingHere } = useThinking(act, setSettings);
  const clearDrawing = async () => { if (!annotationId) return; await window.shinbo.clearScreenAnnotation(annotationId); setAnnotationId(""); setThumbnail(""); setAttachedApp(""); };
  const captureScreen = useCallback(async () => {
    try {
      const captured = await window.shinbo.captureScreenContext();
      setThumbnail(captured.image);
      setAnnotationId(captured.id);
      setAttachedApp(captured.source?.application ?? "");
    } catch (reason) { setError(reasonText(reason)); }
  }, [setError]);
  const saveScreen = useCallback(async () => {
    if (busy) return;
    startRun();
    setBusy(true); setError("");
    const mine = session.current;
    setTurns((list) => [...list, { role: "user", content: "Save what I'm looking at" }]);
    const steps: ThreadStep[] = [];
    const mark = (toolCallId: string, title: string, kind: string, status: ThreadStep["status"]) => {
      const index = steps.findIndex((item) => item.toolCallId === toolCallId);
      const step = { threadId: "", toolCallId, title, kind, status, at: Date.now() };
      if (index === -1) steps.push(step); else steps[index] = step;
      setStream({ text: "", steps: [...steps] });
    };
    try {
      mark("capture", "Taking a screenshot", "read", "in_progress");
      const captured = await window.shinbo.captureScreenContext();
      if (session.current !== mine) return;
      setThumbnail(captured.image);
      setAnnotationId(captured.id);
      setAttachedApp(captured.source?.application ?? "");
      mark("capture", `Captured ${captured.source?.window || captured.source?.application || "the screen"}`, "read", "completed");
      mark("read", "Reading the screenshot and the window it came from", "search", "in_progress");
      const note = await window.shinbo.keepScreen(captured.id);
      if (session.current !== mine) return;
      mark("read", `Read ${note.sourceUrl || note.sourceApplication || "the screen"}`, "search", "completed");
      mark("keep", `Kept ${note.relative}`, "edit", "completed");
      setTurns((list) => [...list, { role: "assistant", content: `Saved “${note.title}”${note.tags.length ? ` · ${note.tags.join(" · ")}` : ""}`, steps: [...steps] }]);
    } catch (reason) {
      const failed = steps.find((step) => step.status === "in_progress");
      if (failed) mark(failed.toolCallId, failed.title, failed.kind, "failed");
      if (session.current === mine) setError(reasonText(reason));
    }
    finally { endStream(); if (session.current === mine) { endRun(); setBusy(false); } }
  }, [busy, endRun, endStream, setError, startRun]);
  const runCommand = useCallback((value: string) => {
    if (value === "voice") { void dictate(); return; }
    if (/^[012]$/.test(value)) void runAction(Number(value));
    else if (value === "page" || value === "keep") void saveScreen();
    else if (value === "screen") void captureScreen();
    else if (value === "draw") void window.shinbo.startScreenAnnotation().catch((reason: unknown) => setError(reasonText(reason)));
    else if (value === "workspace") window.shinbo.openWorkspace();
  }, [captureScreen, saveScreen, dictate, runAction, setError]);
  useEffect(() => window.shinbo.onQuickCommand(runCommand), [runCommand]);
  const started = useRef(false);
  useEffect(() => {
    const command = new URLSearchParams(location.search).get("command");
    if (!command || started.current) return;
    started.current = true;
    runCommand(command);
  }, [runCommand]);
  if (surface === "pill") {
    const state = busy ? "working" : error ? "error" : "done";
    return <StatusPill key={state} status={state} label={busy ? working : error || "Done"} />;
  }
  return <main className={`overlay ${detached ? "detached" : ""}`} style={overlayStyle} role="dialog" aria-label="Shinbo quick thread">
    <Region name="notch" props={{
      turns, busy, error, stream, status: working, ask: (text: string) => void send(undefined, text),
      open: () => window.shinbo.openWorkspace(),
    }}>
    <div className={`island ${orbs ? "dimmed" : ""}`}>
      <header className="island-bar"><div className="brand"><ShinboMark /><strong>Shinbo</strong></div><span className="island-housing" /><span className="island-status"><i /> {listening ? "Listening" : transcribing ? "Transcribing" : busy ? working : "Quick thread"}</span></header>
      <div className="island-body">
        {annotationId && <div className="annotation-chip">{thumbnail && <img src={thumbnail} alt={attachedApp ? `Screen capture of ${attachedApp}` : "Screen capture"} title={attachedApp} />}<button type="button" onClick={() => void clearDrawing()} aria-label="Discard screen markup">×</button></div>}
        <form onSubmit={(event) => void send(event)}><label className="sr-only" htmlFor="quick-message">Ask Shinbo</label><textarea ref={input} autoFocus disabled={busy} id="quick-message" value={message} maxLength={COMPOSER_MAX} role="combobox" aria-expanded={slashOpen} aria-controls="island-slash-menu" aria-autocomplete="list" onChange={(event) => { setMessage(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setSlashDismissed(false); setSlashPick(0); }} onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)} onKeyDown={composerKeys} placeholder="Ask Shinbo anything…" rows={1} /><div className="overlay-actions"><button type="button" onClick={() => void startDrawing()} disabled={busy} title="Draw yellow highlights over the screen" aria-label="Draw on screen">✎</button><button type="button" className={listening ? "voice-live" : ""} onClick={() => void dictate()} disabled={busy || transcribing} title={dictation.ready ? listening ? "Stop listening" : `Dictate — or hold space for ${settings.voiceHoldMs}ms` : `${dictation.blocker} — set voice up in the workspace`} aria-label={listening ? "Stop listening" : "Dictate"}>●</button><button className="send" disabled={busy || !message.trim()} aria-label="Send">{busy ? "···" : <SendIcon />}</button></div></form>
        {(error || dictation.error) && <button className="overlay-error" onClick={() => { setError(""); dictation.setError(""); }}>{error || dictation.error} ×</button>}
      </div>
      {slashOpen && <section className="source-popover slash-menu" ref={slashMenu} id="island-slash-menu" role="listbox" aria-label={slash?.sigil === "@" ? "Artifacts, saved notes and files" : "Built-in tools, skills and MCP servers"}>
        {slashMatches.map((item, index) => <button type="button" role="option" aria-selected={index === slashActive} className={`slash-row ${index === slashActive ? "active" : ""}`} key={`${item.kind}-${item.id}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSlashPick(index)} title={item.detail} onClick={() => pickCommand(item)}><strong>{slash?.sigil ?? "/"}{item.name}</strong><em className="slash-kind" data-kind={item.kind}>{KIND_LABELS[item.kind]}</em><small>{item.detail}</small></button>)}
        {!slashMatches.length && <p className="slash-empty">{slash?.query ? `Nothing matches “${slash.query}”.` : slash?.sigil === "@" ? "Nothing to add yet — connect a folder, save a note or make an artifact." : "Nothing to run yet."} {slash?.sigil === "@" ? "Artifacts, saved notes and the files of granted folders appear here." : "Built-in tools and MCP servers appear here."}</p>}
      </section>}
      <div className="island-thread" ref={transcript}>
        {turns.map((turn, index) => <Fragment key={index}>
          <p className={turn.role}><b>{turn.role === "assistant" ? "Shinbo" : "You"}</b>{turn.role === "assistant" ? splitThinking(turn.content).answer : turn.content}</p>
          {turn.steps?.length ? <Steps steps={turn.steps} /> : null}
          {turn.choices?.length ? <div className="turn-choices">{turn.choices.map((choice) => <button type="button" key={choice.label} disabled={busy} onClick={choice.run}>{choice.label}</button>)}</div> : null}
        </Fragment>)}
        {busy && <><p className="assistant"><b>Shinbo</b>{splitThinking(stream.text).answer || "···"}</p><Steps steps={stream.steps} /></>}
        {turns.length >= MIGRATE_AFTER && <button type="button" className="island-migrate" onClick={() => window.shinbo.openWorkspace(undefined, thread?.id)}>Getting long — continue in the full app →</button>}
      </div>
      {modelsOpen && <ModelMenu ref={modelMenu} close={() => setModelsOpen(false)} act={act} busy={busy} onSettingsChanged={setSettings} onManage={() => window.shinbo.openWorkspace()} pinned={settings.notchModel ? { key: settings.notchModel, onPick: pickModel } : undefined} />}
      {modesOpen && <ModeMenu ref={modeMenu} mode={mode} setMode={pickMode} close={() => setModesOpen(false)} />}
      {thinkOpen && !settings.notchModel && <ThinkingMenu ref={thinkMenu} level={effort} stops={thinkingStopsHere} close={() => { setThinkOpen(false); thinkTrigger.current?.focus(); }} setLevel={setThinkingHere} />}
      <footer className="island-foot">
        <div className="mode-picker" data-mode={mode}><ModeTrigger mode={mode} open={modesOpen} onToggle={() => { setModesOpen((open) => !open); setModelsOpen(false); }} /></div>
        <span className="island-model"><button type="button" className="model-button" disabled={busy} aria-haspopup="dialog" aria-expanded={modelsOpen} aria-label={`Select model, currently ${modelKeyLabel(settings, modelKey)}`} onClick={() => { setModelsOpen((open) => !open); setModesOpen(false); }}><BrandIcon brand={modelKeyBrand(settings, modelKey)} className="model-brand" /><span className="model-label">{modelKeyLabel(settings, modelKey)}</span><span aria-hidden="true">▾</span></button>{!settings.notchModel && thinkingStopsHere.length > 1 && <ThinkingChip ref={thinkTrigger} level={thinkingStopsHere.includes(effort) ? effort : ""} stops={thinkingStopsHere} open={thinkOpen} disabled={busy} onToggle={() => { setThinkOpen((open) => !open); setModelsOpen(false); setModesOpen(false); }} />}</span>
        <span className="island-stats"><span title="Context window of the selected model">{contextTokens ? `${Math.round(contextTokens / 1000)}K ctx` : "— ctx"}</span><span title="Output tokens per second of the last answer">{rate ? `${rate} tok/s` : "— tok/s"}</span></span>
      </footer>
    </div>
    </Region>
    <div className={`command-orbs ${orbs ? "open" : ""}`}>{settings.quickActions.map((action, index) => <button key={index} onClick={() => void runAction(index)} disabled={busy} title={action.prompt}><span className="orb" aria-hidden="true"><kbd>{MODIFIER_LABEL}{index + 1}</kbd></span>{action.label}</button>)}</div>
  </main>;
}

export default App;
