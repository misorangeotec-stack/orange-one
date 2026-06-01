/** Horizontal Red/Yellow/Green weekly-performance bar (weekly_plans model). */
export default function RygBar({
  red,
  yellow,
  green,
  showLegend = true,
}: {
  red: number;
  yellow: number;
  green: number;
  showLegend?: boolean;
}) {
  return (
    <div>
      {/* thin, gently-muted track so rows of bars read as calm context, not alarm */}
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[#eef1f6]">
        <span style={{ width: `${green}%` }} className="bg-ryg-green/80" />
        <span style={{ width: `${yellow}%` }} className="bg-ryg-yellow/80" />
        <span style={{ width: `${red}%` }} className="bg-ryg-red/80" />
      </div>
      {showLegend && (
        <div className="mt-2 flex items-center gap-3.5 text-[11px] text-grey-2">
          <Legend color="bg-ryg-green" label="Green" pct={green} />
          <Legend color="bg-ryg-yellow" label="Yellow" pct={yellow} />
          <Legend color="bg-ryg-red" label="Red" pct={red} />
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {label} <b className="text-navy font-semibold">{pct}%</b>
    </span>
  );
}
