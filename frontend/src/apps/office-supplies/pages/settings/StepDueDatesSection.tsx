import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useSuppliesStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import type { StepSlaMap } from "../../lib/sla";

/**
 * Per-step due-date targets. Each queue step is due N working days after its anchor
 * step completes (defaults to 1). `request` has no queue, so it is not shown.
 */
export default function StepDueDatesSection() {
  const s = useSuppliesStore();
  const queueSteps = STEPS.filter((st) => !st.noQueue);

  /**
   * ⚠ THE BOXES FOLLOW THE STORE UNTIL THE FIRST EDIT. A lazy `useState(() => …)`
   *   reads `s.stepSla` ONCE, and the store loads asynchronously — so a tab opened
   *   before the fetch lands is seeded from DEFAULT_STEP_SLA (1 / 1 / 1) and Save
   *   writes that over the configured map. Handover is 3 working days on live data;
   *   one stray Save would have silently cut it to 1 and turned every open handover
   *   red two days early. Same fix as RaisingSection.
   */
  const fromStore = useMemo(() => {
    const out: Record<string, string> = {};
    for (const st of queueSteps) out[st.key] = String(s.stepSla[st.key]?.days ?? 1);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.stepSla]);
  const [edited, setEdited] = useState<Record<string, string> | null>(null);
  const days = edited ?? fromStore;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = edited !== null && queueSteps.some((st) => (edited[st.key] ?? "") !== (fromStore[st.key] ?? ""));

  const save = async () => {
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
      setEdited(null);
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-4 max-w-xl">
      <p className="text-[12.5px] text-grey">
        How many working days (Mon–Sat) each step gets after the previous one completes. A request past its due date shows
        red in the queues and the Control Center.
      </p>
      <div className="space-y-3">
        {queueSteps.map((st) => (
          <div key={st.key} className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13.5px] font-medium text-navy">{st.title}</div>
              <div className="text-[11px] text-grey-2">
                After {stepByKey(s.stepSla[st.key]?.anchor ?? "request")?.short ?? "Request"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TextInput
                className="w-20 text-center"
                inputMode="numeric"
                value={days[st.key] ?? ""}
                disabled={s.isLoading}
                onChange={(e) => { const v = e.target.value; setEdited((p) => ({ ...(p ?? fromStore), [st.key]: v })); setSaved(false); }}
              />
              <span className="text-[12.5px] text-grey-2">working days</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" onClick={save} disabled={busy || s.isLoading || !dirty}>{busy ? "Saving…" : "Save"}</Button>
        {saved && !dirty && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
