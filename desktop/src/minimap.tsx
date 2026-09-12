import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./styles/minimap.css";

export function Minimap({ children, className }: { children: ReactNode; className: string }) {
  const id = useId();
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const miniature = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [view, setView] = useState({ top: 0, height: 1 });

  useEffect(() => {
    const element = scroll.current!;
    const body = content.current!;
    let frame = 0;
    const position = () => {
      const map = miniature.current!;
      const track = map.parentElement!;
      const scale = track.clientWidth / Math.max(1, element.scrollWidth);
      const height = Math.min(element.clientHeight, element.scrollHeight * scale);
      track.style.height = `${height}px`;
      const progress = element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight);
      map.style.transform = `translateY(${-progress * Math.max(0, element.scrollHeight * scale - height)}px) scale(${scale})`;
      setView({ top: progress * Math.max(0, 1 - element.clientHeight * scale / Math.max(1, height)), height: Math.min(1, element.clientHeight * scale / Math.max(1, height)) });
    };
    const paint = () => {
      frame = 0;
      const map = miniature.current!;
      if (element.scrollHeight <= element.clientHeight) {
        map.replaceChildren();
        position();
        return;
      }
      const copy = element.cloneNode(true) as HTMLDivElement;
      copy.removeAttribute("id");
      copy.style.width = `${element.clientWidth}px`;
      copy.style.height = `${element.scrollHeight}px`;
      copy.style.overflow = "hidden";
      const ids = new Map<string, string>();
      for (const node of copy.querySelectorAll("[id]")) {
        ids.set(node.id, `${id}-mini-${node.id}`);
        node.id = ids.get(node.id)!;
      }
      for (const node of copy.querySelectorAll("*")) {
        node.removeAttribute("name");
        for (const attribute of Array.from(node.attributes)) {
          let value = attribute.value;
          for (const [before, after] of ids) {
            if (value === `#${before}`) value = `#${after}`;
            value = value.replaceAll(`url(#${before})`, `url(#${after})`);
          }
          if (value !== attribute.value) node.setAttribute(attribute.name, value);
        }
      }
      map.replaceChildren(copy);
      position();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    resize.observe(body);
    const mutation = new MutationObserver(schedule);
    mutation.observe(body, { childList: true, subtree: true, characterData: true, attributes: true });
    element.addEventListener("scroll", position, { passive: true });
    body.addEventListener("load", schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      element.removeEventListener("scroll", position);
      body.removeEventListener("load", schedule, true);
    };
  }, [id]);

  return <div className="minimap-layout">
    <div className="content-minimap" role="scrollbar" tabIndex={view.height < 1 ? 0 : -1} aria-label="Content minimap" aria-controls={id} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.top / Math.max(0.0001, 1 - view.height) * 100)} data-overflow={view.height < 1}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const at = (event.clientY - bounds.top) / bounds.height;
        drag.current = at >= view.top && at <= view.top + view.height ? at - view.top : view.height / 2;
        event.currentTarget.setPointerCapture(event.pointerId);
        scroll.current!.scrollTop = (at - drag.current) / Math.max(0.0001, 1 - view.height) * (scroll.current!.scrollHeight - scroll.current!.clientHeight);
        event.preventDefault();
        event.currentTarget.focus();
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        scroll.current!.scrollTop = ((event.clientY - bounds.top) / bounds.height - drag.current) / Math.max(0.0001, 1 - view.height) * (scroll.current!.scrollHeight - scroll.current!.clientHeight);
      }}
      onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const element = scroll.current!;
        const values: Record<string, number> = { ArrowDown: element.scrollTop + 40, ArrowUp: element.scrollTop - 40, PageDown: element.scrollTop + element.clientHeight, PageUp: element.scrollTop - element.clientHeight, Home: 0, End: element.scrollHeight };
        if (event.key in values) { event.preventDefault(); element.scrollTop = values[event.key]; }
      }}>
      <div ref={miniature} className="minimap-miniature" aria-hidden="true" inert />
      <div className="minimap-viewport" style={{ top: `${view.top * 100}%`, height: `${view.height * 100}%` }} />
    </div>
    <div ref={scroll} id={id} className={className}><div ref={content}>{children}</div></div>
  </div>;
}
