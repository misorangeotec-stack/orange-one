import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useTravelStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import { TRIGGER_STEPS, type StepSlaMap } from "../../lib/sla";

/**
 * How long each step gets.
 *
 * ⚠ EVERY DEFAULT HERE IS A FIGURE FROM §12, NOT A GUESS — 5 working days for
 *   the claim, 2 for the HOD, 5 for Finance, 7 for the credit, 14 for the whole
 *   cycle. Editing one is editing the company's promise to its own staff, which
 *   is why the screen names where each number came from.
 *
 * ⚠ TWO STEPS ARE NOT MEASURED FROM THE STEP BEFORE THEM, and the screen has to
 *   say so or the numbers read as wrong:
 *     · CLAIM counts from the trip's RETURN DATE — the journey ending is what
 *       starts the clock, and the journey is not a step anybody completes.
 *     · ADVANCE counts BACKWARDS from the planned departure. §11.1 wants the
 *       money credited BEFORE the traveller leaves; money that lands afterwards
 *       has missed the point entirely.
 *   The direction lives in code (`TRIGGER_STEPS`), never in this box — the
 *   shared engine silently substitutes a step's default for any negative `days`,
 *   so a "-1" typed here would look accepted and do something else.
 *
 * ⚠ A DUE DATE COLOURS A CELL; IT DOES NOT GATE ANYTHING. No RPC in this module
 *   refuses a late step. Saying so matters, because a number that looks like a
 *   rule invites people to set it defensively long — and a queue where nothing
 *   is ever red is exactly as useless as one where everything is. The two things
 *   that ARE refused (a claim more than 30 days after travel, a second advance
 *   while one is unreconciled) are policy rules enforced in SQL, and they are on
 *   the Policy section below, not here.
 */
export default function StepDueDatesSection() {
  const s = useTravelStore();
  const queueSteps = STEPS.filter((st) => !st.noQueue);

  const [days, setDays] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const st of queueSteps) out[st.key] = String(s.stepSla[st.key as StepKey]?.days ?? 1);
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const map: StepSlaMap = { ...s.stepSla };
      for (const st of queueSteps) {
        // ⚠ FLOORED AT ZERO, ALWAYS. Magnitude lives here; direction lives in
        //   TRIGGER_STEPS. A negative number stored in config is silently
        //   replaced by the step's default, so it must never get that far.
        const n = Math.max(0, Math.floor(Number(days[st.key]) || 0));
        map[st.key as StepKey] = { ...map[st.key as StepKey], days: n };
      }
      await s.setStepSla(map);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const measuredFrom = (key: StepKey): string => {
    const trigger = TRIGGER_STEPS[key];
    if (trigger) {
      return trigger.before ? `Counted BACKWARDS from the ${trigger.dueAfter.toLowerCase()}` : `After the ${trigger.dueAfter.toLowerCase()}`;
    }
    const anchor = s.stepSla[key]?.anchor as StepKey | undefined;
    return `After ${stepByKey(anchor ?? "request")?.title ?? "the request"}`;
  };

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Due dates</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          How many working days (Mon&ndash;Sat) each step gets. A late step shows red in the queues
          and on the Control Center &mdash; nothing is blocked by it. The defaults are Policy
          &sect;12&rsquo;s own timetable: 5 days to claim, 2 for the manager, 5 for Finance, 7 to
          the credit, 14 for the whole cycle.
        </p>
      </div>

      <div className="space-y-3">
        {queueSteps.map((st) => {
          const trigger = TRIGGER_STEPS[st.key as StepKey];
          return (
            <div key={st.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-navy">
                  {st.title}
                  {trigger?.before && (
                    <span className="ml-2 rounded bg-[#FFF7E6] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy">
                      Before
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-grey-2">{measuredFrom(st.key as StepKey)}</div>
                {trigger && (
                  <div className="mt-0.5 text-[11px] leading-snug text-grey-2">{trigger.rule}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <TextInput
                  className="w-20 text-center"
                  inputMode="numeric"
                  value={days[st.key] ?? ""}
                  onChange={(e) => {
                    setDays((p) => ({ ...p, [st.key]: e.target.value }));
                    setSaved(false);
                  }}
                />
                <span className="whitespace-nowrap text-[12.5px] text-grey-2">working days</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" onClick={() => void save()} disabled={busy || !s.isAdmin}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
