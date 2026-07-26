import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import { fmtINRMoney } from "@hub/lib/utils";
import type { ExposureRow } from "@hub/lib/topExposure";
import {
  concentrationSeries, agingSeries, saleTypeSeries, salespersonSeries,
} from "@hub/lib/exposureAnalytics";

interface Props {
  rows: ExposureRow[];
  saleTypes: string[];
  fyLabel: string;
  rankBy: "outstanding" | "overdue";
}

/** Short ₹ axis tick (Cr / L). */
const fmtAxis = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${Math.round(n)}`;
};

/** Trim a long ledger name so the axis stays readable. */
const shortName = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);

const AXIS = "hsl(220,10%,50%)";
const GRID = "hsl(220,15%,90%)";
const PRIMARY = "hsl(28,80%,52%)";
const NAVY = "hsl(220,45%,25%)";
const RED = "hsl(0,84%,60%)";

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-card border-border bg-surface">
      <CardHeader className="pb-1">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function TopExposureAnalysis({ rows, saleTypes }: Props) {
  if (rows.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        No customers in the current selection to analyse.
      </div>
    );
  }

  const conc = concentrationSeries(rows, 10);
  const aging = agingSeries(rows);
  const byType = saleTypeSeries(rows, saleTypes);
  const bySp = salespersonSeries(rows, 10);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard
        title="Exposure concentration"
        subtitle={`Top 5 = ${conc.top5Pct.toFixed(0)}% · Top 10 = ${conc.top10Pct.toFixed(0)}% of the shown exposure`}
      >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={conc.rows} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke={AXIS} tickFormatter={fmtAxis} />
            <YAxis
              type="category" dataKey="name" tick={{ fontSize: 11 }} stroke={AXIS}
              width={150} tickFormatter={shortName}
            />
            <Tooltip formatter={(v: number) => fmtINRMoney(v)} />
            <Bar dataKey="outstanding" name="Outstanding" fill={PRIMARY} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Overdue aging mix" subtitle="Outstanding by days past due">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={aging} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke={AXIS} />
            <YAxis tick={{ fontSize: 11 }} stroke={AXIS} tickFormatter={fmtAxis} width={64} />
            <Tooltip formatter={(v: number) => fmtINRMoney(v)} />
            <Bar dataKey="amount" name="Amount" radius={[3, 3, 0, 0]}>
              {aging.map((a) => <Cell key={a.bucket} fill={a.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Exposure by sale type" subtitle="Outstanding split across the products">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={byType} cx="50%" cy="50%" innerRadius={60} outerRadius={95}
              paddingAngle={3} dataKey="amount" nameKey="type"
              label={({ type, percent }) => `${type} ${((percent ?? 0) * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {byType.map((p) => <Cell key={p.type} fill={p.color} />)}
            </Pie>
            <Tooltip formatter={(v: number) => fmtINRMoney(v)} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Exposure by salesperson" subtitle="Who carries the outstanding & overdue">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={bySp} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke={AXIS} tickFormatter={fmtAxis} />
            <YAxis type="category" dataKey="salesPerson" tick={{ fontSize: 11 }} stroke={AXIS} width={110} tickFormatter={shortName} />
            <Tooltip formatter={(v: number) => fmtINRMoney(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="outstanding" name="Outstanding" fill={NAVY} radius={[0, 3, 3, 0]} />
            <Bar dataKey="overdue" name="Overdue" fill={RED} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
