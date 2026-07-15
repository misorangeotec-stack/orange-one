import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useExitStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import { anchorOptions, INERT_STEPS, TRIGGER_STEPS, type StepSlaMap } from "../../lib/sla";

/**
 * Due Dates config (admin). Each step's due date = the anchor step's completion +
 * N working days (Mon–Sat; only Sunday is skipped).
 *
 * The anchor defaults to the previous step but may be any *earlier* step — the
 * reference is not always the one right before. Restricting the choice to earlier
 * steps also makes an anchor cycle impossible by construction.
 *
 * Rows come in three shapes:
 *  • Inert (`resignation`) — raising it IS the event; it never waits in a queue, so no
 *    due date is computed. It exists only as an anchor for later steps.
 *  • Trigger-anchored (7 steps) — anchored on the last working day, or on the payroll
 *    cut-off. The "Due after" cell is static; the number stays editable.
 *  • Everything else — a freely chosen earlier anchor + N working days.
 *
 * ── THE "DUE BEFORE" BRANCH IS THE POINT OF THIS COPY ────────────────────────
 *
 * Five of the trigger steps run BACKWARDS from the last working day: you cannot chase
 * a laptop after the person has walked out. HR Recruitment's copy of this screen only
 * knows "Due after", and the shared SLA engine cannot carry the direction at all — a
 * negative `days` is not clamped, it SILENTLY SUBSTITUTES THE STEP'S DEFAULT
 * (shared/lib/stepSla.ts). So the direction lives in code (`before: true` in
 * TRIGGER_STEPS) and only the MAGNITUDE is configurable here. The number input stays
 * `min={0}` deliberately: a negative typed here would be thrown away without a word.
 */
const stepTitle = (k: StepKey) => stepByKey(k)?.title ?? k;

export default function StepDueDatesSection() {
  const s = useExitStore();
  const [draft, setDraft] = useState<StepSlaMap>(s.stepSla);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-seed whenever the saved config changes (another admin, or after a save).
  useEffect(() => setDraft(s.stepSla), [s.stepSla]);

  const dirty = useMemo(
    () =>
      STEPS.some(
        (st) => draft[st.key].anchor !== s.stepSla[st.key].anchor || draft[st.key].days !== s.stepSla[st.key].days,
      ),
    [draft, s.stepSla],
  );

  const setAnchor = (step: StepKey, anchor: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [step]: { ...d[step], anchor: anchor as StepKey } }));
  };
  const setDays = (step: StepKey, raw: string) => {
    setSaved(false);
    // Clamped to ≥ 0 on purpose. Direction is a code concern; this is the magnitude.
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
                <th className="font-medium px-4 py-3 min-w-[240px]">Due relative to</th>
                <th className="font-medium px-4 py-3 w-40">Working days</th>
                <th className="font-medium px-4 py-3">Rule</th>
              </tr>
            </thead>
            <tbody>
              {STEPS.map((st) => {
                const rule = draft[st.key];
                const inert = INERT_STEPS[st.key];
                const trigger = inert ? undefined : TRIGGER_STEPS[st.key];
                const before = trigger?.before === true;
                const options: ComboOption[] = anchorOptions(st.key).map((k) => ({ value: k, label: stepTitle(k) }));
                return (
                  <tr
                    key={st.key}
                    className={`border-b border-line/70 last:border-0 ${inert ? "bg-page/40" : "hover:bg-page/60"}`}
                  >
                    <td className="px-4 py-3 text-grey-2">{st.index}</td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                    <td className="px-4 py-3">
                      {inert ? (
                        <span className="text-grey-2">{inert.dueAfter}</span>
                      ) : trigger ? (
                        <span className="text-grey-2">
                          <span className={`font-semibold ${before ? "text-orange" : "text-navy"}`}>
                            {before ? "Due BEFORE" : "Due after"}
                          </span>
                          {": "}
                          {trigger.dueAfter}
                        </span>
                      ) : (
                        <Combobox value={rule.anchor} onChange={(v) => setAnchor(st.key, v)} options={options} autoAdvance />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {inert ? (
                        <span className="text-grey-2">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <TextInput
                            type="number"
                            min={0}
                            max={365}
                            className="w-20"
                            value={String(rule.days)}
                            onChange={(e) => setDays(st.key, e.target.value)}
                          />
                          {before && <span className="text-[12px] text-grey-2 whitespace-nowrap">before</span>}
                        </div>
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
          Working days run Monday to Saturday — Sundays are skipped. A number is always a count, never a direction: the
          steps marked <span className="font-semibold text-orange">Due BEFORE</span> count backwards from the last
          working day.
        </span>
      </div>
    </div>
  );
}
