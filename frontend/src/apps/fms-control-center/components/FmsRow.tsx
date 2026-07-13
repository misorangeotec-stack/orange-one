import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Bucket, FmsAdapter, StageBreak, StepBreak } from "../adapters/types";

const CELL = "px-3 py-2.5 text-center tabular-nums whitespace-nowrap";

/** A count cell. Zero is muted so the eye lands on real work; delayed is red. */
function Count({ n, tone }: { n: number; tone?: "red" | "muted" }) {
  if (n === 0) return <span className="text-grey-2/50">0</span>;
  if (tone === "red") return <span className="font-bold text-ryg-red">{n}</span>;
  if (tone === "muted") return <span className="text-grey-2">{n}</span>;
  return <span className="font-semibold text-navy">{n}</span>;
}

const TONES: Partial<Record<Bucket, "red" | "muted">> = { delayed: "red", noDate: "muted" };
const ORDER: Bucket[] = ["today", "delayed", "tomorrow", "dayAfter", "noDate"];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** The five count cells of a breakdown row, at whatever depth. */
function Cells({ counts, className = "" }: { counts: Record<Bucket, number>; className?: string }) {
  return (
    <>
      {ORDER.map((b) => (
        <td key={b} className={`${CELL} ${className}`}>
          <Count n={counts[b]} tone={TONES[b]} />
        </td>
      ))}
    </>
  );
}

/**
 * One stage of a grouped FMS — a summary line that itself opens to its steps.
 *
 * Its own component, not a loop in the parent, because each stage owns an independent
 * open/closed state and hooks cannot be called in a loop whose length can change.
 */
function StageRows({ stage }: { stage: StageBreak }) {
  const [open, setOpen] = useState(false);
  const empty = stage.steps.length === 0;
  return (
    <>
      <tr className="border-t border-line/60 bg-page/40">
        <td className="pl-8 pr-3 py-2 text-[13px]">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={empty}
            aria-expanded={open}
            className="flex items-center gap-1.5 font-semibold text-navy hover:text-orange disabled:cursor-default disabled:opacity-60"
          >
            <Chevron open={open} />
            {stage.label}
            {!empty && (
              <span className="text-[11px] font-normal text-grey-2">
                {stage.steps.length} {stage.steps.length === 1 ? "step" : "steps"}
              </span>
            )}
          </button>
        </td>
        <Cells counts={stage.counts} className="text-[13px]" />
      </tr>

      {open &&
        stage.steps.map((s: StepBreak) => (
          <tr key={s.stepKey} className="border-t border-line/40 bg-page/20">
            <td className="pl-[62px] pr-3 py-1.5 text-[12.5px] text-grey">{s.label}</td>
            <Cells counts={s.counts} className="text-[12.5px]" />
          </tr>
        ))}
    </>
  );
}

/**
 * One FMS row. Calls the adapter's single `useSnapshot()` hook — exactly one
 * hook per row, never a loop in the parent, so the Rules of Hooks hold as the
 * adapter list grows.
 *
 * Clicking the row opens that FMS's own control center; the chevron expands the
 * breakdown in place.
 *
 * An FMS that declares **stages** expands to those (four readable lines for HR), each of
 * which opens again to its own steps. One that doesn't expands straight to its steps, as
 * Purchase always has — its nine are one journey, and a stage layer over them would be a
 * fold with nothing behind it.
 */
export default function FmsRow({ adapter }: { adapter: FmsAdapter }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { snapshot, isLoading, error } = adapter.useSnapshot();

  const comingSoon = adapter.status === "coming-soon";
  const stages = snapshot?.stages;
  const stepCount = snapshot?.steps.length ?? 0;

  if (comingSoon) {
    return (
      <tr className="border-t border-dashed border-line">
        <td className="px-3 py-2.5 text-grey-2">
          {adapter.name} <span className="ml-2 text-[11px] uppercase tracking-wide text-grey-2/70">Coming soon</span>
        </td>
        <td className={CELL} colSpan={5}>
          <span className="text-grey-2/50">—</span>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr
        onClick={() => navigate(adapter.controlCenterPath)}
        className="border-t border-line cursor-pointer hover:bg-page/60 transition-colors"
        title={`Open the ${adapter.name} control center`}
      >
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((v) => !v);
              }}
              disabled={!snapshot || stepCount === 0}
              aria-expanded={open}
              aria-label={open ? `Collapse ${adapter.name} steps` : `Expand ${adapter.name} steps`}
              className="text-grey-2 hover:text-navy disabled:opacity-30 disabled:cursor-default p-0.5"
            >
              <Chevron open={open} />
            </button>
            <span className="font-semibold text-navy">{adapter.name}</span>
          </span>
        </td>

        {isLoading && (
          <td className={CELL} colSpan={5}>
            <span className="text-grey-2">Loading…</span>
          </td>
        )}
        {!isLoading && !!error && (
          <td className={CELL} colSpan={5}>
            <span className="text-ryg-red">Couldn't load</span>
          </td>
        )}
        {!isLoading && !error && snapshot && <Cells counts={snapshot.total} />}
      </tr>

      {open && stages && stages.map((st) => <StageRows key={st.label} stage={st} />)}

      {open &&
        !stages &&
        snapshot?.steps.map((s) => (
          <tr key={s.stepKey} className="border-t border-line/60 bg-page/40">
            <td className="pl-10 pr-3 py-2 text-[13px] text-grey">{s.label}</td>
            <Cells counts={s.counts} className="text-[13px]" />
          </tr>
        ))}
    </>
  );
}
