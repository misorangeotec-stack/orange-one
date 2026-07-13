import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";

/**
 * Process Coordinators + the shortlist rule (admin).
 *
 * Coordinators see every requisition and candidate in the Control Center and may
 * chase them. They are also, along with step owners, the only people who can read
 * candidate PII and resumes at all (enforced in RLS, not just here).
 */
export default function CoordinatorsSection() {
  const s = useHrStore();
  const [picked, setPicked] = useState<string[]>(s.processCoordinatorIds);
  const [minCvs, setMinCvs] = useState<string>(String(s.minCvsToShare));
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

  const cvsN = Math.max(0, Math.min(100, Math.floor(Number(minCvs) || 0)));

  const dirty = useMemo(() => {
    const a = [...picked].sort().join(",");
    const b = [...s.processCoordinatorIds].sort().join(",");
    return a !== b || cvsN !== s.minCvsToShare;
  }, [picked, s.processCoordinatorIds, cvsN, s.minCvsToShare]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      if ([...picked].sort().join(",") !== [...s.processCoordinatorIds].sort().join(",")) {
        await s.setProcessCoordinators(picked);
      }
      if (cvsN !== s.minCvsToShare) await s.setMinCvsToShare(cvsN);
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

        <FieldLabel label="Minimum CVs to share with a HOD" hint="a warning, not a hard block">
          <TextInput
            type="number"
            min={0}
            max={100}
            className="w-24"
            value={minCvs}
            onChange={(e) => {
              setMinCvs(e.target.value);
              setSaved(false);
            }}
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            HR is warned when sharing fewer than this many CVs at once.
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
