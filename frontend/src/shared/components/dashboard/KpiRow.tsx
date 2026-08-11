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
  /**
   * When set, the tile becomes a FILTER for a list on the same page instead of a
   * doorway to another one — clicking calls this, and `selected` rings the tile.
   *
   * Exists because a link is the wrong affordance where the destination is
   * permission-gated: a step queue hands a non-owner Access Denied, so the tile
   * that summarises their work cannot be a link to it. Filtering in place shows
   * the same rows to everyone who may see the order at all.
   *
   * Ignored when `href` is also set — a tile is one thing or the other.
   */
  onSelect?: () => void;
  selected?: boolean;
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
        const interactive = !!t.href || !!t.onSelect;
        const tile = (
          <Kpi
            label={t.label}
            value={t.value}
            hint={t.hint}
            tone={t.tone}
            size={t.size ?? "lg"}
            className={[
              interactive
                ? "h-full transition-[box-shadow,border-color,transform] hover:-translate-y-0.5 hover:shadow-card hover:border-orange/40"
                : "",
              // The ring, not a fill: the number stays the loudest thing on the
              // tile whether or not it is the one being looked through.
              t.selected ? "border-orange ring-4 ring-orange/15" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined}
          />
        );
        const focusCls =
          "block w-full text-left rounded-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange/20";
        if (t.href) {
          return (
            <Link key={t.key} to={t.href} className={focusCls}>
              {tile}
            </Link>
          );
        }
        if (t.onSelect) {
          return (
            <button
              key={t.key}
              type="button"
              onClick={t.onSelect}
              aria-pressed={!!t.selected}
              className={focusCls}
            >
              {tile}
            </button>
          );
        }
        return <div key={t.key}>{tile}</div>;
      })}
    </div>
  );
}
