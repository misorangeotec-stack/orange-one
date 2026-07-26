import type { LucideIcon } from "lucide-react";
import { Card } from "@hub/components/ui/card";
import { cn } from "@hub/lib/utils";
import { fmtINRMoney } from "@hub/lib/utils";
import DeltaBadge from "./DeltaBadge";

/**
 * Dense KPI tile: label + big ₹ value + a "% vs prior year" badge + optional caption.
 * Used across the top strip of the C-Level dashboard.
 */
export interface KpiDeltaTileProps {
  label: string;
  value: number;
  prior?: number | null;
  format?: (n: number) => string;
  invert?: boolean; // cost metric coloring
  icon?: LucideIcon;
  caption?: string;
  accent?: boolean;
  className?: string;
}

export default function KpiDeltaTile({
  label,
  value,
  prior,
  format = fmtINRMoney,
  invert,
  icon: Icon,
  caption,
  accent,
  className,
}: KpiDeltaTileProps) {
  return (
    <Card
      className={cn(
        "rounded-card border-border bg-surface px-3 py-2 flex flex-col justify-between gap-1",
        accent && "ring-1 ring-orange/20",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="text-[11px] font-medium text-muted-foreground truncate">{label}</span>
      </div>
      <div className={cn("text-lg font-bold leading-none", accent ? "text-primary" : "text-navy")}>
        {format(value)}
      </div>
      <div className="flex items-center justify-between gap-1">
        <DeltaBadge current={value} prior={prior} invert={invert} />
        {caption && <span className="text-[10px] text-muted-foreground truncate">{caption}</span>}
      </div>
    </Card>
  );
}
