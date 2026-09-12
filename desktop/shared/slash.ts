





import type { ContextPick } from "./folders";

export type SlashKind = "tool" | "skill" | "mcp" | "builtin" | "file" | "category" | "artifact" | "page" | "terminal" | "diff" | "visual" | "component";
export interface SlashCommand {
  id: string;
  name: string;
  kind: SlashKind;
  detail: string;

  pick?: ContextPick;
}



export const KIND_LABELS: Record<SlashKind, string> = {
  tool: "Tool",
  skill: "Skill",
  mcp: "MCP",
  builtin: "Built-in",
  file: "File",
  category: "Category",
  artifact: "Artifact",
  page: "Knowledge",
  terminal: "Terminal",
  diff: "Diff",
  visual: "Picture",
  component: "Built by Shinbo",
};


export const SLASH_HUES = 5;

export const FILE_HUE = SLASH_HUES;

export const LINK_HUE = FILE_HUE + 1;


export const MENU_MAX = 20;


export const BUILTIN_COMMANDS: SlashCommand[] = [
  { id: "agent", name: "agent", kind: "builtin", detail: "Zig coding harness" },
  { id: "council", name: "council", kind: "builtin", detail: "seat several models on one question" },
  { id: "import", name: "import", kind: "builtin", detail: "import skills & MCP" },
  { id: "new", name: "new", kind: "builtin", detail: "new thread in this project" },
  { id: "clear", name: "clear", kind: "builtin", detail: "empty the context window" },
];

export type Sigil = "/" | "@";



const WORD = "\\p{L}\\p{N}\\p{M}";
const NAME = `[${WORD}][${WORD}._:-]*`;
const PATH = `[${WORD}][${WORD}._:/-]*`;
const GRAMMAR: [Sigil, string][] = [["/", NAME], ["@", PATH]];
const TYPING = GRAMMAR.map(([sigil, name]) => [sigil, new RegExp(`(?:^|\\s)[${sigil}](${name}|)$`, "u")] as const);

const LINK = "https?://[^\\s<>()\\[\\]]*[^\\s<>()\\[\\].,;:!?'\"]";
const TOKEN = new RegExp(`(^|\\s)(${LINK}|/${NAME}|@${PATH})`, "gu");

export function pathName(path: string): string {
  const name = path.replace(/[^\p{L}\p{N}\p{M}._:/-]+/gu, "-").replace(/^[^\p{L}\p{N}]+/u, "");
  return name || "file";
}




export function slashQuery(text: string, caret: number) {
  const head = text.slice(0, Math.max(0, caret));
  for (const [sigil, pattern] of TYPING) {
    const match = pattern.exec(head);
    if (match) return { start: caret - match[1].length - 1, query: match[1], sigil };
  }
  return null;
}



export function matchCommands(commands: SlashCommand[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...commands];
  const rank = (command: SlashCommand) => (command.name.toLocaleLowerCase().startsWith(needle) ? 0 : 1);
  return commands
    .filter((command) => command.name.toLocaleLowerCase().includes(needle))
    .map((command, index) => ({ command, index }))
    .sort((left, right) => rank(left.command) - rank(right.command) || left.index - right.index)
    .map((entry) => entry.command);
}


export function insertCommand(text: string, at: { start: number; query: string; sigil?: Sigil }, name: string) {
  const tail = text.slice(at.start + at.query.length + 1);
  const head = `${text.slice(0, at.start)}${at.sigil ?? "/"}${name}${/^\s/.test(tail) ? "" : " "}`;
  return { text: head + tail, caret: head.length };
}



export function mentions(text: string, sigil: Sigil): string[] {
  return [...text.matchAll(TOKEN)].map((match) => match[2]).filter((token) => token.startsWith(sigil)).map((token) => token.slice(1));
}

export interface SlashSegment {
  text: string;

  hue?: number;
}





export function highlightSegments(text: string, names: string[], paths: string[] = []): SlashSegment[] {
  const known = { "/": new Set(names.map((name) => name.toLocaleLowerCase())), "@": new Set(paths.map((path) => path.toLocaleLowerCase())) };
  const order: string[] = [];
  const segments: SlashSegment[] = [];
  let index = 0;
  for (const match of text.matchAll(TOKEN)) {
    const token = match[2];
    const sigil = token[0] as Sigil;
    const link = sigil !== "/" && sigil !== "@";
    const name = token.slice(1).toLocaleLowerCase();
    if (!link && !known[sigil].has(name)) continue;
    const start = match.index + match[1].length;
    if (start > index) segments.push({ text: text.slice(index, start) });
    if (link) segments.push({ text: token, hue: LINK_HUE });
    else if (sigil === "@") segments.push({ text: token, hue: FILE_HUE });
    else {
      if (!order.includes(name)) order.push(name);
      segments.push({ text: token, hue: order.indexOf(name) % SLASH_HUES });
    }
    index = start + token.length;
  }
  if (index < text.length) segments.push({ text: text.slice(index) });
  return segments;
}
