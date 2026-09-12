import { contextBridge, ipcRenderer } from "electron";
import type { ThreadStep } from "../shared/agents";
import type { KeepRequest, VaultKind } from "../shared/vault";
import type { GoalStatus } from "../shared/goal";
import type { CouncilStart, CouncilState } from "../shared/council";
import type { ShortcutRequest, VerifierSettings } from "../shared/settings";

let nextListener = 1;
const listeners = new Map<number, () => void>();

const platform = typeof process === "object" && typeof process.platform === "string" ? process.platform : typeof navigator === "object" && /Windows/i.test(navigator.userAgent) ? "win32" : "darwin";

contextBridge.exposeInMainWorld("shinbo", {
  platform,
  request: (method: string, params: Record<string, string> = {}) =>
    ipcRenderer.invoke("shinbo:request", { method, params }),
  setOverlayPreferences: (value: unknown) => ipcRenderer.invoke("shinbo:set-overlay-preferences", value),
  setOverlayBusy: (value: boolean) => ipcRenderer.send("shinbo:set-overlay-busy", value),
  setKeybinds: (value: unknown) => ipcRenderer.invoke("shinbo:set-keybinds", value),
  onShortcutRequest: (listener: (value: ShortcutRequest & { id: string }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const request = value as Partial<ShortcutRequest> & { id?: unknown };
      if (typeof request.id === "string" && typeof request.accelerator === "string" && typeof request.label === "string" && typeof request.prompt === "string") listener(request as ShortcutRequest & { id: string });
    };
    ipcRenderer.on("shinbo:shortcut-request", wrapped);
    return () => ipcRenderer.removeListener("shinbo:shortcut-request", wrapped);
  },
  completeShortcutRequest: (value: unknown) => ipcRenderer.invoke("shinbo:complete-shortcut-request", value),
  openOverlay: () => ipcRenderer.send("shinbo:open-overlay"),
  setOverlayHeight: (value: number) => ipcRenderer.send("shinbo:set-overlay-height", value),
  onOverlaySurface: (listener: (value: "notch" | "pill" | "popout") => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (value === "notch" || value === "pill" || value === "popout") listener(value); };
    ipcRenderer.on("shinbo:overlay-surface", wrapped);
    return () => ipcRenderer.removeListener("shinbo:overlay-surface", wrapped);
  },
  movePill: (value: { x: number; y: number }) => ipcRenderer.send("shinbo:move-pill", value),
  expandPill: () => ipcRenderer.send("shinbo:expand-pill"),
  dismissOverlay: () => ipcRenderer.send("shinbo:dismiss-overlay"),
  openWorkspace: (settingsPage?: string) => ipcRenderer.send("shinbo:open-workspace", settingsPage),
  resyncWindow: () => ipcRenderer.send("shinbo:resync-window"),
  voiceStatus: (settings: unknown) => ipcRenderer.invoke("shinbo:voice-status", settings),
  transcribe: (value: { audio: ArrayBuffer; mimeType: string; settings: unknown }) => ipcRenderer.invoke("shinbo:transcribe", value),
  onOpenSettings: (listener: (page: string) => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (typeof value === "string") listener(value); };
    ipcRenderer.on("shinbo:open-settings", wrapped);
    return () => ipcRenderer.removeListener("shinbo:open-settings", wrapped);
  },
  sendQuickCommand: (value: string) => ipcRenderer.send("shinbo:quick-command", value),
  onQuickCommand: (listener: (value: string) => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (typeof value === "string") listener(value); };
    ipcRenderer.on("shinbo:quick-command", wrapped);
    return () => ipcRenderer.removeListener("shinbo:quick-command", wrapped);
  },
  onNewQuickSession: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:new-quick-session", wrapped);
    return () => ipcRenderer.removeListener("shinbo:new-quick-session", wrapped);
  },
  onNotchHover: (listener: (value: boolean) => void) => {
    const wrapped = (_event: unknown, value: unknown) => listener(value === true);
    ipcRenderer.on("shinbo:notch-hover", wrapped);
    return () => ipcRenderer.removeListener("shinbo:notch-hover", wrapped);
  },
  updateReady: () => ipcRenderer.invoke("shinbo:update-ready"),
  installUpdate: () => ipcRenderer.invoke("shinbo:install-update"),
  onUpdateReady: (listener: (value: string) => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (typeof value === "string") listener(value); };
    ipcRenderer.on("shinbo:update-ready", wrapped);
    return () => ipcRenderer.removeListener("shinbo:update-ready", wrapped);
  },
  onActivity: (listener: (value: { threadId: string }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const activity = value as { threadId?: unknown } | null;
      if (typeof activity?.threadId === "string" && activity.threadId) listener({ threadId: activity.threadId });
    };
    ipcRenderer.on("shinbo:activity", wrapped);
    return () => ipcRenderer.removeListener("shinbo:activity", wrapped);
  },
  onDelta: (listener: (value: { threadId: string; delta: string; thinking?: boolean; recovery?: boolean }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const chunk = value as { threadId?: unknown; delta?: unknown; thinking?: unknown; recovery?: unknown };
      if (typeof chunk?.threadId === "string" && typeof chunk.delta === "string") listener({ threadId: chunk.threadId, delta: chunk.delta, thinking: chunk.thinking === true, recovery: chunk.recovery === true });
    };
    ipcRenderer.on("shinbo:delta", wrapped);
    return () => ipcRenderer.removeListener("shinbo:delta", wrapped);
  },
  onStep: (listener: (value: ThreadStep) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const step = value as Partial<ThreadStep>;
      if (typeof step?.threadId === "string" && typeof step.toolCallId === "string") listener(step as ThreadStep);
    };
    ipcRenderer.on("shinbo:step", wrapped);
    return () => ipcRenderer.removeListener("shinbo:step", wrapped);
  },
  onCompacted: (listener: (value: { threadId: string; removedTurns: number; summaryChars: number; modelWritten: boolean; fresh: boolean; handoff?: string; historyChars?: number }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const compacted = value as { threadId?: unknown; removedTurns?: unknown; summaryChars?: unknown; modelWritten?: unknown; fresh?: unknown; handoff?: unknown; historyChars?: unknown };
      if (typeof compacted?.threadId === "string") listener({ threadId: compacted.threadId, removedTurns: Number(compacted.removedTurns) || 0, summaryChars: Number(compacted.summaryChars) || 0, modelWritten: compacted.modelWritten === true, fresh: compacted.fresh === true, ...(typeof compacted.handoff === "string" ? { handoff: compacted.handoff } : {}), ...(typeof compacted.historyChars === "number" && Number.isSafeInteger(compacted.historyChars) && compacted.historyChars >= 0 ? { historyChars: compacted.historyChars } : {}) });
    };
    ipcRenderer.on("shinbo:compacted", wrapped);
    return () => ipcRenderer.removeListener("shinbo:compacted", wrapped);
  },
  onContextExperiment: (listener: (value: { threadId: string; prunedResults: number; reinjected: boolean; savedTokens: number; addedTokens: number; checkpoint?: string }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const fired = value as { threadId?: unknown; prunedResults?: unknown; reinjected?: unknown; savedTokens?: unknown; addedTokens?: unknown; checkpoint?: unknown };
      if (typeof fired?.threadId === "string") listener({ threadId: fired.threadId, prunedResults: Number(fired.prunedResults) || 0, reinjected: fired.reinjected === true, savedTokens: Number(fired.savedTokens) || 0, addedTokens: Number(fired.addedTokens) || 0, ...(typeof fired.checkpoint === "string" ? { checkpoint: fired.checkpoint } : {}) });
    };
    ipcRenderer.on("shinbo:context-experiment", wrapped);
    return () => ipcRenderer.removeListener("shinbo:context-experiment", wrapped);
  },
  onRoutedModel: (listener: (value: { threadId: string; model: string; fellBack: boolean; skipped: string[] }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const routed = value as { threadId?: unknown; model?: unknown; fellBack?: unknown; skipped?: unknown };
      const skipped = Array.isArray(routed?.skipped) ? routed.skipped.filter((id): id is string => typeof id === "string") : [];
      if (typeof routed?.threadId === "string" && typeof routed.model === "string") listener({ threadId: routed.threadId, model: routed.model, fellBack: routed.fellBack === true, skipped });
    };
    ipcRenderer.on("shinbo:routed-model", wrapped);
    return () => ipcRenderer.removeListener("shinbo:routed-model", wrapped);
  },
  onContextBreakdown:(listener: (value: { threadId: string; systemPromptBytes: number; systemToolsBytes: number; mcpToolsBytes: number; skillsBytes: number; memoryBytes: number }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const parts = value as { threadId?: unknown; systemPromptBytes?: unknown; systemToolsBytes?: unknown; mcpToolsBytes?: unknown; skillsBytes?: unknown; memoryBytes?: unknown };
      if (typeof parts?.threadId === "string") listener({ threadId: parts.threadId, systemPromptBytes: Number(parts.systemPromptBytes) || 0, systemToolsBytes: Number(parts.systemToolsBytes) || 0, mcpToolsBytes: Number(parts.mcpToolsBytes) || 0, skillsBytes: Number(parts.skillsBytes) || 0, memoryBytes: Number(parts.memoryBytes) || 0 });
    };
    ipcRenderer.on("shinbo:context-breakdown", wrapped);
    return () => ipcRenderer.removeListener("shinbo:context-breakdown", wrapped);
  },
  startScreenAnnotation: () => ipcRenderer.invoke("shinbo:start-screen-annotation"),
  onScreenContext: (listener: (value: { id: string; image: string; source?: { application: string; window: string } } | null) => void) => {
    const wrapped = (_event: unknown, value: unknown) => listener(value === null ? null : value as { id: string; image: string });
    ipcRenderer.on("shinbo:screen-context", wrapped);
    return () => ipcRenderer.removeListener("shinbo:screen-context", wrapped);
  },
  captureScreenContext: () => ipcRenderer.invoke("shinbo:capture-screen-context"),
  getScreenAnnotationFrame: () => ipcRenderer.invoke("shinbo:get-screen-annotation-frame"),
  finishScreenAnnotation: (annotated: string) => ipcRenderer.invoke("shinbo:finish-screen-annotation", annotated),
  cancelScreenAnnotation: () => ipcRenderer.invoke("shinbo:cancel-screen-annotation"),
  screenAnnotationStatus: () => ipcRenderer.invoke("shinbo:screen-annotation-status"),
  clearScreenAnnotation: (id: string) => ipcRenderer.invoke("shinbo:clear-screen-annotation", id),
  revealPath: (value: string) => ipcRenderer.invoke("shinbo:reveal-path", value),
  previewPath: (value: string) => ipcRenderer.invoke("shinbo:preview-path", value),
  listArtifacts: () => ipcRenderer.invoke("shinbo:list-artifacts"),
  readArtifact: (id: string) => ipcRenderer.invoke("shinbo:read-artifact", id),
  saveArtifact: (value: { id?: string; title: string; kind: string; language?: string; content: string }) => ipcRenderer.invoke("shinbo:save-artifact", value),
  deleteArtifact: (id: string) => ipcRenderer.invoke("shinbo:delete-artifact", id),
  revealArtifact: (id: string) => ipcRenderer.invoke("shinbo:reveal-artifact", id),
  artifactSql: (id: string, sql: string, params: unknown[]) => ipcRenderer.invoke("shinbo:artifact-sql", { id, sql, params }),
  onArtifactsChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:artifacts-changed", wrapped);
    return () => ipcRenderer.removeListener("shinbo:artifacts-changed", wrapped);
  },
  listComponents: () => ipcRenderer.invoke("shinbo:list-components"),
  readComponent: (id: string) => ipcRenderer.invoke("shinbo:read-component", id),
  deleteComponent: (id: string) => ipcRenderer.invoke("shinbo:delete-component", id),
  enableComponent: (id: string, enabled: boolean) => ipcRenderer.invoke("shinbo:enable-component", { id, enabled }),
  expandComponent: (value: { id: string; expands: boolean }) => ipcRenderer.invoke("shinbo:expand-component", value),
  componentFetch: (value: { id: string; request: unknown }) => ipcRenderer.invoke("shinbo:component-fetch", value),
  shootComponent: (value: { id: string; x: number; y: number; width: number; height: number }) => ipcRenderer.invoke("shinbo:shoot-component", value),
  onComponentsChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:components-changed", wrapped);
    return () => ipcRenderer.removeListener("shinbo:components-changed", wrapped);
  },
  readVisual: (id: string) => ipcRenderer.invoke("shinbo:read-visual", id),
  exportVisual: (id: string, width: number) => ipcRenderer.invoke("shinbo:export-visual", { id, width }),
  listPlans: () => ipcRenderer.invoke("shinbo:list-plans"),
  listTaskLists: () => ipcRenderer.invoke("shinbo:list-task-lists"),
  setGoal: (value: { threadId: string; objective: string; tokenBudget?: number }) => ipcRenderer.invoke("shinbo:set-goal", value),
  updateGoal: (value: { threadId: string; status?: GoalStatus; evidence?: string; reason?: string; extraTokens?: number }) => ipcRenderer.invoke("shinbo:update-goal", value),
  clearGoal: (threadId: string) => ipcRenderer.invoke("shinbo:clear-goal", threadId),
  onPlansChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:plans-changed", wrapped);
    return () => ipcRenderer.removeListener("shinbo:plans-changed", wrapped);
  },
  onTaskListsChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:task-lists-changed", wrapped);
    return () => ipcRenderer.removeListener("shinbo:task-lists-changed", wrapped);
  },
  benchJudge: (value: { prompt: string; rubric: string; answer: string; judge?: VerifierSettings }) => ipcRenderer.invoke("shinbo:bench-judge", value),
  exportBench: (value: { name: string; sheets: { name: string; rows: (string | number)[][] }[] }) => ipcRenderer.invoke("shinbo:export-bench", value),
  exportThreadStats: (value: { folder: string; files: { name: string; text: string }[] }) => ipcRenderer.invoke("shinbo:export-thread-stats", value),
  listFolders: () => ipcRenderer.invoke("shinbo:list-folders"),
  pluginCatalog: () => ipcRenderer.invoke("shinbo:plugin-catalog"),
  addMarketplace: (value: { source: string; ref: string; sparse: string }) => ipcRenderer.invoke("shinbo:add-marketplace", value),
  removeMarketplace: (id: string) => ipcRenderer.invoke("shinbo:remove-marketplace", id),
  refreshMarketplace: (id: string) => ipcRenderer.invoke("shinbo:refresh-marketplace", id),
  installPlugin: (value: { marketplace: string; plugin: string }) => ipcRenderer.invoke("shinbo:install-plugin", value),
  uninstallPlugin: (id: string) => ipcRenderer.invoke("shinbo:uninstall-plugin", id),
  pluginDetail: (value: { marketplace: string; plugin: string }) => ipcRenderer.invoke("shinbo:plugin-detail", value),
  trustPluginHooks: (value: { id: string; trusted: boolean }) => ipcRenderer.invoke("shinbo:trust-plugin-hooks", value),
  setupStatus: () => ipcRenderer.invoke("shinbo:setup-status"),
  openPrivacySettings: (permission: string) => ipcRenderer.invoke("shinbo:open-privacy-settings", permission),
  demoQuickAsk: () => ipcRenderer.invoke("shinbo:demo-quick-ask"),
  pickVaultFolder: () => ipcRenderer.invoke("shinbo:pick-vault-folder"),
  detectVaults: () => ipcRenderer.invoke("shinbo:detect-vaults"),
  setVault: (value: { kind: VaultKind; name?: string; folder?: string }) => ipcRenderer.invoke("shinbo:set-vault", value),
  vaultStatus: () => ipcRenderer.invoke("shinbo:vault-status"),
  installObsidian: () => ipcRenderer.invoke("shinbo:install-obsidian"),
  keep: (value: KeepRequest) => ipcRenderer.invoke("shinbo:keep", value),
  keepScreen: (id: string) => ipcRenderer.invoke("shinbo:keep-screen", id),
  listNotes: () => ipcRenderer.invoke("shinbo:list-notes"),
  readNote: (value: string) => ipcRenderer.invoke("shinbo:read-note", value),
  listNoteFolders: () => ipcRenderer.invoke("shinbo:list-note-folders"),
  createNoteFolder: (name: string) => ipcRenderer.invoke("shinbo:create-note-folder", name),
  renameNoteFolder: (value: { folder: string; name: string }) => ipcRenderer.invoke("shinbo:rename-note-folder", value),
  moveNote: (value: { path: string; folder: string }) => ipcRenderer.invoke("shinbo:move-note", value),
  openInObsidian: (relative: string) => ipcRenderer.invoke("shinbo:open-in-obsidian", relative),
  onNotesChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:notes-changed", wrapped);
    return () => ipcRenderer.removeListener("shinbo:notes-changed", wrapped);
  },
  resetData: () => ipcRenderer.invoke("shinbo:reset-data"),
  pickFolder: () => ipcRenderer.invoke("shinbo:pick-folder"),
  forgetFolder: (id: string) => ipcRenderer.invoke("shinbo:forget-folder", id),
  listFolderFiles: (id: string) => ipcRenderer.invoke("shinbo:list-folder-files", id),
  gitStatus: (id: string, includeDiff = true) => ipcRenderer.invoke("shinbo:git-status", id, includeDiff),
  gitReady: (id: string) => ipcRenderer.invoke("shinbo:git-ready", id),
  gitInit: (id: string) => ipcRenderer.invoke("shinbo:git-init", id),
  gitHistory: (value: { folderId: string; skip?: number; limit?: number }) => ipcRenderer.invoke("shinbo:git-history", value),
  gitCommit: (value: { folderId: string; message: string; paths: string[]; amend?: boolean }) => ipcRenderer.invoke("shinbo:git-commit", value),
  gitDiscard: (value: { folderId: string; paths: string[] }) => ipcRenderer.invoke("shinbo:git-discard", value),
  gitRun: (value: { folderId: string; args: string[] }) => ipcRenderer.invoke("shinbo:git-run", value),
  gitMessage: (value: { folderId: string }) => ipcRenderer.invoke("shinbo:git-message", value),
  mobileStatus: () => ipcRenderer.invoke("shinbo:mobile-status"),
  mobilePair: (pin: string) => ipcRenderer.invoke("shinbo:mobile-pair", pin),
  mobileCancelPair: () => ipcRenderer.invoke("shinbo:mobile-cancel-pair"),
  mobileUnpair: (id?: number) => ipcRenderer.invoke("shinbo:mobile-unpair", id),
  onMobileStatus: (listener: (value: { paired: boolean; connected: boolean; name: string }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (value && typeof value === "object") listener(value as { paired: boolean; connected: boolean; name: string }); };
    ipcRenderer.on("shinbo:mobile-status", wrapped);
    return () => ipcRenderer.removeListener("shinbo:mobile-status", wrapped);
  },
  machineSample: () => ipcRenderer.invoke("shinbo:machine-sample"),
  listEditors: () => ipcRenderer.invoke("shinbo:list-editors"),
  openInEditor: (value: { folderId?: string; path: string; editorId: string }) => ipcRenderer.invoke("shinbo:open-in-editor", value),
  setWorktree: (value: { folderId: string; name: string; on: boolean }) => ipcRenderer.invoke("shinbo:set-worktree", value),
  worktreeList: (folderId: string) => ipcRenderer.invoke("shinbo:worktree-list", folderId),
  worktreeAdd: (value: { folderId: string; prefix: string; name: string }) => ipcRenderer.invoke("shinbo:worktree-add", value),
  worktreeRemove: (value: { folderId: string; paths: string[] }) => ipcRenderer.invoke("shinbo:worktree-remove", value),
  setBranch: (value: { folderId: string; branch: string; create: boolean; from?: string }) => ipcRenderer.invoke("shinbo:set-branch", value),
  readFolderFile: (value: { folderId: string; path: string }) => ipcRenderer.invoke("shinbo:read-folder-file", value),
  attachFiles: () => ipcRenderer.invoke("shinbo:attach-files"),
  attachData: (value: { name: string; data: ArrayBuffer }) => ipcRenderer.invoke("shinbo:attach-data", value),
  readAttachment: (id: string) => ipcRenderer.invoke("shinbo:read-attachment", id),
  clearThreadContext: (threadId: string) => ipcRenderer.invoke("shinbo:clear-thread-context", threadId),
  discoverAgentImports: () => ipcRenderer.invoke("shinbo:discover-agent-imports"),
  importAgentSources: (ids: string[]) => ipcRenderer.invoke("shinbo:import-agent-sources", ids),
  searchImportedSkills: (value: { query: string; limit?: number }) => ipcRenderer.invoke("shinbo:search-imported-skills", value),
  selectImportedSkill: (value: { id: string; threadId: string }) => ipcRenderer.invoke("shinbo:select-imported-skill", value),
  importedSkillStatus: () => ipcRenderer.invoke("shinbo:imported-skill-status"),
  clearImportedSkill: (id: string) => ipcRenderer.invoke("shinbo:clear-imported-skill", id),
  listImportedMcpServers: () => ipcRenderer.invoke("shinbo:list-imported-mcp-servers"),
  stopComputerRun: () => ipcRenderer.send("shinbo:stop-computer-run"),
  onComputerRunProgress: (listener: (value: unknown) => void) => {
    const wrapped = (_event: unknown, value: unknown) => listener(value);
    ipcRenderer.on("shinbo:computer-run-progress", wrapped);
    ipcRenderer.send("shinbo:computer-run-ready");
    return () => ipcRenderer.removeListener("shinbo:computer-run-progress", wrapped);
  },
  setProviders: (value: unknown) => ipcRenderer.invoke("shinbo:set-providers", value),
  runtimeReady: (error: string) => ipcRenderer.invoke("shinbo:runtime-ready", error),
  testProvider: (value: unknown) => ipcRenderer.invoke("shinbo:test-provider", value),
  setDefaultMode: (value: unknown) => ipcRenderer.invoke("shinbo:set-default-mode", value),
  setVerifier: (value: unknown) => ipcRenderer.invoke("shinbo:set-verifier", value),
  setToolSettings: (value: unknown) => ipcRenderer.invoke("shinbo:set-tool-settings", value),
  setZoom: (value: number) => ipcRenderer.invoke("shinbo:set-zoom", value),
  setTagger: (value: unknown) => ipcRenderer.invoke("shinbo:set-tagger", value),
  setHarnessExperiments: (value: unknown) => ipcRenderer.invoke("shinbo:set-harness-experiments", value),
  setReview: (value: unknown) => ipcRenderer.invoke("shinbo:set-review", value),
  setImprovements: (value: unknown) => ipcRenderer.invoke("shinbo:set-improvements", value),
  forceArm: (value: { threadId: string; arm: "a" | "b" }) => ipcRenderer.invoke("shinbo:force-arm", value),
  listToolTargets: () => ipcRenderer.invoke("shinbo:list-tool-targets"),
  capabilityUsage: () => ipcRenderer.invoke("shinbo:capability-usage"),
  nextSteps: (value: unknown) => ipcRenderer.invoke("shinbo:next-steps", value),
  onToolsChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:tools-changed", wrapped);
    return () => ipcRenderer.removeListener("shinbo:tools-changed", wrapped);
  },
  startCouncil: (value: CouncilStart) => ipcRenderer.invoke("shinbo:council-start", value) as Promise<CouncilState>,
  stopCouncil: (threadId: string) => ipcRenderer.invoke("shinbo:council-stop", { threadId }),
  adoptCouncil: (value: { threadId: string; seatId: string }) => ipcRenderer.invoke("shinbo:council-adopt", value) as Promise<CouncilState>,
  closeCouncil: (threadId: string) => ipcRenderer.invoke("shinbo:council-close", { threadId }),
  councilState: (threadId: string) => ipcRenderer.invoke("shinbo:council-state", { threadId }) as Promise<CouncilState | null>,
  onCouncil: (listener: (state: CouncilState) => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (value && typeof value === "object" && typeof (value as CouncilState).threadId === "string") listener(value as CouncilState); };
    ipcRenderer.on("shinbo:council", wrapped);
    return () => ipcRenderer.removeListener("shinbo:council", wrapped);
  },
  getThreadContext: (threadId: string) => ipcRenderer.invoke("shinbo:get-thread-context", { threadId }),
  setThreadContext: (value: { threadId: string; folderIds: string[]; mode: string; model?: string; effort?: string; subagentModel?: string; subagentEffort?: string; review?: boolean; stepLimit?: number }) => ipcRenderer.invoke("shinbo:set-thread-context", value),
  runCommand: (value: { command: string; folderId?: string }) => ipcRenderer.invoke("shinbo:run-command", value),
  listBackground: () => ipcRenderer.invoke("shinbo:list-background"),
  readBackground: (id: string) => ipcRenderer.invoke("shinbo:read-background", id),
  stopBackground: (id: string) => ipcRenderer.invoke("shinbo:stop-background", id),
  onBackground: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:background", wrapped);
    return () => ipcRenderer.removeListener("shinbo:background", wrapped);
  },
  listCliRuns: () => ipcRenderer.invoke("shinbo:list-cli-runs"),
  readCliRun: (id: string) => ipcRenderer.invoke("shinbo:read-cli-run", id),
  stopCliRun: (id: string) => ipcRenderer.invoke("shinbo:stop-cli-run", id),
  installedClis: () => ipcRenderer.invoke("shinbo:installed-clis"),
  semanticGrepStatus: () => ipcRenderer.invoke("shinbo:semantic-grep-status"),
  onSemanticGrep: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:semantic-grep", wrapped);
    return () => ipcRenderer.removeListener("shinbo:semantic-grep", wrapped);
  },
  zvecGrepStatus: () => ipcRenderer.invoke("shinbo:zvec-grep-status"),
  zvecGrepInstall: () => ipcRenderer.invoke("shinbo:zvec-grep-install"),
  zvecGrepCancel: () => ipcRenderer.invoke("shinbo:zvec-grep-cancel"),
  onZvecGrep: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:zvec-grep", wrapped);
    return () => ipcRenderer.removeListener("shinbo:zvec-grep", wrapped);
  },
  machineFacts: () => ipcRenderer.invoke("shinbo:machine-facts"),
  verifyEmbeddingKey: (id: string) => ipcRenderer.invoke("shinbo:verify-embedding-key", { id }),
  signInCli: (value: { signIn: string; columns: number; rows: number }) => ipcRenderer.invoke("shinbo:cli-sign-in", value),
  cliModels: (value: { cli: string; refresh?: boolean }) => ipcRenderer.invoke("shinbo:cli-models", value),
  setCliRunModel: (value: { id: string; model?: string; effort?: string }) => ipcRenderer.invoke("shinbo:cli-run-model", value),
  handoffCliRun: (value: import("../shared/cli").CliHandoffRequest) => ipcRenderer.invoke("shinbo:handoff-cli-run", value),
  sendCliRun: (value: { id: string; prompt: string }) => ipcRenderer.invoke("shinbo:send-cli-run", value),
  onCliRuns: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:cli-runs", wrapped);
    return () => ipcRenderer.removeListener("shinbo:cli-runs", wrapped);
  },
  browserStatus: (threadId: string) => ipcRenderer.invoke("shinbo:browser-status", threadId),
  browserOpen: (value: { threadId: string; url: string }) => ipcRenderer.invoke("shinbo:browser-open", value),
  browserNav: (value: { threadId: string; action: "back" | "forward" | "reload" | "close" }) => ipcRenderer.invoke("shinbo:browser-nav", value),
  browserPlace: (value: { threadId: string; bounds: { x: number; y: number; width: number; height: number } | null }) => ipcRenderer.invoke("shinbo:browser-place", value),
  browserClips: () => ipcRenderer.invoke("shinbo:browser-clips"),
  browserClipUse: (value: { threadId: string; index: number }) => ipcRenderer.invoke("shinbo:browser-clip-use", value),
  browserNewTab: (value: { threadId: string; url?: string }) => ipcRenderer.invoke("shinbo:browser-tab-new", value),
  browserSelectTab: (value: { threadId: string; tabId: string }) => ipcRenderer.invoke("shinbo:browser-tab-select", value),
  browserCloseTab: (value: { threadId: string; tabId: string }) => ipcRenderer.invoke("shinbo:browser-tab-close", value),
  onBrowser: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:browser", wrapped);
    return () => ipcRenderer.removeListener("shinbo:browser", wrapped);
  },
  onBrowserShow: (listener: (value: { threadId: string }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const shown = value as { threadId?: unknown };
      if (typeof shown?.threadId === "string") listener({ threadId: shown.threadId });
    };
    ipcRenderer.on("shinbo:browser-show", wrapped);
    return () => ipcRenderer.removeListener("shinbo:browser-show", wrapped);
  },
  openTerminal: (value: { threadId: string; columns: number; rows: number; cli?: string }) => ipcRenderer.invoke("shinbo:terminal-open", value),
  writeTerminal: (value: { id: string; data: string }) => ipcRenderer.invoke("shinbo:terminal-write", value),
  resizeTerminal: (value: { id: string; columns: number; rows: number }) => ipcRenderer.invoke("shinbo:terminal-resize", value),
  closeTerminal: (id: string) => ipcRenderer.invoke("shinbo:terminal-close", id),
  listTerminals: (threadId: string) => ipcRenderer.invoke("shinbo:terminal-list", threadId),
  readTerminal: (id: string) => ipcRenderer.invoke("shinbo:terminal-buffer", id),
  onTerminalData: (listener: (value: { id: string; data: Uint8Array; at: number }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const chunk = value as { id?: unknown; data?: unknown; at?: unknown };
      if (typeof chunk?.id === "string" && chunk.data instanceof Uint8Array && typeof chunk.at === "number") listener({ id: chunk.id, data: chunk.data, at: chunk.at });
    };
    ipcRenderer.on("shinbo:terminal-data", wrapped);
    return () => ipcRenderer.removeListener("shinbo:terminal-data", wrapped);
  },
  onTerminals: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("shinbo:terminals", wrapped);
    return () => ipcRenderer.removeListener("shinbo:terminals", wrapped);
  },
  harnessReport: () => ipcRenderer.invoke("shinbo:harness-report"),
  restartHarness: () => ipcRenderer.invoke("shinbo:restart-harness"),
  onHarnessLog: (listener: (line: { at: number; flow: string; label: string; body: string }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const line = value as { at?: unknown; flow?: unknown; label?: unknown; body?: unknown };
      if (typeof line?.at === "number" && typeof line.flow === "string" && typeof line.label === "string" && typeof line.body === "string") {
        listener({ at: line.at, flow: line.flow, label: line.label, body: line.body });
      }
    };
    ipcRenderer.on("shinbo:harness-log", wrapped);
    return () => ipcRenderer.removeListener("shinbo:harness-log", wrapped);
  },
  openLink: (url: string) => ipcRenderer.invoke("shinbo:open-link", url),
  listMemories: () => ipcRenderer.invoke("shinbo:list-memories"),
  deleteMemory: (path: string) => ipcRenderer.invoke("shinbo:delete-memory", path),
  listAgents: () => ipcRenderer.invoke("shinbo:list-agents"),
  listSpans: () => ipcRenderer.invoke("shinbo:list-spans"),
  livePartial: () => ipcRenderer.invoke("shinbo:live-partial"),
  listAsks: () => ipcRenderer.invoke("shinbo:list-asks"),
  threadTraces: (threadId: string) => ipcRenderer.invoke("shinbo:thread-traces", threadId),
  steerAgent: (value: { threadId: string; text: string }) => ipcRenderer.invoke("shinbo:steer-agent", value),
  stopAgent: (threadId?: string) => ipcRenderer.send("shinbo:stop-agent", threadId),
  answerPermission: (value: { id: string; allowed: boolean }) => ipcRenderer.send("shinbo:answer-permission", value),
  threadChanges: (threadId: string) => ipcRenderer.invoke("shinbo:thread-changes", threadId),
  revertChange: (value: { folderId: string; path: string; before: string }) => ipcRenderer.invoke("shinbo:revert-change", value),
  onAgents: (listener: (value: unknown[]) => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (Array.isArray(value)) listener(value); };
    ipcRenderer.on("shinbo:agents", wrapped);
    return () => ipcRenderer.removeListener("shinbo:agents", wrapped);
  },
  onSpans: (listener: (value: Record<string, unknown[]>) => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (value && typeof value === "object" && !Array.isArray(value)) listener(value as Record<string, unknown[]>); };
    ipcRenderer.on("shinbo:spans", wrapped);
    return () => ipcRenderer.removeListener("shinbo:spans", wrapped);
  },
  onPermissionAsk: (listener: (value: { id: string; threadId: string; tool: string; summary: string; detail: string }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => { if (value && typeof value === "object") listener(value as { id: string; threadId: string; tool: string; summary: string; detail: string }); };
    ipcRenderer.on("shinbo:permission-ask", wrapped);
    return () => ipcRenderer.removeListener("shinbo:permission-ask", wrapped);
  },
  onPermissionResolved: (listener: (value: { id: string; allowed: boolean }) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      const answer = value as { id?: unknown; allowed?: unknown };
      if (typeof answer?.id === "string" && typeof answer.allowed === "boolean") listener({ id: answer.id, allowed: answer.allowed });
    };
    ipcRenderer.on("shinbo:permission-resolved", wrapped);
    return () => ipcRenderer.removeListener("shinbo:permission-resolved", wrapped);
  },
  setZeroRetention: (value: boolean) => ipcRenderer.invoke("shinbo:set-zero-retention", value),
  listCredentials: () => ipcRenderer.invoke("shinbo:list-credentials"),
  openRouterBalance: () => ipcRenderer.invoke("shinbo:openrouter-balance"),
  deepseekBalance: () => ipcRenderer.invoke("shinbo:deepseek-balance"),
  saveCredential: (value: { env: string; secret?: string }) => ipcRenderer.invoke("shinbo:save-credential", value),
  fetchUrl: (url: string) => ipcRenderer.invoke("shinbo:fetch-url", url),
  clipPage: () => ipcRenderer.invoke("shinbo:clip-page"),
  loadUiPlugins: () => ipcRenderer.invoke("shinbo:load-ui-plugins"),
  onChanged: (listener: () => void) => {
    const id = nextListener++;
    const wrapped = () => listener();
    listeners.set(id, wrapped);
    ipcRenderer.on("shinbo:changed", wrapped);
    return id;
  },
  offChanged: (id: number) => {
    const listener = listeners.get(id);
    if (listener) ipcRenderer.removeListener("shinbo:changed", listener);
    listeners.delete(id);
  },
});
