import { useEffect, useState } from "react";
import PillToggle from "@/shared/components/ui/PillToggle";
import {
  canStepForward,
  isRunning,
  monthOf,
  periodLabel,
  periodWord,
  step,
  today,
  weekOf,
  type Period,
  type PeriodMode,
} from "../lib/period";

const LABEL = "mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2";

/**
 * Week / Month / Custom, and the way through them — moved here from the Scorecard so the Team
 * summary (KPI-2) steps through periods by the same rules: never into a period that has not
 * started (the forward arrow stops at the current one), and a custom range ends by today.
 */
export default function PeriodControls({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const w = periodWord(period.mode).toLowerCase();

  // Custom range: edited as a draft, applied only when both ends make sense.
  const [draft, setDraft] = useState({ from: period.from, to: period.to });
  useEffect(() => setDraft({ from: period.from, to: period.to }), [period.from, period.to]);

  return (
    <>
      <div>
        <label className={LABEL}>Period</label>
        <PillToggle<PeriodMode>
          value={period.mode}
          onChange={(m) =>
            onChange(m === "week" ? weekOf(period.from) : m === "month" ? monthOf(period.from) : { mode: "custom", from: period.from, to: period.to })
          }
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
            { value: "custom", label: "Custom" },
          ]}
        />
      </div>

      <div className="min-w-0">
        {period.mode === "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={draft.from}
              max={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              aria-label="From"
              className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink outline-none focus:border-orange"
            />
            <span className="text-grey-2">to</span>
            <input
              type="date"
              value={draft.to}
              min={draft.from}
              max={today()}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              aria-label="To"
              className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink outline-none focus:border-orange"
            />
            <button
              type="button"
              disabled={
                !draft.from ||
                !draft.to ||
                draft.from > draft.to ||
                draft.to > today() ||
                (draft.from === period.from && draft.to === period.to)
              }
              onClick={() => onChange({ mode: "custom", from: draft.from, to: draft.to })}
              className="h-9 rounded-lg bg-navy px-3 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
            >
              Show
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChange(step(period, -1))}
              aria-label={`Previous ${w}`}
              className="grid h-9 w-9 place-items-center rounded-lg border border-line text-grey transition hover:border-orange/40 hover:text-orange"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="min-w-[170px] px-1 text-center text-[13px] font-semibold text-navy tabular-nums">{periodLabel(period)}</span>
            {/* Stops at the current week / month: a period that has not started has no figures. */}
            <button
              type="button"
              onClick={() => onChange(step(period, 1))}
              disabled={!canStepForward(period)}
              aria-label={`Next ${w}`}
              title={canStepForward(period) ? `Next ${w}` : `This is the current ${w}`}
              className="grid h-9 w-9 place-items-center rounded-lg border border-line text-grey transition enabled:hover:border-orange/40 enabled:hover:text-orange disabled:cursor-not-allowed disabled:opacity-35"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
            {!isRunning(period) && (
              <button
                type="button"
                onClick={() => onChange(period.mode === "month" ? monthOf(today()) : weekOf(today()))}
                className="ml-1 h-9 whitespace-nowrap rounded-lg border border-line px-2.5 text-[12.5px] font-semibold text-orange transition hover:border-orange/40"
              >
                This {w}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** The Excel button both pages carry. */
export function ExcelButton({ onClick, disabled, busy, title }: { onClick: () => void; disabled?: boolean; busy?: boolean; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-grey-2 transition hover:border-orange/50 hover:text-orange disabled:opacity-40 sm:ml-auto"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {busy ? "Preparing…" : "Excel"}
    </button>
  );
}
