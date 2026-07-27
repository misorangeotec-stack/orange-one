import type { LucideIcon } from "lucide-react";
import WidgetCard from "./WidgetCard";
import DeltaBadge from "./DeltaBadge";
import TrendChart from "./TrendChart";
import { fmtINRMoney } from "@hub/lib/utils";
import { SERIES_CURRENT, SERIES_PRIOR } from "@hub/lib/chartColors";
// Sourced from execDashboard (the surviving C-Level data layer), not clevelDashboard — the two
// declare an identical shape and this lets the superseded lib be deleted without touching this file.
import type { MonthPoint } from "@hub/lib/execDashboard";

/**
 * The PDF's dominant card shape: a big ₹ headline with a "% vs prior year" badge and the
 * prior-year-to-date figure, sitting above a two-series (this year vs last year) chart.
 * Used for Gross/Net Profit, Monthly Sales/Purchase, Income and Expense.
 */
export interface MetricTrendCardProps {
  title: string;
  icon?: LucideIcon;
  value: number;
  priorValue?: number | null;
  /** e.g. "PYTD: FY 25-26" — shown beside the prior-year figure. */
  priorCaption?: string;
  invert?: boolean; // cost coloring for the delta (a rise is bad)
  data: MonthPoint[];
  chartType?: "line" | "bar";
  curFy: string;
  priFy: string;
  height?: number;
  className?: string;
  loading?: boolean;
  error?: string | null;
}

export default function MetricTrendCard({
  title,
  icon,
  value,
  priorValue,
  priorCaption,
  invert,
  data,
  chartType = "line",
  curFy,
  priFy,
  height = 165,
  className,
  loading,
  error,
}: MetricTrendCardProps) {
  const series = [{ key: "current", name: curFy || "This year", color: SERIES_CURRENT, type: chartType }];
  if (priFy) series.push({ key: "prior", name: priFy, color: SERIES_PRIOR, type: chartType });
  const chartData = data.map((p) => ({ month: p.month, current: p.current, prior: p.prior }));

  return (
    <WidgetCard title={title} icon={icon} className={className} loading={loading} error={error}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-2xl font-bold text-navy leading-none">{fmtINRMoney(value)}</div>
        <div className="text-right shrink-0">
          <DeltaBadge current={value} prior={priorValue} invert={invert} className="justify-end" />
          {priorValue != null && (
            <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
              {fmtINRMoney(priorValue)}
              {priorCaption && <span className="opacity-70"> ({priorCaption})</span>}
            </div>
          )}
        </div>
      </div>
      <TrendChart data={chartData} series={series} height={height} />
    </WidgetCard>
  );
}
