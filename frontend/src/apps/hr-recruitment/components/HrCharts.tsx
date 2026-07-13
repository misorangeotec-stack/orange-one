import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card from "@/shared/components/ui/Card";

/**
 * The HR dashboard's charts. Same Recharts conventions as the Leads dashboard
 * (`apps/leads-dashboard/components/Charts.tsx`) — same palette, same axis styling,
 * same tooltip — so the two dashboards read as one product.
 *
 * Every chart takes ALREADY-COMPUTED numbers from `lib/analytics.ts`. None of them
 * does arithmetic: a chart that computes its own totals is a second source of truth,
 * and the table beside it will eventually disagree with it.
 */

const ORANGE = "#FF6A1F";
const NAVY = "#0B1B40";
const GREEN = "#27AE60";
const RED = "#E5484D";
const YELLOW = "#F8B62B";
const GREY = "#94A3B8";
const PALETTE = ["#FF6A1F", "#2563EB", "#27AE60", "#7C5CFC", "#F43F8E", "#F8B62B", "#14B8A6", "#94A3B8"];

const AXIS = { fontSize: 11, fill: "#64748B" };
const gridStroke = "#EEF2F8";
const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid #EEF2F8",
  fontSize: 12,
  boxShadow: "0 6px 20px rgba(11,27,64,0.08)",
};

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  /** Top-right slot — the Excel button lives here. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-5 ${className ?? ""}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-bold text-navy">{title}</h2>
          {subtitle && <p className="text-[11.5px] text-grey mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A panel with no data yet, said deliberately. Day one is this state, all of it. */
export function NoData({ message }: { message: string }) {
  return (
    <div className="flex h-[150px] items-center justify-center rounded-xl border border-dashed border-line bg-page/40 px-4 text-center">
      <p className="text-[12.5px] text-grey-2 max-w-sm">{message}</p>
    </div>
  );
}

export interface Point {
  name: string;
  value: number;
  color?: string;
}

/**
 * The leak funnel: one bar per stage, longest at the top.
 *
 * A horizontal bar chart, not a tapering funnel graphic — a funnel's slanted sides
 * encode nothing and make two similar stages look different. The drop between bars
 * IS the leak, and a shared x-axis is the only way to read it honestly.
 */
export function FunnelChart({ data }: { data: Array<{ name: string; value: number; drop: number | null }> }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40 + 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={128} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(255,106,31,0.06)" }}
          formatter={(v: number, _n, p) => {
            const drop = (p?.payload as { drop: number | null } | undefined)?.drop;
            return [drop === null ? `${v}` : `${v} · ${drop}% of the stage before`, "Candidates"];
          }}
        />
        <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={24}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === data.length - 1 ? GREEN : ORANGE} fillOpacity={1 - i * 0.1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Generic horizontal bars — time-to-hire by department, hires per platform. */
export function HBarChart({
  data,
  unit,
  color = NAVY,
}: {
  data: Point[];
  /** Tooltip unit, e.g. "days" or "hires". */
  unit: string;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(170, data.length * 36 + 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={128} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,106,31,0.06)" }} formatter={(v: number) => [v, unit]} />
        <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color || color || PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Overdue vs on-time, per step. Red is the only thing anyone is looking for. */
export function OverdueByStepChart({ data }: { data: Array<{ name: string; overdue: number; onTime: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
        <XAxis
          dataKey="name"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: gridStroke }}
          interval={0}
          angle={data.length > 5 ? -25 : 0}
          textAnchor={data.length > 5 ? "end" : "middle"}
          height={data.length > 5 ? 62 : 30}
        />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={34} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,106,31,0.06)" }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="overdue" name="Overdue" stackId="a" fill={RED} radius={[0, 0, 0, 0]} maxBarSize={38} />
        <Bar dataKey="onTime" name="On time" stackId="a" fill={GREY} radius={[4, 4, 0, 0]} maxBarSize={38} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const OUTCOME_COLORS = { confirmed: GREEN, rejected: RED, extension: YELLOW, inProgress: GREY };

/** Probation outcomes / offer outcomes. */
export function DonutChart({ data }: { data: Point[] }) {
  const total = data.reduce((s, x) => s + x.value, 0);
  return (
    <ResponsiveContainer width="100%" height={210}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={2} stroke="none">
          {data.map((d, i) => (
            <Cell key={i} fill={d.color || PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, n: string) => [`${v} (${total ? Math.round((v / total) * 100) : 0}%)`, n]}
        />
        <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
