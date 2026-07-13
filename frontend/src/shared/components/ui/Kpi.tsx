import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { cn } from "@/shared/lib/cn";

/**
 * The headline stat tile — previously hand-copied as `Kpi` / `Stat` / `Info` across
 * the dashboards and detail pages, each copy drifting a little further from the last.
 *
 * `size` exists because those copies genuinely wanted different value sizes (a PO
 * Detail stat strip is not a dashboard hero number). Collapsing them to one size
 * would silently resize live dashboards, and this change is meant to alter typography
 * only — never layout. So the size stays a decision the caller makes, and every
 * conversion is a pure like-for-like swap.
 */
type KpiSize = "sm" | "md" | "lg" | "hero";

const VALUE_SIZE: Record<KpiSize, string> = {
  sm: "text-[16px]", // compact stat strips (PO Detail)
  md: "text-[20px]", // standard tiles (Control Center)
  lg: "text-[24px]", // dashboard tiles
  hero: "text-[30px]", // the one number the screen is about
};

export default function Kpi({
  label,
  value,
  hint,
  tone,
  size = "md",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "red";
  size?: KpiSize;
  className?: string;
}) {
  return (
    <Card className={cn("px-4 py-3", size === "hero" && "ring-1 ring-orange/20", className)}>
      <div className={FIELD_LABEL_CLASS}>{label}</div>
      <div className={cn("mt-0.5 font-bold", VALUE_SIZE[size], tone === "red" ? "text-ryg-red" : "text-navy")}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-grey">{hint}</div>}
    </Card>
  );
}
