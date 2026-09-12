


import type { PermissionMode } from "./permissions";

export const MAX_LIVE_SUBAGENTS = 8;





export const MAX_LIVE_THREADS = 8;







export const THREADS_MARKER = /\[threads:([a-z0-9-]{1,96}):([^\]\n]{1,128})]$/;


export function spawnedThread(output: string | undefined): { id: string; title: string } | undefined {
  const found = THREADS_MARKER.exec((output ?? "").split("\n", 1)[0].trim());
  return found ? { id: found[1], title: found[2] } : undefined;
}









const FROM_THREAD_MARKER = /^\[thread ([a-z0-9-]{1,96}) messaged]\n/;

export function fromThread(sender: string, text: string): string {
  return `[thread ${sender} messaged]\n${text}`;
}


export function sentByThread(content: string): { from?: string; body: string } {
  const found = FROM_THREAD_MARKER.exec(content);
  return found ? { from: found[1], body: content.slice(found[0].length) } : { body: content };
}



export const AGENT_COLORS = [
  "#4f9dff",
  "#f2a13c",
  "#57c785",
  "#c77dff",
  "#ff6b81",
  "#3fc7d4",
  "#e0c341",
  "#8f9bff",
] as const;

export function agentColor(index: number): string {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}







export const AGENT_NAMES = [
  "Ada", "Aiden", "Alba", "Alex", "Alice", "Amara", "Amos", "Anders", "Andre", "Angie",
  "Anita", "Anton", "Archie", "Aria", "Arlo", "Asa", "Ashe", "Astrid", "Aubrey", "August",
  "Aurora", "Avery", "Axel", "Baker", "Basil", "Bea", "Beau", "Bell", "Benji", "Bianca",
  "Birdie", "Blaise", "Bo", "Bodhi", "Boone", "Bram", "Bree", "Brooks", "Bruno", "Cal",
  "Callum", "Calvin", "Camila", "Carter", "Casey", "Cass", "Cato", "Cedar", "Celia", "Cleo",
  "Clyde", "Cody", "Cora", "Cosmo", "Cyrus", "Dahlia", "Dane", "Dario", "Dashiell", "Davi",
  "Delia", "Dev", "Dexter", "Dinah", "Dmitri", "Dora", "Dorian", "Dove", "Drew", "Duke",
  "Eamon", "Eden", "Edie", "Elias", "Ellis", "Eloise", "Elsie", "Shinbo", "Enzo", "Esme",
  "Etta", "Ewan", "Ezra", "Fable", "Faye", "Felix", "Fern", "Finn", "Flora", "Floyd",
  "Forrest", "Frank", "Freya", "Gabe", "Gable", "Gia", "Gideon", "Gil", "Gloria", "Grady",
  "Greta", "Gus", "Hal", "Hana", "Harlan", "Harper", "Hattie", "Hazel", "Heath", "Hector",
  "Hollis", "Hugo", "Ida", "Idris", "Ines", "Ira", "Iris", "Isla", "Ivan", "Ivy",
  "Jace", "Jada", "Jasper", "Javi", "Jeanie", "Jem", "Jonah", "John", "Jules", "June",
  "Juniper", "Kai", "Kalindi", "Karim", "Kasper", "Katy", "Keira", "Kenji", "Kit", "Knox",
  "Kyra", "Lachlan", "Lana", "Lars", "Lear", "Leif", "Lena", "Leo", "Levi", "Lila",
  "Linus", "Livia", "Logan", "Lola", "Lorne", "Lou", "Luca", "Lucia", "Luka", "Lyle",
  "Lyra", "Mabel", "Mack", "Maeve", "Magnus", "Maia", "Malik", "Mara", "Marco", "Margot",
  "Mateo", "Maude", "Mavis", "Maya", "Mercer", "Milo", "Mira", "Mirek", "Mona", "Moss",
  "Murray", "Nadia", "Nash", "Nell", "Neo", "Nico", "Nina", "Noa", "Noel", "Nora",
  "Nova", "Oakley", "Odessa", "Odin", "Olive", "Omar", "Oona", "Opal", "Orson", "Oscar",
  "Otis", "Otto", "Owen", "Ozzy", "Pablo", "Paloma", "Paz", "Pearl", "Pedro", "Percy",
  "Petra", "Phoebe", "Pilar", "Pip", "Piper", "Quill", "Quinn", "Rafa", "Ramona", "Raven",
  "Rex", "Rhea", "Rhys", "Rico", "Rilke", "Rio", "Rita", "River", "Roan", "Robin",
  "Roma", "Romy", "Roscoe", "Rosa", "Rowan", "Roy", "Ruby", "Rufus", "Russ", "Ruth",
  "Ryder", "Sable", "Sadie", "Saga", "Sana", "Sasha", "Saul", "Scout", "Sebastian", "Selma",
  "Senna", "Shai", "Shane", "Shiloh", "Sid", "Sigrid", "Silas", "Simone", "Sloane", "Sol",
  "Solveig", "Sonny", "Soren", "Stella", "Sten", "Sunny", "Sylvie", "Tadeo", "Talia", "Tam",
  "Tao", "Tara", "Tate", "Teddy", "Tess", "Thea", "Theo", "Tilda", "Tobin", "Tom",
  "Tomas", "Tova", "Tris", "Tron", "Truman", "Tully", "Uma", "Vada", "Val", "Vera",
  "Vero", "Vidal", "Vince", "Viola", "Vivi", "Wade", "Walker", "Wanda", "Warren", "Wells",
  "Wesley", "Whit", "Wilder", "Willa", "Winnie", "Wren", "Wyatt", "Xander", "Yara", "Yuri",
  "Zadie", "Zane", "Zara", "Zeke", "Zelda", "Zia", "Zoe", "Zuri",
] as const;





