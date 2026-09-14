

export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  strike?: true;
  code?: true;
  href?: string;
  path?: string;
  image?: true;
}

export interface Item { spans: Span[]; sub?: List[]; checked?: boolean }
export interface List { ordered: boolean; items: Item[]; start?: number }
export type Row = Span[][];

export type Block =
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "quote"; spans: Span[] }
  | { kind: "code"; language: string; text: string }
  | ({ kind: "list" } & List)
  | { kind: "table"; head: Row; rows: Row[] }
  | { kind: "rule" };



const INLINE = /\\(?<escaped>[\\`*_~[\]()#|])|(?<tick>`{1,3})(?<code>(?:(?!\k<tick>)[\s\S])+?)\k<tick>|\*\*\*(?=\S)(?<both>[^*]+?)(?<=\S)\*\*\*|\*\*(?=\S)(?<strong>[^*]+?)(?<=\S)\*\*|(?<![\w_])__(?=\S)(?<strong2>[^_]+?)(?<=\S)__(?![\w_])|~~(?<strike>[^~]+)~~|(?<![\w*])\*(?=\S)(?<emphasis>[^*]+?)(?<=\S)\*(?![\w*])|(?<![\w_])_(?=\S)(?<emphasis2>[^_]+?)(?<=\S)_(?![\w_])|(?<bang>!?)\[(?<label>[^\]]{0,512})\]\((?<target>(?:[^()\s]|\([^()\s]*\)){1,2048})(?:\s+"[^"]*")?\)|(?<bare>https?:\/\/[^\s<>()[\]]{0,2048}[^\s<>()[\].,;:!?'"])/g;
const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const DELIMITER = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?$/;


function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch { return undefined; }
}


export function filePath(value: string): string | undefined {
  const candidate = value.trim().replace(/:\d+(?::\d+)?$/, "");
  if (!candidate || /\s/.test(candidate) || candidate.includes("://")) return undefined;
  const rooted = /^(?:~\/|\/|\.{1,2}\/|[A-Za-z]:[\\/])/.test(candidate);
  const slashed = candidate.includes("/") && /\.[A-Za-z0-9]{1,8}$/.test(candidate);
  return rooted || slashed ? candidate : undefined;
}

export function inlineSpans(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) spans.push({ text: text.slice(last, at) });
    last = at + match[0].length;
    const found: Partial<Record<string, string>> = match.groups ?? {};
    const strong = found.strong ?? found.strong2;
    const emphasis = found.emphasis ?? found.emphasis2;
    const bare = found.bare ? safeHref(found.bare) : undefined;
    if (found.escaped) spans.push({ text: found.escaped });
    else if (found.bare) spans.push(bare ? { text: found.bare, href: bare } : { text: found.bare });
    else if (found.code) spans.push({ text: found.code, code: true, path: filePath(found.code) });
    else if (found.both) spans.push({ text: found.both, bold: true, italic: true });
    else if (strong) spans.push({ text: strong, bold: true });
    else if (found.strike) spans.push({ text: found.strike, strike: true });
    else if (emphasis) spans.push({ text: emphasis, italic: true });
    else {
      const { target = "", label = "" } = found;
      const href = safeHref(target);
      const file = href ? undefined : filePath(target);
      if (found.bang && file) spans.push({ text: label, path: file, image: true });
      else spans.push(href ? { text: label, href } : file ? { text: label, path: file } : { text: label });
    }
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length ? spans : [{ text }];
}


function cells(line: string): Span[][] {
  return line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|(?=(?:[^`]*`[^`]*`)*[^`]*$)/).map((cell) => inlineSpans(cell.trim().replace(/\\\|/g, "|")));
}

function nest(list: List | undefined, indent: number): [List | undefined, Item | undefined] {
  let owner: Item | undefined;
  for (let depth = 2; depth <= indent && list; depth += 2) {
    owner = list.items[list.items.length - 1];
    list = owner.sub?.[owner.sub.length - 1];
  }
  return [list, owner];
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      const body = paragraph.join("\n");
      if (/^<[A-Za-z!]/.test(body) && body.includes(">")) blocks.push({ kind: "code", language: "html", text: body });
      else blocks.push({ kind: "paragraph", spans: inlineSpans(body) });
    }
    if (quote.length) blocks.push({ kind: "quote", spans: inlineSpans(quote.join("\n")) });
    paragraph = [];
    quote = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      const close = new RegExp(`^\\s{0,3}${fence[2][0]}{${fence[2].length},}\\s*$`);
      const strip = fence[1].length;
      for (index += 1; index < lines.length && !close.test(lines[index]); index += 1) body.push(lines[index].replace(/^\s+/, (space) => space.slice(strip)));
      blocks.push({ kind: "code", language: fence[3], text: body.join("\n") });
      continue;
    }

    if (!line.trim()) { flush(); continue; }

    if (RULE.test(line)) { flush(); blocks.push({ kind: "rule" }); continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      const body = line.slice(heading[0].length).trimEnd();
      let end = body.length;
      while (end > 0 && body[end - 1] === "#") end -= 1;
      const text = body.slice(0, end).trimEnd();
      if (!/[\u2028\u2029]/.test(text)) {
        flush();
        blocks.push({ kind: "heading", level: heading[1].length, spans: inlineSpans(text) });
        continue;
      }
    }

    const next = lines[index + 1] ?? "";
    if (line.includes("|") && next.includes("|") && DELIMITER.test(next.trim())) {
      flush();
      const head = cells(line);
      const rows: Row[] = [];
      for (index += 2; index < lines.length && lines[index].includes("|") && lines[index].trim(); index += 1) rows.push(cells(lines[index]));
      index -= 1;
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      if (paragraph.length) flush();
      quote.push(quoted[1]);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      const ordered = bullet[2] !== undefined;
      const task = ordered ? null : TASK.exec(bullet[3]);
      const made: Item = task ? { spans: inlineSpans(task[2]), checked: task[1] !== " " } : { spans: inlineSpans(bullet[3]) };
      const previous = blocks[blocks.length - 1];
      const start = ordered ? { start: Number(bullet[2]) } : {};
      const [list, owner] = nest(previous?.kind === "list" ? previous : undefined, bullet[1].length);
      if (list?.ordered === ordered) list.items.push(made);
      else if (owner) (owner.sub ??= []).push({ ordered, items: [made], ...start });
      else blocks.push({ kind: "list", ordered, items: [made], ...start });
      continue;
    }

    const previous = blocks[blocks.length - 1];
    const indent = line.length - line.trimStart().length;
    if (previous?.kind === "list" && indent >= 2 && !paragraph.length && !quote.length) {
      const [, item] = nest(previous, indent);
      item?.spans.push(...inlineSpans("\n" + line.trim()));
      continue;
    }

    if (quote.length) flush();
    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}
