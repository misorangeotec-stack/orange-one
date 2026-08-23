import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import type { StepSlaMap } from "../../lib/sla";

/**
 * How long each step gets.
 *
 * ⚠ THE DEFAULTS ARE NOT ALL THE SAME, and the screen says so rather than
 *   hiding it: filling in an order confirmation gets two days and a customer
 *   signature seven, because one of those is our work and the other is a
 *   document sitting on somebody else's desk. See lib/sla.ts.
 *
 * ⚠ A DUE DATE COLOURS A CELL; IT DOES NOT GATE ANYTHING. No RPC refuses a late
 *   step. Saying so here matters, because a number that looks like a rule
 *   invites people to set it defensively long — and a queue where nothing is
 *   ever red is exactly as useless as one where everything is.
 *
 * The anchor is shown, not editable. Every OCPI step follows the one before it,
 * the chain is linear and does not branch, so an anchor picker would offer a
 * choice with no correct alternative answer.
 */
export default function StepDueDatesSection() {
  const s = useOcpiStore();
  const queueSteps = STEPS.filter((st) => !st.noQueue);

  const [days, setDays] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const st of queueSteps) out[st.key] = String(s.stepSla[st.key]?.days ?? 1);
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

  return (
    <Card className="max-w-xl space-y-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Due dates</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          How many working days (Mon&ndash;Sat) each step gets after the one before it finishes.
          A late step shows red in the queues and on the Control Center &mdash; nothing is blocked
          by it.
        </p>
      </div>

      <div className="space-y-3">
        {queueSteps.map((st) => (
          <div key={st.key} className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13.5px] font-medium text-navy">{st.title}</div>
              <div className="text-[11px] text-grey-2">
                After {stepByKey(s.stepSla[st.key as StepKey]?.anchor ?? "quotation")?.title ?? "Quotation"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TextInput
                className="w-20 text-center"
                inputMode="numeric"
                value={days[st.key] ?? ""}
                onChange={(e) => {
                  setDays((p) => ({ ...p, [st.key]: e.target.value }));
                  setSaved(false);
                }}
              />
              <span className="text-[12.5px] text-grey-2">working days</span>
            </div>
          </div>
        ))}
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