export function agentName(seed: string, taken: ReadonlySet<string> = new Set()): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  for (let i = 0; i < AGENT_NAMES.length; i += 1) {
    const name = AGENT_NAMES[(hash + i) % AGENT_NAMES.length];
    if (!taken.has(name)) return name;
  }
  return AGENT_NAMES[hash % AGENT_NAMES.length];
}

export type AgentStatus = "running" | "waiting" | "done" | "failed" | "stopped";

export type LiveAgent = {
  threadId: string;

  parentThreadId?: string;
  title: string;
  color: string;
  status: AgentStatus;
  mode: PermissionMode;
  model: string;

  activity: string;
  prompt: string;

  tool: boolean;
  startedAt: number;
  endedAt?: number;
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;

  generationMs: number;
  effort?: string;

  error?: string;
};

type RunRecord = "mode" | "model" | "prompt" | "tool" | "startedAt" | "steps" | "toolCalls" | "inputTokens" | "outputTokens" | "generationMs";

export type AgentRow = Omit<LiveAgent, RunRecord> & Partial<Pick<LiveAgent, RunRecord>>;

export function tokensPerSecond(agent: Pick<LiveAgent, "outputTokens" | "generationMs">): number {
  return agent.generationMs > 0 ? agent.outputTokens / (agent.generationMs / 1000) : 0;
}

export type ThreadStep = {
  threadId: string;
  toolCallId: string;
  title: string;
  kind: string;
  toolName?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  input?: string;
  output?: string;
  at: number;
  edit?: { path: string; added: number; removed: number; hunks?: DiffHunkLine[] };
};






export type SubagentRoute = { model: string; effort: string };


export type PermissionAsk = {
  id: string;
  threadId: string;
  tool: string;
  summary: string;

  detail: string;
};

export type PermissionAnswer = "allowed" | "denied" | "lapsed";


export type FileChange = {
  folderId: string;
  path: string;

  before: string | null;
  after: string;
  at: number;
};


export type BackgroundTask = {
  id: string;
  command: string;

  folder: string;
  status: "running" | "exited";

  exitCode: number | null;
  startedAt: number;
  endedAt?: number;
};

export type DiffStat = { added: number; removed: number; files: number };



function diffLcsRow(left: string[], right: string[], start: number, end: number, from: number, to: number, reverse: boolean): string {
  const width = to - from;
  const positions = new Map<string, number[]>();
  for (let j = 0; j < width; j += 1) {
    const line = right[reverse ? to - j - 1 : from + j];
    const list = positions.get(line);
    if (list) list.push(j);
    else positions.set(line, [j]);
  }
  const masks = new Map<string, bigint>();
  let cached = 0;
  let state = 0n;
  for (let i = 0; i < end - start; i += 1) {
    const line = left[reverse ? end - i - 1 : start + i];
    const list = positions.get(line);
    if (!list) continue;
    let mask = masks.get(line);
    if (mask === undefined) {
      mask = 0n;
      for (const index of list) mask |= 1n << BigInt(index);
      const bytes = Math.ceil((list[list.length - 1] + 1) / 8);
      if (cached + bytes <= width * 64) { masks.set(line, mask); cached += bytes; }
    }
    const union = state | mask;
    state = union & ~(union - ((state << 1n) | 1n));
  }
  return state.toString(2);
}

function diffDenseSplit(left: string[], right: string[], start: number, end: number, from: number, to: number): [number, number] {
  const middle = Math.floor((start + end) / 2);
  const forward = diffLcsRow(left, right, start, middle, from, to, false);
  const backward = diffLcsRow(left, right, middle, end, from, to, true);
  let after = 0;
  for (const bit of backward) if (bit === "1") after += 1;
  let best = after;
  let across = from;
  let before = 0;
  for (let j = 1; j <= to - from; j += 1) {
    if (forward.charCodeAt(forward.length - j) === 49) before += 1;
    if (backward.charCodeAt(backward.length - (to - from - j + 1)) === 49) after -= 1;
    if (before + after > best) { best = before + after; across = from + j; }
  }
  return [middle, across];
}

