import { useEffect, useState } from "react";

/**
 * The viewer's score as a machine dial — the panel's one signature element.
 *
 * A hundred ticks round a 270° arc, one per percent, lit orange up to the score.
 * Ticks the what-if would add glow at half strength, so the distance to the next
 * rank is something you can SEE close as you tick steps off. The notch outside the
 * dial is the next person's score: "N more on-time steps to move up", drawn.
 *
 * The ticks sweep on once when the dial first appears, and not at all under
 * `prefers-reduced-motion`.
 */
const TICKS = 100;
const SWEEP = 270;
const START = 135; // degrees, measured clockwise from 3 o'clock — the dial opens at the bottom
const C = 120;
const R_OUT = 104;
const R_IN = 90;
const R_IN_MAJOR = 84;

const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};
/**
 * Lit ticks warm from orange (#FF6A1F) to orange-2 (#FF8A3D) along the dial. A solid
 * colour per tick rather than an SVG gradient: a gradient on a horizontal or vertical
 * line has a zero-height box and does not paint at all.
 */
const litColor = (i: number) => {
  const k = i / (TICKS - 1);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
  return `rgb(255,${mix(0x6a, 0x8a)},${mix(0x1f, 0x3d)})`;
};
const angleOf = (pct: number) => START + (Math.max(0, Math.min(100, pct)) / 100) * SWEEP;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function ScoreDial({
  score,
  projected,
  marker,
  caption,
}: {
  /** 0–100, one decimal. */
  score: number;
  /** The what-if score, when the viewer has ticked something. */
  projected?: number | null;
  /** The next score up — drawn as a dot on the rim; the card says whose it is. */
  marker?: { score: number } | null;
  caption: string;
}) {
  const [shown, setShown] = useState(() => (reducedMotion() ? score : 0));

  useEffect(() => {
    if (reducedMotion()) {
      setShown(score);
      return;
    }
    let raf = 0;
    const from = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (score - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Sweep once per score, not on every what-if tick.
  }, [score]);

  const lit = Math.floor(shown + 1e-9);
  const ghost = projected != null && projected > score ? Math.floor(projected + 1e-9) : lit;

  const ticks = [];
  for (let i = 0; i < TICKS; i++) {
    const deg = START + ((i + 0.5) / TICKS) * SWEEP;
    const major = i % 10 === 9;
    const [x1, y1] = polar(deg, major ? R_IN_MAJOR : R_IN);
    const [x2, y2] = polar(deg, R_OUT);
    const state = i < lit ? "lit" : i < ghost ? "ghost" : "off";
    ticks.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        strokeWidth={major ? 3 : 2.2}
        strokeLinecap="round"
        stroke={state === "off" ? "rgba(255,255,255,0.13)" : litColor(i)}
        opacity={state === "ghost" ? 0.45 : 1}
        className={state === "ghost" ? "motion-safe:animate-pulse" : undefined}
      />,
    );
  }

  const markerAt = marker ? angleOf(marker.score) : null;
  const [mx, my] = markerAt != null ? polar(markerAt, R_OUT + 7) : [0, 0];

  const showProjection = projected != null && Math.abs(projected - score) >= 0.05;

  return (
    <figure className="relative w-full max-w-[236px] aspect-square mx-auto" aria-label={`Score ${score.toFixed(1)} percent. ${caption}`}>
      <svg viewBox="0 0 240 240" className="w-full h-full overflow-visible" role="img" aria-hidden="true">
        {ticks}
        {markerAt != null && (
          <circle cx={mx} cy={my} r={4.5} fill="#FFFFFF" />
        )}
      </svg>
      <figcaption className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        <div className="text-white font-bold leading-none tabular-nums text-[44px]">
          {(showProjection ? projected! : shown).toFixed(1)}
          <span className="text-[18px] font-semibold text-white/70 align-top ml-0.5">%</span>
        </div>
        {showProjection ? (
          <div className="mt-1.5 text-[12px] font-semibold text-orange-2 tabular-nums">
            from {score.toFixed(1)} · what-if
          </div>
        ) : (
          <div className="mt-1.5 text-[12px] text-white/65">{caption}</div>
        )}
      </figcaption>
    </figure>
  );
}
