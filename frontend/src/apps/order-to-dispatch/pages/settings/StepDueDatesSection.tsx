import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import { DEFAULT_CUTOFF_HOUR, DEFAULT_STEP_SLA, type StepSlaMap } from "../../lib/sla";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}));

/**
 * Per-step due-date targets.
 *
 * Most steps are simply "N working days after the previous one". The material-
 * status check is not: the source sheet's rule is an hour-of-day cut-off ("order
 * received before 12PM - same Day Dispatch /// After 12PM - Next day Dispatch"),
 * so that row swaps the days input for a cut-off hour.
 *
 * Which steps behave which way is decided by the CODE default's unit, never by
 * config — `resolveStepSla` only lets a stored `unit` re-state the default, so
 * this screen can change the hour but can never turn a working-days step into a
 * cut-off one by accident.
 */
export default function StepDueDatesSection() {
  const s = useDispatchStore();
  const queueSteps = STEPS.filter((st) => !st.noQueue);

  const [days, setDays] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const st of queueSteps) out[st.key] = String(s.stepSla[st.key]?.days ?? 1);
    return out;
  });
  const [hours, setHours] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const st of queueSteps) {
      out[st.key] = String(s.stepSla[st.key]?.cutoffHour ?? DEFAULT_CUTOFF_HOUR);
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isCutoff = (key: StepKey) => DEFAULT_STEP_SLA[key]?.unit === "same_day_cutoff";

  const save = async () => {
    setBusy(true); setErr(null); setSaved(false);
    try {
      const map: StepSlaMap = { ...s.stepSla };
      for (const st of queueSteps) {
        const key = st.key as StepKey;
        const n = Math.max(0, Math.floor(Number(days[st.key]) || 0));
        const next = { ...map[key], days: n };
        if (isCutoff(key)) {
          const h = Math.min(23, Math.max(0, Math.floor(Number(hours[st.key]) || DEFAULT_CUTOFF_HOUR)));
          next.unit = "same_day_cutoff";
          next.cutoffHour = h;
        }
        map[key] = next;
      }
      await s.setConfig("step_sla", map as unknown as Record<string, unknown>);
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-4 max-w-3xl">
      <p className="text-[12.5px] text-grey">
        How long each step gets. Working days are Mon–Sat (Sundays are skipped). An order past its due date shows red in
        the queues and on both Control Centers.
      </p>

      <div className="space-y-4">
        {queueSteps.map((st) => {
          const key = st.key as StepKey;
          const cutoff = isCutoff(key);
          const anchorShort = stepByKey(s.stepSla[key]?.anchor ?? "sales_order")?.short ?? "Order";
          return (
            <div key={st.key} className="flex flex-wrap items-start justify-between gap-4 border-b border-line/70 pb-4 last:border-0 last:pb-0">
              <div className="min-w-[220px]">
                <div className="text-[13.5px] font-medium text-navy">
                  <span className="text-grey-2 mr-1.5">{st.index}.</span>
                  {st.title}
                </div>
                <div className="text-[11px] text-grey-2 mt-0.5">After {anchorShort}</div>
              </div>

              {cutoff ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-grey-2">Cut-off</span>
                  <Combobox
                    value={hours[st.key] ?? String(DEFAULT_CUTOFF_HOUR)}
                    onChange={(v) => { setHours((p) => ({ ...p, [st.key]: v })); setSaved(false); }}
                    options={HOUR_OPTIONS}
                    className="w-28"
                  />
                  <span className="text-[12.5px] text-grey-2">+</span>
                  <TextInput
                    className="w-16 text-center"
                    inputMode="numeric"
                    value={days[st.key] ?? ""}
                    onChange={(e) => { setDays((p) => ({ ...p, [st.key]: e.target.value })); setSaved(false); }}
                  />
                  <span className="text-[12.5px] text-grey-2">working days</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <TextInput
                    className="w-20 text-center"
                    inputMode="numeric"
                    value={days[st.key] ?? ""}
                    onChange={(e) => { setDays((p) => ({ ...p, [st.key]: e.target.value })); setSaved(false); }}
                  />
                  <span className="text-[12.5px] text-grey-2">working days</span>
                </div>
              )}

              <p className="basis-full text-[11.5px] text-grey-2">
                {cutoff ? (
                  <>
                    Received before {String(hours[st.key] ?? DEFAULT_CUTOFF_HOUR).padStart(2, "0")}:00 → due the same
                    working day; at or after it → the next working day.
                    {Number(days[st.key]) > 0 && <> Then {days[st.key]} more working day(s).</>}
                  </>
                ) : (
                  <>Due {days[st.key] || 0} working day(s) after {anchorShort} is recorded.</>
                )}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
      <p className="text-[11.5px] text-grey-2">
        Whole days only — a fractional value is rounded down, so “half a day” is not expressible here.
      </p>
    </Card>
  );
}
