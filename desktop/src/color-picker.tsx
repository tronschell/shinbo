import { hexHsv, hsvHex } from "../shared/color";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";




const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function ColorPicker({ value, onChange, onPreview, disabled, label, className, children }: {
  value: string;
  onChange: (hex: string) => void;
  onPreview?: (hex: string) => void;
  disabled?: boolean;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexHsv(value));
  const [typed, setTyped] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [h, s, v] = hsv;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!menu.current?.contains(node) && !trigger.current?.contains(node)) setOpen(false);
    };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [open]);

  const emit = (next: [number, number, number]) => { setHsv(next); setTyped(""); onPreview?.(hsvHex(...next)); };
  const drag = (pick: (x: number, y: number) => void) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.type === "pointerup") {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) onChange(hsvHex(h, s, v));
      return;
    }
    if (event.buttons !== 1) return;
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    else if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const box = event.currentTarget.getBoundingClientRect();
    pick(clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height));
  };
  const svDrag = drag((x, y) => emit([h, x, 1 - y]));
  const hueDrag = drag((x) => emit([x * 360, s, v]));
  const hex = hsvHex(h, s, v);

  return <div className="color-well">
    <button ref={trigger} type="button" className={className} disabled={disabled} title={label}
      style={{ "--swatch": value } as CSSProperties}
      aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}, currently ${value}`}
      onClick={() => { if (!open) setHsv(hexHsv(value)); setOpen(!open); }}>
      {children}
    </button>
    {open && !disabled && <div ref={menu} className="source-popover color-menu" role="dialog" aria-label={label}
      onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }}>
      <div className="color-field" style={{ "--hue": hsvHex(h, 1, 1) } as CSSProperties} onPointerDown={svDrag} onPointerMove={svDrag} onPointerUp={svDrag}>
        <i style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex }} />
      </div>
      <div className="color-hue" onPointerDown={hueDrag} onPointerMove={hueDrag} onPointerUp={hueDrag}>
        <i style={{ left: `${(h / 360) * 100}%`, background: hsvHex(h, 1, 1) }} />
      </div>
      <div className="color-row">
        <span className="color-chip" style={{ background: hex }} />
        <input value={typed || hex.toUpperCase()} spellCheck={false} maxLength={7} aria-label={`${label} hex`}
          onChange={(event) => {
            const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
            setTyped(next.toUpperCase());
            if (/^#([\da-f]{3}|[\da-f]{6})$/i.test(next)) { setHsv(hexHsv(next)); onChange(hsvHex(...hexHsv(next))); }
          }}
          onBlur={() => setTyped("")} />
      </div>
    </div>}
  </div>;
}
