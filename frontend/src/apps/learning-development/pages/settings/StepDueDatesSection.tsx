import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import type { Json } from "@/core/platform/database.types";
import { useLdStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import { DEFAULT_STEP_SLA, TRIGGER_STEPS, anchorOptions } from "../../lib/sla";

/**
 * Due Dates (admin) — how long each step gets, and which earlier step starts its
 * clock.
 *
 * ⚠ EVERY NUMBER HERE IS A RECOMMENDATION, NOT A RULE, and §1 of the source
 *   document says so: the L&D timelines "are recommended configuration values and
 *   may be changed by HR before development sign-off". Nothing is hard-coded.
 *
 * ⚠ A TRIGGER STEP SHOWS ITS ANCHOR AS STATIC TEXT. Its clock starts on a domain
 *   event, so offering an anchor picker would present a control that changes
 *   nothing — the same treatment Purchase gives `tally` and HR gives its
 *   probation reviews.
 */
export default function StepDueDatesSection() {
  const s = useLdStore();
  const stored = s.data?.stepSla ?? DEFAULT_STEP_SLA;
  const [draft, setDraft] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: StepKey, patch: Partial<{ anchor: StepKey; days: number }>) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      // StepSlaMap is a Record of objects, which is structurally Json but not
      // assignable to it — Json's index signature is what the map lacks, not the
      // shape. The cast is at the boundary where it is stored, not in the model.
      await s.writes.setConfig("step_sla", draft as unknown as Json);
      await s.refresh();
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <p className="text-[13px] text-grey-2">
        A step is due its number of working days after the step that starts its clock. Saturdays count;
        Sundays don't.
      </p>

      <div className="space-y-2">
        {STEPS.filter((st) => !st.noQueue).map((st) => {
          const rule = draft[st.key];
          const trigger = TRIGGER_STEPS[st.key];
          return (
            <div
              key={st.key}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3"
            >
              <span className="min-w-[13rem] flex-1 text-[13.5px] font-semibold text-navy">
                {st.index}. {st.title}
              </span>

              <div className="flex items-center gap-2">
                <TextInput
                  type="number"
                  min={0}
                  value={String(rule?.days ?? 1)}
                  onChange={(e) => set(st.key, { days: Number(e.target.value) })}
                  className="w-20"
                />
                <span className="text-[12.5px] text-grey-2">working days after</span>
              </div>

              {trigger ? (
                <span
                  className="min-w-[14rem] rounded-lg bg-[#F1F4F9] px-3 py-2 text-[12.5px] text-grey-2"
                  title={trigger.rule}
                >
                  {trigger.dueAfter}
                </span>
              ) : (
                <div className="min-w-[14rem]">
                  <Combobox
                    value={rule?.anchor ?? st.key}
                    onChange={(v) => set(st.key, { anchor: v as StepKey })}
                    options={anchorOptions(st.key).map((k) => ({
                      value: k,
                      label: stepByKey(k)?.short ?? k,
                    }))}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      {saved && <p className="text-[13px] text-ryg-green">Saved.</p>}

      <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save due dates"}</Button>
    </Card>
  );
}
