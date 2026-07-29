import { useEffect, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useAssetStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import { DEFAULT_STEP_SLA } from "../../lib/sla";

/**
 * How long each step gets, in working days (Mon–Sat, skipping Sundays and public
 * holidays).
 *
 * ⚠ ONE ROW IS NOT EDITABLE THE SAME WAY. "Record Service" is due on the JOB'S OWN
 *   due date — the day the cover actually lapses — not N days after the step
 *   before it. Its anchor is fixed in code (lib/sla.ts) precisely so a well-meant
 *   config change cannot make a service look on-time three weeks after the
 *   insurance expired. Its offset stays editable; the anchor does not.
 */
export default function StepDueDatesSection() {
  const s = useAssetStore();
  const queueSteps = STEPS.filter((st) => !st.noQueue);
  const [days, setDays] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const st of queueSteps) next[st.key] = String(s.stepSla[st.key]?.days ?? 1);
    setDays(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.stepSla]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const map: Record<string, unknown> = {};
      for (const st of queueSteps) {
        const n = Math.max(0, Math.floor(Number(days[st.key]) || 0));
        map[st.key] = { anchor: s.stepSla[st.key]?.anchor ?? DEFAULT_STEP_SLA[st.key].anchor, days: n };
      }
      await s.setConfig("step_sla", map);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally { setBusy(false); }
  };

  const anchorLabel = (key: StepKey): string => {
    if (key === "service_done") return "the date the service falls due";
    const a = s.stepSla[key]?.anchor ?? DEFAULT_STEP_SLA[key].anchor;
    return a === "service_due" ? "the job being raised" : `“${stepByKey(a)?.title ?? a}” being recorded`;
  };

  return (
    <Card className="max-w-3xl p-5">
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Step due dates</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-grey-2">
            Working days — Monday to Saturday, skipping Sundays and public holidays. These are the
            INTERNAL SLAs for the people holding each step, and are separate from the service's own
            due date, which comes from the asset's track.
          </p>
        </div>

        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-grey">
              <th className="py-2 pr-3">Step</th>
              <th className="py-2 pr-3">Counted from</th>
              <th className="py-2 pr-3 w-32">Working days</th>
            </tr>
          </thead>
          <tbody>
            {queueSteps.map((st) => (
              <tr key={st.key} className="border-b border-line/70">
                <td className="py-2 pr-3 font-semibold text-navy">{st.title}</td>
                <td className="py-2 pr-3 text-grey">{anchorLabel(st.key)}</td>
                <td className="py-2 pr-3">
                  <TextInput
                    inputMode="numeric"
                    disabled={!s.isAdmin}
                    value={days[st.key] ?? ""}
                    onChange={(e) => setDays((p) => ({ ...p, [st.key]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={!s.isAdmin || busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
          {saved && <span className="text-[12.5px] font-medium text-ryg-green">Saved</span>}
          {error && <span className="text-[12.5px] text-ryg-red">{error}</span>}
        </div>
      </div>
    </Card>
  );
}
