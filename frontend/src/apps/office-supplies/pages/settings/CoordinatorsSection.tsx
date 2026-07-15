import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { useSuppliesStore } from "../../store";

/**
 * Process coordinators (admin). They see the Control Center, can act on any step, and
 * can hold requests. Stored in fms_supplies_config under `process_coordinators`.
 */
export default function CoordinatorsSection() {
  const s = useSuppliesStore();
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
    <Card className="p-5 space-y-4 max-w-xl">
      <p className="text-[12.5px] text-grey">
        Coordinators oversee the whole supply process — they can act on any step, hold a request, and open the Control
        Center.
      </p>
      <MultiSelect values={picked} onChange={(v) => { setPicked(v); setSaved(false); }} options={peopleOptions} placeholder="Select coordinators" />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
