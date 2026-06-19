import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Extra classes for the scroll container (e.g. rounded/border). */
  className?: string;
  /** Optional max-height (Tailwind class, e.g. "max-h-[55vh]") to also scroll vertically. */
  maxHeight?: string;
  /** Pixels moved per key/button press. */
  step?: number;
}

/**
 * Wraps a table in a scroll container that can be driven by the keyboard
 * (← ↑ → ↓, PageUp/PageDown, Home/End — when the table is focused) and by
 * on-screen ‹ › buttons. The buttons + hint only appear when the content
 * actually overflows horizontally, so it's safe to wrap every table.
 *
 * Note: the shadcn `<Table>` wraps its `<table>` in its own `overflow-auto`
 * div, which would otherwise capture horizontal scroll. `[&>div]:!overflow-visible`
 * neutralises that so THIS element is the single scroll container for both axes.
 */
export function ScrollableTable({ children, className, maxHeight, step = 320 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  const check = () => {
    const el = ref.current;
    if (el) setOverflow(el.scrollWidth > el.clientWidth + 1);
  };
  useLayoutEffect(check);
  useEffect(() => {
    check();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => { ro.disconnect(); window.removeEventListener("resize", check); };
  }, []);

  const by = (dx: number, dy: number) => ref.current?.scrollBy({ left: dx, top: dy, behavior: "smooth" });

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement | null;
    if (t) {
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
    }
    const node = ref.current;
    if (!node) return;
    const V = 240;
    switch (e.key) {
      case "ArrowRight": by(step, 0); break;
      case "ArrowLeft":  by(-step, 0); break;
      case "ArrowDown":  by(0, V); break;
      case "ArrowUp":    by(0, -V); break;
      case "PageDown":   by(0, node.clientHeight - 40); break;
      case "PageUp":     by(0, -(node.clientHeight - 40)); break;
      case "Home":       node.scrollTo({ top: 0, left: 0, behavior: "smooth" }); break;
      case "End":        node.scrollTo({ top: node.scrollHeight, behavior: "smooth" }); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div>
      {overflow && (
        <div className="flex items-center justify-end gap-2 mb-1.5">
          <span className="text-[11px] text-muted-foreground mr-auto">Use arrow keys ← ↑ → ↓ (or the buttons) to scroll the table.</span>
          <button
            type="button"
            onClick={() => by(-step, 0)}
            aria-label="Scroll left"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground/70 hover:bg-muted/60"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => by(step, 0)}
            aria-label="Scroll right"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground/70 hover:bg-muted/60"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
      <div
        ref={ref}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={`overflow-auto [&>div]:!overflow-visible focus:outline-none ${maxHeight ?? ""} ${className ?? ""}`}
      >
        {children}
      </div>
    </div>
  );
}
