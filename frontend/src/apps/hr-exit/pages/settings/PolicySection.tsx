import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useExitStore } from "../../store";

/**
 * Policy (admin) — the three numbers the workflow keys off that are not step SLAs.
 *
 * The payroll cut-off is not a working-day offset and cannot be expressed as one: it
 * is a monthly CALENDAR event. `payroll_inputs` is due on the cut-off of the month the
 * last working day falls in — and if that day has already passed relative to the LWD,
 * it rolls to the next month's, because you cannot key a leaver's final payroll before
 * their last day.
 */
export default function PolicySection() {
  const s = useExitStore();
  const [cutoff, setCutoff] = useState(String(s.policy.payrollCutoffDay));
  const [notice, setNotice] = useState(String(s.policy.defaultNoticeDays));
  const [selfService, setSelfService] = useState(s.policy.allowSelfService);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const cutoffN = Math.max(1, Math.min(28, Math.floor(Number(cutoff) || 0) || 1));
  const noticeN = Math.max(0, Math.min(365, Math.floor(Number(notice) || 0)));

  const dirty = useMemo(
    () =>
      cutoffN !== s.policy.payrollCutoffDay ||
      noticeN !== s.policy.defaultNoticeDays ||
      selfService !== s.policy.allowSelfService,
    [cutoffN, noticeN, selfService, s.policy],
  );

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setPolicy({
        payrollCutoffDay: cutoffN,
        defaultNoticeDays: noticeN,
        allowSelfService: selfService,
      });
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 max-w-xl">
      <div className="space-y-4">
        <FieldLabel label="Payroll cut-off day" hint="day of the month">
          <TextInput
            type="number"
            min={1}
            max={28}
            className="w-24"
            value={cutoff}
            onChange={(e) => {
              setCutoff(e.target.value);
              setSaved(false);
            }}
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            Payroll inputs are due on this day of the month the last working day falls in. Capped at 28 so it exists in
            every month.
          </span>
        </FieldLabel>

        <FieldLabel label="Default notice period" hint="days">
          <TextInput
            type="number"
            min={0}
            max={365}
            className="w-24"
            value={notice}
            onChange={(e) => {
              setNotice(e.target.value);
              setSaved(false);
            }}
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            Prefilled on a new exit case. HR can override it per person, and can waive it entirely.
          </span>
        </FieldLabel>

        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={selfService}
            onChange={(e) => {
              setSelfService(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5 w-4 h-4 accent-orange"
          />
          <span>
            <span className="block text-[13px] text-navy">Employees may raise their own resignation</span>
            <span className="block text-[11px] leading-snug text-grey-2">
              Switch this off and only HR, a coordinator or the person's reporting manager can open an exit case on their
              behalf.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {saved && !dirty && <span className="text-[12.5px] text-ryg-green font-medium">Saved</span>}
          {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
