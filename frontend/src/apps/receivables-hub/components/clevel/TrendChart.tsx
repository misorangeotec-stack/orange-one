import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { fmtINRMoney } from "@hub/lib/utils";

/** Compact ₹ axis tick (₹ in Cr/L, short). */
function tick(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(0)}L`;
  if (a === 0) return "0";
  return `${(n / 1e3).toFixed(0)}k`;
}

export interface TrendSeries {
  key: string;
  name: string;
  color: string;
  type?: "line" | "bar" | "area";
}

export interface TrendChartProps {
  data: Array<Record<string, number | string | null>>;
  series: TrendSeries[];
  height?: number;
  xKey?: string;
}

export default function TrendChart({ data, series, height = 210, xKey = "month" }: TrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,91%)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} stroke="hsl(220,10%,55%)" tickLine={false} />
        <YAxis tick={{ fontSize: 10 }} stroke="hsl(220,10%,55%)" tickFormatter={tick} width={44} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(v: number, name: string) => [fmtINRMoney(v), name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(220,15%,88%)" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        {series.map((s) =>
          s.type === "bar" ? (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={22} />
          ) : s.type === "area" ? (
            <Area key={s.key} dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={2} />
          ) : (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
