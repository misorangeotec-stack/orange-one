import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Bucket, FmsAdapter } from "../adapters/types";

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

/**
 * One FMS row. Calls the adapter's single `useSnapshot()` hook — exactly one
 * hook per row, never a loop in the parent, so the Rules of Hooks hold as the
 * adapter list grows.
 *
 * Clicking the row opens that FMS's own control center; the chevron expands the
 * per-step breakdown in place.
 */
export default function FmsRow({ adapter }: { adapter: FmsAdapter }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { snapshot, isLoading, error } = adapter.useSnapshot();

  const comingSoon = adapter.status === "coming-soon";
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
        {!isLoading &&
          !error &&
          snapshot &&
          ORDER.map((b) => (
            <td key={b} className={CELL}>
              <Count n={snapshot.total[b]} tone={TONES[b]} />
            </td>
          ))}
      </tr>

      {open &&
        snapshot?.steps.map((s) => (
          <tr key={s.stepKey} className="border-t border-line/60 bg-page/40">
            <td className="pl-10 pr-3 py-2 text-[13px] text-grey">{s.label}</td>
            {ORDER.map((b) => (
              <td key={b} className={`${CELL} text-[13px]`}>
                <Count n={s.counts[b]} tone={TONES[b]} />
              </td>
            ))}
          </tr>
        ))}
    </>
  );
}
