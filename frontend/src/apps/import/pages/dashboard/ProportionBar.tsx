/**
 * One row of a distribution "chart": a coloured status pill, a proportional bar
 * (width = count / max, with a visible floor), and the count. Div-based — this
 * app has no chart library (Recharts is receivables-only).
 */
export default function ProportionBar({
  label,
  count,
  max,
  badgeCls,
}: {
  label: string;
  count: number;
  max: number;
  badgeCls: string;
}) {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-[128px] shrink-0">
        <span className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${badgeCls}`}>
          {label}
        </span>
      </div>
      <div className="flex-1 h-2.5 rounded-full bg-page overflow-hidden">
        <span className="block h-full rounded-full bg-navy/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-[13px] font-bold tabular-nums text-navy">{count}</span>
    </div>
  );
}
