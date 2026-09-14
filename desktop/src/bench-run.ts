import { lastLine, runArms, runExpected, MAX_BENCH_ANSWER_CHARS } from "../shared/bench";
import { readTurn, type Arm } from "../shared/improvement";
import { setThreadFolders, setThreadMode } from "./context";
import type { BenchCase, BenchResult, BenchRun } from "../shared/bench";
import type { FolderGrant } from "../shared/folders";
import type { PermissionMode } from "../shared/permissions";
import type { VerifierSettings } from "../shared/settings";
import { reasonText } from "./errors";
import type { Thread } from "./types";

export type BenchProgress = { runId: string; done: number; total: number; caseTitle: string; arm: Arm };

export type ThreadRead = { id: string; title: string; messages: { role: string; content: string }[] };

export async function finalAnswer(threadId: string): Promise<{ answer: string; notice: string }> {
  const read = await window.shinbo.request<ThreadRead>("thread", { threadId }).catch(() => undefined);
  const last = (role: string) => read?.messages.filter((message) => message.role === role).at(-1)?.content.trim() ?? "";
  return { answer: last("assistant").slice(-MAX_BENCH_ANSWER_CHARS), notice: last("system") };
}

const TRACE_RETRY_MS = 250;

let running = "";
let live = "";

export function benchLive(): string {
  return running;
}

export function stopBench() {
  const thread = live;
  running = "";
  live = "";
  if (thread) window.shinbo.stopAgent(thread);
}

export function benchBlocker(cases: readonly BenchCase[], mode: string, folders: readonly FolderGrant[]): string {
  if (mode === "ask") return "The bench cannot run in Ask mode, where your own Allow answers would become the measurement.";
  const missing = cases.filter((item) => !folders.some((grant) => grant.id === item.folderId)).length;
  if (missing) return `${missing} of ${cases.length} cases point at a folder that is no longer connected.`;
  return "";
}

const MAX_TICK_MS = 2000;

const tick = (ms = TRACE_RETRY_MS) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

const SHELL_MS = 10 * 60_000;
const STOPPED_TRACE_MS = 60_000;

async function runShell(command: string, folderId: string): Promise<{ code: number; note: string }> {
  const task = await window.shinbo.runCommand({ command, folderId }).catch(() => undefined);
  if (!task) return { code: 1, note: "That command could not start." };
  const deadline = Date.now() + SHELL_MS;
  for (let wait = TRACE_RETRY_MS; ; wait = Math.min(wait * 2, MAX_TICK_MS)) {
    const found = await window.shinbo.readBackground(task.id).catch(() => null);
    if (found?.task.status === "exited") return { code: found.task.exitCode ?? 1, note: lastLine(found.output) };
    if (Date.now() >= deadline) {
      void window.shinbo.stopBackground(task.id);
      return { code: 1, note: `That command was still running after ${SHELL_MS / 60_000} minutes.` };
    }
    await tick(wait);
  }
}

async function lastTrace(threadId: string, waitMs = TRACE_RETRY_MS) {
  const deadline = Date.now() + waitMs;
  for (let wait = TRACE_RETRY_MS; ; wait = Math.min(wait * 2, MAX_TICK_MS)) {
    const traces = await window.shinbo.threadTraces(threadId);
    if (traces.length || Date.now() >= deadline) return traces.at(-1);
    await tick(wait);
  }
}

export function benchKin(threads: readonly Thread[], roots: readonly string[]): Set<string> {
  const found = new Set(roots);
  for (let again = true; again;) {
    again = false;
    for (const item of threads) {
      if (found.has(item.id) || !item.parentThreadId || !found.has(item.parentThreadId)) continue;
      found.add(item.id);
      again = true;
    }
  }
  return found;
}

export function containBench(roots: readonly string[]): void {
  for (const root of roots) window.shinbo.stopAgent(root);
}

