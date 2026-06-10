import type { ThroughputRow } from "../../lib/analytics";

const RAISED = "#9fb6dd";
const COMPLETED = "#27AE60";

/**
 * Dependency-free vertical grouped bar chart for the monthly throughput series —
 * two bars per month (orders raised vs completed), scaled to the series max.
 */
export default function TrendBars({ rows }: { rows: ThroughputRow[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.raised, r.completed]));
  const hasData = rows.some((r) => r.raised || r.completed);

  if (!hasData) return <p className="text-[12.5px] text-grey-2 py-2">No data yet.</p>;

  const bar = (value: number, color: string, kind: string, label: string) => (
    <div
      className="w-3 rounded-t-sm transition-all"
      style={{ height: `${value ? Math.max((value / max) * 100, 4) : 0}%`, background: color }}
      title={`${label} · ${kind}: ${value}`}
    />
  );

  return (
    <div>
      <div className="flex items-end gap-2">
        {rows.map((r) => (
          <div key={r.key} className="flex-1 flex flex-col items-center gap-1.5">
            <div className="flex items-end justify-center gap-1 h-32 w-full">
              {bar(r.raised, RAISED, "Raised", r.label)}
              {bar(r.completed, COMPLETED, "Completed", r.label)}
            </div>
            <span className="text-[11px] text-grey-2">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11.5px] text-grey">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: RAISED }} /> Raised</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COMPLETED }} /> Completed</span>
      </div>
    </div>
  );
}
