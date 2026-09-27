import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";

/**
 * Coordinators (admin) — the people who oversee every step.
 *
 * ⚠ A COORDINATOR CAN ACT ON EVERY STEP, not merely watch them. `fms_ld_can_act()`
 *   short-circuits on this list before it looks at step ownership, so naming
 *   somebody here hands them the whole workflow. It is the right answer for the
 *   L&D process owner and the wrong one for "I'd like to keep an eye on it".
 */
export default function CoordinatorsSection() {
  const s = useLdStore();
  const [ids, setIds] = useState<string[]>(s.data?.coordinatorIds ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const options: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.writes.setCoordinators(ids);
      await s.refresh();
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-[15px] font-semibold text-navy">Process coordinators</h2>
        <p className="text-[13px] text-grey-2 mt-1">
          They see every request and can act on any step. Admins already can.
        </p>
      </div>
      <FieldLabel label="Coordinators">
        <MultiSelect
          values={ids}
          onChange={(v) => { setIds(v); setSaved(false); }}
          options={options}
          placeholder="Select people"
          chips
        />
      </FieldLabel>
      {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      {saved && <p className="text-[13px] text-ryg-green">Saved.</p>}
      <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
    </Card>
  );
}
