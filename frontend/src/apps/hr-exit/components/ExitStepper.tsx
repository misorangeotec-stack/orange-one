import { formatDateDMY } from "@/shared/lib/date";
import { exitStepCompletedIso, openSteps } from "../lib/queues";
import { STEPS, type StepKey } from "../lib/steps";
import type { ExitCase, StepSkip } from "../types";

/**
 * The exit's whole journey — all 16 steps, with the ACTUAL date each one completed.
 *
 *   ✓  done      — the step's own timestamp column, stamped inside its RPC
 *   ●  current   — a step the case owes RIGHT NOW (there can be SEVERAL at once:
 *                  between the LWD and the F&F it owes clearance and assets and
 *                  handover and the interview, to six different people)
 *   ○  pending   — not reachable yet
 *   ⊘  skipped   — waived, with the reason on hover. A skipped step is
 *                  COMPLETE-WITH-A-REASON: it satisfies the downstream guards.
 *
 * Every date here is read from the case's own timestamp column — NEVER inferred from
 * the activity trail, which is best-effort and can be missing a step that happened.
 */
export default function ExitStepper({ case: c, skips }: { case: ExitCase; skips: StepSkip[] }) {
  const skipReason = new Map(skips.map((s) => [s.stepKey, s.reason]));
  const open = new Set<StepKey>(openSteps(c, [], new Set(skips.map((s) => s.stepKey as StepKey))));
  const dead = c.status === "rejected" || c.status === "withdrawn";

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-3">
      {STEPS.map((st) => {
        const reason = skipReason.get(st.key);
        const at = exitStepCompletedIso(c, st.key);
        const done = at !== null;
        const current = open.has(st.key);

        const mark = reason ? "⊘" : done ? "✓" : current ? "●" : "○";
        const chip = reason
          ? "border border-line bg-page text-grey-2"
          : done && !dead
            ? "bg-ryg-green text-white"
            : done
              ? "bg-grey-2 text-white"
              : current
                ? "bg-orange text-white"
                : "border border-line bg-white text-grey-2";

        return (
          <div
            key={st.key}
            className="flex items-start gap-2"
            title={reason ? `Skipped — ${reason}` : undefined}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${chip}`}
            >
              {mark}
            </span>
            <div className="min-w-[86px]">
              {/* A step not yet reached still needs its NAME legible: it used to sit in
                  the same grey as its own date, so name and date blurred into one. */}
              <div
                className={`text-[12.5px] font-semibold ${
                  reason ? "text-grey-2 line-through" : done || current ? "text-navy" : "text-grey"
                }`}
              >
                {st.short}
              </div>
              <div className={`text-[11px] ${at ? "font-medium text-navy" : "text-grey-2"}`}>
                {reason ? "Skipped" : at ? formatDateDMY(at) : current ? "Now" : "—"}
              </div>
            </div>
          </div>
        );
      })}

      {dead && (
        <span className="self-center rounded-full bg-[#FDECEC] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ryg-red">
          {c.status === "rejected" ? "Rejected" : "Withdrawn"}
        </span>
      )}
      {c.status === "on_hold" && (
        <span className="self-center rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-grey-2">
          On hold
        </span>
      )}
    </div>
  );
}