function diffSplit(left: string[], right: string[], start: number, end: number, from: number, to: number): [number, number] {
  const n = end - start;
  const m = to - from;
  if (n === 1) return [start, right.indexOf(left[start], from)];
  if (m === 1) return [left.indexOf(right[from], start), from];
  const depth = Math.ceil((n + m) / 2);
  const offset = depth + 1;
  const forward = new Int32Array(2 * depth + 3).fill(-1);
  const backward = new Int32Array(2 * depth + 3).fill(-1);
  forward[offset + 1] = 0;
  backward[offset + 1] = 0;
  const delta = n - m;
  for (let d = 0; d <= depth; d += 1) {
    if (d === 64) return diffDenseSplit(left, right, start, end, from, to);
    for (const reverse of [false, true]) {
      const current = reverse ? backward : forward;
      const other = reverse ? forward : backward;
      for (let k = -d; k <= d; k += 2) {
        const at = offset + k;
        let x = k === -d || (k !== d && current[at - 1] < current[at + 1]) ? current[at + 1] : current[at - 1] + 1;
        let y = x - k;
        while (x < n && y < m && (reverse ? left[end - x - 1] === right[to - y - 1] : left[start + x] === right[from + y])) { x += 1; y += 1; }
        current[at] = x;
        const opposite = delta - k;
        const previousDepth = reverse ? d : d - 1;
        if ((delta % 2 !== 0) === !reverse && opposite >= -previousDepth && opposite <= previousDepth && other[offset + opposite] >= 0 && x + other[offset + opposite] >= n) {
          return reverse ? [end - x, to - y] : [start + x, from + y];
        }
      }
    }
  }
  throw new Error("Could not split the line diff");
}

export function diffLines(before: string, after: string): { kind: " " | "+" | "-"; text: string }[] {
  const left = before.length ? before.split("\n") : [];
  const right = after.length ? after.split("\n") : [];
  const out: { kind: " " | "+" | "-"; text: string }[] = [];
  const pending: [number, number, number, number][] = [[0, left.length, 0, right.length]];
  while (pending.length) {
    let [start, end, from, to] = pending.pop()!;
    while (start < end && from < to && left[start] === right[from]) { out.push({ kind: " ", text: left[start++] }); from += 1; }
    let tail = 0;
    while (start < end - tail && from < to - tail && left[end - tail - 1] === right[to - tail - 1]) tail += 1;
    if (tail) { pending.push([end - tail, end, to - tail, to]); end -= tail; to -= tail; }
    const shared = new Set(right.slice(from, to));
    if (start === end || from === to || !left.slice(start, end).some((line) => shared.has(line))) {
      for (let i = start; i < end; i += 1) out.push({ kind: "-", text: left[i] });
      for (let i = from; i < to; i += 1) out.push({ kind: "+", text: right[i] });
    } else {
      const [middle, across] = diffSplit(left, right, start, end, from, to);
      pending.push([middle, end, across, to], [start, middle, from, across]);
    }
  }
  return out;
}

export type DiffHunkLine = { kind: " " | "+" | "-"; text: string; line: number };

const HUNK_CONTEXT = 2;


const HUNK_LINES = 200;


export function diffHunks(before: string, after: string, context = HUNK_CONTEXT): DiffHunkLine[] {
  return diffHunkLines(diffLines(before, after), context);
}

function diffHunkLines(lines: ReturnType<typeof diffLines>, context: number): DiffHunkLine[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === " ") return;
    for (let near = Math.max(0, index - context); near <= Math.min(lines.length - 1, index + context); near += 1) keep.add(near);
  });
  const out: DiffHunkLine[] = [];
  let at = 0;
  for (const [index, line] of lines.entries()) {
    if (line.kind !== "-") at += 1;
    if (keep.has(index) && out.length < HUNK_LINES) out.push({ ...line, line: line.kind === "-" ? at + 1 : at });
  }
  return out;
}


export function editStat(change: FileChange): NonNullable<ThreadStep["edit"]> {
  const lines = diffLines(change.before ?? "", change.after);
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "+") added += 1;
    else if (line.kind === "-") removed += 1;
  }
  return { path: change.path, added, removed, hunks: diffHunkLines(lines, HUNK_CONTEXT) };
}

export function diffStat(changes: FileChange[]): DiffStat {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    for (const line of diffLines(change.before ?? "", change.after)) {
      if (line.kind === "+") added += 1;
      else if (line.kind === "-") removed += 1;
    }
  }
  return { added, removed, files: changes.length };
}


export function collapseChanges(changes: FileChange[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const change of changes) {
    const key = `${change.folderId}:${change.path}`;
    const first = byPath.get(key);
    byPath.set(key, first ? { ...change, before: first.before } : change);
  }
  return [...byPath.values()].filter((change) => change.before !== change.after);
}
