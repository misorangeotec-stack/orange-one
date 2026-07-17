/**
 * The two views of a workflow stage: the work still owed, and the work already
 * done here.
 *
 * Every FMS stage screen used to be a pending-only queue, so the moment an owner
 * completed their action the row vanished and they could never see — let alone
 * correct — what they had done. This strip is that missing half.
 *
 * Purely presentational: it owns no data and no rules, so the four other FMS apps
 * can adopt it without inheriting Purchase's step graph. Each app supplies its
 * own counts and its own notion of what "completed" means.
 */
import type { ReactNode } from "react";

export type StageMode = "pending" | "completed";
/** Whose completed entries to show. Defaults to "mine" — the point is "what I did". */
export type StageScope = "mine" | "all";

const TAB_BASE =
  "px-3.5 py-1.5 text-[13px] font-semibold rounded-md transition-colors whitespace-nowrap";

function Pill({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={`ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-px rounded-full text-[11px] font-semibold ${
        active ? "bg-white/25 text-white" : "bg-line text-grey-2"
      }`}
    >
      {n}
    </span>
  );
}

export default function StageTabs({
  mode,
  onMode,
  pendingCount,
  completedCount,
  scope,
  onScope,
  scopeNote,
  right,
}: {
  mode: StageMode;
  onMode: (m: StageMode) => void;
  pendingCount: number;
  completedCount: number;
  /** Scope controls render only in the completed tab; omit to hide them entirely. */
  scope?: StageScope;
  onScope?: (s: StageScope) => void;
  /**
   * Whose view "Mine" currently means. Shown next to the switch. Load-bearing in
   * demo/persona mode: the app re-scopes to the persona while writes still stamp
   * the real user, so without saying whose entries these are, a freshly recorded
   * row appearing to vanish from "Mine" looks like a bug rather than impersonation.
   */
  scopeNote?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-page border border-line">
        <button
          onClick={() => onMode("pending")}
          className={`${TAB_BASE} ${mode === "pending" ? "bg-navy text-white" : "text-grey-2 hover:text-navy"}`}
        >
          Pending &amp; Overdue
          <Pill n={pendingCount} active={mode === "pending"} />
        </button>
        <button
          onClick={() => onMode("completed")}
          className={`${TAB_BASE} ${mode === "completed" ? "bg-navy text-white" : "text-grey-2 hover:text-navy"}`}
        >
          Completed
          <Pill n={completedCount} active={mode === "completed"} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        {mode === "completed" && scope && onScope && (
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-page border border-line">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => onScope(s)}
                  className={`${TAB_BASE} capitalize ${
                    scope === s ? "bg-orange text-white" : "text-grey-2 hover:text-navy"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {scope === "mine" && scopeNote && (
              <span className="text-[12px] text-grey-2 whitespace-nowrap">{scopeNote}</span>
            )}
          </div>
        )}
        {right}
      </div>
    </div>
  );
}
