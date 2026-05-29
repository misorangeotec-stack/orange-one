/** Small SVG donut for status breakdowns (matches the landing donut style). */
export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export default function DonutChart({ segments, size = 104 }: { segments: DonutSegment[]; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 15.9155; // circumference ≈ 100
  let offset = 25; // start at top
  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 42 42">
          <circle cx="21" cy="21" r={R} fill="none" stroke="#EEF2F8" strokeWidth="5.5" />
          {segments.map((s, i) => {
            const len = (s.value / total) * 100;
            const dash = `${len} ${100 - len}`;
            const el = (
              <circle
                key={i}
                cx="21"
                cy="21"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="5.5"
                strokeDasharray={dash}
                strokeDashoffset={offset}
                strokeLinecap="butt"
              />
            );
            offset -= len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <b className="text-[22px] font-bold text-navy leading-none">{total}</b>
          <span className="text-[9px] text-grey">Total</span>
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center text-[12px] text-grey">
            <span className="w-2.5 h-2.5 rounded-full mr-2 shrink-0" style={{ background: s.color }} />
            <span className="truncate">{s.label}</span>
            <b className="ml-auto text-navy font-semibold">{s.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
