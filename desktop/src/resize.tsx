import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

export function ResizeHandle({ label, value, min, max, direction = 1, axis = "x", onChange }: { label: string; value: number; min: number; max: number; direction?: 1 | -1; axis?: "x" | "y"; onChange: (value: number) => void }) {
  const drag = useRef<{ at: number; value: number } | undefined>(undefined);
  const frame = useRef(0);
  const latest = useRef(value);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));
  const along = (event: { clientX: number; clientY: number }) => axis === "x" ? event.clientX : event.clientY;
  const move = (event: { clientX: number; clientY: number }) => {
    if (!drag.current) return;
    latest.current = clamp(drag.current.value + (along(event) - drag.current.at) * direction);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; onChange(latest.current); });
  };
  const [less, more] = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  const key = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== less && event.key !== more) return;
    event.preventDefault();
    onChange(clamp(value + (event.key === more ? 8 : -8) * direction));
  };
  return <button type="button" className="resize-handle" role="separator" aria-label={label} aria-orientation={axis === "x" ? "vertical" : "horizontal"} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} onKeyDown={key} onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => { drag.current = { at: along(event), value }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={move} onPointerUp={() => { drag.current = undefined; }} />;
}

export const readHeight = (key: string, fallback: number): number => {
  const stored = Number(localStorage.getItem(key));
  return stored > 0 ? stored : fallback;
};
