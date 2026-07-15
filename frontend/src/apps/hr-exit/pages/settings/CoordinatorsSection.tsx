import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useExitStore } from "../../store";

/**
 * Process Coordinators (admin).
 *
 * Coordinators see every exit case in the Control Center and may chase — or act on —
 * any step, which is what stops an unresponsive manager wedging a case. Along with
 * step owners they are also, in RLS and not merely here, the only people who can read
 * a case they are not personally attached to.
 *
 * They do NOT thereby get the confidential satellites: the exit interview and the F&F
 * have their own narrower gates (fms_exit_is_hr_confidential / _is_finance_staff).
 */
export default function CoordinatorsSection() {
  const s = useExitStore();
  const [picked, setPicked] = useState<string[]>(s.processCoordinatorIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );

  const dirty = useMemo(
    () => [...picked].sort().join(",") !== [...s.processCoordinatorIds].sort().join(","),
    [picked, s.processCoordinatorIds],
  );

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setCoordinators(picked);
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
        <FieldLabel label="Process Coordinator(s)" hint="see every exit · chase what's late">
          <MultiSelect
            values={picked}
            onChange={(v) => {
              setPicked(v);
              setSaved(false);
            }}
            options={peopleOptions}
            placeholder="Select coordinators"
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            Coordinators can act on any step, so a case is never stuck behind one unresponsive person. They still cannot
            read the exit interview or the settlement — those have their own, narrower gates.
          </span>
        </FieldLabel>

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
