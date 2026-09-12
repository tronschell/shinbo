

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

export interface Item { spans: Span[]; sub?: List; checked?: boolean }
export interface List { ordered: boolean; items: Item[] }
export type Row = Span[][];

export type Block =
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "quote"; spans: Span[] }
  | { kind: "code"; language: string; text: string }
  | ({ kind: "list" } & List)
  | { kind: "table"; head: Row; rows: Row[] }
  | { kind: "rule" };



const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_|(!?)\[([^\]]{0,512})\]\(([^)\s]{1,2048})\)|(https?:\/\/[^\s<>()[\]]{0,2048}[^\s<>()[\].,;:!?'"])/g;
const FENCE = /^\s{0,3}(?:```|~~~)\s*([\w+#.-]*)/;
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
    const strong = match[2] ?? match[3];
    const emphasis = match[5] ?? match[6];
    const bare = match[10] ? safeHref(match[10]) : undefined;
    if (match[10]) spans.push(bare ? { text: match[10], href: bare } : { text: match[10] });
    else if (match[1]) spans.push({ text: match[1], code: true, path: filePath(match[1]) });
    else if (strong) spans.push({ text: strong, bold: true });
    else if (match[4]) spans.push({ text: match[4], strike: true });
    else if (emphasis) spans.push({ text: emphasis, italic: true });
    else {
      const href = safeHref(match[9]);
      const file = href ? undefined : filePath(match[9]);
      if (match[7] && file) spans.push({ text: match[8], path: file, image: true });
      else spans.push(href ? { text: match[8], href } : file ? { text: match[8], path: file } : { text: match[8] });
    }
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length ? spans : [{ text }];
}


function cells(line: string): Span[][] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => inlineSpans(cell.trim()));
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
      for (index += 1; index < lines.length && !FENCE.test(lines[index]); index += 1) body.push(lines[index]);
      blocks.push({ kind: "code", language: fence[1], text: body.join("\n") });
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
      if (previous?.kind === "list") {
        const item = previous.items[previous.items.length - 1];
        if (bullet[1].length >= 2) {
          if (item.sub?.ordered === ordered) item.sub.items.push(made);
          else item.sub = { ordered, items: [made] };
          continue;
        }
        if (previous.ordered === ordered) { previous.items.push(made); continue; }
      }
      blocks.push({ kind: "list", ordered, items: [made] });
      continue;
    }

    if (quote.length) flush();
    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}
