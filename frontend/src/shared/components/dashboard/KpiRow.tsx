import type { ReactNode } from "react";
import Kpi from "@/shared/components/ui/Kpi";

export interface KpiTile {
  key: string;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "red";
  size?: "sm" | "md" | "lg" | "hero";
}

/**
 * The headline KPI row for an FMS home dashboard. Tiles are TOTALS (open items,
 * live entities, …), so they stay informative even when nothing is due — a real
 * `0` reads as "none", not as a blank screen.
 */
export default function KpiRow({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {tiles.map((t) => (
        <Kpi key={t.key} label={t.label} value={t.value} hint={t.hint} tone={t.tone} size={t.size ?? "lg"} />
      ))}
    </div>
  );
}
