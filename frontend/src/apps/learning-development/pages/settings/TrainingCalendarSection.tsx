import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import type { Json } from "@/core/platform/database.types";
import { useLdStore } from "../../store";

/**
 * Training Calendar (admin) — HR's change set of 14-10-2026.
 *
 * Calendar managers (decision D2) may add, upload, edit, cancel and complete
 * calendar trainings. Admins and process coordinators already can. The yearly
 * hours target is what the dashboard's chart and "hours to go" measure against.
 *
 * ⚠ THE TARGET LIVES IN `targets.hours_per_head_year` — the same key the weekly
 *   report already reads — so it is merged into that object, never written over
 *   it: the other targets (attendance %, per-month counts) live beside it.
 */
export default function TrainingCalendarSection() {
  const s = useLdStore();
  const [ids, setIds] = useState<string[]>(s.calendarManagerIds);
  const [target, setTarget] = useState(String(s.hoursTarget));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const options: MultiOption[] = useMemo(
    () =>
      [...s.orgPeople]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.orgPeople],
  );

  const t = Number(target);
  const targetOk = Number.isFinite(t) && t > 0 && t <= 500;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.writes.setCalendarManagers(ids);
      const cur = (s.data?.config.targets ?? {}) as Record<string, unknown>;
      await s.writes.setConfig("targets", { ...cur, hours_per_head_year: t } as Json);
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
        <h2 className="text-[15px] font-semibold text-navy">Training calendar</h2>
        <p className="text-[13px] text-grey-2 mt-1">
          Who may add and upload trainings — and so also edit, cancel and complete them — and the yearly training
          hours every employee must reach.
        </p>
      </div>
      <FieldLabel label="Calendar managers" hint="Admins and process coordinators already have this right.">
        <MultiSelect
          values={ids}
          onChange={(v) => { setIds(v); setSaved(false); }}
          options={options}
          placeholder="Select people"
          chips
        />
      </FieldLabel>
      <FieldLabel label="Training hours per employee per year" hint="Financial year, April–March.">
        <TextInput
          type="number"
          min={1}
          value={target}
          onChange={(e) => { setTarget(e.target.value); setSaved(false); }}
          className="max-w-[10rem]"
        />
      </FieldLabel>
      {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      {saved && <p className="text-[13px] text-ryg-green">Saved.</p>}
      <Button onClick={() => void save()} disabled={busy || !targetOk}>{busy ? "Saving…" : "Save"}</Button>
    </Card>
  );
}
