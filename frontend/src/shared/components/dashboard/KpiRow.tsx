import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Kpi from "@/shared/components/ui/Kpi";

export interface KpiTile {
  key: string;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "red";
  size?: "sm" | "md" | "lg" | "hero";
  /** When set, the whole tile becomes a link to this route. */
  href?: string;
}

/**
 * The headline KPI row for an FMS home dashboard. Tiles are TOTALS (open items,
 * live entities, …), so they stay informative even when nothing is due — a real
 * `0` reads as "none", not as a blank screen.
 *
 * A tile with `href` renders as a link with a hover lift, so the number becomes a
 * doorway to the list it summarises. Tiles without `href` stay plain — the row is
 * shared, and not every metric has a page to open.
 */
export default function KpiRow({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {tiles.map((t) => {
        const tile = (
          <Kpi
            label={t.label}
            value={t.value}
            hint={t.hint}
            tone={t.tone}
            size={t.size ?? "lg"}
            className={t.href ? "h-full transition-[box-shadow,border-color,transform] hover:-translate-y-0.5 hover:shadow-card hover:border-orange/40" : undefined}
          />
        );
        return t.href ? (
          <Link
            key={t.key}
            to={t.href}
            className="block rounded-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange/20"
          >
            {tile}
          </Link>
        ) : (
          <div key={t.key}>{tile}</div>
        );
      })}
    </div>
  );
}