async function driveCase(run: BenchRun, item: BenchCase, arm: Arm, judge: VerifierSettings | undefined, onThread: (runId: string, threadId: string) => void, onResult: (runId: string, result: BenchResult) => void, onJudgeError: (note: string) => void) {
  const thread = await window.shinbo.request<Thread>("createThread");
  live = thread.id;
  onThread(run.id, thread.id);
  try {
    await window.shinbo.request("setThreadArchived", { threadId: thread.id, archived: "true" });
    if (benchLive() !== run.id) return;
    await window.shinbo.request("renameThread", { threadId: thread.id, title: `Bench · ${item.title}`.slice(0, 120) });
    if (benchLive() !== run.id) return;
    setThreadFolders(thread.id, [item.folderId]);
    setThreadMode(thread.id, run.mode as PermissionMode);
    await window.shinbo.setThreadContext({ threadId: thread.id, folderIds: [item.folderId], mode: run.mode as PermissionMode, model: run.model, ...(run.effort ? { effort: run.effort } : {}), ...(run.stepLimit ? { stepLimit: run.stepLimit } : {}) });
    if (benchLive() !== run.id) return;
    await window.shinbo.forceArm({ threadId: thread.id, arm });
    if (benchLive() !== run.id) return;
    if (item.setup) await runShell(item.setup, item.folderId);
    if (benchLive() !== run.id) return;
    let hard = false;
    const sent = window.shinbo.request("sendMessage", { threadId: thread.id, content: item.prompt }).then(() => false, () => { hard = true; return false; });
    const overran = run.caseMinutes
      ? await Promise.race([sent, new Promise<boolean>((resolve) => { setTimeout(() => resolve(true), run.caseMinutes! * 60_000); })])
      : await sent;
    if (overran) window.shinbo.stopAgent(thread.id);
    if (benchLive() !== run.id) return;
    const trace = await lastTrace(thread.id, overran ? STOPPED_TRACE_MS : TRACE_RETRY_MS);
    if (!trace || benchLive() !== run.id) return;
    const turn = readTurn(trace, { id: thread.id, title: item.title });
    if (turn.arm !== arm) return;
    const { answer, notice } = await finalAnswer(thread.id);
    if (benchLive() !== run.id) return;
    if (!answer) onJudgeError(`${item.title}: ${notice || "no reply came back"}`);
    const checked = item.check ? await runShell(item.check, item.folderId) : undefined;
    if (benchLive() !== run.id) return;
    const scored = checked ? { score: checked.code === 0 ? 1 : 0, note: checked.note }
      : await window.shinbo.benchJudge({ prompt: item.prompt, rubric: item.rubric ?? "", answer, ...(judge ? { judge } : {}) })
        .catch((reason: unknown) => { onJudgeError(reasonText(reason)); return undefined; });
    onResult(run.id, {
      caseId: item.id,
      arm,
      failures: turn.failures,
      blocks: turn.blocks,
      steps: turn.steps,
      requests: turn.requests,
      tokens: turn.tokens,
      cost: turn.cost,
      ms: turn.ms,
      failed: turn.ok && !hard && !overran ? 0 : 1,
      out: turn.out,
      threadId: thread.id,
      ...(answer ? { answer } : {}),
      ...(scored ? { judge: scored.score, ...(scored.note ? { judgeNote: scored.note } : {}) } : {}),
    });
  } finally {
    if (live === thread.id) live = "";
    containBench([thread.id]);
  }
}

export async function driveBench(input: {
  run: BenchRun;
  cases: readonly BenchCase[];
  judge?: VerifierSettings;
  onThread: (runId: string, threadId: string) => void;
  onResult: (runId: string, result: BenchResult) => void;
  onProgress: (progress: BenchProgress | null) => void;
  onJudgeError: (note: string) => void;
}): Promise<void> {
  const { run, cases, judge, onThread, onResult, onProgress, onJudgeError } = input;
  const blocker = benchBlocker(cases, run.mode, await window.shinbo.listFolders().catch(() => []));
  if (blocker) throw new Error(blocker);
  const arms: Arm[] = runArms(run) === 2 ? ["a", "b"] : ["a"];
  const total = runExpected(run);
  running = run.id;
  let done = 0;
  try {
    for (const item of cases) {
      for (const arm of arms) {
        if (benchLive() !== run.id) return;
        const grants = await window.shinbo.listFolders().catch(() => []);
        if (benchLive() !== run.id) return;
        if (!grants.some((grant) => grant.id === item.folderId)) throw new Error(`The folder for ${item.title} was disconnected mid-run.`);
        onProgress({ runId: run.id, done, total, caseTitle: item.title, arm });
        await driveCase(run, item, arm, judge, onThread, onResult, onJudgeError);
        done += 1;
      }
    }
  } finally {
    if (running === run.id) running = "";
    onProgress(null);
  }
}
