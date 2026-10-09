import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import type { FlowStatus } from "../lib/flow";

/**
 * Small building blocks shared by the Ink Stabilisation pages, so every screen draws
 * a segmented switch, a progress bar and a section heading the same way.
 */

/** One colour per lab test, used everywhere a test is drawn (bars, dots, legends). */
export const TEST_COLOR = ["bg-navy", "bg-orange", "bg-teal"] as const;

/** One colour per flow status — the same order everywhere: done work first. */
export const STATUS_ORDER: FlowStatus[] = ["closed", "submitted", "returned", "pending"];
export const STATUS_BAR: Record<FlowStatus, string> = {
  closed: "bg-ryg-green",
  submitted: "bg-blue",
  returned: "bg-ryg-red",
  pending: "bg-grey/25",
};

export function Segmented<T extends string | number>({
  value, onChange, options, size = "md", className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number; dot?: string }[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap gap-1 rounded-xl bg-page p-1", className)} role="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg font-semibold transition",
              size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3.5 py-1.5 text-[13px]",
              on ? "bg-white text-navy shadow-sm ring-1 ring-line" : "text-grey hover:text-navy",
            )}
          >
            {o.dot && <i className={cn("inline-block h-2 w-2 rounded-full", o.dot)} />}
            {o.label}
            {o.count !== undefined && (
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums",
                on ? "bg-orange/15 text-orange" : "bg-white text-grey")}>
                {o.count.toLocaleString("en-IN")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A horizontal stacked bar. Segments with 0 are skipped; an all-zero bar draws empty. */
export function StackBar({
  parts, height = "h-2", className,
}: {
  parts: { value: number; color: string; label?: string }[];
  height?: string;
  className?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-page", height, className)}>
      {total > 0 && parts.filter((p) => p.value > 0).map((p, i) => (
        <div key={i} className={p.color} style={{ width: `${(p.value / total) * 100}%` }}
          title={p.label ? `${p.label}: ${p.value}` : undefined} />
      ))}
    </div>
  );
}

export function SectionTitle({ title, hint, right }: { title: string; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-[15px] font-bold text-navy">{title}</h2>
        {hint && <p className="text-[12px] text-grey">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-grey">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <i className={cn("inline-block h-2.5 w-2.5 rounded-sm", i.color)} />{i.label}
        </span>
      ))}
    </div>
  );
}

/** Per-status counts for a set of tests — what every progress bar is drawn from. */
export function statusCounts(tests: { status: FlowStatus }[]): Record<FlowStatus, number> {
  const c: Record<FlowStatus, number> = { closed: 0, submitted: 0, returned: 0, pending: 0 };
  for (const t of tests) c[t.status]++;
  return c;
}

export const statusParts = (c: Record<FlowStatus, number>) => STATUS_ORDER.map((s) => ({
  value: c[s], color: STATUS_BAR[s],
  label: { closed: "Closed", submitted: "Awaiting review", returned: "Sent back", pending: "Pending" }[s],
}));

/**
 * A swatch for an ink's colour, read off its name ("KY REACTIVE INK PRO MAGENTA" → magenta)
 * with Bushra Central Master's own parser, so both apps name a colour the same way.
 */
const SWATCH: Record<string, string> = {
  black: "#1f2328", cyan: "#00a8e1", magenta: "#d6007e", yellow: "#ffd400", blue: "#1f4fd1",
  red: "#e02424", orange: "#ff7a1a", green: "#16a34a", violet: "#7c3aed", purple: "#7c3aed",
  grey: "#8a94a6", gray: "#8a94a6", pink: "#ec4899", brown: "#8b5a2b", white: "#ffffff",
  navy: "#1e2a5a", "light cyan": "#7fd8f0", "light magenta": "#f07fc0", "light black": "#6b7280",
  "dark blue": "#1e3a8a", "golden yellow": "#f5b800", "lemon yellow": "#fff04d", "fluorescent pink": "#ff3ea5",
};

export function ColourDot({ colour, className }: { colour: string | null; className?: string }) {
  const key = (colour ?? "").toLowerCase();
  const hex = SWATCH[key] ?? SWATCH[key.split(" ").pop() ?? ""] ?? null;
  return (
    <span
      title={colour ?? "Colour not in the name"}
      className={cn("inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10", !hex && "bg-[repeating-linear-gradient(45deg,#e5e7eb_0_3px,#fff_3px_6px)]", className)}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  );
}
