export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Dependency-free SVG donut: each slice is an arc drawn with stroke-dasharray on a
 * circle. Renders the ring with a center total, alongside a labelled legend.
 */
export default function DonutChart({
  items,
  centerLabel = "Total",
  size = 132,
  thickness = 16,
}: {
  items: DonutSlice[];
  centerLabel?: string;
  size?: number;
  thickness?: number;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  let offset = 0;
  const arcs = total
    ? items.filter((i) => i.value > 0).map((i) => {
        const len = (i.value / total) * c;
        const arc = { key: i.key, color: i.color, dash: `${len} ${c - len}`, off: -offset };
        offset += len;
        return arc;
      })
    : [];

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#eef1f6" strokeWidth={thickness} />
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={thickness}
            strokeDasharray={a.dash}
            strokeDashoffset={a.off}
            transform={`rotate(-90 ${cx} ${cx})`}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cx - 4} textAnchor="middle" className="fill-navy" style={{ fontSize: 22, fontWeight: 700 }}>{total}</text>
        <text x={cx} y={cx + 14} textAnchor="middle" className="fill-grey-2" style={{ fontSize: 10.5 }}>{centerLabel}</text>
      </svg>

      <ul className="space-y-2 text-[12.5px]">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: i.color }} />
            <span className="text-grey">{i.label}</span>
            <span className="ml-auto pl-3 tabular-nums font-semibold text-navy">{i.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
