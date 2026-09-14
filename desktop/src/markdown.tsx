import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FileMark } from "./git";
import { GlobeIcon } from "./icons";
import { parseBlocks, pathLink, type List, type Row, type Span } from "./markdown-parse";
import { openPreview } from "./preview";
import { CodeBlock } from "./run-block";
import { highlightSegments } from "../shared/slash";

export const SkillNames = createContext<string[]>([]);

export type PathOpener = { known: (path: string) => boolean; open: (path: string, line?: number) => void };

export const OpenPaths = createContext<PathOpener | null>(null);

function PathSpan({ path, text }: { path: string; text: string }) {
  const opener = useContext(OpenPaths);
  const link = pathLink(text);
  const inPane = link?.path === path && opener?.known(path) ? link : undefined;
  if (!inPane && !path.includes("/")) return <code>{text || path}</code>;
  const open = () => inPane && opener ? opener.open(inPane.path, inPane.line) : openPreview(path);
  return <code className="md-path" role="button" tabIndex={0} title={`Open ${path}`}
    onClick={open}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}
  ><FileMark path={path} />{text || path}</code>;
}

function Picture({ path, alt }: { path: string; alt: string }) {
  const [preview, setPreview] = useState<{ path: string; image: string }>();
  const target = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let live = true;
    const read = () => void window.shinbo.previewPath(path)
      .then((found) => { if (live) setPreview({ path, image: found?.image ?? "" }); })
      .catch(() => { if (live) setPreview({ path, image: "" }); });
    if (typeof IntersectionObserver === "undefined") {
      read();
      return () => { live = false; };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (!live || !entry?.isIntersecting) return;
      timer = setTimeout(() => {
        observer.disconnect();
        read();
      }, 100);
    }, { rootMargin: "400px" });
    if (target.current) observer.observe(target.current);
    return () => { live = false; clearTimeout(timer); observer.disconnect(); };
  }, [path]);
  const source = preview?.path === path ? preview.image : "";
  return <span ref={target}>{source
    ? <button type="button" className="md-image-button" aria-label={`Open ${path}`} title={path} onClick={() => openPreview(path, alt || undefined)}><img className="md-image" src={source} alt={alt} /></button>
    : <PathSpan path={path} text={alt} />}</span>;
}

function TextSpan({ text }: { text: string }) {
  const skills = useContext(SkillNames);
  return <>{highlightSegments(text, skills).map((segment, index) => segment.hue === undefined || !segment.text.startsWith("/")
    ? <span key={index}>{segment.text}</span>
    : <a key={index} href={segment.text} title={`Open ${segment.text.slice(1)} skill`} onClick={(event) => { event.preventDefault(); openPreview(segment.text, segment.text.slice(1)); }}>{segment.text}</a>)}</>;
}

function Spans({ spans }: { spans: Span[] }) {
  return <>{spans.map((span, index) => {
    if (span.href) return <a key={index} href={span.href} target="_blank" rel="noreferrer"><span className="git-type" aria-hidden="true"><GlobeIcon /></span>{span.text}</a>;
    if (span.image && span.path) return <Picture key={index} path={span.path} alt={span.text} />;
    if (span.path) return <PathSpan key={index} path={span.path} text={span.text} />;
    if (span.code) return <code key={index}>{span.text}</code>;
    if (span.bold) return <strong key={index}>{span.italic ? <em>{span.text}</em> : span.text}</strong>;
    if (span.strike) return <del key={index}>{span.text}</del>;
    if (span.italic) return <em key={index}>{span.text}</em>;
    return <TextSpan key={index} text={span.text} />;
  })}</>;
}

function Items({ list }: { list: List }) {
  const Tag = (list.ordered ? "ol" : "ul") as "ol";
  return <Tag start={list.ordered && list.start !== 1 ? list.start : undefined}>{list.items.map((item, index) => <li key={index} className={item.checked === undefined ? undefined : "md-task"}>
    {item.checked !== undefined && <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? "Done" : "Not done"} />}
    <Spans spans={item.spans} />
    {item.sub?.map((sub, at) => <Items key={at} list={sub} />)}
  </li>)}</Tag>;
}

function Cells({ row, head }: { row: Row; head?: true }) {
  const Cell = head ? "th" : "td";
  return <tr>{row.map((cell, index) => <Cell key={index}><Spans spans={cell} /></Cell>)}</tr>;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return <>{blocks.map((block, index) => {
    switch (block.kind) {
      case "heading": {
        const Heading = `h${Math.min(block.level + 2, 6)}` as "h3";
        return <Heading key={index}><Spans spans={block.spans} /></Heading>;
      }
      case "code":
        return <CodeBlock key={index} text={block.text} language={block.language} />;
      case "list":
        return <Items key={index} list={block} />;
      case "table":
        return <div key={index} className="md-table"><table>
          <thead><Cells row={block.head} head /></thead>
          <tbody>{block.rows.map((row, rowIndex) => <Cells key={rowIndex} row={row} />)}</tbody>
        </table></div>;
      case "quote":
        return <blockquote key={index}><Spans spans={block.spans} /></blockquote>;
      case "rule":
        return <hr key={index} />;
      default:
        return <p key={index}><Spans spans={block.spans} /></p>;
    }
  })}</>;
});
