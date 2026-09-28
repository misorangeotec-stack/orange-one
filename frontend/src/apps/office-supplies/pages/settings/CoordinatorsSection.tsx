import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { useSuppliesStore } from "../../store";

/**
 * Process coordinators (admin). They see the Control Center, can act on any step, and
 * can hold requests. Stored in fms_supplies_config under `process_coordinators`.
 *
 * ⚠ The picker FOLLOWS THE STORE until the first edit, and Save is dead until it is
 *   both loaded and changed — see the long note in RaisingSection. `useState(s.…)`
 *   reads once, so a tab opened before the fetch lands shows an empty picker over a
 *   saved list and Save writes `[]`. On this list that would silently strip everyone
 *   who oversees the process.
 */
export default function CoordinatorsSection() {
  const s = useSuppliesStore();
  const [edited, setEdited] = useState<string[] | null>(null);
  const picked = edited ?? s.processCoordinatorIds;
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

  const key = (a: string[]) => [...a].sort().join(",");
  const dirty = edited !== null && key(edited) !== key(s.processCoordinatorIds);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setCoordinators(picked);
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
        Coordinators oversee the whole purchase process — they can act on any step, hold a request, and open the Control
        Center.
      </p>
      {!s.isLoading && s.processCoordinatorIds.length === 0 && (
        <p className="text-[12.5px] text-grey-2">
          Nobody is a coordinator today, so holding a request and the Control Center are admin-only.
        </p>
      )}
      <MultiSelect
        values={picked}
        onChange={(v) => { setEdited(v); setSaved(false); }}
        options={peopleOptions}
        placeholder={s.isLoading ? "Loading…" : "Select coordinators"}
        disabled={s.isLoading}
      />
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy || s.isLoading || !dirty}>{busy ? "Saving…" : "Save"}</Button>
        {saved && !dirty && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
