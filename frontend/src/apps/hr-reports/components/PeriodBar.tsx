/**
 * Month / Quarter / Year / Custom, with ‹ › (KPI-3, read-only).
 *
 * Not the live scorecard's week: an appraisal framework carries annual targets and
 * quarterly reviews, and a week would make every count line read as missed. See
 * lib/period.ts.
 */
import { canStepForward, monthOf, periodLabel, quarterOf, step, today, yearOf, type Period, type PeriodMode } from "../lib/period";

const MODES: { key: PeriodMode; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" },
];

const arrow = "rounded border border-line px-2 py-1 text-[13px] text-grey hover:border-orange hover:text-orange disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-grey";

export default function PeriodBar({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const pick = (mode: PeriodMode) => {
    if (mode === "month") return onChange(monthOf(period.from));
    if (mode === "quarter") return onChange(quarterOf(period.from));
    if (mode === "year") return onChange(yearOf(period.from));
    onChange({ mode: "custom", from: period.from, to: period.to });
  };

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div>
        <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">Period</span>
        <div className="inline-flex overflow-hidden rounded border border-line">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => pick(m.key)}
              className={`px-2.5 py-1 text-[12px] ${
                period.mode === m.key ? "bg-navy font-semibold text-white" : "bg-white text-grey hover:text-navy"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {period.mode === "custom" ? (
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">From</span>
            <input
              type="date"
              value={period.from}
              max={period.to}
              onChange={(e) => e.target.value && onChange({ ...period, from: e.target.value })}
              className="rounded border border-line px-2 py-1 text-[12.5px] text-navy outline-none focus:border-orange"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">To</span>
            <input
              type="date"
              value={period.to}
              min={period.from}
              max={today()}
              onChange={(e) => e.target.value && onChange({ ...period, to: e.target.value })}
              className="rounded border border-line px-2 py-1 text-[12.5px] text-navy outline-none focus:border-orange"
            />
          </label>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 pb-[1px]">
          <button type="button" className={arrow} onClick={() => onChange(step(period, -1))} title="Previous">
            ‹
          </button>
          <span className="min-w-[180px] text-center text-[13px] font-semibold text-navy">{periodLabel(period)}</span>
          <button
            type="button"
            className={arrow}
            onClick={() => onChange(step(period, 1))}
            disabled={!canStepForward(period)}
            title={canStepForward(period) ? "Next" : "That period has not started yet"}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
