/**
 * How many of the form's boxes the hub can fill (KPI-3, read-only).
 *
 * The framework lab's meter measures WEIGHT, because a scorecard's lines are weighted.
 * A form's boxes are not: nobody said the offer date matters more than the CTC. So this
 * one counts FIELDS, and the bar is a field count — which also means the bar and the
 * legend can be read as "23 of 71 boxes", a sentence anyone in the room can check by
 * hand against the document.
 *
 * ── The band that matters most is the middle one ──────────────────────────────
 * "Half of this needs building" is the wrong answer, and it is the answer a single
 * no-data band would have given. A third of what the hub cannot fill today sits in
 * tables that already exist and have never had a row written to them: the onboarding
 * checklist, the probation reviews, the closed status, the joining tick. Those cost
 * nothing to fix and a build quote that includes them is wrong in the expensive
 * direction. `empty-table` exists to keep them separate and visible.
 *
 * ⚠ Every band is a control — clicking one narrows the FIELD MAP grid to its boxes,
 *   because "half of it" invites exactly one question: which half? Clicking the same
 *   band again clears it.
 */
import { cn } from "@/shared/lib/cn";
import type { FieldCoverage } from "../report/types";

interface BandSpec {
  key: FieldCoverage;
  label: string;
  bar: string;
  dot: string;
  ring: string;
  what: string;
}

const BANDS: BandSpec[] = [
  {
    key: "live",
    label: "The hub fills this",
    bar: "bg-[#1f8a4d]",
    dot: "bg-[#1f8a4d]",
    ring: "border-[#1f8a4d] bg-[#1f8a4d]/[0.07]",
    what: "Read from live data, end to end, from a table with rows in it.",
  },
  {
    key: "live-partial",
    label: "Filled, with a caveat",
    bar: "bg-[#7cb342]",
    dot: "bg-[#7cb342]",
    ring: "border-[#7cb342] bg-[#7cb342]/[0.09]",
    what: "The figure is there, but the column means something slightly narrower than the form's words. The caveat is printed on the box.",
  },
  {
    key: "empty-table",
    label: "Built · nobody has used it",
    bar: "bg-orange",
    dot: "bg-orange",
    ring: "border-orange bg-orange/[0.07]",
    // The distinction this band exists for, said where a reader meets it.
    what: "Live on the hub, with no real row yet. Nothing to build — these fill themselves the first week somebody uses the screen.",
  },
  {
    key: "not-released",
    label: "Built · not live yet",
    bar: "bg-[#2f6fb3]",
    dot: "bg-[#2f6fb3]",
    ring: "border-[#2f6fb3] bg-[#2f6fb3]/[0.08]",
    what: "The module exists — tables, screens and all — and has not been released to the hub yet. Waiting on a go-live, not a quote.",
  },
  {
    key: "narrative",
    label: "Prose, by design",
    bar: "bg-[#8e7cc3]",
    dot: "bg-[#8e7cc3]",
    ring: "border-[#8e7cc3] bg-[#8e7cc3]/[0.09]",
    what: "A summary, a plan or a signature. There is nothing to measure and nothing to build.",
  },
  {
    key: "no-table",
    label: "Nothing in the hub",
    bar: "bg-[#c0392b]",
    dot: "bg-[#c0392b]",
    ring: "border-[#c0392b] bg-[#c0392b]/[0.06]",
    what: "Nothing records this, on any branch. These are the only boxes that still need something written.",
  },
];

export const bandLabel = (b: FieldCoverage): string => BANDS.find((x) => x.key === b)?.label ?? b;
export const bandBar = (b: FieldCoverage): string => BANDS.find((x) => x.key === b)?.bar ?? "bg-line";

/** The badge each band wears on a grid row and beside a box on the report. */
export const BAND_BADGE: Record<FieldCoverage, { label: string; cls: string }> = {
  live: { label: "Live", cls: "bg-[#1f8a4d]/10 text-[#1f8a4d] border-[#1f8a4d]/25" },
  "live-partial": { label: "Live · caveat", cls: "bg-[#7cb342]/10 text-[#4e7a1f] border-[#7cb342]/30" },
  "empty-table": { label: "Built · unused", cls: "bg-orange/10 text-orange border-orange/30" },
  "not-released": { label: "Built · not live", cls: "bg-[#2f6fb3]/10 text-[#2f6fb3] border-[#2f6fb3]/30" },
  narrative: { label: "By hand", cls: "bg-[#8e7cc3]/10 text-[#6a55a8] border-[#8e7cc3]/30" },
  "no-table": { label: "Nothing records this", cls: "bg-[#c0392b]/8 text-[#c0392b] border-[#c0392b]/25" },
};

export default function FieldMeter({
  counts,
  total,
  selected,
  onSelect,
  typed,
  // The two pages do different things with a chosen band — the field map NARROWS its
  // grid, the report HIGHLIGHTS the boxes in place — and the line under the legend has
  // to say which, or the reader looks for rows that were never going to disappear.
  selectionNote = (n, all) => `Showing these ${n} on the field map · click again to show all ${all}`,
}: {
  counts: Record<FieldCoverage, number>;
  total: number;
  selected: FieldCoverage | null;
  onSelect: (b: FieldCoverage | null) => void;
  typed: number;
  selectionNote?: (n: number, total: number) => string;
}) {
  const bands = BANDS.map((b) => ({ ...b, n: counts[b.key] })).filter((b) => b.n > 0);
  const filled = counts.live + counts["live-partial"];
  const toggle = (b: FieldCoverage) => onSelect(selected === b ? null : b);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <div className="rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[13px] font-semibold text-navy">How much of this form the hub can fill in</h2>
        <p className="text-[11.5px] text-grey-2">
          By box, out of {total}. <span className="text-grey">Click a band to see which boxes.</span>
        </p>
      </div>

      <div className="mt-3 flex h-3.5 w-full overflow-hidden rounded-full bg-line">
        {bands.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-pressed={selected === b.key}
            onClick={() => toggle(b.key)}
            style={{ width: `${(b.n / total) * 100}%` }}
            title={`${b.label} — ${b.n} of ${total} boxes. Click to ${selected === b.key ? "clear" : "show them"}.`}
            className={cn(
              b.bar,
              "h-full cursor-pointer transition-opacity",
              // The chosen band stays solid and the rest step back rather than vanish, so
              // the whole form is still readable while one part of it is looked at.
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
                  {b.n} {b.n === 1 ? "box" : "boxes"} · {b.label}
                  <span className="ml-1.5 font-normal text-grey-2">{pct(b.n)}%</span>
                </span>
                <span className="block text-[11.5px] leading-snug text-grey">{b.what}</span>
                {on && <span className="mt-1 block text-[11px] font-medium text-orange">{selectionNote(b.n, total)}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-grey">
        <span className="font-semibold text-navy">
          {filled} of the {total} boxes fill themselves today
        </span>{" "}
        — nearly all of them in Section A, which New Recruitment already covers. A further{" "}
        <span className="font-semibold text-orange">{counts["empty-table"]}</span> wait on somebody using a screen that is already
        live{counts["not-released"] > 0 && (
          <>
            , <span className="font-semibold text-[#2f6fb3]">{counts["not-released"]}</span> on a module that is built but not
            released
          </>
        )}, and only <span className="font-semibold text-[#c0392b]">{counts["no-table"]}</span> on something nobody has written
        yet.
        {typed > 0 && <span className="text-grey-2"> {typed} box{typed === 1 ? "" : "es"} filled by hand in this browser.</span>}
      </p>
    </div>
  );
}
