/**
 * The coverage meter (KPI-3, read-only) — the finding the lab exists to show.
 *
 * Saloni's sheet is titled "Orange Hub Mapping Ready". Most of it maps to something
 * that exists but is not in use, or not yet shipped. That in a document is an
 * opinion; the same thing as a bar on
 * the screen, recomputed from the framework every time it renders, is a fact the room
 * can look at together. It is the first thing on the page for that reason.
 *
 * ── Every band is a control ───────────────────────────────────────────────────
 * "a quarter has no table behind it" invites exactly one question — WHICH quarter? So each
 * segment and each legend entry filters the grid to its own lines. Clicking the same
 * band again clears it, and the selected band is the only one that stays lit, so there
 * is never a doubt about what the table below is showing.
 *
 * ⚠ Filtering the GRID must not move the SCORE. The headline is the whole sheet's, and
 *   a score that changed as you clicked around the legend would be reporting on a
 *   selection nobody asked it to report on. Scorecard.tsx filters only the rows it
 *   hands the table.
 */
import { cn } from "@/shared/lib/cn";
import type { Coverage as Band } from "../framework/types";
import type { Totals } from "../lib/achievement";

const BANDS: { key: Band; label: string; bar: string; dot: string; ring: string; what: string }[] = [
  {
    key: "system",
    label: "Measured by the hub",
    bar: "bg-[#1f8a4d]",
    dot: "bg-[#1f8a4d]",
    ring: "border-[#1f8a4d] bg-[#1f8a4d]/[0.07]",
    what: "Scored end to end from live data.",
  },
  {
    key: "partial",
    label: "Measured, with a caveat",
    bar: "bg-[#7cb342]",
    dot: "bg-[#7cb342]",
    ring: "border-[#7cb342] bg-[#7cb342]/[0.09]",
    what: "Scored from live data, but the line asks for something the data does not fully cover.",
  },
  {
    key: "target-missing",
    label: "Live figure, no agreed target",
    bar: "bg-orange",
    dot: "bg-orange",
    ring: "border-orange bg-orange/[0.07]",
    // ⚠ The weight and the target are different things, and a reader WILL conflate them:
    //   "no agreed target" next to a column reading 10% looks like a contradiction. The
    //   sheet states what each line is WORTH; it does not state the bar to clear. Say so
    //   here, because this is where the two sit side by side.
    what: "The weight is the sheet's — the line is worth that much. What the sheet never states is the bar to clear, so the live figure cannot become a score until someone sets one. Type it on the row.",
  },
  {
    key: "unused",
    label: "Built · nobody has used it",
    bar: "bg-[#e08a2e]",
    dot: "bg-[#e08a2e]",
    ring: "border-[#e08a2e] bg-[#e08a2e]/[0.08]",
    what: "The table and the screen are live and hold no row. These score zero because nobody has used them, not because they cannot be measured.",
  },
  {
    key: "not-released",
    label: "Built · not live yet",
    bar: "bg-[#2f6fb3]",
    dot: "bg-[#2f6fb3]",
    ring: "border-[#2f6fb3] bg-[#2f6fb3]/[0.08]",
    what: "The module exists and has not reached the hub yet. Waiting on a go-live, not on a quote.",
  },
  {
    key: "judgement",
    label: "Human judgement",
    bar: "bg-[#8e7cc3]",
    dot: "bg-[#8e7cc3]",
    ring: "border-[#8e7cc3] bg-[#8e7cc3]/[0.09]",
    what: "There will never be system evidence. A person enters it, by design.",
  },
  {
    key: "no-data",
    label: "Nothing in the hub",
    bar: "bg-[#c0392b]",
    dot: "bg-[#c0392b]",
    ring: "border-[#c0392b] bg-[#c0392b]/[0.06]",
    what: "Neither actual nor target exists, on any branch. The only band that is still a build.",
  },
];

const pct = (x: number) => `${x % 1 === 0 ? x : x.toFixed(1)}%`;
export const bandLabel = (b: Band): string => BANDS.find((x) => x.key === b)?.label ?? b;

export default function Coverage({
  totals,
  selected,
  onSelect,
}: {
  totals: Totals;
  selected: Band | null;
  onSelect: (b: Band | null) => void;
}) {
  const bands = BANDS.map((b) => ({
    ...b,
    weight: totals.coverage[b.key],
    lines: totals.linesByCoverage[b.key],
  })).filter((b) => b.weight > 0);
  const measured = totals.coverage.system + totals.coverage.partial;
  const toggle = (b: Band) => onSelect(selected === b ? null : b);
  const countOf = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

  return (
    <div className="rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[13px] font-semibold text-navy">How much of this sheet the hub can answer</h2>
        <p className="text-[11.5px] text-grey-2">
          By weight, out of the framework&apos;s fixed 100%. <span className="text-grey">Click a band to see its lines.</span>
        </p>
      </div>

      <div className="mt-3 flex h-3.5 w-full overflow-hidden rounded-full bg-line">
        {bands.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-pressed={selected === b.key}
            onClick={() => toggle(b.key)}
            style={{ width: `${b.weight}%` }}
            title={`${b.label} — ${pct(b.weight)}, ${countOf(b.lines)}. Click to ${selected === b.key ? "clear" : "show them"}.`}
            className={cn(
              b.bar,
              "h-full cursor-pointer transition-opacity",
              // The chosen band stays solid; the rest step back rather than vanish, so the
              // whole 100% is still readable while one part of it is being looked at.
              selected && selected !== b.key ? "opacity-25 hover:opacity-50" : "hover:opacity-80",
            )}
          />
        ))}
      </div>

      <div className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {bands.map((b) => {
          const on = selected === b.key;
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(b.key)}
              className={cn(
                "flex w-full gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                on ? b.ring : "border-transparent hover:border-line hover:bg-page",
              )}
            >
              <span className={cn("mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full", b.dot)} />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-navy">
                  {pct(b.weight)} · {b.label}
                  <span className="ml-1.5 font-normal text-grey-2">{countOf(b.lines)}</span>
                </span>
                <span className="block text-[11.5px] leading-snug text-grey">{b.what}</span>
                {on && (
                  <span className="mt-1 block text-[11px] font-medium text-orange">
                    Showing these {b.lines} below · click again to show all{" "}
                    {Object.values(totals.linesByCoverage).reduce((a, n) => a + n, 0)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-grey">
        <span className="font-semibold text-navy">{pct(measured)} of the score is machine-measurable today.</span> A further{" "}
        {pct(totals.coverage["target-missing"])} waits on a target nobody has stated and {pct(totals.coverage.unused)} on screens
        that are live and nobody has used — Learning &amp; Development is most of that.
        {totals.coverage["not-released"] > 0 && ` A further ${pct(totals.coverage["not-released"])} is built and not released.`}{" "}
        Only {pct(totals.coverage["no-data"])} has no table behind it at all.
      </p>
    </div>
  );
}
