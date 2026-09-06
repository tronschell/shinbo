import type { ThreadStep } from "../shared/agents";
import type { Block } from "./runs";

export const stepActive = (step: ThreadStep) => step.status === "pending" || step.status === "in_progress";

export function latestSteps(steps: ThreadStep[]): ThreadStep[] {
  return [...new Map(steps.map((step) => [step.toolCallId, step])).values()];
}

export function runActivity(blocks: Block[], since: number, now: number, recovery: string) {
  const outstanding = latestSteps(blocks.flatMap((block) => block.kind === "step" ? [block.step] : [])).filter(stepActive);
  const quiet = Math.max(0, now - since);
  const phase = outstanding.length ? "tools" : recovery ? "recovery" : "model";
  return { outstanding, quiet, phase, stalled: quiet >= 60_000, canSwap: phase !== "tools" };
}
