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
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
        <span style={{ width: `${green}%` }} className="bg-ryg-green" />
        <span style={{ width: `${yellow}%` }} className="bg-ryg-yellow" />
        <span style={{ width: `${red}%` }} className="bg-ryg-red" />
      </div>
      {showLegend && (
        <div className="mt-2.5 flex items-center gap-4 text-[11px] text-grey">
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
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label} <b className="text-navy font-semibold">{pct}%</b>
    </span>
  );
}
