/**
 * The two scores, side by side (KPI-3, read-only).
 *
 * They are shown together and never apart. With most of the sheet unmeasurable, "score
 * out of 100" has two honest readings that sit thirty points apart, and either one
 * alone misleads: the literal reading condemns the person for the hub's gaps, and the
 * rescaled one quietly hides them. Putting both up, with the measured weight printed
 * between them, is the only presentation that tells the truth.
 */
import { fmt, type KraTotals, type Totals } from "../lib/achievement";

const pct = (x: number) => `${x % 1 === 0 ? x : x.toFixed(1)}%`;

function Big({ value, label, hint, strong }: { value: string; label: string; hint: string; strong?: boolean }) {
  return (
    <div className="min-w-[150px] flex-1">
      <div className={`tabular-nums leading-none ${strong ? "text-[38px] font-bold text-navy" : "text-[30px] font-semibold text-grey"}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[12px] font-semibold text-navy">{label}</div>
      <div className="text-[11.5px] leading-snug text-grey-2">{hint}</div>
    </div>
  );
}

export default function ScoreHead({
  totals,
  kras,
  typed,
}: {
  totals: Totals;
  kras: KraTotals[];
  typed: number;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <Big
          value={fmt(totals.onWhatWeHave)}
          label="Score on what we can measure"
          hint={`Out of the ${pct(totals.scoredWeight)} of the sheet that produced a figure. The fair read of the person.`}
          strong
        />
        <Big
          value={fmt(totals.onSheet)}
          label="Score on the sheet as written"
          hint={`Every unmeasured line counts zero, so ${pct(totals.unscoredWeight)} scores nothing. The literal read of a fixed 100% framework.`}
        />
        <div className="min-w-[150px] flex-1">
          <div className="text-[30px] font-semibold leading-none tabular-nums text-grey">{pct(totals.scoredWeight)}</div>
          <div className="mt-1.5 text-[12px] font-semibold text-navy">Weight that scored</div>
          <div className="text-[11.5px] leading-snug text-grey-2">
            {typed > 0 ? `${typed} line${typed === 1 ? "" : "s"} of it typed in the lab, not read from data.` : "All of it read from live data."}
          </div>
        </div>
      </div>

      {/* Per-KRA, in the sheet's own order — the weights the client argued over. */}
      <div className="mt-4 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3">
        {kras.map((k) => (
          <div key={k.code} className="flex items-baseline justify-between gap-3 rounded border border-line bg-page px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-navy" title={k.title}>
                KRA {k.code} · {k.title}
              </div>
              <div className="text-[11px] text-grey-2">
                {pct(k.weight)} of the sheet · {k.scoredWeight > 0 ? `${pct(k.scoredWeight)} measured` : "nothing measured"}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[15px] font-bold tabular-nums text-navy">{fmt(k.onWhatWeHave)}</div>
              <div className="text-[10px] uppercase tracking-wide text-grey-2">of 100</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
