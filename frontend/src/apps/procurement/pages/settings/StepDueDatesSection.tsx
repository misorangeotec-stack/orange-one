import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useProcurementStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import { anchorOptions, TRIGGER_STEPS, type StepSlaMap } from "../../lib/sla";

/**
 * Due Dates config (admin). Each step's due date = the **anchor step's completion
 * timestamp + N working days**, counting Mon–Sat (only Sunday is skipped).
 *
 * The anchor defaults to the immediately previous step, but may be any *earlier*
 * step — the reference is not always the one right before. Restricting the choice
 * to earlier steps also makes a cycle impossible by construction.
 *
 * Rows come in three shapes:
 *  • Fully inert — no rule of their own, nothing to edit:
 *     · `request` — raising the order IS the event; it never sits in a queue waiting
 *       to be done (see LINE_STEPS in lib/queues.ts), so no due date is ever computed
 *       for it. It exists here only because later steps anchor on it (it resolves to
 *       the line's creation date, and is Sourcing's default anchor).
 *     · `follow_up` — its due date is the vendor's promised dispatch date, captured
 *       at Share PO, not an SLA.
 *     · `inward` — the transporter decides when the goods land, so receiving can
 *       never be late. It carries no due date at all (see `poDueIso`).
 *  • Trigger-anchored (`tally`) — the anchor is a domain event, so the "Due after"
 *    cell is static, but the working-days input stays editable.
 *  • Everything else — a freely chosen earlier anchor + N working days.
 */
const REQUEST: StepKey = "request";
const FOLLOW_UP: StepKey = "follow_up";
const INWARD: StepKey = "inward";

const stepTitle = (k: StepKey) => stepByKey(k)?.title ?? k;

export default function StepDueDatesSection() {
  const s = useProcurementStore();
  const [draft, setDraft] = useState<StepSlaMap>(s.stepSla);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-seed whenever the saved config changes (e.g. another admin, or after save).
  useEffect(() => setDraft(s.stepSla), [s.stepSla]);

  const dirty = useMemo(
    () => STEPS.some((st) => draft[st.key].anchor !== s.stepSla[st.key].anchor || draft[st.key].days !== s.stepSla[st.key].days),
    [draft, s.stepSla]
  );

  const setAnchor = (step: StepKey, anchor: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [step]: { ...d[step], anchor: anchor as StepKey } }));
  };
  const setDays = (step: StepKey, raw: string) => {
    setSaved(false);
    const n = raw === "" ? 0 : Math.max(0, Math.min(365, Math.floor(Number(raw) || 0)));
    setDraft((d) => ({ ...d, [step]: { ...d[step], days: n } }));
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.setStepSla(draft);
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDraft(s.stepSla);
    setSaved(false);
    setErr(null);
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <ScrollableTable>
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-grey-2 border-b border-line">
                <th className="font-medium px-4 py-3 w-10">#</th>
                <th className="font-medium px-4 py-3">Step</th>
                <th className="font-medium px-4 py-3 min-w-[220px]">Due after</th>
                <th className="font-medium px-4 py-3 w-36">Working days</th>
                <th className="font-medium px-4 py-3">Rule</th>
              </tr>
            </thead>
            <tbody>
              {STEPS.map((st) => {
                const rule = draft[st.key];
                // Steps that never sit in a queue, so no SLA of their own applies.
                const inert =
                  st.key === REQUEST
                    ? { dueAfter: "Not applicable", rule: "Raising the order is the event — it never waits in a queue. Other steps anchor on it." }
                    : st.key === FOLLOW_UP
                      ? { dueAfter: "Vendor's promised dispatch date", rule: "Set at Share PO — not an SLA." }
                      : st.key === INWARD
                        ? { dueAfter: "Not applicable", rule: "The transporter decides when goods arrive — receiving can never be late, so no due date." }
                        : null;
                // Anchored on a domain event: static "Due after", editable days.
                const trigger = inert ? undefined : TRIGGER_STEPS[st.key];
                const options: ComboOption[] = anchorOptions(st.key).map((k) => ({ value: k, label: stepTitle(k) }));
                return (
                  <tr key={st.key} className={`border-b border-line/70 last:border-0 ${inert ? "bg-page/40" : "hover:bg-page/60"}`}>
                    <td className="px-4 py-3 text-grey-2">{st.index}</td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                    <td className="px-4 py-3">
                      {inert ? (
                        <span className="text-grey-2">{inert.dueAfter}</span>
                      ) : trigger ? (
                        <span className="text-grey-2">{trigger.dueAfter}</span>
                      ) : (
                        <Combobox value={rule.anchor} onChange={(v) => setAnchor(st.key, v)} options={options} autoAdvance />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {inert ? (
                        <span className="text-grey-2">—</span>
                      ) : (
                        <TextInput
                          type="number"
                          min={0}
                          max={365}
                          className="w-24"
                          value={String(rule.days)}
                          onChange={(e) => setDays(st.key, e.target.value)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-grey-2">
                      {inert ? (
                        inert.rule
                      ) : trigger ? (
                        trigger.rule
                      ) : (
                        <>
                          {stepTitle(rule.anchor)}
                          {" + "}
                          <span className="font-semibold text-navy">
                            {rule.days} working day{rule.days === 1 ? "" : "s"}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy || !dirty || !s.canConfigure}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {dirty && (
          <button onClick={reset} disabled={busy} className="text-[12.5px] font-semibold text-grey-2 hover:text-navy">
            Reset
          </button>
        )}
        {saved && !dirty && <span className="text-[12.5px] text-ryg-green">Saved</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
        <span className="ml-auto text-[12px] text-grey-2">
          Working days run Monday to Saturday — Sundays are skipped.
        </span>
      </div>
    </div>
  );
}
