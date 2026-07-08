import type { ReactNode } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, PieChart, Pie, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import Card from "@/shared/components/ui/Card";
import type { Point } from "../lib/transforms";

const ORANGE = "#FF6A1F";
const NAVY = "#0B1B40";
const PALETTE = ["#FF6A1F", "#2563EB", "#27AE60", "#7C5CFC", "#F43F8E", "#F8B62B", "#14B8A6", "#94A3B8", "#0EA5E9", "#EF4444"];
const AXIS = { fontSize: 11, fill: "#64748B" };
const gridStroke = "#EEF2F8";

export function ChartCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`p-5 ${className ?? ""}`}>
      <div className="mb-3">
        <h2 className="text-[14px] font-bold text-navy">{title}</h2>
        {subtitle && <p className="text-[11.5px] text-grey-2 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </Card>
  );
}

const tooltipStyle = { borderRadius: 10, border: "1px solid #EEF2F8", fontSize: 12, boxShadow: "0 6px 20px rgba(11,27,64,0.08)" };

/** yyyy-mm-dd → dd-mm for compact axis ticks. */
const shortDate = (k: string) => (k.length === 10 ? `${k.slice(8, 10)}-${k.slice(5, 7)}` : k);

export function LeadsTimeChart({ data }: { data: { date: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ORANGE} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ORANGE} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={{ stroke: gridStroke }} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={34} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={shortDate} formatter={(v: number) => [v, "Leads"]} />
        <Area type="monotone" dataKey="count" stroke={ORANGE} strokeWidth={2} fill="url(#leadsFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarSeriesChart({ data, horizontal, color = ORANGE, onSelect }: { data: Point[]; horizontal?: boolean; color?: string; onSelect?: (key: string) => void }) {
  const height = horizontal ? Math.max(180, data.length * 34 + 20) : 240;
  const click = onSelect ? (e: { key?: string }) => e?.key && onSelect(e.key) : undefined;
  const cursor = onSelect ? "pointer" : undefined;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {horizontal ? (
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={120} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,106,31,0.06)" }} formatter={(v: number) => [v, "Leads"]} />
          <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={22} onClick={click} style={{ cursor }}>
            {data.map((d, i) => <Cell key={i} fill={d.color || color} />)}
          </Bar>
        </BarChart>
      ) : (
        <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
          <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: gridStroke }} interval={0} angle={data.length > 6 ? -20 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 54 : 30} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={34} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,106,31,0.06)" }} formatter={(v: number) => [v, "Leads"]} />
          <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={46} onClick={click} style={{ cursor }}>
            {data.map((d, i) => <Cell key={i} fill={d.color || PALETTE[i % PALETTE.length]} />)}
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, onSelect }: { data: Point[]; onSelect?: (key: string) => void }) {
  const total = data.reduce((s, x) => s + x.value, 0);
  const click = onSelect ? (e: { key?: string }) => e?.key && onSelect(e.key) : undefined;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none" onClick={click} style={{ cursor: onSelect ? "pointer" : undefined }}>
          {data.map((d, i) => <Cell key={i} fill={d.color || PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${v} (${total ? Math.round((v / total) * 100) : 0}%)`, n]} />
        <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HourChart({ data }: { data: { hour: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
        <XAxis dataKey="hour" tick={AXIS} tickLine={false} axisLine={{ stroke: gridStroke }} interval={1} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={34} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,106,31,0.06)" }} labelFormatter={(h) => `${h}:00`} formatter={(v: number) => [v, "Leads"]} />
        <Bar dataKey="count" fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
