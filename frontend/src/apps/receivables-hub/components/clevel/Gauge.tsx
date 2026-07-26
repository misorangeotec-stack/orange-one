import { RYG_GREEN, RYG_RED } from "@hub/lib/chartColors";

/**
 * Semicircle needle gauge (hand-drawn SVG) for a bounded percentage — e.g. sales achievement
 * vs last year. Track + coloured value arc + a pivoting needle, with the read-out placed BELOW
 * the pivot so it never overlaps the needle. Needle and display are clamped to [0, max] (an
 * out-of-range value pins the needle and shows ">max"), so sparse prior years can't break it.
 * Colour bands: below `warn` red, below `good` amber, else green.
 */
export interface GaugeProps {
  value: number; // e.g. achievement %
  max?: number; // default 100
  label?: string;
  unit?: string; // default "%"
  thresholds?: { warn: number; good: number };
  height?: number;
}

const AMBER = "hsl(38,92%,50%)";
const NEEDLE = "hsl(220,25%,32%)";

export default function Gauge({
  value,
  max = 100,
  label,
  unit = "%",
  thresholds = { warn: 10, good: 25 },
  height = 200,
}: GaugeProps) {
  const clamped = Math.max(0, Math.min(value, max));
  const over = value > max;
  const color = value < thresholds.warn ? RYG_RED : value < thresholds.good ? AMBER : RYG_GREEN;
  const display = over ? `>${max}${unit}` : `${value.toFixed(1)}${unit}`;

  // Geometry: a 180° arc with the pivot at the flat base centre; read-out sits below the pivot.
  const cx = 130;
  const cy = 128;
  const r = 106;
  const stroke = 19;
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt = (radius: number, deg: number) => ({
    x: cx + radius * Math.cos(rad(deg)),
    y: cy - radius * Math.sin(rad(deg)),
  });
  const angleFor = (v: number) => 180 - (Math.max(0, Math.min(v, max)) / max) * 180;

  const A = pt(r, 180); // value = 0 (left)
  const B = pt(r, 0); // value = max (right)
  const V = pt(r, angleFor(clamped));
  const track = `M ${A.x} ${A.y} A ${r} ${r} 0 0 1 ${B.x} ${B.y}`;
  const valueArc = `M ${A.x} ${A.y} A ${r} ${r} 0 0 1 ${V.x} ${V.y}`;
  const tip = pt(r - stroke - 6, angleFor(clamped));

  return (
    <div className="w-full flex items-center justify-center" style={{ height }}>
      <svg viewBox={`0 0 ${cx * 2} ${cy + 62}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <path d={track} fill="none" stroke="hsl(220,16%,90%)" strokeWidth={stroke} strokeLinecap="round" />
        <path d={valueArc} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        {/* needle + hub */}
        <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={NEEDLE} strokeWidth={4} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={7} fill={NEEDLE} />
        <circle cx={cx} cy={cy} r={3} fill="white" />
        {/* end ticks */}
        <text x={A.x} y={cy + 16} textAnchor="middle" fontSize="11" fill="hsl(220,10%,60%)">0</text>
        <text x={B.x} y={cy + 16} textAnchor="middle" fontSize="11" fill="hsl(220,10%,60%)">
          {max}
          {unit}
        </text>
        {/* read-out — below the pivot, clear of the needle */}
        <text x={cx} y={cy + 40} textAnchor="middle" fontWeight="700" fontSize="22" fill="hsl(220,45%,20%)">
          {display}
        </text>
        {label && (
          <text x={cx} y={cy + 56} textAnchor="middle" fontSize="11" fill="hsl(220,10%,58%)">
            {label}
          </text>
        )}
      </svg>
    </div>
  );
}
