/**
 * The strip under a box that drags it taller or shorter — the same grip the Ink Expiry charts use
 * (apps/ink-expiry/components/ResizeGrip.tsx), copied so this app does not depend on that one.
 *
 * It only reports pointer travel; what a pixel means is the owner's business. Double-click
 * resets. ↑ / ↓ on the focused strip move it 40 px.
 */
import { useRef } from "react";

export default function HeightGrip({
  onStart,
  onMove,
  onReset,
  label = "Drag to make the chart taller or shorter · double-click to reset",
}: {
  onStart: () => void;
  onMove: (dy: number) => void;
  onReset: () => void;
  label?: string;
}) {
  const drag = useRef<{ y: number } | null>(null);
  const stop = () => {
    drag.current = null;
    document.body.style.cursor = "";
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY };
        onStart();
        document.body.style.cursor = "row-resize";
      }}
      onPointerMove={(e) => {
        if (drag.current) onMove(e.clientY - drag.current.y);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        onStart();
        onMove(e.key === "ArrowDown" ? 40 : -40);
      }}
      className="group flex h-3 w-full cursor-row-resize touch-none select-none items-center justify-center focus:outline-none"
    >
      <span className="h-1 w-10 rounded-full bg-muted-foreground/25 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
    </div>
  );
}
