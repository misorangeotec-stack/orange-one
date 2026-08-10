/**
 * Quantity dispatched per day across the selected range.
 *
 * Same Recharts conventions as the HR dashboards
 * (`apps/hr-exit/components/ExitCharts.tsx`) — same palette, axis styling and
 * tooltip — so the FMS screens read as one product.
 *
 * ⚠ PLOTS QUANTITY, NOT CONSIGNMENTS. Volume is the measure the business runs on;
 *   a day with one 2,000 KG load and a day with four small parcels are not the
 *   same day, and the old count series drew them as though the second were four
 *   times the first. The count still rides along in the tooltip.
 *
 * ⚠ DOES NO ARITHMETIC. The series arrives already computed from
 *   `lib/dispatchBoard.perDay`, which is also what the tiles count. A chart that
 *   totals its own data is a second source of truth, and it will eventually
 *   disagree with the tile sitting above it.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { qtyNum, type DayPoint } from "../lib/dispatchBoard";

const ORANGE = "#FF6A1F";
const AXIS = { fontSize: 11, fill: "#64748B" };
const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid #EEF2F8",
  fontSize: 12,
  boxShadow: "0 6px 20px rgba(11,27,64,0.08)",
};

/** "07 Aug" — short enough that a month of them fits without rotating. */
const tick = (dayIso: string): string => {
  const d = new Date(`${dayIso}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
};

/** 2,400 → "2.4k", so a quantity axis stays narrow enough not to eat the plot. */
const compact = (n: number): string =>
  n >= 1000 ? `${Number((n / 1000).toFixed(1))}k` : qtyNum(n);

export default function DispatchTrend({
  data,
  unit,
  title = "Quantity dispatched per day",
}: {
  data: DayPoint[];
  /** The unit the series is measured in, from `dominantUnit`. */
  unit: string | null;
  title?: string;
}) {
  // A single bar is not a trend. The dashboard already gates on this, but a
  // component that draws a one-bar chart when asked is a trap for the next caller.
  if (data.length < 2) return null;

  const totalQty = data.reduce((n, d) => n + d.qty, 0);
  const totalCount = data.reduce((n, d) => n + d.count, 0);
  const unitLabel = unit && unit !== "—" ? unit : "";
  // With a month of days, labelling every one turns the axis into a smear.
  const interval = data.length > 16 ? Math.ceil(data.length / 12) - 1 : 0;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className={SECTION_HEADING_CLASS}>
          {title}
          {unitLabel && <span className="ml-1.5 font-medium normal-case tracking-normal text-grey-2">({unitLabel})</span>}
        </h3>
        <span className="text-[12px] text-grey tabular-nums">
          {qtyNum(totalQty)} {unitLabel} · {totalCount} consignments
        </span>
      </div>

      {totalCount === 0 ? (
        <p className="text-[13px] text-grey-2 py-2">Nothing left the plant in this range.</p>
      ) : (
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#EEF2F8" vertical={false} />
              <XAxis
                dataKey="dayIso"
                tickFormatter={tick}
                tick={AXIS}
                interval={interval}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={AXIS} tickFormatter={compact} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "rgba(255,106,31,0.06)" }}
                labelFormatter={(v) => tick(String(v))}
                formatter={(_v, _n, item) => {
                  const p = item?.payload as DayPoint | undefined;
                  return [
                    `${qtyNum(p?.qty ?? 0)}${unitLabel ? ` ${unitLabel}` : ""} · ${p?.count ?? 0} consignment${
                      p?.count === 1 ? "" : "s"
                    }`,
                    "Dispatched",
                  ];
                }}
              />
              <Bar dataKey="qty" fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
