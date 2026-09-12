import { useMemo } from "react";
import { diffLines } from "../shared/agents";

export function ChangeDiff({ before, after }: { before: string; after: string }) {
  const groups = useMemo(() => {
    const result: ReturnType<typeof diffLines>[] = [];
    for (const line of diffLines(before, after)) {
      const last = result.at(-1);
      if (last && (last[0].kind === " ") === (line.kind === " ")) last.push(line);
      else result.push([line]);
    }
    return result;
  }, [before, after]);
  return <div className="diff">{groups.map((lines, index) => {
    const content = lines.map((line, row) => <span key={row} className={line.kind === "+" ? "added" : line.kind === "-" ? "removed" : undefined}>{line.kind}{line.text}{"\n"}</span>);
    return lines[0].kind === " "
      ? <details className="diff-context" key={index}>
        <summary aria-label={`Unchanged lines: ${lines.length} — toggle context`} title={`Unchanged lines: ${lines.length}`}>…</summary>
        {content}
      </details>
      : <div key={index}>{content}</div>;
  })}</div>;
}
