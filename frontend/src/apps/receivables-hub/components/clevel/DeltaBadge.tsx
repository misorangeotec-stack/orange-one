import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@hub/lib/utils";

/**
 * "% vs prior year" pill. Green = good, red = bad; `invert` flips the coloring for cost
 * metrics (a rise in expense is bad). Hidden when there is no comparable prior value.
 */
export interface DeltaBadgeProps {
  current: number;
  prior: number | null | undefined;
  invert?: boolean;
  suffix?: string; // e.g. "vs FY 25-26"
  className?: string;
}

export default function DeltaBadge({ current, prior, invert, suffix, className }: DeltaBadgeProps) {
  if (prior == null || Math.abs(prior) < 0.5) return null;
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  if (!isFinite(pct)) return null;
  const up = pct >= 0;
  const good = invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  // A tiny prior base (a sparse prior year) makes the % explode; cap it so the badge stays readable.
  const text = pct >= 1000 ? ">999%" : `${up ? "+" : ""}${pct.toFixed(1)}%`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold", className)}>
      <Icon className={cn("h-3 w-3", good ? "text-ryg-green" : "text-ryg-red")} />
      <span className={good ? "text-ryg-green" : "text-ryg-red"}>{text}</span>
      {suffix && <span className="text-muted-foreground font-normal ml-0.5">{suffix}</span>}
    </span>
  );
}
