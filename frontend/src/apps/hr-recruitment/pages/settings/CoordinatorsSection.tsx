import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";

/**
 * Process Coordinators (admin).
 *
 * Coordinators see every requisition and candidate in the Control Center and may
 * chase them. They are also, along with step owners, the only people who can read
 * candidate PII and resumes at all (enforced in RLS, not just here).
 *
 * This screen used to carry a "Minimum CVs to share with a HOD" rule as well. It
 * gated one button — the Share-to-HOD step — and went with it (20260903130000):
 * shortlisting by HR now IS the handover, so there is no batch to hold back and
 * nothing left for a threshold to warn about.
 */
export default function CoordinatorsSection() {
  const s = useHrStore();
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

  const dirty = useMemo(() => {
    const a = [...picked].sort().join(",");
    const b = [...s.processCoordinatorIds].sort().join(",");
    return a !== b;
  }, [picked, s.processCoordinatorIds]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      if ([...picked].sort().join(",") !== [...s.processCoordinatorIds].sort().join(",")) {
        await s.setProcessCoordinators(picked);
      }
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
        <FieldLabel label="Process Coordinator(s)" hint="see every requisition · chase what's late">
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
            Coordinators and step owners are the only people who can see candidate resumes and phone numbers.
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
