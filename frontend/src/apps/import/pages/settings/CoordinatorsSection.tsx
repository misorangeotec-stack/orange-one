import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useImportStore } from "../../store";

/**
 * Process Coordinator config (admin). Coordinators see every entry across all
 * stages in the Monitoring center and may nudge / escalate / reassign. They do
 * not silently edit captured data.
 */
export default function CoordinatorsSection() {
  const s = useImportStore();
  const [picked, setPicked] = useState<string[]>(s.processCoordinatorIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles]
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
      await s.setProcessCoordinators(picked);
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
        <FieldLabel label="Process Coordinator(s)" hint="see all entries · nudge / escalate / reassign">
          <MultiSelect
            values={picked}
            onChange={(v) => {
              setPicked(v);
              setSaved(false);
            }}
            options={peopleOptions}
            placeholder="Select coordinators"
          />
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
